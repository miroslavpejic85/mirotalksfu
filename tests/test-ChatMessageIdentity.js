'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'Server.js'), 'utf8');
const messageSource = serverSource.slice(
    serverSource.indexOf("        socket.on('message',"),
    serverSource.indexOf("        socket.on('chatTyping',")
);

describe('Socket.IO chat message sender identity', () => {
    function setup() {
        const handlers = {};
        const room = { _moderator: null, broadCast: sinon.spy(), sendTo: sinon.spy() };
        const peer = { peer_name: 'Bob', peer_avatar: 'https://example.com/bob.png' };
        const socket = { id: 'bob-id', on: (event, handler) => (handlers[event] = handler) };

        const context = vm.createContext({
            socket,
            roomExists: () => true,
            getRoomAndPeer: () => ({ room, peer }),
            getIpSocket: () => '127.0.0.1',
            checkXSS: (data) => data,
            Validator: { isValidData: (data) => Boolean(data && typeof data === 'object') },
            log: { debug: sinon.spy(), warn: sinon.spy() },
        });

        vm.runInContext(messageSource, context);

        return { handlers, room };
    }

    const forged = (to_peer_id) => ({
        peer_name: 'Bob',
        peer_id: 'alice-id',
        peer_avatar: 'https://invalid.invalid/" onerror="alert(document.domain)',
        to_peer_id,
        to_peer_name: 'Carol',
        peer_msg: 'hi',
        msg_id: 'bob-id_1',
    });

    it('relays private messages with the stored avatar and socket id, not client values', () => {
        const { handlers, room } = setup();

        handlers.message(forged('carol-id'));

        assert.equal(room.sendTo.callCount, 1);
        const [target, action, data] = room.sendTo.firstCall.args;
        assert.equal(target, 'carol-id');
        assert.equal(action, 'message');
        assert.equal(data.peer_id, 'bob-id');
        assert.equal(data.peer_avatar, 'https://example.com/bob.png');
        assert.equal(data.peer_msg, 'hi');
    });

    it('relays public messages with the stored avatar and socket id, not client values', () => {
        const { handlers, room } = setup();

        handlers.message(forged('all'));

        assert.equal(room.broadCast.callCount, 1);
        const [from, action, data] = room.broadCast.firstCall.args;
        assert.equal(from, 'bob-id');
        assert.equal(action, 'message');
        assert.equal(data.peer_id, 'bob-id');
        assert.equal(data.peer_avatar, 'https://example.com/bob.png');
    });
});
