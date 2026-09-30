'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');
const { isConfiguredPresenter } = require('../app/src/PresenterManager');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'Server.js'), 'utf8');
const handlersSource = serverSource.slice(
    serverSource.indexOf("        socket.on('createRoom',"),
    serverSource.indexOf("        socket.on('getRouterRtpCapabilities',")
);
const authorizationSource = serverSource.slice(
    serverSource.indexOf('    async function isRoomAllowedForUser('),
    serverSource.indexOf('    async function getPeerGeoLocation(')
);

describe('Socket.IO join authorization', () => {
    function setup(overrides = {}, roomId = 'room-b') {
        const handlers = {};
        const peers = new Map();
        const room = {
            id: roomId,
            isBanned: () => false,
            getPeers: () => peers,
            getPeersCount: () => peers.size,
            getPeer: (peerId) => peers.get(peerId),
            removePeer: sinon.spy((peerId) => peers.delete(peerId)),
            addPeer: sinon.spy((peer) => peers.set(peer.id, peer)),
            isJoinLocked: () => false,
            isLocked: () => false,
            isLobbyEnabled: () => false,
            isGlobalLobbyEnabled: () => false,
            getSessionId: () => 'session-id',
            toJson: sinon.stub().returns({ id: roomId }),
        };
        const hostCfg = {
            protected: false,
            user_auth: true,
            users_from_db: false,
            users: [
                { username: 'alice', displayname: 'Alice', allowed_rooms: ['room-a'] },
                { username: 'bob', allowed_rooms: ['room-b'] },
            ],
            presenters: { list: ['admin'], join_first: false },
            ...overrides,
        };
        const socket = {
            id: 'attacker-socket',
            handshake: { headers: { host: 'localhost:3010' } },
            on: (event, handler) => (handlers[event] = handler),
        };
        const presenters = {};
        const token = { username: 'alice', password: 'alice-password', presenter: 'false' };
        const context = vm.createContext({
            socket,
            hostCfg,
            presenters,
            config: {},
            log: { debug() {}, warn() {}, error() {} },
            roomList: new Map([[roomId, room]]),
            Validator: { isValidRoomName: () => true },
            getIpSocket: () => '127.0.0.1',
            checkCreateRoomLimit: () => true,
            roomExists: () => socket.room_id === roomId,
            getRoom: () => room,
            checkXSS: (data) => data,
            isValidToken: async () => true,
            decodeToken: () => token,
            isAuthPeer: async (username, password) => username === 'alice' && password === 'alice-password',
            isConfiguredPresenter,
            isPeerPresenter: () => false,
            Peer: class {
                constructor(peerId, data) {
                    this.id = peerId;
                    this.peer_name = data.peer_info.peer_name;
                }
                updatePeerInfo() {}
            },
            getActiveRooms: () => [],
            getRTMPActiveStreams: () => [],
            widget: { alert: { enabled: false }, enabled: false },
            nodemailer: { sendEmailAlert() {} },
            handleJoinWebHook: sinon.spy(),
            serverRecordingEnabled: true,
            createRecUploadToken: sinon.stub().returns('recording-token'),
            rtmpEnabled: true,
            rtmpCfg: { fromStream: true },
            createRtmpStreamToken: sinon.stub().returns('stream-token'),
        });
        vm.runInContext(`${authorizationSource}\n${handlersSource}`, context);
        const data = {
            room_id: roomId,
            peer_info: {
                peer_name: 'Alice',
                peer_id: socket.id,
                peer_uuid: 'alice-uuid',
                peer_token: 'signed-alice-token',
                peer_presenter: false,
            },
        };
        return { handlers, room, presenters, token, data, context, socket };
    }

    async function joinExistingRoom(state) {
        const created = sinon.spy();
        await state.handlers.createRoom({ room_id: state.room.id }, created);
        assert.equal(created.firstCall.args[0].error, 'already exists');
        assert.equal(state.socket.room_id, state.room.id);
        const callback = sinon.spy();
        await state.handlers.join(state.data, callback);
        assert.equal(callback.callCount, 1);
        return callback.firstCall.args[0];
    }

    function assertDenied(state, result) {
        assert.equal(result, 'notAllowed');
        assert.equal(state.room.addPeer.callCount, 0);
        assert.equal(state.room.removePeer.callCount, 0);
        assert.equal(Object.keys(state.presenters).length, 0);
        assert.equal(state.room.toJson.callCount, 0);
        assert.equal(state.context.createRecUploadToken.callCount, 0);
        assert.equal(state.context.createRtmpStreamToken.callCount, 0);
        assert.equal(state.context.handleJoinWebHook.callCount, 0);
    }

    for (const flags of [
        { protected: true, user_auth: false },
        { protected: false, user_auth: true },
        { protected: true, user_auth: true },
    ]) {
        it(`denies alice access to room-b with host flags ${JSON.stringify(flags)}`, async () => {
            const state = setup(flags);
            assertDenied(state, await joinExistingRoom(state));
        });
    }

    for (const displayName of ['bob', 'admin']) {
        it(`does not authorize alice using the spoofed display name ${displayName}`, async () => {
            const state = setup();
            state.data.peer_info.peer_name = displayName;
            assertDenied(state, await joinExistingRoom(state));
        });
    }

    it('denies a token presenter before adding the peer or presenter entry', async () => {
        const state = setup();
        state.token.presenter = 'true';
        assertDenied(state, await joinExistingRoom(state));
    });

    it('allows alice in room-a with an unrelated display name', async () => {
        const state = setup({}, 'room-a');
        state.data.peer_info.peer_name = 'Custom display name';
        const result = await joinExistingRoom(state);
        assert.equal(result.id, 'room-a');
        assert.equal(result.recUploadToken, 'recording-token');
        assert.equal(result.rtmpStreamToken, 'stream-token');
        assert.equal(state.room.addPeer.callCount, 1);
    });

    it('waits for the asynchronous authorization verdict before admission', async () => {
        const state = setup();
        let resolveAuthorization;
        const verdict = new Promise((resolve) => (resolveAuthorization = resolve));
        const authorize = sinon.stub().returns(verdict);
        state.context.isRoomAllowedForUser = authorize;
        await state.handlers.createRoom({ room_id: state.room.id }, sinon.spy());
        const callback = sinon.spy();
        const joining = state.handlers.join(state.data, callback);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(authorize.callCount, 1);
        assert.equal(authorize.firstCall.args[1], 'alice');
        assert.equal(callback.callCount, 0);
        assert.equal(state.room.addPeer.callCount, 0);
        resolveAuthorization(false);
        await joining;
        assertDenied(state, callback.firstCall.args[0]);
    });

    it('rejects an unauthenticated first presenter without trusting their name', async () => {
        const state = setup({ protected: true, user_auth: false, presenters: { list: ['admin'], join_first: true } });
        state.data.peer_info.peer_name = 'admin';
        state.data.peer_info.peer_token = '';
        assertDenied(state, await joinExistingRoom(state));
    });

    it('preserves tokenless guest access when only host protection is enabled', async () => {
        const state = setup({ protected: true, user_auth: false });
        state.data.peer_info.peer_token = '';
        const result = await joinExistingRoom(state);
        assert.equal(result.id, 'room-b');
        assert.equal(state.room.addPeer.callCount, 1);
    });

    it('preserves configured presenter access based on the verified username', async () => {
        const state = setup({ presenters: { list: ['alice'], join_first: false } });
        state.token.presenter = 'true';
        state.data.peer_info.peer_name = 'Custom display name';
        const result = await joinExistingRoom(state);
        assert.equal(result.id, 'room-b');
        assert.equal(state.presenters['room-b'][state.socket.id].is_configured_presenter, true);
    });
});
