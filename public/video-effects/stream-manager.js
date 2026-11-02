'use strict';

/**
 * MiroTalk Video Effects - processed output stream.
 *
 * Owns the canvas.captureStream() output. A new track is created whenever the previous one was
 * stopped (e.g. the WebRTC producer closed it), while the canvas and renderer are reused.
 */
(function (root) {
    const VFX = (root.MiroTalkVFX = root.MiroTalkVFX || {});

    class StreamManager {
        constructor(canvas) {
            this.canvas = canvas;
            this.stream = null;
            this.track = null;
        }

        static isSupported() {
            if (typeof document === 'undefined') return false;
            return typeof document.createElement('canvas').captureStream === 'function';
        }

        hasLiveTrack() {
            return !!this.track && this.track.readyState === 'live';
        }

        getStream() {
            if (this.hasLiveTrack()) return this.stream;
            if (typeof this.canvas.captureStream !== 'function') {
                throw new VFX.VideoEffectsError('UNSUPPORTED', 'canvas.captureStream() is not supported');
            }
            // No frame rate argument: a frame is captured each time the renderer paints the canvas
            this.stream = this.canvas.captureStream();
            this.track = this.stream.getVideoTracks()[0];
            if (!this.track) throw new VFX.VideoEffectsError('UNSUPPORTED', 'Unable to capture the canvas');
            return this.stream;
        }

        getTrack() {
            this.getStream();
            return this.track;
        }

        stop() {
            if (this.track) this.track.stop();
            this.track = null;
            this.stream = null;
        }
    }

    VFX.StreamManager = StreamManager;
})(typeof globalThis !== 'undefined' ? globalThis : self);
