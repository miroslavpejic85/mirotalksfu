'use strict';

// Optional WebRTC observability via rtcstats (https://github.com/rtcstats/rtcstats).
// When enabled server-side, the rtcstats bundle is loaded and wraps RTCPeerConnection/getUserMedia
// before any media is requested; the trace is streamed once the peer has joined a room.

const RtcStatsMonitor = (() => {
    // Events buffered before connect() are capped so a peer that never joins can't grow memory.
    const MAX_PENDING_EVENTS = 1000;

    let wsTrace = null;
    let state = 'idle'; // idle (buffering) | connected | closed (dropping)
    let pending = 0;

    const trace = (...args) => {
        if (!wsTrace || state === 'closed') return;
        if (state === 'idle' && ++pending > MAX_PENDING_EVENTS) {
            console.warn('RTCStats ----> too many events before join, tracing stopped');
            state = 'closed';
            return;
        }
        wsTrace(...args);
    };

    const loadScript = (src) =>
        new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(script);
        });

    async function init() {
        try {
            const response = await fetch('/rtcstats/config', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
            if (!response.ok) return false;
            const options = await response.json();
            if (!options?.enabled) return false;

            await loadScript('../sfu/RtcStats.js');
            const { WebSocketTrace, wrapRTCPeerConnection, wrapGetUserMedia, wrapEnumerateDevices, wrapSetSinkId } =
                window.rtcstats;

            const wrapOptions = {
                getStatsInterval: options.getStatsInterval,
                excludeDeviceLabels: options.excludeDeviceLabels,
            };
            wsTrace = new WebSocketTrace({ countReloads: true, log: console.warn.bind(console) });
            wrapRTCPeerConnection(trace, window, wrapOptions);
            wrapGetUserMedia(trace, window, wrapOptions);
            wrapEnumerateDevices(trace, window, wrapOptions);
            wrapSetSinkId(trace, window);

            console.log('RTCStats ----> enabled', options);
            return true;
        } catch (err) {
            console.warn('RTCStats ----> init failed', err.message);
            wsTrace = null;
            return false;
        }
    }

    const ready = init();

    function toWebSocketUrl(url, token) {
        const wsUrl = new URL(url || '/rtcstats', window.location.href);
        if (wsUrl.protocol === 'https:') wsUrl.protocol = 'wss:';
        if (wsUrl.protocol === 'http:') wsUrl.protocol = 'ws:';
        if (token) wsUrl.searchParams.set('rtcstats-token', token);
        return wsUrl.toString();
    }

    // Requests a per-participant token over the signaling socket and starts streaming the dump.
    // Each (re)join opens a fresh dump, matching the new mediasoup transports.
    async function connect(socket) {
        if (!(await ready) || !wsTrace) return;
        try {
            const response = await socket.request('getRtcStatsToken');
            if (!response || response.error) {
                console.warn('RTCStats ----> token not available', response?.error);
                state = 'closed';
                return;
            }
            state = 'connected';
            wsTrace.connect(toWebSocketUrl(response.url, response.token));
            // Room/participant identity, so dumps stored by an external rtcstats-server are self-describing
            if (response.identity) wsTrace(':mirotalk', null, response.identity);
            console.log('RTCStats ----> connected');
        } catch (err) {
            console.warn('RTCStats ----> connect failed', err?.message || err);
            state = 'closed';
        }
    }

    function close() {
        if (!wsTrace) return;
        state = 'closed';
        wsTrace.close();
    }

    return { ready, connect, close };
})();
