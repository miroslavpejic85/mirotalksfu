'use strict';

/**
 * MiroTalk Video Effects Engine - public API.
 *
 *   const effects = new MiroTalkVideoEffects({ video: localVideoElement, width: 1280, height: 720 });
 *   await effects.initialize();
 *   await effects.setEffect('sunglasses');
 *   const processedTrack = effects.getStream().getVideoTracks()[0];
 *
 * or, from a camera track (what MiroTalk uses):
 *
 *   const processedTrack = await effects.setSourceTrack(cameraTrack);
 *
 * Pipeline: camera track -> hidden <video> -> face tracking (worker) -> WebGL/2D renderer
 * (filters + accessories) -> canvas.captureStream() -> processed track. Everything runs locally.
 * The engine knows nothing about signaling or peer connections.
 */
(function (root) {
    const VFX = (root.MiroTalkVFX = root.MiroTalkVFX || {});

    class MiroTalkVideoEffects extends VFX.Emitter {
        static isSupported() {
            return VFX.StreamManager.isSupported();
        }

        constructor(options = {}) {
            super();
            const mobile = VFX.isMobile();
            this.options = {
                video: null,
                // Maximum output size (long side x short side), the source is never upscaled
                width: mobile ? 1280 : 1920,
                height: mobile ? 720 : 1080,
                maxFps: 30,
                // Below this rendered frame rate the UI suggests a lighter effect
                slowFps: 12,
                detectionFps: undefined,
                useWorker: true,
                preferWebGL: true,
                assetBaseUrl: VFX.baseUrl,
                mediapipe: {},
                three: {},
                ...options,
            };
            this.effectId = null;
            this.filterPresetId = 'none';
            this.filters = { ...VFX.DEFAULT_FILTERS };
            // Friendly adjustments layered on top of the preset or custom filters (0..1)
            this.adjustments = { touchUp: 0, lowLight: 0 };
            this.effectiveFilters = { ...VFX.DEFAULT_FILTERS };
            this.slowWindows = 0;
            this.slow = false;
            this.initialized = false;
            this.initializing = null;
            this.destroyed = false;
            this.running = false;
            this.modelActive = false;
            this.modelRenderer = null;
            this.effectRequest = 0;
            this.fps = 0;
            this.frameCount = 0;
            this.fpsWindowStart = 0;
            this.lastError = null;
        }

        initialize() {
            if (this.destroyed)
                return Promise.reject(new VFX.VideoEffectsError('DESTROYED', 'Video effects destroyed'));
            if (this.initialized) return Promise.resolve();
            if (!this.initializing) {
                this.initializing = this.setup().catch((error) => {
                    this.initializing = null;
                    throw error;
                });
            }
            return this.initializing;
        }

        async setup() {
            if (!MiroTalkVideoEffects.isSupported()) {
                throw new VFX.VideoEffectsError('UNSUPPORTED', 'This browser cannot capture a canvas stream');
            }
            this.renderer = VFX.createRenderer(document.createElement('canvas'), {
                preferWebGL: this.options.preferWebGL,
            });
            this.canvas = this.renderer.canvas;
            this.streamManager = new VFX.StreamManager(this.canvas);
            this.manager = new VFX.EffectsManager({ assetBaseUrl: this.options.assetBaseUrl });

            const trackerOptions = { useWorker: this.options.useWorker, mediapipe: this.options.mediapipe };
            if (this.options.detectionFps) trackerOptions.detectionFps = this.options.detectionFps;
            if (this.options.delegate) trackerOptions.delegate = this.options.delegate;
            this.tracker = new VFX.FaceTracker(trackerOptions);
            this.tracker.on('state', ({ state, error }) => {
                if (state === 'error' && error) this.reportError('face-tracking', error);
                this.emitState();
            });
            this.tracker.on('face', () => this.emitState());

            this.source = new VFX.VideoSource({ video: this.options.video });
            this.source.onEnded = () => this.handleSourceEnded();
            this.scheduler = new VFX.FrameScheduler((now) => this.renderFrame(now), { fps: this.options.maxFps });
            this.initialized = true;

            if (this.options.video) {
                await this.source.attachVideoElement();
                await this.source.waitUntilReady();
                this.startLoop();
            }
        }

        /**
         * Process a camera track. Returns the processed track (the same one while it stays live,
         * so switching cameras does not require replacing it again downstream).
         */
        async setSourceTrack(track) {
            await this.initialize();
            this.tracker.reset();
            try {
                await this.source.attachTrack(track);
                await this.source.waitUntilReady();
            } catch (error) {
                this.stop();
                throw error;
            }
            this.startLoop();
            return this.streamManager.getTrack();
        }

        start(track) {
            return this.setSourceTrack(track);
        }

        startLoop() {
            this.streamManager.getStream();
            this.renderFrame(performance.now());
            this.scheduler.start(this.source.video);
            this.running = true;
            this.emitState();
        }

        getStream() {
            if (!this.initialized) throw new VFX.VideoEffectsError('NOT_INITIALIZED', 'Call initialize() first');
            return this.streamManager.getStream();
        }

        getOutputTrack() {
            return this.streamManager?.hasLiveTrack() ? this.streamManager.track : null;
        }

        getSourceTrack() {
            return this.source?.track || null;
        }

        getEffects() {
            const manager = this.manager || new VFX.EffectsManager({ assetBaseUrl: this.options.assetBaseUrl });
            return manager.list();
        }

        getFilterPresets() {
            return VFX.getFilterPresets();
        }

        // Select an accessory effect by id, or null/'none' to remove it
        async setEffect(id) {
            await this.initialize();
            const request = ++this.effectRequest;
            if (!id || id === 'none') {
                this.applyEffect(null);
                return;
            }
            let runtime;
            try {
                runtime = await this.manager.prepare(id);
                if (runtime.modelUrl) {
                    const modelRenderer = this.getModelRenderer();
                    await modelRenderer.setModel(runtime.effect.model, runtime.modelUrl);
                }
            } catch (error) {
                // Keep the previous effect when the new one cannot be loaded
                if (request === this.effectRequest) this.reportError('effect', error);
                throw error;
            }
            if (request !== this.effectRequest || this.destroyed) return;
            this.applyEffect(runtime);
            this.tracker.load().catch(() => {});
        }

        applyEffect(runtime) {
            this.manager.setActive(runtime);
            this.effectId = runtime ? runtime.effect.id : null;
            this.modelActive = !!runtime?.modelUrl;
            if (!this.modelActive) this.modelRenderer?.clearModel();
            this.renderer.retainImages(this.manager.activeImages());
            this.lastError = null;
            this.emitState();
        }

        getModelRenderer() {
            if (!this.modelRenderer) this.modelRenderer = new VFX.ModelRenderer(this.options.three);
            return this.modelRenderer;
        }

        // Manual filter values: the preset becomes "custom" (filterPreset: null)
        setFilters(filters = {}) {
            this.filters = VFX.normalizeFilters({ ...this.filters, ...filters });
            this.filterPresetId = null;
            this.updateEffectiveFilters();
        }

        setFilterPreset(id) {
            const preset = VFX.getFilterPreset(id || 'none');
            if (!preset) throw new VFX.VideoEffectsError('UNKNOWN_FILTER', `Unknown filter preset "${id}"`);
            this.filters = { ...preset.filters };
            this.filterPresetId = preset.id;
            this.updateEffectiveFilters();
        }

        // Resets the preset/custom filters, the adjustments are kept
        resetFilters() {
            this.setFilterPreset('none');
        }

        /**
         * Friendly adjustments (0..1) applied on top of the filters: touchUp (skin smoothing) and
         * lowLight (brightens a dark camera).
         */
        setAdjustments(adjustments = {}) {
            for (const key of ['touchUp', 'lowLight']) {
                const value = Number(adjustments[key]);
                if (Number.isFinite(value)) this.adjustments[key] = VFX.clamp(value, 0, 1);
            }
            this.updateEffectiveFilters();
        }

        updateEffectiveFilters() {
            const { touchUp, lowLight } = this.adjustments;
            const base = this.filters;
            this.effectiveFilters = VFX.normalizeFilters({
                ...base,
                smoothing: Math.max(base.smoothing, touchUp),
                brightness: base.brightness * (1 + 0.35 * lowLight),
                contrast: base.contrast * (1 - 0.08 * lowLight),
                saturation: base.saturation * (1 + 0.08 * lowLight),
            });
            this.emitState();
        }

        // Back to the plain camera: no effect, filters or adjustments
        async clearAll() {
            this.filters = { ...VFX.DEFAULT_FILTERS };
            this.filterPresetId = 'none';
            this.adjustments = { touchUp: 0, lowLight: 0 };
            this.updateEffectiveFilters();
            if (this.effectId) await this.setEffect(null);
        }

        // True when the output differs from the camera (effect, filters or adjustments)
        isActive() {
            return !!this.effectId || !VFX.isDefaultFilters(this.effectiveFilters);
        }

        setDetectionFps(fps) {
            this.options.detectionFps = fps;
            this.tracker?.setDetectionFps(fps);
        }

        computeOutputSize(width, height) {
            const longMax = Math.max(this.options.width, this.options.height);
            const shortMax = Math.min(this.options.width, this.options.height);
            const scale = Math.min(1, longMax / Math.max(width, height), shortMax / Math.min(width, height));
            // Even dimensions keep every video encoder happy
            const outWidth = Math.max(2, Math.round((width * scale) / 2) * 2);
            const outHeight = Math.max(2, Math.round((height * scale) / 2) * 2);
            return { width: outWidth, height: outHeight, scale: outWidth / width };
        }

        renderFrame(now) {
            if (!this.source?.isReady()) return;
            const video = this.source.video;
            const { width, height, scale } = this.computeOutputSize(video.videoWidth, video.videoHeight);
            this.renderer.resize(width, height);

            let face = null;
            if (this.manager.active) {
                this.tracker.update(video, now);
                face = this.tracker.getFace(now, scale);
            }

            try {
                if (!this.renderer.drawVideo(this.source.frameSource, this.effectiveFilters)) return;
                if (face) {
                    const layers = this.manager.computeLayers(face);
                    for (let i = 0; i < layers.length; i++) {
                        this.renderer.drawImageQuad(layers[i].image, layers[i].corners, layers[i].opacity);
                    }
                    if (this.modelActive && this.modelRenderer) {
                        const overlay = this.modelRenderer.render(face, width, height);
                        if (overlay) this.renderer.drawOverlay(overlay, face.opacity);
                    }
                }
            } catch (error) {
                this.reportError('render', error);
            }
            this.countFrame(now);
        }

        countFrame(now) {
            this.frameCount++;
            if (!this.fpsWindowStart) this.fpsWindowStart = now;
            const elapsed = now - this.fpsWindowStart;
            if (elapsed >= 1000) {
                this.fps = Math.round((this.frameCount * 1000) / elapsed);
                this.frameCount = 0;
                this.fpsWindowStart = now;
                this.updatePerformance();
            }
        }

        // "Slow" after 4 consecutive seconds under the threshold, back to normal after 4 good ones
        updatePerformance() {
            const struggling = this.fps > 0 && this.fps < this.options.slowFps;
            this.slowWindows = struggling ? Math.min(this.slowWindows + 1, 4) : Math.max(this.slowWindows - 1, 0);
            const slow = this.slow ? this.slowWindows > 0 : this.slowWindows >= 4;
            if (slow !== this.slow) {
                this.slow = slow;
                this.emitState();
            }
        }

        reportError(stage, error) {
            // Avoid flooding when the same render error repeats every frame
            if (this.lastError && this.lastError.stage === stage && this.lastError.message === error?.message) return;
            this.lastError = { stage, message: error?.message || String(error), code: error?.code || null };
            console.error(`[VideoEffects] ${stage} error`, error);
            this.emit('error', { stage, error });
            this.emitState();
        }

        handleSourceEnded() {
            const track = this.source?.track;
            this.stop();
            this.emit('sourceended', { track });
        }

        getState() {
            return {
                effect: this.effectId,
                filterPreset: this.filterPresetId,
                filters: { ...this.filters },
                adjustments: { ...this.adjustments },
                effectiveFilters: { ...this.effectiveFilters },
                active: this.isActive(),
                slow: this.slow,
                running: this.running,
                renderer: this.renderer?.type || null,
                capabilities: this.renderer?.capabilities || { filters: false, smoothing: false, webgl: false },
                faceTracking: this.tracker?.state || 'idle',
                faceTrackingBackend: this.tracker?.backend?.type || null,
                faceDetected: !!this.tracker?.visible,
                fps: this.fps,
                error: this.lastError,
            };
        }

        emitState() {
            if (!this.destroyed) this.emit('state', this.getState());
        }

        /**
         * Stop processing: the output track ends, the camera track is detached but NOT stopped
         * (its owner decides). Models, textures and workers stay loaded for a fast restart.
         */
        stop() {
            if (!this.initialized) return;
            this.scheduler.stop();
            this.streamManager.stop();
            this.source.detach();
            this.tracker.reset();
            this.running = false;
            this.fps = 0;
            this.slowWindows = 0;
            this.slow = false;
            this.emitState();
        }

        // Release everything: workers, MediaPipe, WebGL contexts, streams, listeners and loops
        async destroy() {
            if (this.destroyed) return;
            this.destroyed = true;
            this.effectRequest++;
            if (this.initializing) await this.initializing.catch(() => {});
            this.running = false;
            this.scheduler?.destroy();
            this.streamManager?.stop();
            this.source?.destroy();
            this.tracker?.destroy();
            this.modelRenderer?.destroy();
            this.renderer?.destroy();
            this.manager?.clear();
            if (this.canvas) {
                this.canvas.width = 0;
                this.canvas.height = 0;
            }
            this.modelRenderer = null;
            this.emit('destroyed');
            this.removeAllListeners();
        }
    }

    VFX.MiroTalkVideoEffects = MiroTalkVideoEffects;
    root.MiroTalkVideoEffects = MiroTalkVideoEffects;
})(typeof globalThis !== 'undefined' ? globalThis : self);
