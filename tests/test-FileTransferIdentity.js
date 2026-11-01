'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'Server.js'), 'utf8');
const fileSource = serverSource.slice(
    serverSource.indexOf("        socket.on('fileInfo',"),
    serverSource.indexOf("        socket.on('shareVideoAction',")
);

describe('Socket.IO file transfer sender identity', () => {
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
            isValidFileName: () => true,
            Validator: { isValidData: (data) => Boolean(data && typeof data === 'object') },
            log: { debug: sinon.spy(), warn: sinon.spy() },
        });

        vm.runInContext(fileSource, context);

        return { handlers, room };
    }

    it('overrides forged fileInfo identity with the real peer', () => {
        const { handlers, room } = setup();

        handlers.fileInfo({
            peer_id: 'all',
            sender_id: 'alice-id',
            broadcast: true,
            peer_name: 'Alice',
            peer_avatar: 'https://example.com/alice.png',
            fileName: 'a.txt',
            fileSize: 1,
            fileType: 'text/plain',
        });

        assert.equal(room.broadCast.callCount, 1);
        const [from, action, data] = room.broadCast.firstCall.args;
        assert.equal(from, 'bob-id');
        assert.equal(action, 'fileInfo');
        assert.equal(data.sender_id, 'bob-id');
        assert.equal(data.peer_name, 'Bob');
        assert.equal(data.peer_avatar, 'https://example.com/bob.png');
    });

    it('binds private fileInfo to the sender and keeps the target', () => {
        const { handlers, room } = setup();

        handlers.fileInfo({ peer_id: 'carol-id', broadcast: false, peer_name: 'Alice', fileName: 'a.txt' });

        assert.equal(room.sendTo.callCount, 1);
        const [target, action, data] = room.sendTo.firstCall.args;
        assert.equal(target, 'carol-id');
        assert.equal(action, 'fileInfo');
        assert.equal(data.sender_id, 'bob-id');
        assert.equal(data.peer_name, 'Bob');
    });

    it('tags file chunks with the real sender and drops extra fields', () => {
        const { handlers, room } = setup();

        handlers.file({
            peer_id: 'all',
            broadcast: true,
            sender_id: 'alice-id',
            peer_name: 'Alice',
            fileData: new ArrayBuffer(4),
        });

        const [, action, data] = room.broadCast.firstCall.args;
        assert.equal(action, 'file');
        assert.equal(data.sender_id, 'bob-id');
        assert.equal(data.peer_name, undefined);
        assert.equal(data.fileData.byteLength, 4);
    });

    for (const event of ['fileAbort', 'receiveFileAbort']) {
        it(`binds ${event} identity to the sending socket`, () => {
            const { handlers, room } = setup();

            handlers[event]({ peer_name: 'Alice', sender_id: 'alice-id' });

            const [, action, data] = room.broadCast.firstCall.args;
            assert.equal(action, event);
            assert.equal(data.sender_id, 'bob-id');
            assert.equal(data.peer_name, 'Bob');
        });
    }

    it('drops file transfers addressed to the sender', () => {
        const { handlers, room } = setup();

        handlers.fileInfo({ peer_id: 'bob-id', broadcast: false, fileName: 'a.txt' });
        handlers.file({ peer_id: 'bob-id', broadcast: false, fileData: new ArrayBuffer(1) });

        assert.equal(room.sendTo.callCount, 0);
        assert.equal(room.broadCast.callCount, 0);
    });
});
