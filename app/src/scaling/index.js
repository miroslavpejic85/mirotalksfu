'use strict';

const os = require('os');
const WorkerLoad = require('./WorkerLoad');
const RoomRouterPool = require('./RoomRouterPool');
const ClusterNode = require('./ClusterNode');
const { MemoryStore, MemoryBackend } = require('./MemoryStore');

/**
 * Horizontal scaling for mediasoup v3 SFUs (optional, everything is disabled by default).
 * Framework and app independent: the host app only passes plain config and callbacks.
 *
 *   multiWorkerRooms.enabled -> Phase 1: one room spread over several mediasoup workers (pipeToRouter)
 *   cluster.enabled          -> Phase 2: several nodes behind Redis, each room hosted by one node
 *
 * With both disabled every method is a no-op / pass-through, so the app behaves exactly as before.
 */

function positiveInt(value, fallback) {
    const parsed = parseInt(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeConfig(cfg = {}) {
    const multiWorker = cfg?.multiWorkerRooms || {};
    const cluster = cfg?.cluster || {};
    return {
        multiWorkerRooms: {
            enabled: multiWorker.enabled === true,
            maxPeersPerRouter: positiveInt(multiWorker.maxPeersPerRouter, 20),
        },
        cluster: {
            enabled: cluster.enabled === true,
            redisUrl: cluster.redisUrl || 'redis://localhost:6379',
            nodeId: cluster.nodeId || `${os.hostname()}-${process.pid}`,
            nodeUrl: String(cluster.nodeUrl || '').replace(/\/+$/, ''),
            keyPrefix: cluster.keyPrefix || 'mediasoup-scaling',
            heartbeatInterval: positiveInt(cluster.heartbeatInterval, 5),
            nodeTtl: positiveInt(cluster.nodeTtl, 15),
            roomReservationTtl: positiveInt(cluster.roomReservationTtl, 600),
            maxPeersPerNode: Math.max(0, parseInt(cluster.maxPeersPerNode) || 0),
        },
    };
}

class Scaling {
    constructor(cfg = {}, { log = null, store = null } = {}) {
        this.config = normalizeConfig(cfg);
        this.log = log;
        this.store = store; // Optional injected store (tests), RedisStore otherwise
        this.workerLoad = new WorkerLoad();
        this.cluster = null;
    }

    get multiWorkerRoomsEnabled() {
        return this.config.multiWorkerRooms.enabled;
    }

    get clusterEnabled() {
        return Boolean(this.cluster?.started);
    }

    // ####################################################
    // PHASE 1 - MULTI-WORKER ROOMS
    // ####################################################

    setWorkers(workers) {
        this.workerLoad.setWorkers(workers);
    }

    // Least loaded worker for a new room, null = keep the default round-robin
    pickWorker() {
        if (!this.multiWorkerRoomsEnabled) return null;
        return this.workerLoad.getLeastLoaded();
    }

    createRoomRouterPool(roomId, mediaCodecs) {
        if (!this.multiWorkerRoomsEnabled) return null;
        return new RoomRouterPool({
            roomId,
            workerLoad: this.workerLoad,
            mediaCodecs,
            maxPeersPerRouter: this.config.multiWorkerRooms.maxPeersPerRouter,
            log: this.log || undefined,
        });
    }

    // ####################################################
    // PHASE 2 - CLUSTER
    // ####################################################

    // Never throws: on failure the node keeps serving rooms standalone
    async start(options = {}) {
        const cfg = this.config.cluster;
        if (!cfg.enabled) return false;

        if (!cfg.nodeUrl) {
            this.log?.error('SCALING_CLUSTER is enabled but SCALING_NODE_URL is empty: cluster mode disabled');
            return false;
        }

        let store = this.store;
        try {
            if (!store) {
                const RedisStore = require('./RedisStore');
                store = new RedisStore({ url: cfg.redisUrl, log: this.log });
            }
            const cluster = new ClusterNode({
                store,
                nodeId: cfg.nodeId,
                nodeUrl: cfg.nodeUrl,
                keyPrefix: cfg.keyPrefix,
                heartbeatIntervalMs: cfg.heartbeatInterval * 1000,
                nodeTtlMs: cfg.nodeTtl * 1000,
                roomReservationTtlMs: cfg.roomReservationTtl * 1000,
                maxPeersPerNode: cfg.maxPeersPerNode,
                log: this.log,
            });
            await cluster.start(options);
            this.cluster = cluster;
            return true;
        } catch (error) {
            this.log?.error('Cluster start failed, running standalone', error.message);
            try {
                await store?.close();
            } catch {
                // Ignore close errors of a store that never connected
            }
            return false;
        }
    }

    async stop() {
        const cluster = this.cluster;
        this.cluster = null;
        if (cluster) await cluster.stop();
    }

    // Runs a cluster call, falls back to `fallback` (serve locally) if Redis is unreachable
    async safe(fn, fallback) {
        if (!this.clusterEnabled) return fallback;
        try {
            return await fn(this.cluster);
        } catch (error) {
            this.log?.warn('Cluster unavailable, serving locally', error.message);
            return fallback;
        }
    }

    resolveRoom(roomId) {
        return this.safe((cluster) => cluster.resolveRoom(roomId), { local: true });
    }

    claimRoom(roomId) {
        return this.safe((cluster) => cluster.claimRoom(roomId), { local: true });
    }

    isRoomActive(roomId) {
        return this.safe((cluster) => cluster.isRoomActive(roomId), false);
    }

    getRemoteRooms() {
        return this.safe((cluster) => cluster.getRemoteRooms(), []);
    }

    requestAll(type, payload) {
        return this.safe((cluster) => cluster.requestAll(type, payload), []);
    }

    // null when the room is not owned by another node
    requestRoomOwner(roomId, type, payload) {
        return this.safe((cluster) => cluster.requestRoomOwner(roomId, type, payload), null);
    }

    async getRoomNodeUrl(roomId) {
        const node = await this.safe((cluster) => cluster.getRoomNode(roomId), null);
        return node?.url || null;
    }

    // Absolute URL of `path` (path + query) on the node hosting the room, null when it is served here.
    // Framework independent: use it from any HTTP stack to redirect room entry points.
    async getRedirectUrl(roomId, path) {
        const placement = await this.resolveRoom(roomId);
        if (placement.local || !placement.url) return null;
        return new URL(path, placement.url).toString();
    }

    /**
     * Express/Connect middleware redirecting room entry points to the node hosting the room.
     * @param {object} options
     * @param {(req) => string|null} options.getRoomId   Room id when `req` is a room entry point, null otherwise
     * @param {(roomId) => boolean} [options.isValidRoomName]
     */
    createRoutingMiddleware({ getRoomId, isValidRoomName = () => true } = {}) {
        if (typeof getRoomId !== 'function') throw new TypeError('createRoutingMiddleware: getRoomId is required');
        return async (req, res, next) => {
            if (!this.clusterEnabled) return next();
            const roomId = getRoomId(req);
            if (!roomId || !isValidRoomName(roomId)) return next();

            const target = await this.getRedirectUrl(roomId, req.originalUrl || req.url);
            if (!target) return next();

            this.log?.debug('Room hosted by another node, redirecting', { room_id: roomId, target });
            // 307 keeps the method and body of non-GET requests (e.g. WHIP POST)
            return res.redirect(['GET', 'HEAD'].includes(req.method) ? 302 : 307, target);
        };
    }

    // Set replicated to every node (see ClusterNode.createSharedSet), null when the cluster is off
    createSharedSet(name, handlers) {
        return this.safe((cluster) => cluster.createSharedSet(name, handlers), null);
    }

    getStatus() {
        return {
            multiWorkerRooms: {
                enabled: this.multiWorkerRoomsEnabled,
                maxPeersPerRouter: this.config.multiWorkerRooms.maxPeersPerRouter,
                workers: this.workerLoad.getStats(),
            },
            cluster: {
                enabled: this.config.cluster.enabled,
                active: this.clusterEnabled,
                ...(this.cluster ? this.cluster.getStatus() : {}),
            },
        };
    }
}

function createScaling(cfg, options) {
    return new Scaling(cfg, options);
}

module.exports = {
    createScaling,
    normalizeConfig,
    Scaling,
    WorkerLoad,
    RoomRouterPool,
    ClusterNode,
    MemoryStore,
    MemoryBackend,
};
