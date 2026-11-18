'use strict';

// Keep in sync with the selfie_segmentation script tag in Room.html
const SELFIE_SEGMENTATION_VERSION = '0.1.1675465747';

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
        if (!this.activeProcessor && !this.activeCanvas) {
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
            this.frameCounter = 0;
            this.lastSegmentationMask = null;
        }
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
        const maskHandler = await this.createMaskHandler(options);
        // A newer selection was made while this one was loading: it wins
        if (request !== this.backgroundRequest) return true;
        if (!this.canSwapBackground(videoTrack)) return false;
        this.activeMaskHandler = maskHandler;
        console.log('✅ Virtual background swapped on the running pipeline');
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

        let blurCanvas;
        let blurContext;
        const maskHandler = (ctx, canvas, mask, imageBitmap) => {
            // Keep only the person using the segmentation mask
            ctx.save();
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
            ctx.restore();

            // Apply blur to background and draw image behind the person
            ctx.save();
            ctx.globalCompositeOperation = 'destination-over';
            if ('filter' in ctx) {
                ctx.filter = `blur(${blurLevel}px)`;
                ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
            } else {
                if (!blurCanvas) {
                    blurCanvas = this.createCanvas(1, 1);
                    blurContext = blurCanvas.getContext('2d', { willReadFrequently: true });
                    if (!blurContext) throw new Error('Unable to create a canvas context for background blur.');
                }

                const scale = 8;
                const width = Math.max(1, Math.round(canvas.width / scale));
                const height = Math.max(1, Math.round(canvas.height / scale));
                if (blurCanvas.width !== width || blurCanvas.height !== height) {
                    blurCanvas.width = width;
                    blurCanvas.height = height;
                }
                blurContext.clearRect(0, 0, width, height);
                blurContext.imageSmoothingEnabled = true;
                blurContext.drawImage(imageBitmap, 0, 0, width, height);
                const imageData = blurContext.getImageData(0, 0, width, height);
                let pixels = imageData.data;
                const radius = Math.max(1, Math.round(blurLevel / scale));
                const boxBlur = (source, horizontal) => {
                    const blurred = new Uint8ClampedArray(source.length);
                    const outerLength = horizontal ? height : width;
                    const innerLength = horizontal ? width : height;
                    const divisor = radius * 2 + 1;

                    for (let outer = 0; outer < outerLength; outer++) {
                        let red = 0;
                        let green = 0;
                        let blue = 0;
                        for (let offset = -radius; offset <= radius; offset++) {
                            const inner = Math.min(innerLength - 1, Math.max(0, offset));
                            const index = (horizontal ? outer * width + inner : inner * width + outer) * 4;
                            red += source[index];
                            green += source[index + 1];
                            blue += source[index + 2];
                        }

                        for (let inner = 0; inner < innerLength; inner++) {
                            const index = (horizontal ? outer * width + inner : inner * width + outer) * 4;
                            blurred[index] = Math.round(red / divisor);
                            blurred[index + 1] = Math.round(green / divisor);
                            blurred[index + 2] = Math.round(blue / divisor);
                            blurred[index + 3] = source[index + 3];

                            const remove = Math.max(0, inner - radius);
                            const add = Math.min(innerLength - 1, inner + radius + 1);
                            const removeIndex = (horizontal ? outer * width + remove : remove * width + outer) * 4;
                            const addIndex = (horizontal ? outer * width + add : add * width + outer) * 4;
                            red += source[addIndex] - source[removeIndex];
                            green += source[addIndex + 1] - source[removeIndex + 1];
                            blue += source[addIndex + 2] - source[removeIndex + 2];
                        }
                    }

                    return blurred;
                };
                // Three box passes approximate a Gaussian blur without CanvasRenderingContext2D.filter.
                for (let pass = 0; pass < 3; pass++) {
                    pixels = boxBlur(boxBlur(pixels, true), false);
                }
                imageData.data.set(pixels);
                blurContext.putImageData(imageData, 0, 0);
                ctx.imageSmoothingEnabled = true;
                ctx.drawImage(blurCanvas, 0, 0, canvas.width, canvas.height);
            }
            ctx.restore();
        };

        return maskHandler;
    }

    async createImageMaskHandler(imageUrl) {
        // Determine if the background is a GIF
        const isGif = imageUrl.endsWith('.gif') || imageUrl.startsWith('data:image/gif');
        const background = isGif ? await this.loadGifImage(imageUrl) : await this.loadImage(imageUrl);
        if (!isGif) this.stopGifAnimation();
        const softMask = this.createSoftMask();

        // Handler for applying virtual background
        return (ctx, canvas, mask) => {
            // Apply the softened mask
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(softMask(mask, canvas.width, canvas.height), 0, 0, canvas.width, canvas.height);

            // Draw background behind the person
            ctx.globalCompositeOperation = 'destination-over';
            this.drawCover(ctx, background, canvas.width, canvas.height);
        };
    }

    createTransparentMaskHandler() {
        this.stopGifAnimation();
        const softMask = this.createSoftMask();

        // Handler for applying transparency by using only the mask
        return (ctx, canvas, mask, imageBitmap) => {
            // Clear the canvas (ensures transparency)
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw the original frame (so we start with the full image)
            ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);

            // Apply the mask to keep only the person
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(softMask(mask, canvas.width, canvas.height), 0, 0, canvas.width, canvas.height);

            // Reset blending mode to normal
            ctx.globalCompositeOperation = 'source-over';
        };
    }

    // Slightly blurred copy of the mask for softer edges, drawn into one reused canvas
    createSoftMask() {
        let maskCanvas;
        let maskCtx;
        return (mask, width, height) => {
            if (!maskCanvas) {
                maskCanvas = this.createCanvas(width, height);
                maskCtx = maskCanvas.getContext('2d');
            } else if (maskCanvas.width !== width || maskCanvas.height !== height) {
                maskCanvas.width = width;
                maskCanvas.height = height;
            }
            maskCtx.clearRect(0, 0, width, height);
            maskCtx.filter = 'blur(5px)'; // Adjust to control softness
            maskCtx.drawImage(mask, 0, 0, width, height);
            return maskCanvas;
        };
    }

    // Scale and center-crop the source to fill the frame without distorting it (CSS object-fit: cover)
    drawCover(ctx, source, width, height) {
        const sourceWidth = source.naturalWidth || source.videoWidth || source.width;
        const sourceHeight = source.naturalHeight || source.videoHeight || source.height;
        if (!sourceWidth || !sourceHeight) {
            ctx.drawImage(source, 0, 0, width, height);
            return;
        }
        const scale = Math.max(width / sourceWidth, height / sourceHeight);
        const cropWidth = width / scale;
        const cropHeight = height / scale;
        ctx.drawImage(
            source,
            (sourceWidth - cropWidth) / 2,
            (sourceHeight - cropHeight) / 2,
            cropWidth,
            cropHeight,
            0,
            0,
            width,
            height
        );
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
