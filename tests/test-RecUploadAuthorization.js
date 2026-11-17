'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { PassThrough, Readable } = require('stream');
const jwt = require('jsonwebtoken');
const sanitizeFilename = require('sanitize-filename');
const { v4: uuidv4 } = require('uuid');
const Validator = require('../app/src/Validator');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'Server.js'), 'utf8');

function slice(start, end) {
    const from = serverSource.indexOf(start);
    const to = serverSource.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `Server.js slice not found: ${start}`);
    return serverSource.slice(from, to);
}

const tokenSource = slice('function createRecUploadToken(', '// Create a signed token bound to a room, authorizing');
const utilitySource = slice('    function isValidRequest(', '    function deleteFile(');
const saveSource = slice('    async function saveLocally(', '    // ####');
const routesSource = slice("    app.post('/recSync',", '    // INCOMING STREAM');
const socketSource = slice("        socket.on('getRecUploadToken',", "        socket.on('serverRecording',");

describe('Recording upload (/recSync*) authorization', () => {
    let recDir;

    beforeEach(() => {
        recDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirotalk-recsync-'));
    });

    afterEach(() => {
        fs.rmSync(recDir, { recursive: true, force: true });
    });

    function createRoom(id, sessionId = 'session-1') {
        const peers = new Map();
        const banned = new Set();
        return {
            id,
            sessionId,
            peers,
            hostOnly: false,
            getSessionId() {
                return this.sessionId;
            },
            getPeer: (peerId) => peers.get(peerId),
            isBanned: (uuid, authUser) => banned.has(uuid) || (!!authUser && banned.has(`auth:${authUser}`)),
            ban: (uuid, authUser) => {
                banned.add(uuid);
                if (authUser) banned.add(`auth:${authUser}`);
            },
            isHostOnlyRecording() {
                return this.hostOnly;
            },
        };
    }

    function setup() {
        const routes = {};
        const socketHandlers = {};
        const presenters = new Set();
        const roomList = new Map();
        const context = vm.createContext({
            jwt,
            jwtKeys: { recUpload: 'test-rec-upload-key' },
            JWT_VERIFY_OPTIONS: { algorithms: ['HS256'] },
            recUploadTokenExp: '1h',
            uuidv4,
            serverRecordingEnabled: true,
            roomList,
            Validator,
            sanitizeFilename,
            fs,
            path,
            PassThrough,
            dir: { rec: recDir },
            recMaxFileSize: 1024 * 1024,
            withFileLock: (filePath, fn) => fn(),
            checkXSS: (data) => data,
            log: { debug() {}, info() {}, warn() {}, error() {} },
            console: { warn() {}, error() {}, log() {} },
            config: { integrations: { s3: { enabled: true } }, media: { recording: { uploadToS3: true } } },
            recSyncLimiter: (req, res, next) => next(),
            fixDurationOrRemux() {},
            uploadToS3: async () => ({ success: true }),
            deleteFile() {},
            s3Client: null,
            app: { post: (route, ...handlers) => (routes[route] = handlers) },
            socket: { id: 'socket-id', room_id: null, on: (event, handler) => (socketHandlers[event] = handler) },
            roomExists: (socket) => roomList.has(socket.room_id),
            getRoomAndPeer: (socket) => {
                const room = roomList.get(socket.room_id);
                return { room, peer: room?.getPeer(socket.id) || null };
            },
            isPeerInLobby: (peer) => Boolean(peer && peer.peer_lobby === true),
            isPeerPresenter: (roomId, peerId) => presenters.has(`${roomId}:${peerId}`),
        });
        vm.runInContext(
            `${tokenSource}\n${utilitySource}\n${saveSource}\n${routesSource}\n${socketSource}\n` +
                'globalThis.createRecUploadToken = createRecUploadToken;',
            context
        );

        function addRoom(id, sessionId) {
            const room = createRoom(id, sessionId);
            roomList.set(id, room);
            return room;
        }

        function join(room, socketId, { uuid = `${socketId}-uuid`, authUser = null, presenter = false } = {}) {
            room.peers.set(socketId, {
                id: socketId,
                authUser,
                peer_info: { peer_name: socketId, peer_uuid: uuid },
            });
            if (presenter) presenters.add(`${room.id}:${socketId}`);
        }

        async function requestToken(room, socketId, data = { dateTime: '2026_11_17_05_24_04' }) {
            context.socket.id = socketId;
            context.socket.room_id = room.id;
            let result;
            socketHandlers.getRecUploadToken(data, (response) => (result = response));
            return result;
        }

        async function call(route, { token, fileName, body = Buffer.alloc(0), durationMs } = {}) {
            const req = Readable.from(body.length ? [body] : []);
            req.headers = { 'content-type': 'application/octet-stream' };
            if (token) req.headers.authorization = `Bearer ${token}`;
            req.query = { fileName, ...(durationMs ? { durationMs } : {}) };
            const res = {
                statusCode: 200,
                body: null,
                status(code) {
                    this.statusCode = code;
                    return this;
                },
                json(payload) {
                    this.body = payload;
                    return this;
                },
            };
            const [limiter, auth, handler] = routes[route];
            let passed = false;
            limiter(req, res, () => {});
            auth(req, res, () => (passed = true));
            if (passed) await handler(req, res);
            return res;
        }

        // Results come from the vm realm; normalize them for deepEqual
        const plain = (value) => JSON.parse(JSON.stringify(value));

        const stored = (fileName) => {
            const filePath = path.join(recDir, fileName);
            return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
        };

        return { context, addRoom, join, requestToken, call, stored, plain };
    }

    it('issues a unique, server-generated file name bound to the room session', async () => {
        const s = setup();
        const room = s.addRoom('room1');
        s.join(room, 'host', { presenter: true });

        const first = await s.requestToken(room, 'host');
        const second = await s.requestToken(room, 'host');

        assert.match(first.fileName, /^Rec_room1_2026_11_17_05_24_04_session-1_[0-9a-f]{12}\.webm$/);
        assert.notEqual(first.fileName, second.fileName);
        const claims = jwt.verify(first.token, 'test-rec-upload-key');
        assert.equal(claims.scope, 'rec-upload');
        assert.equal(claims.roomId, 'room1');
        assert.equal(claims.sessionId, 'session-1');
        assert.equal(claims.fileName, first.fileName);
        assert.equal(claims.peerUuid, 'host-uuid');
    });

    it('ignores a malformed client date/time instead of putting it in the file name', async () => {
        const s = setup();
        const room = s.addRoom('room1');
        s.join(room, 'host');
        const { fileName } = await s.requestToken(room, 'host', { dateTime: '../../etc/passwd' });
        assert.match(fileName, /^Rec_room1_\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}_session-1_[0-9a-f]{12}\.webm$/);
    });

    it('refuses tokens to lobby, banned and (under host-only recording) non-presenter peers', async () => {
        const s = setup();
        const room = s.addRoom('room1');
        s.join(room, 'host', { presenter: true });
        s.join(room, 'guest');
        s.join(room, 'waiting');
        room.peers.get('waiting').peer_lobby = true;
        s.join(room, 'banned', { authUser: 'mallory' });
        room.ban('other-uuid', 'mallory');

        assert.deepEqual(s.plain(await s.requestToken(room, 'waiting')), { error: 'Not allowed' });
        assert.deepEqual(s.plain(await s.requestToken(room, 'banned')), { error: 'Not allowed' });
        assert.deepEqual(s.plain(await s.requestToken(room, 'stranger')), { error: 'Not allowed' });
        assert.ok((await s.requestToken(room, 'guest')).token);

        room.hostOnly = true;
        assert.deepEqual(s.plain(await s.requestToken(room, 'guest')), { error: 'Only the host can record' });
        assert.ok((await s.requestToken(room, 'host')).token);

        s.context.serverRecordingEnabled = false;
        assert.deepEqual(s.plain(await s.requestToken(room, 'host')), { error: 'Recording disabled' });
    });

    it("lets a peer append only to its own file, never to another peer's recording", async () => {
        const s = setup();
        const room = s.addRoom('room1');
        s.join(room, 'host', { presenter: true });
        s.join(room, 'guest');
        const host = await s.requestToken(room, 'host');
        const guest = await s.requestToken(room, 'guest');
        const hostBytes = Buffer.from('host-recording');
        const marker = Buffer.from('guest-marker');

        assert.equal((await s.call('/recSync', { ...host, body: hostBytes })).statusCode, 200);
        assert.equal((await s.call('/recSync', { ...guest, body: marker })).statusCode, 200);
        assert.deepEqual(s.stored(guest.fileName), marker);

        const crossWrite = await s.call('/recSync', { token: guest.token, fileName: host.fileName, body: marker });
        assert.equal(crossWrite.statusCode, 403);
        assert.deepEqual(s.plain(crossWrite.body), { error: 'Upload token file mismatch' });
        assert.deepEqual(s.stored(host.fileName), hostBytes);

        // A file the token was not issued for is not created either (no junk files)
        const junk = 'Rec_room1_2026_11_17_05_24_04_session-1_000000000000.webm';
        assert.equal((await s.call('/recSync', { token: guest.token, fileName: junk, body: marker })).statusCode, 403);
        assert.equal(s.stored(junk), null);

        for (const route of ['/recSyncFixWebm', '/recSyncFinalize']) {
            const res = await s.call(route, { token: guest.token, fileName: host.fileName, durationMs: '1000' });
            assert.equal(res.statusCode, 403, route);
        }
        assert.deepEqual(s.stored(host.fileName), hostBytes);
    });

    it('rejects missing, invalid and legacy room-only tokens', async () => {
        const s = setup();
        const room = s.addRoom('room1');
        s.join(room, 'host');
        const { fileName } = await s.requestToken(room, 'host');
        const legacy = jwt.sign({ scope: 'rec-upload', roomId: 'room1' }, 'test-rec-upload-key');

        assert.equal((await s.call('/recSync', { fileName })).statusCode, 401);
        assert.equal((await s.call('/recSync', { token: 'not-a-token', fileName })).statusCode, 401);
        assert.equal((await s.call('/recSync', { token: legacy, fileName })).statusCode, 401);
        assert.equal(s.stored(fileName), null);
    });

    it('revokes a token once its uploader is banned', async () => {
        const s = setup();
        const room = s.addRoom('room1');
        s.join(room, 'guest', { authUser: 'guest-user' });
        const guest = await s.requestToken(room, 'guest');
        assert.equal((await s.call('/recSync', { ...guest, body: Buffer.from('a') })).statusCode, 200);

        room.ban('guest-uuid', 'guest-user');
        room.peers.delete('guest');

        const res = await s.call('/recSync', { ...guest, body: Buffer.from('b') });
        assert.equal(res.statusCode, 403);
        assert.deepEqual(s.plain(res.body), { error: 'Upload token revoked' });
        assert.deepEqual(s.stored(guest.fileName), Buffer.from('a'));
    });

    it('rejects a token from a previous session of a recreated room with the same name', async () => {
        const s = setup();
        const oldRoom = s.addRoom('room1', 'old-session');
        s.join(oldRoom, 'guest');
        const guest = await s.requestToken(oldRoom, 'guest');

        const newRoom = s.addRoom('room1', 'new-session');
        s.join(newRoom, 'host');
        const res = await s.call('/recSync', { ...guest, body: Buffer.from('x') });
        assert.equal(res.statusCode, 403);
        assert.deepEqual(s.plain(res.body), { error: 'Upload token session expired' });
        assert.equal(s.stored(guest.fileName), null);
    });

    it('accepts uploads for rooms whose name contains underscores (e.g. breakout rooms)', async () => {
        const s = setup();
        const room = s.addRoom('main_breakout_1');
        s.join(room, 'host');
        const host = await s.requestToken(room, 'host');
        assert.equal((await s.call('/recSync', { ...host, body: Buffer.from('ok') })).statusCode, 200);
        assert.deepEqual(s.stored(host.fileName), Buffer.from('ok'));
    });
});
