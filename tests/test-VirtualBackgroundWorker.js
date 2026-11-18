'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');
const { ReadableStream, WritableStream, TransformStream } = require('stream/web');

const read = (file) => fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));
// Objects created inside a vm context have other prototypes: compare their structure only
const plain = (value) => JSON.parse(JSON.stringify(value));

function createContext2D() {
    return {
        filter: 'none',
        save: sinon.spy(),
        restore: sinon.spy(),
        clearRect: sinon.spy(),
        drawImage: sinon.spy(),
        putImageData: sinon.spy(),
        getImageData: sinon.spy(),
    };
}

class FakeOffscreenCanvas {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.context = createContext2D();
    }
    getContext() {
        return this.context;
    }
    transferToImageBitmap() {
        return { width: this.width, height: this.height, close: sinon.spy(), composited: true };
    }
}

class FakeImageData {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(width * height * 4);
    }
}

const bitmap = (width = 640, height = 360) => ({ width, height, close: sinon.spy() });

describe('Virtual background worker script', () => {
    let context;
    let posted;
    let now;
    let segmentCalls;

    function createWorker({ masks = [{ width: 2, height: 1, values: [0, 1] }], labels = [], segmentCost = 5 } = {}) {
        posted = [];
        now = 0;
        segmentCalls = [];
        context = vm.createContext({
            console: { log() {}, warn() {}, error() {} },
            self: { postMessage: (message, transfer) => posted.push({ message, transfer }), close: sinon.spy() },
            OffscreenCanvas: FakeOffscreenCanvas,
            ImageData: FakeImageData,
            createImageBitmap: async (source, options) => ({
                width: options?.resizeWidth || source.width,
                height: options?.resizeHeight || source.height,
                close: sinon.spy(),
                resizedFrom: source,
            }),
            performance: { now: () => now },
            TransformStream,
            AbortController,
        });
        vm.runInContext(read('VirtualBackgroundEffects.js'), context);
        vm.runInContext(read('VirtualBackgroundWorker.js'), context);
        context.fakeSegmenter = {
            getLabels: () => labels,
            segmentForVideo: (input, timestamp, callback) => {
                segmentCalls.push({ input, timestamp });
                now += segmentCost;
                callback({
                    confidenceMasks: masks.map(({ width, height, values }) => ({
                        width,
                        height,
                        getAsFloat32Array: () => Float32Array.from(values),
                    })),
                });
            },
        };
        vm.runInContext('segmenter = fakeSegmenter; effects = VirtualBackgroundEffects;', context);
    }

    function send(message) {
        context.self.onmessage({ data: message });
        return flush();
    }

    const lastReply = () => posted[posted.length - 1].message;
    const compositor = () => vm.runInContext('compositor', context);

    async function startFrames(background = { kind: 'blur', blurLevel: 10 }) {
        await send({ type: 'background', id: 1, background });
        await send({ type: 'start', id: 2, session: 7, mode: 'frames' });
        assert.deepEqual(plain(lastReply()), { type: 'ack', id: 2 });
    }

    it('passes the first frame through, then returns composited frames with the person mask as alpha', async () => {
        createWorker({ masks: [{ width: 2, height: 1, values: [0, 0.5] }] });
        await startFrames();

        const first = bitmap(512, 288);
        await send({ type: 'frame', id: 3, session: 7, bitmap: first, timestamp: 10 });
        const reply = lastReply();
        assert.equal(reply.bitmap.composited, true);
        assert.equal(first.close.calledOnce, true);
        assert.deepEqual([...compositor().maskImage.data], [255, 255, 255, 0, 255, 255, 255, 128]);
        assert.equal(segmentCalls[0].input.width, 256);
        assert.equal(segmentCalls[0].input.height, 144);
        assert.equal(segmentCalls[0].input.close.calledOnce, true);
    });

    it('keeps MediaPipe timestamps strictly increasing', async () => {
        createWorker({ segmentCost: 0 });
        await startFrames();
        for (const timestamp of [100, 100, 99.6]) {
            await send({ type: 'frame', id: timestamp, session: 7, bitmap: bitmap(), timestamp });
        }
        assert.deepEqual(
            segmentCalls.map((call) => call.timestamp),
            [100, 101, 102]
        );
    });

    it('skips segmentation adaptively when it takes more than half of the frame budget', async () => {
        createWorker({ segmentCost: 40 });
        await startFrames();
        for (let index = 0; index < 9; index++) {
            await send({ type: 'frame', id: 10 + index, session: 7, bitmap: bitmap(), timestamp: index * 33 });
        }
        assert.equal(compositor().skipRatio, 3);
        assert.ok(segmentCalls.length <= 4);
        assert.equal(
            posted.filter(({ message }) => message.bitmap?.composited).length,
            9,
            'every frame is still composited with the last mask'
        );
    });

    it('answers frames of a stopped session without processing them', async () => {
        createWorker();
        await startFrames();
        await send({ type: 'stop', id: 4, session: 7 });
        const late = bitmap();
        await send({ type: 'frame', id: 5, session: 7, bitmap: late, timestamp: 1 });
        assert.deepEqual(plain(lastReply()), { type: 'frame', id: 5, bitmap: null });
        assert.equal(late.close.calledOnce, true);
        assert.equal(segmentCalls.length, 0);
    });

    it('uses the sharp mask for blur and the softened mask for images and transparency', async () => {
        // 256 px mask for a 640 px frame: the 5 px soft edge becomes 2 px at mask resolution
        createWorker({ masks: [{ width: 256, height: 1, values: new Array(256).fill(1) }] });
        await startFrames({ kind: 'transparent' });
        await send({ type: 'frame', id: 3, session: 7, bitmap: bitmap(), timestamp: 1 });
        const { canvas, softMaskCanvas, maskCanvas } = compositor();
        assert.equal(softMaskCanvas.context.filter, 'blur(2px)');
        const drawnMasks = () => canvas.context.drawImage.args.map((args) => args[0]);
        assert.equal(drawnMasks().includes(softMaskCanvas), true);
        assert.equal(drawnMasks().includes(maskCanvas), false);

        await send({ type: 'background', id: 4, background: { kind: 'blur', blurLevel: 20 } });
        canvas.context.drawImage.resetHistory();
        await send({ type: 'frame', id: 5, session: 7, bitmap: bitmap(), timestamp: 40 });
        assert.equal(drawnMasks().includes(maskCanvas), true);
        assert.equal(drawnMasks().includes(softMaskCanvas), false);
    });

    it('swaps backgrounds and releases the bitmaps it replaced', async () => {
        createWorker();
        const image = bitmap(1920, 1080);
        await startFrames({ kind: 'image', bitmap: image });
        const gif = bitmap(200, 200);
        await send({ type: 'background', id: 3, background: { kind: 'gif', bitmap: gif } });
        assert.equal(image.close.calledOnce, true);

        const nextGifFrame = bitmap(200, 200);
        await send({ type: 'gif-frame', bitmap: nextGifFrame });
        assert.equal(gif.close.calledOnce, true);
        assert.equal(compositor().gifBitmap, nextGifFrame);

        await send({ type: 'background', id: 4, background: { kind: 'blur', blurLevel: 10 } });
        assert.equal(nextGifFrame.close.calledOnce, true);
        const stray = bitmap();
        await send({ type: 'gif-frame', bitmap: stray });
        assert.equal(stray.close.calledOnce, true);
        assert.equal(compositor().gifBitmap, null);
    });

    it('picks the person mask of multiclass models by label', async () => {
        createWorker({
            labels: ['background', 'person'],
            masks: [
                { width: 1, height: 1, values: [1] },
                { width: 1, height: 1, values: [0.25] },
            ],
        });
        await startFrames();
        await send({ type: 'frame', id: 3, session: 7, bitmap: bitmap(1, 1), timestamp: 1 });
        assert.equal(compositor().maskImage.data[3], 64);
    });

    it('reports control errors to the page and stops a transferred track it could not use', async () => {
        createWorker();
        const track = { stop: sinon.spy() };
        await send({ type: 'start', id: 9, session: 8, mode: 'track', track });
        assert.equal(lastReply().type, 'error');
        assert.equal(lastReply().id, 9);
        assert.equal(track.stop.calledOnce, true);
    });
});

