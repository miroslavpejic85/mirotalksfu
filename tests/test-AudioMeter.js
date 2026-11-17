'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const roomSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/Room.js'), 'utf8');
const start = roomSource.indexOf('const audioMeterManager = {');
const end = roomSource.indexOf('function appendMenuHeader(', start);
const managerSource = roomSource.slice(start, end);

function makeTrack(label) {
    return {
        label,
        readyState: 'live',
        stop: sinon.spy(function () {
            this.readyState = 'ended';
        }),
    };
}

function makeStream(track) {
    return { getAudioTracks: () => [track], getTracks: () => [track] };
}

function createManager({ audioOn = true, producer = true, selected = 'mic-1' } = {}) {
    const liveTrack = makeTrack('live');
    const captures = [];
    const devices = [
        { kind: 'audioinput', deviceId: 'default', groupId: 'g1' },
        { kind: 'audioinput', deviceId: 'mic-1', groupId: 'g1' },
        { kind: 'audioinput', deviceId: 'mic-2', groupId: 'g2' },
        { kind: 'audioinput', deviceId: 'broken', groupId: 'g3' },
    ];
    const getUserMedia = sinon.spy(async ({ audio }) => {
        const deviceId = audio.deviceId.exact;
        if (deviceId === 'broken') {
            const error = new Error('Could not start audio source');
            error.name = 'NotReadableError';
            throw error;
        }
        const track = makeTrack(deviceId);
        captures.push({ deviceId, track, constraints: audio });
        return makeStream(track);
    });
    class AudioContext {
        constructor() {
            this.state = 'running';
        }
        createMediaStreamSource(stream) {
            return { stream, connect() {}, disconnect: sinon.spy() };
        }
        createAnalyser() {
            return { getByteTimeDomainData() {} };
        }
        close() {
            this.state = 'closed';
        }
    }
    const rc = {
        live: liveTrack,
        producer,
        producerExist: () => rc.producer,
        getMicrophoneInputTrack: () => (rc.producer && rc.live?.readyState === 'live' ? rc.live : null),
    };
    const context = vm.createContext({
        console: { warn() {}, log() {} },
        audio: audioOn,
        rc,
        RoomClient: { mediaType: { audio: 'audioType' } },
        microphoneSelect: { value: selected },
        navigator: { mediaDevices: { getUserMedia, enumerateDevices: async () => devices } },
        window: { AudioContext },
        MediaStream: class {
            constructor(tracks) {
                this.tracks = tracks;
            }
            getAudioTracks() {
                return this.tracks;
            }
            getTracks() {
                return this.tracks;
            }
        },
        isAudioContextSupported: () => true,
        requestAnimationFrame: () => 1,
        cancelAnimationFrame() {},
        Date,
        Array,
        Uint8Array,
        Math,
    });
    vm.runInContext(managerSource + '\nglobalThis.manager = audioMeterManager;', context);
    const entries = devices.map(({ deviceId }) => ({ deviceId, barEls: [] }));
    return { manager: context.manager, context, rc, liveTrack, captures, getUserMedia, entries };
}

const openedDevices = (getUserMedia) => getUserMedia.getCalls().map((call) => call.args[0].audio.deviceId.exact);

describe('Audio device menu meters', () => {
    before(() => {
        assert.ok(start > -1 && end > start, 'audioMeterManager must exist in Room.js');
    });

    it('meters the open microphone and its default alias from the live track without reopening it', async () => {
        const { manager, liveTrack, getUserMedia, entries } = createManager();
        await manager.start(entries);
        assert.deepEqual(openedDevices(getUserMedia), ['mic-2', 'broken']);
        assert.equal(manager.meters.get('mic-1').track, liveTrack);
        assert.equal(manager.meters.get('default').track, liveTrack);
        assert.equal(manager.meters.get('mic-1').shared, true);
        const { audio } = getUserMedia.firstCall.args[0];
        assert.equal(audio.noiseSuppression, false);
        assert.equal(audio.echoCancellation, false);
    });

    it('does not reopen a muted (paused) microphone', async () => {
        const { manager, getUserMedia, entries } = createManager({ audioOn: false, producer: true });
        await manager.start(entries);
        assert.equal(openedDevices(getUserMedia).includes('mic-1'), false);
        assert.equal(manager.meters.get('mic-1').shared, true);
    });

    it('does not retry a device that failed to open until the menu is reopened', async () => {
        const { manager, getUserMedia, entries } = createManager();
        await manager.start(entries);
        await manager.start(entries);
        await manager.refresh();
        assert.equal(openedDevices(getUserMedia).filter((id) => id === 'broken').length, 1);
        manager.stop();
        await manager.start(entries);
        assert.equal(openedDevices(getUserMedia).filter((id) => id === 'broken').length, 2);
    });

    it('follows the live track when the microphone is re-captured', async () => {
        const { manager, rc, liveTrack, entries } = createManager();
        await manager.start(entries);
        liveTrack.readyState = 'ended';
        rc.live = makeTrack('recaptured');
        await manager.refresh();
        assert.equal(manager.meters.get('mic-1').track, rc.live);
        assert.equal(rc.live.stop.called, false);
    });

    it('stops its own captures but never the live microphone track on close', async () => {
        const { manager, liveTrack, captures, entries } = createManager();
        await manager.start(entries);
        manager.stop();
        assert.equal(liveTrack.stop.called, false);
        assert.ok(captures.length > 0);
        captures.forEach(({ track }) => assert.equal(track.readyState, 'ended'));
        assert.equal(manager.meters.size, 0);
    });

    it('releases a microphone picked from the menu and keeps it closed while the switch is pending', async () => {
        const { manager, context, rc, captures, getUserMedia, entries } = createManager();
        await manager.start(entries);
        const mic2 = captures.find(({ deviceId }) => deviceId === 'mic-2').track;

        manager.prepareMicrophoneSwitch('mic-2');
        context.microphoneSelect.value = 'mic-2';
        // closeThenProduce gap: producer closed and audio flag reset, the new mic not captured yet
        context.audio = false;
        rc.producer = false;
        await manager.refresh();

        assert.equal(mic2.readyState, 'ended');
        assert.equal(openedDevices(getUserMedia).filter((id) => id === 'mic-2').length, 1);
        assert.equal(manager.meters.has('mic-2'), false);
    });

    it('opens the selected microphone itself when the mic is off', async () => {
        const { manager, getUserMedia, entries } = createManager({ audioOn: false, producer: false });
        await manager.start(entries);
        assert.ok(openedDevices(getUserMedia).includes('mic-1'));
        assert.equal(manager.meters.get('mic-1').shared, false);
    });
});
