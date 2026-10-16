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
        const context = vm.createContext({
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

    describe('recoverConsumerTransport', () => {
        const recover = (client) => RoomClientProto.recoverConsumerTransport.call(client);

        it('rejects when a consumer reconcile is already in progress', async () => {
            const client = { consumerReconcileInProgress: true, consumers: new Map() };
            await assert.rejects(recover(client), /already in progress/);
        });

        it('drops stale consumers, recreates the transport and reconciles', async () => {
            const removed = [];
            const steps = [];
            const client = {
                consumerReconcileInProgress: false,
                consumers: new Map([
                    ['c1', { kind: 'audio' }],
                    ['c2', { kind: 'video' }],
                ]),
                device: { id: 'device' },
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
            assert.deepEqual(steps, ['init', 'reconcile']);
        });

        it('rejects when the new transport cannot be created', async () => {
            const client = {
                consumerReconcileInProgress: false,
                consumers: new Map(),
                initConsumerTransport: async () => null,
                reconcileConsumers: async () => assert.fail('must not reconcile'),
            };
            await assert.rejects(recover(client), /Consumer transport creation failed/);
        });
    });

    describe('recoverProducerTransport', () => {
        const recover = (client) => RoomClientProto.recoverProducerTransport.call(client);

        function createProducerClient({ newTransport, paused = false, trackEnded = false } = {}) {
            const track = { ended: trackEnded };
            const stream = { active: true };
            const producer = {
                track,
                paused,
                closed: false,
                close() {
                    this.closed = true;
                },
            };
            const client = {
                producerTransport: { id: 'old' },
                producers: new Map([['p1', producer]]),
                producerLabel: new Map([['audioType', 'p1']]),
                localAudioStream: stream,
                localVideoStream: null,
                device: {},
                produced: [],
                paused: [],
                getId: () => null,
                initProducerTransport: async () => newTransport,
                produce: async function (...args) {
                    this.produced.push(args);
                },
                pauseProducer: async function (type) {
                    this.paused.push(type);
                },
            };
            return { client, producer, track, stream };
        }

        it('rejects when the new transport is missing or unchanged', async () => {
            await assert.rejects(recover(createProducerClient({ newTransport: null }).client), /creation failed/);
            await assert.rejects(
                recover(createProducerClient({ newTransport: { id: 'old' } }).client),
                /creation failed/
            );
        });

        it('re-produces the existing track on the new transport without stopping it', async () => {
            const { client, producer, track, stream } = createProducerClient({ newTransport: { id: 'new' } });
            await recover(client);

            assert.equal(producer.closed, true);
            assert.equal(client.producers.size, 0);
            assert.equal(client.producerLabel.size, 0);
            assert.equal(client.produced.length, 1);
            const [type, deviceId, swap, init, recovery] = client.produced[0];
            assert.deepEqual([type, deviceId, swap, init], ['audioType', null, false, false]);
            assert.equal(recovery.track, track);
            assert.equal(recovery.stream, stream);
            assert.deepEqual(client.paused, []);
        });

        it('restores the paused state of a muted producer', async () => {
            const { client } = createProducerClient({ newTransport: { id: 'new' }, paused: true });
            await recover(client);
            assert.deepEqual(client.paused, ['audioType']);
        });

        it('does not re-produce producers whose track has ended', async () => {
            const { client } = createProducerClient({ newTransport: { id: 'new' }, trackEnded: true });
            await recover(client);
            assert.equal(client.produced.length, 0);
        });
    });
});
