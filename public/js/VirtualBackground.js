'use strict';

class VirtualBackground {
    constructor() {
        this.segmentation = null;
        this.initialized = false;
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
        const backgroundImage = await this.loadImage(image);

        const maskHandler = async (ctx, canvas, mask, imageBitmap) => {
            // Apply the mask to keep the person in focus
            ctx.save();
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
            ctx.restore();

            // Save the focused person area
            const personImageBitmap = await createImageBitmap(canvas);

            // Draw the background image
            ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);

            // Draw the person back on top of the background image
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(personImageBitmap, 0, 0, canvas.width, canvas.height);
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
}