function createPageContext(overrides = {}) {
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        window: { MediaStreamTrackProcessor: class {}, MediaStreamTrackGenerator: class {}, TransformStream },
        TransformStream,
        ReadableStream,
        WritableStream,
        AbortController,
        URL,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        MediaStream: class {
            constructor(tracks) {
                this.tracks = tracks;
            }
            getVideoTracks() {
                return this.tracks;
            }
        },
        ...overrides,
    });
    vm.runInContext(read('VirtualBackgroundEffects.js'), context);
    vm.runInContext(read('VirtualBackground.js'), context);
    return context;
}

describe('Virtual background worker engine transports', () => {
    function createEngine({
        trackProcessor = false,
        transferableStreams = true,
        failTrackTransfer = false,
        trackTransfer = true,
    } = {}) {
        const workers = [];
        class Worker {
            constructor(url, options) {
                this.url = String(url);
                this.options = options;
                this.messages = [];
                this.terminate = sinon.spy();
                workers.push(this);
            }
            postMessage(message, transfer = []) {
                if (failTrackTransfer && message.mode === 'track') throw new Error('DataCloneError');
                this.messages.push({ message, transfer });
                const reply = (data) => queueMicrotask(() => this.onmessage({ data }));
                if (message.type === 'init') reply({ type: 'ready', delegate: 'CPU', trackProcessor });
                else if (message.mode === 'track') reply({ type: 'ack', id: message.id, track: { kind: 'video' } });
                else if (message.id) reply({ type: 'ack', id: message.id });
            }
        }
        class MessageChannel {
            constructor() {
                const postMessage = () => {
                    if (!transferableStreams) throw new Error('DataCloneError');
                };
                this.port1 = { postMessage, close() {} };
                this.port2 = { close() {} };
            }
        }
        class MediaStreamTrackProcessor {
            constructor({ track }) {
                this.track = track;
                this.readable = { kind: 'readable' };
            }
        }
        const context = createPageContext({ Worker, MessageChannel, MediaStreamTrackProcessor });
        context.trackTransfer = trackTransfer;
        const engine = vm.runInContext(
            'new VirtualBackgroundWorkerEngine({ baseUrl: "https://host/js/", trackTransfer })',
            context
        );
        return { engine, workers, context };
    }

    const camera = () => ({ clone: sinon.stub().returns({ stop: sinon.spy() }), stop: sinon.spy() });
    const generator = () => {
        const created = {
            generator: { writable: { kind: 'writable' } },
            track: { kind: 'generated', stop: sinon.spy() },
        };
        return Object.assign(() => created, { created });
    };

    it('loads the module worker and the shared effects next to VirtualBackground.js', async () => {
        const { engine, workers } = createEngine();
        await engine.init();
        assert.equal(workers[0].url, 'https://host/js/VirtualBackgroundWorker.js');
        assert.deepEqual(plain(workers[0].options), { type: 'module' });
        const { config } = workers[0].messages[0].message;
        assert.equal(config.effectsUrl, 'https://host/js/VirtualBackgroundEffects.js');
        assert.match(config.visionBundleUrl, /tasks-vision@1\.2\.0\/vision_bundle\.mjs$/);
        assert.match(config.modelUrl, /selfie_segmenter\/float16\/1\/selfie_segmenter\.tflite$/);
        assert.equal(config.delegate, 'CPU');
    });

    it('transfers a clone of the camera when the worker has track processing (Safari)', async () => {
        const { engine, workers } = createEngine({ trackProcessor: true });
        await engine.init();
        const track = camera();
        const session = await engine.start(track, { createGenerator: generator(), supportsTrackPipeline: false });

        const start = workers[0].messages.find(({ message }) => message.type === 'start');
        assert.equal(session.mode, 'track');
        assert.equal(start.message.track, track.clone.firstCall.returnValue);
        assert.equal(start.transfer.length, 1);
        assert.equal(start.transfer[0], track.clone.firstCall.returnValue);
        assert.deepEqual(plain(session.outputTrack), { kind: 'video' });
        assert.equal(track.stop.called, false);
    });

    it('falls back to transferred streams when the track cannot be transferred (Chromium)', async () => {
        const { engine, workers } = createEngine({ trackProcessor: true, failTrackTransfer: true });
        await engine.init();
        const track = camera();
        const createGenerator = generator();
        const session = await engine.start(track, { createGenerator, supportsTrackPipeline: true });

        assert.equal(track.clone.firstCall.returnValue.stop.calledOnce, true);
        assert.equal(session.mode, 'streams');
        assert.equal(session.outputTrack, createGenerator.created.track);
        const start = workers[0].messages.find(({ message }) => message.type === 'start');
        assert.equal(start.transfer.length, 2);
        assert.equal(start.transfer[0], start.message.readable);
        assert.equal(start.transfer[1], createGenerator.created.generator.writable);
    });

    it('does not transfer the camera track unless enabled', async () => {
        const { engine } = createEngine({ trackProcessor: true, transferableStreams: false, trackTransfer: false });
        await engine.init();
        engine.startFrames = sinon.stub().callsFake(async (session) => Object.assign(session, { mode: 'frames' }));
        const track = camera();
        const session = await engine.start(track, { createGenerator: generator(), supportsTrackPipeline: false });
        assert.equal(session.mode, 'frames');
        assert.equal(track.clone.called, false);
    });

    it('uses ImageBitmap frames when neither tracks nor streams can be transferred (Firefox)', async () => {
        const { engine } = createEngine({ transferableStreams: false });
        await engine.init();
        engine.startFrames = sinon.stub().callsFake(async (session) => Object.assign(session, { mode: 'frames' }));
        const session = await engine.start(camera(), { createGenerator: generator(), supportsTrackPipeline: true });
        assert.equal(session.mode, 'frames');
    });

    it('stops the output track before the worker ends it, so the room does not see a lost camera', async () => {
        const { engine, workers } = createEngine();
        await engine.init();
        const createGenerator = generator();
        const session = await engine.start(camera(), { createGenerator, supportsTrackPipeline: true });
        const outputStop = createGenerator.created.track.stop;
        let stoppedBeforeRequest = null;
        const post = workers[0].postMessage.bind(workers[0]);
        workers[0].postMessage = (message, transfer) => {
            if (message.type === 'stop') stoppedBeforeRequest = outputStop.called;
            post(message, transfer);
        };
        await engine.stopSession(session);
        assert.equal(stoppedBeforeRequest, true);
        assert.equal(outputStop.calledOnce, true);
    });

    it('does not log the pipeline closing while the page stops its session', async () => {
        const { engine, workers, context } = createEngine();
        context.console.error = sinon.spy();
        await engine.init();
        const onEnded = sinon.spy();
        const options = { onEnded, createGenerator: generator(), supportsTrackPipeline: true };
        const session = await engine.start(camera(), options);
        // The output track is stopped first, so the worker reports the closed stream before the stop ack
        const stopping = engine.stopSession(session);
        workers[0].onmessage({ data: { type: 'pipeline-error', session: session.id, message: 'Stream closed' } });
        workers[0].onmessage({ data: { type: 'pipeline-ended', session: session.id } });
        await stopping;
        assert.equal(context.console.error.called, false);
        assert.equal(onEnded.called, false);

        const running = await engine.start(camera(), options);
        workers[0].onmessage({ data: { type: 'pipeline-error', session: running.id, message: 'decode failed' } });
        assert.equal(context.console.error.calledOnce, true);
        assert.equal(onEnded.calledOnce, true);
    });

    it('rejects pending requests and ends sessions when the worker dies', async () => {
        const { engine, workers } = createEngine();
        await engine.init();
        const onEnded = sinon.spy();
        await engine.start(camera(), { onEnded, createGenerator: generator(), supportsTrackPipeline: true });
        workers[0].postMessage = () => {};
        const pending = engine.setBackground({ kind: 'blur', blurLevel: 10 });
        workers[0].onerror({ message: 'boom', preventDefault() {} });

        await assert.rejects(pending, /boom/);
        assert.equal(onEnded.calledOnce, true);
        assert.equal(workers[0].terminate.calledOnce, true);
        assert.equal(engine.failed, true);
    });

    it('fails init when the worker reports a model load error', async () => {
        const { engine, workers } = createEngine();
        const init = engine.init();
        workers[0].onmessage({ data: { type: 'error', stage: 'init', message: 'model 404' } });
        await assert.rejects(init, /model 404/);
        assert.equal(workers[0].terminate.calledOnce, true);
    });
});

