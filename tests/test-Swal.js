'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const sinon = require('sinon');

const root = path.join(__dirname, '..');
const readScript = (name) => fs.readFileSync(path.join(root, 'public/js', name), 'utf8');

describe('toast hover timers with native translation', () => {
    let dom;
    let client;
    let popup;
    let running;
    let options;
    let visible;
    let closePopup;
    let shown;
    let clock;

    beforeEach(async () => {
        dom = new JSDOM('<div id="tabLanguages"><span class="title">Language:</span></div>', {
            url: 'https://meet.example/room',
            runScripts: 'outside-only',
        });
        const window = dom.window;
        visible = false;
        shown = [];
        clock = sinon.useFakeTimers({ global: window, toFake: ['setTimeout', 'clearTimeout'] });
        class Swal {
            static mixin(defaults) {
                return class extends this {
                    static _main(config, inheritedDefaults) {
                        return super._main(config, { ...defaults, ...inheritedDefaults });
                    }
                };
            }

            static fire(config) {
                return this._main(config);
            }

            static _main(config, defaults) {
                if (visible) closePopup({ isDismissed: true });
                options = { ...defaults, ...config };
                shown.push(options);
                visible = true;
                running = true;
                popup = window.document.createElement('div');
                popup.className = options.toast ? 'swal2-toast' : 'swal2-modal';
                popup.textContent = options.title || '';
                window.document.body.appendChild(popup);
                if (options.didOpen) options.didOpen(popup);
                return new Promise((resolve) => {
                    closePopup = (result = { dismiss: 'timer' }) => {
                        visible = false;
                        popup.remove();
                        resolve(result);
                    };
                });
            }

            static isVisible() {
                return visible;
            }

            static getPopup() {
                return popup;
            }

            static close() {
                if (visible) closePopup({ isDismissed: true });
            }

            static stopTimer() {
                running = false;
            }

            static resumeTimer() {
                running = true;
            }
        }
        window.Swal = Swal;
        window.swalBackground = '#1D2026';
        window.eval(
            `${readScript('Swal.js')}\nwindow.pauseSwalToastOnHover = pauseSwalToastOnHover; window.showSwalToast = showSwalToast;`
        );
        window.eval(`${readScript('RoomClient.js')}\nwindow.RoomClient = RoomClient;`);
        window.eval(`${readScript('Utils.js')}\nwindow.popup = popup;`);
        const roomSource = readScript('Room.js');
        const start = roomSource.indexOf('function userLog(');
        const end = roomSource.indexOf('\nfunction saveDataToFile(', start);
        assert.ok(start >= 0 && end > start);
        window.eval(`${roomSource.slice(start, end)}\nwindow.userLog = userLog;`);
        client = Object.create(window.RoomClient.prototype);
        client.sound = () => {};
        client.speechInMessages = true;
        window.renderRoomTemplate = () => '<span>Accepted</span>';
        window.BRAND = { app: { language: 'it', translationMode: 'native' } };
        window.fetch = async () => ({
            ok: true,
            json: async () => JSON.parse(fs.readFileSync(path.join(root, 'public/lang/it.json'), 'utf8')),
        });
        window.tippy = () => [];
        window.eval(readScript('I18n.js'));
        window.document.dispatchEvent(new window.Event('brand:ready'));
        await window.i18n.ready;
    });

    afterEach(() => {
        clock.restore();
        dom.window.close();
    });

    const cases = {
        'room clipboard notice': (window) => window.userLog('info', 'Meeting URL copied to clipboard'),
        'client notice': (_, client) => client.userLog('info', 'Notice'),
        'HTML notice': (_, client) => client.userLog('html', '<b>Notice</b>'),
        'titled toast': (_, client) => client.toast('info', 'Notice', 'Details'),
        'message popup': (_, client) => client.msgPopup('info', 'Notice'),
        'recording notice': (_, client) =>
            client.msgHTML(
                { type: 'recording', action: 'Start conference recording' },
                'info',
                null,
                null,
                'Recording'
            ),
        'lobby acceptance': (_, client) => client.showLobbyDecision('accept'),
        'login notice': (window) => window.popup('success', 'Copied'),
    };

    for (const [name, show] of Object.entries(cases)) {
        it(`pauses and resumes the ${name} after the translation wrapper runs`, () => {
            show(dom.window, client);
            assert.equal(options.toast, true);
            assert.equal(options.timerProgressBar, true);
            assert.equal(running, true);
            popup.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
            assert.equal(running, false, 'hover should stop the countdown');
            popup.dispatchEvent(new dom.window.MouseEvent('mouseleave'));
            assert.equal(running, true, 'leaving should resume the countdown');
        });
    }

    it('keeps immediate switch feedback brief without pausing on hover', () => {
        client.roomMessage('sounds', true);
        assert.equal(options.icon, 'success');
        assert.equal(options.timer, 1800);
        assert.equal(options.timerProgressBar, false);
        popup.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
        assert.equal(running, true);
    });

    it('uses info rather than success when a moderator switch is disabled', () => {
        client.roomMessage('sounds', false);
        assert.equal(options.icon, 'info');
    });

    it('shows rapid switches immediately rather than replaying them from the queue', async () => {
        client.roomMessage('sounds', true);
        client.roomMessage('sounds', false);
        client.roomMessage('ptt', true);
        assert.equal(shown.length, 3);
        assert.match(options.title, /Push to talk ON/);
        closePopup();
        await clock.tickAsync(10000);
        assert.equal(shown.length, 3);
    });

    function initializeMicrophoneSwitches() {
        dom.window.localStorageSettings = {};
        dom.window.lS = { setSettings() {} };
        dom.window.rc = client;
        for (const name of ['switchNoiseSuppression', 'switchDominantSpeakerFocus']) {
            const checkbox = dom.window.document.createElement('input');
            checkbox.type = 'checkbox';
            dom.window.document.body.appendChild(checkbox);
            dom.window[name] = checkbox;
        }
        const source = readScript('Room.js');
        const start = source.indexOf('    switchDominantSpeakerFocus.onchange =');
        const end = source.indexOf('    switchPushToTalk.onchange =', start);
        assert.ok(start >= 0 && end > start);
        dom.window.eval(source.slice(start, end));
    }

    it('shows noise suppression feedback before the microphone processor exists', () => {
        initializeMicrophoneSwitches();
        const checkbox = dom.window.switchNoiseSuppression;
        client.userLog('info', 'Previous notice');
        checkbox.checked = true;
        checkbox.dispatchEvent(new dom.window.Event('change'));
        assert.equal(options.title, 'Noise suppression enabled');
        assert.equal(options.timer, 1800);
        assert.equal(options.timerProgressBar, false);
        assert.equal(dom.window.localStorageSettings.mic_noise_suppression, true);
        checkbox.checked = false;
        checkbox.dispatchEvent(new dom.window.Event('change'));
        assert.equal(options.title, 'Noise suppression disabled');
        assert.equal(shown.length, 3);
        assert.equal(dom.window.localStorageSettings.mic_noise_suppression, false);
    });

    it('updates the active noise processor without replacing the settings handler', () => {
        initializeMicrophoneSwitches();
        dom.window.eval(`${readScript('NodeProcessor.js')}\nwindow.RNNoiseProcessor = RNNoiseProcessor;`);
        const handler = dom.window.switchNoiseSuppression.onchange;
        const label = dom.window.document.createElement('span');
        label.id = 'labelNoiseSuppression';
        dom.window.switchNoiseSuppression.id = 'switchNoiseSuppression';
        dom.window.document.body.appendChild(label);
        const processor = Object.create(dom.window.RNNoiseProcessor.prototype);
        processor.initializeUI();
        processor.uiManager = { updateStatus() {}, updateUI() {} };
        client.RNNoiseProcessor = processor;
        assert.equal(dom.window.switchNoiseSuppression.onchange, handler);
        dom.window.switchNoiseSuppression.checked = true;
        dom.window.switchNoiseSuppression.dispatchEvent(new dom.window.Event('change'));
        assert.equal(processor.noiseSuppressionEnabled, true);
        assert.equal(options.timer, 1800);
    });

    it('shows Speaker Focus ON/OFF feedback immediately and saves the preference', () => {
        initializeMicrophoneSwitches();
        const checkbox = dom.window.switchDominantSpeakerFocus;
        for (const enabled of [true, false]) {
            checkbox.checked = enabled;
            checkbox.dispatchEvent(new dom.window.Event('change'));
            assert.equal(options.title, `Speaker Focus ${enabled ? 'ON' : 'OFF'}`);
            assert.equal(options.icon, enabled ? 'success' : 'info');
            assert.equal(options.timer, 1800);
            assert.equal(options.timerProgressBar, false);
            assert.equal(dom.window.localStorageSettings.dominant_speaker_focus, enabled);
        }
    });

    it('shows immediate camera-off participant feedback and preserves the visibility preference', () => {
        const window = dom.window;
        window.rc = client;
        window.localStorageSettings = {};
        window.lS = { setSettings() {} };
        window.toggleCameraOffParticipantsVisibility = (active) => {
            window.showCameraOffParticipants = active;
        };
        const checkbox = window.document.createElement('input');
        checkbox.type = 'checkbox';
        window.document.body.appendChild(checkbox);
        window.switchShowCameraOffParticipants = checkbox;
        const source = readScript('Room.js');
        const start = source.indexOf('    switchShowCameraOffParticipants.onchange =');
        const end = source.indexOf('    switchShare.onchange =', start);
        assert.ok(start >= 0 && end > start);
        window.eval(source.slice(start, end));
        client.userLog('info', 'Previous notice');
        for (const enabled of [true, false]) {
            checkbox.checked = enabled;
            checkbox.dispatchEvent(new window.Event('change'));
            assert.equal(options.title, `Camera-off participants ${enabled ? 'ON' : 'OFF'}`);
            assert.equal(options.icon, enabled ? 'success' : 'info');
            assert.equal(options.timer, 1800);
            assert.equal(options.timerProgressBar, false);
            assert.equal(window.localStorageSettings.show_camera_off_participants, enabled);
            assert.equal(window.showCameraOffParticipants, enabled);
        }
        assert.equal(shown.length, 3);
    });

    it('shows immediate Whisper mode feedback only for successful mode changes', () => {
        const window = dom.window;
        window.rc = client;
        window.transcription = {
            transcriptionRunning: false,
            whisper: { toggleMode: (enabled) => enabled },
            updateSelectorsVisibility() {},
        };
        const checkbox = window.document.createElement('input');
        checkbox.type = 'checkbox';
        window.document.body.appendChild(checkbox);
        window.transcriptWhisperMode = checkbox;
        const source = readScript('Room.js');
        const start = source.indexOf('    transcriptWhisperMode.onchange =');
        const end = source.indexOf('    // whiteboard options', start);
        assert.ok(start >= 0 && end > start);
        window.eval(source.slice(start, end));
        for (const enabled of [true, false]) {
            checkbox.checked = enabled;
            checkbox.dispatchEvent(new window.Event('change'));
            assert.equal(options.title, `Whisper mode ${enabled ? 'ON' : 'OFF'}`);
            assert.equal(options.icon, enabled ? 'success' : 'info');
            assert.equal(options.timer, 1800);
            assert.equal(options.timerProgressBar, false);
        }
        window.transcription.transcriptionRunning = true;
        window.transcription.whisper.toggleMode = () => false;
        checkbox.checked = true;
        checkbox.dispatchEvent(new window.Event('change'));
        assert.equal(shown.length, 2, 'blocked changes must not show success feedback');
        assert.equal(checkbox.checked, false);
        window.transcription.transcriptionRunning = false;
        checkbox.checked = true;
        checkbox.dispatchEvent(new window.Event('change'));
        assert.equal(shown.length, 2, 'unavailable Whisper must not show success feedback');
    });

    it('shows immediate whiteboard participant-name feedback only for the presenter', () => {
        const window = dom.window;
        const actions = [];
        window.rc = client;
        window.isPresenter = true;
        window.wbShowParticipantNames = false;
        window.setWhiteboardParticipantNames = (status) => {
            window.wbShowParticipantNames = status;
        };
        window.whiteboardAction = (action) => actions.push(action);
        window.getWhiteboardAction = (action) => ({ action });
        const checkbox = window.document.createElement('input');
        checkbox.type = 'checkbox';
        window.document.body.appendChild(checkbox);
        window.whiteboardParticipantNamesSwitch = checkbox;
        const source = readScript('Room.js');
        const start = source.indexOf('    whiteboardParticipantNamesSwitch.onchange =');
        const end = source.indexOf('    whiteboardShortcutsBtn.onclick =', start);
        assert.ok(start >= 0 && end > start);
        window.eval(source.slice(start, end));
        for (const enabled of [true, false]) {
            checkbox.checked = enabled;
            checkbox.dispatchEvent(new window.Event('change'));
            assert.equal(options.title, `Participants names ${enabled ? 'ON' : 'OFF'}`);
            assert.equal(options.icon, enabled ? 'success' : 'info');
            assert.equal(options.timer, 1800);
            assert.equal(options.timerProgressBar, false);
            assert.equal(window.wbShowParticipantNames, enabled);
            assert.equal(actions.at(-1).status, enabled);
        }
        window.isPresenter = false;
        checkbox.checked = true;
        checkbox.dispatchEvent(new window.Event('change'));
        assert.equal(shown.length, 2);
        assert.equal(actions.length, 2);
        assert.equal(window.wbShowParticipantNames, false);
    });

    it('shows feedback when the whiteboard is unlocked and still broadcasts the action', () => {
        const window = dom.window;
        const actions = [];
        window.wbIsLock = true;
        window.whiteboardLockBtn = window.document.createElement('button');
        window.whiteboardUnlockBtn = window.document.createElement('button');
        window.show = () => {};
        window.hide = () => {};
        window.setColor = () => {};
        window.sound = () => {};
        window.getWhiteboardAction = (action) => ({ action });
        window.whiteboardAction = (action) => actions.push(action);
        const source = readScript('Room.js');
        const start = source.indexOf('function toggleLockUnlockWhiteboard()');
        const end = source.indexOf('\nfunction whiteboardAction(', start);
        assert.ok(start >= 0 && end > start);
        window.eval(`${source.slice(start, end)}\nwindow.toggleLockUnlockWhiteboard = toggleLockUnlockWhiteboard;`);
        window.toggleLockUnlockWhiteboard();
        assert.equal(window.wbIsLock, false);
        assert.match(options.title, /whiteboard is unlocked/);
        assert.equal(options.position, 'top-end');
        assert.equal(options.icon, 'info');
        assert.equal(options.timer, 1800);
        assert.equal(options.timerProgressBar, false);
        assert.equal(actions[0].action, 'unlock');
        window.toggleLockUnlockWhiteboard();
        assert.equal(window.wbIsLock, true);
        assert.match(options.title, /whiteboard is locked/);
        assert.equal(options.icon, 'success');
        assert.equal(options.timer, 1800);
        assert.equal(options.timerProgressBar, false);
        assert.equal(actions[1].action, 'lock');
        assert.equal(shown.length, 2, 'lock feedback must immediately replace unlock feedback');
    });

    it('lets switches bypass pending notices while retaining the normal queue', async () => {
        const first = client.userLog('info', 'First');
        const next = client.userLog('info', 'Next');
        client.roomMessage('sounds', true);
        await first;
        assert.match(options.title, /Sounds notification ON/);
        assert.equal(shown.length, 2);
        closePopup();
        await clock.tickAsync(250);
        assert.equal(options.title, 'Next');
        closePopup();
        await next;
    });

    it('does not dismiss or queue switch feedback behind a blocking dialog', async () => {
        dom.window.Swal.fire({ title: 'Confirm', showCancelButton: true });
        client.roomMessage('sounds', true);
        assert.equal(shown.length, 1);
        assert.equal(options.title, 'Confirm');
        closePopup();
        await clock.tickAsync(10000);
        assert.equal(shown.length, 1);
    });

    it('queues notifications from different helpers in arrival order', async () => {
        const first = dom.window.userLog('info', 'First');
        const second = client.userLog('info', 'Second');
        const third = dom.window.popup('success', 'Third');
        assert.equal(shown.length, 1);
        closePopup({ dismiss: 'close' });
        assert.equal((await first).dismiss, 'close');
        assert.equal(shown.length, 2);
        assert.equal(options.title, 'Second');
        closePopup();
        await second;
        assert.equal(shown.length, 3);
        assert.equal(options.text, 'Third');
        closePopup();
        await third;
    });

    it('waits for a confirmation dialog without replacing it', async () => {
        dom.window.Swal.fire({ title: 'Confirm', showCancelButton: true });
        const notification = client.userLog('info', 'Waiting notice');
        await clock.tickAsync(1000);
        assert.equal(shown.length, 1);
        assert.equal(options.title, 'Confirm');
        closePopup({ isConfirmed: true });
        await clock.tickAsync(250);
        assert.equal(options.title, 'Waiting notice');
        closePopup();
        await notification;
    });

    it('closes the lobby waiting dialog on acceptance without leaving the room', async () => {
        const window = dom.window;
        window.bottomButtons = { style: {} };
        client.peer_id = 'me';
        client.joinAllowed = sinon.stub().resolves();
        client.exit = sinon.stub();
        client.waitJoinConfirm();
        assert.equal(options.customClass.popup, 'lobby-join-popup');
        await client.roomLobby({ lobby_status: 'accept', peer_id: 'me', room: {} });
        await clock.tickAsync(250);
        assert.equal(shown.at(-1).toast, true, 'accept toast should not be blocked by the waiting dialog');
        assert.equal(client.RoomLobbyAccepted, true);
        assert.equal(client.exit.called, false);
    });

    it('leaves the room only when the lobby waiting dialog is denied', async () => {
        dom.window.bottomButtons = { style: {} };
        client.exit = sinon.stub();
        client.waitJoinConfirm();
        closePopup({ isDenied: true });
        await clock.tickAsync(0);
        assert.equal(client.exit.calledOnce, true);
    });

    it('keeps the prejoin swal visible when media errors occur', () => {
        const roomSource = readScript('Room.js');
        const start = roomSource.indexOf('function handleMediaError(');
        const end = roomSource.indexOf('\nasync function toggleScreenSharing()', start);
        assert.ok(start >= 0 && end > start);
        Object.assign(dom.window, {
            sound: () => {},
            videoQuality: { selectedIndex: 0 },
            rc: { videoQualitySelectedIndex: 0 },
            image: { forbidden: 'forbidden.png' },
            userLog: sinon.stub().resolves(),
        });
        dom.window.eval(
            `${roomSource.slice(start, end)}\nwindow.handleMediaError = handleMediaError; window.isPrejoinDialogVisible = isPrejoinDialogVisible;`
        );

        dom.window.Swal.fire({ title: 'Prejoin' });
        const input = dom.window.document.createElement('input');
        input.id = 'usernameInput';
        popup.appendChild(input);

        assert.equal(dom.window.isPrejoinDialogVisible(), true);
        assert.throws(
            () => dom.window.handleMediaError('video/audio', { name: 'NotAllowedError', message: 'Permission denied' }),
            /Access denied for video\/audio device/
        );
        assert.equal(shown.length, 1);
        sinon.assert.calledOnce(dom.window.userLog);
        assert.equal(dom.window.userLog.firstCall.args[0], 'error');
        assert.equal(
            dom.window.userLog.firstCall.args[1],
            'Access denied for video/audio: Permission denied in browser'
        );
        assert.equal(dom.window.userLog.firstCall.args[2], 'top-end');
        assert.equal(dom.window.userLog.firstCall.args[3], 6000);
    });

    it('allows a critical dialog to interrupt a toast while pending toasts wait', async () => {
        const first = client.userLog('info', 'First');
        const pending = client.userLog('info', 'Pending');
        closePopup();
        dom.window.Swal.fire({ title: 'Critical dialog' });
        await first;
        await clock.tickAsync(500);
        assert.equal(options.title, 'Critical dialog');
        closePopup();
        await clock.tickAsync(250);
        assert.equal(options.title, 'Pending');
        closePopup();
        await pending;
    });

    it('does not advance the queue while the active toast is paused', async () => {
        const first = client.userLog('info', 'First');
        const next = client.userLog('info', 'Next');
        popup.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
        await clock.tickAsync(10000);
        assert.equal(shown.length, 1);
        assert.equal(running, false);
        closePopup();
        await first;
        assert.equal(options.title, 'Next');
        closePopup();
        await next;
    });

    it('pauses for keyboard focus and resumes when focus leaves the toast', () => {
        client.userLog('info', 'Notice');
        const button = dom.window.document.createElement('button');
        popup.appendChild(button);
        button.focus();
        assert.equal(running, false);
        button.blur();
        assert.equal(running, true);
    });

    it('waits for the closing animation before displaying the next toast', async () => {
        const first = client.userLog('info', 'First');
        const next = client.userLog('info', 'Next');
        closePopup();
        visible = true;
        await first;
        await clock.tickAsync(500);
        assert.equal(shown.length, 1);
        visible = false;
        await clock.tickAsync(250);
        assert.equal(options.title, 'Next');
        closePopup();
        await next;
    });

    it('reports a failed toast and continues draining the queue', async () => {
        const failure = new Error('Toast render failed');
        const originalFire = dom.window.Swal.fire;
        const errorLog = sinon.stub(dom.window.console, 'error');
        dom.window.Swal.fire = () => Promise.reject(failure);
        const failed = client.userLog('info', 'Failed notice');
        const rejection = assert.rejects(failed, failure);
        const next = client.userLog('info', 'Next');
        dom.window.Swal.fire = originalFire;
        await rejection;
        assert.equal(errorLog.calledOnce, true);
        assert.equal(options.title, 'Next');
        closePopup();
        await next;
    });

    for (const action of [
        'broadcasting',
        'lobbyOn',
        'lobbyOff',
        'joinLockOn',
        'joinLockOff',
        'hostOnlyRecordingOn',
        'hostOnlyRecordingOff',
    ]) {
        function showRoomStatus(emit) {
            Object.assign(dom.window, {
                isBroadcastingEnabled: false,
                room_id: 'test-room',
                peer_name: 'Test',
                peer_uuid: 'test-peer',
            });
            client.socket = { emit() {} };
            client.event = () => {};
            client.roomAction(action, emit);
        }

        it(`matches moderator switch feedback for the local ${action} switch`, () => {
            showRoomStatus(true);
            assert.equal(options.timer, 1800);
            assert.equal(options.position, 'top-end');
            assert.equal(options.icon, action.endsWith('On') ? 'success' : 'info');
            popup.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
            assert.equal(running, true);
        });

        it(`preserves hover-paused participant notices for ${action}`, () => {
            showRoomStatus(false);
            assert.equal(options.timer, 5000);
            assert.equal(options.icon, 'info');
            popup.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
            assert.equal(running, false);
            popup.dispatchEvent(new dom.window.MouseEvent('mouseleave'));
            assert.equal(running, true);
        });
    }
});
