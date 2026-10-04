'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const source = fs.readFileSync(path.join(__dirname, '..', 'public/js/WakeLock.js'), 'utf8');

function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function createSentinel() {
    let onRelease;
    const sentinel = {
        released: false,
        addEventListener(name, listener) {
            assert.equal(name, 'release');
            onRelease = listener;
        },
        emitRelease() {
            this.released = true;
            onRelease?.();
        },
    };
    sentinel.release = sinon.stub().callsFake(async () => sentinel.emitRelease());
    return sentinel;
}

describe('mobile wake-lock lifecycle', () => {
    let context;
    let clock;
    let documentEvents;
    let windowEvents;
    let sentinel;

    beforeEach(() => {
        documentEvents = {};
        windowEvents = {};
        sentinel = createSentinel();
        context = vm.createContext({
            navigator: { wakeLock: { request: sinon.stub().resolves(sentinel) } },
            document: {
                visibilityState: 'visible',
                pictureInPictureElement: null,
                addEventListener: (name, handler) => (documentEvents[name] = handler),
            },
            window: { addEventListener: (name, handler) => (windowEvents[name] = handler) },
            console: { info: sinon.spy(), error: sinon.spy() },
            userLog: sinon.spy(),
            switchKeepAwake: { checked: false },
            audio: true,
            video: false,
            screen: false,
            isDesktopDevice: false,
            setTimeout,
            clearTimeout,
        });
        clock = sinon.useFakeTimers();
        context.setTimeout = setTimeout;
        context.clearTimeout = clearTimeout;
        vm.runInContext(source, context);
    });

    afterEach(() => clock.restore());

    it('does not queue routine acquisition, release, or empty-release notifications', async () => {
        await context.releaseWakeLock();
        await context.releaseWakeLock();
        assert.equal(context.console.info.callCount, 0);
        await context.requestWakeLock();
        context.audio = false;
        await context.releaseWakeLock();
        await context.releaseWakeLock();
        assert.equal(context.navigator.wakeLock.request.callCount, 1);
        assert.equal(sentinel.release.callCount, 1);
        assert.equal(context.console.info.callCount, 2);
        assert.equal(context.userLog.callCount, 0);
        assert.equal(context.switchKeepAwake.checked, false);
    });

    it('allows only one in-flight acquisition across repeated media syncs', async () => {
        const pending = deferred();
        context.navigator.wakeLock.request.returns(pending.promise);
        const first = context.syncWakeLock();
        await context.syncWakeLock();
        context.applyKeepAwake(true);
        await clock.tickAsync(100);
        assert.equal(context.navigator.wakeLock.request.callCount, 1);
        pending.resolve(sentinel);
        await first;
        assert.equal(context.switchKeepAwake.checked, true);
        assert.equal(context.userLog.callCount, 0);
    });

    for (const state of ['hidden', 'video', 'screen', 'pip', 'pagehide', 'disabled']) {
        it(`releases an acquisition that finishes after ${state}`, async () => {
            const pending = deferred();
            context.navigator.wakeLock.request.returns(pending.promise);
            const acquiring = context.requestWakeLock();
            if (state === 'hidden') context.document.visibilityState = 'hidden';
            if (state === 'video') context.video = true;
            if (state === 'screen') context.screen = true;
            if (state === 'pip') context.document.pictureInPictureElement = {};
            if (state === 'pagehide') windowEvents.pagehide();
            if (state === 'disabled') {
                context.audio = false;
                context.applyKeepAwake(false);
            }
            pending.resolve(sentinel);
            await acquiring;
            await clock.tickAsync(100);
            assert.equal(sentinel.release.callCount, 1);
            assert.equal(context.switchKeepAwake.checked, false);
            assert.equal(context.navigator.wakeLock.request.callCount, 1);
            assert.equal(context.userLog.callCount, 0);
        });
    }

    it('waits for release before reacquiring when media state changes', async () => {
        await context.requestWakeLock();
        const pending = deferred();
        sentinel.release.callsFake(async () => {
            await pending.promise;
            sentinel.emitRelease();
        });
        context.video = true;
        const releasing = context.syncWakeLock();
        await context.releaseWakeLock();
        context.video = false;
        await context.syncWakeLock();
        assert.equal(sentinel.release.callCount, 1);
        assert.equal(context.navigator.wakeLock.request.callCount, 1);
        const nextSentinel = createSentinel();
        context.navigator.wakeLock.request.resolves(nextSentinel);
        pending.resolve();
        await releasing;
        await clock.tickAsync(100);
        assert.equal(context.navigator.wakeLock.request.callCount, 2);
        sentinel.emitRelease();
        await clock.tickAsync(100);
        assert.equal(context.navigator.wakeLock.request.callCount, 2);
        assert.equal(context.switchKeepAwake.checked, true);
    });

    it('reacquires automatically after a browser release without toasts', async () => {
        await context.requestWakeLock();
        context.document.visibilityState = 'hidden';
        sentinel.emitRelease();
        documentEvents.visibilitychange();
        await clock.tickAsync(100);
        assert.equal(context.navigator.wakeLock.request.callCount, 1);
        context.navigator.wakeLock.request.resolves(createSentinel());
        context.document.visibilityState = 'visible';
        documentEvents.visibilitychange();
        await clock.tickAsync(100);
        assert.equal(context.navigator.wakeLock.request.callCount, 2);
        assert.equal(context.userLog.callCount, 0);
    });

    it('does not reacquire on pagehide and restores after pageshow', async () => {
        await context.requestWakeLock();
        windowEvents.pagehide();
        await clock.tickAsync(100);
        assert.equal(context.navigator.wakeLock.request.callCount, 1);
        context.navigator.wakeLock.request.resolves(createSentinel());
        windowEvents.pageshow();
        await clock.tickAsync(100);
        assert.equal(context.navigator.wakeLock.request.callCount, 2);
    });

    it('reports request failures and allows a later retry', async () => {
        context.navigator.wakeLock.request.rejects(new Error('Permission denied'));
        await context.requestWakeLock();
        await clock.tickAsync(100);
        assert.equal(context.userLog.callCount, 1);
        assert.equal(context.userLog.firstCall.args[0], 'error');
        assert.match(context.userLog.firstCall.args[1], /Permission denied/);
        assert.equal(context.switchKeepAwake.checked, false);
        context.navigator.wakeLock.request.resolves(sentinel);
        await context.requestWakeLock();
        assert.equal(context.switchKeepAwake.checked, true);
    });

    it('reports release failures without losing the active sentinel', async () => {
        await context.requestWakeLock();
        sentinel.release.rejects(new Error('Release failed'));
        await context.releaseWakeLock();
        assert.equal(context.console.error.callCount, 1);
        assert.equal(context.switchKeepAwake.checked, true);
        await context.requestWakeLock();
        assert.equal(context.navigator.wakeLock.request.callCount, 1);
        sentinel.release.callsFake(async () => sentinel.emitRelease());
        context.audio = false;
        await context.releaseWakeLock();
        assert.equal(context.switchKeepAwake.checked, false);
    });

    it('ignores desktop and unsupported devices', async () => {
        context.isDesktopDevice = true;
        await context.syncWakeLock();
        context.isDesktopDevice = false;
        context.navigator.wakeLock = undefined;
        await context.syncWakeLock();
        assert.equal(context.userLog.callCount, 0);
        assert.equal(context.console.info.callCount, 0);
    });
});
