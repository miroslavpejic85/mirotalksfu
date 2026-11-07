'use strict';

const { EventEmitter } = require('events');

/**
 * In-process implementation of the cluster store (same API as RedisStore).
 * Used by the tests, and handy to try the cluster logic without Redis: several
 * MemoryStore instances sharing one MemoryBackend behave like nodes sharing one Redis.
 */
class MemoryBackend {
    constructor() {
        this.kv = new Map(); // key -> { value, expiresAt }
        this.sets = new Map(); // key -> Set
        this.hashes = new Map(); // key -> Map
        this.bus = new EventEmitter();
        this.bus.setMaxListeners(0);
    }
}

class MemoryStore {
    constructor(backend = new MemoryBackend()) {
        this.backend = backend;
        this.listeners = [];
    }

    async connect() {}

    readKey(key) {
        const entry = this.backend.kv.get(key);
        if (!entry) return null;
        if (entry.expiresAt && entry.expiresAt <= Date.now()) {
            this.backend.kv.delete(key);
            return null;
        }
        return entry.value;
    }

    writeKey(key, value, ttlMs) {
        this.backend.kv.set(key, { value: String(value), expiresAt: ttlMs ? Date.now() + ttlMs : 0 });
    }

    async get(key) {
        return this.readKey(key);
    }

    async mget(keys) {
        return keys.map((key) => this.readKey(key));
    }

    async set(key, value, ttlMs) {
        this.writeKey(key, value, ttlMs);
    }

    async del(key) {
        this.backend.kv.delete(key);
    }

    // Keeps the current owner while its node is alive, otherwise hands the key to `nodeId`
    async claim(key, nodeId, ttlMs, nodeKeyPrefix) {
        const owner = this.readKey(key);
        if (owner && owner !== nodeId && this.readKey(nodeKeyPrefix + owner) !== null) return owner;
        this.writeKey(key, nodeId, ttlMs);
        return nodeId;
    }

    // Deletes the key only if `nodeId` still owns it
    async release(key, nodeId) {
        if (this.readKey(key) === nodeId) this.backend.kv.delete(key);
    }

    async sadd(key, member) {
        if (!this.backend.sets.has(key)) this.backend.sets.set(key, new Set());
        this.backend.sets.get(key).add(member);
    }

    async srem(key, member) {
        this.backend.sets.get(key)?.delete(member);
    }

    async smembers(key) {
        return [...(this.backend.sets.get(key) || [])];
    }

    async hset(key, field, value) {
        if (!this.backend.hashes.has(key)) this.backend.hashes.set(key, new Map());
        this.backend.hashes.get(key).set(field, String(value));
    }

    async hdel(key, field) {
        this.backend.hashes.get(key)?.delete(field);
    }

    async hgetall(key) {
        return Object.fromEntries(this.backend.hashes.get(key) || []);
    }

    // Asynchronous delivery, like Redis pub/sub
    async publish(channel, message) {
        setImmediate(() => this.backend.bus.emit(channel, message));
    }

    async subscribe(channel, handler) {
        const listener = (message) => handler(message);
        this.backend.bus.on(channel, listener);
        this.listeners.push([channel, listener]);
    }

    async close() {
        for (const [channel, listener] of this.listeners) {
            this.backend.bus.off(channel, listener);
        }
        this.listeners = [];
    }
}

module.exports = { MemoryStore, MemoryBackend };
