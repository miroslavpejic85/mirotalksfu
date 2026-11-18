/**
 * MiroTalk virtual background worker (module worker).
 *
 * Runs MediaPipe Image Segmenter (Apache-2.0) and the background compositing off the main thread:
 *   - model: selfie multiclass (person = not background, hair included) on the GPU delegate when it
 *            works and is fast enough, otherwise the selfie model on the CPU
 *   - compositing: VirtualBackgroundGL.js (WebGL2: bilateral edge refinement, light wrapping), or the
 *                  shared Canvas2D handlers of VirtualBackgroundEffects.js without WebGL2
 * Segmentation runs in a nested worker (this script again, named SEGMENTER_NAME) so frames never wait
 * for it: each frame is composited at once with the latest mask, while the next mask is computed in
 * parallel. Without nested workers the segmentation runs here, on every few frames.
 * The page picks the frame transport the browser supports:
 *   - 'streams': Chromium transfers the MediaStreamTrackProcessor / Generator streams
 *   - 'track':   Safari 18+ transfers the camera track (MediaStreamTrackProcessor and
 *                VideoTrackGenerator only exist in workers there)
 *   - 'frames':  everything else sends ImageBitmaps and gets the composited ImageBitmaps back
 */

// Segmentation input: the models run at 256x256 and the mask comes back at the input size. A short side
// of 256 keeps every model row and column (a 256 px wide landscape input squashes 256 rows into 144)
const SEGMENT_SIZE = 256;
// Slower than this on average, the multiclass model gives way to the selfie model on the CPU
const MAX_MULTICLASS_SEGMENT_MS = 50;
const MODEL_WARMUP_SEGMENTS = 20;
const MAX_FRAME_SKIP = 3;
const SEGMENTER_NAME = 'mirotalk-vb-segmenter';
const SEGMENTER_INIT_TIMEOUT_MS = 30000;
// No mask back in this time: the segmenter worker is considered dead and segmentation moves here
const SEGMENTER_STALL_MS = 3000;
const FIRST_MASK_TIMEOUT_MS = 1000;
// The segmenter rests at least this share of its segmentation time between masks: a GPU model run
// back to back competes with the compositor and the video encoder for the GPU
const SEGMENTER_REST_RATIO = 0.5;
// Soft edge for image / transparent backgrounds, in frame pixels (as the main-thread engine)
const SOFT_EDGE_PX = 5;

const PRE_SOFTENED = Object.freeze({ softenMask: false });

let segmenter = null;
let effects = null;
let vision = null;
let fileset = null;
let workerConfig = null;
let model = null;
let downgrading = false;
let segmentCount = 0;
let stabilizeMask = null;
let maskSource = null;
let lastTimestamp = -1;
let controlQueue = Promise.resolve();

const session = {
    id: 0,
    abort: null,
    done: null,
    track: null,
    lastTimestamp: -1,
};

// The nested segmenter worker, as seen from the compositor
const remote = {
    worker: null,
    busy: false,
    sentAt: 0,
    doneAt: 0,
    segmentMs: 0,
    generation: 0,
    firstMask: null,
};

const compositor = {
    canvas: null,
    ctx: null,
    gl: null,
    invertBuffer: null,
    maskCanvas: null,
    maskCtx: null,
    maskImage: null,
    softMaskCanvas: null,
    softMaskCtx: null,
    maskFrameWidth: 0,
    hasMask: false,
    handler: null,
    background: null,
    gifBitmap: null,
    frameCounter: 0,
    skipRatio: 1,
    segmentMs: 0,
    frameIntervalMs: 1000 / 30,
    lastFrameAt: 0,
};

function errorMessage(error) {
    return String(error?.message || error);
}

async function createSegmenter(modelUrl, delegate) {
    return vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl, delegate },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
    });
}

