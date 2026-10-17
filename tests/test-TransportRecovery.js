'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const roomClientSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'RoomClient.js'), 'utf8');

describe('test-TransportRecovery', () => {
    let RoomClientProto;
    let popups;

    before(() => {
        popups = [];
        class FakeMediaStream {
            constructor(tracks = []) {
                this.tracks = tracks;
                this.active = true;
            }
            getTracks() {
                return this.tracks;
            }
        }
        const context = vm.createContext({
            MediaStream: FakeMediaStream,
            window: { location: { origin: 'https://localhost:3010' } },
            setTimeout,
            console: { log() {}, info() {}, warn() {}, error() {} },
            popupHtmlMessage: (...args) => popups.push(args),
            handleAspectRatio: () => {},
        });
        vm.runInContext(`${roomClientSource}; globalThis.RoomClientForTest = RoomClient;`, context);
        RoomClientProto = context.RoomClientForTest.prototype;
    });

    beforeEach(() => {
        popups.length = 0;
    });

    function createClient(overrides = {}) {
        const client = {
            _isConnected: true,
            recoveringProducer: false,
            recoveringConsumer: false,
            logs: [],
            calls: [],
            userLog(type, message) {
                this.logs.push({ type, message });
            },
            recoverProducerTransport: async function () {
                this.calls.push('producer');
            },
            recoverConsumerTransport: async function () {
                this.calls.push('consumer');
            },
            ...overrides,
        };
        return client;
    }

    // Objects created inside the vm context have a different realm prototype
    const plain = (value) => JSON.parse(JSON.stringify(value));

    const handleTransportLost = (client, ...args) => RoomClientProto.handleTransportLost.apply(client, args);

    describe('handleTransportLost', () => {
        it('ignores unknown transport kinds', async () => {
            const client = createClient();
            await handleTransportLost(client, 'other');
            assert.deepEqual(client.calls, []);
            assert.equal(client.logs.length, 0);
        });

        it('recovers the producer transport and resets the recovering flag', async () => {
            const client = createClient();
            await handleTransportLost(client, 'producer', 3, 1);
            assert.deepEqual(client.calls, ['producer']);
            assert.equal(client.recoveringProducer, false);
            assert.equal(client.logs.at(-1).message, 'Media reconnected');
            assert.equal(popups.length, 0);
        });

        it('recovers the consumer transport', async () => {
            const client = createClient();
            await handleTransportLost(client, 'consumer', 3, 1);
            assert.deepEqual(client.calls, ['consumer']);
            assert.equal(client.recoveringConsumer, false);
        });

        it('skips recovery when not connected (leaving the room or room closed)', async () => {
            const client = createClient({ _isConnected: false });
            await handleTransportLost(client, 'producer', 3, 1);
            assert.deepEqual(client.calls, []);
            assert.equal(client.recoveringProducer, false);
            assert.equal(client.logs.length, 0);
            assert.equal(popups.length, 0);
        });

        it('does not start a second recovery while one is already running', async () => {
            const client = createClient({ recoveringConsumer: true });
            await handleTransportLost(client, 'consumer', 3, 1);
            assert.deepEqual(client.calls, []);
        });

        it('retries after a failed attempt and succeeds', async () => {
            let attempts = 0;
            const client = createClient({
                recoverProducerTransport: async function () {
                    attempts++;
                    if (attempts < 2) throw new Error('boom');
                },
            });
            await handleTransportLost(client, 'producer', 3, 1);
            assert.equal(attempts, 2);
            assert.equal(client.recoveringProducer, false);
            assert.equal(popups.length, 0);
        });

        it('shows the reload popup once every attempt has failed', async () => {
            let attempts = 0;
            const client = createClient({
                recoverProducerTransport: async function () {
                    attempts++;
                    throw new Error('boom');
                },
            });
            await handleTransportLost(client, 'producer', 3, 1);
            assert.equal(attempts, 3);
            assert.equal(client.recoveringProducer, false);
            assert.equal(popups.length, 1);
        });

        it('aborts silently when the room is left during recovery', async () => {
            let attempts = 0;
            const client = createClient({
                recoverProducerTransport: async function () {
                    attempts++;
                    this._isConnected = false;
                    throw new Error('boom');
                },
            });
            await handleTransportLost(client, 'producer', 3, 1);
            assert.equal(attempts, 1);
            assert.equal(client.recoveringProducer, false);
            assert.equal(popups.length, 0);
        });
    });

    describe('handleTransportClosed', () => {
        const handle = (client, data) => RoomClientProto.onTransportClosed.call(client, data);

        it('ignores transports that were already replaced', async () => {
            const lost = [];
            const client = {
                _isConnected: true,
                producerTransport: { id: 'p-new' },
                consumerTransport: { id: 'c-new' },
                handleTransportLost: async (kind) => lost.push(kind),
            };
            await handle(client, { transport_id: 'p-old' });
            assert.deepEqual(lost, []);
        });

        it('recovers without closing the transport first (recovery snapshots it before closing)', async () => {
            const lost = [];
            const transport = {
                id: 'p1',
                closed: false,
                close() {
                    this.closed = true;
                },
            };
            const client = {
                _isConnected: true,
                producerTransport: transport,
                consumerTransport: { id: 'c1' },
                handleTransportLost: async (kind) => lost.push(kind),
            };
            await handle(client, { transport_id: 'p1' });
            assert.deepEqual(lost, ['producer']);
            assert.equal(transport.closed, false);
        });

        it('only closes the transport when not connected', async () => {
            const lost = [];
            const transport = {
                id: 'c1',
                closed: false,
                close() {
                    this.closed = true;
                },
            };
            const client = {
                _isConnected: false,
                producerTransport: { id: 'p1' },
                consumerTransport: transport,
                handleTransportLost: async (kind) => lost.push(kind),
            };
            await handle(client, { transport_id: 'c1' });
            assert.deepEqual(lost, []);
            assert.equal(transport.closed, true);
        });
    });

    describe('restartTransportWithRetry', () => {
        const restart = (client, ...args) => RoomClientProto.restartTransportWithRetry.apply(client, args);

        it('does not escalate for a transport that was replaced meanwhile', async () => {
            const lost = [];
            const transport = { id: 'old', closed: false };
            const client = {
                iceRestartingTransports: new WeakSet(),
                producerTransport: transport,
                restartTransportIce: async function () {
                    this.producerTransport = { id: 'new', closed: false };
                    return false;
                },
                handleTransportLost: (kind) => lost.push(kind),
            };
            const result = await restart(client, transport, 'Producer', 3, 1);
            assert.equal(result, false);
            assert.deepEqual(lost, []);
        });

        it('escalates to recovery without closing the transport when all restarts fail', async () => {
            const lost = [];
            let restarts = 0;
            const transport = {
                id: 't',
                closed: false,
                close() {
                    this.closed = true;
                },
            };
            const client = {
                iceRestartingTransports: new WeakSet(),
                consumerTransport: transport,
                restartTransportIce: async () => {
                    restarts++;
                    return false;
                },
                handleTransportLost: (kind) => lost.push(kind),
            };
            await restart(client, transport, 'Consumer', 2, 1);
            assert.equal(restarts, 2);
            assert.deepEqual(lost, ['consumer']);
            assert.equal(transport.closed, false);
        });

        it('never runs two restart loops for the same transport', async () => {
            let restarts = 0;
            const transport = { id: 't', closed: false };
            const client = {
                iceRestartingTransports: new WeakSet(),
                producerTransport: transport,
                restartTransportIce: async () => {
                    restarts++;
                    await new Promise((resolve) => setTimeout(resolve, 5));
                    return true;
                },
                handleTransportLost: () => assert.fail('must not escalate'),
            };
            const [first, second] = await Promise.all([
                restart(client, transport, 'Producer', 3, 1),
                restart(client, transport, 'Producer', 3, 1),
            ]);
            assert.deepEqual([first, second], [true, false]);
            assert.equal(restarts, 1);
        });
    });

    describe('recoverConsumerTransport', () => {
        const recover = (client) => RoomClientProto.recoverConsumerTransport.call(client);

        it('rejects when a consumer reconcile is already in progress', async () => {
            const client = { consumerReconcileInProgress: true, consumers: new Map() };
            await assert.rejects(recover(client), /already in progress/);
        });

        it('drops stale consumers, closes the dead transport, recreates it and reconciles', async () => {
            const removed = [];
            const steps = [];
            const requests = [];
            const emitted = [];
            const deadTransport = {
                id: 'old',
                closed: false,
                close() {
                    steps.push('close');
                    this.closed = true;
                },
            };
            const dataConsumer = {
                closed: false,
                close() {
                    this.closed = true;
                },
            };
            const client = {
                consumerReconcileInProgress: false,
                consumers: new Map([
                    ['c1', { kind: 'audio' }],
                    ['c2', { kind: 'video' }],
                ]),
                chatDataConsumers: new Map([['dc1', dataConsumer]]),
                consumerTransport: deadTransport,
                device: { id: 'device' },
                socket: {
                    request: async (...args) => requests.push(args),
                    emit: (...args) => emitted.push(args),
                },
                closeDeadTransport: RoomClientProto.closeDeadTransport,
                removeConsumer: (id, kind) => removed.push([id, kind]),
                initConsumerTransport: async (device) => {
                    steps.push('init');
                    return { id: 'new', device };
                },
                reconcileConsumers: async () => steps.push('reconcile'),
            };
            await recover(client);
            assert.deepEqual(removed, [
                ['c1', 'audio'],
                ['c2', 'video'],
            ]);
            assert.deepEqual(steps, ['close', 'init', 'reconcile']);
            assert.deepEqual(plain(requests), [['closeTransport', { transport_id: 'old' }]]);
            assert.equal(dataConsumer.closed, true);
            assert.equal(client.chatDataConsumers.size, 0);
            assert.deepEqual(emitted, [['getDataProducers']]);
        });

        it('rejects when the new transport cannot be created', async () => {
            const client = {
                consumerReconcileInProgress: false,
                consumers: new Map(),
                chatDataConsumers: new Map(),
                closeDeadTransport: () => {},
                initConsumerTransport: async () => null,
                reconcileConsumers: async () => assert.fail('must not reconcile'),
            };
            await assert.rejects(recover(client), /Consumer transport creation failed/);
        });
    });

    describe('recoverProducerTransport', () => {
        const recover = (client) => RoomClientProto.recoverProducerTransport.call(client);

        function createTrack(kind = 'audio', readyState = 'live') {
            return {
                kind,
                readyState,
                stopped: false,
                stop() {
                    this.stopped = true;
                    this.readyState = 'ended';
                },
            };
        }

        function createProducer(track, paused = false) {
            // Mirrors mediasoup-client: close() stops the track unless stopTracks is false
            return {
                track,
                paused,
                closed: false,
                stopTracks: false,
                close() {
                    this.closed = true;
                    if (this.stopTracks) this.track.stop();
                },
            };
        }

        function createProducerClient({ newTransport, producers = null, chatDataProducer = { closed: false } } = {}) {
            const audioTrack = createTrack('audio');
            const map = producers || new Map([['p1', { type: 'audioType', producer: createProducer(audioTrack) }]]);
            const requests = [];
            const deadTransport = {
                id: 'old',
                closed: false,
                close() {
                    this.closed = true;
                },
            };
            const client = {
                producerTransport: deadTransport,
                producers: new Map([...map].map(([id, { producer }]) => [id, producer])),
                producerLabel: new Map([...map].map(([id, { type }]) => [type, id])),
                chatDataProducer,
                device: {},
                produced: [],
                producedScreenAudio: [],
                paused: [],
                peerInfoUpdates: [],
                chatInits: 0,
                peer_name: 'me',
                peer_id: 'me-id',
                socket: { request: async (...args) => requests.push(args) },
                getId: () => null,
                closeDeadTransport: RoomClientProto.closeDeadTransport,
                detachProducersForRecovery: RoomClientProto.detachProducersForRecovery,
                initProducerTransport: async function () {
                    const transport = typeof newTransport === 'function' ? newTransport() : newTransport;
                    if (transport) this.producerTransport = transport;
                    return transport;
                },
                produce: async function (type, deviceId, swap, init, recovery) {
                    this.produced.push([type, deviceId, swap, init, recovery]);
                    this.producerLabel.set(type, `new-${type}`);
                },
                produceScreenAudio: async function (stream) {
                    this.producedScreenAudio.push(stream);
                    this.producerLabel.set('audioTab', 'new-audioTab');
                },
                pauseProducer: async function (type) {
                    this.paused.push(type);
                },
                updatePeerInfo: function (...args) {
                    this.peerInfoUpdates.push(args);
                },
                initChatDataProducer: async function () {
                    this.chatInits++;
                },
            };
            return { client, audioTrack, deadTransport, requests };
        }

        it('rejects when the new transport is missing or unchanged', async () => {
            await assert.rejects(recover(createProducerClient({ newTransport: null }).client), /creation failed/);
            await assert.rejects(
                recover(createProducerClient({ newTransport: { id: 'old' } }).client),
                /creation failed/
            );
        });

        it('re-produces the existing track on the new transport without stopping it', async () => {
            const { client, audioTrack, deadTransport, requests } = createProducerClient({
                newTransport: { id: 'new' },
            });
            const producer = client.producers.get('p1');
            await recover(client);

            assert.equal(producer.closed, true);
            assert.equal(audioTrack.stopped, false);
            assert.equal(deadTransport.closed, true);
            assert.deepEqual(plain(requests), [['closeTransport', { transport_id: 'old' }]]);
            assert.equal(client.producers.size, 0);
            assert.equal(client.produced.length, 1);
            const [type, deviceId, swap, init, recovery] = client.produced[0];
            assert.deepEqual([type, deviceId, swap, init], ['audioType', null, false, false]);
            assert.equal(recovery.track, audioTrack);
            assert.equal(recovery.stream.getTracks().length, 1);
            assert.equal(recovery.stream.getTracks()[0], audioTrack);
            assert.deepEqual(client.paused, []);
            assert.equal(client.producerRecoverySnapshot, null);
        });

        it('restores the paused state of a muted producer and its peer info', async () => {
            const track = createTrack('audio');
            const { client } = createProducerClient({
                newTransport: { id: 'new' },
                producers: new Map([['p1', { type: 'audioType', producer: createProducer(track, true) }]]),
            });
            await recover(client);
            assert.deepEqual(client.paused, ['audioType']);
            assert.deepEqual(client.peerInfoUpdates, [['me', 'me-id', 'audio', false]]);
        });

        it('does not re-produce producers whose track has ended', async () => {
            const track = createTrack('audio', 'ended');
            const { client } = createProducerClient({
                newTransport: { id: 'new' },
                producers: new Map([['p1', { type: 'audioType', producer: createProducer(track) }]]),
            });
            await recover(client);
            assert.equal(client.produced.length, 0);
        });

        it('keeps the snapshot across a failed attempt so the retry still re-produces the media', async () => {
            let calls = 0;
            const { client, audioTrack } = createProducerClient({
                newTransport: () => (++calls === 1 ? null : { id: 'new' }),
            });
            await assert.rejects(recover(client), /creation failed/);
            assert.equal(client.producerRecoverySnapshot.length, 1);
            await recover(client);
            assert.equal(client.produced.length, 1);
            assert.equal(client.produced[0][4].track, audioTrack);
            assert.equal(client.producerRecoverySnapshot, null);
        });

        it('re-produces the screen tab audio after the screen and recreates the chat DataProducer', async () => {
            const screenTrack = createTrack('video');
            const tabTrack = createTrack('audio');
            const { client } = createProducerClient({
                newTransport: { id: 'new' },
                chatDataProducer: null,
                producers: new Map([
                    ['a1', { type: 'audioTab', producer: createProducer(tabTrack) }],
                    ['s1', { type: 'screenType', producer: createProducer(screenTrack) }],
                ]),
            });
            await recover(client);
            assert.deepEqual(
                client.produced.map(([type]) => type),
                ['screenType']
            );
            assert.equal(client.producedScreenAudio.length, 1);
            assert.equal(client.producedScreenAudio[0].getTracks().length, 1);
            assert.equal(client.producedScreenAudio[0].getTracks()[0], tabTrack);
            assert.equal(client.chatInits, 1);
        });
    });
});
