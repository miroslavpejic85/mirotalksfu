'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', 'public/js', file), 'utf8');
const quietConsole = { log() {}, info() {}, warn() {}, error() {} };
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

function createWorklet() {
    const messages = [];
    let Processor;
    vm.runInNewContext(source('NoiseSuppressionProcessor.js'), {
        console: quietConsole,
        sampleRate: 48000,
        currentTime: 0,
        AudioWorkletProcessor: class {
            constructor() {
                this.port = { postMessage: (message) => messages.push(message) };
            }
        },
        registerProcessor(name, implementation) {
            Processor = implementation;
        },
    });
    return { processor: new Processor(), messages };
}

describe('RNNoise worklet readiness', () => {
    it('does not announce readiness from the module loader before context setup', async () => {
        const { processor, messages } = createWorklet();
        await processor.port.onmessage({
            data: {
                type: 'sync-module',
                jsContent:
                    'function createRNNWasmModuleSync() { return { _malloc: () => 4, _rnnoise_create: () => 0, _free() {} }; }',
            },
        });
        assert.equal(
            messages.some((message) => message.type === 'wasm-ready'),
            false
        );
        assert.equal(messages.filter((message) => message.type === 'wasm-error').length, 1);
    });

    it('reports context creation failure without announcing readiness and frees the buffer', async () => {
        const { processor, messages } = createWorklet();
        const free = sinon.spy();
        processor.wasmInitializer.initSyncModule = async () => ({
            _malloc: () => 4,
            _rnnoise_create: () => 0,
            _free: free,
        });
        await processor.port.onmessage({ data: { type: 'sync-module', jsContent: 'module' } });
        assert.equal(processor.initialized, false);
        assert.equal(
            messages.some((message) => message.type === 'wasm-ready'),
            false
        );
        assert.equal(messages.at(-1).type, 'wasm-error');
        assert.equal(free.calledOnceWithExactly(4), true);
    });

    it('announces readiness only after a context exists', async () => {
        const { processor, messages } = createWorklet();
        processor.wasmInitializer.initSyncModule = async () => ({
            _malloc: () => 4,
            _rnnoise_create: () => 8,
            HEAPF32: [],
        });
        await processor.port.onmessage({ data: { type: 'sync-module', jsContent: 'module' } });
        assert.equal(processor.contextManager.rnnoiseContext, 8);
        assert.equal(processor.initialized, true);
        assert.equal(messages.at(-1).type, 'wasm-ready');
    });

    it('does not resurrect a worklet destroyed during initialization', async () => {
        const { processor, messages } = createWorklet();
        const loading = deferred();
        processor.wasmInitializer.initSyncModule = () => loading.promise;
        const starting = processor.port.onmessage({ data: { type: 'sync-module', jsContent: 'module' } });
        await processor.port.onmessage({ data: { type: 'destroy' } });
        loading.resolve({});
        await starting;
        assert.equal(processor.contextManager, null);
        assert.equal(
            messages.some((message) => message.type === 'wasm-ready'),
            false
        );
        assert.equal(processor.process([], []), false);
    });
});

function createProcessorEnvironment(overrides = {}) {
    const nodes = [];
    const elements = { labelNoiseSuppression: { style: {} }, switchNoiseSuppression: {} };
    const makeStream = (enabled = true) => {
        const track = {
            enabled,
            readyState: 'live',
            stop() {
                this.readyState = 'ended';
            },
        };
        return { getAudioTracks: () => [track], getTracks: () => [track] };
    };
    class AudioContext {
        constructor() {
            this.sampleRate = 48000;
            this.state = 'running';
        }
        async close() {
            this.state = 'closed';
        }
        createMediaStreamSource() {
            return { connect() {}, disconnect() {} };
        }
        createMediaStreamDestination() {
            return { stream: makeStream(), disconnect() {} };
        }
    }
    AudioContext.prototype.audioWorklet = { async addModule() {} };
    const context = vm.createContext({
        console: quietConsole,
        window: { AudioContext },
        WebAssembly,
        setTimeout,
        clearTimeout,
        document: { getElementById: (id) => elements[id] },
        localStorageSettings: { mic_noise_suppression: true },
        lS: { setSettings() {} },
        userLog() {},
        fetch: async () => ({ ok: true, text: async () => 'module' }),
        AudioWorkletNode: class {
            constructor() {
                this.port = { postMessage() {} };
                nodes.push(this);
            }
            connect() {}
            disconnect() {}
        },
        ...overrides,
    });
    vm.runInContext(source('NodeProcessor.js') + '\nglobalThis.Processor = RNNoiseProcessor;', context);
    return { context, nodes, elements, makeStream, processor: new context.Processor() };
}

async function flushStartup() {
    await new Promise((resolve) => setImmediate(resolve));
}

