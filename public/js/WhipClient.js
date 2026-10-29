/*
 * WHIP client module (RFC 9725)
 * Publishes the local camera/screen and microphone to any WHIP endpoint (another MiroTalk room,
 * a media server or a streaming platform) over a dedicated, send-only RTCPeerConnection.
 * Exposes window.initWhipClient(config) and window.WhipClientUtils (pure helpers).
 */
(function () {
    'use strict';

    const SETTINGS_STORAGE_KEY = 'MIROTALK_WHIP_SETTINGS';
    const ICE_GATHERING_TIMEOUT_MS = 5000;
    const REQUEST_TIMEOUT_MS = 15000;
    const DELETE_TIMEOUT_MS = 3000;
    const STATS_INTERVAL_MS = 1000;
    const MAX_ERROR_TEXT_LENGTH = 160;
    const SOURCES = ['camera', 'screen', 'none'];
    const AUDIO_MODES = ['mic', 'screen', 'none'];
    const AUTH_TYPES = ['none', 'bearer', 'basic'];
    const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

    function t(text, namespace = 'labels') {
        const i18n = typeof window !== 'undefined' ? window.i18n : null;
        return i18n?.t ? i18n.t(text, namespace) : text;
    }

    // ####################################################
    // PURE HELPERS
    // ####################################################

    function safeDecode(value) {
        try {
            return decodeURIComponent(value);
        } catch (error) {
            return value;
        }
    }

    /**
     * Validate the endpoint typed by the user. Browsers refuse to fetch URLs with user:pass@,
     * so they are moved out of the URL and returned as credentials (sent as Basic auth).
     * @returns {{url: string, credentials?: {username: string, password: string}}|{error: string}}
     */
    function parseWhipEndpoint(rawValue, pageProtocol = 'https:') {
        const raw = String(rawValue || '').trim();
        if (!raw) return { error: t('Enter the WHIP endpoint URL') };

        let url;
        try {
            url = new URL(raw);
        } catch (error) {
            return { error: t('Invalid WHIP endpoint URL') };
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            return { error: t('The WHIP endpoint must start with https://') };
        }
        // Mixed content: an https page can only reach plain http on the loopback interface
        if (url.protocol === 'http:' && pageProtocol === 'https:' && !LOCAL_HOSTS.has(url.hostname)) {
            return { error: t('Browsers block http:// endpoints from an https:// page, use https://') };
        }
        let credentials = null;
        if (url.username || url.password) {
            credentials = { username: safeDecode(url.username), password: safeDecode(url.password) };
            url.username = '';
            url.password = '';
        }
        url.hash = '';
        return credentials ? { url: url.href, credentials } : { url: url.href };
    }

    // Removes user:pass@ so it is never persisted; anything that is not a URL is returned as typed
    function stripCredentials(rawValue) {
        const raw = String(rawValue || '').trim();
        try {
            const url = new URL(raw);
            if (!url.username && !url.password) return raw;
            url.username = '';
            url.password = '';
            return url.href;
        } catch (error) {
            return raw;
        }
    }

    // MiroTalk SFU endpoints look like /whip/{roomId}
    function isMiroTalkEndpoint(endpoint) {
        try {
            return /^\/whip\/[^/]+\/?$/.test(new URL(endpoint).pathname);
        } catch (error) {
            return false;
        }
    }

    // MiroTalk reads the participant name from ?name=. Other servers only get it when the user typed a
    // display name: some sign the endpoint URL or reject unknown query parameters.
    function buildPublishUrl(endpoint, displayName, fallbackName = '') {
        const url = new URL(endpoint);
        if (url.searchParams.has('name')) return url.href;
        const name =
            String(displayName || '').trim() || (isMiroTalkEndpoint(url.href) ? String(fallbackName || '').trim() : '');
        if (name) url.searchParams.set('name', name);
        return url.href;
    }

    // RFC 7617 with UTF-8 so non-ASCII usernames and passwords survive
    function basicAuthorization(username, password) {
        const bytes = new TextEncoder().encode(`${username}:${password}`);
        let binary = '';
        bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
        return `Basic ${btoa(binary)}`;
    }

    // A bearer token wins over URL credentials when both are given
    function getAuthorization(token, credentials) {
        if (token) return `Bearer ${token}`;
        if (credentials) return basicAuthorization(credentials.username, credentials.password);
        return '';
    }

    /**
     * Build the Authorization header from the selected method. user:pass@ typed in the URL is used
     * when the form has no credentials of its own.
     * @returns {{authorization: string}|{error: string}}
     */
    function resolveAuthorization({ type = 'none', token = '', username = '', password = '' } = {}, urlCredentials) {
        if (type === 'bearer') {
            const bearer = normalizeToken(token);
            if (bearer) return { authorization: getAuthorization(bearer) };
            if (urlCredentials) return { authorization: getAuthorization('', urlCredentials) };
            return { error: t('Enter the token') };
        }
        if (type === 'basic') {
            const user = String(username || '');
            const pass = String(password || '');
            if (!user.trim() && !pass) {
                if (urlCredentials) return { authorization: getAuthorization('', urlCredentials) };
                return { error: t('Enter the username and password') };
            }
            if (!user.trim()) return { error: t('Enter the username and password') };
            return { authorization: getAuthorization('', { username: user, password: pass }) };
        }
        return { authorization: getAuthorization('', urlCredentials) };
    }

    // The Location header may be relative to the endpoint (RFC 9725 4.2)
    function resolveResourceUrl(location, endpoint) {
        if (!location) return null;
        try {
            const url = new URL(location, endpoint);
            return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
        } catch (error) {
            return null;
        }
    }

    function normalizeToken(rawValue) {
        return String(rawValue || '')
            .trim()
            .replace(/^Bearer\s+/i, '');
    }

    function isRoomEndpoint(endpoint, origin, roomId) {
        try {
            const url = new URL(endpoint);
            const path = decodeURIComponent(url.pathname).replace(/\/+$/, '');
            return url.origin === origin && path === `/whip/${roomId}`;
        } catch (error) {
            return false;
        }
    }

    function describeWhipError(status, body = '') {
        const detail = String(body || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_ERROR_TEXT_LENGTH);
        // Ignore HTML error pages from proxies, they are not meant for humans in a status line
        const serverText = /<[a-z!/]/i.test(detail) ? '' : detail;
        switch (status) {
            case 401:
                return t('Unauthorized: check the credentials');
            case 404:
                return serverText || t('Endpoint not found, the room must be active');
            case 405:
                return t('This URL is not a WHIP endpoint');
            case 422:
                return serverText || t('The endpoint does not support the browser codecs');
            case 429:
                return t('Too many requests, try again later');
            case 503:
                return serverText || t('The endpoint is busy, try again later');
            default:
                return serverText || `${t('The endpoint answered with HTTP')} ${status}`;
        }
    }

    function formatBitrate(bps) {
        const value = Math.max(0, Number(bps) || 0);
        if (value >= 1e6) return `${(value / 1e6).toFixed(1)} Mbps`;
        return `${Math.round(value / 1e3)} kbps`;
    }

    function formatDuration(totalSeconds) {
        const seconds = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        const pad = (n) => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    // Non-trickle: the offer must carry every candidate since the server answers once (PATCH is optional)
    function waitForIceGathering(pc, timeoutMs = ICE_GATHERING_TIMEOUT_MS) {
        if (pc.iceGatheringState === 'complete') return Promise.resolve();
        return new Promise((resolve) => {
            const done = () => {
                clearTimeout(timer);
                pc.removeEventListener('icegatheringstatechange', onChange);
                resolve();
            };
            const onChange = () => {
                if (pc.iceGatheringState === 'complete') done();
            };
            const timer = setTimeout(done, timeoutMs);
            pc.addEventListener('icegatheringstatechange', onChange);
        });
    }

    function getErrorMessage(error) {
        if (!error) return t('Unknown error');
        if (typeof error === 'string') return error;
        switch (error.name) {
            case 'NotAllowedError':
                return t('Permission denied or capture cancelled');
            case 'NotFoundError':
            case 'OverconstrainedError':
                return t('No camera or microphone found');
            case 'NotReadableError':
                return t('The camera or microphone is in use by another application');
            default:
                return error.message || String(error);
        }
    }

    function readStorage(storage, key, fallback) {
        try {
            const raw = storage?.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (error) {
            return fallback;
        }
    }

    function writeStorage(storage, key, value) {
        try {
            storage?.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn('[WHIP] Unable to persist settings', error);
        }
    }

    // ####################################################
    // WHIP CLIENT
    // ####################################################

    function initWhipClient(config = {}) {
        const {
            elements = {},
            getPeerName = () => '',
            getLocalStreams = () => ({}),
            getDeviceIds = () => ({}),
            canUseRoomEndpoint = () => false,
            requestRoomToken = null,
            roomId = '',
            openWhipTab = () => {},
            onCopied = () => {},
            onStateChange = () => {},
            fetch: fetchImpl = typeof window.fetch === 'function' ? window.fetch.bind(window) : null,
            RTCPeerConnection: PeerConnection = window.RTCPeerConnection,
            MediaStream: MediaStreamImpl = window.MediaStream,
            mediaDevices = navigator.mediaDevices,
        } = config;

        const {
            tabWhipBtn,
            whipLiveStatus,
            whipLiveLabel,
            whipLiveStatusText,
            whipStopButton,
            whipStatus,
            whipUseRoomBtn,
            whipEndpoint,
            whipAuthRow,
            whipAuthType,
            whipToken,
            whipUsername,
            whipPassword,
            whipName,
            whipSource,
            whipAudio,
            whipBitrate,
            whipStartButton,
            whipIngestSection,
            whipGenerateTokenBtn,
            whipIngestToggle,
            whipIngestFields,
            whipIngestUrl,
            whipIngestToken,
            whipCopyIngestUrlBtn,
            whipCopyIngestTokenBtn,
        } = elements;

        if (!tabWhipBtn || !whipStartButton || !whipEndpoint) return null;

        const formInputs = [
            whipEndpoint,
            whipAuthType,
            whipToken,
            whipUsername,
            whipPassword,
            whipName,
            whipSource,
            whipAudio,
            whipBitrate,
            whipUseRoomBtn,
        ].filter(Boolean);

        let session = null;
        let lastState = 'idle';

        // ####################################################
        // UI
        // ####################################################

        function setStatus(text = '', state = 'idle') {
            if (!whipStatus) return;
            whipStatus.textContent = text;
            whipStatus.dataset.state = state;
            whipStatus.classList.toggle('hidden', !text);
        }

        function render() {
            const busy = Boolean(session);
            const live = Boolean(session?.startedAt);
            whipStartButton.classList.toggle('hidden', busy);
            whipLiveStatus?.classList.toggle('hidden', !busy);
            if (whipLiveStatus) whipLiveStatus.dataset.state = live ? 'live' : 'connecting';
            if (whipLiveLabel) whipLiveLabel.textContent = live ? t('LIVE') : t('Connecting');
            if (whipLiveStatusText) {
                whipLiveStatusText.textContent = live
                    ? `${formatDuration((Date.now() - session.startedAt) / 1000)} · ${formatBitrate(session.bitrate)} · ${session.host}`
                    : session?.host || '';
            }
            formInputs.forEach((input) => {
                input.disabled = busy;
            });
            refreshAudioOptions();
            const state = live ? 'live' : busy ? 'connecting' : 'idle';
            if (state !== lastState) {
                lastState = state;
                onStateChange(state);
            }
        }

        // Screen audio only exists when the screen is the video source
        function refreshAudioOptions() {
            const screenAudio = whipAudio?.querySelector('option[value="screen"]');
            if (!screenAudio) return;
            const isScreen = whipSource?.value === 'screen';
            screenAudio.disabled = !isScreen;
            if (!isScreen && whipAudio.value === 'screen') whipAudio.value = 'mic';
        }

        function getAuthType() {
            return AUTH_TYPES.includes(whipAuthType?.value) ? whipAuthType.value : 'none';
        }

        function refreshAuthFields() {
            const type = getAuthType();
            if (whipAuthRow) whipAuthRow.dataset.auth = type;
            whipToken?.classList.toggle('hidden', type !== 'bearer');
            whipUsername?.classList.toggle('hidden', type !== 'basic');
            whipPassword?.classList.toggle('hidden', type !== 'basic');
        }

        function setAuthType(type) {
            if (!whipAuthType || !AUTH_TYPES.includes(type)) return;
            whipAuthType.value = type;
            refreshAuthFields();
        }

        // Browsers refuse user:pass@ URLs: show them in the username and password fields instead
        function moveUrlCredentials() {
            const parsed = parseWhipEndpoint(whipEndpoint.value, window.location.protocol);
            if (!parsed.credentials || !whipUsername || !whipPassword || !whipAuthType) return;
            whipUsername.value = parsed.credentials.username;
            whipPassword.value = parsed.credentials.password;
            whipEndpoint.value = stripCredentials(whipEndpoint.value);
            setAuthType('basic');
        }

        function setIngestExpanded(expanded) {
            whipIngestFields?.classList.toggle('hidden', !expanded);
            if (!whipIngestToggle) return;
            const label = expanded ? t('Hide the WHIP token') : t('Show the WHIP token');
            whipIngestToggle.setAttribute('aria-expanded', String(expanded));
            whipIngestToggle.setAttribute('aria-label', label);
            whipIngestToggle.title = label;
        }

        function refreshRoomEndpoint() {
            const available = Boolean(requestRoomToken) && canUseRoomEndpoint();
            whipIngestSection?.classList.toggle('hidden', !available);
            whipUseRoomBtn?.classList.toggle('hidden', !available);
        }

        // ####################################################
        // SETTINGS
        // ####################################################

        function loadSettings() {
            const saved = readStorage(window.localStorage, SETTINGS_STORAGE_KEY, {});
            if (typeof saved.endpoint === 'string') whipEndpoint.value = saved.endpoint;
            if (whipName && typeof saved.name === 'string') whipName.value = saved.name;
            if (whipSource && SOURCES.includes(saved.source)) whipSource.value = saved.source;
            if (whipAudio && AUDIO_MODES.includes(saved.audio)) whipAudio.value = saved.audio;
            if (whipAuthType && AUTH_TYPES.includes(saved.auth)) whipAuthType.value = saved.auth;
            if (whipBitrate && saved.bitrate !== undefined) {
                const option = whipBitrate.querySelector(`option[value="${parseInt(saved.bitrate, 10) || 0}"]`);
                if (option) whipBitrate.value = option.value;
            }
        }

        // Only the authentication method is kept: credentials (token, password, user:pass@) never are
        function saveSettings() {
            writeStorage(window.localStorage, SETTINGS_STORAGE_KEY, {
                endpoint: stripCredentials(whipEndpoint.value),
                auth: getAuthType(),
                name: whipName?.value.trim() || '',
                source: whipSource?.value || 'camera',
                audio: whipAudio?.value || 'mic',
                bitrate: parseInt(whipBitrate?.value, 10) || 0,
            });
        }

        // ####################################################
        // MEDIA
        // ####################################################

        // Reuse the devices already open in the room (no permission prompt, no device conflicts on mobile)
        function cloneLiveTrack(stream, kind) {
            const track = stream?.getTracks?.().find((item) => item.kind === kind && item.readyState === 'live');
            if (!track) return null;
            if (kind === 'video' && track.getSettings?.().displaySurface) return null;
            const clone = track.clone();
            clone.enabled = true;
            return clone;
        }

        async function captureDevice(kind, deviceId) {
            if (!mediaDevices?.getUserMedia) throw new Error(t('Camera and microphone are not available'));
            const stream = await mediaDevices.getUserMedia({
                [kind]: deviceId ? { deviceId: { ideal: deviceId } } : true,
            });
            stream
                .getTracks()
                .filter((track) => track.kind !== kind)
                .forEach((track) => track.stop());
            return stream.getTracks().find((track) => track.kind === kind) || null;
        }

        async function acquireTracks(current, source, audioMode) {
            const local = getLocalStreams() || {};
            const deviceIds = getDeviceIds() || {};
            const own = (track) => {
                if (track) current.tracks.push(track);
                return track;
            };
            let video = null;
            let audio = null;

            if (source === 'screen') {
                if (!mediaDevices?.getDisplayMedia)
                    throw new Error(t('Screen sharing is not supported by this browser'));
                const display = await mediaDevices.getDisplayMedia({ video: true, audio: audioMode === 'screen' });
                display.getTracks().forEach(own);
                video = display.getVideoTracks()[0] || null;
                if (video && 'contentHint' in video) video.contentHint = 'detail';
                if (audioMode === 'screen') audio = display.getAudioTracks()[0] || null;
            } else if (source === 'camera') {
                video = own(cloneLiveTrack(local.video, 'video')) || own(await captureDevice('video', deviceIds.video));
            }

            if (audioMode === 'mic') {
                audio = own(cloneLiveTrack(local.audio, 'audio')) || own(await captureDevice('audio', deviceIds.audio));
            }

            if (!video && !audio) throw new Error(t('Nothing to publish: no audio or video track'));
            return { video, audio };
        }

        // ####################################################
        // SIGNALING
        // ####################################################

        async function postOffer(current, url, sdp) {
            if (!fetchImpl) throw new Error(t('This browser cannot reach WHIP endpoints'));
            const headers = { 'Content-Type': 'application/sdp' };
            if (current.authorization) headers.Authorization = current.authorization;
            const timer = setTimeout(() => {
                current.timedOut = true;
                current.controller.abort();
            }, REQUEST_TIMEOUT_MS);
            try {
                let response;
                try {
                    response = await fetchImpl(url, {
                        method: 'POST',
                        headers,
                        body: sdp,
                        signal: current.controller.signal,
                    });
                } catch (error) {
                    if (current.timedOut) throw new Error(t('The endpoint did not answer in time'));
                    if (error?.name === 'AbortError') throw error;
                    throw new Error(t('Cannot reach the endpoint (network or CORS error)'));
                }
                if (!response.ok) {
                    const body = await response.text().catch(() => '');
                    throw new Error(describeWhipError(response.status, body));
                }
                current.resourceUrl = resolveResourceUrl(response.headers.get('Location'), response.url || url);
                const answer = await response.text();
                if (!/^v=0/m.test(answer)) throw new Error(t('The endpoint did not return an SDP answer'));
                return answer;
            } finally {
                clearTimeout(timer);
            }
        }

        // Resolves once the endpoint answered (or failed) the DELETE
        function releaseResource(current, keepalive = false) {
            if (!current.resourceUrl || current.released || !fetchImpl) return null;
            current.released = true;
            const headers = current.authorization ? { Authorization: current.authorization } : {};
            return Promise.resolve()
                .then(() => fetchImpl(current.resourceUrl, { method: 'DELETE', headers, keepalive }))
                .catch((error) => console.warn('[WHIP] DELETE failed', error));
        }

        // Media stops at once, but the peer connection stays open until the DELETE is answered:
        // closing it first ends the session server-side (DTLS close) and the DELETE would get a 404.
        function teardown(current, releasing = null) {
            current.controller.abort();
            clearInterval(current.statsTimer);
            current.statsTimer = null;
            current.tracks.forEach((track) => track.stop());
            const closePeer = () => {
                try {
                    current.pc?.close();
                } catch (error) {
                    console.warn('[WHIP] Peer connection close failed', error);
                }
            };
            if (!releasing) return closePeer();
            const timer = setTimeout(closePeer, DELETE_TIMEOUT_MS);
            releasing.finally(() => {
                clearTimeout(timer);
                closePeer();
            });
        }

        // ####################################################
        // SESSION
        // ####################################################

        async function start() {
            if (session) return;

            const endpoint = parseWhipEndpoint(whipEndpoint.value, window.location.protocol);
            if (endpoint.error) return setStatus(endpoint.error, 'error');

            const source = whipSource?.value || 'camera';
            const audioMode = whipAudio?.value || 'mic';
            if (source === 'none' && audioMode === 'none') {
                return setStatus(t('Select a video or an audio source'), 'error');
            }
            const auth = resolveAuthorization(
                {
                    type: getAuthType(),
                    token: whipToken?.value,
                    username: whipUsername?.value,
                    password: whipPassword?.value,
                },
                endpoint.credentials
            );
            if (auth.error) return setStatus(auth.error, 'error');
            if (!PeerConnection) return setStatus(t('WebRTC is not supported by this browser'), 'error');

            saveSettings();

            const current = {
                pc: null,
                tracks: [],
                authorization: auth.authorization,
                controller: new AbortController(),
                host: new URL(endpoint.url).host,
                resourceUrl: null,
                released: false,
                timedOut: false,
                startedAt: 0,
                statsTimer: null,
                bytesSent: 0,
                statsAt: 0,
                bitrate: 0,
            };
            session = current;
            setStatus(t('Connecting...'), 'busy');
            render();

            try {
                const { video, audio } = await acquireTracks(current, source, audioMode);
                if (session !== current) return teardown(current);
                if (audioMode === 'screen' && !audio) {
                    setStatus(t('No screen audio was shared, publishing video only'), 'busy');
                }

                const pc = new PeerConnection({ bundlePolicy: 'max-bundle' });
                current.pc = pc;
                const stream = new MediaStreamImpl([audio, video].filter(Boolean));
                if (audio) pc.addTransceiver(audio, { direction: 'sendonly', streams: [stream] });
                if (video) {
                    const maxBitrate = parseInt(whipBitrate?.value, 10) || 0;
                    pc.addTransceiver(video, {
                        direction: 'sendonly',
                        streams: [stream],
                        ...(maxBitrate > 0 ? { sendEncodings: [{ maxBitrate }] } : {}),
                    });
                }
                pc.addEventListener('connectionstatechange', () => handleConnectionState(current));
                [audio, video].filter(Boolean).forEach((track) => {
                    track.addEventListener('ended', () => {
                        if (session === current) stop({ status: t('The media source ended'), state: 'idle' });
                    });
                });

                await pc.setLocalDescription(await pc.createOffer());
                await waitForIceGathering(pc);
                if (session !== current) return;

                const publishUrl = buildPublishUrl(endpoint.url, whipName?.value, getPeerName());
                const answer = await postOffer(current, publishUrl, pc.localDescription.sdp);
                if (session !== current) return releaseResource(current);

                await pc.setRemoteDescription({ type: 'answer', sdp: answer });
                if (session === current && !current.startedAt)
                    setStatus(t('Establishing the media connection...'), 'busy');
                if (!current.resourceUrl) console.warn('[WHIP] No Location header: the session cannot be ended');
            } catch (error) {
                if (session !== current) return teardown(current);
                console.error('[WHIP] Publish failed', error);
                stop({ status: getErrorMessage(error), state: 'error' });
            }
        }

        function stop({ status = t('Stopped'), state = 'idle', keepalive = false } = {}) {
            const current = session;
            if (!current) return;
            session = null;
            const releasing = releaseResource(current, keepalive);
            // The page is going away on pagehide: nothing to wait for
            teardown(current, keepalive ? null : releasing);
            setStatus(status, state);
            render();
        }

        function handleConnectionState(current) {
            if (session !== current) return;
            switch (current.pc.connectionState) {
                case 'connected':
                    if (!current.startedAt) current.startedAt = Date.now();
                    startStats(current);
                    setStatus(`${t('Publishing to')} ${current.host}`, 'live');
                    render();
                    break;
                case 'disconnected':
                    setStatus(t('Connection interrupted, reconnecting...'), 'busy');
                    break;
                case 'failed':
                    stop({ status: t('Connection failed'), state: 'error' });
                    break;
                default:
                    break;
            }
        }

        function startStats(current) {
            if (current.statsTimer) return;
            current.statsTimer = setInterval(async () => {
                if (session !== current) return;
                try {
                    const report = await current.pc.getStats();
                    let bytes = 0;
                    let timestamp = 0;
                    report.forEach((stat) => {
                        if (stat.type !== 'outbound-rtp') return;
                        bytes += stat.bytesSent || 0;
                        timestamp = Math.max(timestamp, stat.timestamp || 0);
                    });
                    if (current.statsAt && timestamp > current.statsAt) {
                        current.bitrate = ((bytes - current.bytesSent) * 8 * 1000) / (timestamp - current.statsAt);
                    }
                    current.bytesSent = bytes;
                    current.statsAt = timestamp;
                } catch (error) {
                    console.warn('[WHIP] getStats failed', error);
                }
                if (session === current) render();
            }, STATS_INTERVAL_MS);
        }

        // ####################################################
        // THIS ROOM ENDPOINT
        // ####################################################

        async function mintRoomToken() {
            if (!requestRoomToken) return null;
            if (whipGenerateTokenBtn) whipGenerateTokenBtn.disabled = true;
            if (whipUseRoomBtn) whipUseRoomBtn.disabled = true;
            try {
                const { url, token } = await requestRoomToken();
                if (!url || !token) throw new Error(t('Unable to create a WHIP token'));
                if (whipIngestUrl) whipIngestUrl.value = url;
                if (whipIngestToken) whipIngestToken.value = token;
                whipIngestToggle?.classList.remove('hidden');
                setIngestExpanded(true);
                return { url, token };
            } catch (error) {
                setStatus(getErrorMessage(error), 'error');
                return null;
            } finally {
                if (whipGenerateTokenBtn) whipGenerateTokenBtn.disabled = false;
                if (whipUseRoomBtn) whipUseRoomBtn.disabled = Boolean(session);
            }
        }

        async function useThisRoom() {
            const credentials = await mintRoomToken();
            if (!credentials || session) return;
            whipEndpoint.value = credentials.url;
            if (whipToken) whipToken.value = credentials.token;
            setAuthType('bearer');
            saveSettings();
            setStatus(t('This room is the destination: mute its WHIP tile to avoid hearing yourself'), 'info');
        }

        async function copyValue(input) {
            if (!input?.value) return;
            try {
                await navigator.clipboard.writeText(input.value);
                onCopied();
            } catch (error) {
                setStatus(t('Copy failed: clipboard permission denied'), 'error');
            }
        }

        // ####################################################
        // WIRING
        // ####################################################

        loadSettings();
        refreshAuthFields();
        refreshRoomEndpoint();
        setStatus('');
        render();

        tabWhipBtn.onclick = (e) => {
            refreshRoomEndpoint();
            if (whipName) whipName.placeholder = getPeerName() || '';
            openWhipTab(e);
        };
        whipStartButton.onclick = () => start();
        if (whipStopButton) whipStopButton.onclick = () => stop();
        if (whipUseRoomBtn) whipUseRoomBtn.onclick = () => useThisRoom();
        if (whipGenerateTokenBtn) whipGenerateTokenBtn.onclick = () => mintRoomToken();
        if (whipIngestToggle) {
            whipIngestToggle.onclick = () =>
                setIngestExpanded(whipIngestToggle.getAttribute('aria-expanded') !== 'true');
        }
        whipAuthType?.addEventListener('change', () => {
            refreshAuthFields();
            saveSettings();
        });
        if (whipCopyIngestUrlBtn) whipCopyIngestUrlBtn.onclick = () => copyValue(whipIngestUrl);
        if (whipCopyIngestTokenBtn) whipCopyIngestTokenBtn.onclick = () => copyValue(whipIngestToken);
        whipSource?.addEventListener('change', () => {
            refreshAudioOptions();
            saveSettings();
        });
        [whipAudio, whipBitrate, whipName]
            .filter(Boolean)
            .forEach((input) => input.addEventListener('change', saveSettings));
        whipEndpoint.addEventListener('change', () => {
            moveUrlCredentials();
            saveSettings();
            if (roomId && isRoomEndpoint(whipEndpoint.value.trim(), window.location.origin, roomId)) {
                setStatus(t('This room is the destination: mute its WHIP tile to avoid hearing yourself'), 'info');
            }
        });
        [whipEndpoint, whipToken, whipUsername, whipPassword].filter(Boolean).forEach((input) =>
            input.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                start();
            })
        );

        window.addEventListener('pagehide', () => stop({ keepalive: true }));

        return {
            start,
            stop,
            isActive: () => Boolean(session),
            refresh: refreshRoomEndpoint,
        };
    }

    if (typeof window !== 'undefined') {
        window.initWhipClient = initWhipClient;
        window.WhipClientUtils = {
            parseWhipEndpoint,
            buildPublishUrl,
            stripCredentials,
            isMiroTalkEndpoint,
            getAuthorization,
            resolveAuthorization,
            resolveResourceUrl,
            normalizeToken,
            isRoomEndpoint,
            describeWhipError,
            formatBitrate,
            formatDuration,
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            parseWhipEndpoint,
            buildPublishUrl,
            stripCredentials,
            isMiroTalkEndpoint,
            getAuthorization,
            resolveAuthorization,
            resolveResourceUrl,
            normalizeToken,
            isRoomEndpoint,
            describeWhipError,
            formatBitrate,
            formatDuration,
        };
    }
})();
