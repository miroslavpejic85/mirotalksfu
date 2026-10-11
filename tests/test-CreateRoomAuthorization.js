'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');
const jwt = require('jsonwebtoken');
const { getJwtKeys } = require('../app/src/JwtSecret');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'Server.js'), 'utf8');
const slice = (from, to) => serverSource.slice(serverSource.indexOf(from), serverSource.indexOf(to));

const tokenSource = slice('const CREATE_ROOM_TOKEN_EXP', 'const hostCfg = {');
const handlerSource = slice("        socket.on('createRoom',", "        socket.on('join',");
const routeSource = slice("    app.get('/createRoomToken'", '    // Handle Direct join room with params');
const policySource = slice('    function isAllowedRoomAccess(', '    async function roomExistsForUser(');
const joinTokenSource = slice('    async function isJoinTokenAuthorized(', '    async function isValidToken(');

const jwtKeys = getJwtKeys('a'.repeat(32));
const JWT_VERIFY_OPTIONS = { algorithms: ['HS256'] };

describe('Room creation authorization (Socket.IO createRoom)', () => {
    function setupSocket({ oidcEnabled }) {
        const handlers = {};
        const socket = { id: 'anon', on: (event, handler) => (handlers[event] = handler) };
        const roomList = new Map([['existing', {}]]);
        const context = vm.createContext({
            socket,
            jwt,
            jwtKeys,
            JWT_VERIFY_OPTIONS,
            config: { security: { oidc: { enabled: oidcEnabled } } },
            log: { debug() {}, warn() {}, error() {} },
            roomList,
            Validator: { isValidRoomName: () => true },
            getIpSocket: () => '127.0.0.1',
            checkCreateRoomLimit: () => true,
            getMediasoupWorker: async () => ({}),
            io: {},
            Room: class {
                constructor(id) {
                    this.id = id;
                }
                async ready() {
                    return this;
                }
            },
        });
        vm.runInContext(`${tokenSource}\n${handlerSource}`, context);
        return { handlers, socket, roomList, context };
    }

    it('rejects an anonymous createRoom for a new room when OIDC is enabled', async () => {
        const { handlers, socket, roomList } = setupSocket({ oidcEnabled: true });
        const cb = sinon.spy();
        await handlers.createRoom({ room_id: 'new-room' }, cb);
        assert.equal(cb.firstCall.args[0].error, 'Room creation not authorized');
        assert.equal(roomList.has('new-room'), false);
        assert.equal(socket.room_id, undefined);
    });

    it('rejects a token issued for a different room, a forged token and an expired token', async () => {
        const { handlers, context, roomList } = setupSocket({ oidcEnabled: true });
        const forged = jwt.sign({ scope: 'create-room', roomId: 'new-room' }, 'x'.repeat(32));
        const otherRoom = context.createCreateRoomToken('other-room');
        const wrongScope = jwt.sign({ scope: 'rec-upload', roomId: 'new-room' }, jwtKeys.createRoom);
        const expired = jwt.sign({ scope: 'create-room', roomId: 'new-room' }, jwtKeys.createRoom, { expiresIn: -10 });
        for (const token of [forged, otherRoom, wrongScope, expired, undefined, {}]) {
            const cb = sinon.spy();
            await handlers.createRoom({ room_id: 'new-room', token }, cb);
            assert.equal(cb.firstCall.args[0].error, 'Room creation not authorized');
        }
        assert.equal(roomList.has('new-room'), false);
    });

    it('creates the room with a valid token for that room', async () => {
        const { handlers, context, roomList, socket } = setupSocket({ oidcEnabled: true });
        const cb = sinon.spy();
        await handlers.createRoom({ room_id: 'new-room', token: context.createCreateRoomToken('new-room') }, cb);
        assert.equal(cb.firstCall.args[0].room_id, 'new-room');
        assert.equal(roomList.has('new-room'), true);
        assert.equal(socket.room_id, 'new-room');
    });

    it('still lets anyone join an existing room when OIDC is enabled', async () => {
        const { handlers, socket } = setupSocket({ oidcEnabled: true });
        const cb = sinon.spy();
        await handlers.createRoom({ room_id: 'existing' }, cb);
        assert.equal(cb.firstCall.args[0].error, 'already exists');
        assert.equal(socket.room_id, 'existing');
    });

    it('does not require a token when OIDC is disabled', async () => {
        const { handlers, roomList } = setupSocket({ oidcEnabled: false });
        const cb = sinon.spy();
        await handlers.createRoom({ room_id: 'new-room' }, cb);
        assert.equal(cb.firstCall.args[0].room_id, 'new-room');
        assert.equal(roomList.has('new-room'), true);
    });
});

