'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');
const Room = require('../app/src/Room');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'Server.js'), 'utf8');
const shareSource = serverSource.slice(
    serverSource.indexOf("        socket.on('shareVideoAction',"),
    serverSource.indexOf("        socket.on('wbCanvasToJson',")
);

function createRoom() {
    const room = Object.create(Room.prototype);
    room.shareMediaData = {};
    room._moderator = {};
    room.broadCast = sinon.spy();
    room.sendTo = sinon.spy();
    return room;
}

function setup(room = createRoom(), isPeerPresenter = () => false) {
    const handlers = {};
    const socket = { id: 'bob-id', room_id: 'room-1', on: (event, handler) => (handlers[event] = handler) };
    vm.runInContext(
        shareSource,
        vm.createContext({
            socket,
            roomExists: () => true,
            getRoom: () => room,
            getPeer: () => ({ peer_name: 'Bob', peer_uuid: 'bob-uuid' }),
            checkXSS: (data) => data,
            isValidHttpURL: (url) => /^https?:\/\//.test(url),
            isPeerPresenter,
            Validator: { isValidData: (data) => Boolean(data && typeof data === 'object') },
            log: { debug: sinon.spy() },
        })
    );
    return { handlers, room };
}

const openMp3 = {
    action: 'open',
    peer_id: 'all',
    peer_name: 'Bob',
    video_url: 'https://samplelib.com/mp3/sample-55s.mp3',
    is_youtube: false,
};

describe('Shared media playback sync', () => {
    afterEach(() => sinon.restore());

    it('relays play/pause/seek sync to the share audience with the real sender id', () => {
        const { handlers, room } = setup();
        handlers.shareVideoAction({ ...openMp3 });
        handlers.shareVideoAction({ action: 'sync', peer_id: 'all', peer_name: 'Bob', paused: true, time: 12.5, x: 1 });

        const [from, event, data] = room.broadCast.secondCall.args;
        assert.equal(from, 'bob-id');
        assert.equal(event, 'shareVideoAction');
        assert.deepEqual(JSON.parse(JSON.stringify(data)), {
            action: 'sync',
            peer_id: 'all',
            peer_name: 'Bob',
            from_peer_id: 'bob-id',
            paused: true,
            time: 12.5,
        });
        assert.deepEqual(
            { paused: room.shareMediaData.playback.paused, time: room.shareMediaData.playback.time },
            { paused: true, time: 12.5 }
        );
    });

    it('routes a private share sync to the target peer', () => {
        const { handlers, room } = setup();
        handlers.shareVideoAction({ ...openMp3, peer_id: 'carol-id' });
        handlers.shareVideoAction({ action: 'sync', peer_id: 'carol-id', paused: false, time: 3 });

        assert.equal(room.sendTo.callCount, 2);
        assert.equal(room.sendTo.secondCall.args[0], 'carol-id');
        assert.equal(room.sendTo.secondCall.args[2].from_peer_id, 'bob-id');
    });

    it('drops sync with invalid state, without an open share, or for YouTube', () => {
        const { handlers, room } = setup();
        handlers.shareVideoAction({ action: 'sync', peer_id: 'all', paused: false, time: 1 });

        handlers.shareVideoAction({ ...openMp3 });
        for (const bad of [
            { paused: 'yes', time: 1 },
            { paused: false, time: -1 },
            { paused: false, time: '5' },
            { paused: false, time: Infinity },
        ]) {
            handlers.shareVideoAction({ action: 'sync', peer_id: 'all', ...bad });
        }

        handlers.shareVideoAction({ ...openMp3, video_url: 'https://www.youtube.com/embed/abc', is_youtube: true });
        handlers.shareVideoAction({ action: 'sync', peer_id: 'all', paused: false, time: 1 });

        assert.deepEqual(
            room.broadCast.getCalls().map((call) => call.args[2].action),
            ['open', 'open']
        );
    });

    it('uses server-side identity for the presenter check and never relays a client uuid', () => {
        const isPeerPresenter = sinon.stub().returns(true);
        const room = createRoom();
        room._moderator.media_cant_sharing = true;
        const { handlers } = setup(room, isPeerPresenter);

        handlers.shareVideoAction({ ...openMp3, peer_name: 'Alice', peer_uuid: 'alice-uuid' });

        assert.deepEqual(isPeerPresenter.firstCall.args, ['room-1', 'bob-id', 'Bob', 'bob-uuid']);
        const relayed = room.broadCast.firstCall.args[2];
        assert.equal(relayed.peer_name, 'Bob');
        assert.equal('peer_uuid' in relayed, false);
        assert.equal('peer_uuid' in room.getShareMediaData(), false);
    });

    it('gives late joiners the current playback position', () => {
        const clock = sinon.useFakeTimers({ now: 1000 });
        const room = createRoom();
        room.updateShareMedia({ ...openMp3 });

        clock.tick(10000);
        assert.deepEqual(room.getShareMediaData().playback, { paused: false, time: 10 });

        room.updateShareMediaPlayback({ paused: true, time: 4 });
        clock.tick(5000);
        assert.deepEqual(room.getShareMediaData().playback, { paused: true, time: 4 });

        room.updateShareMedia({ action: 'close', peer_id: 'all' });
        assert.equal(room.getShareMediaData().playback, undefined);
    });
});
