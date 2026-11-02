'use strict';

/**
 * MiroTalk Video Effects - shared helpers.
 *
 * Every engine file is a classic script wrapped in an IIFE that registers itself on the
 * `MiroTalkVFX` namespace, so the engine works without a bundler and can be loaded in Node tests.
 */
(function (root) {
    const VFX = (root.MiroTalkVFX = root.MiroTalkVFX || {});

    // Resolve the engine base URL (used for assets and the worker) from this script location
    if (!VFX.baseUrl && typeof document !== 'undefined' && document.currentScript && document.currentScript.src) {
        VFX.baseUrl = new URL('.', document.currentScript.src).href;
    }

    class VideoEffectsError extends Error {
        constructor(code, message, cause) {
            super(message);
            this.name = 'VideoEffectsError';
            this.code = code;
            if (cause) this.cause = cause;
        }
    }

    class Emitter {
        constructor() {
            this.listeners = new Map();
        }

        on(event, handler) {
            if (!this.listeners.has(event)) this.listeners.set(event, new Set());
            this.listeners.get(event).add(handler);
            return () => this.off(event, handler);
        }

        off(event, handler) {
            this.listeners.get(event)?.delete(handler);
        }

        emit(event, payload) {
            this.listeners.get(event)?.forEach((handler) => {
                try {
                    handler(payload);
                } catch (error) {
                    console.error(`[VideoEffects] ${event} handler failed`, error);
                }
            });
        }

        removeAllListeners() {
            this.listeners.clear();
        }
    }

    const vec3 = {
        add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
        sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
        scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
        dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
        cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
        length: (a) => Math.hypot(a[0], a[1], a[2]),
        normalize(a) {
            const len = vec3.length(a);
            return len > 1e-9 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 0];
        },
        // Rotate vector v around unit axis k by angle (radians), Rodrigues' formula
        rotate(v, k, angle) {
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const cross = vec3.cross(k, v);
            const dot = vec3.dot(k, v);
            return [
                v[0] * cos + cross[0] * sin + k[0] * dot * (1 - cos),
                v[1] * cos + cross[1] * sin + k[1] * dot * (1 - cos),
                v[2] * cos + cross[2] * sin + k[2] * dot * (1 - cos),
            ];
        },
    };

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function isMobile() {
        if (typeof navigator === 'undefined') return false;
        if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
            return navigator.userAgentData.mobile;
        }
        return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
    }

    function resolveUrl(url, base = VFX.baseUrl) {
        if (!url) return url;
        try {
            return new URL(url, base || (typeof location !== 'undefined' ? location.href : undefined)).href;
        } catch (error) {
            return url;
        }
    }

    VFX.VideoEffectsError = VideoEffectsError;
    VFX.Emitter = Emitter;
    VFX.vec3 = vec3;
    VFX.clamp = clamp;
    VFX.isMobile = isMobile;
    VFX.resolveUrl = resolveUrl;
})(typeof globalThis !== 'undefined' ? globalThis : self);
