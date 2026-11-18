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
            setTimeout,
            clearTimeout,
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
        // Short side 256: every row and column of the 256x256 model output is kept
        assert.equal(segmentCalls[0].input.width, 455);
        assert.equal(segmentCalls[0].input.height, 256);
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
                { width: 1, height: 1, values: [0.5] },
            ],
        });
        await startFrames();
        await send({ type: 'frame', id: 3, session: 7, bitmap: bitmap(1, 1), timestamp: 1 });
        assert.equal(compositor().maskImage.data[3], 128);
    });

    it('uses the inverted background of multiclass models without a person label', async () => {
        createWorker({
            labels: ['background', 'hair', 'body-skin'],
            masks: [
                { width: 2, height: 1, values: [1, 0] },
                { width: 2, height: 1, values: [0, 1] },
                { width: 2, height: 1, values: [0, 0] },
            ],
        });
        await startFrames();
        await send({ type: 'frame', id: 3, session: 7, bitmap: bitmap(2, 1), timestamp: 1 });
        const alpha = [...compositor().maskImage.data].filter((_, index) => index % 4 === 3);
        assert.deepEqual(alpha, [0, 255]);
    });

    function useFakeGl() {
        const canvas = { transferToImageBitmap: () => ({ close: sinon.spy(), fromGl: true }) };
        const gl = {
            canvas,
            lost: false,
            setMask: sinon.spy(),
            render: sinon.stub().returns(true),
            destroy: sinon.spy(),
        };
        context.fakeGl = gl;
        vm.runInContext('compositor.gl = fakeGl;', context);
        return gl;
    }

    it('composites with the WebGL compositor, feeding it the soft (not edge-tightened) mask', async () => {
        createWorker({ masks: [{ width: 2, height: 1, values: [0.25, 1] }] });
        const gl = useFakeGl();
        const image = bitmap(1920, 1080);
        await startFrames({ kind: 'image', bitmap: image });
        await send({ type: 'frame', id: 3, session: 7, bitmap: bitmap(2, 1), timestamp: 1 });

        assert.equal(lastReply().bitmap.fromGl, true);
        assert.equal(gl.setMask.calledOnceWith(compositor().maskImage), true);
        // 0.25 stays 64: the Canvas2D edge curve would make it 14
        assert.deepEqual(
            [...compositor().maskImage.data].filter((_, index) => index % 4 === 3),
            [64, 255]
        );
        assert.equal(compositor().maskCanvas, null, 'no Canvas2D mask work while WebGL composites');
        const [, width, height, view] = gl.render.firstCall.args;
        assert.deepEqual([width, height], [2, 1]);
        assert.equal(view.kind, 'image');
        assert.equal(view.source, image);

        const views = [];
        for (const background of [{ kind: 'blur', blurLevel: 20 }, { kind: 'transparent' }]) {
            await send({ type: 'background', id: 4, background });
            await send({ type: 'frame', id: 5, session: 7, bitmap: bitmap(2, 1), timestamp: 40 + views.length });
            views.push(plain(gl.render.lastCall.args[3]));
        }
        assert.deepEqual(views, [{ kind: 'blur', blurLevel: 20 }, { kind: 'transparent' }]);

        const gif = bitmap(200, 200);
        await send({ type: 'background', id: 6, background: { kind: 'gif', bitmap: gif } });
        const nextGifFrame = bitmap(200, 200);
        await send({ type: 'gif-frame', bitmap: nextGifFrame });
        await send({ type: 'frame', id: 7, session: 7, bitmap: bitmap(2, 1), timestamp: 60 });
        assert.equal(gl.render.lastCall.args[3].source, nextGifFrame);
    });

    it('falls back to Canvas2D with the edge-tightened mask when WebGL fails', async () => {
        createWorker({ masks: [{ width: 2, height: 1, values: [0.25, 1] }] });
        const gl = useFakeGl();
        gl.render.throws(new Error('texImage2D failed'));
        await startFrames({ kind: 'transparent' });
        await send({ type: 'frame', id: 3, session: 7, bitmap: bitmap(2, 1), timestamp: 1 });

        assert.equal(lastReply().bitmap.composited, true, 'the same frame is composited by Canvas2D');
        assert.equal(gl.destroy.calledOnce, true);
        assert.equal(compositor().gl, null);
        assert.ok(compositor().maskCanvas, 'mask canvases are drawn for the Canvas2D handlers');

        await send({ type: 'frame', id: 4, session: 7, bitmap: bitmap(2, 1), timestamp: 40 });
        assert.equal(compositor().maskImage.data[3], 14);

        // A lost context is detected before rendering
        const lost = useFakeGl();
        lost.lost = true;
        await send({ type: 'frame', id: 5, session: 7, bitmap: bitmap(2, 1), timestamp: 80 });
        assert.equal(lost.render.called, false);
        assert.equal(lastReply().bitmap.composited, true);
    });

    function useFakeVision(failures = []) {
        const created = [];
        context.fakeVision = {
            ImageSegmenter: {
                createFromOptions: async (fileset, options) => {
                    const { modelAssetPath, delegate } = options.baseOptions;
                    if (failures.some((failure) => failure(modelAssetPath, delegate))) throw new Error('unsupported');
                    const segmenter = { ...context.fakeSegmenter, close: sinon.spy(), modelAssetPath, delegate };
                    created.push(segmenter);
                    return segmenter;
                },
            },
        };
        vm.runInContext('vision = fakeVision; fileset = {};', context);
        return created;
    }

    const modelConfig = { modelUrl: 'selfie.tflite', multiclassModelUrl: 'multiclass.tflite', delegate: 'CPU' };

    it('runs the multiclass model on the GPU, or the selfie model on the CPU without it', async () => {
        createWorker();
        let created = useFakeVision();
        context.config = modelConfig;
        await vm.runInContext('loadModel(config)', context);
        assert.deepEqual(plain(vm.runInContext('model', context)), {
            name: 'multiclass',
            url: 'multiclass.tflite',
            delegate: 'GPU',
        });

        createWorker();
        created = useFakeVision([(url, delegate) => delegate === 'GPU']);
        context.config = modelConfig;
        await vm.runInContext('loadModel(config)', context);
        assert.equal(vm.runInContext('model.name', context), 'selfie');
        assert.equal(created.length, 1);
        assert.equal(created[0].delegate, 'CPU');
    });

    it('gives the multiclass model up for the selfie model when it is too slow', async () => {
        createWorker({ segmentCost: 60 });
        const created = useFakeVision();
        context.config = modelConfig;
        await vm.runInContext('workerConfig = config; loadModel(config)', context);
        const multiclass = created[0];
        await startFrames();
        vm.runInContext('segmentCount = 20;', context);
        await send({ type: 'frame', id: 3, session: 7, bitmap: bitmap(), timestamp: 1 });
        await flush();

        assert.equal(vm.runInContext('model.name', context), 'selfie');
        assert.equal(created[1].modelAssetPath, 'selfie.tflite');
        assert.equal(created[1].delegate, 'CPU');
        assert.equal(multiclass.close.calledOnce, true);
    });

    it('stabilizes the mask between segmentations and starts fresh for a new session', async () => {
        const values = [0.5, 0];
        createWorker({ masks: [{ width: 2, height: 1, values }], segmentCost: 0 });
        await startFrames();
        const alpha = () => [...compositor().maskImage.data].filter((_, index) => index % 4 === 3);
        await send({ type: 'frame', id: 3, session: 7, bitmap: bitmap(2, 1), timestamp: 0 });
        assert.deepEqual(alpha(), [128, 0]);

        // A small flicker of an edge pixel is damped (100 unstabilized), a large change is followed at once
        values[0] = 0.45;
        values[1] = 1;
        await send({ type: 'frame', id: 4, session: 7, bitmap: bitmap(2, 1), timestamp: 33 });
        const [flicker, moved] = alpha();
        assert.ok(flicker > 110 && flicker < 128, `flicker damped (${flicker})`);
        assert.equal(moved, 255);

        // Without the reset the previous session's mask would pull this pixel up (114)
        await send({ type: 'start', id: 5, session: 8, mode: 'frames' });
        await send({ type: 'frame', id: 6, session: 8, bitmap: bitmap(2, 1), timestamp: 66 });
        assert.deepEqual(alpha(), [100, 255]);
    });

    class FakeNestedWorker {
        constructor(url, options) {
            this.url = url;
            this.options = options;
            this.sent = [];
            this.terminate = sinon.spy();
            FakeNestedWorker.instances.push(this);
        }
        postMessage(message, transfer) {
            this.sent.push({ message, transfer });
            if (message.type === 'init' && FakeNestedWorker.autoReady) {
                Promise.resolve().then(() =>
                    this.onmessage({ data: { type: 'ready', model: 'multiclass', delegate: 'GPU' } })
                );
            }
        }
        requests() {
            return this.sent.filter(({ message }) => message.type === 'segment').map(({ message }) => message);
        }
        reply(request, values = [0, 1], extra = {}) {
            this.onmessage({
                data: {
                    type: 'mask',
                    generation: request.generation,
                    values: Float32Array.from(values),
                    width: values.length,
                    height: 1,
                    model: 'multiclass',
                    delegate: 'GPU',
                    ...extra,
                },
            });
        }
    }

    async function startNestedSegmenter() {
        FakeNestedWorker.instances = [];
        FakeNestedWorker.autoReady = true;
        context.Worker = FakeNestedWorker;
        context.config = { segmenterUrl: 'https://host/js/VirtualBackgroundWorker.js' };
        assert.equal(await vm.runInContext('workerConfig = config; startRemoteSegmenter(config)', context), true);
        return FakeNestedWorker.instances[0];
    }

    it('starts this script again as a named nested worker to segment in parallel', async () => {
        createWorker();
        const nested = await startNestedSegmenter();
        assert.equal(nested.url, 'https://host/js/VirtualBackgroundWorker.js');
        assert.deepEqual(plain(nested.options), { type: 'module', name: 'mirotalk-vb-segmenter' });
        assert.equal(nested.sent[0].message.type, 'init');
        assert.equal(vm.runInContext('model.name', context), 'multiclass');

        createWorker();
        FakeNestedWorker.instances = [];
        FakeNestedWorker.autoReady = false;
        context.Worker = FakeNestedWorker;
        context.config = { segmenterUrl: 'https://host/js/VirtualBackgroundWorker.js' };
        const started = vm.runInContext('startRemoteSegmenter(config)', context);
        FakeNestedWorker.instances[0].onmessage({ data: { type: 'error', stage: 'init', message: 'no wasm' } });
        assert.equal(await started, false, 'the caller segments in this worker instead');
        assert.equal(FakeNestedWorker.instances[0].terminate.calledOnce, true);
    });

    it('composites every frame with the latest mask without waiting for the segmenter', async () => {
        createWorker();
        const nested = await startNestedSegmenter();
        await startFrames({ kind: 'transparent' });

        // The first frame waits for its mask: no room is sent before there is a mask
        const firstFrame = send({ type: 'frame', id: 3, session: 7, bitmap: bitmap(512, 288), timestamp: 0 });
        await flush();
        const [first] = nested.requests();
        assert.deepEqual([first.bitmap.width, first.bitmap.height], [455, 256]);
        assert.equal(posted.length, 2, 'not answered before the first mask');
        nested.reply(first, [0, 1]);
        await firstFrame;
        await flush();
        assert.equal(lastReply().bitmap.composited, true);
        assert.equal(segmentCalls.length, 0, 'nothing segmented in the compositor worker');

        // Later frames are composited at once, one segmentation in flight at most
        now += 100;
        await send({ type: 'frame', id: 4, session: 7, bitmap: bitmap(512, 288), timestamp: 33 });
        await send({ type: 'frame', id: 5, session: 7, bitmap: bitmap(512, 288), timestamp: 66 });
        assert.equal(lastReply().bitmap.composited, true);
        assert.equal(nested.requests().length, 2);

        // A mask of the previous camera is dropped after a new session started
        const stale = nested.requests()[1];
        await send({ type: 'start', id: 6, session: 8, mode: 'frames' });
        nested.reply(stale, [1, 1]);
        assert.equal(vm.runInContext('compositor.hasMask', context), false);
    });

    it('lets the segmenter rest between masks so the GPU is not saturated', async () => {
        createWorker();
        const nested = await startNestedSegmenter();
        await startFrames({ kind: 'transparent' });
        const firstFrame = send({ type: 'frame', id: 3, session: 7, bitmap: bitmap(2, 1), timestamp: 0 });
        await flush();
        now += 40;
        nested.reply(nested.requests()[0]);
        await firstFrame;
        await flush();

        // Took 40 ms: the next request waits 20 ms
        now += 10;
        await send({ type: 'frame', id: 4, session: 7, bitmap: bitmap(2, 1), timestamp: 33 });
        assert.equal(nested.requests().length, 1);
        now += 15;
        await send({ type: 'frame', id: 5, session: 7, bitmap: bitmap(2, 1), timestamp: 66 });
        assert.equal(nested.requests().length, 2);
    });

    it('segments in this worker when the nested segmenter crashes or stalls', async () => {
        for (const breakIt of ['crash', 'stall']) {
            createWorker();
            const nested = await startNestedSegmenter();
            vm.runInContext('loadSegmenter = async () => { segmenter = fakeSegmenter; };', context);
            await startFrames({ kind: 'transparent' });
            const firstFrame = send({ type: 'frame', id: 3, session: 7, bitmap: bitmap(2, 1), timestamp: 0 });
            await flush();
            nested.reply(nested.requests()[0]);
            await firstFrame;
            await flush();
            now += 100;
            await send({ type: 'frame', id: 4, session: 7, bitmap: bitmap(2, 1), timestamp: 33 });

            if (breakIt === 'crash') nested.onerror({ message: 'out of memory', preventDefault() {} });
            else now += 5000;
            await send({ type: 'frame', id: 5, session: 7, bitmap: bitmap(2, 1), timestamp: 66 });
            await flush();
            assert.equal(nested.terminate.calledOnce, true, breakIt);
            assert.equal(vm.runInContext('remote.worker', context), null);

            await send({ type: 'frame', id: 6, session: 7, bitmap: bitmap(2, 1), timestamp: 99 });
            assert.ok(segmentCalls.length >= 1, `${breakIt}: segmented here`);
            assert.equal(lastReply().bitmap.composited, true);
        }
    });

    it('answers every segment request of the compositor in the segmenter role', async () => {
        createWorker({ masks: [{ width: 2, height: 1, values: [0.25, 1] }] });
        const input = bitmap(455, 256);
        vm.runInContext('segmentForCompositor', context)({ bitmap: input, timestamp: 5, generation: 3 });
        const { message, transfer } = posted[posted.length - 1];
        assert.equal(message.type, 'mask');
        assert.equal(message.generation, 3);
        assert.deepEqual([...message.values], [0.25, 1]);
        assert.deepEqual([message.width, message.height], [2, 1]);
        assert.equal(transfer[0], message.values.buffer, 'the mask is transferred, not copied');
        assert.equal(input.close.calledOnce, true);

        context.fakeSegmenter.segmentForVideo = () => {
            throw new Error('graph failed');
        };
        const broken = bitmap(455, 256);
        vm.runInContext('segmentForCompositor', context)({ bitmap: broken, timestamp: 6, generation: 3 });
        assert.equal(posted[posted.length - 1].message.values, null, 'the compositor is never left waiting');
        assert.equal(broken.close.calledOnce, true);
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

describe('Virtual background mask stabilizer', () => {
    let effects;

    before(() => {
        const context = vm.createContext({});
        vm.runInContext(read('VirtualBackgroundEffects.js'), context);
        effects = context.VirtualBackgroundEffects;
    });

    // edgeLow 0 / edgeHigh 1: plain smoothstep, so expectations are given before the curve
    const noEdgeCurve = { edgeLow: 0, edgeHigh: 1 };
    const curve = (value) => value * value * (3 - 2 * value);
    const linear = (stabilize) => (values) => [...stabilize(Float32Array.from(values))];
    const close = (actual, expected) =>
        actual.forEach((value, index) =>
            assert.ok(Math.abs(value - curve(expected[index])) < 1e-5, `${actual} ≈ ${expected.map(curve)}`)
        );

    it('damps model jitter on static edges but never lags behind real motion', () => {
        const run = linear(effects.createMaskStabilizer({ ...noEdgeCurve, leak: 0.3 }));
        run([0.5, 0]);
        // 0.02 is below tLo: only the leak share of the change gets through
        close(run([0.52, 1]), [0.506, 1]);
        let jitter = 0;
        for (let frame = 0; frame < 20; frame++) {
            const [value] = run([frame % 2 ? 0.45 : 0.55, 1]);
            if (frame > 4) jitter = Math.max(jitter, Math.abs(value - 0.5));
        }
        assert.ok(jitter < 0.03, `±0.05 raw jitter is reduced to ±${jitter.toFixed(3)}`);
    });

    it('keeps following an edge for a few masks after it moved (peak-hold envelope)', () => {
        const run = linear(effects.createMaskStabilizer({ ...noEdgeCurve, leak: 0.1, release: 0.8 }));
        run([0]);
        close(run([1]), [1]);
        // envelope 0.8: still above tHi, the small correction is taken in full
        close(run([0.9]), [0.9]);
    });

    it('smoothsteps the edge band and restarts when the mask size changes or on reset', () => {
        const stabilize = effects.createMaskStabilizer();
        const run = linear(stabilize);
        const { edgeLow, edgeHigh } = effects.MASK_STABILIZER_DEFAULTS;
        close(run([0, edgeLow, 0.5, edgeHigh, 1]), [0, 0, 0.5, 1, 1]);
        assert.equal(run([0.3]).length, 1, 'a new mask size starts a new state');
        run([0.6]);
        run([0.6]);
        stabilize.reset();
        // Without the reset 0.5 would be blended with the previous 0.6
        close(run([0.5]), [0.5]);
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

describe('Virtual background WebGL compositor', () => {
    let gl;

    before(() => {
        const context = vm.createContext({});
        vm.runInContext(read('VirtualBackgroundGL.js'), context);
        gl = context.VirtualBackgroundGL;
    });

    it('fits backgrounds like CSS object-fit: cover', () => {
        // 4:3 image in a 16:9 frame: full width, the middle 75% of the height
        assert.deepEqual(plain(gl.coverTransform(1600, 1200, 1280, 720)), [1, 0.75, 0, 0.125]);
        // portrait image: full width, the middle band of the height
        const [scaleX, scaleY, offsetX, offsetY] = gl.coverTransform(720, 1280, 1280, 720);
        assert.equal(scaleX, 1);
        assert.equal(offsetX, 0);
        assert.ok(Math.abs(scaleY - 0.31640625) < 1e-9);
        assert.ok(Math.abs(offsetY - (1 - scaleY) / 2) < 1e-9);
        assert.deepEqual(plain(gl.coverTransform(0, 0, 1280, 720)), [1, 1, 0, 0]);
    });

    it('sizes the refined mask and the blur targets', () => {
        assert.deepEqual(plain(gl.scaledSize(1280, 720, 1, 640)), [640, 360]);
        assert.deepEqual(plain(gl.scaledSize(320, 180, 1, 640)), [320, 180]);
        assert.deepEqual(plain(gl.scaledSize(1280, 720, 0.25)), [320, 180]);
        assert.deepEqual(plain(gl.blurKernel(20, 0.25)), { sigma: 5, radius: 15 });
        assert.deepEqual(plain(gl.blurKernel(400, 0.25)), { sigma: 100, radius: 32 });
        assert.deepEqual(plain(gl.blurKernel(0, 0.25)), { sigma: 0.5, radius: 2 });
    });

    it('reports no compositor without WebGL2, so the worker keeps Canvas2D', () => {
        assert.equal(gl.createCompositor({ getContext: () => null }), null);
        assert.equal(
            gl.createCompositor({
                getContext: () => {
                    throw new Error('blocked');
                },
            }),
            null
        );
    });
});
