'use strict';

// Keep in sync with the selfie_segmentation script tag in Room.html (main-thread fallback engine)
const SELFIE_SEGMENTATION_VERSION = '0.1.1675465747';

// Keep in sync with video-effects/face-tracker.js: both share the cached tasks-vision WASM
const VB_TASKS_VISION_VERSION = '1.2.0';
const VB_TASKS_VISION = Object.freeze({
    visionBundleUrl: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VB_TASKS_VISION_VERSION}/vision_bundle.mjs`,
    wasmBaseUrl: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VB_TASKS_VISION_VERSION}/wasm`,
    modelUrl:
        'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
});

// The worker and the shared effects are resolved from this script location
const VB_BASE_URL =
    typeof document !== 'undefined' && document.currentScript?.src
        ? new URL('.', document.currentScript.src).href
        : null;

/**
 * Runs segmentation + compositing in a module worker (VirtualBackgroundWorker.js) and moves the
 * camera frames there with the best transport of the browser: transferred track processor streams
 * (Chromium), ImageBitmap round trips (Firefox, Safari, others) or, opt-in, track transfer (Safari 18+).
 */
class VirtualBackgroundWorkerEngine {
    static isSupported(baseUrl = VB_BASE_URL) {
        return Boolean(
            baseUrl &&
            typeof Worker !== 'undefined' &&
            typeof OffscreenCanvas !== 'undefined' &&
            typeof createImageBitmap === 'function'
        );
    }

    // trackTransfer: Safari 18+ worker-side track processing. Off by default: in WebKit testing
    // (Playwright WebKit 27.2) VideoTrackGenerator output froze on screen even for untouched frames,
    // while the ImageBitmap transport stayed live. Enable once verified on a real Safari camera.
    constructor({
        baseUrl = VB_BASE_URL,
        initTimeoutMs = 30000,
        requestTimeoutMs = 10000,
        trackTransfer = false,
    } = {}) {
        this.baseUrl = baseUrl;
        this.trackTransfer = trackTransfer;
        this.initTimeoutMs = initTimeoutMs;
        this.requestTimeoutMs = requestTimeoutMs;
        this.worker = null;
        this.capabilities = {};
        this.pending = new Map();
        this.sequence = 0;
        this.sessions = new Map();
        this.failed = false;
    }

