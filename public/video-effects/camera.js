'use strict';

/**
 * MiroTalk Video Effects - camera source and frame scheduling.
 *
 * VideoSource binds a camera MediaStreamTrack (or an existing <video> element) to a playable
 * element the renderer can read from. FrameScheduler drives the render loop: it follows the
 * camera frame rate with requestVideoFrameCallback while the page is visible and falls back to
 * a worker timer when the tab is hidden, so remote participants never receive a frozen picture.
 */
(function (root) {
    const VFX = (root.MiroTalkVFX = root.MiroTalkVFX || {});

    const HIDDEN_VIDEO_STYLE = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    const RVFC_STALL_MS = 500;

    /**
     * Canvas behind a canvas.captureStream() track (e.g. the virtual background on Safari/Firefox).
     * Rendering from it directly avoids a video encode/decode round trip and a WebKit bug where
     * WebGL uploads of a video element playing such a track are empty (solid green frames).
     */
    function getCaptureCanvas(track) {
        const canvas = track?.canvas;
        if (!canvas) return null;
        const isCanvas =
            (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) ||
            (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas);
        return isCanvas ? canvas : null;
    }

    class VideoSource {
        constructor({ video = null } = {}) {
            this.externalVideo = video || null;
            this.video = this.externalVideo;
            this.track = null;
            this.onEnded = null;
            this.handleEnded = () => {
                if (typeof this.onEnded === 'function') this.onEnded(this.track);
            };
        }

        async attachTrack(track) {
            if (!track || track.kind !== 'video') {
                throw new VFX.VideoEffectsError('INVALID_SOURCE', 'A video MediaStreamTrack is required');
            }
            if (track.readyState === 'ended') {
                throw new VFX.VideoEffectsError('SOURCE_ENDED', 'The camera track has already ended');
            }
            this.detach();
            if (!this.video) this.video = this.createVideoElement();
            this.track = track;
            this.captureCanvas = getCaptureCanvas(track);
            track.addEventListener('ended', this.handleEnded);
            this.video.srcObject = new MediaStream([track]);
            await this.play();
        }

        // Use the stream already attached to an external <video> element (public API option)
        async attachVideoElement() {
            const video = this.externalVideo;
            if (!video) throw new VFX.VideoEffectsError('INVALID_SOURCE', 'No video element provided');
            const track = video.srcObject?.getVideoTracks?.()[0] || null;
            this.detach();
            this.track = track;
            this.captureCanvas = getCaptureCanvas(track);
            if (track) track.addEventListener('ended', this.handleEnded);
            await this.play();
        }

        createVideoElement() {
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.autoplay = true;
            video.setAttribute('playsinline', '');
            video.setAttribute('aria-hidden', 'true');
            video.style.cssText = HIDDEN_VIDEO_STYLE;
            // Safari only decodes frames of media elements attached to the document
            document.body.appendChild(video);
            return video;
        }

        async play() {
            try {
                await this.video.play();
            } catch (error) {
                // AbortError happens when the source is swapped while play() is pending
                if (error?.name !== 'AbortError') {
                    throw new VFX.VideoEffectsError('SOURCE_PLAY_FAILED', 'Unable to play the camera stream', error);
                }
            }
        }

        async waitUntilReady(timeoutMs = 5000) {
            if (this.isReady()) return;
            const video = this.video;
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    cleanup();
                    reject(new VFX.VideoEffectsError('SOURCE_TIMEOUT', 'The camera did not deliver any frame'));
                }, timeoutMs);
                const onReady = () => {
                    if (!this.isReady()) return;
                    cleanup();
                    resolve();
                };
                const cleanup = () => {
                    clearTimeout(timer);
                    video.removeEventListener('loadeddata', onReady);
                    video.removeEventListener('resize', onReady);
                    video.removeEventListener('playing', onReady);
                };
                video.addEventListener('loadeddata', onReady);
                video.addEventListener('resize', onReady);
                video.addEventListener('playing', onReady);
            });
        }

        isReady() {
            return !!this.video && this.video.readyState >= 2 && this.video.videoWidth > 0;
        }

        // Image the renderer draws: the capture canvas when available, otherwise the video element
        get frameSource() {
            const canvas = this.captureCanvas;
            return canvas && canvas.width > 0 && canvas.height > 0 ? canvas : this.video;
        }

        get width() {
            return this.video?.videoWidth || 0;
        }

        get height() {
            return this.video?.videoHeight || 0;
        }

        detach() {
            if (this.track) this.track.removeEventListener('ended', this.handleEnded);
            this.track = null;
            this.captureCanvas = null;
            if (this.video && !this.externalVideo) {
                this.video.pause();
                this.video.srcObject = null;
            }
        }

        destroy() {
            this.detach();
            if (this.video && !this.externalVideo) this.video.remove();
            this.video = this.externalVideo;
            this.onEnded = null;
        }
    }

    class FrameScheduler {
        constructor(callback, { fps = 30 } = {}) {
            this.callback = callback;
            this.fps = fps;
            this.video = null;
            this.running = false;
            this.lastTick = 0;
            this.rvfcHandle = null;
            this.rvfcStalled = false;
            this.watchdog = null;
            this.timerWorker = null;
            this.timerWorkerUrl = null;
            this.timerInterval = null;
            this.timerActive = false;
            this.onVideoFrame = this.onVideoFrame.bind(this);
            this.onVisibilityChange = this.onVisibilityChange.bind(this);
            this.onTimer = () => this.tick(performance.now());
        }

        start(video) {
            this.stop();
            this.video = video;
            this.running = true;
            this.rvfcStalled = false;
            if (typeof document !== 'undefined') {
                document.addEventListener('visibilitychange', this.onVisibilityChange);
            }
            this.schedule();
        }

        setFps(fps) {
            this.fps = Math.max(1, fps);
            if (this.timerActive) {
                this.stopTimer();
                this.startTimer();
            }
        }

        canUseVideoFrameCallback() {
            return (
                !!this.video &&
                typeof this.video.requestVideoFrameCallback === 'function' &&
                !this.rvfcStalled &&
                !(typeof document !== 'undefined' && document.hidden)
            );
        }

        schedule() {
            if (!this.running) return;
            if (this.canUseVideoFrameCallback()) {
                this.stopTimer();
                if (this.rvfcHandle === null) {
                    this.rvfcHandle = this.video.requestVideoFrameCallback(this.onVideoFrame);
                }
                this.armWatchdog();
            } else {
                this.cancelVideoFrameCallback();
                this.startTimer();
            }
        }

        onVideoFrame(now) {
            this.rvfcHandle = null;
            clearTimeout(this.watchdog);
            this.watchdog = null;
            if (!this.running) return;
            this.tick(now);
            this.schedule();
        }

        armWatchdog() {
            if (this.watchdog) return;
            // Some browsers stop firing video frame callbacks for invisible elements: switch to the timer
            this.watchdog = setTimeout(() => {
                this.watchdog = null;
                if (!this.running || this.rvfcHandle === null) return;
                this.rvfcStalled = true;
                this.schedule();
            }, RVFC_STALL_MS);
        }

        tick(now) {
            if (!this.running) return;
            const minInterval = 1000 / this.fps - 2;
            if (now - this.lastTick < minInterval) return;
            this.lastTick = now;
            this.callback(now);
        }

        startTimer() {
            if (this.timerActive) return;
            this.timerActive = true;
            const interval = Math.round(1000 / this.fps);
            const worker = this.getTimerWorker();
            if (worker) {
                worker.postMessage({ interval });
            } else {
                this.timerInterval = setInterval(this.onTimer, interval);
            }
        }

        stopTimer() {
            if (!this.timerActive) return;
            this.timerActive = false;
            if (this.timerWorker) this.timerWorker.postMessage({ interval: 0 });
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        // Worker timers keep ticking at full rate in background tabs where main-thread timers are throttled
        getTimerWorker() {
            if (this.timerWorker || this.timerWorker === false) return this.timerWorker || null;
            try {
                const source =
                    'let t=null;self.onmessage=(e)=>{clearInterval(t);t=null;' +
                    'if(e.data&&e.data.interval>0)t=setInterval(()=>self.postMessage(0),e.data.interval);};';
                this.timerWorkerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
                this.timerWorker = new Worker(this.timerWorkerUrl);
                this.timerWorker.onmessage = this.onTimer;
            } catch (error) {
                console.warn('[VideoEffects] Timer worker unavailable, using setInterval', error);
                this.timerWorker = false;
                if (this.timerWorkerUrl) URL.revokeObjectURL(this.timerWorkerUrl);
                this.timerWorkerUrl = null;
            }
            return this.timerWorker || null;
        }

        cancelVideoFrameCallback() {
            if (this.rvfcHandle !== null && this.video?.cancelVideoFrameCallback) {
                this.video.cancelVideoFrameCallback(this.rvfcHandle);
            }
            this.rvfcHandle = null;
            clearTimeout(this.watchdog);
            this.watchdog = null;
        }

        onVisibilityChange() {
            if (!this.running) return;
            if (!document.hidden) this.rvfcStalled = false;
            this.schedule();
        }

        stop() {
            this.running = false;
            this.cancelVideoFrameCallback();
            this.stopTimer();
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', this.onVisibilityChange);
            }
        }

        destroy() {
            this.stop();
            if (this.timerWorker) this.timerWorker.terminate();
            this.timerWorker = null;
            if (this.timerWorkerUrl) URL.revokeObjectURL(this.timerWorkerUrl);
            this.timerWorkerUrl = null;
            this.video = null;
        }
    }

    VFX.VideoSource = VideoSource;
    VFX.FrameScheduler = FrameScheduler;
})(typeof globalThis !== 'undefined' ? globalThis : self);
