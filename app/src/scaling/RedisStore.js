'use strict';

/**
 * Redis implementation of the cluster store (ioredis).
 * Loaded only when SCALING_CLUSTER=true, so ioredis is never required otherwise.
 * Uses Lua for the room ownership claim/release, which needs a standalone (or managed)
 * Redis/Valkey reached through one redis:// or rediss:// URL; Redis Cluster mode is not supported.
 */

// KEYS[1]=room key | ARGV[1]=node id, ARGV[2]=ttl ms, ARGV[3]=node key prefix
const CLAIM_SCRIPT = `
local owner = redis.call('GET', KEYS[1])
if owner and owner ~= ARGV[1] and redis.call('EXISTS', ARGV[3] .. owner) == 1 then
    return owner
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return ARGV[1]
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
`;

const ERROR_LOG_INTERVAL_MS = 30000;

class RedisStore {
    constructor({ url, log }) {
        const Redis = require('ioredis');
        this.log = log;
        this.lastErrorLog = 0;
        // Fail fast while Redis is unreachable: callers fall back to serving rooms locally
        this.client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
        this.sub = this.client.duplicate({ enableOfflineQueue: true });
        this.handlers = new Map();

        this.client.defineCommand('sfuClaim', { numberOfKeys: 1, lua: CLAIM_SCRIPT });
        this.client.defineCommand('sfuRelease', { numberOfKeys: 1, lua: RELEASE_SCRIPT });

        const onError = (error) => this.logError(error);
        this.client.on('error', onError);
        this.sub.on('error', onError);
        this.sub.on('message', (channel, message) => this.handlers.get(channel)?.(message));
    }

    logError(error) {
        if (Date.now() - this.lastErrorLog < ERROR_LOG_INTERVAL_MS) return;
        this.lastErrorLog = Date.now();
        this.log?.warn('Redis connection error', error?.message);
    }

    async connect() {
        await Promise.all([this.client.connect(), this.sub.connect()]);
    }

    async get(key) {
        return this.client.get(key);
    }

    async mget(keys) {
        return keys.length ? this.client.mget(keys) : [];
    }

    async set(key, value, ttlMs) {
        return ttlMs ? this.client.set(key, value, 'PX', ttlMs) : this.client.set(key, value);
    }

    async del(key) {
        return this.client.del(key);
    }

    async claim(key, nodeId, ttlMs, nodeKeyPrefix) {
        return this.client.sfuClaim(key, nodeId, ttlMs, nodeKeyPrefix);
    }

    async release(key, nodeId) {
        return this.client.sfuRelease(key, nodeId);
    }

    async sadd(key, member) {
        return this.client.sadd(key, member);
    }

    async srem(key, member) {
        return this.client.srem(key, member);
    }

    async smembers(key) {
        return this.client.smembers(key);
    }

    async hset(key, field, value, ttlMs) {
        const multi = this.client.multi().hset(key, field, value);
        if (ttlMs) multi.pexpire(key, ttlMs);
        return multi.exec();
    }

    async hdel(key, field) {
        return this.client.hdel(key, field);
    }

    async hgetall(key) {
        return this.client.hgetall(key);
    }

    async publish(channel, message) {
        return this.client.publish(channel, message);
    }

    async subscribe(channel, handler) {
        this.handlers.set(channel, handler);
        await this.sub.subscribe(channel);
    }

    async close() {
        this.handlers.clear();
        await Promise.allSettled([this.client.quit(), this.sub.quit()]);
    }
}

module.exports = RedisStore;