describe('GET /createRoomToken', () => {
    function setupRoute({ oidc, roomList = new Map(), joinTokenOk = false }) {
        let handler;
        const context = vm.createContext({
            app: { get: (route, fn) => (handler = fn) },
            OIDC: oidc,
            hostCfg: { protected: false, authenticated: true },
            roomList,
            Validator: { isValidRoomName: (r) => /^[\w-]+$/.test(r) },
            checkXSS: (d) => d,
            log: { debug() {}, warn() {} },
            jwt,
            jwtKeys,
            JWT_VERIFY_OPTIONS,
            isJoinTokenAuthorized: async () => joinTokenOk,
        });
        vm.runInContext(
            `${tokenSource}\n${policySource}\n${routeSource}\nthis.isCreateRoomTokenValid = isCreateRoomTokenValid;`,
            context
        );
        return { handler, context };
    }

    function call(handler, { room = 'new-room', authenticated = false, authorization } = {}) {
        const res = {
            statusCode: 200,
            status(code) {
                this.statusCode = code;
                return this;
            },
            set() {},
            json(body) {
                this.body = body;
                return this;
            },
        };
        const req = {
            query: { room },
            headers: authorization ? { authorization } : {},
            oidc: { isAuthenticated: () => authenticated },
        };
        return Promise.resolve(handler(req, res)).then(() => res);
    }

    const oidc = (allow) => ({ enabled: true, allow_rooms_creation_for_auth_users: allow });
    const existing = () => new Map([['existing', {}]]);

    it('requires no token when OIDC is disabled', async () => {
        const { handler } = setupRoute({ oidc: { enabled: false } });
        const res = await call(handler);
        assert.equal(res.body.required, false);
        assert.equal(res.body.token, null);
    });

    it('denies an anonymous user even if the room name already exists', async () => {
        const { handler } = setupRoute({ oidc: oidc(false), roomList: existing() });
        const res = await call(handler, { room: 'existing' });
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.token, null);
    });

    it('denies an authenticated user when room creation for auth users is disabled', async () => {
        const { handler } = setupRoute({ oidc: oidc(false), roomList: existing() });
        const res = await call(handler, { authenticated: true });
        assert.equal(res.statusCode, 403);
    });

    it('issues a room-bound token to an authenticated user when creation is allowed', async () => {
        const { handler, context } = setupRoute({ oidc: oidc(true), roomList: existing() });
        const res = await call(handler, { authenticated: true });
        assert.equal(res.statusCode, 200);
        assert.equal(context.isCreateRoomTokenValid(res.body.token, 'new-room'), true);
        assert.equal(context.isCreateRoomTokenValid(res.body.token, 'other-room'), false);
    });

    it('issues a token for a valid join token even without an OIDC session', async () => {
        const { handler, context } = setupRoute({ oidc: oidc(false), roomList: existing(), joinTokenOk: true });
        const res = await call(handler, { authorization: 'Bearer join-token' });
        assert.equal(res.statusCode, 200);
        assert.equal(context.isCreateRoomTokenValid(res.body.token, 'new-room'), true);
    });

    it('rejects an invalid room name', async () => {
        const { handler } = setupRoute({ oidc: oidc(true) });
        const res = await call(handler, { room: '../bad', authenticated: true });
        assert.equal(res.statusCode, 400);
    });
});

describe('isJoinTokenAuthorized', () => {
    function load({ valid, creds, authOk }) {
        const context = vm.createContext({
            isValidToken: async () => valid,
            decodeToken: () => creds,
            checkXSS: (d) => d,
            isAuthPeer: async () => authOk,
        });
        vm.runInContext(`${joinTokenSource}\nthis.isJoinTokenAuthorized = isJoinTokenAuthorized;`, context);
        return context.isJoinTokenAuthorized;
    }

    it('accepts only a valid token whose credentials authenticate', async () => {
        const creds = { username: 'alice', password: 'pw' };
        assert.equal(await load({ valid: true, creds, authOk: true })('t'), true);
        assert.equal(await load({ valid: true, creds, authOk: false })('t'), false);
        assert.equal(await load({ valid: false, creds, authOk: true })('t'), false);
        assert.equal(await load({ valid: true, creds, authOk: true })(''), false);
    });
});
