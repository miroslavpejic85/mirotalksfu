'use strict';

class WebRTCStreamProcessor {
    constructor() {
        this.segmentation = new SelfieSegmentation({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
        });
        this.segmentation.setOptions({ modelSelection: 1 }); // 1 = High accuracy
    }

    async initializeSegmentation() {
        await this.segmentation.initialize(); // Ensure MediaPipe is ready
    }

    async processStreamWithSegmentation(videoTrack, maskHandler) {
        const processor = new MediaStreamTrackProcessor({ track: videoTrack });
        const generator = new MediaStreamTrackGenerator({ kind: 'video' });

        await this.initializeSegmentation(); // Ensure segmentation is initialized

        const processSegmentation = async (videoFrame, controller) => {
            try {
                const imageBitmap = await createImageBitmap(videoFrame);

                // Process segmentation
                this.segmentation.onResults(async (results) => {
                    if (!results || !results.segmentationMask) {
                        console.warn('Mediapipe segmentationMask is missing, skipping frame.');
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

                    // Close VideoFrame after processing
                    videoFrame.close();
                });

                // Send frame to Mediapipe
                await this.segmentation.send({ image: imageBitmap });
            } catch (error) {
                console.error('Error in processSegmentation:', error);
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
        const backgroundImage = new Image();
        backgroundImage.crossOrigin = 'anonymous'; // Ensure the image is not tainted
        backgroundImage.src = image;
        await backgroundImage.decode(); // Ensure the image is loaded

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
}
