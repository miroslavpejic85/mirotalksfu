'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const roomSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/Room.js'), 'utf8');
const start = roomSource.indexOf('async function refreshMyVideoDevices()');
const end = roomSource.indexOf('function setupInitButtons()');
const deviceSource =
    roomSource.slice(start, end) +
    roomSource.slice(
        roomSource.indexOf('function selectOptionByValueExist('),
        roomSource.indexOf('function refreshLsDevices()')
    );

function domError(name) {
    const err = new Error(name);
    err.name = name;
    return err;
}

function createSelect() {
    const select = {
        options: [],
        selectedIndex: 0,
        disabled: false,
        set innerHTML(_) {
            this.options.length = 0;
        },
        appendChild(option) {
            this.options.push(option);
        },
        get length() {
            return this.options.length;
        },
        get value() {
            return this.options[this.selectedIndex]?.value ?? '';
        },
    };
    return select;
}

function createStream(deviceId) {
    const track = { stop: sinon.spy(), getSettings: () => ({ deviceId }) };
    return { getTracks: () => [track], track };
}

describe('busy or broken default media devices', () => {
    let context;
    let getUserMedia;

    function setup({ devices, getUserMediaImpl }) {
        getUserMedia = sinon.spy(getUserMediaImpl);
        context = vm.createContext({
            navigator: {
                mediaDevices: {
                    getUserMedia,
                    enumerateDevices: async () => devices,
                },
            },
            document: { createElement: () => ({ value: '', innerText: '' }) },
            console: { log() {}, warn() {}, error() {} },
            lS: { DEVICES_COUNT: { video: 0, audio: 0, speaker: 0 } },
            videoSelect: createSelect(),
            initVideoSelect: createSelect(),
            microphoneSelect: createSelect(),
            initMicrophoneSelect: createSelect(),
            speakerSelect: createSelect(),
            initSpeakerSelect: createSelect(),
            speakerSelectDiv: {},
            sinkId: true,
            isVideoAllowed: false,
            isAudioAllowed: false,
            isEnumerateVideoDevices: false,
            isEnumerateAudioDevices: false,
            hide() {},
            updateDeviceSettingsVisibility() {},
            getMicrophoneVolumeIndicator: async () => {},
        });
        vm.runInContext(deviceSource, context);
    }

    const cameras = [
        { kind: 'videoinput', deviceId: 'cam-default', label: 'OBS Busy Camera' },
        { kind: 'videoinput', deviceId: 'cam-2', label: 'USB Camera' },
    ];

    it('uses another camera when the default camera is busy', async () => {
        setup({
            devices: cameras,
            getUserMediaImpl: async (constraints) => {
                if (constraints.video === true) throw domError('NotReadableError');
                if (constraints.video.deviceId.exact === 'cam-2') return createStream('cam-2');
                throw domError('NotReadableError');
            },
        });

        await context.initEnumerateVideoDevices();

        assert.equal(context.isVideoAllowed, true);
        assert.equal(context.videoSelect.options.length, 2);
        assert.equal(context.initVideoSelect.options.length, 2);
        assert.equal(context.videoSelect.value, 'cam-2');
    });

    it('keeps video disallowed when no camera can be opened', async () => {
        setup({
            devices: cameras,
            getUserMediaImpl: async () => {
                throw domError('NotReadableError');
            },
        });

        await context.initEnumerateVideoDevices();

        assert.equal(context.isVideoAllowed, false);
    });

    it('does not try other cameras when permission is denied', async () => {
        setup({
            devices: cameras,
            getUserMediaImpl: async () => {
                throw domError('NotAllowedError');
            },
        });

        await context.initEnumerateVideoDevices();

        assert.equal(context.isVideoAllowed, false);
        assert.equal(getUserMedia.callCount, 1);
    });

    it('uses another microphone when the default microphone is busy', async () => {
        setup({
            devices: [
                { kind: 'audioinput', deviceId: 'default', label: 'Default' },
                { kind: 'audioinput', deviceId: 'mic-default', label: 'OBS Busy Mic' },
                { kind: 'audioinput', deviceId: 'mic-2', label: 'USB Mic' },
                { kind: 'audiooutput', deviceId: 'spk-1', label: 'Speakers' },
            ],
            getUserMediaImpl: async (constraints) => {
                if (constraints.audio === true) throw domError('NotReadableError');
                if (constraints.audio.deviceId.exact === 'mic-2') return createStream('mic-2');
                throw domError('NotReadableError');
            },
        });

        await context.initEnumerateAudioDevices();

        assert.equal(context.isAudioAllowed, true);
        assert.equal(context.microphoneSelect.value, 'mic-2');
        assert.equal(context.speakerSelect.options.length, 1);
    });

    it('shows a fallback name for devices without a label', async () => {
        setup({ devices: [], getUserMediaImpl: async () => createStream('x') });
        const select = createSelect();

        await context.addChild({ kind: 'videoinput', deviceId: 'a', label: '' }, [select]);
        await context.addChild({ kind: 'audioinput', deviceId: 'b', label: '' }, [select]);
        await context.addChild({ kind: 'audiooutput', deviceId: 'c', label: '' }, [select]);

        assert.deepEqual(
            select.options.map((o) => o.innerText),
            ['📹 camera 1', '🎤 microphone 2', '🔈 speaker 3']
        );
    });
});
