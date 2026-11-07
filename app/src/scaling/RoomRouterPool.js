'use strict';

const NOOP_LOG = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Phase 1 - one room spread over several mediasoup workers (same host).
 *
 * Every room keeps its "main" router (WHIP, audio level / active speaker observers live there).
 * Peers fill a router up to `maxPeersPerRouter`, then the room spills onto a new router created on
 * the least loaded worker not used by this room yet. Producers and data producers are piped
 * on demand (router.pipeToRouter) to the router of whoever consumes them; the piped copies keep
 * the original ids, so the signaling layer and the clients never notice the split.
 */
module.exports = class RoomRouterPool {
    constructor({ roomId, workerLoad, mediaCodecs, maxPeersPerRouter = 20, log = NOOP_LOG }) {
        this.roomId = roomId;
        this.workerLoad = workerLoad;
        this.mediaCodecs = mediaCodecs;
        this.log = log;
        this.maxPeersPerRouter = Math.max(1, parseInt(maxPeersPerRouter) || 20);
        this.main = null;
        this.entries = new Map(); // router.id -> { router, worker, peers: Set<peerId> }
        this.peerRouter = new Map(); // peerId -> router.id
        this.pipes = new Map(); // `${kind}:${id}:${targetRouterId}` -> Promise
        this.assignQueue = Promise.resolve();
        this.closed = false;
    }

    // Called by Room once its main router exists
    setMainRouter(router, worker) {
        this.main = router;
        this.addEntry(router, worker);
    }

    addEntry(router, worker) {
        const entry = { router, worker, peers: new Set() };
        this.entries.set(router.id, entry);
        this.workerLoad.addRouter(worker);
        router.observer?.once('close', () => this.onRouterClosed(router.id));
        return entry;
    }

    onRouterClosed(routerId) {
        const entry = this.entries.get(routerId);
        if (!entry) return;
        this.entries.delete(routerId);
        this.workerLoad.removeRouter(entry.worker);
        for (const peerId of entry.peers) {
            this.peerRouter.delete(peerId);
            this.workerLoad.removePeer(entry.worker);
        }
        for (const key of [...this.pipes.keys()]) {
            if (key.endsWith(`:${routerId}`)) this.pipes.delete(key);
        }
    }

    // ####################################################
    // PEERS
    // ####################################################

    getPeerRouter(peerId) {
        const entry = this.entries.get(this.peerRouter.get(peerId));
        return entry && !entry.router.closed ? entry.router : null;
    }

    // Serialized, so concurrent joins never open more overflow routers than needed
    assignPeer(peerId) {
        const run = this.assignQueue.then(() => this.doAssignPeer(peerId));
        this.assignQueue = run.catch(() => {});
        return run;
    }

    async doAssignPeer(peerId) {
        const current = this.getPeerRouter(peerId);
        if (current) return current;

        if (this.closed) throw new Error(`Room ${this.roomId} router pool is closed`);

        const entry = this.pickEntry() || (await this.createOverflowEntry()) || this.leastLoadedEntry();
        if (!entry) throw new Error(`No router available for room ${this.roomId}`);

        entry.peers.add(peerId);
        this.peerRouter.set(peerId, entry.router.id);
        this.workerLoad.addPeer(entry.worker);
        return entry.router;
    }

    // First router (main first) that still has room, keeps rooms on as few routers as possible
    pickEntry() {
        for (const entry of this.entries.values()) {
            if (!entry.router.closed && entry.peers.size < this.maxPeersPerRouter) return entry;
        }
        return null;
    }

    async createOverflowEntry() {
        const usedWorkers = new Set([...this.entries.values()].map((entry) => entry.worker));
        const worker = this.workerLoad.getLeastLoaded(usedWorkers);
        if (!worker) return null; // Every worker already serves this room

        const router = await worker.createRouter({
            mediaCodecs: this.mediaCodecs,
            appData: { roomId: this.roomId, webRtcServer: worker.appData?.webRtcServer },
        });

        if (this.closed) {
            router.close();
            return null;
        }

        this.log.info('Room spread over a new mediasoup worker', {
            room_id: this.roomId,
            router_id: router.id,
            worker_pid: worker.pid,
            routers: this.entries.size + 1,
        });

        return this.addEntry(router, worker);
    }

    leastLoadedEntry() {
        let best = null;
        for (const entry of this.entries.values()) {
            if (entry.router.closed) continue;
            if (!best || entry.peers.size < best.peers.size) best = entry;
        }
        return best;
    }

    releasePeer(peerId) {
        const routerId = this.peerRouter.get(peerId);
        if (!routerId) return;
        this.peerRouter.delete(peerId);

        const entry = this.entries.get(routerId);
        if (!entry) return;
        entry.peers.delete(peerId);
        this.workerLoad.removePeer(entry.worker);

        // Free overflow routers as soon as they are empty (pipe transports close with them)
        if (entry.router !== this.main && entry.peers.size === 0) {
            if (!entry.router.closed) entry.router.close();
            this.onRouterClosed(routerId);
        }
    }

    // ####################################################
    // PIPES
    // ####################################################

    pipeProducer(producerId, fromRouter, toRouter) {
        return this.pipe('producerId', producerId, fromRouter, toRouter);
    }

    pipeDataProducer(dataProducerId, fromRouter, toRouter) {
        return this.pipe('dataProducerId', dataProducerId, fromRouter, toRouter);
    }

    async pipe(idField, id, fromRouter, toRouter) {
        if (!id || !fromRouter || !toRouter || fromRouter === toRouter) return;

        const key = `${idField}:${id}:${toRouter.id}`;
        let pending = this.pipes.get(key);

        if (!pending) {
            pending = fromRouter
                .pipeToRouter({ [idField]: id, router: toRouter })
                .then((result) => {
                    const piped = result?.pipeProducer || result?.pipeDataProducer;
                    piped?.observer?.once('close', () => {
                        if (this.pipes.get(key) === pending) this.pipes.delete(key);
                    });
                    this.log.debug('Piped between routers', {
                        room_id: this.roomId,
                        [idField]: id,
                        from: fromRouter.id,
                        to: toRouter.id,
                    });
                    return result;
                })
                .catch((error) => {
                    if (this.pipes.get(key) === pending) this.pipes.delete(key);
                    throw error;
                });
            this.pipes.set(key, pending);
        }

        await pending;
    }

    // ####################################################
    // INFO / CLOSE
    // ####################################################

    getRouters() {
        return [...this.entries.values()].map((entry) => entry.router);
    }

    getStats() {
        return {
            maxPeersPerRouter: this.maxPeersPerRouter,
            pipes: this.pipes.size,
            routers: [...this.entries.values()].map((entry) => ({
                id: entry.router.id,
                main: entry.router === this.main,
                worker_pid: entry.worker?.pid,
                peers: entry.peers.size,
            })),
        };
    }

    // Closes the overflow routers, the main one is closed by the Room itself
    close() {
        this.closed = true;
        for (const entry of [...this.entries.values()]) {
            if (entry.router === this.main) continue;
            if (!entry.router.closed) entry.router.close();
            this.onRouterClosed(entry.router.id);
        }
    }
};
