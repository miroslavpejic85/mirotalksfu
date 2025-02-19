class VirtualBackground {
    static instance = null;

    constructor() {
        if (VirtualBackground.instance) {
            return VirtualBackground.instance;
        }
        VirtualBackground.instance = this;

        this.segmentation = null;
        this.initialized = false;
        this.pendingFrames = [];
        this.activeProcessor = null;
        this.activeGenerator = null;
        this.isProcessing = false;
        this.gifAnimation = null;
        this.currentGifFrame = null;
        this.gifCanvas = null;
        this.gifContext = null;
    }

    async initializeSegmentation() {
        if (this.initialized) return;

        try {
            this.segmentation = new SelfieSegmentation({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
            });

            this.segmentation.setOptions({ modelSelection: 1 });
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
        const pending = this.pendingFrames.shift();
        if (!pending || !results?.segmentationMask) return;

        const { videoFrame, controller, imageBitmap, maskHandler } = pending;

        try {
            const canvas = new OffscreenCanvas(videoFrame.displayWidth, videoFrame.displayHeight);
            const ctx = canvas.getContext('2d');

            // Apply original frame
            ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);

            // Apply mask processing
            maskHandler(ctx, canvas, results.segmentationMask, imageBitmap);

            // Create new video frame
            const processedFrame = new VideoFrame(canvas, {
                timestamp: videoFrame.timestamp,
                alpha: 'keep',
            });

            controller.enqueue(processedFrame);
        } catch (error) {
            console.error('❌ Frame processing error:', error);
        } finally {
            // Close frames after processing
            if (videoFrame) videoFrame.close();
            if (imageBitmap) imageBitmap.close();
        }
    }

    async processStreamWithSegmentation(videoTrack, maskHandler) {
        // Stop any existing processor
        await this.stopCurrentProcessor();

        // Initialize segmentation if not already done
        await this.initializeSegmentation();

        // Create new processor and generator
        const processor = new MediaStreamTrackProcessor({ track: videoTrack });
        const generator = new MediaStreamTrackGenerator({ kind: 'video' });

        const transformer = new TransformStream({
            transform: async (videoFrame, controller) => {
                try {
                    const imageBitmap = await createImageBitmap(videoFrame);
                    this.pendingFrames.push({
                        videoFrame,
                        controller,
                        imageBitmap,
                        maskHandler,
                    });
                    await this.segmentation.send({ image: imageBitmap });
                } catch (error) {
                    console.error('❌ Frame transformation error:', error);
                    videoFrame.close();
                    return; // Ensure the frame is closed and processing stops
                }
            },
            flush: () => {
                // Cleanup any remaining resources
                this.pendingFrames.forEach((frame) => {
                    if (frame.videoFrame) frame.videoFrame.close();
                    if (frame.imageBitmap) frame.imageBitmap.close();
                });
                this.pendingFrames = [];
            },
        });

        // Store active streams
        this.activeProcessor = processor;
        this.activeGenerator = generator;
        this.isProcessing = true;

        // Setup error handling
        const cleanup = () => {
            this.stopCurrentProcessor().catch(() => {});
        };

        // Start processing pipeline
        processor.readable
            .pipeThrough(transformer)
            .pipeTo(generator.writable)
            .catch((error) => {
                //console.error('❌ Processing pipeline error:', error);
                cleanup();
            });

        return new MediaStream([generator]);
    }

    async stopCurrentProcessor() {
        if (!this.activeProcessor) return;

        try {
            // Abort the writable stream first
            if (this.activeGenerator?.writable) {
                await this.activeGenerator.writable.abort('Processing stopped').catch(() => {});
            }

            // Cancel the readable stream if not locked
            if (this.activeProcessor?.readable && !this.activeProcessor.readable.locked) {
                await this.activeProcessor.readable.cancel('Processing stopped').catch(() => {});
            }

            // Cleanup pending frames
            this.pendingFrames.forEach((frame) => {
                frame.videoFrame?.close();
                frame.imageBitmap?.close();
            });
            this.pendingFrames = [];

            console.log('✅ Processor successfully stopped');
        } catch (error) {
            console.error('❌ Processor shutdown error:', error);
        } finally {
            this.activeProcessor = null;
            this.activeGenerator = null;
            this.isProcessing = false;
        }
    }

    async applyBlurToWebRTCStream(videoTrack, blurLevel = 10) {
        const maskHandler = async (ctx, canvas, mask, imageBitmap) => {
            try {
                // Step 1: Apply the mask to keep the person in focus
                ctx.save();
                ctx.globalCompositeOperation = 'destination-in';
                ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
                ctx.restore();

                // Step 2: Draw the background (it will be blurred later)
                ctx.save();
                ctx.globalCompositeOperation = 'destination-over';
                ctx.filter = `blur(${blurLevel}px)`; // Apply blur to the entire canvas
                ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
                ctx.restore();

                // Step 3: Redraw the person in focus on top of the blurred background
                ctx.save();
                ctx.globalCompositeOperation = 'destination-over'; // Ensure the person is on top
                ctx.filter = 'none'; // Reset filter to remove blur on the person
                ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
                ctx.restore();
            } catch (error) {
                console.error('❌ Error in maskHandler:', error);
            }
        };

        return this.processStreamWithSegmentation(videoTrack, maskHandler);
    }

    async applyVirtualBackgroundToWebRTCStream(videoTrack, imageUrl) {
        const isGif = imageUrl.endsWith('.gif') || imageUrl.startsWith('data:image/gif');
        let background;

        isGif ? (background = await this.loadGifImage(imageUrl)) : (background = await this.loadImage(imageUrl));

        const maskHandler = (ctx, canvas, mask) => {
            // Apply person mask
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(mask, 0, 0);

            // Draw background
            ctx.globalCompositeOperation = 'destination-over';
            isGif && this.currentGifFrame
                ? ctx.drawImage(this.currentGifFrame, 0, 0, canvas.width, canvas.height)
                : ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
        };

        return this.processStreamWithSegmentation(videoTrack, maskHandler);
    }

    async loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = src;
            img.onload = () => resolve(img);
            img.onerror = reject;
        });
    }

    async loadGifImage(src) {
        return new Promise((resolve, reject) => {
            try {
                this.gifCanvas = document.createElement('canvas');
                this.gifContext = this.gifCanvas.getContext('2d');

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

    animateGifBackground() {
        if (!this.gifAnimation) return;

        // Updates the current GIF frame at each animation step
        const updateFrame = () => {
            if (this.gifAnimation && this.gifCanvas) {
                this.currentGifFrame = this.gifCanvas;
            }
            requestAnimationFrame(updateFrame);
        };
        updateFrame();
    }
}
