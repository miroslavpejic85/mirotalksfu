'use strict';

class VirtualBackground {
    constructor() {
        this.segmentation = null;
        this.initialized = false;
        this.gifCanvas = null;
        this.gifCtx = null;
        this.gifAnimation = null;
        this.currentGifFrame = null;
    }

    async initializeSegmentation() {
        if (!this.segmentation) {
            this.segmentation = new SelfieSegmentation({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
            });
            this.segmentation.setOptions({ modelSelection: 1 });
        }

        if (!this.initialized) {
            try {
                await this.segmentation.initialize();
                this.initialized = true;
                console.log('✅ Segmentation initialized successfully.');
            } catch (error) {
                console.error('❌ Error initializing segmentation:', error);
            }
        }
    }

    async processStreamWithSegmentation(videoTrack, maskHandler) {
        const processor = new MediaStreamTrackProcessor({ track: videoTrack });
        const generator = new MediaStreamTrackGenerator({ kind: 'video' });

        await this.initializeSegmentation(); // Ensure segmentation is initialized

        if (!this.segmentation) {
            console.error('❌ Segmentation is still undefined after initialization!');
            return new MediaStream([videoTrack]); // Fallback to original video stream
        }

        const processSegmentation = async (videoFrame, controller) => {
            try {
                const imageBitmap = await createImageBitmap(videoFrame);

                // Process segmentation
                this.segmentation.onResults(async (results) => {
                    if (!results || !results.segmentationMask) {
                        console.warn('⚠️ Segmentation mask is missing, skipping frame.');
                        videoFrame.close();
                        imageBitmap.close();
                        return;
                    }

                    const mask = results.segmentationMask;
                    const canvas = new OffscreenCanvas(videoFrame.displayWidth, videoFrame.displayHeight);
                    const ctx = canvas.getContext('2d');

                    // Draw the original video frame
                    ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);

                    // Call the mask handler (either for blur or background)
                    await maskHandler(ctx, canvas, mask, imageBitmap);

                    // Convert back to VideoFrame
                    const newFrame = new VideoFrame(canvas, { timestamp: videoFrame.timestamp });
                    controller.enqueue(newFrame);

                    // Close VideoFrame & imageBitmap after processing
                    videoFrame.close();
                    imageBitmap.close();
                });

                // Send frame to MediaPipe
                await this.segmentation.send({ image: imageBitmap }).catch((err) => {
                    console.error('❌ Segmentation processing failed:', err);
                    return null;
                });
            } catch (error) {
                console.error('❌ Error in processSegmentation:', error);
                videoFrame.close();
            }
        };

        const transformer = new TransformStream({
            async transform(videoFrame, controller) {
                await processSegmentation(videoFrame, controller);
            },
        });

        processor.readable.pipeThrough(transformer).pipeTo(generator.writable);
        return new MediaStream([generator]);
    }

    async applyBlurToWebRTCStream(videoTrack, blurLevel = 10) {
        const maskHandler = async (ctx, canvas, mask, imageBitmap) => {
            // Apply the mask to keep the person in focus
            ctx.save();
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
            ctx.restore();

            // Save the focused person area
            const personImageBitmap = await createImageBitmap(canvas);

            // Draw the original video frame again
            ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);

            // Invert the mask to apply the blur to the background
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out';
            ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
            ctx.restore();

            // Apply the blur effect to the background
            ctx.filter = `blur(${blurLevel}px)`;
            ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height);

            // Draw the person back on top of the blurred background
            ctx.filter = 'none';
            ctx.globalCompositeOperation = 'destination-over';
            ctx.drawImage(personImageBitmap, 0, 0, canvas.width, canvas.height);
        };

        return this.processStreamWithSegmentation(videoTrack, maskHandler);
    }

    async applyVirtualBackgroundToWebRTCStream(videoTrack, image = 'https://i.postimg.cc/t9PJw5P7/forest.jpg') {
        const isGif = image.endsWith('.gif') || image.startsWith('data:image/gif');

        const backgroundImage = await this.loadImage(image, isGif);

        const maskHandler = async (ctx, canvas, mask, imageBitmap) => {
            try {
                // Apply the mask to keep the person in focus
                ctx.save();
                ctx.globalCompositeOperation = 'destination-in';
                ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
                ctx.restore();

                // Save the focused person area
                const personImageBitmap = await createImageBitmap(canvas);

                // If GIF is detected, draw the current animated frame
                if (isGif) {
                    if (this.currentGifFrame) {
                        ctx.drawImage(this.currentGifFrame, 0, 0, canvas.width, canvas.height);
                    }
                } else {
                    // Draw the background image
                    ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);
                }

                // Draw the person back on top of the background image
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(personImageBitmap, 0, 0, canvas.width, canvas.height);
            } catch (error) {
                console.error('❌ Error in maskHandler:', error);
            }
        };

        if (isGif) this.animateGifBackground();
        return this.processStreamWithSegmentation(videoTrack, maskHandler);
    }

    async loadImage(src, isGif) {
        return new Promise((resolve, reject) => {
            if (isGif) {
                // Setup canvas for GIF animation rendering
                this.gifCanvas = document.createElement('canvas');
                this.gifCtx = this.gifCanvas.getContext('2d');
                try {
                    gifler(src).get((a) => {
                        this.gifAnimation = a;
                        a.animateInCanvas(this.gifCanvas); // Start the animation
                        console.log('✅ GIF loaded and animation started.');
                        resolve(this.gifCanvas);
                    });
                } catch (error) {
                    console.error('❌ Error loading GIF:', error);
                    reject(error);
                }
            } else {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.src = src;
                img.onload = () => resolve(img);
                img.onerror = reject;
            }
        });
    }

    animateGifBackground() {
        if (!this.gifAnimation) return;

        // Updates the current GIF frame at each animation step
        const updateFrame = () => {
            this.currentGifFrame = this.gifCanvas;
            requestAnimationFrame(updateFrame);
        };
        updateFrame();
    }
}