    init() {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.terminate(new Error('Virtual background worker init timed out'));
                reject(new Error('Virtual background worker init timed out'));
            }, this.initTimeoutMs);
            const done = (error, info) => {
                clearTimeout(timer);
                this.initHandlers = null;
                if (error) {
                    this.terminate(error);
                    reject(error);
                } else {
                    this.capabilities = info;
                    resolve(this);
                }
            };
            this.initHandlers = done;
            try {
                this.worker = new Worker(new URL('VirtualBackgroundWorker.js', this.baseUrl), { type: 'module' });
            } catch (error) {
                done(error);
                return;
            }
            this.worker.onmessage = (event) => this.onMessage(event.data || {});
            this.worker.onerror = (event) => {
                event.preventDefault?.();
                this.terminate(new Error(event.message || 'Virtual background worker failed'));
            };
            this.worker.postMessage({
                type: 'init',
                config: {
                    ...VB_TASKS_VISION,
                    effectsUrl: new URL('VirtualBackgroundEffects.js', this.baseUrl).href,
                    // CPU (XNNPACK, WASM SIMD) is reliable everywhere and keeps the GPU for encoding
                    delegate: 'CPU',
                },
            });
        });
    }

    onMessage(message) {
        if (message.type === 'ready') {
            const { type, ...info } = message;
            this.initHandlers?.(null, info);
            return;
        }
        if (message.type === 'error' && message.stage === 'init') {
            this.initHandlers?.(new Error(message.message));
            return;
        }
        if (message.type === 'pipeline-ended' || message.type === 'pipeline-error') {
            const session = this.sessions.get(message.session);
            if (message.type === 'pipeline-error') {
                console.error('❌ Virtual background worker pipeline error:', message.message);
            }
            session?.onEnded?.();
            return;
        }
        const request = this.pending.get(message.id);
        if (!request) {
            message.bitmap?.close?.();
            return;
        }
        this.pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.type === 'error') request.reject(new Error(message.message));
        else request.resolve(message);
    }

    request(message, transfer = [], timeoutMs = this.requestTimeoutMs) {
        if (!this.worker) return Promise.reject(new Error('Virtual background worker is not running'));
        const id = ++this.sequence;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Virtual background worker ${message.type} timed out`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try {
                this.worker.postMessage({ ...message, id }, transfer);
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(error);
            }
        });
    }

    setBackground(background) {
        const transfer = background.bitmap ? [background.bitmap] : [];
        return this.request({ type: 'background', background }, transfer);
    }

    sendGifFrame(bitmap) {
        if (!this.worker) {
            bitmap.close();
            return;
        }
        this.worker.postMessage({ type: 'gif-frame', bitmap }, [bitmap]);
    }

    canTransferStreams() {
        try {
            const stream = new ReadableStream();
            const channel = new MessageChannel();
            channel.port1.postMessage(stream, [stream]);
            channel.port1.close();
            channel.port2.close();
            return true;
        } catch (error) {
            return false;
        }
    }

    // Resolves { id, mode, outputTrack, stream }; onEnded fires when the pipeline ends on its own
    async start(videoTrack, { onEnded, createGenerator, supportsTrackPipeline }) {
        const session = { id: ++this.sequence, onEnded: () => onEnded?.(session), stopped: false };
        this.sessions.set(session.id, session);
        try {
            if (this.trackTransfer && this.capabilities.trackProcessor) {
                try {
                    return await this.startTrack(session, videoTrack);
                } catch (error) {
                    if (!this.worker) throw error;
                    console.warn('⚠️ Camera track transfer unavailable, trying another transport', error);
                }
            }
            if (supportsTrackPipeline && this.canTransferStreams()) {
                return await this.startStreams(session, videoTrack, createGenerator);
            }
            return await this.startFrames(session, videoTrack);
        } catch (error) {
            this.sessions.delete(session.id);
            throw error;
        }
    }

    async startTrack(session, videoTrack) {
        // Transfer a clone: the page keeps the original camera track to release it later
        const clone = videoTrack.clone();
        let reply;
        try {
            reply = await this.request({ type: 'start', session: session.id, mode: 'track', track: clone }, [clone]);
        } catch (error) {
            clone.stop();
            throw error;
        }
        return Object.assign(session, {
            mode: 'track',
            outputTrack: reply.track,
            stream: new MediaStream([reply.track]),
        });
    }

    async startStreams(session, videoTrack, createGenerator) {
        const processor = new MediaStreamTrackProcessor({ track: videoTrack });
        const { generator, track } = createGenerator();
        await this.request(
            {
                type: 'start',
                session: session.id,
                mode: 'streams',
                readable: processor.readable,
                writable: generator.writable,
            },
            [processor.readable, generator.writable]
        );
        return Object.assign(session, { mode: 'streams', outputTrack: track, stream: new MediaStream([track]) });
    }

    async startFrames(session, videoTrack) {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('aria-hidden', 'true');
        video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
        video.srcObject = new MediaStream([videoTrack]);
        document.body.appendChild(video);
        const canvas = document.createElement('canvas');
        const onCameraEnded = () => session.onEnded();
        Object.assign(session, { mode: 'frames', video, canvas, cameraTrack: videoTrack, onCameraEnded, timer: null });
        videoTrack.addEventListener('ended', onCameraEnded, { once: true });
        try {
            await video.play();
            await this.request({ type: 'start', session: session.id, mode: 'frames' });
            const renderer = canvas.getContext('bitmaprenderer');
            if (!renderer) throw new Error('bitmaprenderer canvas context is not supported');
            const fps = Math.min(30, videoTrack.getSettings?.().frameRate || 30);
            const pump = async () => {
                const started = performance.now();
                if (session.stopped) return;
                if (video.videoWidth) {
                    const bitmap = await createImageBitmap(video);
                    if (session.stopped) return bitmap.close();
                    const reply = await this.request(
                        { type: 'frame', session: session.id, bitmap, timestamp: started },
                        [bitmap]
                    );
                    if (!reply.bitmap) return;
                    if (session.stopped) return reply.bitmap.close();
                    if (canvas.width !== reply.bitmap.width || canvas.height !== reply.bitmap.height) {
                        canvas.width = reply.bitmap.width;
                        canvas.height = reply.bitmap.height;
                    }
                    renderer.transferFromImageBitmap(reply.bitmap);
                }
                if (session.stopped) return;
                session.timer = setTimeout(
                    () => {
                        session.pump = pump().catch((error) => {
                            if (session.stopped) return;
                            console.error('❌ Virtual background frame failed:', error);
                            session.onEnded();
                        });
                    },
                    Math.max(0, 1000 / fps - (performance.now() - started))
                );
            };
            // Like the main-thread canvas fallback, return once the first frame is drawn
            session.pump = pump();
            await session.pump;
            if (session.stopped) throw new Error('Background processing stopped');
            const stream = canvas.captureStream(fps);
            return Object.assign(session, { outputTrack: stream.getVideoTracks()[0], stream });
        } catch (error) {
            await this.stopSession(session);
            throw error;
        }
    }

    async stopSession(session) {
        if (!session || session.stopped) return;
        session.stopped = true;
        this.sessions.delete(session.id);
        // Stop the output first: if the worker ended it (generator closed) it would fire 'ended', which
        // the room treats as a lost camera ('trackended' closes the producer)
        session.outputTrack?.stop();
        clearTimeout(session.timer);
        try {
            await session.pump;
        } catch (error) {
            // reported by the pump
        }
        try {
            await this.request({ type: 'stop', session: session.id }, [], 3000);
        } catch (error) {
            console.warn('⚠️ Virtual background worker stop failed', error);
        }
        if (session.mode === 'frames') {
            session.cameraTrack.removeEventListener('ended', session.onCameraEnded);
            session.video.pause();
            session.video.srcObject = null;
            session.video.remove();
        }
    }

    terminate(error = new Error('Virtual background worker stopped')) {
        this.failed = true;
        const worker = this.worker;
        this.worker = null;
        this.pending.forEach((request) => {
            clearTimeout(request.timer);
            request.reject(error);
        });
        this.pending.clear();
        this.sessions.forEach((session) => session.onEnded());
        worker?.terminate();
    }
}

class VirtualBackground {
    static instance = null;

    constructor() {
        // Ensure only one instance of VirtualBackground exists
        if (VirtualBackground.instance) {
            return VirtualBackground.instance;
        }
        VirtualBackground.instance = this;

        // Check for API support
        this.isSupported = this.checkSupport();

        // Segmentation runs in a worker when possible; the main-thread MediaPipe engine is the fallback
        this.useWorker = VirtualBackgroundWorkerEngine.isSupported();
        this.workerEnginePromise = null;
        this.workerEngine = null;

        this.resetState();
    }

    checkSupport() {
        if (this.supportsTrackPipeline() || this.supportsCanvasPipeline()) return true;
        console.warn('Virtual background requires track processing APIs or canvas captureStream and WebGL.');
        return false;
    }

    supportsCanvasPipeline() {
        if (typeof document === 'undefined') return false;
        const canvas = document.createElement('canvas');
        return (
            typeof canvas.captureStream === 'function' &&
            Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
        );
    }

    createCanvas(width, height) {
        if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    supportsTrackPipeline() {
        // Check if required APIs are supported.
        // Note: MediaStreamTrackGenerator is a non-standard/experimental API that newer
        // Chromium builds are phasing out in favor of VideoTrackGenerator, so accept either.
        const hasProcessor = Boolean(window.MediaStreamTrackProcessor);
        const hasTransformStream = Boolean(window.TransformStream);
        const hasGenerator = Boolean(window.MediaStreamTrackGenerator || window.VideoTrackGenerator);

        return hasProcessor && hasTransformStream && hasGenerator;
    }

    createVideoTrackGenerator() {
        // MediaStreamTrackGenerator (legacy, main-thread) is itself a MediaStreamTrack and exposes a writable.
        if (window.MediaStreamTrackGenerator) {
            const generator = new MediaStreamTrackGenerator({ kind: 'video' });
            return { generator, track: generator };
        }
        // VideoTrackGenerator (newer replacement) exposes a writable and a separate .track.
        if (window.VideoTrackGenerator) {
            const generator = new VideoTrackGenerator();
            return { generator, track: generator.track };
        }
        throw new Error('Neither MediaStreamTrackGenerator nor VideoTrackGenerator is available.');
    }

    resetState() {
        // Reset all necessary state variables
        this.segmentation = null;
        this.initialized = false;
        this.pendingFrames = [];
        this.activeProcessor = null;
        this.activeGenerator = null;
        this.activeOutputTrack = null;
        this.activeAbortController = null;
        this.activePipelinePromise = null;
        this.activeCanvas = null;
        this.activeSourceTrack = null;
        this.activeStream = null;
        this.activeMaskHandler = null;
        this.activeWorkerSession = null;
        this.gifPump = null;
        this.backgroundRequest = 0;
        this.frameCanvas = null;
        this.frameContext = null;
        this.isProcessing = false;
        this.gifAnimation = null;
        this.gifCanvas = null;
        this.frameCounter = 0;
        this.frameSkipRatio = 3;
        this.lastSegmentationMask = null;
    }

    async initializeSegmentation() {
        // Initialize the segmentation model if not already done
        if (this.initialized) {
            console.log('✅ Segmentation already initialized');
            return;
        }

        try {
            this.segmentation = new SelfieSegmentation({
                locateFile: (file) =>
                    `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@${SELFIE_SEGMENTATION_VERSION}/${file}`,
            });

            this.segmentation.setOptions({
                modelSelection: 0, // General (256x256) model: more accurate edges than landscape (1)
                runningMode: 'video', // Smoother segmentation for streaming
                smoothSegmentation: true, // Enables smoother edges
            });

            this.segmentation.onResults(this.handleSegmentationResults.bind(this));

            await this.segmentation.initialize();
            this.initialized = true;
            console.log('✅ Segmentation initialized successfully.');
        } catch (error) {
            console.error('❌ Error initializing segmentation:', error);
            throw error;
        }
    }

    handleSegmentationResults(results) {
        if (!results?.segmentationMask) return;

        if (this.activeCanvas) {
            const { canvas, context, video, signal } = this.activeCanvas;
            if (signal.aborted || !this.activeMaskHandler) return;
            context.save();
            try {
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.drawImage(results.image || video, 0, 0, canvas.width, canvas.height);
                this.activeMaskHandler(context, canvas, results.segmentationMask, results.image || video);
            } finally {
                context.restore();
            }
            return;
        }

        const pendingFrame = this.pendingFrames.shift();

        if (!pendingFrame) return;

        if (pendingFrame.signal.aborted) {
            this.closeFrames(pendingFrame.videoFrame, pendingFrame.imageBitmap);
            return;
        }

        this.lastSegmentationMask = results.segmentationMask;

        this.processFrame(
            pendingFrame.videoFrame,
            pendingFrame.controller,
            pendingFrame.imageBitmap,
            this.activeMaskHandler,
            this.lastSegmentationMask
        );
    }

    getFrameContext(width, height) {
        // Reuse one canvas for every frame: VideoFrame(canvas) snapshots its pixels
        if (!this.frameCanvas) {
            this.frameCanvas = new OffscreenCanvas(width, height);
            this.frameContext = this.frameCanvas.getContext('2d');
        } else if (this.frameCanvas.width !== width || this.frameCanvas.height !== height) {
            this.frameCanvas.width = width;
            this.frameCanvas.height = height;
        }
        return this.frameContext;
    }

    processFrame(videoFrame, controller, imageBitmap, maskHandler, segmentationMask) {
        if (!controller || !maskHandler) {
            console.warn('Controller or mask handler invalid, closing frames');
            this.closeFrames(videoFrame, imageBitmap);
            return;
        }

        try {
            const ctx = this.getFrameContext(videoFrame.displayWidth, videoFrame.displayHeight);
            const canvas = this.frameCanvas;

            ctx.save();
            try {
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // Apply original frame
                ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);

                // Apply mask processing
                maskHandler(ctx, canvas, segmentationMask, imageBitmap);
            } finally {
                ctx.restore();
            }

            // Create new video frame with the processed content
            const processedFrame = new VideoFrame(canvas, {
                timestamp: videoFrame.timestamp,
                alpha: 'keep', // Ensure transparency is preserved
            });

            try {
                // Enqueue the processed frame to continue the stream
                controller.enqueue(processedFrame);
            } catch (enqueueError) {
                console.warn('Failed to enqueue frame', enqueueError);
                // Close the processed frame if enqueue fails
                if (!processedFrame.closed) {
                    processedFrame.close();
                }
            }
        } catch (error) {
            console.error('❌ Frame processing error:', error);
        } finally {
            // Close frames after processing to release resources
            this.closeFrames(videoFrame, imageBitmap);
        }
    }

    closeFrames(videoFrame, imageBitmap) {
        if (videoFrame && !videoFrame.closed) {
            videoFrame.close();
        }
        if (imageBitmap && !imageBitmap.closed) {
            imageBitmap.close();
        }
    }

    async processStreamWithSegmentation(videoTrack, maskHandler) {
        // Check if the required APIs are supported
        if (!this.isSupported) {
            throw new Error(
                'Neither track processing nor canvas virtual backgrounds are supported in this environment.'
            );
        }

        // Stop current processing before starting new one
        await this.stopCurrentProcessor();

        // Initialize segmentation if not already done
        await this.initializeSegmentation();

        this.activeMaskHandler = maskHandler;
        this.activeSourceTrack = videoTrack;

        if (!this.supportsTrackPipeline()) {
            return this.processCanvasStream(videoTrack);
        }

        // Create new processor and generator for stream transformation
        const processor = new MediaStreamTrackProcessor({ track: videoTrack });
        const { generator, track: outputTrack } = this.createVideoTrackGenerator();
        const abortController = new AbortController();
        const { signal } = abortController;

        const transformer = new TransformStream({
            transform: async (videoFrame, controller) => {
                if (signal.aborted || !this.segmentation || !this.initialized) {
                    console.warn('⚠️ Segmentation is not initialized, skipping frame.');
                    this.closeFrames(videoFrame);
                    return;
                }

                let imageBitmap = null;

                try {
                    // Create image bitmap from video frame
                    imageBitmap = await createImageBitmap(videoFrame);

                    if (signal.aborted) {
                        this.closeFrames(videoFrame, imageBitmap);
                        return;
                    }

                    if (!imageBitmap) {
                        console.warn('⚠️ Failed to create imageBitmap, skipping frame.');
                        this.closeFrames(videoFrame);
                        return;
                    }

                    if (this.frameCounter % this.frameSkipRatio === 0) {
                        // Process only every 3rd frame (reduce CPU load)
                        this.pendingFrames.push({
                            videoFrame,
                            controller,
                            imageBitmap,
                            signal,
                        });

                        // Send the image to the segmentation model
                        await this.segmentation.send({ image: imageBitmap });
                    } else if (this.lastSegmentationMask) {
                        // Use last segmentation mask for skipped frames
                        this.processFrame(
                            videoFrame,
                            controller,
                            imageBitmap,
                            this.activeMaskHandler,
                            this.lastSegmentationMask
                        );
                    } else {
                        // If no previous mask, just enqueue the original frame
                        controller.enqueue(videoFrame);
                        imageBitmap.close();
                    }

                    this.frameCounter++; // Increment frame counter
                } catch (error) {
                    console.error('❌ Frame transformation error:', error);
                    this.closeFrames(videoFrame, imageBitmap);
                }
            },
            flush: () => {
                // Clean up any pending frames when the stream ends
                console.log('Transform stream flushing...');
                this.cleanPendingFrames();
            },
        });

        // Store active streams
        this.activeProcessor = processor;
        this.activeGenerator = generator;
        this.activeOutputTrack = outputTrack;
        this.activeAbortController = abortController;
        this.isProcessing = true;

        try {
            // Pipeline error handling without recursive calls
            const inputPromise = processor.readable.pipeTo(transformer.writable, { signal });
            const outputPromise = transformer.readable.pipeTo(generator.writable, { signal });
            this.activePipelinePromise = Promise.allSettled([inputPromise, outputPromise]);
            const pipelinePromise = Promise.all([inputPromise, outputPromise]);

            // Handle errors without awaiting (prevents blocking and recursion)
            pipelinePromise.catch(() => {
                // Only stop if we're still processing (avoid recursive calls)
                if (this.isProcessing && this.activeProcessor === processor) {
                    console.log('Stopping processor due to pipeline error...');
                    // Don't await this - let it run async to avoid recursion
                    this.stopCurrentProcessor().catch((stopError) => {
                        console.warn('Error during processor cleanup:', stopError);
                    });
                }
            });

            this.activeStream = new MediaStream([outputTrack]);
            return this.activeStream;
        } catch (error) {
            console.error('Error setting up processing pipeline', error);
            await this.stopCurrentProcessor();
            throw error;
        }
    }

    async processCanvasStream(videoTrack) {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('aria-hidden', 'true');
        video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
        video.srcObject = new MediaStream([videoTrack]);
        document.body.appendChild(video);
        const canvas = document.createElement('canvas');
        const abortController = new AbortController();
        const state = {
            video,
            canvas,
            context: canvas.getContext('2d'),
            signal: abortController.signal,
            timer: null,
            cameraTrack: videoTrack,
            onEnded: () => this.stopCurrentProcessor(),
        };
        this.activeCanvas = state;
        this.activeAbortController = abortController;
        this.isProcessing = true;
        videoTrack.addEventListener('ended', state.onEnded, { once: true });

        try {
            await video.play();
            if (state.signal.aborted) throw new Error('Background processing stopped');
            const settings = videoTrack.getSettings();
            const fps = Math.min(15, settings.frameRate || 30);
            const render = async () => {
                if (state.signal.aborted) return;
                if (videoTrack.readyState === 'ended' || this.activeOutputTrack?.readyState === 'ended') {
                    void this.stopCurrentProcessor();
                    return;
                }
                const width = video.videoWidth || settings.width || 640;
                const height = video.videoHeight || settings.height || 480;
                const scale = Math.min(1, 1280 / width, 720 / height);
                const outputWidth = Math.max(1, Math.round(width * scale));
                const outputHeight = Math.max(1, Math.round(height * scale));
                if (canvas.width !== outputWidth || canvas.height !== outputHeight) {
                    canvas.width = outputWidth;
                    canvas.height = outputHeight;
                }
                try {
                    await this.segmentation.send({ image: video });
                } catch (error) {
                    if (!state.signal.aborted) {
                        console.error('Canvas background processing failed', error);
                        void this.stopCurrentProcessor();
                    }
                    throw error;
                }
                if (!state.signal.aborted) {
                    state.timer = setTimeout(() => {
                        this.activePipelinePromise = render();
                        this.activePipelinePromise.catch(() => {});
                    }, 1000 / fps);
                }
            };
            this.activePipelinePromise = render();
            await this.activePipelinePromise;
            if (state.signal.aborted) throw new Error('Background processing stopped');
            const stream = canvas.captureStream(fps);
            this.activeOutputTrack = stream.getVideoTracks()[0];
            this.activeStream = stream;
            return stream;
        } catch (error) {
            await this.stopCurrentProcessor();
            throw error;
        }
    }

    cleanPendingFrames() {
        // Close all pending frames to release resources
        while (this.pendingFrames.length) {
            const { videoFrame, imageBitmap } = this.pendingFrames.pop();
            this.closeFrames(videoFrame, imageBitmap);
        }
        this.pendingFrames = [];
        console.log('✅ Cleaned pending frames');
    }

    async stopCurrentProcessor() {
        if (!this.activeProcessor && !this.activeCanvas && !this.activeWorkerSession) {
            console.warn('⚠️ No active processing to stop');
            return;
        }

        this.isProcessing = false;

        try {
            this.activeAbortController?.abort('Processing stopped');
            if (this.activeCanvas) {
                const { timer, cameraTrack, onEnded, video } = this.activeCanvas;
                clearTimeout(timer);
                cameraTrack.removeEventListener('ended', onEnded);
                video.pause();
            }
            if (this.activeWorkerSession) {
                this.stopGifPump();
                await this.workerEngine?.stopSession(this.activeWorkerSession);
            }
            this.activeOutputTrack?.stop();
            await this.activePipelinePromise;

            console.log('✅ Processor successfully stopped');
        } catch (error) {
            console.error('❌ Processor shutdown error', error);
        } finally {
            if (this.activeCanvas) {
                this.activeCanvas.video.srcObject = null;
                this.activeCanvas.video.remove();
                this.activeCanvas = null;
            }
            this.cleanPendingFrames();
            // Reset active processor and generator
            this.activeProcessor = null;
            this.activeGenerator = null;
            this.activeOutputTrack = null;
            this.activeAbortController = null;
            this.activePipelinePromise = null;
            this.activeSourceTrack = null;
            this.activeStream = null;
            this.activeMaskHandler = null;
            this.activeWorkerSession = null;
            this.frameCounter = 0;
            this.lastSegmentationMask = null;
        }
    }

    // ####################################################
    // WORKER ENGINE
    // ####################################################

    getWorkerEngine() {
        // The worker crashed earlier: stay on the main thread
        if (this.workerEngine?.failed) this.disableWorkerEngine();
        if (!this.useWorker) return Promise.resolve(null);
        if (!this.workerEnginePromise) {
            const engine = new VirtualBackgroundWorkerEngine();
            this.workerEnginePromise = engine.init().then(
                () => {
                    this.workerEngine = engine;
                    console.log('✅ Virtual background worker ready', engine.capabilities);
                    return engine;
                },
                (error) => {
                    console.warn('⚠️ Virtual background worker unavailable, using the main thread', error);
                    this.disableWorkerEngine();
                    return null;
                }
            );
        }
        return this.workerEnginePromise;
    }

    disableWorkerEngine() {
        this.useWorker = false;
        this.workerEnginePromise = null;
        const engine = this.workerEngine;
        this.workerEngine = null;
        if (engine && !engine.failed) engine.terminate();
    }

    // The worker receives a serializable background: images and GIF frames as ImageBitmaps
    async createWorkerBackground({ blurLevel, imageUrl, transparent } = {}) {
        if (blurLevel) {
            this.stopGifAnimation();
            return { kind: 'blur', blurLevel };
        }
        if (transparent) {
            this.stopGifAnimation();
            return { kind: 'transparent' };
        }
        if (imageUrl) {
            if (this.isGifUrl(imageUrl)) {
                const gifCanvas = await this.loadGifImage(imageUrl);
                return { kind: 'gif', bitmap: await createImageBitmap(gifCanvas) };
            }
            const image = await this.loadImage(imageUrl);
            this.stopGifAnimation();
            return { kind: 'image', bitmap: await this.imageToBitmap(image) };
        }
        throw new Error('No virtual background selected');
    }

    // Rasterize through a canvas: works for SVG too, and caps huge pictures
    async imageToBitmap(image, maxSize = 1920) {
        const width = image.naturalWidth || image.width || maxSize;
        const height = image.naturalHeight || image.height || maxSize;
        const scale = Math.min(1, maxSize / Math.max(width, height));
        const canvas = this.createCanvas(
            Math.max(1, Math.round(width * scale)),
            Math.max(1, Math.round(height * scale))
        );
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        return createImageBitmap(canvas);
    }

    // gifler animates the GIF on the page: forward its frames to the worker
    startGifPump(background) {
        this.stopGifPump();
        if (background.kind !== 'gif' || !this.gifCanvas) return;
        let busy = false;
        this.gifPump = setInterval(async () => {
            if (busy || !this.gifCanvas.width || !this.workerEngine) return;
            busy = true;
            try {
                this.workerEngine.sendGifFrame(await createImageBitmap(this.gifCanvas));
            } catch (error) {
                console.warn('⚠️ GIF background frame failed', error);
            } finally {
                busy = false;
            }
        }, 1000 / 15);
    }

    stopGifPump() {
        clearInterval(this.gifPump);
        this.gifPump = null;
    }

    closeWorkerBackground(background) {
        try {
            background?.bitmap?.close();
        } catch (error) {
            // already transferred or closed
        }
    }

    async processStreamWithWorker(engine, videoTrack, background) {
        await this.stopCurrentProcessor();
        await engine.setBackground(background);
        const session = await engine.start(videoTrack, {
            onEnded: (ended) => {
                if (this.activeWorkerSession === ended) void this.stopCurrentProcessor();
            },
            createGenerator: () => this.createVideoTrackGenerator(),
            supportsTrackPipeline: this.supportsTrackPipeline(),
        });
        this.activeWorkerSession = session;
        this.activeSourceTrack = videoTrack;
        this.activeOutputTrack = session.outputTrack;
        this.activeStream = session.stream;
        this.isProcessing = true;
        this.startGifPump(background);
        console.log(`✅ Virtual background running in a worker (${session.mode})`);
        return session.stream;
    }

    canSwapBackground(videoTrack) {
        return Boolean(
            videoTrack &&
            this.isProcessing &&
            this.activeStream &&
            this.activeSourceTrack === videoTrack &&
            videoTrack.readyState !== 'ended' &&
            this.activeOutputTrack?.readyState !== 'ended'
        );
    }

    // Swap the effect on the running pipeline: same output track, so no camera or producer restart.
    // Resolves false when no pipeline is running for videoTrack (the caller must start one).
    async setBackground(videoTrack, options = {}) {
        if (!this.canSwapBackground(videoTrack)) return false;
        const request = ++this.backgroundRequest;
        if (this.activeWorkerSession) return this.setWorkerBackground(videoTrack, options, request);
        const maskHandler = await this.createMaskHandler(options);
        // A newer selection was made while this one was loading: it wins
        if (request !== this.backgroundRequest) return true;
        if (!this.canSwapBackground(videoTrack)) return false;
        this.activeMaskHandler = maskHandler;
        console.log('✅ Virtual background swapped on the running pipeline');
        return true;
    }

    async setWorkerBackground(videoTrack, options, request) {
        const session = this.activeWorkerSession;
        const background = await this.createWorkerBackground(options);
        if (request !== this.backgroundRequest) {
            this.closeWorkerBackground(background);
            return true;
        }
        if (!this.canSwapBackground(videoTrack) || this.activeWorkerSession !== session) {
            this.closeWorkerBackground(background);
            return false;
        }
        this.stopGifPump();
        await this.workerEngine.setBackground(background);
        if (this.activeWorkerSession === session) this.startGifPump(background);
        console.log('✅ Virtual background swapped on the running worker pipeline');
        return true;
    }

    async applyBackground(videoTrack, options) {
        // Check if the required APIs are supported
        if (!this.isSupported) {
            throw new Error(
                'Neither track processing nor canvas virtual backgrounds are supported in this environment.'
            );
        }
        if (await this.setBackground(videoTrack, options)) return this.activeStream;
        ++this.backgroundRequest;
        const engine = await this.getWorkerEngine();
        if (engine) {
            // A background that cannot be loaded is not a worker problem: let it throw
            const background = await this.createWorkerBackground(options);
            try {
                return await this.processStreamWithWorker(engine, videoTrack, background);
            } catch (error) {
                console.warn('⚠️ Virtual background worker failed, using the main thread', error);
                this.closeWorkerBackground(background);
                await this.stopCurrentProcessor();
                this.disableWorkerEngine();
            }
        }
        return this.processStreamWithSegmentation(videoTrack, await this.createMaskHandler(options));
    }

    async createMaskHandler({ blurLevel, imageUrl, transparent } = {}) {
        if (blurLevel) return this.createBlurMaskHandler(blurLevel);
        if (imageUrl) return this.createImageMaskHandler(imageUrl);
        if (transparent) return this.createTransparentMaskHandler();
        throw new Error('No virtual background selected');
    }

    async applyBlurToWebRTCStream(videoTrack, blurLevel = 10) {
        console.log('✅ Apply Blur.');
        return this.applyBackground(videoTrack, { blurLevel });
    }

    async applyVirtualBackgroundToWebRTCStream(videoTrack, imageUrl) {
        console.log('✅ Apply Virtual Background.');
        return this.applyBackground(videoTrack, { imageUrl });
    }

    async applyTransparentVirtualBackgroundToWebRTCStream(videoTrack) {
        console.log('✅ Apply Transparent Background');
        return this.applyBackground(videoTrack, { transparent: true });
    }

    createBlurMaskHandler(blurLevel) {
        this.stopGifAnimation();
        return VirtualBackgroundEffects.createBlurMaskHandler(blurLevel, this.createCanvas.bind(this));
    }

    async createImageMaskHandler(imageUrl) {
        const isGif = this.isGifUrl(imageUrl);
        const background = isGif ? await this.loadGifImage(imageUrl) : await this.loadImage(imageUrl);
        if (!isGif) this.stopGifAnimation();
        return VirtualBackgroundEffects.createImageMaskHandler(background, this.createCanvas.bind(this));
    }

    createTransparentMaskHandler() {
        this.stopGifAnimation();
        return VirtualBackgroundEffects.createTransparentMaskHandler(this.createCanvas.bind(this));
    }

    drawCover(ctx, source, width, height) {
        VirtualBackgroundEffects.drawCover(ctx, source, width, height);
    }

    isGifUrl(imageUrl) {
        return imageUrl.endsWith('.gif') || imageUrl.startsWith('data:image/gif');
    }

    stopGifAnimation() {
        if (!this.gifAnimation) return;
        this.gifAnimation.stop();
        this.gifAnimation = null;
    }

    async loadImage(src) {
        // Load an image from the provided source URL
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = src;
            img.onload = () => resolve(img);
            img.onerror = reject;
        });
    }

    async loadGifImage(src) {
        // Load and animate a GIF using gifler
        return new Promise((resolve, reject) => {
            try {
                this.stopGifAnimation(); // Stop previous animation

                if (!this.gifCanvas) {
                    this.gifCanvas = document.createElement('canvas');
                }

                gifler(src).get((animation) => {
                    this.gifAnimation = animation;
                    animation.animateInCanvas(this.gifCanvas); // Start the animation
                    console.log('✅ GIF loaded and animation started.');
                    resolve(this.gifCanvas);
                });
            } catch (error) {
                console.error('❌ Error loading GIF with gifler:', error);
                reject(error);
            }
        });
    }
}