describe('RNNoise processor startup', () => {
    it('times out initialization without reporting success', async () => {
        let timeout;
        const { processor, makeStream } = createProcessorEnvironment({
            setTimeout(callback) {
                timeout = callback;
                return 1;
            },
            clearTimeout() {},
        });
        const raw = makeStream();
        const starting = processor.startProcessing(raw);
        await flushStartup();
        timeout();
        assert.equal(await starting, null);
        assert.equal(raw.getAudioTracks()[0].readyState, 'live');
    });

    it('does not create a worklet when stopped during module loading', async () => {
        const { processor, makeStream, nodes } = createProcessorEnvironment();
        const loading = deferred();
        const raw = makeStream();
        const starting = processor.startProcessing(raw);
        processor.audioContext.audioWorklet = { addModule: () => loading.promise };
        processor.stopProcessing(true);
        loading.resolve();
        assert.equal(await starting, null);
        assert.equal(nodes.length, 0);
        assert.equal(raw.getAudioTracks()[0].readyState, 'ended');
    });

    it('waits for readiness and keeps raw input enabled while processed output is muted', async () => {
        const { processor, makeStream, nodes } = createProcessorEnvironment();
        const raw = makeStream(false);
        let finished = false;
        const starting = processor.startProcessing(raw).then((stream) => {
            finished = true;
            return stream;
        });
        await flushStartup();
        assert.equal(finished, false);
        assert.equal(processor.isProcessing, false);
        nodes[0].port.onmessage({ data: { type: 'wasm-ready' } });
        const processed = await starting;
        assert.equal(raw.getAudioTracks()[0].enabled, true);
        assert.equal(processed.getAudioTracks()[0].enabled, false);
        processed.getAudioTracks()[0].enabled = true;
        assert.equal(raw.getAudioTracks()[0].enabled, true);
        processor.stopProcessing();
        assert.equal(raw.getAudioTracks()[0].readyState, 'live');
    });

    for (const failure of ['wasm-error', 'fetch', 'processorerror']) {
        it(`returns no processed stream on ${failure} and preserves the microphone for fallback`, async () => {
            const { processor, makeStream, nodes } = createProcessorEnvironment({ fetch: async () => ({ ok: false }) });
            const raw = makeStream();
            const starting = processor.startProcessing(raw);
            await flushStartup();
            if (failure === 'processorerror') nodes[0].onprocessorerror();
            else
                nodes[0].port.onmessage({
                    data: { type: failure === 'fetch' ? 'request-wasm' : failure, error: 'failed' },
                });
            assert.equal(await starting, null);
            assert.equal(raw.getAudioTracks()[0].readyState, 'live');
            assert.equal(processor.audioContext, null);
        });
    }

    it('cancels an older startup without tearing down a newer one', async () => {
        const { processor, makeStream, nodes } = createProcessorEnvironment();
        const older = processor.startProcessing(makeStream());
        await flushStartup();
        const newer = processor.startProcessing(makeStream());
        await flushStartup();
        assert.equal(await older, null);
        nodes[0].port.onmessage({ data: { type: 'wasm-ready' } });
        assert.equal(processor.isProcessing, false);
        nodes[1].port.onmessage({ data: { type: 'wasm-ready' } });
        assert.ok(await newer);
        processor.stopProcessing(true);
    });
});

function createRoomEnvironment() {
    const environment = createProcessorEnvironment();
    const { context } = environment;
    Object.assign(context, {
        BUTTONS: { settings: { customNoiseSuppression: true }, main: { startAudioButton: true } },
        switchNoiseSuppression: environment.elements.switchNoiseSuppression,
        labelNoiseSuppression: environment.elements.labelNoiseSuppression,
        elemDisplay: sinon.spy(),
        getMicrophoneVolumeIndicator: sinon.spy(),
        detectCameraFacingMode() {},
        handleMediaError: sinon.spy(),
    });
    vm.runInContext(
        source('RoomClient.js') + '\nglobalThis.Client = RoomClient; globalThis.audioType = mediaType.audio;',
        context
    );
    const client = Object.create(context.Client.prototype);
    Object.assign(client, {
        RNNoiseProcessor: null,
        noiseSuppressionRequest: 0,
        microphoneRequest: 0,
        isRNNoiseSupported: true,
        producerLabel: new Map(),
        producers: new Map(),
        peer_info: {},
        getId: () => null,
    });
    return { ...environment, client };
}

