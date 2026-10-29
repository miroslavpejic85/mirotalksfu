'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/js/WhipClient.js'), 'utf8');
const roomHtml = fs.readFileSync(path.join(root, 'public/views/Room.html'), 'utf8');
const {
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
} = require('../public/js/WhipClient.js');

describe('WHIP client helpers', () => {
    it('accepts https endpoints and drops the fragment', () => {
        assert.deepEqual(parseWhipEndpoint(' https://sfu.example.com/whip/room#x '), {
            url: 'https://sfu.example.com/whip/room',
        });
    });

    it('rejects empty, malformed and non-http endpoints', () => {
        assert.ok(parseWhipEndpoint('').error);
        assert.ok(parseWhipEndpoint('not a url').error);
        assert.ok(parseWhipEndpoint('rtmp://a.rtmp.youtube.com/live2').error);
    });

    it('moves user:pass@ out of the URL so the browser can fetch it', () => {
        const parsed = parseWhipEndpoint('https://my%20user:p%40ss@mtx.example.com:8889/cam/whip');
        assert.equal(parsed.url, 'https://mtx.example.com:8889/cam/whip');
        assert.equal(JSON.stringify(parsed.credentials), '{"username":"my user","password":"p@ss"}');
        assert.equal(stripCredentials(' https://u:p@mtx.example.com/cam/whip '), 'https://mtx.example.com/cam/whip');
        assert.equal(stripCredentials('https://x.io/whip/r'), 'https://x.io/whip/r');
        assert.equal(stripCredentials('not a url'), 'not a url');
    });

    it('sends a bearer token, else Basic auth from the URL credentials', () => {
        const credentials = { username: 'user', password: 'pässword' };
        assert.equal(getAuthorization('abc', credentials), 'Bearer abc');
        assert.equal(
            getAuthorization('', credentials),
            `Basic ${Buffer.from('user:pässword', 'utf8').toString('base64')}`
        );
        assert.equal(getAuthorization('', null), '');
    });

    it('builds the Authorization header from the selected method', () => {
        const fromUrl = { username: 'url', password: 'pw' };
        const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
        assert.deepEqual(resolveAuthorization({ type: 'none' }), { authorization: '' });
        assert.deepEqual(resolveAuthorization({ type: 'none', token: 'ignored' }, fromUrl), {
            authorization: basic('url', 'pw'),
        });
        assert.deepEqual(resolveAuthorization({ type: 'bearer', token: ' Bearer abc ' }), {
            authorization: 'Bearer abc',
        });
        assert.equal(resolveAuthorization({ type: 'bearer', token: ' ' }).error, 'Enter the token');
        assert.deepEqual(resolveAuthorization({ type: 'basic', username: 'bob', password: 'pässword' }, fromUrl), {
            authorization: basic('bob', 'pässword'),
        });
        assert.deepEqual(resolveAuthorization({ type: 'basic' }, fromUrl), { authorization: basic('url', 'pw') });
        assert.equal(resolveAuthorization({ type: 'basic' }).error, 'Enter the username and password');
        assert.equal(
            resolveAuthorization({ type: 'basic', password: 'only' }).error,
            'Enter the username and password'
        );
    });

    it('blocks mixed content except on loopback', () => {
        assert.ok(parseWhipEndpoint('http://sfu.example.com/whip/room', 'https:').error);
        assert.equal(
            parseWhipEndpoint('http://localhost:3010/whip/room', 'https:').url,
            'http://localhost:3010/whip/room'
        );
        assert.equal(
            parseWhipEndpoint('http://sfu.example.com/whip/room', 'http:').url,
            'http://sfu.example.com/whip/room'
        );
    });

    it('adds ?name= for MiroTalk endpoints, and for other servers only when typed explicitly', () => {
        assert.ok(isMiroTalkEndpoint('https://x.io/whip/r/'));
        assert.ok(!isMiroTalkEndpoint('https://x.io/cam/whip'));
        assert.equal(buildPublishUrl('https://x.io/whip/r', '', 'Miro Talk'), 'https://x.io/whip/r?name=Miro+Talk');
        assert.equal(buildPublishUrl('https://x.io/whip/r?name=OBS', 'Miro', 'Miro'), 'https://x.io/whip/r?name=OBS');
        assert.equal(buildPublishUrl('https://x.io/whip/r', '  ', ''), 'https://x.io/whip/r');
        assert.equal(
            buildPublishUrl('https://cdn.io/abc/webRTC/publish', '', 'Miro'),
            'https://cdn.io/abc/webRTC/publish'
        );
        assert.equal(
            buildPublishUrl('https://cdn.io/live/whip?key=1', 'Studio', 'Miro'),
            'https://cdn.io/live/whip?key=1&name=Studio'
        );
    });

    it('resolves relative and absolute Location headers', () => {
        assert.equal(resolveResourceUrl('/whip/r/abc', 'https://x.io/whip/r?name=a'), 'https://x.io/whip/r/abc');
        assert.equal(resolveResourceUrl('https://y.io/res/1', 'https://x.io/whip/r'), 'https://y.io/res/1');
        assert.equal(resolveResourceUrl('javascript:alert(1)', 'https://x.io/whip/r'), null);
        assert.equal(resolveResourceUrl(null, 'https://x.io/whip/r'), null);
    });

    it('normalizes pasted tokens and detects this room endpoint', () => {
        assert.equal(normalizeToken(' Bearer abc.def '), 'abc.def');
        assert.equal(normalizeToken('abc'), 'abc');
        assert.ok(isRoomEndpoint('https://meet.io/whip/my%20room/', 'https://meet.io', 'my room'));
        assert.ok(!isRoomEndpoint('https://other.io/whip/my room', 'https://meet.io', 'my room'));
    });

    it('describes HTTP failures, preferring plain-text server reasons', () => {
        assert.equal(describeWhipError(401, 'Unauthorized'), 'Unauthorized: check the credentials');
        assert.equal(describeWhipError(403, 'Room is locked'), 'Room is locked');
        assert.equal(
            describeWhipError(404, '<html><body>nginx</body></html>'),
            'Endpoint not found, the room must be active'
        );
        assert.equal(describeWhipError(500, ''), 'The endpoint answered with HTTP 500');
    });

    it('formats bitrates', () => {
        assert.equal(formatBitrate(850000), '850 kbps');
        assert.equal(formatBitrate(2500000), '2.5 Mbps');
        assert.equal(formatBitrate(undefined), '0 kbps');
    });
});

