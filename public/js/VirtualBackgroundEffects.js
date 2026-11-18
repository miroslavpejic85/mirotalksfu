'use strict';

/**
 * Virtual background compositing, shared by the page (VirtualBackground.js) and the module worker
 * (VirtualBackgroundWorker.js). DOM-free: works on HTMLCanvasElement and OffscreenCanvas.
 *
 * A mask handler is called after the camera frame was drawn on the canvas:
 *   handler(ctx, canvas, mask, frame)
 * where the mask alpha is the person confidence (opaque = person).
 */
(function (root) {
    function createCanvas(width, height) {
        if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    // Scale and center-crop the source to fill the frame without distorting it (CSS object-fit: cover)
    function drawCover(ctx, source, width, height) {
        const sourceWidth = source.naturalWidth || source.videoWidth || source.displayWidth || source.width;
        const sourceHeight = source.naturalHeight || source.videoHeight || source.displayHeight || source.height;
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

    // Defaults for createMaskStabilizer, in person-confidence units [0, 1]
    const MASK_STABILIZER_DEFAULTS = Object.freeze({
        // Change below tLo counts as model jitter, above tHi as real motion
        tLo: 0.03,
        tHi: 0.15,
        // Minimum weight of the new mask, bounds the lag of static regions
        leak: 0.3,
        // Decay of the per-pixel motion envelope: keeps following a moving edge for a few masks
        release: 0.8,
        // Smoothstep remap that narrows the soft band MediaPipe leaves around the person. Off for the
        // WebGL compositor, whose bilateral filter needs the soft band and applies its own coverage.
        edgeCurve: true,
        edgeLow: 0.15,
        edgeHigh: 0.85,
    });

    // Temporal stabilizer for segmentation masks (after Longpipe's flow-gated stabilizer, MIT, with the
    // per-pixel mask change as the motion signal since there is no optical flow here):
    //   env = max(|mask - prev|, release * envPrev)
    //   g   = max(clamp((env - tLo) / (tHi - tLo), 0, 1), leak)
    //   out = prev + g * (mask - prev)
    // Static edges are averaged over a few masks (no flicker), moving edges follow the new mask at once.
    // With edgeCurve, the result is then remapped with smoothstep(edgeLow, edgeHigh) for a tighter edge.
    function createMaskStabilizer(options = {}) {
        const { tLo, tHi, leak, release, edgeCurve, edgeLow, edgeHigh } = {
            ...MASK_STABILIZER_DEFAULTS,
            ...options,
        };
        const gateRange = Math.max(tHi - tLo, 1e-3);
        const edgeRange = Math.max(edgeHigh - edgeLow, 1e-3);
        let state = null;
        let envelope = null;
        let output = null;

        const stabilize = (confidence) => {
            const length = confidence.length;
            if (!state || state.length !== length) {
                state = Float32Array.from(confidence);
                envelope = new Float32Array(length);
                output = new Float32Array(length);
            } else {
                for (let i = 0; i < length; i++) {
                    const previous = state[i];
                    const delta = confidence[i] - previous;
                    const env = Math.max(Math.abs(delta), release * envelope[i]);
                    envelope[i] = env;
                    const gate = Math.max(Math.min(Math.max((env - tLo) / gateRange, 0), 1), leak);
                    state[i] = previous + gate * delta;
                }
            }
            if (!edgeCurve) return state;
            for (let i = 0; i < length; i++) {
                const t = Math.min(Math.max((state[i] - edgeLow) / edgeRange, 0), 1);
                output[i] = t * t * (3 - 2 * t);
            }
            return output;
        };
        stabilize.reset = () => {
            state = null;
            envelope = null;
            output = null;
        };
        return stabilize;
    }

    // Upscale the low-resolution mask with the best filter available (cubic in Chromium)
    function smoothMaskScaling(ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
    }

    // Slightly blurred copy of the mask for softer edges, drawn into one reused canvas
    function createSoftMask(newCanvas = createCanvas) {
        let maskCanvas;
        let maskCtx;
        return (mask, width, height) => {
            if (!maskCanvas) {
                maskCanvas = newCanvas(width, height);
                maskCtx = maskCanvas.getContext('2d');
            } else if (maskCanvas.width !== width || maskCanvas.height !== height) {
                maskCanvas.width = width;
                maskCanvas.height = height;
            }
            maskCtx.clearRect(0, 0, width, height);
            smoothMaskScaling(maskCtx);
            maskCtx.filter = 'blur(5px)'; // Adjust to control softness
            maskCtx.drawImage(mask, 0, 0, width, height);
            return maskCanvas;
        };
    }

    // Three box passes approximate a Gaussian blur without CanvasRenderingContext2D.filter (Safari).
    function boxBlurPixels(pixels, width, height, radius) {
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
        for (let pass = 0; pass < 3; pass++) {
            pixels = boxBlur(boxBlur(pixels, true), false);
        }
        return pixels;
    }

    function createBlurMaskHandler(blurLevel, newCanvas = createCanvas) {
        let blurCanvas;
        let blurContext;
        const getBlurContext = (width, height, willReadFrequently) => {
            if (!blurCanvas) {
                blurCanvas = newCanvas(1, 1);
                blurContext = blurCanvas.getContext('2d', { willReadFrequently });
                if (!blurContext) throw new Error('Unable to create a canvas context for background blur.');
            }
            if (blurCanvas.width !== width || blurCanvas.height !== height) {
                blurCanvas.width = width;
                blurCanvas.height = height;
            }
            blurContext.clearRect(0, 0, width, height);
            blurContext.imageSmoothingEnabled = true;
            return blurContext;
        };
        return (ctx, canvas, mask, frame) => {
            // Keep only the person using the segmentation mask
            ctx.save();
            smoothMaskScaling(ctx);
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
            ctx.restore();

            // Apply blur to background and draw image behind the person
            ctx.save();
            ctx.globalCompositeOperation = 'destination-over';
            if ('filter' in ctx) {
                // Blur a quarter-size copy: same look once upscaled, a fraction of the cost
                const scale = 4;
                const width = Math.max(1, Math.round(canvas.width / scale));
                const height = Math.max(1, Math.round(canvas.height / scale));
                const context = getBlurContext(width, height, false);
                context.filter = `blur(${blurLevel / scale}px)`;
                context.drawImage(frame, 0, 0, width, height);
                ctx.imageSmoothingEnabled = true;
                ctx.drawImage(blurCanvas, 0, 0, canvas.width, canvas.height);
            } else {
                const scale = 8;
                const width = Math.max(1, Math.round(canvas.width / scale));
                const height = Math.max(1, Math.round(canvas.height / scale));
                const context = getBlurContext(width, height, true);
                context.drawImage(frame, 0, 0, width, height);
                const imageData = context.getImageData(0, 0, width, height);
                const radius = Math.max(1, Math.round(blurLevel / scale));
                imageData.data.set(boxBlurPixels(imageData.data, width, height, radius));
                context.putImageData(imageData, 0, 0);
                ctx.imageSmoothingEnabled = true;
                ctx.drawImage(blurCanvas, 0, 0, canvas.width, canvas.height);
            }
            ctx.restore();
        };
    }

    // background: an image source, or a function returning the current one (animated GIF frames).
    // softenMask: false when the caller already passes a softened mask (the worker does it per mask).
    function createImageMaskHandler(background, newCanvas = createCanvas, { softenMask = true } = {}) {
        const getBackground = typeof background === 'function' ? background : () => background;
        const softMask = softenMask ? createSoftMask(newCanvas) : null;
        return (ctx, canvas, mask) => {
            // Apply the softened mask
            const edges = softMask ? softMask(mask, canvas.width, canvas.height) : mask;
            smoothMaskScaling(ctx);
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(edges, 0, 0, canvas.width, canvas.height);

            // Draw background behind the person
            const source = getBackground();
            if (!source) return;
            ctx.globalCompositeOperation = 'destination-over';
            drawCover(ctx, source, canvas.width, canvas.height);
        };
    }

    function createTransparentMaskHandler(newCanvas = createCanvas, { softenMask = true } = {}) {
        const softMask = softenMask ? createSoftMask(newCanvas) : null;
        return (ctx, canvas, mask, frame) => {
            // Clear the canvas (ensures transparency)
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw the original frame (so we start with the full image)
            ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);

            // Apply the mask to keep only the person
            const edges = softMask ? softMask(mask, canvas.width, canvas.height) : mask;
            smoothMaskScaling(ctx);
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(edges, 0, 0, canvas.width, canvas.height);

            // Reset blending mode to normal
            ctx.globalCompositeOperation = 'source-over';
        };
    }

    root.VirtualBackgroundEffects = {
        createCanvas,
        drawCover,
        MASK_STABILIZER_DEFAULTS,
        createMaskStabilizer,
        createSoftMask,
        boxBlurPixels,
        createBlurMaskHandler,
        createImageMaskHandler,
        createTransparentMaskHandler,
    };
})(typeof globalThis !== 'undefined' ? globalThis : self);
