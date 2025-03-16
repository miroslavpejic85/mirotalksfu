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
        if (!this.isSupported) {
            console.warn(
                '⚠️ MediaStreamTrackProcessor, MediaStreamTrackGenerator, or TransformStream is not supported in this environment.',
            );
        }

        this.resetState();
    }

    checkSupport() {
        // Check if required APIs are supported
        return Boolean(window.MediaStreamTrackProcessor && window.MediaStreamTrackGenerator && window.TransformStream);
    }

    resetState() {
        // Reset all necessary state variables
        this.segmentation = null;
        this.initialized = false;
        this.pendingFrames = [];
        this.activeProcessor = null;
        this.activeGenerator = null;
        this.isProcessing = false;
        this.gifAnimation = null;
        this.gifCanvas = null;
        this.frameCounter = 0;
        this.frameSkipRatio = 3;
        this.lastSegmentationMask = null;
    }

    async initializeSegmentation() {
        // Initialize the segmentation model if not already done
        if (this.initialized) return;
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

        this.lastSegmentationMask = results.segmentationMask;

        const pendingFrame = this.pendingFrames.shift();

        if (!pendingFrame) return;

        this.processFrame(
            pendingFrame.videoFrame,
            pendingFrame.controller,
            pendingFrame.imageBitmap,
            pendingFrame.maskHandler,
            this.lastSegmentationMask,
        );
    }

    processFrame(videoFrame, controller, imageBitmap, maskHandler, segmentationMask) {
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

            // Enqueue the processed frame to continue the stream
            controller.enqueue(processedFrame);
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
                'MediaStreamTrackProcessor, MediaStreamTrackGenerator, or TransformStream is not supported in this environment.',
            );
        }

        // Initialize segmentation if not already done
        await this.initializeSegmentation();

        // Create new processor and generator for stream transformation
        const processor = new MediaStreamTrackProcessor({ track: videoTrack });
        const generator = new MediaStreamTrackGenerator({ kind: 'video' });

        const transformer = new TransformStream({
            transform: async (videoFrame, controller) => {
                if (!this.segmentation || !this.initialized) {
                    console.warn('⚠️ Segmentation is not initialized, skipping frame.');
                    this.closeFrames(videoFrame);
                    return;
                }

                let imageBitmap = null;

                try {
                    // Create image bitmap from video frame
                    imageBitmap = await createImageBitmap(videoFrame);

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
                        });

                        // Send the image to the segmentation model
                        await this.segmentation.send({ image: imageBitmap });
                    } else if (this.lastSegmentationMask) {
                        // Use last segmentation mask for skipped frames
                        this.processFrame(videoFrame, controller, imageBitmap, maskHandler, this.lastSegmentationMask);
                    } else {
                        // If no previous mask, just enqueue the original frame
                        controller.enqueue(videoFrame);
                    }

                    this.frameCounter++; // Increment frame counter
                } catch (error) {
                    console.error('❌ Frame transformation error:', error);
                } finally {
                    // Close the video frame after processing
                    this.closeFrames(videoFrame, imageBitmap);
                }
            },
            flush: () => this.cleanPendingFrames(), // Clean up any pending frames when the stream ends
        });

        // Store active streams
        this.activeProcessor = processor;
        this.activeGenerator = generator;
        this.isProcessing = true;

        // Start the processing pipeline
        processor.readable
            .pipeThrough(transformer)
            .pipeTo(generator.writable)
            .catch(async () => await this.stopCurrentProcessor());

        return new MediaStream([generator]);
    }

    cleanPendingFrames() {
        // Close all pending frames to release resources
        while (this.pendingFrames.length) {
            const { videoFrame, imageBitmap } = this.pendingFrames.pop();
            this.closeFrames(videoFrame, imageBitmap);
        }
    }

    async stopCurrentProcessor() {
        // Stop any ongoing processor and clean up resources
        if (!this.activeProcessor) return;

        this.isProcessing = false;
        this.cleanPendingFrames();

        try {
            // Abort the writable stream if it's not locked
            if (this.activeGenerator?.writable && !this.activeGenerator.writable.locked) {
                await this.activeGenerator.writable.abort('Processing stopped');
            }

            // Cancel the readable stream if it's not locked
            if (this.activeProcessor?.readable && !this.activeProcessor.readable.locked) {
                await this.activeProcessor.readable.cancel('Processing stopped');
            }

            console.log('✅ Processor successfully stopped');
        } catch (error) {
            console.error('❌ Processor shutdown error:', error);
        } finally {
            // Reset active processor and generator
            this.activeProcessor = null;
            this.activeGenerator = null;
        }
    }

    async applyBlurToWebRTCStream(videoTrack, blurLevel = 10) {
        // Check if the required APIs are supported
        if (!this.isSupported) {
            throw new Error(
                'MediaStreamTrackProcessor, MediaStreamTrackGenerator, or TransformStream is not supported in this environment.',
            );
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
                'MediaStreamTrackProcessor, MediaStreamTrackGenerator, or TransformStream is not supported in this environment.',
            );
        }

        // Determine if the background is a GIF
        const isGif = imageUrl.endsWith('.gif') || imageUrl.startsWith('data:image/gif');
        const background = isGif ? await this.loadGifImage(imageUrl) : await this.loadImage(imageUrl);

        // Handler for applying virtual background
        const maskHandler = (ctx, canvas, mask, imageBitmap) => {
            // Create an offscreen canvas for a softer mask
            const maskCanvas = new OffscreenCanvas(canvas.width, canvas.height);
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
                'MediaStreamTrackProcessor, MediaStreamTrackGenerator, or TransformStream is not supported in this environment.',
            );
        }

        // Handler for applying transparency by using only the mask
        const maskHandler = (ctx, canvas, mask, imageBitmap) => {
            // Clear the canvas (ensures transparency)
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw the original frame (so we start with the full image)
            ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);

            // Create an offscreen canvas for smooth masking
            const maskCanvas = new OffscreenCanvas(canvas.width, canvas.height);
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
