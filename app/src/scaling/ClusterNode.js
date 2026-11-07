'use strict';

const { randomUUID } = require('crypto');

const SHARED_SET_TTL_MS = 24 * 60 * 60 * 1000;
const RPC_TIMEOUT_MS = 3000;

// Default room description in the node snapshot: works with Map/Set based rooms
const defaultDescribeRoom = (room) => ({ peers: room?.getPeersCount?.() ?? room?.peers?.size ?? 0 });

/**
 * Phase 2 - several SFU nodes, every room hosted entirely by one node.
 *
 * Redis keys (prefix = keyPrefix):
 *   <prefix>:nodes               set of node ids
 *   <prefix>:node:<nodeId>       JSON snapshot { id, url, peers, rooms[] }, expires after nodeTtl (heartbeat)
 *   <prefix>:room:<roomId>       owner node id (reservation, then refreshed by the owner heartbeat)
 *   <prefix>:set:<name>          shared sets replicated to every node (createSharedSet)
 * Channels:
 *   <prefix>:rpc:<nodeId>        requests to one node (handlers given to start())
 *   <prefix>:rpc-reply:<nodeId>  replies to the requesting node
 *   <prefix>:set:<name>          shared set add/remove events
 */
module.exports = class ClusterNode {
    constructor({
        store,
        nodeId,
        nodeUrl,
        keyPrefix = 'mediasoup-scaling',
        heartbeatIntervalMs = 5000,
        nodeTtlMs = 15000,
        roomReservationTtlMs = 600000,
        maxPeersPerNode = 0,
        log,
    }) {
        this.store = store;
        this.nodeId = nodeId;
        this.nodeUrl = nodeUrl;
        this.prefix = keyPrefix;
        this.heartbeatIntervalMs = heartbeatIntervalMs;
        this.nodeTtlMs = nodeTtlMs;
        this.roomReservationTtlMs = roomReservationTtlMs;
        this.maxPeersPerNode = maxPeersPerNode;
        this.log = log;

        this.getLocalRooms = () => new Map();
        this.describeRoom = defaultDescribeRoom;
        this.getPlacementRoomId = (roomId) => roomId;
        this.rpcHandlers = {};
        this.ownedRooms = new Set();
        this.pendingRequests = new Map();
        this.startedAt = Date.now();
        this.timer = null;
        this.started = false;
        this.draining = false;
    }

    // ####################################################
    // KEYS
    // ####################################################

    get nodesKey() {
        return `${this.prefix}:nodes`;
    }

    get nodeKeyPrefix() {
        return `${this.prefix}:node:`;
    }

    nodeKey(nodeId) {
        return `${this.nodeKeyPrefix}${nodeId}`;
    }

    roomKey(roomId) {
        return `${this.prefix}:room:${roomId}`;
    }

    rpcChannel(nodeId) {
        return `${this.prefix}:rpc:${nodeId}`;
    }

    replyChannel(nodeId) {
        return `${this.prefix}:rpc-reply:${nodeId}`;
    }

    sharedSetKey(name) {
        return `${this.prefix}:set:${name}`;
    }

    // ####################################################
    // LIFECYCLE
    // ####################################################

    /**
     * @param {object} options
     * @param {() => Map} options.getLocalRooms                Rooms hosted by this node (roomId -> room)
     * @param {(room) => object} [options.describeRoom]        Room info for the snapshot, must include { peers }
     * @param {(roomId) => string} [options.getPlacementRoomId] Rooms sharing a placement id live on the same node
     * @param {object} [options.rpcHandlers]                   { type: async (payload) => result }
     */
    async start({ getLocalRooms, describeRoom, getPlacementRoomId, rpcHandlers = {} } = {}) {
        if (getLocalRooms) this.getLocalRooms = getLocalRooms;
        if (describeRoom) this.describeRoom = describeRoom;
        if (getPlacementRoomId) this.getPlacementRoomId = getPlacementRoomId;
        this.rpcHandlers = rpcHandlers;

        await this.store.connect();
        await this.store.subscribe(this.rpcChannel(this.nodeId), (message) => this.onRpcRequest(message));
        await this.store.subscribe(this.replyChannel(this.nodeId), (message) => this.onRpcReply(message));

        await this.heartbeat();
        this.timer = setInterval(() => {
            this.heartbeat().catch((error) => this.log?.warn('Cluster heartbeat failed', error.message));
        }, this.heartbeatIntervalMs);
        this.timer.unref?.();
        this.started = true;

        this.log?.info('Cluster node started', { node_id: this.nodeId, node_url: this.nodeUrl });
    }

    // Leaves the cluster: new rooms go to the other nodes, owned rooms are released
    async stop() {
        if (!this.started) return;
        this.started = false;
        this.draining = true;
        clearInterval(this.timer);
        this.timer = null;

        try {
            await Promise.all(
                [...this.ownedRooms].map((roomId) => this.store.release(this.roomKey(roomId), this.nodeId))
            );
            await this.store.del(this.nodeKey(this.nodeId));
            await this.store.srem(this.nodesKey, this.nodeId);
        } catch (error) {
            this.log?.warn('Cluster node cleanup failed', error.message);
        }

        for (const { reject, timer } of this.pendingRequests.values()) {
            clearTimeout(timer);
            reject(new Error('Cluster node stopped'));
        }
        this.pendingRequests.clear();
        this.ownedRooms.clear();

        await this.store.close();
        this.log?.info('Cluster node stopped', { node_id: this.nodeId });
    }

    buildSnapshot() {
        const rooms = [];
        let peers = 0;
        for (const [id, room] of this.getLocalRooms()) {
            const info = { ...this.describeRoom(room), id };
            info.peers = Number(info.peers) || 0;
            peers += info.peers;
            rooms.push(info);
        }
        return {
            id: this.nodeId,
            url: this.nodeUrl,
            peers,
            maxPeers: this.maxPeersPerNode,
            rooms,
            draining: this.draining,
            startedAt: this.startedAt,
            updatedAt: Date.now(),
        };
    }

    async heartbeat() {
        if (this.draining) return;

        const snapshot = this.buildSnapshot();
        await this.store.set(this.nodeKey(this.nodeId), JSON.stringify(snapshot), this.nodeTtlMs);
        await this.store.sadd(this.nodesKey, this.nodeId);

        const current = new Set(snapshot.rooms.map((room) => room.id));

        await Promise.all(
            [...current].map(async (roomId) => {
                const owner = await this.store.claim(
                    this.roomKey(roomId),
                    this.nodeId,
                    this.nodeTtlMs,
                    this.nodeKeyPrefix
                );
                if (owner !== this.nodeId) {
                    this.log?.warn('Room is also hosted by another cluster node', { room_id: roomId, owner });
                }
            })
        );

        const closed = [...this.ownedRooms].filter((roomId) => !current.has(roomId));
        await Promise.all(closed.map((roomId) => this.store.release(this.roomKey(roomId), this.nodeId)));

        this.ownedRooms = current;
        return snapshot;
    }

    // ####################################################
    // NODES
    // ####################################################

    async getAliveNodes() {
        const ids = await this.store.smembers(this.nodesKey);
        if (!ids.length) return [];
        const values = await this.store.mget(ids.map((id) => this.nodeKey(id)));
        const nodes = [];
        values.forEach((value, index) => {
            if (!value) {
                // Expired (crashed / stopped) node
                this.store.srem(this.nodesKey, ids[index]).catch(() => {});
                return;
            }
            try {
                nodes.push(JSON.parse(value));
            } catch {
                // Ignore malformed snapshots
            }
        });
        return nodes;
    }

    async getNode(nodeId) {
        if (!nodeId) return null;
        const value = await this.store.get(this.nodeKey(nodeId));
        if (!value) return null;
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }

    // Least loaded node accepting new rooms (each node announces its own maxPeers), this node wins ties.
    // When every node is full the least loaded one still gets the room.
    async pickNode() {
        const candidates = (await this.getAliveNodes()).filter((node) => !node.draining && node.url);
        const available = candidates.filter((node) => !node.maxPeers || node.peers < node.maxPeers);
        const nodes = available.length ? available : candidates;
        if (!nodes.length) return this.nodeId;
        nodes.sort(
            (a, b) =>
                a.peers - b.peers ||
                (a.rooms?.length || 0) - (b.rooms?.length || 0) ||
                (a.id === this.nodeId ? -1 : b.id === this.nodeId ? 1 : 0)
        );
        return nodes[0].id;
    }

    // ####################################################
    // ROOMS
    // ####################################################

    local() {
        return { local: true, nodeId: this.nodeId, url: this.nodeUrl };
    }

    remote(node) {
        if (!node?.url) return null;
        return { local: false, nodeId: node.id, url: node.url };
    }

    // Where should an HTTP request for this room be served? Places the room if nobody hosts it yet.
    async resolveRoom(roomId) {
        if (this.getLocalRooms().has(roomId)) return this.local();

        const owner = await this.store.get(this.roomKey(roomId));
        if (owner === this.nodeId) return this.local();
        if (owner) {
            const placement = this.remote(await this.getNode(owner));
            if (placement) return placement;
        }

        // Rooms grouped under another placement id (e.g. sub-rooms) follow that room's node
        let target = null;
        const placementRoomId = this.getPlacementRoomId(roomId);
        if (placementRoomId && placementRoomId !== roomId) {
            const groupOwner = await this.store.get(this.roomKey(placementRoomId));
            if (groupOwner && (groupOwner === this.nodeId || (await this.getNode(groupOwner)))) target = groupOwner;
        }
        if (!target) target = await this.pickNode();

        const winner = await this.store.claim(
            this.roomKey(roomId),
            target,
            this.roomReservationTtlMs,
            this.nodeKeyPrefix
        );
        if (winner === this.nodeId) return this.local();
        return this.remote(await this.getNode(winner)) || this.local();
    }

    // Called right before this node creates the room (socket 'createRoom')
    async claimRoom(roomId) {
        if (this.getLocalRooms().has(roomId)) return this.local();
        const winner = await this.store.claim(
            this.roomKey(roomId),
            this.nodeId,
            this.roomReservationTtlMs,
            this.nodeKeyPrefix
        );
        if (winner === this.nodeId) return this.local();
        return this.remote(await this.getNode(winner)) || this.local();
    }

    // Rooms hosted by the other alive nodes (from their last heartbeat)
    async getRemoteRooms() {
        const nodes = await this.getAliveNodes();
        return nodes
            .filter((node) => node.id !== this.nodeId)
            .flatMap((node) => (node.rooms || []).map((room) => ({ ...room, nodeId: node.id, nodeUrl: node.url })));
    }

    async isRoomActive(roomId) {
        if (this.getLocalRooms().has(roomId)) return true;
        return (await this.getRemoteRooms()).some((room) => room.id === roomId);
    }

    // Alive node owning the room (reserved or hosted), it answers authoritatively for it
    async getRoomNode(roomId) {
        const owner = await this.store.get(this.roomKey(roomId));
        if (!owner || owner === this.nodeId) return null;
        return this.getNode(owner);
    }

    // ####################################################
    // RPC
    // ####################################################

    request(nodeId, type, payload = {}, timeoutMs = RPC_TIMEOUT_MS) {
        const id = randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Cluster request '${type}' to ${nodeId} timed out`));
            }, timeoutMs);
            this.pendingRequests.set(id, { resolve, reject, timer });
            this.store
                .publish(this.rpcChannel(nodeId), JSON.stringify({ id, from: this.nodeId, type, payload }))
                .catch((error) => {
                    clearTimeout(timer);
                    this.pendingRequests.delete(id);
                    reject(error);
                });
        });
    }

    async onRpcRequest(message) {
        let request;
        try {
            request = JSON.parse(message);
        } catch {
            return;
        }
        const { id, from, type, payload } = request || {};
        if (!id || !from) return;

        const reply = { id };
        try {
            const handler = this.rpcHandlers[type];
            if (typeof handler !== 'function') throw new Error(`Unknown cluster request '${type}'`);
            reply.result = await handler(payload || {});
        } catch (error) {
            reply.error = error.message;
        }
        await this.store.publish(this.replyChannel(from), JSON.stringify(reply)).catch(() => {});
    }

    onRpcReply(message) {
        let reply;
        try {
            reply = JSON.parse(message);
        } catch {
            return;
        }
        const pending = this.pendingRequests.get(reply?.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingRequests.delete(reply.id);
        reply.error ? pending.reject(new Error(reply.error)) : pending.resolve(reply.result);
    }

    // Same request to every other alive node, unreachable nodes are skipped
    async requestAll(type, payload = {}) {
        const nodes = (await this.getAliveNodes()).filter((node) => node.id !== this.nodeId);
        const results = await Promise.allSettled(nodes.map((node) => this.request(node.id, type, payload)));
        return results
            .map((result, index) => ({ nodeId: nodes[index].id, ...result }))
            .filter((result) => {
                if (result.status === 'rejected') {
                    this.log?.warn('Cluster request failed', {
                        node_id: result.nodeId,
                        type,
                        error: result.reason?.message,
                    });
                    return false;
                }
                return true;
            })
            .map(({ nodeId, value }) => ({ nodeId, result: value }));
    }

    async requestRoomOwner(roomId, type, payload = {}) {
        const node = await this.getRoomNode(roomId);
        if (!node) return null;
        return { nodeId: node.id, result: await this.request(node.id, type, payload) };
    }

    // ####################################################
    // SHARED SETS (e.g. logged-in hosts, banned users)
    // ####################################################

    /**
     * A set of string keys replicated to every node. Local changes go through the returned
     * add()/remove(); changes made on the other nodes (and the keys already present at startup)
     * are delivered to onAdd/onRemove. Keys expire after ttlMs without changes to the set.
     */
    async createSharedSet(name, { onAdd, onRemove, ttlMs = SHARED_SET_TTL_MS } = {}) {
        const key = this.sharedSetKey(name);

        const share = (op, item) => {
            const write = op === 'add' ? this.store.hset(key, item, '1', ttlMs) : this.store.hdel(key, item);
            Promise.all([write, this.store.publish(key, JSON.stringify({ op, item, from: this.nodeId }))]).catch(
                (error) => this.log?.warn('Shared set replication failed', { name, error: error.message })
            );
        };

        await this.store.subscribe(key, (message) => {
            let event;
            try {
                event = JSON.parse(message);
            } catch {
                return;
            }
            if (typeof event?.item !== 'string' || event.from === this.nodeId) return;
            if (event.op === 'add') onAdd?.(event.item);
            else if (event.op === 'remove') onRemove?.(event.item);
        });

        for (const item of Object.keys((await this.store.hgetall(key)) || {})) onAdd?.(item);

        return {
            add: (item) => share('add', String(item)),
            remove: (item) => share('remove', String(item)),
        };
    }

    getStatus() {
        return {
            nodeId: this.nodeId,
            nodeUrl: this.nodeUrl,
            started: this.started,
            ownedRooms: this.ownedRooms.size,
        };
    }
};
