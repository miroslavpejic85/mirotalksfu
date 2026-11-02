'use strict';

/**
 * MiroTalk Video Effects - face tracking.
 *
 * MediaPipe Face Landmarker (Apache-2.0) runs in a module worker when possible, otherwise on the
 * main thread. Detection runs at a configurable rate (lower than the camera frame rate); every
 * rendered frame interpolates towards the latest landmarks, after One Euro filtering removes
 * jitter. When the face is briefly lost the last pose is kept for a grace period, then faded out.
 *
 * Coordinates are camera pixels: x right, y down, z away from the camera (MediaPipe convention,
 * z uses the same scale as x).
 */
(function (root) {
    const VFX = (root.MiroTalkVFX = root.MiroTalkVFX || {});
    const { vec3, clamp } = VFX;

    const MEDIAPIPE_VERSION = '1.2.0';
    const DEFAULT_MEDIAPIPE = Object.freeze({
        visionBundleUrl: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`,
        wasmBaseUrl: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
        modelUrl:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    });

    // MediaPipe face mesh indices ("right"/"left" are the subject's sides)
    const LANDMARKS = Object.freeze({
        rightEyeOuter: 33,
        rightEyeInner: 133,
        leftEyeOuter: 263,
        leftEyeInner: 362,
        rightIris: 468,
        leftIris: 473,
        rightBrow: 105,
        leftBrow: 334,
        noseBridge: 168,
        noseTip: 1,
        noseBottom: 2,
        upperLip: 0,
        mouthTop: 13,
        mouthBottom: 14,
        lowerLip: 17,
        mouthRight: 61,
        mouthLeft: 291,
        chin: 152,
        forehead: 10,
        faceRight: 234,
        faceLeft: 454,
    });

    function smoothingAlpha(dtSeconds, cutoff) {
        const tau = 1 / (2 * Math.PI * cutoff);
        return 1 / (1 + tau / dtSeconds);
    }

    /**
     * One Euro filter (Casiez et al.) over a flat array of values: strong smoothing when the face
     * is still (no jitter), little smoothing when it moves fast (low lag).
     */
    class OneEuroSmoother {
        constructor({ minCutoff = 1.2, beta = 0.02, dCutoff = 1.0 } = {}) {
            this.minCutoff = minCutoff;
            this.beta = beta;
            this.dCutoff = dCutoff;
            this.reset();
        }

        reset() {
            this.values = null;
            this.derivatives = null;
            this.time = null;
        }

        filter(input, timeMs) {
            if (this.time === null || !this.values || this.values.length !== input.length) {
                this.values = Float32Array.from(input);
                this.derivatives = new Float32Array(input.length);
                this.time = timeMs;
                return this.values;
            }
            const dt = Math.max(0.001, (timeMs - this.time) / 1000);
            this.time = timeMs;
            const derivativeAlpha = smoothingAlpha(dt, this.dCutoff);
            for (let i = 0; i < input.length; i++) {
                const previous = this.values[i];
                const derivative = (input[i] - previous) / dt;
                const smoothedDerivative = derivativeAlpha * derivative + (1 - derivativeAlpha) * this.derivatives[i];
                this.derivatives[i] = smoothedDerivative;
                const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDerivative);
                const alpha = smoothingAlpha(dt, cutoff);
                this.values[i] = alpha * input[i] + (1 - alpha) * previous;
            }
            return this.values;
        }
    }

    function getPoint(points, index) {
        return [points[index * 3], points[index * 3 + 1], points[index * 3 + 2]];
    }

    function averagePoint(points, indices) {
        const sum = [0, 0, 0];
        indices.forEach((index) => {
            sum[0] += points[index * 3];
            sum[1] += points[index * 3 + 1];
            sum[2] += points[index * 3 + 2];
        });
        return vec3.scale(sum, 1 / indices.length);
    }

    /**
     * Head pose from the landmarks: an orthonormal face basis (x: towards the subject's left eye,
     * y: towards the chin, z: into the head), the eye distance used as scale, and Euler angles.
     */
    function computeFacePose(points) {
        if (!points || points.length < 468 * 3) return null;
        const rightOuter = getPoint(points, LANDMARKS.rightEyeOuter);
        const leftOuter = getPoint(points, LANDMARKS.leftEyeOuter);
        const across = vec3.sub(leftOuter, rightOuter);
        const scale = vec3.length(across);
        if (!(scale > 1)) return null;
        const x = vec3.scale(across, 1 / scale);
        const down = vec3.sub(getPoint(points, LANDMARKS.chin), getPoint(points, LANDMARKS.forehead));
        const y = vec3.normalize(vec3.sub(down, vec3.scale(x, vec3.dot(down, x))));
        if (!vec3.length(y)) return null;
        const z = vec3.cross(x, y);
        const center = averagePoint(points, [
            LANDMARKS.rightEyeOuter,
            LANDMARKS.rightEyeInner,
            LANDMARKS.leftEyeOuter,
            LANDMARKS.leftEyeInner,
        ]);
        const toDegrees = 180 / Math.PI;
        return {
            center,
            scale,
            axes: { x, y, z },
            // yaw > 0: turned towards image right, pitch > 0: looking up, roll > 0: clockwise on screen
            yaw: Math.atan2(-z[0], z[2]) * toDegrees,
            pitch: Math.asin(clamp(z[1], -1, 1)) * toDegrees,
            roll: Math.atan2(x[1], x[0]) * toDegrees,
        };
    }

    function distance(points, a, b) {
        return Math.hypot(
            points[a * 3] - points[b * 3],
            points[a * 3 + 1] - points[b * 3 + 1],
            points[a * 3 + 2] - points[b * 3 + 2]
        );
    }

    function smoothstep(edge0, edge1, value) {
        const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
        return t * t * (3 - 2 * t);
    }

    // Eyelids and inner lips used to estimate blinks and mouth opening ("right" is the subject's side)
    const EXPRESSION_LANDMARKS = Object.freeze({
        rightEye: { top: 159, bottom: 145, outer: 33, inner: 133 },
        leftEye: { top: 386, bottom: 374, outer: 263, inner: 362 },
        mouth: { top: 13, bottom: 14 },
    });

    /**
     * Facial expressions (0..1) used to animate avatars: blinkRight/blinkLeft/blink, mouthOpen, smile
     * and browUp ("right" is the subject's side).
     *
     * - MediaPipe blendshapes (when available) give blinks, smile and raised brows.
     * - Landmarks always give the mouth opening, and the blinks as a fallback: eyelid opening relative
     *   to an open-eye reference that adapts to each face (eye shapes differ a lot).
     * - Blendshape sides are checked against the landmarks during clear winks, so a mirrored
     *   left/right convention can never make the avatar wink the wrong eye.
     */
    class ExpressionEstimator {
        constructor({ blinkTauMs = 25, mouthTauMs = 45, expressionTauMs = 90 } = {}) {
            this.blinkTauMs = blinkTauMs;
            this.mouthTauMs = mouthTauMs;
            this.expressionTauMs = expressionTauMs;
            this.reset();
        }

        reset() {
            this.openReference = [0.28, 0.28];
            this.values = { blinkRight: 0, blinkLeft: 0, blink: 0, mouthOpen: 0, smile: 0, browUp: 0 };
            this.lastTime = null;
            this.sideVotes = 0;
        }

        eyeOpenness(points, eye) {
            const width = distance(points, eye.outer, eye.inner);
            return width > 0 ? distance(points, eye.top, eye.bottom) / width : 0;
        }

        blinkAmount(openness, index, dt) {
            // Reference jumps to wider openings and slowly follows narrower ones (the person's normal eyes)
            const reference = this.openReference[index];
            const next = openness > reference ? openness : reference + (openness - reference) * Math.min(1, dt / 8000);
            this.openReference[index] = clamp(next, 0.16, 0.45);
            const ref = this.openReference[index];
            return 1 - smoothstep(ref * 0.42, ref * 0.68, openness);
        }

        // Blendshape blinks mapped to the subject's sides, voting with the landmarks on clear winks
        blendshapeBlinks(blendshapes, landmarkRight, landmarkLeft) {
            let right = blendshapes.eyeBlinkRight;
            let left = blendshapes.eyeBlinkLeft;
            const landmarkWink = landmarkRight - landmarkLeft;
            const blendshapeWink = right - left;
            if (Math.abs(landmarkWink) > 0.5 && Math.abs(blendshapeWink) > 0.3) {
                const agree = Math.sign(landmarkWink) === Math.sign(blendshapeWink);
                this.sideVotes = clamp(this.sideVotes + (agree ? 1 : -1), -10, 10);
            }
            if (this.sidesSwapped()) [right, left] = [left, right];
            return [clamp(smoothstep(0.25, 0.55, right), 0, 1), clamp(smoothstep(0.25, 0.55, left), 0, 1)];
        }

        // True once clear winks showed that the blendshape sides are mirrored
        sidesSwapped() {
            return this.sideVotes < -2;
        }

        update(points, scale, now, blendshapes = null) {
            if (!points || points.length < 468 * 3 || !(scale > 0)) return this.values;
            const dt = this.lastTime === null ? 16 : clamp(now - this.lastTime, 0, 250);
            this.lastTime = now;
            const landmarkRight = this.blinkAmount(this.eyeOpenness(points, EXPRESSION_LANDMARKS.rightEye), 0, dt);
            const landmarkLeft = this.blinkAmount(this.eyeOpenness(points, EXPRESSION_LANDMARKS.leftEye), 1, dt);
            const hasBlendshapes = !!blendshapes && Number.isFinite(blendshapes.eyeBlinkLeft);
            const [blinkRight, blinkLeft] = hasBlendshapes
                ? this.blendshapeBlinks(blendshapes, landmarkRight, landmarkLeft)
                : [landmarkRight, landmarkLeft];
            const target = {
                blinkRight,
                blinkLeft,
                mouthOpen: clamp(
                    (distance(points, EXPRESSION_LANDMARKS.mouth.top, EXPRESSION_LANDMARKS.mouth.bottom) / scale -
                        0.04) /
                        0.32,
                    0,
                    1
                ),
                smile: hasBlendshapes
                    ? clamp(((blendshapes.mouthSmileLeft || 0) + (blendshapes.mouthSmileRight || 0)) / 2, 0, 1)
                    : 0,
                browUp: hasBlendshapes
                    ? clamp(
                          Math.max(
                              blendshapes.browInnerUp || 0,
                              ((blendshapes.browOuterUpLeft || 0) + (blendshapes.browOuterUpRight || 0)) / 2
                          ),
                          0,
                          1
                      )
                    : 0,
            };
            const blinkAlpha = 1 - Math.exp(-dt / this.blinkTauMs);
            const mouthAlpha = 1 - Math.exp(-dt / this.mouthTauMs);
            const expressionAlpha = 1 - Math.exp(-dt / this.expressionTauMs);
            const v = this.values;
            v.blinkRight += (target.blinkRight - v.blinkRight) * blinkAlpha;
            v.blinkLeft += (target.blinkLeft - v.blinkLeft) * blinkAlpha;
            v.mouthOpen += (target.mouthOpen - v.mouthOpen) * mouthAlpha;
            v.smile += (target.smile - v.smile) * expressionAlpha;
            v.browUp += (target.browUp - v.browUp) * expressionAlpha;
            v.blink = (v.blinkRight + v.blinkLeft) / 2;
            return v;
        }
    }

    function packLandmarks(face) {
        const landmarks = new Float32Array(face.length * 3);
        for (let i = 0; i < face.length; i++) {
            landmarks[i * 3] = face[i].x;
            landmarks[i * 3 + 1] = face[i].y;
            landmarks[i * 3 + 2] = face[i].z;
        }
        return landmarks;
    }

    function withTimeout(promise, ms, code, message) {
        let timer;
        const timeout = new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new VFX.VideoEffectsError(code, message)), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    async function captureBitmap(video, maxWidth) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const scale = Math.min(1, maxWidth / width);
        if (scale < 1) {
            try {
                return await createImageBitmap(video, {
                    resizeWidth: Math.round(width * scale),
                    resizeHeight: Math.round(height * scale),
                    resizeQuality: 'low',
                });
            } catch (error) {
                // Resize options unsupported: landmarks are normalized, the full frame works too
            }
        }
        return createImageBitmap(video);
    }

    class WorkerBackend {
        constructor(workerUrl, config, { initTimeoutMs, detectTimeoutMs }) {
            this.type = 'worker';
            this.workerUrl = workerUrl;
            this.config = config;
            this.initTimeoutMs = initTimeoutMs;
            this.detectTimeoutMs = detectTimeoutMs;
            this.pending = new Map();
            this.sequence = 0;
            this.worker = null;
            this.closed = false;
            this.delegate = null;
            this.warmedUp = false;
        }

        init() {
            const ready = new Promise((resolve, reject) => {
                this.initHandlers = { resolve, reject };
                try {
                    this.worker = new Worker(this.workerUrl, { type: 'module' });
                } catch (error) {
                    reject(new VFX.VideoEffectsError('WORKER_UNAVAILABLE', 'Module workers are not supported', error));
                    return;
                }
                this.worker.onmessage = (event) => this.onMessage(event.data);
                this.worker.onerror = (event) => {
                    event.preventDefault?.();
                    this.fail(
                        new VFX.VideoEffectsError('WORKER_FAILED', event.message || 'Face tracking worker failed')
                    );
                };
                this.worker.postMessage({ type: 'init', config: this.config });
            });
            return withTimeout(
                ready,
                this.initTimeoutMs,
                'MODEL_LOAD_TIMEOUT',
                'Face tracking model load timed out'
            ).catch((error) => {
                this.close();
                throw error;
            });
        }

        onMessage(message) {
            if (!message) return;
            if (message.type === 'ready') {
                this.delegate = message.delegate;
                this.initHandlers?.resolve();
                this.initHandlers = null;
                return;
            }
            if (message.type === 'error' && message.stage === 'init') {
                this.initHandlers?.reject(new VFX.VideoEffectsError('MODEL_LOAD_FAILED', message.message));
                this.initHandlers = null;
                return;
            }
            const request = this.pending.get(message.id);
            if (!request) return;
            this.pending.delete(message.id);
            clearTimeout(request.timer);
            if (message.type === 'result') {
                request.resolve(
                    message.landmarks
                        ? { landmarks: message.landmarks, blendshapes: message.blendshapes || null }
                        : null
                );
            } else {
                request.reject(new VFX.VideoEffectsError('DETECT_FAILED', message.message));
            }
        }

        fail(error) {
            this.initHandlers?.reject(error);
            this.initHandlers = null;
            this.pending.forEach((request) => {
                clearTimeout(request.timer);
                request.reject(error);
            });
            this.pending.clear();
        }

        async detect(video, timestamp, maxWidth) {
            if (this.closed) return null;
            const bitmap = await captureBitmap(video, maxWidth);
            if (this.closed) {
                bitmap.close();
                return null;
            }
            const id = ++this.sequence;
            // The first inference compiles the GPU shaders and can take several seconds
            const timeoutMs = this.warmedUp ? this.detectTimeoutMs : this.initTimeoutMs;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pending.delete(id);
                    reject(new VFX.VideoEffectsError('DETECT_TIMEOUT', 'Face detection timed out'));
                }, timeoutMs);
                this.pending.set(id, {
                    resolve: (landmarks) => {
                        this.warmedUp = true;
                        resolve(landmarks);
                    },
                    reject,
                    timer,
                });
                this.worker.postMessage({ type: 'detect', id, bitmap, timestamp }, [bitmap]);
            });
        }

        close() {
            if (this.closed) return;
            this.closed = true;
            this.fail(new VFX.VideoEffectsError('CLOSED', 'Face tracker closed'));
            const worker = this.worker;
            this.worker = null;
            if (!worker) return;
            // Let the worker release the MediaPipe graph, then make sure it is gone
            try {
                worker.postMessage({ type: 'close' });
            } catch (error) {
                // ignore
            }
            setTimeout(() => worker.terminate(), 1000);
        }
    }

    class MainThreadBackend {
        constructor(config, { initTimeoutMs }) {
            this.type = 'main';
            this.config = config;
            this.initTimeoutMs = initTimeoutMs;
            this.landmarker = null;
            this.lastTimestamp = -1;
            this.closed = false;
            this.delegate = null;
        }

        async init() {
            const load = async () => {
                const vision = await import(this.config.visionBundleUrl);
                const fileset = await vision.FilesetResolver.forVisionTasks(this.config.wasmBaseUrl);
                const create = (delegate) =>
                    vision.FaceLandmarker.createFromOptions(fileset, {
                        baseOptions: { modelAssetPath: this.config.modelUrl, delegate },
                        runningMode: 'VIDEO',
                        numFaces: 1,
                        minFaceDetectionConfidence: this.config.minDetectionConfidence,
                        minFacePresenceConfidence: this.config.minPresenceConfidence,
                        minTrackingConfidence: this.config.minTrackingConfidence,
                        outputFaceBlendshapes: true,
                    });
                try {
                    this.landmarker = await create(this.config.delegate);
                    this.delegate = this.config.delegate;
                } catch (error) {
                    if (this.config.delegate !== 'GPU') throw error;
                    this.landmarker = await create('CPU');
                    this.delegate = 'CPU';
                }
            };
            try {
                await withTimeout(
                    load(),
                    this.initTimeoutMs,
                    'MODEL_LOAD_TIMEOUT',
                    'Face tracking model load timed out'
                );
            } catch (error) {
                if (error instanceof VFX.VideoEffectsError) throw error;
                throw new VFX.VideoEffectsError(
                    'MODEL_LOAD_FAILED',
                    error?.message || 'Unable to load MediaPipe',
                    error
                );
            }
            if (this.closed) this.close();
        }

        async detect(video, timestamp) {
            if (this.closed || !this.landmarker) return null;
            const ts = Math.max(Math.round(timestamp), this.lastTimestamp + 1);
            this.lastTimestamp = ts;
            const result = this.landmarker.detectForVideo(video, ts);
            const face = result?.faceLandmarks?.[0];
            if (!face || !face.length) return null;
            const blendshapes = {};
            (result.faceBlendshapes?.[0]?.categories || []).forEach(({ categoryName, score }) => {
                blendshapes[categoryName] = score;
            });
            return { landmarks: packLandmarks(face), blendshapes };
        }

        close() {
            this.closed = true;
            try {
                this.landmarker?.close();
            } catch (error) {
                // ignore
            }
            this.landmarker = null;
        }
    }

    class FaceTracker extends VFX.Emitter {
        constructor(options = {}) {
            super();
            const mobile = VFX.isMobile();
            this.options = {
                useWorker: true,
                workerUrl: VFX.resolveUrl('workers/face-tracking-worker.js'),
                // CPU (XNNPACK, WASM SIMD) in the worker: reliable everywhere, keeps the GPU free for
                // rendering and encoding. 'GPU' is faster on some devices but fails silently on others.
                delegate: 'CPU',
                detectionFps: mobile ? 8 : 15,
                detectionWidth: mobile ? 480 : 640,
                minDetectionConfidence: 0.5,
                minPresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
                lossGraceMs: 600,
                // Extrapolate the landmarks by their velocity to hide the detection latency
                maxPredictionMs: 120,
                fadeMs: 250,
                interpolationMs: 0,
                initTimeoutMs: 60000,
                detectTimeoutMs: 3000,
                maxConsecutiveErrors: 5,
                smoothing: {},
                ...options,
                mediapipe: { ...DEFAULT_MEDIAPIPE, ...(options.mediapipe || {}) },
            };
            this.state = 'idle';
            this.error = null;
            this.backend = null;
            this.loadPromise = null;
            this.smoother = new OneEuroSmoother(this.options.smoothing);
            this.expressions = new ExpressionEstimator();
            this.generation = 0;
            this.busy = false;
            this.lastDetectAt = -Infinity;
            this.consecutiveErrors = 0;
            this.resetFace();
        }

        resetFace() {
            this.target = null;
            this.blendshapes = null;
            this.velocity = null;
            this.targetTime = 0;
            this.display = null;
            this.scaled = null;
            this.visible = false;
            this.lostSince = null;
            this.opacity = 0;
            this.lastRenderAt = null;
            this.frameWidth = 0;
            this.frameHeight = 0;
            this.smoother?.reset();
            this.expressions?.reset();
        }

        setState(state, error = null) {
            this.state = state;
            this.error = error;
            this.emit('state', { state, error, backend: this.backend?.type || null });
        }

        get interpolationMs() {
            return this.options.interpolationMs || Math.round(600 / this.options.detectionFps);
        }

        setDetectionFps(fps) {
            this.options.detectionFps = clamp(Number(fps) || 15, 1, 60);
        }

        load() {
            if (this.loadPromise) return this.loadPromise;
            this.setState('loading');
            this.loadPromise = this.createBackend().then(
                (backend) => {
                    if (this.state === 'destroyed') {
                        backend.close();
                        return;
                    }
                    this.backend = backend;
                    this.consecutiveErrors = 0;
                    console.info(`[VideoEffects] Face tracking ready (${backend.type}, ${backend.delegate})`);
                    this.setState('ready');
                },
                (error) => {
                    // Allow a later retry, e.g. after a network failure while downloading the model
                    this.loadPromise = null;
                    if (this.state !== 'destroyed') this.setState('error', error);
                    throw error;
                }
            );
            return this.loadPromise;
        }

        async createBackend() {
            const config = {
                ...this.options.mediapipe,
                delegate: this.options.delegate,
                minDetectionConfidence: this.options.minDetectionConfidence,
                minPresenceConfidence: this.options.minPresenceConfidence,
                minTrackingConfidence: this.options.minTrackingConfidence,
            };
            const timeouts = {
                initTimeoutMs: this.options.initTimeoutMs,
                detectTimeoutMs: this.options.detectTimeoutMs,
            };
            if (this.options.useWorker && typeof Worker !== 'undefined' && typeof createImageBitmap === 'function') {
                const backend = new WorkerBackend(this.options.workerUrl, config, timeouts);
                try {
                    await backend.init();
                    return backend;
                } catch (error) {
                    console.warn('[VideoEffects] Face tracking worker failed, using the main thread', error);
                }
            }
            const backend = new MainThreadBackend(config, timeouts);
            try {
                await backend.init();
            } catch (error) {
                backend.close();
                throw error;
            }
            return backend;
        }

        // Called every rendered frame: starts a detection when due and none is running
        update(video, now) {
            if (this.state !== 'ready' || this.busy || !video) return;
            if (now - this.lastDetectAt < 1000 / this.options.detectionFps) return;
            const width = video.videoWidth;
            const height = video.videoHeight;
            if (!width || !height) return;
            this.busy = true;
            this.lastDetectAt = now;
            const generation = this.generation;
            this.backend
                .detect(video, now, this.options.detectionWidth)
                .then((result) => {
                    if (generation !== this.generation) return;
                    this.consecutiveErrors = 0;
                    this.handleLandmarks(result?.landmarks || null, width, height, now, result?.blendshapes || null);
                })
                .catch((error) => {
                    if (generation === this.generation) this.handleDetectError(error);
                })
                .finally(() => {
                    if (generation === this.generation) this.busy = false;
                });
        }

        // `now` is the capture time of the analysed frame (smoothing and prediction use it)
        handleLandmarks(landmarks, width, height, now, blendshapes = null) {
            if (!landmarks) {
                if (this.visible && this.lostSince === null) this.lostSince = now;
                return;
            }
            const count = landmarks.length / 3;
            const points = new Float32Array(landmarks.length);
            for (let i = 0; i < count; i++) {
                points[i * 3] = landmarks[i * 3] * width;
                points[i * 3 + 1] = landmarks[i * 3 + 1] * height;
                points[i * 3 + 2] = landmarks[i * 3 + 2] * width;
            }
            // Re-acquired after a loss (or new resolution): snap instead of sliding from the old pose
            const snap = !this.visible || this.frameWidth !== width || this.frameHeight !== height;
            if (snap) this.smoother.reset();
            this.target = Float32Array.from(this.smoother.filter(points, now));
            this.velocity = snap ? new Float32Array(this.target.length) : Float32Array.from(this.smoother.derivatives);
            this.targetTime = now;
            if (snap || !this.display || this.display.length !== this.target.length) {
                this.display = Float32Array.from(this.target);
            }
            this.frameWidth = width;
            this.frameHeight = height;
            this.blendshapes = blendshapes;
            this.lostSince = null;
            if (!this.visible) {
                this.visible = true;
                this.emit('face', { detected: true });
            }
        }

        handleDetectError(error) {
            this.consecutiveErrors++;
            console.warn('[VideoEffects] Face detection failed', error);
            if (this.visible && this.lostSince === null) this.lostSince = performance.now();
            if (this.consecutiveErrors < this.options.maxConsecutiveErrors) return;
            this.backend?.close();
            this.backend = null;
            this.loadPromise = null;
            this.setState(
                'error',
                new VFX.VideoEffectsError('FACE_TRACKING_FAILED', 'Face tracking stopped after repeated errors', error)
            );
        }

        /**
         * Face state for the frame being rendered, or null. `outputScale` maps camera pixels to
         * output canvas pixels when the output is downscaled.
         */
        getFace(now, outputScale = 1) {
            if (!this.display || !this.target) return null;
            const dt = this.lastRenderAt === null ? 16 : Math.max(0, now - this.lastRenderAt);
            this.lastRenderAt = now;

            const lost = this.lostSince !== null && now - this.lostSince > this.options.lossGraceMs;
            const step = dt / this.options.fadeMs;
            this.opacity = lost ? Math.max(0, this.opacity - step) : Math.min(1, this.opacity + step);
            if (lost && this.opacity <= 0) {
                this.resetFace();
                this.emit('face', { detected: false });
                return null;
            }

            const alpha = 1 - Math.exp(-dt / this.interpolationMs);
            const ahead = lost ? 0 : clamp(now - this.targetTime, 0, this.options.maxPredictionMs) / 1000;
            const display = this.display;
            const target = this.target;
            const velocity = this.velocity;
            for (let i = 0; i < display.length; i++) {
                const goal = target[i] + (velocity ? velocity[i] * ahead : 0);
                display[i] += (goal - display[i]) * alpha;
            }

            let points = display;
            if (outputScale !== 1) {
                if (!this.scaled || this.scaled.length !== display.length)
                    this.scaled = new Float32Array(display.length);
                for (let i = 0; i < display.length; i++) this.scaled[i] = display[i] * outputScale;
                points = this.scaled;
            }
            const pose = computeFacePose(points);
            if (!pose) return null;
            const expressions = this.expressions.update(points, pose.scale, now, this.blendshapes);
            // Raw MediaPipe blendshapes for 3D avatars; `sidesSwapped` when their left/right are the image's
            return {
                points,
                pose,
                opacity: this.opacity,
                expressions,
                blendshapes: this.blendshapes,
                sidesSwapped: this.expressions.sidesSwapped(),
            };
        }

        // New camera source: forget the previous face and ignore detections still in flight
        reset() {
            this.generation++;
            this.busy = false;
            this.lastDetectAt = -Infinity;
            this.resetFace();
        }

        destroy() {
            this.reset();
            this.backend?.close();
            this.backend = null;
            this.loadPromise = null;
            this.state = 'destroyed';
            this.removeAllListeners();
        }
    }

    VFX.MEDIAPIPE_DEFAULTS = DEFAULT_MEDIAPIPE;
    VFX.LANDMARKS = LANDMARKS;
    VFX.OneEuroSmoother = OneEuroSmoother;
    VFX.computeFacePose = computeFacePose;
    VFX.ExpressionEstimator = ExpressionEstimator;
    VFX.EXPRESSIONS = Object.freeze(['blink', 'blinkLeft', 'blinkRight', 'mouthOpen', 'smile', 'browUp']);
    VFX.smoothstep = smoothstep;
    VFX.averagePoint = averagePoint;
    VFX.FaceTracker = FaceTracker;
})(typeof globalThis !== 'undefined' ? globalThis : self);
