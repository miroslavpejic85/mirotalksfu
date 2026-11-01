'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'Server.js'), 'utf8');
const cmdSource = serverSource.slice(
    serverSource.indexOf("        socket.on('cmd',"),
    serverSource.indexOf("        socket.on('roomAction',")
);

describe('Socket.IO cmd sender identity', () => {
    function setup() {
        const handlers = {};
        const room = { broadCast: sinon.spy(), sendTo: sinon.spy() };
        const peer = { peer_name: 'Bob', peer_avatar: 'https://example.com/bob.png' };
        const socket = {
            id: 'bob-id',
            room_id: 'room-1',
            on: (event, handler) => (handlers[event] = handler),
        };

        const context = vm.createContext({
            socket,
            roomExists: () => true,
            getRoom: () => room,
            getPeer: () => peer,
            checkXSS: (data) => data,
            Validator: { isValidData: (data) => Boolean(data && typeof data === 'object') },
            config: {},
            log: { debug: sinon.spy(), warn: sinon.spy() },
        });

        vm.runInContext(cmdSource, context);

        return { handlers, room };
    }

    it('overrides forged transcript author with the real peer', async () => {
        const { handlers, room } = setup();

        await handlers.cmd({
            type: 'transcript',
            peer_name: 'Alice',
            peer_avatar: 'https://example.com/alice.png',
            text_data: 'hello',
            broadcast: false,
        });

        assert.equal(room.broadCast.callCount, 1);
        const [from, action, data] = room.broadCast.firstCall.args;
        assert.equal(from, 'bob-id');
        assert.equal(action, 'cmd');
        assert.equal(data.peer_name, 'Bob');
        assert.equal(data.peer_avatar, 'https://example.com/bob.png');
        assert.equal(data.text_data, 'hello');
    });

    for (const type of ['geoLocation', 'geoLocationOK', 'geoLocationKO']) {
        it(`binds ${type} identity to the sending socket`, async () => {
            const { handlers, room } = setup();

            await handlers.cmd({
                type,
                from_peer_name: 'Alice',
                from_peer_id: 'alice-id',
                peer_id: 'carol-id',
                broadcast: true,
            });

            assert.equal(room.broadCast.callCount, 0);
            assert.equal(room.sendTo.callCount, 1);
            const [target, action, data] = room.sendTo.firstCall.args;
            assert.equal(target, 'carol-id');
            assert.equal(action, 'cmd');
            assert.equal(data.from_peer_id, 'bob-id');
            assert.equal(data.from_peer_name, 'Bob');
        });
    }

    it('drops geolocation messages addressed to the sender', async () => {
        const { handlers, room } = setup();

        await handlers.cmd({ type: 'geoLocation', peer_id: 'bob-id' });

        assert.equal(room.sendTo.callCount, 0);
        assert.equal(room.broadCast.callCount, 0);
    });
});
