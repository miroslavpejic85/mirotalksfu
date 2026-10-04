'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const clientSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/RoomClient.js'), 'utf8');
const roomSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/Room.js'), 'utf8');
const exitSource = roomSource.slice(
    roomSource.indexOf('function initLeaveMeeting()'),
    roomSource.indexOf('function userLog(')
);
const navigationSource = roomSource.slice(
    roomSource.indexOf("window.addEventListener('popstate'"),
    roomSource.indexOf('// ABOUT', roomSource.indexOf("window.addEventListener('popstate'"))
);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function tick() {
    await new Promise((resolve) => setImmediate(resolve));
}

function createHarness({ server = false, s3 = false, state = 'recording' } = {}) {
    const events = [];
    const timers = [];
    const listeners = {};
    const recorderListeners = {};
    const controls = {};
    const context = vm.createContext({
        Blob,
        URL,
        console: { log() {}, warn() {}, error() {} },
        performance: { now: () => 2000 },
        recordedBlobs: [],
        recShowInfo: true,
        recCodecs: 'video/webm',
        getDataTimeString: () => 'test',
        bytesToSize: (size) => `${size} bytes`,
        userLog: (...args) => events.push(['toast', ...args]),
        recordingTypeSelect: controls,
        switchServerRecording: controls,
        switchHostOnlyRecording: controls,
        setTimeout: (callback) => timers.push(callback),
        document: {
            getElementById: () => ({ innerText: '1s' }),
            createElement: () => ({ style: {}, click: () => events.push('download') }),
            body: {
                appendChild() {},
                removeChild: () => events.push('cleanup'),
            },
        },
        window: {
            location: { href: 'https://meet.example/room', origin: 'https://meet.example' },
            URL: {
                createObjectURL: () => 'blob:recording',
                revokeObjectURL: () => events.push('revoke'),
            },
            localStorage: { isReconnected: 'false' },
            addEventListener: (name, handler) => {
                listeners[name] = handler;
            },
        },
        axios: { post: async (url) => events.push(url) },
        isExiting: false,
        isLeavingRoom: false,
        preventExit: true,
        bypassBeforeUnloadOnce: false,
        survey: { enabled: false, url: 'https://survey.example' },
        redirect: { enabled: false },
        isEmbedded: false,
        swalBackground: '#000',
        image: {},
        swalDestructiveOptions: () => ({}),
        getQueryParam: () => '',
        openURL: (url) => events.push(['navigate', url]),
        endRoomSession: () => {
            context.preventExit = false;
            events.push('end-session');
        },
        location: { href: 'https://meet.example/room' },
        history: {
            back: () => events.push('back'),
            pushState: () => events.push('push-state'),
        },
        Swal: {
            fire: async (options) => {
                events.push(['dialog', options]);
                return { isConfirmed: true };
            },
            close: () => events.push('close-dialog'),
        },
    });
    vm.runInContext(`${clientSource}; globalThis.Client = RoomClient;`, context);
    const client = Object.create(context.Client.prototype);
    const recorder = {
        state,
        addEventListener: (name, handler) => {
            recorderListeners[name] = handler;
        },
        start() {},
        stop() {
            assert.notEqual(this.state, 'inactive');
            this.state = 'inactive';
            events.push('stop');
        },
    };
    Object.assign(client, {
        _isRecording: state === 'recording',
        _recStartTs: 1000,
        mediaRecorder: recorder,
        audioRecorder: { stopMixedAudioStream() {} },
        recScreenAudioTracks: [],
        recSyncTime: 4000,
        recSyncChunkSize: 2,
        recUploadToken: 'test-token',
        recording: {
            recSyncServerRecording: server,
            recSyncServerToS3: s3,
            recSyncServerEndpoint: 'https://record.example',
        },
        toggleVideoAudioTabs() {},
        event() {},
        recordingAction() {},
        sound() {},
        getServerRecFileName: () => 'test.webm',
        saveLastRecordingInfo() {},
        showRecordingInfo() {},
        handleServerRecordingStop: () => events.push('server-info'),
        handleRecordingError: (error) => events.push(['error', error]),
        userLog: (...args) => events.push(['toast', ...args]),
        popupRecordingOnLeaveRoom: () => events.push('progress'),
        exitRoom: () => events.push('exit-room'),
    });
    context.rc = client;
    client.handleMediaRecorder();
    vm.runInContext(exitSource, context);
    vm.runInContext(navigationSource, context);
    const data = (blob) => recorderListeners.dataavailable({ data: blob });
    const stopEvent = () => recorderListeners.stop({ type: 'stop' });
    return { client, context, events, timers, recorder, listeners, data, stopEvent, controls };
}

