/**
 * MiroTalk virtual background worker (module worker).
 *
 * Runs MediaPipe Image Segmenter (selfie model, Apache-2.0) and the background compositing off the
 * main thread. The page picks the frame transport the browser supports:
 *   - 'streams': Chromium transfers the MediaStreamTrackProcessor / Generator streams
 *   - 'track':   Safari 18+ transfers the camera track (MediaStreamTrackProcessor and
 *                VideoTrackGenerator only exist in workers there)
 *   - 'frames':  everything else sends ImageBitmaps and gets the composited ImageBitmaps back
 */

// Segmentation input width: the model runs at 256x256 and the mask comes back at the input size,
// so a wider input only costs more mask pixels for the same edges
const SEGMENT_WIDTH = 256;
const MAX_FRAME_SKIP = 3;
// Soft edge for image / transparent backgrounds, in frame pixels (as the main-thread engine)
const SOFT_EDGE_PX = 5;

const PRE_SOFTENED = Object.freeze({ softenMask: false });

let segmenter = null;
let effects = null;
let maskIndex = null;
let lastTimestamp = -1;
let controlQueue = Promise.resolve();

const session = {
    id: 0,
    abort: null,
    done: null,
    track: null,
    lastTimestamp: -1,
};

const compositor = {
    canvas: null,
    ctx: null,
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

async function createSegmenter(vision, fileset, config, delegate) {
    return vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: config.modelUrl, delegate },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
    });
}

async function init(config) {
    await import(config.effectsUrl);
    effects = globalThis.VirtualBackgroundEffects;
    const vision = await import(config.visionBundleUrl);
    // true: load the ES module build of the WASM loader, module workers have no importScripts()
    const fileset = await vision.FilesetResolver.forVisionTasks(config.wasmBaseUrl, true);
    let delegate = config.delegate;
    try {
        segmenter = await createSegmenter(vision, fileset, config, delegate);
    } catch (error) {
        if (delegate !== 'GPU') throw error;
        delegate = 'CPU';
        segmenter = await createSegmenter(vision, fileset, config, delegate);
    }
    return {
        delegate,
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

function pickMaskIndex(masks) {
    if (masks.length < 2) return 0;
    const labels = segmenter.getLabels?.() || [];
    const person = labels.findIndex((label) => /person|foreground/i.test(label));
    return person >= 0 ? person : masks.length - 1;
}

// The mask canvas alpha is the person confidence, as the shared mask handlers expect
function writeMask(result) {
    const masks = result?.confidenceMasks;
    if (!masks?.length) return;
    if (maskIndex === null) maskIndex = pickMaskIndex(masks);
    const mask = masks[maskIndex] || masks[0];
    const { width, height } = mask;
    if (!compositor.maskCanvas) {
        compositor.maskCanvas = new OffscreenCanvas(width, height);
        compositor.maskCtx = compositor.maskCanvas.getContext('2d');
    }
    if (!compositor.maskImage || compositor.maskImage.width !== width || compositor.maskImage.height !== height) {
        compositor.maskCanvas.width = width;
        compositor.maskCanvas.height = height;
        compositor.maskImage = new ImageData(width, height);
        compositor.maskImage.data.fill(255);
    }
    const confidence = mask.getAsFloat32Array();
    const pixels = compositor.maskImage.data;
    for (let i = 0, alpha = 3; i < confidence.length; i++, alpha += 4) {
        pixels[alpha] = confidence[i] * 255;
    }
    compositor.maskCtx.putImageData(compositor.maskImage, 0, 0);
    softenMask(width, height);
    compositor.hasMask = true;
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
    let resized = null;
    const segmentWidth = Math.min(width, SEGMENT_WIDTH);
    if (segmentWidth < width) {
        try {
            resized = await createImageBitmap(source, {
                resizeWidth: segmentWidth,
                resizeHeight: Math.max(1, Math.round((height * segmentWidth) / width)),
                resizeQuality: 'low',
            });
            input = resized;
        } catch (error) {
            // Resize options unsupported: segment the full frame
        }
    }
    compositor.maskFrameWidth = width;
    try {
        // MediaPipe requires strictly increasing timestamps in VIDEO mode
        const ts = Math.max(Math.round(timestamp), lastTimestamp + 1);
        lastTimestamp = ts;
        segmenter.segmentForVideo(input, ts, writeMask);
    } finally {
        resized?.close();
    }
    const elapsed = performance.now() - started;
    compositor.segmentMs = compositor.segmentMs ? compositor.segmentMs * 0.8 + elapsed * 0.2 : elapsed;
    // Keep segmentation within half of the frame budget, reusing the last mask in between
    const budget = compositor.frameIntervalMs / 2;
    compositor.skipRatio = Math.min(MAX_FRAME_SKIP, Math.max(1, Math.ceil(compositor.segmentMs / budget)));
}

function shouldSegment(timeMs) {
    const interval = timeMs - compositor.lastFrameAt;
    if (compositor.lastFrameAt && interval > 0 && interval < 1000) {
        compositor.frameIntervalMs = compositor.frameIntervalMs * 0.9 + interval * 0.1;
    }
    compositor.lastFrameAt = timeMs;
    const due = !compositor.hasMask || compositor.frameCounter % compositor.skipRatio === 0;
    compositor.frameCounter++;
    return due;
}

function composite(frame, width, height) {
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
        if (shouldSegment(timeMs)) await segment(frame, width, height, timeMs);
        if (!ready()) {
            if (timestamp === frame.timestamp) {
                controller.enqueue(frame);
                enqueued = true;
            } else {
                controller.enqueue(new VideoFrame(frame, { timestamp }));
            }
            return;
        }
        composite(frame, width, height);
        controller.enqueue(new VideoFrame(compositor.canvas, { timestamp, alpha: 'keep' }));
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
        if (shouldSegment(timestamp)) await segment(bitmap, width, height, timestamp);
        if (!ready()) {
            self.postMessage({ type: 'frame', id, bitmap }, [bitmap]);
            return;
        }
        composite(bitmap, width, height);
        bitmap.close();
        const output = compositor.canvas.transferToImageBitmap();
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
                self.close();
            });
            break;
        default:
            // start / background / stop run in order, a start waits for the previous session to stop
            controlQueue = controlQueue.then(() => handleControl(message));
            break;
    }
};
