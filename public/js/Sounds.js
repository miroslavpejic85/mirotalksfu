'use strict';

/**
 * Low-latency notification sounds: decode once into AudioBuffers and play them through Web Audio,
 * avoiding the fetch/decode delay of creating a new HTMLAudioElement on every notification.
 * The AudioContext is resumed on a user gesture (autoplay policy); until a buffer is ready,
 * callers fall back to HTMLAudioElement.
 */
const NotificationSounds = (() => {
    const DEFAULT_VOLUME = 0.5;
    const PRELOAD = [
        'alert',
        'click',
        'delete',
        'download',
        'eject',
        'joined',
        'left',
        'lobby',
        'locked',
        'message',
        'notify',
        'open',
        'raiseHand',
    ]; // frequent notification sounds decoded on the first user gesture, the others on first use
    const UNLOCK_EVENTS = ['click', 'touchend', 'pointerup', 'keydown'];

    const buffers = new Map(); // sound url -> decoded AudioBuffer
    const loading = new Map(); // sound url -> Promise<AudioBuffer|null>
    const failed = new Set(); // sound urls that cannot be fetched/decoded, always played via HTMLAudioElement
    let context = null;
    let preloaded = false;

    function getContext() {
        if (context && context.state !== 'closed') return context;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;
        try {
            context = new AudioContextClass({ latencyHint: 'interactive' });
        } catch (err) {
            console.warn('Sound AudioContext unavailable', err);
            context = null;
        }
        return context;
    }

    function load(url) {
        if (buffers.has(url)) return Promise.resolve(buffers.get(url));
        if (loading.has(url)) return loading.get(url);
        if (failed.has(url) || typeof fetch !== 'function') return Promise.resolve(null);
        const ctx = getContext();
        if (!ctx) return Promise.resolve(null);
        const pending = fetch(url)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.arrayBuffer();
            })
            .then(
                (data) =>
                    // Callback form keeps older Safari (webkitAudioContext) working
                    new Promise((resolve, reject) => {
                        const decoding = ctx.decodeAudioData(data, resolve, reject);
                        if (decoding && typeof decoding.then === 'function') decoding.then(resolve, reject);
                    })
            )
            .then((buffer) => {
                buffers.set(url, buffer);
                return buffer;
            })
            .catch((err) => {
                failed.add(url);
                console.warn('Sound preload failed', { url, err });
                return null;
            })
            .finally(() => loading.delete(url));
        loading.set(url, pending);
        return pending;
    }

    /**
     * Play an already decoded sound
     * @param {string} url
     * @param {number} volume 0..1
     * @returns {boolean} true if played, false if the caller should fall back to HTMLAudioElement
     */
    function play(url, volume = DEFAULT_VOLUME) {
        const ctx = context;
        if (!ctx || ctx.state === 'closed') return false;
        const buffer = buffers.get(url);
        if (!buffer) {
            load(url); // ready for the next time
            return false;
        }
        if (ctx.state !== 'running') {
            // Suspended/interrupted (e.g. Safari after backgrounding): start() would be queued and play late
            ctx.resume().catch(() => {});
            setUnlockListeners(true);
            return false;
        }
        try {
            const gain = ctx.createGain();
            gain.gain.value = Math.min(1, Math.max(0, Number(volume) || 0));
            gain.connect(ctx.destination);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(gain);
            source.onended = () => {
                source.disconnect();
                gain.disconnect();
            };
            source.start(0);
            return true;
        } catch (err) {
            console.warn('Sound buffer playback failed', err);
            return false;
        }
    }

    function unlock() {
        const ctx = getContext();
        if (!ctx) return setUnlockListeners(false);
        if (!preloaded) {
            preloaded = true;
            PRELOAD.forEach((name) => load('../sounds/' + name + '.wav'));
        }
        if (ctx.state === 'running') return setUnlockListeners(false);
        // resume() must be invoked inside the user gesture handler
        ctx.resume()
            .then(() => {
                if (ctx.state === 'running') setUnlockListeners(false);
            })
            .catch(() => {});
    }

    /**
     * Add or remove the user gesture listeners used to unlock the notification sounds AudioContext
     * @param {boolean} enabled
     */
    function setUnlockListeners(enabled) {
        const method = enabled ? 'addEventListener' : 'removeEventListener';
        UNLOCK_EVENTS.forEach((type) => window[method](type, unlock, true));
    }

    setUnlockListeners(true);

    return { DEFAULT_VOLUME, play, load, unlock };
})();

window.NotificationSounds = NotificationSounds;