function installDialogs(h) {
    let current;
    const dialogs = [];
    h.context.renderRoomTemplate = () => 'Recording progress';
    h.context.Swal.fire = (options) => {
        if (current) current.result.resolve({ isDismissed: true });
        const dialog = { options, result: deferred() };
        dialogs.push(dialog);
        current = dialog;
        return dialog.result.promise;
    };
    h.context.Swal.close = () => {
        if (current) current.result.resolve({ isDismissed: true });
        current = null;
        h.events.push('close-dialog');
    };
    h.client.popupRecordingOnLeaveRoom = h.context.Client.prototype.popupRecordingOnLeaveRoom;
    return {
        dialogs,
        get current() {
            return current;
        },
        finish(result) {
            const dialog = current;
            current = null;
            dialog.result.resolve(result);
        },
    };
}

describe('recording finalization before room exit', () => {
    it('waits for the final local data, duration repair, download and cleanup before redirecting', async () => {
        const h = createHarness();
        const repair = deferred();
        h.context.window.FixWebmDuration = () => repair.promise;
        const exit = h.context.completeRoomExit();
        assert.equal(h.client.hasActiveRecorder(), false);
        assert.equal(h.client.hasPendingRecordingSave(), true);
        assert.equal(h.events.includes('exit-room'), false);
        h.data(new Blob(['final-data'], { type: 'video/webm' }));
        h.stopEvent();
        await tick();
        assert.equal(h.events.includes('download'), false);
        repair.resolve(new Blob(['fixed'], { type: 'video/webm' }));
        await tick();
        assert.equal(h.events.includes('download'), true);
        assert.equal(h.events.includes('exit-room'), false);
        h.timers.shift()();
        await exit;
        assert.ok(h.events.indexOf('cleanup') < h.events.indexOf('exit-room'));
        assert.deepEqual(h.events.at(-1), ['navigate', 'https://meet.example/newroom']);
        assert.equal(h.client.hasPendingRecordingSave(), false);
        assert.equal(h.context.recordedBlobs.length, 0);
    });

    for (const state of ['recording', 'paused']) {
        it(`waits for an already stopped ${state} recording and stops only once`, async () => {
            const h = createHarness({ state });
            const download = deferred();
            h.client.handleLocalRecordingStop = () => download.promise;
            const save = h.client.stopRecording();
            assert.equal(h.client.saveRecording('again'), save);
            const exit = h.context.completeRoomExit();
            h.stopEvent();
            await tick();
            assert.equal(h.events.includes('exit-room'), false);
            download.resolve();
            await exit;
            assert.equal(h.events.filter((event) => event === 'stop').length, 1);
        });
    }

    it('blocks restarting while the previous recording is finalizing', () => {
        const h = createHarness();
        h.client.stopRecording();
        h.client.startRecording();
        assert.equal(h.client.mediaRecorder, null);
        assert.equal(h.events.at(-1)[0], 'toast');
    });

    it('handles a recorder that stops automatically without calling stop twice', async () => {
        const h = createHarness();
        h.client.handleLocalRecordingStop = async () => {};
        h.recorder.state = 'inactive';
        await h.stopEvent();
        await h.client.saveRecording('after automatic stop');
        assert.equal(h.events.includes('stop'), false);
        assert.equal(h.client.hasActiveRecorder(), false);
        assert.equal(h.client.hasPendingRecordingSave(), false);
    });

    for (const s3 of [false, true]) {
        it(`serializes server blobs and final chunks before ${s3 ? 'S3 finalization' : 'duration repair'}`, async () => {
            const h = createHarness({ server: true, s3 });
            const firstUpload = deferred();
            const finalize = deferred();
            const uploads = [];
            h.context.axios.post = async (url, chunk, options) => {
                if (url.includes('/recSync?')) {
                    uploads.push(Array.from(new Uint8Array(chunk)));
                    if (uploads.length === 1) await firstUpload.promise;
                } else {
                    assert.deepEqual(uploads, [[1, 2], [3], [4, 5], [6]]);
                    assert.equal(options.params.durationMs, 1000);
                    assert.ok(url.endsWith(s3 ? '/recSyncFinalize' : '/recSyncFixWebm'));
                    await finalize.promise;
                }
                return { data: 'ok' };
            };
            h.data(new Blob([new Uint8Array([1, 2, 3])]));
            const exit = h.context.completeRoomExit();
            h.data(new Blob([new Uint8Array([4, 5, 6])]));
            h.stopEvent();
            await tick();
            assert.equal(uploads.length, 1);
            assert.equal(h.events.includes('exit-room'), false);
            firstUpload.resolve();
            await tick();
            assert.equal(h.events.includes('server-info'), false);
            assert.equal(h.events.includes('exit-room'), false);
            finalize.resolve();
            await exit;
            assert.ok(h.events.indexOf('server-info') < h.events.indexOf('exit-room'));
        });
    }

    it('propagates upload failures and does not finalize an incomplete server recording', async () => {
        const h = createHarness({ server: true });
        let requests = 0;
        h.context.axios.post = async () => {
            requests++;
            throw new Error('upload failed');
        };
        h.data(new Blob(['data']));
        await tick();
        h.data(new Blob(['last-data']));
        h.stopEvent();
        await assert.rejects(h.client.saveRecording('failed upload'), /upload failed/);
        assert.equal(requests, 1);
        assert.equal(h.events.includes('server-info'), false);
        assert.equal(h.client.hasPendingRecordingSave(), false);
        assert.equal(h.controls.disabled, false);
    });

    it('propagates server finalization failures', async () => {
        const h = createHarness({ server: true, s3: true });
        h.context.axios.post = async () => {
            throw new Error('finalization failed');
        };
        h.client.stopRecording();
        h.stopEvent();
        await assert.rejects(h.client.saveRecording('finalization'), /finalization failed/);
        assert.equal(h.events.includes('server-info'), false);
    });

    for (const discard of [false, true]) {
        it(`requires explicit permission to leave after a save failure (${discard ? 'discard' : 'stay'})`, async () => {
            const h = createHarness();
            h.client.handleLocalRecordingStop = async () => {
                throw new Error('download failed');
            };
            h.context.Swal.fire = async () => ({ isDenied: discard });
            const exit = h.context.completeRoomExit();
            h.stopEvent();
            await exit;
            assert.equal(h.events.includes('exit-room'), discard);
            assert.equal(h.context.isLeavingRoom, false);
            assert.equal(h.context.recShowInfo, true);
            assert.ok(h.events.some((event) => event[0] === 'error'));
        });
    }

    it('rejects empty local recordings rather than reporting a successful save', async () => {
        const h = createHarness();
        h.client.stopRecording();
        h.stopEvent();
        await assert.rejects(h.client.saveRecording('empty recording'), /No data was recorded/);
        assert.equal(h.events.includes('download'), false);
    });

    it('does not run concurrent exit actions', async () => {
        const h = createHarness();
        const download = deferred();
        h.client.handleLocalRecordingStop = () => download.promise;
        const exit = h.context.completeRoomExit();
        await h.context.completeRoomExit(true, true);
        h.stopEvent();
        download.resolve();
        await exit;
        assert.equal(h.events.filter((event) => event === 'exit-room').length, 1);
        assert.equal(h.events.at(-1)[1], 'https://meet.example/newroom');
    });

    for (const action of ['survey', 'newroom', 'back']) {
        it(`waits before the ${action} navigation path`, async () => {
            const h = createHarness();
            const download = deferred();
            h.client.handleLocalRecordingStop = () => download.promise;
            const exit =
                action === 'survey'
                    ? h.context.completeRoomExit(false, true)
                    : action === 'newroom'
                      ? h.context.initLeaveMeeting()
                      : h.listeners.popstate({});
            await tick();
            assert.equal(h.events.includes('end-session'), false);
            h.stopEvent();
            download.resolve();
            await exit;
            await tick();
            if (action === 'back') assert.equal(h.events.at(-1), 'back');
            else assert.equal(h.events.at(-1)[1], action === 'survey' ? 'https://survey.example' : '/newroom');
        });
    }

    it('does not stop recording when the survey leave dialog is cancelled', async () => {
        const h = createHarness();
        h.context.survey.enabled = true;
        h.context.Swal.fire = async () => ({ isDismissed: true });
        await h.context.leaveRoom();
        assert.equal(h.client.hasActiveRecorder(), true);
        assert.equal(h.events.includes('stop'), false);
    });

    it('preserves the chosen survey action and disconnect-all flag after saving', async () => {
        const h = createHarness();
        const download = deferred();
        h.client.handleLocalRecordingStop = () => download.promise;
        h.client.exitRoom = (disconnectAll) => h.events.push(['exit-room', disconnectAll]);
        h.context.survey.enabled = true;
        h.context.Swal.fire = async () => ({ isDenied: true });
        const exit = h.context.leaveRoom(true, true);
        await tick();
        h.stopEvent();
        download.resolve();
        await exit;
        assert.deepEqual(h.events.at(-2), ['exit-room', true]);
        assert.deepEqual(h.events.at(-1), ['navigate', 'https://survey.example']);
    });

    it('waits before following an eject-all custom redirect', async () => {
        const h = createHarness();
        const download = deferred();
        h.client.handleLocalRecordingStop = () => download.promise;
        h.client.isSafeRedirectURL = () => true;
        const exit = h.client.handleEjectAllFromRoom({ redirect: 'https://host.example/done' });
        assert.equal(h.events.includes('exit-room'), false);
        h.stopEvent();
        download.resolve();
        await exit;
        assert.deepEqual(h.events.at(-1), ['navigate', 'https://host.example/done']);
    });

    it('waits before reconnect navigation', async () => {
        const h = createHarness();
        const download = deferred();
        h.client.handleLocalRecordingStop = () => download.promise;
        h.client.updatePeerInfoInLocalStorage = () => {};
        h.client.removePeerInfoFromLocalStorage = () => {};
        h.client.getReconnectDirectJoinURL = () => 'https://meet.example/join?room=test';
        h.client.exit = () => h.events.push('offline-exit');
        h.client.refreshBrowser();
        h.timers.shift()();
        assert.equal(h.events.includes('offline-exit'), false);
        h.stopEvent();
        download.resolve();
        await tick();
        assert.deepEqual(h.events.at(-1), ['navigate', 'https://meet.example/join?room=test']);
    });

    it('does not notify an embedded host to redirect until saving completes', async () => {
        const h = createHarness();
        const download = deferred();
        h.client.handleLocalRecordingStop = () => download.promise;
        h.context.isEmbedded = true;
        h.context.window.parent = { postMessage: (data) => h.events.push(['redirect-message', data]) };
        const exit = h.context.completeRoomExit();
        assert.equal(
            h.events.some((event) => event[0] === 'redirect-message'),
            false
        );
        h.stopEvent();
        download.resolve();
        await exit;
        assert.equal(h.events.at(-1)[0], 'redirect-message');
        assert.equal(h.events.at(-1)[1].url, 'https://meet.example/newroom');
    });

    it('restores the back-button guard when the user stays after saving fails', async () => {
        const h = createHarness();
        h.client.handleLocalRecordingStop = async () => {
            throw new Error('download failed');
        };
        h.listeners.popstate({});
        await tick();
        h.stopEvent();
        await tick();
        assert.equal(h.events.includes('back'), false);
        assert.equal(h.events.at(-1), 'push-state');
        assert.equal(h.context.preventExit, true);
    });

    it('cleans up download resources and preserves data when triggering the download fails', async () => {
        const h = createHarness();
        h.context.recordedBlobs.push(new Blob(['data']));
        h.context.document.createElement = () => ({
            style: {},
            click() {
                throw new Error('download blocked');
            },
        });
        await assert.rejects(h.client.saveRecordingInLocalDevice(new Blob(['data']), 'test.webm'), /download blocked/);
        assert.equal(h.events.includes('cleanup'), true);
        assert.equal(h.events.includes('revoke'), true);
        assert.equal(h.context.recordedBlobs.length, 1);
    });

    it('retains the original blob if optional WebM duration repair fails', async () => {
        const h = createHarness();
        const blob = new Blob(['data'], { type: 'video/webm' });
        h.data(blob);
        h.context.window.FixWebmDuration = async () => {
            throw new Error('repair unavailable');
        };
        let downloaded;
        h.client.saveRecordingInLocalDevice = async (data) => {
            downloaded = data;
        };
        h.client.stopRecording();
        h.stopEvent();
        await h.client.saveRecording('fallback');
        assert.equal(await downloaded.text(), 'data');
    });

    it('preserves navigation without a recording', async () => {
        const h = createHarness();
        h.client.mediaRecorder = null;
        h.client._isRecording = false;
        h.client._recordingSave = null;
        await h.context.completeRoomExit();
        assert.equal(h.events.includes('progress'), false);
        assert.equal(h.events.includes('exit-room'), true);
        assert.deepEqual(h.events.at(-1), ['navigate', 'https://meet.example/newroom']);
    });

    it('keeps the mobile download link and room open until saving is explicitly confirmed', async () => {
        const h = createHarness();
        const confirmation = deferred();
        let dialog;
        let link;
        h.client.isMobileDevice = true;
        h.client.getId = () => ({ className: '' });
        h.context.document.createElement = () => {
            link = { style: {}, click: () => h.events.push('download') };
            return link;
        };
        h.context.Swal.fire = (options) => {
            dialog = options;
            return confirmation.promise;
        };
        h.data(new Blob(['data'], { type: 'video/mp4' }));
        const exit = h.context.completeRoomExit();
        h.stopEvent();
        await tick();
        assert.equal(h.client.isAwaitingRecordingDownload(), true);
        assert.equal(h.events.includes('download'), false);
        assert.equal(h.events.includes('exit-room'), false);
        assert.equal(h.events.includes('revoke'), false);
        assert.equal(dialog.allowOutsideClick, false);
        assert.equal(dialog.allowEscapeKey, false);
        assert.equal(dialog.title, 'Recording');
        assert.equal(dialog.confirmButtonText, 'Download recording');
        assert.equal(dialog.denyButtonText, 'Continue leaving');
        assert.equal(dialog.text, 'Download your recording, finish saving it, then continue leaving.');
        const validationMessages = [];
        h.context.Swal.showValidationMessage = (message) => validationMessages.push(message);
        assert.equal(dialog.preDeny(), false);
        assert.equal(validationMessages.length, 1);
        assert.equal(dialog.preConfirm(), false);
        assert.equal(dialog.preDeny(), true);
        assert.equal(link.target, '_blank');
        assert.equal(h.events.includes('download'), true);
        await tick();
        assert.equal(h.events.includes('exit-room'), false);
        assert.equal(h.events.includes('revoke'), false);
        assert.equal(h.timers.length, 0);
        assert.equal(dialog.preConfirm(), false);
        confirmation.resolve({ isDenied: true });
        await exit;
        assert.equal(h.client.isAwaitingRecordingDownload(), false);
        assert.ok(h.events.indexOf('revoke') < h.events.indexOf('exit-room'));
    });

    it('does not replace a pending mobile download dialog when exit starts', async () => {
        const h = createHarness();
        const confirmation = deferred();
        h.client.isMobileDevice = true;
        h.client.getId = () => ({ className: '' });
        let dialog;
        h.context.Swal.fire = (options) => {
            dialog = options;
            return confirmation.promise;
        };
        h.data(new Blob(['data'], { type: 'video/mp4' }));
        h.client.stopRecording();
        h.stopEvent();
        await tick();
        assert.equal(dialog.denyButtonText, 'Done saving');
        const exit = h.context.completeRoomExit();
        assert.equal(h.events.includes('progress'), false);
        assert.equal(h.events.includes('exit-room'), false);
        confirmation.resolve({ isDenied: true });
        await exit;
        assert.equal(h.events.includes('exit-room'), true);
    });

    it('surfaces mobile download errors and lets the user retry without navigating', async () => {
        const h = createHarness();
        const confirmation = deferred();
        const errors = [];
        let dialog;
        let failDownload = true;
        h.client.isMobileDevice = true;
        h.context.document.createElement = () => ({
            style: {},
            click() {
                if (failDownload) throw new Error('download blocked');
                h.events.push('download');
            },
        });
        h.context.Swal.fire = (options) => {
            dialog = options;
            return confirmation.promise;
        };
        h.context.Swal.showValidationMessage = (message) => errors.push(message);
        const save = h.client.saveRecordingInLocalDevice(new Blob(['data']), 'test.mp4');
        assert.equal(dialog.preConfirm(), false);
        assert.equal(errors.length, 1);
        assert.equal(dialog.preDeny(), false);
        assert.equal(h.events.includes('revoke'), false);
        failDownload = false;
        assert.equal(dialog.preConfirm(), false);
        assert.equal(dialog.preDeny(), true);
        assert.equal(h.events.includes('download'), true);
        confirmation.resolve({ isDenied: true });
        await save;
    });

    it('rejects an interrupted mobile save dialog and retains recorded data', async () => {
        const h = createHarness();
        h.client.isMobileDevice = true;
        h.context.recordedBlobs.push(new Blob(['data']));
        h.context.Swal.fire = async () => ({ isDismissed: true });
        await assert.rejects(
            h.client.saveRecordingInLocalDevice(new Blob(['data']), 'test.mp4'),
            /Recording download was not confirmed/
        );
        assert.equal(h.context.recordedBlobs.length, 1);
        assert.equal(h.events.includes('revoke'), true);
    });

    it('preserves the prejoin exit before a room client exists', () => {
        const h = createHarness();
        h.context.rc = null;
        h.context.initLeaveMeeting();
        assert.deepEqual(h.events.at(-1), ['navigate', '/newroom']);
        assert.doesNotThrow(() => h.listeners.beforeunload({ preventDefault() {} }));
    });

    it('warns on tab unload while a disconnected recording is still saving', () => {
        const h = createHarness();
        h.context.preventExit = false;
        h.context.window.localStorage.isReconnected = 'true';
        const event = { preventDefault: () => h.events.push('prevent-unload') };
        h.listeners.beforeunload(event);
        assert.equal(h.events.includes('prevent-unload'), true);
        assert.equal(event.returnValue, '');
    });

    for (const action of ['eject', 'ban']) {
        for (const finishBeforeNotice of [false, true]) {
            it(`finishes ${action} with recording saved ${finishBeforeNotice ? 'before' : 'after'} the notice`, async () => {
                const h = createHarness();
                const download = deferred();
                const dialogs = installDialogs(h);
                h.context.survey.enabled = true;
                h.client.peer_id = 'participant';
                h.client.exit = (offline) => {
                    assert.equal(offline, true);
                    h.events.push('offline-exit');
                    h.client.saveRecording('forced exit');
                };
                h.client.handleLocalRecordingStop = () => {
                    assert.equal(h.context.recShowInfo, false);
                    return download.promise;
                };
                const exit = h.client.peerAction('Presenter', 'participant', action, false);
                assert.equal(h.events.includes('offline-exit'), true);
                assert.equal(dialogs.current.options.timer, 5000);
                h.stopEvent();
                if (finishBeforeNotice) {
                    download.resolve();
                    await tick();
                    assert.equal(h.client.hasPendingRecordingSave(), false);
                }
                dialogs.finish({ isDismissed: true, dismiss: 'timer' });
                await tick();
                if (!finishBeforeNotice) {
                    assert.equal(dialogs.current.options.title, 'Saving recording');
                    assert.equal(h.events.includes('exit-room'), false);
                    download.resolve();
                }
                await exit;
                assert.equal(dialogs.current, null);
                assert.equal(h.events.filter((event) => event === 'offline-exit').length, 1);
                assert.equal(h.events.filter((event) => event === 'exit-room').length, 1);
                assert.deepEqual(h.events.at(-1), ['navigate', 'https://meet.example/newroom']);
                assert.equal(h.context.recShowInfo, true);
                assert.equal(h.client._forcedExitPending, false);
                assert.equal(
                    dialogs.dialogs.some((dialog) => dialog.options.title === 'Leave the meeting?'),
                    false
                );
            });
        }
    }

    it('preserves the mobile save dialog when it replaces the ejection countdown', async () => {
        const h = createHarness();
        const dialogs = installDialogs(h);
        h.client.isMobileDevice = true;
        h.client.getId = () => ({ className: '' });
        h.client.peer_id = 'participant';
        h.client.exit = () => h.client.saveRecording('forced exit');
        const exit = h.client.peerAction('Presenter', 'participant', 'eject', false);
        h.data(new Blob(['final-data'], { type: 'video/mp4' }));
        h.stopEvent();
        await tick();
        assert.equal(dialogs.current.options.title, 'Recording');
        assert.equal(dialogs.current.options.denyButtonText, 'Continue leaving');
        assert.equal(h.context.isLeavingRoom, true);
        assert.equal(h.client._forcedExitPending, true);
        assert.equal(dialogs.dialogs.length, 2);
        assert.equal(h.events.includes('exit-room'), false);
        dialogs.current.options.preConfirm();
        assert.equal(h.events.includes('download'), true);
        assert.equal(dialogs.current.options.preDeny(), true);
        dialogs.finish({ isDenied: true });
        await exit;
        assert.equal(dialogs.current, null);
        assert.equal(h.client.hasPendingRecordingSave(), false);
        assert.equal(h.context.isLeavingRoom, false);
        assert.deepEqual(h.events.at(-1), ['navigate', 'https://meet.example/newroom']);
    });

    it('ignores duplicate forced-exit commands without replacing the save dialog', async () => {
        const h = createHarness();
        const download = deferred();
        const dialogs = installDialogs(h);
        h.client.peer_id = 'participant';
        h.client.exit = () => h.client.saveRecording('forced exit');
        h.client.handleLocalRecordingStop = () => download.promise;
        const exit = h.client.peerAction('Presenter', 'participant', 'eject', false);
        h.stopEvent();
        await h.client.peerAction('Presenter', 'participant', 'eject', false);
        assert.equal(dialogs.dialogs.length, 1);
        dialogs.finish({ isDismissed: true, dismiss: 'timer' });
        await tick();
        await h.client.peerAction('Presenter', 'participant', 'ban', false);
        assert.equal(dialogs.dialogs.length, 2);
        assert.equal(dialogs.current.options.title, 'Saving recording');
        download.resolve();
        await exit;
        assert.equal(dialogs.current, null);
        assert.equal(h.events.filter((event) => event === 'exit-room').length, 1);
    });

    it('does not interrupt a mobile download that is already open when the presenter ejects the peer', async () => {
        const h = createHarness();
        const dialogs = installDialogs(h);
        h.client.isMobileDevice = true;
        h.client.getId = () => ({ className: '' });
        h.client.peer_id = 'participant';
        h.client.exit = () => h.client.saveRecording('forced exit');
        h.data(new Blob(['data'], { type: 'video/mp4' }));
        h.client.stopRecording();
        h.stopEvent();
        await tick();
        const exit = h.client.peerAction('Presenter', 'participant', 'eject', false);
        assert.equal(dialogs.dialogs.length, 1);
        assert.equal(dialogs.current.options.title, 'Recording');
        assert.equal(dialogs.current.options.denyButtonText, 'Done saving');
        dialogs.current.options.preConfirm();
        dialogs.finish({ isDenied: true });
        await exit;
        assert.equal(dialogs.current, null);
        assert.deepEqual(h.events.at(-1), ['navigate', 'https://meet.example/newroom']);
    });

    it('does not replace the recording progress dialog when an exiting peer is ejected', async () => {
        const h = createHarness();
        const dialogs = installDialogs(h);
        const download = deferred();
        h.client.peer_id = 'participant';
        h.client.exit = () => h.client.saveRecording('forced exit');
        h.client.handleLocalRecordingStop = () => download.promise;
        const exit = h.context.completeRoomExit();
        h.stopEvent();
        await h.client.peerAction('Presenter', 'participant', 'eject', false);
        assert.equal(dialogs.dialogs.length, 1);
        assert.equal(dialogs.current.options.title, 'Saving recording');
        download.resolve();
        await exit;
        assert.equal(dialogs.current, null);
        assert.equal(h.events.filter((event) => event === 'exit-room').length, 1);
    });
});
