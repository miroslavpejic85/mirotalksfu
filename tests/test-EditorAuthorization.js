'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'Server.js'), 'utf8');
const editorSource = serverSource.slice(
    serverSource.indexOf('        // Security: the editor lock and presenter-only actions'),
    serverSource.indexOf("        socket.on('disconnect', (reason) => {")
);

describe('Socket.IO collaborative editor authorization', () => {
    function setup({ presenter }) {
        const handlers = {};
        let locked = false;
        const room = {
            broadCast: sinon.spy(),
            getPeer: () => ({ peer_info: { peer_name: 'Bob', peer_uuid: 'uuid-bob' } }),
            getEditorLock: () => locked,
            setEditorLock: (status) => (locked = status),
        };
        const socket = {
            id: 'peer-1',
            room_id: 'room-1',
            on: (event, handler) => (handlers[event] = handler),
        };
        const context = vm.createContext({
            socket,
            roomExists: () => true,
            getRoom: () => room,
            isPeerPresenter: () => presenter,
            checkXSS: (data) => data,
            Validator: { isValidData: (data) => Boolean(data && typeof data === 'object' && Object.keys(data).length) },
            log: { debug() {} },
        });
        vm.runInContext(editorSource, context);
        return { handlers, room };
    }

    const delta = { ops: [{ insert: 'x' }] };

    it('drops participant deltas while locked but relays them when unlocked', () => {
        const { handlers, room } = setup({ presenter: false });
        handlers.editorChange(delta);
        assert.equal(room.broadCast.callCount, 1);
        room.setEditorLock(true);
        handlers.editorChange(delta);
        assert.equal(room.broadCast.callCount, 1);
    });

    it('lets the presenter edit while locked', () => {
        const { handlers, room } = setup({ presenter: true });
        room.setEditorLock(true);
        handlers.editorChange(delta);
        assert.equal(room.broadCast.callCount, 1);
    });

    it('blocks participant lock, unlock, open, close and editorUpdate', () => {
        const { handlers, room } = setup({ presenter: false });
        for (const action of ['lock', 'unlock', 'open', 'close']) {
            handlers.editorActions({ peer_name: 'Bob', action });
        }
        handlers.editorUpdate(delta);
        assert.equal(room.broadCast.callCount, 0);
        assert.equal(room.getEditorLock(), false);
    });

    it('allows participant clean only while unlocked', () => {
        const { handlers, room } = setup({ presenter: false });
        handlers.editorActions({ peer_name: 'Bob', action: 'clean' });
        assert.equal(room.broadCast.callCount, 1);
        room.setEditorLock(true);
        handlers.editorActions({ peer_name: 'Bob', action: 'clean' });
        assert.equal(room.broadCast.callCount, 1);
    });

    it('tracks lock state from presenter actions and rejects unknown actions', () => {
        const { handlers, room } = setup({ presenter: true });
        handlers.editorActions({ peer_name: 'spoofed', action: 'lock' });
        assert.equal(room.getEditorLock(), true);
        assert.deepEqual({ ...room.broadCast.lastCall.args[2] }, { peer_name: 'Bob', action: 'lock' });
        handlers.editorActions({ peer_name: 'Bob', action: 'unlock' });
        assert.equal(room.getEditorLock(), false);
        handlers.editorActions({ peer_name: 'Bob', action: 'bogus' });
        assert.equal(room.broadCast.callCount, 2);
    });
});
