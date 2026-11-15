'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const clientSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/RoomClient.js'), 'utf8');

function createHarness() {
    const notices = [];
    const sounds = [];
    const toasts = [];
    const uiCalls = [];
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        swalBackground: '#000',
        image: { recording: 'rec.png' },
        icons: { user: '' },
        showSwalToast: (options) => toasts.push(options),
        handleServerRecordingUi: (client, active, elapsedSeconds) => uiCalls.push([active, elapsedSeconds]),
    });
    vm.runInContext(`${clientSource}; globalThis.Client = RoomClient;`, context);
    const client = Object.create(context.Client.prototype);
    Object.assign(client, {
        _serverRecording: null,
        speechInMessages: true,
        sound: (name) => sounds.push(name),
        showMessage: () => {},
    });
    const handleRecordingAction = client.handleRecordingAction;
    client.handleRecordingAction = function (data) {
        notices.push(data);
        return handleRecordingAction.call(this, data);
    };
    return { client, notices, sounds, toasts, uiCalls };
}

describe('Server recording notifications', () => {
    it('warns a participant joining a room that is being recorded, in chat and with a consent toast', () => {
        const { client, notices, sounds, toasts, uiCalls } = createHarness();
        client.setServerRecordingState(
            { active: true, startedBy: 'Alice', peer_name: undefined, elapsedMs: 65000 },
            true,
            true
        );

        assert.equal(client.isServerRecording(), true);
        assert.deepEqual(uiCalls, [[true, 65]]);
        assert.equal(notices.length, 1);
        assert.equal(notices[0].action, 'Server recording in progress');
        assert.equal(sounds.length, 0);
        assert.equal(toasts.length, 1);
        assert.equal(toasts[0].title, 'Recording is ON');
        assert.equal(toasts[0].timer, 6000);
        assert.match(toasts[0].html, /Your presence implies you agree to being recorded/);
    });

    it('does not repeat the notice when the start broadcast arrived before the room info', () => {
        const { client, notices, sounds, toasts } = createHarness();
        client.setServerRecordingState({ active: true, action: 'start', peer_name: 'auto', elapsedMs: 0 }, true);
        client.setServerRecordingState({ active: true, elapsedMs: 10 }, true, true);

        assert.deepEqual(
            notices.map((n) => [n.peer_name, n.action]),
            [['Server', 'Server recording started']]
        );
        assert.deepEqual(sounds, ['recStart']);
        assert.equal(toasts.length, 1);
        assert.equal(toasts[0].title, 'Recording started');
    });

    it('notifies everyone when the recording stops and stays silent without changes or notify', () => {
        const { client, notices, sounds, toasts } = createHarness();
        client.setServerRecordingState({ active: true, elapsedMs: 0 }, false);
        client.setServerRecordingState({ active: false, peer_name: 'Bob' }, true);
        client.setServerRecordingState({ active: false, peer_name: 'Bob' }, true);
        client.setServerRecordingState({ active: false }, true, true);

        assert.deepEqual(
            notices.map((n) => [n.peer_name, n.action]),
            [['Bob', 'Server recording stopped']]
        );
        assert.deepEqual(sounds, ['recStop']);
        assert.equal(toasts[0].title, 'Recording stopped');
        assert.equal(toasts[0].timer, 3000);
        assert.equal(client.isServerRecording(), false);
    });
});