describe('Virtual background engine selection', () => {
    function createBackground() {
        const processors = [];
        class MediaStreamTrackProcessor {
            constructor({ track }) {
                this.track = track;
                this.readable = new ReadableStream({ cancel() {} });
                processors.push(this);
            }
        }
        class MediaStreamTrackGenerator {
            constructor() {
                this.stop = sinon.spy();
                this.writable = new WritableStream();
            }
        }
        const context = createPageContext({
            window: { MediaStreamTrackProcessor, MediaStreamTrackGenerator, TransformStream },
            MediaStreamTrackProcessor,
            MediaStreamTrackGenerator,
            createImageBitmap: async () => bitmap(),
        });
        const background = vm.runInContext('new VirtualBackground()', context);
        background.initialized = true;
        background.segmentation = {};
        const outputTrack = { readyState: 'live', stop: sinon.spy() };
        const engine = {
            setBackground: sinon.stub().resolves(),
            start: sinon.stub().callsFake(async (track, { onEnded }) => {
                const session = { id: 1, mode: 'streams', outputTrack, stream: { id: 'worker-stream' } };
                engine.end = () => onEnded(session);
                return session;
            }),
            stopSession: sinon.stub().resolves(),
            sendGifFrame: sinon.spy(),
        };
        background.useWorker = true;
        background.getWorkerEngine = async () => (background.useWorker ? engine : null);
        background.workerEngine = engine;
        background.disableWorkerEngine = sinon.spy(() => (background.useWorker = false));
        background.createWorkerBackground = sinon.stub().callsFake(async (options) => ({ kind: 'blur', ...options }));
        return { background, engine, processors, outputTrack };
    }

    const camera = () => ({ readyState: 'live' });

    it('runs in the worker and swaps backgrounds there without restarting it', async () => {
        const { background, engine, processors } = createBackground();
        const track = camera();
        const stream = await background.applyBlurToWebRTCStream(track, 10);

        assert.equal(stream.id, 'worker-stream');
        assert.equal(processors.length, 0);
        assert.equal(engine.setBackground.calledOnceWith({ kind: 'blur', blurLevel: 10 }), true);

        assert.equal(await background.applyBlurToWebRTCStream(track, 20), stream);
        assert.equal(await background.setBackground(track, { transparent: true }), true);
        assert.equal(engine.start.calledOnce, true);
        assert.deepEqual(plain(engine.setBackground.thirdCall.args[0]), { kind: 'blur', transparent: true });
        await background.stopCurrentProcessor();
        assert.equal(engine.stopSession.calledOnce, true);
        assert.equal(background.activeWorkerSession, null);
        assert.equal(background.isProcessing, false);
    });

    it('falls back to the main-thread engine when the worker cannot start', async () => {
        const { background, engine, processors } = createBackground();
        engine.start.rejects(new Error('worker crashed'));
        const stream = await background.applyBlurToWebRTCStream(camera(), 10);

        assert.equal(background.disableWorkerEngine.calledOnce, true);
        assert.equal(processors.length, 1);
        assert.notEqual(stream.id, 'worker-stream');
        await background.stopCurrentProcessor();
    });

    it('reports a background that cannot be loaded without giving up on the worker', async () => {
        const { background, engine } = createBackground();
        background.createWorkerBackground.rejects(new Error('image 404'));
        await assert.rejects(background.applyVirtualBackgroundToWebRTCStream(camera(), 'missing.jpg'), /image 404/);
        assert.equal(background.disableWorkerEngine.called, false);
        assert.equal(engine.start.called, false);
    });

    it('stops when the worker pipeline ends on its own', async () => {
        const { background, engine } = createBackground();
        await background.applyBlurToWebRTCStream(camera(), 10);
        engine.end();
        await flush();
        assert.equal(engine.stopSession.calledOnce, true);
        assert.equal(background.activeWorkerSession, null);
    });

    it('forwards animated GIF frames to the worker until another background is chosen', async () => {
        const { background, engine } = createBackground();
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const track = camera();
        background.gifCanvas = { width: 100 };
        background.createWorkerBackground = async () => ({ kind: 'gif', bitmap: bitmap() });
        await background.applyVirtualBackgroundToWebRTCStream(track, 'party.gif');
        await wait(150);
        assert.ok(engine.sendGifFrame.callCount >= 1);

        background.createWorkerBackground = async () => ({ kind: 'blur', blurLevel: 10 });
        assert.equal(await background.setBackground(track, { blurLevel: 10 }), true);
        assert.equal(background.gifPump, null);
        const sent = engine.sendGifFrame.callCount;
        await wait(150);
        assert.equal(engine.sendGifFrame.callCount, sent);
        await background.stopCurrentProcessor();
    });
});
