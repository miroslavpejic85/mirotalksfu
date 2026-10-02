'use strict';

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
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
            });

            this.segmentation.setOptions({
                modelSelection: 1, // Higher accuracy
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
            const { canvas, context, video, maskHandler, signal } = this.activeCanvas;
            if (signal.aborted) return;
            context.save();
            try {
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.drawImage(results.image || video, 0, 0, canvas.width, canvas.height);
                maskHandler(context, canvas, results.segmentationMask, results.image || video);
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
            pendingFrame.maskHandler,
            this.lastSegmentationMask
        );
    }

    processFrame(videoFrame, controller, imageBitmap, maskHandler, segmentationMask) {
        if (!controller) {
            console.warn('Controller invalid, closing frames');
            this.closeFrames(videoFrame, imageBitmap);
            return;
        }

        try {
            const canvas = new OffscreenCanvas(videoFrame.displayWidth, videoFrame.displayHeight);
            const ctx = canvas.getContext('2d');

            // Apply original frame
            ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);

            // Apply mask processing
            maskHandler(ctx, canvas, segmentationMask, imageBitmap);

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

        if (!this.supportsTrackPipeline()) {
            return this.processCanvasStream(videoTrack, maskHandler);
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
                            maskHandler,
                            signal,
                        });

                        // Send the image to the segmentation model
                        await this.segmentation.send({ image: imageBitmap });
                    } else if (this.lastSegmentationMask) {
                        // Use last segmentation mask for skipped frames
                        this.processFrame(videoFrame, controller, imageBitmap, maskHandler, this.lastSegmentationMask);
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

            return new MediaStream([outputTrack]);
        } catch (error) {
            console.error('Error setting up processing pipeline', error);
            await this.stopCurrentProcessor();
            throw error;
        }
    }

    async processCanvasStream(videoTrack, maskHandler) {
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
            maskHandler,
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
            this.frameCounter = 0;
            this.lastSegmentationMask = null;
        }
    }

    async applyBlurToWebRTCStream(videoTrack, blurLevel = 10) {
        // Check if the required APIs are supported
        if (!this.isSupported) {
            throw new Error(
                'Neither track processing nor canvas virtual backgrounds are supported in this environment.'
            );
        }

        if (!this.supportsTrackPipeline() && !('filter' in document.createElement('canvas').getContext('2d'))) {
            throw new Error('Background blur is not supported by this browser. Choose a background image instead.');
        }

        // Handler for applying blur effect to the background
        const maskHandler = (ctx, canvas, mask, imageBitmap) => {
            // Keep only the person using the segmentation mask
            ctx.save();
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
            ctx.restore();

            // Apply blur to background and draw image behind the person
            ctx.save();
            ctx.globalCompositeOperation = 'destination-over';
            ctx.filter = `blur(${blurLevel}px)`;
            ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
            ctx.restore();
        };

        console.log('✅ Apply Blur.');
        return this.processStreamWithSegmentation(videoTrack, maskHandler);
    }

    async applyVirtualBackgroundToWebRTCStream(videoTrack, imageUrl) {
        // Check if the required APIs are supported
        if (!this.isSupported) {
            throw new Error(
                'Neither track processing nor canvas virtual backgrounds are supported in this environment.'
            );
        }

        // Determine if the background is a GIF
        const isGif = imageUrl.endsWith('.gif') || imageUrl.startsWith('data:image/gif');
        const background = isGif ? await this.loadGifImage(imageUrl) : await this.loadImage(imageUrl);

        // Handler for applying virtual background
        const maskHandler = (ctx, canvas, mask, imageBitmap) => {
            // Create an offscreen canvas for a softer mask
            const maskCanvas = this.createCanvas(canvas.width, canvas.height);
            const maskCtx = maskCanvas.getContext('2d');

            // Apply slight blur to mask to smooth edges
            maskCtx.filter = 'blur(5px)'; // Adjust to control softness
            maskCtx.drawImage(mask, 0, 0, canvas.width, canvas.height);

            // Apply the softened mask
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);

            // Draw background behind the person
            ctx.globalCompositeOperation = 'destination-over';
            ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
        };

        console.log('✅ Apply Virtual Background.');
        return this.processStreamWithSegmentation(videoTrack, maskHandler);
    }

    async applyTransparentVirtualBackgroundToWebRTCStream(videoTrack) {
        // Check if the required APIs are supported
        if (!this.isSupported) {
            throw new Error(
                'Neither track processing nor canvas virtual backgrounds are supported in this environment.'
            );
        }

        // Handler for applying transparency by using only the mask
        const maskHandler = (ctx, canvas, mask, imageBitmap) => {
            // Clear the canvas (ensures transparency)
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw the original frame (so we start with the full image)
            ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);

            // Create an offscreen canvas for smooth masking
            const maskCanvas = this.createCanvas(canvas.width, canvas.height);
            const maskCtx = maskCanvas.getContext('2d');

            // Blur the mask slightly for softer edges
            maskCtx.filter = 'blur(5px)';
            maskCtx.drawImage(mask, 0, 0, canvas.width, canvas.height);

            // Apply the mask to keep only the person
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);

            // Reset blending mode to normal
            ctx.globalCompositeOperation = 'source-over';
        };

        console.log('✅ Apply Transparent Background');
        return this.processStreamWithSegmentation(videoTrack, maskHandler);
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
                if (this.gifAnimation) {
                    this.gifAnimation.stop(); // Stop previous animation
                    this.gifAnimation = null;
                }

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