// ####################################################
// UI FLOW (fake WebRTC + fetch)
// ####################################################

class FakeTrack {
    constructor(kind, { displaySurface } = {}) {
        this.kind = kind;
        this.readyState = 'live';
        this.enabled = true;
        this.stopped = false;
        this.contentHint = '';
        this.listeners = {};
        this.settings = displaySurface ? { displaySurface } : {};
    }
    getSettings() {
        return this.settings;
    }
    clone() {
        const copy = new FakeTrack(this.kind, { displaySurface: this.settings.displaySurface });
        copy.enabled = this.enabled;
        copy.isClone = true;
        return copy;
    }
    stop() {
        this.stopped = true;
        this.readyState = 'ended';
    }
    addEventListener(type, fn) {
        this.listeners[type] = fn;
    }
}

class FakeStream {
    constructor(tracks = []) {
        this.tracks = tracks;
    }
    getTracks() {
        return this.tracks;
    }
    getVideoTracks() {
        return this.tracks.filter((track) => track.kind === 'video');
    }
    getAudioTracks() {
        return this.tracks.filter((track) => track.kind === 'audio');
    }
}

function createFakePeerConnection(instances) {
    return class FakePeerConnection {
        constructor(config) {
            this.config = config;
            this.transceivers = [];
            this.listeners = {};
            this.iceGatheringState = 'new';
            this.connectionState = 'new';
            this.closed = false;
            instances.push(this);
        }
        addTransceiver(track, init) {
            this.transceivers.push({ track, init });
        }
        addEventListener(type, fn) {
            this.listeners[type] = fn;
        }
        removeEventListener(type) {
            delete this.listeners[type];
        }
        async createOffer() {
            return { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' };
        }
        async setLocalDescription(description) {
            this.localDescription = description;
            setTimeout(() => {
                this.iceGatheringState = 'complete';
                this.listeners.icegatheringstatechange?.();
            }, 0);
        }
        async setRemoteDescription(description) {
            this.remoteDescription = description;
        }
        async getStats() {
            return new Map([['o1', { type: 'outbound-rtp', bytesSent: 1000, timestamp: Date.now() }]]);
        }
        setConnectionState(state) {
            this.connectionState = state;
            this.listeners.connectionstatechange?.();
        }
        close() {
            this.closed = true;
        }
    };
}

describe('WHIP client UI', () => {
    let dom;
    let window;
    let document;
    let byId;
    let requests;
    let peerConnections;
    let localStreams;
    let displayCalls;
    let userMediaCalls;
    let states;
    let fetchResponse;
    let tokenRequests;

    function setup({ seedStorage = () => {}, canUseRoomEndpoint = false } = {}) {
        const start = roomHtml.indexOf('<div id="tabWhip"');
        const end = roomHtml.indexOf('<div id="tabProfile"');
        assert.ok(start > 0 && end > start, 'WHIP tab markup not found');
        dom = new JSDOM(`<!DOCTYPE html><body><button id="tabWhipBtn"></button>${roomHtml.slice(start, end)}</body>`, {
            url: 'https://meet.example.com/join/room1',
            runScripts: 'outside-only',
            pretendToBeVisual: true,
        });
        window = dom.window;
        document = window.document;
        window.console = { log() {}, warn() {}, error() {} };
        seedStorage(window);
        window.eval(source);
        byId = (id) => document.getElementById(id);

        requests = [];
        peerConnections = [];
        displayCalls = [];
        userMediaCalls = [];
        states = [];
        tokenRequests = 0;
        localStreams = {
            video: new FakeStream([new FakeTrack('video')]),
            audio: new FakeStream([new FakeTrack('audio')]),
        };
        fetchResponse = () => ({
            ok: true,
            status: 201,
            url: requests[requests.length - 1].url,
            headers: { get: (name) => (name === 'Location' ? '/whip/room2/session-1' : null) },
            text: async () => 'v=0\r\no=- 2 2 IN IP4 1.2.3.4\r\n',
        });

        const ids = ['tabWhipBtn', ...[...document.querySelectorAll('#tabWhip [id]')].map((el) => el.id)];
        const elements = Object.fromEntries(ids.map((id) => [id, byId(id)]));
        return window.initWhipClient({
            elements,
            roomId: 'room1',
            getPeerName: () => 'Miro',
            getLocalStreams: () => localStreams,
            canUseRoomEndpoint: () => canUseRoomEndpoint,
            requestRoomToken: async () => {
                tokenRequests++;
                return { url: 'https://meet.example.com/whip/room1', token: 'room-token' };
            },
            onStateChange: (state) => states.push(state),
            fetch: async (url, options) => {
                requests.push({ url, ...options, pcOpen: !peerConnections[peerConnections.length - 1]?.closed });
                return options.method === 'DELETE' ? { ok: true, status: 200 } : fetchResponse();
            },
            RTCPeerConnection: createFakePeerConnection(peerConnections),
            MediaStream: FakeStream,
            mediaDevices: {
                getDisplayMedia: async (constraints) => {
                    displayCalls.push(constraints);
                    const tracks = [new FakeTrack('video', { displaySurface: 'monitor' })];
                    if (constraints.audio) tracks.push(new FakeTrack('audio'));
                    return new FakeStream(tracks);
                },
                getUserMedia: async (constraints) => {
                    userMediaCalls.push(constraints);
                    return new FakeStream(Object.keys(constraints).map((kind) => new FakeTrack(kind)));
                },
            },
        });
    }

    afterEach(() => window.close());

    const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

    function click(element) {
        element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    }

    function fill(id, value) {
        const input = byId(id);
        input.value = value;
        input.dispatchEvent(new window.Event('change'));
    }

    it('starts idle, hides the room endpoint section when WHIP ingest is unavailable', () => {
        setup();
        assert.ok(byId('whipLiveStatus').classList.contains('hidden'));
        assert.ok(!byId('whipStartButton').classList.contains('hidden'));
        assert.ok(byId('whipIngestSection').classList.contains('hidden'));
        assert.ok(byId('whipUseRoomBtn').classList.contains('hidden'));
    });

    it('validates the form before touching any device', async () => {
        setup();
        click(byId('whipStartButton'));
        await flush();
        assert.equal(byId('whipStatus').dataset.state, 'error');
        assert.equal(byId('whipStatus').textContent, 'Enter the WHIP endpoint URL');

        fill('whipEndpoint', 'https://other.example.com/whip/room2');
        byId('whipSource').value = 'none';
        byId('whipAudio').value = 'none';
        click(byId('whipStartButton'));
        await flush();
        assert.equal(byId('whipStatus').textContent, 'Select a video or an audio source');
        assert.equal(peerConnections.length, 0);
        assert.equal(userMediaCalls.length, 0);
    });

    it('publishes cloned room tracks, posts a send-only offer and ends the session with DELETE', async () => {
        const client = setup();
        fill('whipEndpoint', 'https://other.example.com/whip/room2');
        fill('whipAuthType', 'bearer');
        byId('whipToken').value = 'Bearer secret-token';
        byId('whipBitrate').value = '2500000';
        click(byId('whipStartButton'));
        await flush();

        assert.equal(userMediaCalls.length, 0, 'room devices are reused');
        const [pc] = peerConnections;
        assert.equal(pc.config.bundlePolicy, 'max-bundle');
        assert.deepEqual(
            pc.transceivers.map(({ track, init }) => [track.kind, track.isClone, init.direction]),
            [
                ['audio', true, 'sendonly'],
                ['video', true, 'sendonly'],
            ]
        );
        assert.equal(JSON.stringify(pc.transceivers[1].init.sendEncodings), '[{"maxBitrate":2500000}]');

        const [post] = requests;
        assert.equal(post.method, 'POST');
        assert.equal(post.url, 'https://other.example.com/whip/room2?name=Miro');
        assert.equal(post.headers['Content-Type'], 'application/sdp');
        assert.equal(post.headers.Authorization, 'Bearer secret-token');
        assert.match(post.body, /^v=0/);
        assert.equal(pc.remoteDescription.type, 'answer');
        assert.equal(byId('whipLiveLabel').textContent, 'Connecting');
        assert.ok(byId('whipEndpoint').disabled);

        pc.setConnectionState('connected');
        assert.equal(byId('whipLiveLabel').textContent, 'LIVE');
        assert.equal(byId('whipLiveStatus').dataset.state, 'live');
        assert.ok(client.isActive());
        assert.deepEqual(states, ['connecting', 'live']);

        click(byId('whipStopButton'));
        await flush();
        const del = requests[1];
        assert.equal(del.method, 'DELETE');
        assert.equal(del.url, 'https://other.example.com/whip/room2/session-1');
        assert.equal(del.headers.Authorization, 'Bearer secret-token');
        assert.ok(del.pcOpen, 'DELETE is sent before the DTLS close');
        assert.ok(pc.closed);
        assert.ok(
            pc.transceivers.every(({ track }) => track.stopped),
            'cloned tracks are stopped'
        );
        assert.ok(localStreams.video.getTracks()[0].readyState === 'live', 'room camera keeps running');
        assert.ok(!client.isActive());
        assert.ok(!byId('whipEndpoint').disabled);
        assert.deepEqual(states, ['connecting', 'live', 'idle']);
    });

    it('captures the screen with its audio and opens the camera only when the room has none', async () => {
        setup();
        fill('whipEndpoint', 'https://other.example.com/whip/room2');
        byId('whipSource').value = 'screen';
        byId('whipSource').dispatchEvent(new window.Event('change'));
        byId('whipAudio').value = 'screen';
        click(byId('whipStartButton'));
        await flush();
        assert.equal(JSON.stringify(displayCalls), '[{"video":true,"audio":true}]');
        assert.equal(peerConnections[0].transceivers[1].track.contentHint, 'detail');
        click(byId('whipStopButton'));

        // Screen audio is only possible with the screen source
        byId('whipSource').value = 'camera';
        byId('whipSource').dispatchEvent(new window.Event('change'));
        assert.equal(byId('whipAudio').value, 'mic');
        assert.ok(byId('whipAudio').querySelector('option[value="screen"]').disabled);

        localStreams = {};
        click(byId('whipStartButton'));
        await flush();
        assert.deepEqual(
            userMediaCalls.map((constraints) => Object.keys(constraints)[0]),
            ['video', 'audio']
        );
    });

    it('shows the server reason and releases the media when the endpoint refuses the offer', async () => {
        setup();
        fetchResponse = () => ({
            ok: false,
            status: 403,
            headers: { get: () => null },
            text: async () => 'Room is locked',
        });
        fill('whipEndpoint', 'https://other.example.com/whip/room2');
        click(byId('whipStartButton'));
        await flush();
        assert.equal(byId('whipStatus').textContent, 'Room is locked');
        assert.equal(byId('whipStatus').dataset.state, 'error');
        assert.ok(peerConnections[0].closed);
        assert.ok(peerConnections[0].transceivers.every(({ track }) => track.stopped));
        assert.ok(!byId('whipStartButton').classList.contains('hidden'));
        assert.equal(requests.filter((request) => request.method === 'DELETE').length, 0);
    });

    it('publishes to a user:pass@ server with Basic auth, no ?name=, and never stores the password', async () => {
        setup();
        fill('whipEndpoint', 'https://bob:s3cret@mtx.example.com:8889/cam/whip');
        click(byId('whipStartButton'));
        await flush();

        assert.equal(byId('whipEndpoint').value, 'https://mtx.example.com:8889/cam/whip');
        assert.equal(byId('whipAuthType').value, 'basic');
        assert.equal(byId('whipUsername').value, 'bob');
        assert.equal(byId('whipPassword').value, 's3cret');

        const [post] = requests;
        assert.equal(post.url, 'https://mtx.example.com:8889/cam/whip');
        assert.equal(post.headers.Authorization, `Basic ${Buffer.from('bob:s3cret').toString('base64')}`);
        assert.ok(!window.localStorage.getItem('MIROTALK_WHIP_SETTINGS').includes('s3cret'));

        click(byId('whipStopButton'));
        await flush();
        assert.equal(requests[1].method, 'DELETE');
        assert.equal(requests[1].url, 'https://mtx.example.com:8889/whip/room2/session-1');
        assert.equal(requests[1].headers.Authorization, post.headers.Authorization);
    });

    it('shows only the credential fields of the selected authentication method', () => {
        setup();
        const visible = () =>
            ['whipToken', 'whipUsername', 'whipPassword'].filter((id) => !byId(id).classList.contains('hidden'));
        assert.equal(byId('whipAuthType').value, 'none');
        assert.deepEqual(visible(), []);
        fill('whipAuthType', 'bearer');
        assert.deepEqual(visible(), ['whipToken']);
        fill('whipAuthType', 'basic');
        assert.deepEqual(visible(), ['whipUsername', 'whipPassword']);
        assert.equal(byId('whipAuthRow').dataset.auth, 'basic');
    });

    it('publishes with Basic auth from the username and password fields', async () => {
        setup();
        fill('whipEndpoint', 'https://mtx.example.com/cam/whip');
        fill('whipAuthType', 'basic');
        click(byId('whipStartButton'));
        await flush();
        assert.equal(byId('whipStatus').textContent, 'Enter the username and password');
        assert.equal(peerConnections.length, 0);

        byId('whipUsername').value = 'alice';
        byId('whipPassword').value = 'pässword';
        click(byId('whipStartButton'));
        await flush();
        assert.equal(
            requests[0].headers.Authorization,
            `Basic ${Buffer.from('alice:pässword', 'utf8').toString('base64')}`
        );
        assert.ok(byId('whipAuthType').disabled && byId('whipPassword').disabled);
        const saved = window.localStorage.getItem('MIROTALK_WHIP_SETTINGS');
        assert.equal(JSON.parse(saved).auth, 'basic');
        assert.ok(!saved.includes('alice') && !saved.includes('pässword'));
    });

    it('requires a token when the bearer method is selected', async () => {
        setup();
        fill('whipEndpoint', 'https://other.example.com/whip/room2');
        fill('whipAuthType', 'bearer');
        click(byId('whipStartButton'));
        await flush();
        assert.equal(byId('whipStatus').textContent, 'Enter the token');
        assert.equal(requests.length, 0);
    });

    it('stops when the connection fails', async () => {
        setup();
        fill('whipEndpoint', 'https://other.example.com/whip/room2');
        click(byId('whipStartButton'));
        await flush();
        peerConnections[0].setConnectionState('failed');
        await flush();
        assert.equal(byId('whipStatus').textContent, 'Connection failed');
        assert.equal(requests[1].method, 'DELETE');
    });

    it('creates a token for this room and can use it as destination', async () => {
        setup({ canUseRoomEndpoint: true });
        click(byId('tabWhipBtn'));
        assert.ok(!byId('whipIngestSection').classList.contains('hidden'));
        assert.equal(byId('whipName').placeholder, 'Miro');

        click(byId('whipGenerateTokenBtn'));
        await flush();
        assert.ok(!byId('whipIngestFields').classList.contains('hidden'));
        assert.ok(!byId('whipIngestToggle').classList.contains('hidden'));
        assert.equal(byId('whipIngestToggle').getAttribute('aria-expanded'), 'true');
        click(byId('whipIngestToggle'));
        assert.ok(byId('whipIngestFields').classList.contains('hidden'));
        assert.equal(byId('whipIngestToggle').getAttribute('aria-expanded'), 'false');
        click(byId('whipIngestToggle'));
        assert.ok(!byId('whipIngestFields').classList.contains('hidden'));
        assert.equal(byId('whipIngestUrl').value, 'https://meet.example.com/whip/room1');
        assert.equal(byId('whipIngestToken').value, 'room-token');

        click(byId('whipUseRoomBtn'));
        await flush();
        assert.equal(tokenRequests, 2);
        assert.equal(byId('whipEndpoint').value, 'https://meet.example.com/whip/room1');
        assert.equal(byId('whipToken').value, 'room-token');
        assert.equal(byId('whipAuthType').value, 'bearer');
        assert.ok(!byId('whipToken').classList.contains('hidden'));
        assert.equal(byId('whipStatus').dataset.state, 'info');
    });

    it('persists the destination and source but never the token', () => {
        setup();
        byId('whipToken').value = 'secret-token';
        byId('whipSource').value = 'screen';
        fill('whipEndpoint', 'https://other.example.com/whip/room2');
        const saved = window.localStorage.getItem('MIROTALK_WHIP_SETTINGS');
        assert.ok(!saved.includes('secret-token'));
        assert.equal(JSON.parse(saved).source, 'screen');

        window.close();
        setup({
            seedStorage: (win) =>
                win.localStorage.setItem(
                    'MIROTALK_WHIP_SETTINGS',
                    JSON.stringify({
                        endpoint: 'https://saved.example.com/whip/a',
                        auth: 'bearer',
                        source: 'none',
                        bitrate: 1000000,
                    })
                ),
        });
        assert.equal(byId('whipEndpoint').value, 'https://saved.example.com/whip/a');
        assert.equal(byId('whipSource').value, 'none');
        assert.equal(byId('whipBitrate').value, '1000000');
        assert.equal(byId('whipAuthType').value, 'bearer');
        assert.ok(!byId('whipToken').classList.contains('hidden'));
        assert.equal(byId('whipToken').value, '');
    });
});