describe('RoomClient RNNoise lifecycle', () => {
    it('keeps only the newest processor when support probes overlap', async () => {
        const { context, client } = createRoomEnvironment();
        const olderProbe = deferred();
        const newerProbe = deferred();
        context.Processor.isSampleRateSupported = sinon
            .stub()
            .onFirstCall()
            .returns(olderProbe.promise)
            .onSecondCall()
            .returns(newerProbe.promise);
        const older = client.initRNNoiseSuppression();
        const newer = client.initRNNoiseSuppression();
        newerProbe.resolve(true);
        const current = await newer;
        olderProbe.resolve(false);
        assert.equal(await older, null);
        assert.equal(client.RNNoiseProcessor, current);
        assert.equal(client.isRNNoiseSupported, true);
        client.disableRNNoiseSuppression();
    });

    it('does not publish or toggle a newer processor from an older start', async () => {
        const { client, makeStream, processor } = createRoomEnvironment();
        const pending = deferred();
        processor.startProcessing = () => pending.promise;
        processor.stopProcessing = sinon.spy();
        client.RNNoiseProcessor = processor;
        const older = client.getRNNoiseSuppressionStream(makeStream());
        client.disableRNNoiseSuppression();
        const newer = {
            startProcessing: async () => makeStream(),
            setNoiseSuppression: sinon.spy(),
            stopProcessing: sinon.spy(),
            noiseSuppressionEnabled: true,
        };
        client.RNNoiseProcessor = newer;
        assert.ok(await client.getRNNoiseSuppressionStream(makeStream()));
        pending.resolve(makeStream());
        assert.equal(await older, null);
        assert.equal(newer.setNoiseSuppression.calledOnceWithExactly(true), true);
        assert.equal(newer.stopProcessing.called, false);
        assert.equal(client.RNNoiseProcessor, newer);
    });

    for (const reason of ['null', 'throw', 'unsupported']) {
        it(`activates browser fallback for ${reason} without ending the raw microphone`, async () => {
            const { client, makeStream, processor, context } = createRoomEnvironment();
            const raw = makeStream(false);
            const track = raw.getAudioTracks()[0];
            track.getConstraints = () => ({ echoCancellation: true });
            track.applyConstraints = sinon.spy(async (constraints) => {
                track.constraints = constraints;
            });
            track.getSettings = () => ({ noiseSuppression: track.constraints?.noiseSuppression });
            processor.startProcessing = async () => {
                if (reason === 'throw') throw new Error('startup failed');
                return null;
            };
            client.RNNoiseProcessor = reason === 'unsupported' ? null : processor;
            assert.equal(await client.getRNNoiseSuppressionStream(raw), raw);
            assert.equal(track.constraints.echoCancellation, true);
            assert.equal(track.constraints.noiseSuppression, true);
            assert.equal(track.readyState, 'live');
            assert.equal(track.enabled, false);
            assert.equal(context.localStorageSettings.mic_noise_suppression, false);
            assert.equal(context.switchNoiseSuppression.checked, false);
            assert.equal(client.getAudioConstraints().audio.noiseSuppression, true);
        });
    }

    it('does not claim native suppression when constraints are rejected', async () => {
        const { client, makeStream, context } = createRoomEnvironment();
        context.userLog = sinon.spy();
        const raw = makeStream();
        raw.getAudioTracks()[0].applyConstraints = async () => {
            throw new Error('unsupported');
        };
        assert.equal(await client.getRNNoiseSuppressionStream(raw), raw);
        assert.match(context.userLog.firstCall.args[1], /without noise suppression/);
    });

    it('ignores an obsolete fallback after its constraints finish', async () => {
        const { client, makeStream, context } = createRoomEnvironment();
        const applying = deferred();
        context.userLog = sinon.spy();
        const raw = makeStream();
        raw.getAudioTracks()[0].applyConstraints = () => applying.promise;
        const fallback = client.getRNNoiseSuppressionStream(raw);
        client.disableRNNoiseSuppression();
        applying.resolve();
        assert.equal(await fallback, null);
        assert.equal(context.userLog.called, false);
    });

    it('replaces failed live processing with the raw mic while preserving producer mute', async () => {
        const { client, makeStream, processor, context } = createRoomEnvironment();
        const raw = makeStream();
        const processed = makeStream(false);
        processor.mediaStream = raw;
        processor.processedStream = processed;
        client.RNNoiseProcessor = processor;
        client.localAudioStream = processed;
        const producer = { paused: true, replaceTrack: sinon.spy(async () => {}) };
        client.producerLabel.set(context.audioType, 'producer');
        client.producers.set('producer', producer);
        raw.getAudioTracks()[0].applyConstraints = async () => {};
        assert.equal(await client.fallbackRNNoiseSuppression(raw, processor, 0), raw);
        assert.equal(client.localAudioStream, raw);
        assert.equal(raw.getAudioTracks()[0].enabled, false);
        assert.equal(producer.replaceTrack.calledOnce, true);
    });

    it('invalidates an in-flight microphone acquisition on close', async () => {
        const { client, makeStream, context } = createRoomEnvironment();
        const acquiring = deferred();
        context.navigator = { mediaDevices: { getUserMedia: () => acquiring.promise } };
        client.device = { canProduce: () => true };
        client.producerTransport = { produce: sinon.spy() };
        const producing = client.produce(context.audioType);
        client.closeProducer(context.audioType);
        const raw = makeStream();
        acquiring.resolve(raw);
        await producing;
        assert.equal(raw.getAudioTracks()[0].readyState, 'ended');
        assert.equal(client.producerTransport.produce.called, false);
    });
});
