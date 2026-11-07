'use strict';

require('should');
const mediasoup = require('mediasoup');

const config = require('../app/src/config');
const Room = require('../app/src/Room');
const Peer = require('../app/src/Peer');
const Host = require('../app/src/Host');
const { getRoutedRoomId, getPlacementRoomId, describeRoom, shareHostLogins } = require('../app/src/ScalingAdapter');
const {
    createScaling,
    normalizeConfig,
    WorkerLoad,
    RoomRouterPool,
    ClusterNode,
    MemoryStore,
    MemoryBackend,
} = require('../app/src/scaling');

const mediaCodecs = config.mediasoup.router.mediaCodecs;

const OPUS_RTP_PARAMETERS = {
    mid: '0',
    codecs: [{ mimeType: 'audio/opus', payloadType: 111, clockRate: 48000, channels: 2 }],
    encodings: [{ ssrc: 11111111 }],
};

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

function makeIo() {
    return { to: () => ({ emit: () => {} }), in: () => ({ disconnectSockets: () => {} }) };
}

function makePeer(id) {
    return new Peer(id, {
        peer_info: { peer_id: id, peer_uuid: `${id}-uuid`, peer_name: id, peer_audio: true, peer_video: false },
    });
}

describe('test-Scaling', function () {
    this.timeout(20000);

    describe('disabled (default)', () => {
        it('normalizes an empty config to everything disabled', () => {
            const cfg = normalizeConfig(undefined);
            cfg.multiWorkerRooms.enabled.should.be.false();
            cfg.multiWorkerRooms.maxPeersPerRouter.should.equal(20);
            cfg.cluster.enabled.should.be.false();
            cfg.cluster.nodeTtl.should.equal(15);
        });

        it('is a pass-through: no router pool, default worker selection, local rooms', async () => {
            const scaling = createScaling();
            scaling.setWorkers([{ pid: 1 }, { pid: 2 }]);
            (scaling.pickWorker() === null).should.be.true();
            (scaling.createRoomRouterPool('room', mediaCodecs) === null).should.be.true();
            (await scaling.start()).should.be.false();
            (await scaling.resolveRoom('room')).should.deepEqual({ local: true });
            (await scaling.claimRoom('room')).should.deepEqual({ local: true });
            (await scaling.isRoomActive('room')).should.be.false();
            (await scaling.getRemoteRooms()).should.deepEqual([]);
            (await scaling.requestAll('getMeetings')).should.deepEqual([]);
            ((await scaling.requestRoomOwner('room', 'endMeeting')) === null).should.be.true();
            ((await scaling.getRoomNodeUrl('room')) === null).should.be.true();

            let nextCalled = false;
            const getRoomId = () => 'room';
            await scaling.createRoutingMiddleware({ getRoomId })({ method: 'GET', path: '/join/room' }, {}, () => {
                nextCalled = true;
            });
            nextCalled.should.be.true();
        });

        it('does not start the cluster without a node URL', async () => {
            const scaling = createScaling({ cluster: { enabled: true } }, { store: new MemoryStore() });
            (await scaling.start()).should.be.false();
            scaling.clusterEnabled.should.be.false();
        });
    });

    describe('MiroTalk adapter (ScalingAdapter)', () => {
        it('extracts the room of every routed entry point', () => {
            getRoutedRoomId({ method: 'GET', path: '/join/abc' }).should.equal('abc');
            getRoutedRoomId({ method: 'GET', path: '/join', query: { room: 'q' } }).should.equal('q');
            getRoutedRoomId({ method: 'GET', path: '/whoAreYou/w%20x' }).should.equal('w x');
            getRoutedRoomId({ method: 'POST', path: '/whip/live' }).should.equal('live');
        });

        it('ignores everything else', () => {
            (getRoutedRoomId({ method: 'GET', path: '/' }) === null).should.be.true();
            (getRoutedRoomId({ method: 'GET', path: '/join', query: {} }) === null).should.be.true();
            (getRoutedRoomId({ method: 'PATCH', path: '/whip/live/session' }) === null).should.be.true();
            (getRoutedRoomId({ method: 'POST', path: '/whip/live/session' }) === null).should.be.true();
            (getRoutedRoomId({ method: 'GET', path: '/join/%E0%A4%A' }) === null).should.be.true();
        });

        it('groups breakout rooms with their main room and describes rooms', () => {
            getPlacementRoomId('main_breakout_2').should.equal('main');
            getPlacementRoomId('main').should.equal('main');
            describeRoom({ getPeersCount: () => 4, isBroadcasting: () => true }).should.deepEqual({
                peers: 4,
                broadcasting: true,
            });
        });
    });

    describe('WorkerLoad', () => {
        it('picks the worker with the fewest peers, then the fewest routers', () => {
            const w1 = { pid: 1 };
            const w2 = { pid: 2 };
            const load = new WorkerLoad();
            load.setWorkers([w1, w2]);
            load.addRouter(w1);
            load.getLeastLoaded().should.equal(w2);
            load.addRouter(w2);
            load.addPeer(w2);
            load.getLeastLoaded().should.equal(w1);
            load.getLeastLoaded(new Set([w1])).should.equal(w2);
            (load.getLeastLoaded(new Set([w1, w2])) === null).should.be.true();
        });
    });

    describe('Phase 1 - multi-worker rooms (pipeToRouter)', () => {
        let workers;
        let workerLoad;

        before(async () => {
            workers = await Promise.all([
                mediasoup.createWorker({ logLevel: 'error' }),
                mediasoup.createWorker({ logLevel: 'error' }),
            ]);
        });

        after(() => workers.forEach((worker) => !worker.closed && worker.close()));

        beforeEach(() => {
            workerLoad = new WorkerLoad();
            workerLoad.setWorkers(workers);
        });

        const createPool = async (maxPeersPerRouter = 1) => {
            const pool = new RoomRouterPool({ roomId: 'pool-room', workerLoad, mediaCodecs, maxPeersPerRouter });
            pool.setMainRouter(await workers[0].createRouter({ mediaCodecs }), workers[0]);
            return pool;
        };

        it('fills the main router first, then spills onto the least loaded unused worker', async () => {
            const pool = await createPool(1);
            const r1 = await pool.assignPeer('p1');
            const r2 = await pool.assignPeer('p2');
            r1.should.equal(pool.main);
            r2.should.not.equal(pool.main);
            pool.getStats()
                .routers.map((r) => r.worker_pid)
                .should.deepEqual([workers[0].pid, workers[1].pid]);

            // Every worker already serves this room: overflow onto the least crowded router
            const r3 = await pool.assignPeer('p3');
            pool.getRouters().should.have.length(2);
            [r1, r2].should.containEql(r3);

            // Same peer, same router
            (await pool.assignPeer('p1')).should.equal(r1);
            workerLoad
                .getStats()
                .reduce((total, w) => total + w.peers, 0)
                .should.equal(3);

            pool.main.close();
            pool.close();
            workerLoad
                .getStats()
                .reduce((total, w) => total + w.peers, 0)
                .should.equal(0);
        });

        it('assigns concurrent peers without opening extra routers', async () => {
            const pool = await createPool(2);
            await Promise.all(['a', 'b', 'c', 'd'].map((id) => pool.assignPeer(id)));
            pool.getRouters().should.have.length(2);
            pool.main.close();
            pool.close();
        });

        it('pipes a producer once and closes empty overflow routers', async () => {
            const pool = await createPool(1);
            const main = await pool.assignPeer('producer-peer');
            const overflow = await pool.assignPeer('consumer-peer');

            const transport = await main.createPlainTransport({ listenInfo: { protocol: 'udp', ip: '127.0.0.1' } });
            const producer = await transport.produce({ kind: 'audio', rtpParameters: OPUS_RTP_PARAMETERS });

            overflow.canConsume({ producerId: producer.id, rtpCapabilities: main.rtpCapabilities }).should.be.false();
            await pool.pipeProducer(producer.id, main, overflow);
            await pool.pipeProducer(producer.id, main, overflow); // cached, no "already exists" error
            overflow.canConsume({ producerId: producer.id, rtpCapabilities: main.rtpCapabilities }).should.be.true();
            pool.getStats().pipes.should.equal(1);

            // Closing the source producer drops the piped copy from the cache (worker notification)
            producer.close();
            for (let i = 0; i < 50 && pool.getStats().pipes > 0; i++) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            pool.getStats().pipes.should.equal(0);

            pool.releasePeer('consumer-peer');
            overflow.closed.should.be.true();
            pool.getRouters().should.deepEqual([main]);

            pool.releasePeer('producer-peer');
            main.closed.should.be.false(); // The main router belongs to the Room
            main.close();
        });

        describe('Room integration', () => {
            let room;

            const createRoom = async () => {
                const routerPool = new RoomRouterPool({
                    roomId: 'scaled-room',
                    workerLoad,
                    mediaCodecs,
                    maxPeersPerRouter: 1,
                });
                const r = await new Room('scaled-room', workers[0], makeIo(), { routerPool }).ready();
                r.webRtcServerActive = false;
                r.webRtcTransport = { listenInfos: [{ protocol: 'udp', ip: '127.0.0.1' }], iceConsentTimeout: 35 };
                return r;
            };

            const join = async (id) => {
                room.addPeer(makePeer(id));
                const { id: transportId } = await room.createWebRtcTransport(id);
                return transportId;
            };

            beforeEach(async () => {
                room = await createRoom();
            });

            afterEach(() => room.close());

            it('lets peers on different workers consume each other', async () => {
                const aliceTransport = await join('alice');
                const bobTransport = await join('bob');

                room.getPeerRouter('alice').should.equal(room.router);
                room.getPeerRouter('bob').should.not.equal(room.router);

                const producerId = await room.produce(
                    'alice',
                    aliceTransport,
                    OPUS_RTP_PARAMETERS,
                    'audio',
                    'audioType'
                );
                const params = await room.consume(
                    'bob',
                    bobTransport,
                    producerId,
                    room.router.rtpCapabilities,
                    'audioType'
                );
                params.producerId.should.equal(producerId);

                // Bob's audio lives on the overflow router, the observers on the main one
                const bobProducerId = await room.produce(
                    'bob',
                    bobTransport,
                    OPUS_RTP_PARAMETERS,
                    'audio',
                    'audioType'
                );
                await room.addProducerToAudioLevelObserver({ producerId: bobProducerId });
                room.routerPool.pipes.has(`producerId:${bobProducerId}:${room.router.id}`).should.be.true();
            });

            it('pipes data producers for data channel consumers', async () => {
                const aliceTransport = await join('alice');
                const bobTransport = await join('bob');

                const dataProducerId = await room.produceData(
                    'alice',
                    aliceTransport,
                    { streamId: 0, ordered: true },
                    'chat',
                    '',
                    {}
                );
                const params = await room.consumeData('bob', bobTransport, dataProducerId);
                params.dataProducerId.should.equal(dataProducerId);
            });

            it('reports a closed producer as not found when routing it', async () => {
                const aliceTransport = await join('alice');
                const bobTransport = await join('bob');
                const producerId = await room.produce(
                    'alice',
                    aliceTransport,
                    OPUS_RTP_PARAMETERS,
                    'audio',
                    'audioType'
                );
                room.closeProducer('alice', producerId);

                await room
                    .consume('bob', bobTransport, producerId, room.router.rtpCapabilities, 'audioType')
                    .should.be.rejectedWith({ code: 'PRODUCER_NOT_FOUND' });
            });

            it('frees the overflow router when its last peer leaves', async () => {
                await join('alice');
                await join('bob');
                const overflow = room.getPeerRouter('bob');
                room.removePeer('bob');
                overflow.closed.should.be.true();
                room.getRouterStats().routers.should.have.length(1);
            });
        });
    });

    describe('Phase 2 - cluster (room per node)', () => {
        let backend;
        let nodes;

        const createNode = async (id, rooms = new Map(), rpcHandlers = {}, extra = {}) => {
            const node = new ClusterNode({
                store: new MemoryStore(backend),
                nodeId: id,
                nodeUrl: `https://${id}.example.com`,
                heartbeatIntervalMs: 60000,
                ...extra,
            });
            await node.start({ getLocalRooms: () => rooms, rpcHandlers, getPlacementRoomId, describeRoom });
            nodes.push(node);
            return node;
        };

        const fakeRoom = (peers) => ({ getPeersCount: () => peers, isBroadcasting: () => false });

        beforeEach(() => {
            backend = new MemoryBackend();
            nodes = [];
        });

        afterEach(async () => {
            await Promise.all(nodes.map((node) => node.stop()));
        });

        it('places new rooms on the least loaded node and keeps them there', async () => {
            const roomsA = new Map([['busy', fakeRoom(10)]]);
            const a = await createNode('a', roomsA);
            const b = await createNode('b');

            const placement = await a.resolveRoom('fresh');
            placement.should.deepEqual({ local: false, nodeId: 'b', url: 'https://b.example.com' });
            (await b.resolveRoom('fresh')).local.should.be.true();
            (await a.claimRoom('fresh')).url.should.equal('https://b.example.com');
            (await a.resolveRoom('busy')).local.should.be.true();
        });

        it('keeps breakout rooms on the node of their main room', async () => {
            const a = await createNode('a', new Map([['main', fakeRoom(50)]]));
            const b = await createNode('b');
            (await b.resolveRoom('main_breakout_1')).nodeId.should.equal('a');
        });

        it('skips nodes above their own maxPeersPerNode and prefers itself on ties', async () => {
            // a: 5 peers, full (limit 5) | b: 8 peers, no limit -> b despite being more loaded
            const a = await createNode('a', new Map([['r', fakeRoom(5)]]), {}, { maxPeersPerNode: 5 });
            await createNode('b', new Map([['s', fakeRoom(8)]]));
            (await a.resolveRoom('x')).nodeId.should.equal('b');

            const c = await createNode('c');
            const d = await createNode('d');
            (await c.pickNode()).should.equal('c');
            (await d.pickNode()).should.equal('d');
        });

        it('falls back to the least loaded node when every node is full', async () => {
            const a = await createNode('a', new Map([['r', fakeRoom(9)]]), {}, { maxPeersPerNode: 5 });
            await createNode('b', new Map([['s', fakeRoom(6)]]), {}, { maxPeersPerNode: 5 });
            (await a.pickNode()).should.equal('b');
        });

        it('takes over the rooms of a node that left the cluster', async () => {
            const a = await createNode('a', new Map([['busy', fakeRoom(10)]]));
            const b = await createNode('b');
            (await a.resolveRoom('fresh')).nodeId.should.equal('b');
            await b.stop();
            (await a.resolveRoom('fresh')).local.should.be.true();
        });

        it('releases a closed room on the next heartbeat', async () => {
            const rooms = new Map([['temp', fakeRoom(1)]]);
            const a = await createNode('a', rooms);
            const b = await createNode('b');
            (await b.resolveRoom('temp')).nodeId.should.equal('a');
            rooms.delete('temp');
            await a.heartbeat();
            (await backend.kv.has('mediasoup-scaling:room:temp')).should.be.false();
        });

        it('lists remote rooms and answers RPC requests', async () => {
            const a = await createNode('a');
            await createNode('b', new Map([['remote', fakeRoom(3)]]), {
                getMeetings: () => [{ roomId: 'remote', peers: [] }],
                endMeeting: ({ room }) => ({ success: true, room }),
            });

            (await a.getRemoteRooms()).should.deepEqual([
                { id: 'remote', peers: 3, broadcasting: false, nodeId: 'b', nodeUrl: 'https://b.example.com' },
            ]);
            (await a.isRoomActive('remote')).should.be.true();
            (await a.isRoomActive('nope')).should.be.false();

            (await a.requestAll('getMeetings')).should.deepEqual([
                { nodeId: 'b', result: [{ roomId: 'remote', peers: [] }] },
            ]);
            (await a.requestRoomOwner('remote', 'endMeeting', { room: 'remote' })).should.deepEqual({
                nodeId: 'b',
                result: { success: true, room: 'remote' },
            });
            ((await a.requestRoomOwner('unknown', 'endMeeting', {})) === null).should.be.true();
            await a.request('b', 'missing').should.be.rejectedWith(/Unknown cluster request/);
        });

        it('replicates a shared set to every node, including late joiners', async () => {
            const a = await createNode('a');
            const b = await createNode('b');
            const events = [];
            const setA = await a.createSharedSet('banned');
            await b.createSharedSet('banned', {
                onAdd: (item) => events.push(['add', item]),
                onRemove: (item) => events.push(['remove', item]),
            });

            setA.add('user-1');
            setA.add('user-2');
            setA.remove('user-1');
            await nextTick();
            await nextTick();
            events.should.deepEqual([
                ['add', 'user-1'],
                ['add', 'user-2'],
                ['remove', 'user-1'],
            ]);

            const c = await createNode('c');
            const loaded = [];
            await c.createSharedSet('banned', { onAdd: (item) => loaded.push(item) });
            loaded.should.deepEqual(['user-2']);
        });

        describe('Scaling facade', () => {
            const createScalingNode = async (id, rooms, store = new MemoryStore(backend)) => {
                const scaling = createScaling(
                    { cluster: { enabled: true, nodeId: id, nodeUrl: `https://${id}.example.com/` } },
                    { store }
                );
                (await scaling.start({ getLocalRooms: () => rooms })).should.be.true();
                nodes.push({ stop: () => scaling.stop() });
                return scaling;
            };

            it('redirects room entry points to the hosting node, keeping path and query', async () => {
                await createScalingNode('a', new Map([['meet', fakeRoom(2)]]));
                const b = await createScalingNode('b', new Map());

                let redirect;
                const res = { redirect: (status, url) => (redirect = { status, url }) };
                const middleware = b.createRoutingMiddleware({
                    getRoomId: getRoutedRoomId,
                    isValidRoomName: (room) => room !== 'bad',
                });

                await middleware(
                    { method: 'GET', path: '/join', query: { room: 'meet' }, originalUrl: '/join?room=meet&name=x' },
                    res,
                    () => {}
                );
                redirect.should.deepEqual({ status: 302, url: 'https://a.example.com/join?room=meet&name=x' });

                await middleware({ method: 'POST', path: '/whip/meet', originalUrl: '/whip/meet' }, res, () => {});
                redirect.should.deepEqual({ status: 307, url: 'https://a.example.com/whip/meet' });

                let nextCalls = 0;
                await middleware(
                    { method: 'GET', path: '/join/bad', originalUrl: '/join/bad' },
                    res,
                    () => nextCalls++
                );
                await middleware(
                    { method: 'GET', path: '/join/fresh', originalUrl: '/join/fresh' },
                    res,
                    () => nextCalls++
                );
                nextCalls.should.equal(2); // invalid room + room placed on this (least loaded) node

                (await b.getRoomNodeUrl('meet')).should.equal('https://a.example.com');
            });

            it('shares MiroTalk host protection logins and logouts (adapter)', async () => {
                const a = await createScalingNode('a', new Map());
                const b = await createScalingNode('b', new Map());
                const hostA = new Host();
                const hostB = new Host();
                const hostCfgB = { protected: true, authenticated: false };
                (await shareHostLogins(a, hostA, { protected: true })).should.be.true();
                (await shareHostLogins(b, hostB, hostCfgB)).should.be.true();

                hostA.setAuthorizedIP('1.2.3.4', true);
                await nextTick();
                await nextTick();
                hostB.isAuthorizedIP('1.2.3.4').should.be.true();
                hostCfgB.authenticated.should.be.true();

                hostA.deleteIP('1.2.3.4');
                await nextTick();
                await nextTick();
                hostB.isAuthorizedIP('1.2.3.4').should.be.false();
                hostCfgB.authenticated.should.be.false();

                // Cluster off: nothing is wrapped
                const standalone = new Host();
                const original = standalone.setAuthorizedIP;
                (await shareHostLogins(createScaling(), standalone, {})).should.be.false();
                standalone.setAuthorizedIP.should.equal(original);
            });

            it('serves rooms locally when Redis becomes unreachable', async () => {
                const store = new MemoryStore(backend);
                const scaling = await createScalingNode('a', new Map(), store);
                store.get = async () => {
                    throw new Error('ECONNREFUSED');
                };
                (await scaling.resolveRoom('any')).should.deepEqual({ local: true });
                (await scaling.isRoomActive('any')).should.be.false();
            });
        });
    });
});
