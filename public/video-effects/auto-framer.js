'use strict';

/**
 * MiroTalk Video Effects - auto framing ("keep me centered").
 *
 * From the tracked face, AutoFramer picks a crop of the camera frame (same aspect ratio, so the
 * output size does not change) that keeps the person centered with a head-and-shoulders zoom,
 * like the auto framing of other meeting apps. Everything is in normalized frame units (0..1):
 *
 * - the face size is the forehead-chin distance in 3D, so turning the head does not zoom in/out
 * - a dead zone keeps the frame still while the person only moves a little
 * - moves are eased with a critically damped spring (no overshoot, no jumps, frame-rate independent)
 * - after the face is lost for `holdMs` the frame slowly zooms back out to the whole camera
 *
 * cropFace() maps the tracked face into the cropped output so accessories stay on the face.
 */
(function (root) {
    const VFX = (root.MiroTalkVFX = root.MiroTalkVFX || {});

    const FOREHEAD = 10;
    const CHIN = 152;

    const FULL_FRAME = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

    // Unity-style SmoothDamp: critically damped spring towards target, stable for any time step
    function smoothDamp(current, target, velocity, smoothTime, dt) {
        const omega = 2 / Math.max(0.0001, smoothTime);
        const x = omega * dt;
        const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
        const change = current - target;
        const temp = (velocity + omega * change) * dt;
        return {
            value: target + (change + temp) * decay,
            velocity: (velocity - omega * temp) * decay,
        };
    }

    class AutoFramer {
        constructor(options = {}) {
            this.options = {
                // Forehead-chin height as a fraction of the crop's short side (head and shoulders)
                faceSize: 0.3,
                // Vertical position of the face center in the crop (0 top, 1 bottom): headroom above
                faceY: 0.42,
                // Never crop more than this, to keep enough resolution
                maxZoom: VFX.isMobile?.() ? 1.6 : 2,
                // Re-frame only when the face leaves this zone (fraction of the crop size)
                deadZoneX: 0.1,
                deadZoneY: 0.08,
                deadZoneZoom: 0.15,
                panSeconds: 0.45,
                zoomSeconds: 0.7,
                // Keep the frame this long after the face is lost, then zoom out
                holdMs: 1500,
                resetSeconds: 1.2,
                ...options,
            };
            this.reset();
        }

        reset() {
            this.current = { cx: 0.5, cy: 0.5, size: 1 };
            this.velocity = { cx: 0, cy: 0, size: 0 };
            this.goal = null;
            this.lastTime = null;
            this.lastSeen = null;
            this.aspect = null;
        }

        // Normalized face center and size, or null when the face cannot be measured
        static measure(face, width, height) {
            const points = face?.points;
            if (!points || points.length < (CHIN + 1) * 3 || !(width > 0) || !(height > 0)) return null;
            const fx = points[FOREHEAD * 3];
            const fy = points[FOREHEAD * 3 + 1];
            const fz = points[FOREHEAD * 3 + 2];
            const cx = points[CHIN * 3];
            const cy = points[CHIN * 3 + 1];
            const cz = points[CHIN * 3 + 2];
            const size = Math.hypot(cx - fx, cy - fy, cz - fz);
            if (!(size > 1)) return null;
            return {
                x: (fx + cx) / 2 / width,
                y: (fy + cy) / 2 / height,
                // Relative to the short side, so portrait cameras are framed the same way
                size: size / Math.min(width, height),
            };
        }

        // The crop wanted for this face: zoom limited to maxZoom, kept inside the frame
        desired(measure) {
            const o = this.options;
            const size = VFX.clamp(measure.size / o.faceSize, 1 / o.maxZoom, 1);
            const cx = measure.x;
            const cy = measure.y + (0.5 - o.faceY) * size;
            return this.constrain({ cx, cy, size });
        }

        constrain(frame) {
            const half = frame.size / 2;
            return {
                size: frame.size,
                cx: VFX.clamp(frame.cx, half, 1 - half),
                cy: VFX.clamp(frame.cy, half, 1 - half),
            };
        }

        /**
         * Advance the framing for the frame rendered at `now` and return the crop
         * { x, y, width, height } in normalized frame units. `face` is the tracked face in
         * camera pixels (or null), `width`/`height` the camera frame size.
         */
        update(face, width, height, now) {
            const o = this.options;
            const aspect = width / height;
            if (this.aspect !== null && Math.abs(aspect - this.aspect) > 1e-3) this.reset();
            this.aspect = aspect;
            const dt = this.lastTime === null ? 0 : VFX.clamp((now - this.lastTime) / 1000, 0, 0.25);
            this.lastTime = now;

            const measure = AutoFramer.measure(face, width, height);
            if (measure) {
                this.lastSeen = now;
                const wanted = this.desired(measure);
                const goal = this.goal;
                if (
                    !goal ||
                    Math.abs(wanted.cx - goal.cx) > o.deadZoneX * goal.size ||
                    Math.abs(wanted.cy - goal.cy) > o.deadZoneY * goal.size ||
                    Math.abs(wanted.size - goal.size) > o.deadZoneZoom * goal.size
                ) {
                    this.goal = wanted;
                }
            } else if (this.goal && (this.lastSeen === null || now - this.lastSeen > o.holdMs)) {
                // Nobody in view: back to the whole camera
                this.goal = null;
            }

            const goal = this.goal || { cx: 0.5, cy: 0.5, size: 1 };
            if (dt > 0) {
                // Zooming back out to the whole camera is slower and pans with the zoom
                const pan = this.goal ? o.panSeconds : o.resetSeconds;
                const zoom = this.goal ? o.zoomSeconds : o.resetSeconds;
                for (const [key, time] of [
                    ['cx', pan],
                    ['cy', pan],
                    ['size', zoom],
                ]) {
                    const step = smoothDamp(this.current[key], goal[key], this.velocity[key], time, dt);
                    // Sub-pixel from the goal: land exactly on it (a still frame stays perfectly still)
                    const settled = Math.abs(step.value - goal[key]) < 5e-4 && Math.abs(step.velocity) < 5e-3;
                    this.current[key] = settled ? goal[key] : step.value;
                    this.velocity[key] = settled ? 0 : step.velocity;
                }
            }
            this.current.size = VFX.clamp(this.current.size, 1 / o.maxZoom, 1);
            this.current = this.constrain(this.current);
            return this.getCrop();
        }

        getCrop() {
            const { cx, cy, size } = this.current;
            if (size >= 0.9999) return FULL_FRAME;
            return { x: cx - size / 2, y: cy - size / 2, width: size, height: size };
        }
    }

    function isFullFrame(crop) {
        return !crop || (crop.width >= 0.9999 && crop.height >= 0.9999);
    }

    /**
     * Map a face tracked in camera pixels to the output canvas showing `crop` of the frame:
     * output = (camera - crop origin) * outputWidth / cropWidth. `buffer` is reused between frames.
     */
    function cropFace(face, crop, sourceWidth, sourceHeight, outputWidth, buffer = null) {
        if (!face) return null;
        const left = crop.x * sourceWidth;
        const top = crop.y * sourceHeight;
        const scale = outputWidth / (crop.width * sourceWidth);
        const source = face.points;
        const points = buffer && buffer.length === source.length ? buffer : new Float32Array(source.length);
        for (let i = 0; i < source.length; i += 3) {
            points[i] = (source[i] - left) * scale;
            points[i + 1] = (source[i + 1] - top) * scale;
            points[i + 2] = source[i + 2] * scale;
        }
        const pose = VFX.computeFacePose(points);
        if (!pose) return null;
        // Expressions are ratios of landmark distances: unchanged by the crop
        return { ...face, points, pose };
    }

    VFX.AutoFramer = AutoFramer;
    VFX.FULL_FRAME = FULL_FRAME;
    VFX.isFullFrame = isFullFrame;
    VFX.cropFace = cropFace;
    VFX.smoothDamp = smoothDamp;
})(typeof globalThis !== 'undefined' ? globalThis : self);
