'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'Server.js'), 'utf8');
const updatePeerInfoSource = serverSource.slice(
    serverSource.indexOf("        socket.on('updatePeerInfo',"),
    serverSource.indexOf("        socket.on('updateRoomNotifications',")
);

describe('Socket.IO updatePeerInfo security', () => {
    function setup() {
        const handlers = {};
        const room = { broadCast: sinon.spy() };
        const peer = { updatePeerInfo: sinon.spy() };
        const log = { warn: sinon.spy(), debug: sinon.spy() };
        const socket = {
            id: 'peer-1',
            room_id: 'room-1',
            on: (event, handler) => (handlers[event] = handler),
        };

        const context = vm.createContext({
            socket,
            roomExists: () => true,
            getRoomAndPeer: () => ({ room, peer }),
            checkXSS: (data) => data,
            Validator: { isValidData: (data) => Boolean(data && typeof data === 'object' && Object.keys(data).length) },
            CLIENT_BLOCKED_PEER_INFO_TYPES: new Set(['lobby', 'presenter']),
            log,
        });

        vm.runInContext(updatePeerInfoSource, context);

        return { handlers, room, peer, log };
    }

    for (const type of ['lobby', 'presenter']) {
        it(`blocks client attempts to update protected "${type}" peer field`, () => {
            const state = setup();

            state.handlers.updatePeerInfo({ type, status: false, broadcast: true });

            assert.equal(state.peer.updatePeerInfo.callCount, 0);
            assert.equal(state.room.broadCast.callCount, 0);
            assert.equal(state.log.warn.callCount, 1);
            assert.equal(state.log.warn.firstCall.args[1].type, type);
        });
    }

    it('allows safe peer info updates and broadcasts them', () => {
        const state = setup();
        const payload = { type: 'audio', status: false, broadcast: true };

        state.handlers.updatePeerInfo(payload);

        assert.equal(state.peer.updatePeerInfo.callCount, 1);
        assert.deepEqual(state.peer.updatePeerInfo.firstCall.args[0], payload);
        assert.equal(state.room.broadCast.callCount, 1);
        assert.deepEqual(state.room.broadCast.firstCall.args, ['peer-1', 'updatePeerInfo', payload]);
    });
});