function useSegmenter(next, candidate) {
    const previous = segmenter;
    segmenter = next;
    model = candidate;
    maskSource = null;
    segmentCount = 0;
    compositor.segmentMs = 0;
    stabilizeMask?.reset();
    try {
        previous?.close();
    } catch (error) {
        // already closed
    }
}

// The multiclass model needs the GPU delegate to be fast enough: without it, use the selfie model
async function loadModel(config) {
    const candidates = [];
    if (config.multiclassModelUrl) {
        candidates.push({ name: 'multiclass', url: config.multiclassModelUrl, delegate: 'GPU' });
    }
    candidates.push({ name: 'selfie', url: config.modelUrl, delegate: config.delegate });
    if (config.delegate === 'GPU') candidates.push({ name: 'selfie', url: config.modelUrl, delegate: 'CPU' });
    let lastError;
    for (const candidate of candidates) {
        try {
            useSegmenter(await createSegmenter(candidate.url, candidate.delegate), candidate);
            return;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

async function downgradeModel() {
    downgrading = true;
    try {
        const candidate = { name: 'selfie', url: workerConfig.modelUrl, delegate: 'CPU' };
        useSegmenter(await createSegmenter(candidate.url, candidate.delegate), candidate);
        console.warn('Virtual background: multiclass segmentation too slow, using the selfie model');
    } catch (error) {
        console.warn('Virtual background: selfie model fallback failed', error);
    } finally {
        downgrading = false;
    }
}

// Runs the model and hands the person confidence (0..1, row-major) to onMask
function segmentInput(input, timestamp, onMask) {
    // MediaPipe requires strictly increasing timestamps in VIDEO mode
    const ts = Math.max(Math.round(timestamp), lastTimestamp + 1);
    lastTimestamp = ts;
    segmenter.segmentForVideo(input, ts, (result) => {
        const masks = result?.confidenceMasks;
        if (!masks?.length) return;
        maskSource ??= pickMaskSource(masks);
        const mask = masks[maskSource.index] || masks[0];
        const values = mask.getAsFloat32Array();
        onMask(maskSource.invert ? invert(values) : values, mask.width, mask.height);
    });
}

function recordSegmentMs(elapsed) {
    compositor.segmentMs = compositor.segmentMs ? compositor.segmentMs * 0.8 + elapsed * 0.2 : elapsed;
    // Keep segmentation within half of the frame budget, reusing the last mask in between
    const budget = compositor.frameIntervalMs / 2;
    compositor.skipRatio = Math.min(MAX_FRAME_SKIP, Math.max(1, Math.ceil(compositor.segmentMs / budget)));
    segmentCount++;
    if (
        model?.name === 'multiclass' &&
        !downgrading &&
        segmentCount > MODEL_WARMUP_SEGMENTS &&
        compositor.segmentMs > MAX_MULTICLASS_SEGMENT_MS
    ) {
        void downgradeModel();
    }
}

async function loadSegmenter(config) {
    vision = await import(config.visionBundleUrl);
    // true: load the ES module build of the WASM loader, module workers have no importScripts()
    fileset = await vision.FilesetResolver.forVisionTasks(config.wasmBaseUrl, true);
    await loadModel(config);
}

function resizeForSegmentation(source, width, height) {
    const [resizeWidth, resizeHeight] = segmentSize(width, height);
    if (resizeWidth >= width) return createImageBitmap(source);
    return createImageBitmap(source, { resizeWidth, resizeHeight, resizeQuality: 'low' }).catch(() =>
        // Resize options unsupported: segment the full frame
        createImageBitmap(source)
    );
}

// ####################################################
// NESTED SEGMENTER WORKER (compositor side)
// ####################################################

function startRemoteSegmenter(config) {
    if (typeof Worker !== 'function' || !config.segmenterUrl) return Promise.resolve(false);
    return new Promise((resolve) => {
        let worker;
        const timer = setTimeout(() => finish(new Error('segmenter init timed out')), SEGMENTER_INIT_TIMEOUT_MS);
        const finish = (error, info) => {
            clearTimeout(timer);
            if (error) {
                console.warn('Virtual background segmenter worker unavailable, segmenting in this worker', error);
                worker?.terminate();
                resolve(false);
                return;
            }
            remote.worker = worker;
            worker.onmessage = (event) => onRemoteMessage(event.data || {});
            worker.onerror = (event) => {
                event.preventDefault?.();
                void failRemote(new Error(event.message || 'segmenter worker failed'));
            };
            model = { name: info.model, delegate: info.delegate };
            resolve(true);
        };
        try {
            worker = new Worker(config.segmenterUrl, { type: 'module', name: SEGMENTER_NAME });
        } catch (error) {
            finish(error);
            return;
        }
        worker.onmessage = (event) => {
            const message = event.data || {};
            if (message.type === 'ready') finish(null, message);
            else if (message.type === 'error') finish(new Error(message.message));
        };
        worker.onerror = (event) => {
            event.preventDefault?.();
            finish(new Error(event.message || 'segmenter worker failed to load'));
        };
        worker.postMessage({ type: 'init', config });
    });
}

function onRemoteMessage(message) {
    if (message.type !== 'mask') return;
    remote.busy = false;
    remote.doneAt = performance.now();
    const elapsed = remote.doneAt - remote.sentAt;
    remote.segmentMs = remote.segmentMs ? remote.segmentMs * 0.8 + elapsed * 0.2 : elapsed;
    if (message.model) model = { name: message.model, delegate: message.delegate };
    if (message.generation === remote.generation && message.values) {
        applyMask(message.values, message.width, message.height);
    }
    remote.firstMask?.resolve();
    remote.firstMask = null;
}

// The segmenter worker died or hangs: segment in this worker from now on
async function failRemote(error) {
    if (!remote.worker) return;
    console.warn('Virtual background segmenter worker failed, segmenting in this worker', error);
    remote.worker.terminate();
    remote.worker = null;
    remote.busy = false;
    remote.firstMask?.resolve();
    remote.firstMask = null;
    try {
        await loadSegmenter(workerConfig);
    } catch (loadError) {
        console.error('Virtual background segmentation unavailable', loadError);
    }
}

// Sends a downscaled copy of the frame when the segmenter is free; never waits for the mask
async function requestRemoteMask(source, width, height, timestamp) {
    if (remote.busy) {
        if (performance.now() - remote.sentAt > SEGMENTER_STALL_MS) void failRemote(new Error('segmenter stalled'));
        return;
    }
    if (compositor.hasMask && performance.now() - remote.doneAt < remote.segmentMs * SEGMENTER_REST_RATIO) return;
    remote.busy = true;
    remote.sentAt = performance.now();
    let bitmap;
    try {
        bitmap = await resizeForSegmentation(source, width, height);
    } catch (error) {
        remote.busy = false;
        return;
    }
    if (!remote.worker) {
        bitmap.close();
        return;
    }
    compositor.maskFrameWidth = width;
    if (!compositor.hasMask && !remote.firstMask) {
        let resolve;
        const promise = new Promise((done) => (resolve = done));
        remote.firstMask = { promise, resolve };
    }
    remote.worker.postMessage({ type: 'segment', bitmap, timestamp, generation: remote.generation }, [bitmap]);
}

// Before the first mask there is nothing to composite with: wait for it rather than send the room
async function waitFirstMask() {
    if (compositor.hasMask || !remote.firstMask) return;
    let timer;
    await Promise.race([
        remote.firstMask.promise,
        new Promise((resolve) => (timer = setTimeout(resolve, FIRST_MASK_TIMEOUT_MS))),
    ]);
    clearTimeout(timer);
}

// One mask per frame at most, as long as the segmenter keeps up
async function updateMask(source, width, height, timeMs) {
    if (remote.worker) {
        trackFrameInterval(timeMs);
        await requestRemoteMask(source, width, height, timeMs);
        await waitFirstMask();
        return;
    }
    if (segmenter && shouldSegment(timeMs)) await segment(source, width, height, timeMs);
}

// ####################################################
// SEGMENTER ROLE (nested worker)
// ####################################################

function segmentForCompositor({ bitmap, timestamp, generation }) {
    const started = performance.now();
    let reply = { type: 'mask', generation, values: null };
    try {
        segmentInput(bitmap, timestamp, (values, width, height) => {
            reply = { type: 'mask', generation, values: values.slice(), width, height };
        });
    } catch (error) {
        console.warn('Virtual background segmentation failed', error);
    } finally {
        closeBitmap(bitmap);
    }
    recordSegmentMs(performance.now() - started);
    reply.model = model?.name;
    reply.delegate = model?.delegate;
    self.postMessage(reply, reply.values ? [reply.values.buffer] : []);
}

function runSegmenterRole() {
    self.onmessage = (event) => {
        const message = event.data || {};
        switch (message.type) {
            case 'init':
                workerConfig = message.config;
                loadSegmenter(message.config).then(
                    () => self.postMessage({ type: 'ready', model: model.name, delegate: model.delegate }),
                    (error) => self.postMessage({ type: 'error', stage: 'init', message: errorMessage(error) })
                );
                break;
            case 'segment':
                segmentForCompositor(message);
                break;
            default:
                break;
        }
    };
}

async function loadGl(url) {
    try {
        await import(url);
        compositor.gl = globalThis.VirtualBackgroundGL.createCompositor(new OffscreenCanvas(1, 1));
    } catch (error) {
        console.warn('Virtual background WebGL compositor unavailable, using Canvas2D', error);
        compositor.gl = null;
    }
}

// The Canvas2D handlers take over: they want the edge-tightened mask in canvases
function disableGl() {
    try {
        compositor.gl?.destroy();
    } catch (error) {
        // the context is gone anyway
    }
    compositor.gl = null;
    stabilizeMask = null;
    if (compositor.maskImage) drawMaskCanvases(compositor.maskImage.width, compositor.maskImage.height);
}

async function init(config) {
    workerConfig = config;
    await import(config.effectsUrl);
    effects = globalThis.VirtualBackgroundEffects;
    if (config.glUrl) await loadGl(config.glUrl);
    if (!(await startRemoteSegmenter(config))) await loadSegmenter(config);
    return {
        model: model.name,
        delegate: model.delegate,
        gl: Boolean(compositor.gl),
        segmenter: remote.worker ? 'worker' : 'inline',
        trackProcessor: typeof MediaStreamTrackProcessor === 'function' && typeof VideoTrackGenerator === 'function',
    };
}

function ensureCanvas(width, height) {
    if (!compositor.canvas) {
        compositor.canvas = new OffscreenCanvas(width, height);
        compositor.ctx = compositor.canvas.getContext('2d');
    } else if (compositor.canvas.width !== width || compositor.canvas.height !== height) {
        compositor.canvas.width = width;
        compositor.canvas.height = height;
    }
    return compositor.ctx;
}

// Person confidence: the person / foreground mask, or the inverted background of multiclass models
function pickMaskSource(masks) {
    if (masks.length < 2) return { index: 0, invert: false };
    const labels = segmenter.getLabels?.() || [];
    const person = labels.findIndex((label) => /person|foreground/i.test(label));
    if (person >= 0) return { index: person, invert: false };
    const background = labels.findIndex((label) => /background/i.test(label));
    if (background >= 0) return { index: background, invert: true };
    return { index: masks.length - 1, invert: false };
}

function invert(values) {
    if (compositor.invertBuffer?.length !== values.length) compositor.invertBuffer = new Float32Array(values.length);
    const inverted = compositor.invertBuffer;
    for (let i = 0; i < values.length; i++) inverted[i] = 1 - values[i];
    return inverted;
}

// The mask image alpha is the person confidence, as the WebGL compositor and the shared handlers expect
function applyMask(values, width, height) {
    if (!compositor.maskImage || compositor.maskImage.width !== width || compositor.maskImage.height !== height) {
        compositor.maskImage = new ImageData(width, height);
        compositor.maskImage.data.fill(255);
    }
    // Temporally stabilized person confidence, edge-tightened for the Canvas2D handlers
    stabilizeMask ??= effects.createMaskStabilizer({ edgeCurve: !compositor.gl });
    const confidence = stabilizeMask(values);
    const pixels = compositor.maskImage.data;
    for (let i = 0, alpha = 3; i < confidence.length; i++, alpha += 4) {
        pixels[alpha] = confidence[i] * 255;
    }
    if (compositor.gl) compositor.gl.setMask(compositor.maskImage);
    else drawMaskCanvases(width, height);
    compositor.hasMask = true;
}

function drawMaskCanvases(width, height) {
    if (!compositor.maskCanvas) {
        compositor.maskCanvas = new OffscreenCanvas(width, height);
        compositor.maskCtx = compositor.maskCanvas.getContext('2d');
    } else if (compositor.maskCanvas.width !== width || compositor.maskCanvas.height !== height) {
        compositor.maskCanvas.width = width;
        compositor.maskCanvas.height = height;
    }
    compositor.maskCtx.putImageData(compositor.maskImage, 0, 0);
    softenMask(width, height);
}

// Blur the mask once per segmentation, at mask resolution, instead of at frame size on every frame
function softenMask(width, height) {
    if (!compositor.softMaskCanvas) {
        compositor.softMaskCanvas = new OffscreenCanvas(width, height);
        compositor.softMaskCtx = compositor.softMaskCanvas.getContext('2d');
    } else if (compositor.softMaskCanvas.width !== width || compositor.softMaskCanvas.height !== height) {
        compositor.softMaskCanvas.width = width;
        compositor.softMaskCanvas.height = height;
    }
    const ctx = compositor.softMaskCtx;
    const radius = Math.max(1, (SOFT_EDGE_PX * width) / (compositor.maskFrameWidth || width));
    ctx.clearRect(0, 0, width, height);
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(compositor.maskCanvas, 0, 0);
}

async function segment(source, width, height, timestamp) {
    const started = performance.now();
    let input = source;
    if (segmentSize(width, height)[0] < width) {
        try {
            input = await resizeForSegmentation(source, width, height);
        } catch (error) {
            input = source;
        }
    }
    compositor.maskFrameWidth = width;
    try {
        segmentInput(input, timestamp, applyMask);
    } finally {
        if (input !== source) input.close();
    }
    recordSegmentMs(performance.now() - started);
}

function segmentSize(width, height) {
    const scale = Math.min(1, SEGMENT_SIZE / Math.min(width, height));
    return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

function trackFrameInterval(timeMs) {
    const interval = timeMs - compositor.lastFrameAt;
    if (compositor.lastFrameAt && interval > 0 && interval < 1000) {
        compositor.frameIntervalMs = compositor.frameIntervalMs * 0.9 + interval * 0.1;
    }
    compositor.lastFrameAt = timeMs;
}

function shouldSegment(timeMs) {
    trackFrameInterval(timeMs);
    const due = !compositor.hasMask || compositor.frameCounter % compositor.skipRatio === 0;
    compositor.frameCounter++;
    return due;
}

function glView() {
    const background = compositor.background;
    switch (background.kind) {
        case 'blur':
            return { kind: 'blur', blurLevel: background.blurLevel };
        case 'image':
            return { kind: 'image', source: background.bitmap };
        case 'gif':
            return { kind: 'image', source: compositor.gifBitmap };
        default:
            return { kind: 'transparent' };
    }
}

// Returns the canvas holding the composited frame
function composite(frame, width, height) {
    const gl = compositor.gl;
    if (gl) {
        try {
            if (gl.lost) throw new Error('WebGL context lost');
            if (gl.render(frame, width, height, glView())) return gl.canvas;
        } catch (error) {
            console.warn('Virtual background WebGL compositor failed, using Canvas2D', error);
            disableGl();
        }
    }
    const ctx = ensureCanvas(width, height);
    const canvas = compositor.canvas;
    ctx.save();
    try {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(frame, 0, 0, width, height);
        // Blur keeps the sharp mask (as the main-thread engine), the others use the softened one
        const mask = compositor.background.kind === 'blur' ? compositor.maskCanvas : compositor.softMaskCanvas;
        compositor.handler(ctx, canvas, mask, frame);
    } finally {
        ctx.restore();
    }
    return canvas;
}

function ready() {
    return compositor.hasMask && compositor.handler;
}

// Output timestamps must increase: some sources (WebKit canvas capture) stamp every frame 0, and a
// generator fed equal timestamps shows the first frame forever
function outputTimestamp(frame) {
    const timestamp =
        frame.timestamp > session.lastTimestamp
            ? frame.timestamp
            : Math.max(session.lastTimestamp + 1, Math.round(performance.now() * 1000));
    session.lastTimestamp = timestamp;
    return timestamp;
}

async function transformFrame(frame, controller) {
    let enqueued = false;
    try {
        const width = frame.displayWidth;
        const height = frame.displayHeight;
        const timestamp = outputTimestamp(frame);
        const timeMs = timestamp / 1000;
        await updateMask(frame, width, height, timeMs);
        if (!ready()) {
            if (timestamp === frame.timestamp) {
                controller.enqueue(frame);
                enqueued = true;
            } else {
                controller.enqueue(new VideoFrame(frame, { timestamp }));
            }
            return;
        }
        const output = composite(frame, width, height);
        controller.enqueue(new VideoFrame(output, { timestamp, alpha: 'keep' }));
    } finally {
        if (!enqueued) frame.close();
    }
}

async function processBitmap({ id, session: sessionId, bitmap, timestamp }) {
    if (sessionId !== session.id) {
        bitmap.close();
        self.postMessage({ type: 'frame', id, bitmap: null });
        return;
    }
    try {
        const { width, height } = bitmap;
        await updateMask(bitmap, width, height, timestamp);
        if (!ready()) {
            self.postMessage({ type: 'frame', id, bitmap }, [bitmap]);
            return;
        }
        const canvas = composite(bitmap, width, height);
        bitmap.close();
        const output = canvas.transferToImageBitmap();
        self.postMessage({ type: 'frame', id, bitmap: output }, [output]);
    } catch (error) {
        bitmap.close();
        self.postMessage({ type: 'error', id, message: errorMessage(error) });
    }
}

function runPipeline(readable, writable, id) {
    const abort = new AbortController();
    session.abort = abort;
    const transformer = new TransformStream({ transform: transformFrame });
    session.done = readable
        .pipeThrough(transformer, { signal: abort.signal })
        .pipeTo(writable, { signal: abort.signal })
        .then(() => {
            if (session.id === id) self.postMessage({ type: 'pipeline-ended', session: id });
        })
        .catch((error) => {
            if (!abort.signal.aborted && session.id === id) {
                self.postMessage({ type: 'pipeline-error', session: id, message: errorMessage(error) });
            }
        });
}

function closeBitmap(bitmap) {
    try {
        bitmap?.close();
    } catch (error) {
        // already closed
    }
}

function setBackground(background) {
    const previous = compositor.background;
    const previousGif = compositor.gifBitmap;
    compositor.background = background;
    compositor.gifBitmap = background.kind === 'gif' ? background.bitmap : null;
    switch (background.kind) {
        case 'blur':
            compositor.handler = effects.createBlurMaskHandler(background.blurLevel);
            break;
        case 'image':
            compositor.handler = effects.createImageMaskHandler(background.bitmap, undefined, PRE_SOFTENED);
            break;
        case 'gif':
            compositor.handler = effects.createImageMaskHandler(() => compositor.gifBitmap, undefined, PRE_SOFTENED);
            break;
        case 'transparent':
            compositor.handler = effects.createTransparentMaskHandler(undefined, PRE_SOFTENED);
            break;
        default:
            throw new Error(`Unknown virtual background: ${background.kind}`);
    }
    if (previous?.kind === 'image') closeBitmap(previous.bitmap);
    if (previousGif && previousGif !== compositor.gifBitmap) closeBitmap(previousGif);
}

function setGifFrame(bitmap) {
    if (compositor.background?.kind !== 'gif') {
        closeBitmap(bitmap);
        return;
    }
    const previous = compositor.gifBitmap;
    compositor.gifBitmap = bitmap;
    closeBitmap(previous);
}

async function stopSession() {
    session.abort?.abort('Processing stopped');
    try {
        await session.done;
    } catch (error) {
        // the pipeline reports its own errors
    }
    try {
        session.track?.stop();
    } catch (error) {
        // ignore
    }
    session.abort = null;
    session.done = null;
    session.track = null;
}

async function startSession(message) {
    await stopSession();
    session.id = message.session;
    session.lastTimestamp = -1;
    compositor.hasMask = false;
    stabilizeMask?.reset();
    // Masks still on their way belong to the previous camera
    remote.generation++;
    remote.firstMask?.resolve();
    remote.firstMask = null;
    compositor.frameCounter = 0;
    compositor.lastFrameAt = 0;
    if (message.mode === 'streams') {
        runPipeline(message.readable, message.writable, message.session);
        return {};
    }
    if (message.mode === 'track') {
        const processor = new MediaStreamTrackProcessor({ track: message.track });
        const generator = new VideoTrackGenerator();
        session.track = message.track;
        runPipeline(processor.readable, generator.writable, message.session);
        return { track: generator.track, transfer: [generator.track] };
    }
    return {};
}

async function handleControl(message) {
    const { id } = message;
    try {
        switch (message.type) {
            case 'start': {
                const { transfer = [], ...result } = await startSession(message);
                self.postMessage({ type: 'ack', id, ...result }, transfer);
                break;
            }
            case 'background':
                setBackground(message.background);
                self.postMessage({ type: 'ack', id });
                break;
            case 'stop':
                if (message.session === session.id) {
                    await stopSession();
                    session.id = 0;
                }
                self.postMessage({ type: 'ack', id });
                break;
            default:
                break;
        }
    } catch (error) {
        if (message.type === 'start') {
            message.track?.stop();
            session.id = 0;
        }
        self.postMessage({ type: 'error', id, message: errorMessage(error) });
    }
}

function runCompositorRole() {
    self.onmessage = (event) => {
        const message = event.data || {};
        switch (message.type) {
            case 'init':
                init(message.config).then(
                    (info) => self.postMessage({ type: 'ready', ...info }),
                    (error) => self.postMessage({ type: 'error', stage: 'init', message: errorMessage(error) })
                );
                break;
            case 'frame':
                // The page sends the next frame only after receiving the previous one
                void processBitmap(message);
                break;
            case 'gif-frame':
                setGifFrame(message.bitmap);
                break;
            case 'close':
                controlQueue = controlQueue.then(async () => {
                    await stopSession();
                    try {
                        segmenter?.close();
                    } catch (error) {
                        // ignore, the worker is going away
                    }
                    segmenter = null;
                    remote.worker?.terminate();
                    remote.worker = null;
                    self.close();
                });
                break;
            default:
                // start / background / stop run in order, a start waits for the previous session to stop
                controlQueue = controlQueue.then(() => handleControl(message));
                break;
        }
    };
}

if (self.name === SEGMENTER_NAME) runSegmenterRole();
else runCompositorRole();
