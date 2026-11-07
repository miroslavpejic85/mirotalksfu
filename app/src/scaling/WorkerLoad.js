'use strict';

/**
 * Tracks how many peers each mediasoup worker currently serves (all rooms included),
 * so new rooms and room overflow routers land on the least loaded worker.
 */
module.exports = class WorkerLoad {
    constructor() {
        this.workers = [];
        this.peers = new Map(); // worker -> peers count
        this.routers = new Map(); // worker -> routers count
    }

    setWorkers(workers = []) {
        this.workers = workers;
        for (const worker of workers) {
            if (!this.peers.has(worker)) this.peers.set(worker, 0);
            if (!this.routers.has(worker)) this.routers.set(worker, 0);
        }
    }

    getWorkers() {
        return this.workers.filter((worker) => !worker.closed);
    }

    addPeer(worker) {
        this.peers.set(worker, (this.peers.get(worker) || 0) + 1);
    }

    removePeer(worker) {
        this.peers.set(worker, Math.max(0, (this.peers.get(worker) || 0) - 1));
    }

    addRouter(worker) {
        this.routers.set(worker, (this.routers.get(worker) || 0) + 1);
    }

    removeRouter(worker) {
        this.routers.set(worker, Math.max(0, (this.routers.get(worker) || 0) - 1));
    }

    getPeers(worker) {
        return this.peers.get(worker) || 0;
    }

    getRouters(worker) {
        return this.routers.get(worker) || 0;
    }

    // Least peers first, then least routers (spreads new empty rooms evenly)
    getLeastLoaded(exclude = new Set()) {
        let best = null;
        for (const worker of this.getWorkers()) {
            if (exclude.has(worker)) continue;
            if (
                !best ||
                this.getPeers(worker) < this.getPeers(best) ||
                (this.getPeers(worker) === this.getPeers(best) && this.getRouters(worker) < this.getRouters(best))
            ) {
                best = worker;
            }
        }
        return best;
    }

    getStats() {
        return this.getWorkers().map((worker) => ({
            pid: worker.pid,
            peers: this.getPeers(worker),
            routers: this.getRouters(worker),
        }));
    }
};
