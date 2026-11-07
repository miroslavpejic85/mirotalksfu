'use strict';

// The scaling module must work in any mediasoup v3 app: no MiroTalk file is required here.

require('should');
const fs = require('fs');
const path = require('path');
const mediasoup = require('mediasoup');

const { createScaling, MemoryStore, MemoryBackend } = require('../app/src/scaling');

const MODULE_DIR = path.join(__dirname, '..', 'app', 'src', 'scaling');
const ALLOWED_PACKAGES = new Set(['os', 'crypto', 'events', 'ioredis']);

const mediaCodecs = [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
];

const OPUS_RTP_PARAMETERS = {
    mid: '0',
    codecs: [{ mimeType: 'audio/opus', payloadType: 100, clockRate: 48000, channels: 2 }],
    encodings: [{ ssrc: 22222222 }],
};

const transportOptions = { listenInfos: [{ protocol: 'udp', ip: '127.0.0.1' }], enableSctp: true };

describe('test-ScalingPortability', function () {
    this.timeout(20000);

    it('only imports its own files, Node built-ins and ioredis', () => {
        const files = fs.readdirSync(MODULE_DIR).filter((file) => file.endsWith('.js'));
        files.length.should.be.above(0);
        for (const file of files) {
            const source = fs.readFileSync(path.join(MODULE_DIR, file), 'utf8');
            for (const [, request] of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
                const ok = request.startsWith('./') ? !request.includes('..') : ALLOWED_PACKAGES.has(request);
                ok.should.equal(true, `${file} requires "${request}"`);
            }
        }
    });

    it('requires an app specific room id matcher for the routing middleware', () => {
        (() => createScaling().createRoutingMiddleware()).should.throw(/getRoomId is required/);
    });

    describe('Phase 1 in a minimal mediasoup app', () => {
        let workers;

        before(async () => {
            workers = await Promise.all([
                mediasoup.createWorker({ logLevel: 'error' }),
                mediasoup.createWorker({ logLevel: 'error' }),
            ]);
        });

        after(() => workers.forEach((worker) => !worker.closed && worker.close()));

        // The whole "app": a room with a router pool and the 4 documented hooks
        class TinyRoom {
            constructor(id, scaling) {
                this.id = id;
                this.scaling = scaling;
                this.transports = new Map(); // peerId -> transport
                this.owners = new Map(); // producerId -> peerId
            }

            async init() {
                const worker = this.scaling.pickWorker();
                this.router = await worker.createRouter({ mediaCodecs });
                this.pool = this.scaling.createRoomRouterPool(this.id, mediaCodecs);
                this.pool.setMainRouter(this.router, worker);
                return this;
            }

            async join(peerId) {
                const router = await this.pool.assignPeer(peerId); // hook 1
                const transport = await router.createWebRtcTransport(transportOptions);
                this.transports.set(peerId, transport);
            }

            async produce(peerId) {
                const producer = await this.transports.get(peerId).produce({
                    kind: 'audio',
                    rtpParameters: OPUS_RTP_PARAMETERS,
                });
                this.owners.set(producer.id, peerId);
                return producer;
            }

            async consume(peerId, producerId) {
                const router = this.pool.getPeerRouter(peerId);
                const source = this.pool.getPeerRouter(this.owners.get(producerId));
                await this.pool.pipeProducer(producerId, source, router); // hook 2
                return this.transports.get(peerId).consume({ producerId, rtpCapabilities: router.rtpCapabilities });
            }

            leave(peerId) {
                this.transports.get(peerId)?.close();
                this.transports.delete(peerId);
                this.pool.releasePeer(peerId); // hook 3
            }

            close() {
                this.pool.close(); // hook 4
                this.router.close();
            }
        }

        it('spreads a room over two workers and lets peers consume across them', async () => {
            const scaling = createScaling({ multiWorkerRooms: { enabled: true, maxPeersPerRouter: 1 } });
            scaling.setWorkers(workers);
            const room = await new TinyRoom('tiny', scaling).init();

            await room.join('alice');
            await room.join('bob');
            room.pool.getPeerRouter('alice').should.not.equal(room.pool.getPeerRouter('bob'));

            const producer = await room.produce('alice');
            const consumer = await room.consume('bob', producer.id);
            consumer.producerId.should.equal(producer.id);
            consumer.kind.should.equal('audio');

            const overflow = room.pool.getPeerRouter('bob');
            room.leave('bob');
            overflow.closed.should.be.true();
            room.close();
            scaling
                .getStatus()
                .multiWorkerRooms.workers.every((w) => w.peers === 0)
                .should.be.true();
        });
    });

    describe('Phase 2 in a minimal app (custom routes, Set based rooms)', () => {
        let nodes;

        afterEach(async () => Promise.all(nodes.map((node) => node.stop())));

        it('routes /rooms/:id between nodes with getRedirectUrl and the default room description', async () => {
            const backend = new MemoryBackend();
            const start = async (id, rooms) => {
                const scaling = createScaling(
                    { cluster: { enabled: true, nodeId: id, nodeUrl: `https://${id}.example.org` } },
                    { store: new MemoryStore(backend) }
                );
                (await scaling.start({ getLocalRooms: () => rooms })).should.be.true();
                return scaling;
            };

            // Rooms are whatever the app uses: here { peers: Set }
            const busy = await start('n1', new Map([['class-a', { peers: new Set(['p1', 'p2', 'p3']) }]]));
            const idle = await start('n2', new Map());
            nodes = [busy, idle];

            (await idle.getRemoteRooms()).should.deepEqual([
                { id: 'class-a', peers: 3, nodeId: 'n1', nodeUrl: 'https://n1.example.org' },
            ]);
            (await idle.getRedirectUrl('class-a', '/rooms/class-a?lang=it')).should.equal(
                'https://n1.example.org/rooms/class-a?lang=it'
            );
            // New room: placed on the least loaded node (n2), so n1 redirects there
            (await busy.getRedirectUrl('class-b', '/rooms/class-b')).should.equal(
                'https://n2.example.org/rooms/class-b'
            );
            ((await idle.getRedirectUrl('class-b', '/rooms/class-b')) === null).should.be.true();
        });
    });
});
