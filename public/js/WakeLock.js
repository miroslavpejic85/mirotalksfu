'use strict';

// https://developer.mozilla.org/en-US/docs/Web/API/WakeLock

let wakeLockSentinel = null;
let wakeLockRequestPending = false;
let wakeLockReleasePending = false;
let wakeLockGeneration = 0;
let wakeLockPageActive = true;
let userWantsKeepAwake = false;
let syncTimeout = null;

function isWakeLockSupported() {
    return !!navigator?.wakeLock?.request;
}

function isAudioOrUIActive() {
    return (audio || userWantsKeepAwake) && !video && !screen;
}

function shouldKeepAwake() {
    return (
        !isDesktopDevice &&
        wakeLockPageActive &&
        isWakeLockSupported() &&
        document.visibilityState === 'visible' &&
        !document.pictureInPictureElement &&
        isAudioOrUIActive()
    );
}

async function requestWakeLock() {
    if (wakeLockSentinel || wakeLockRequestPending || wakeLockReleasePending || !shouldKeepAwake()) return;
    wakeLockRequestPending = true;
    const generation = wakeLockGeneration;
    try {
        const sentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel = sentinel;
        sentinel.addEventListener('release', () => {
            if (wakeLockSentinel !== sentinel) return;
            wakeLockSentinel = null;
            switchKeepAwake.checked = false;
            syncWakeLockDebounced();
        });
        if (generation !== wakeLockGeneration || !shouldKeepAwake() || sentinel.released) {
            await releaseWakeLock();
            return;
        }
        switchKeepAwake.checked = true;
        console.info('🟢 Wake Lock is active');
    } catch (err) {
        switchKeepAwake.checked = false;
        userLog('error', '🔴 Failed to request Wake Lock: ' + err.message);
    } finally {
        wakeLockRequestPending = false;
        if (generation !== wakeLockGeneration && shouldKeepAwake()) syncWakeLockDebounced();
    }
}

async function releaseWakeLock() {
    if (isDesktopDevice) return;
    wakeLockGeneration++;
    const sentinel = wakeLockSentinel;
    if (wakeLockReleasePending) return;
    if (!sentinel) {
        switchKeepAwake.checked = false;
        return;
    }
    wakeLockReleasePending = true;
    try {
        await sentinel.release();
        if (wakeLockSentinel === sentinel) wakeLockSentinel = null;
        switchKeepAwake.checked = false;
        console.info('⚪ Wake Lock released');
    } catch (err) {
        console.error('Failed to release Wake Lock:', err);
    } finally {
        wakeLockReleasePending = false;
        if (!wakeLockSentinel && shouldKeepAwake()) syncWakeLockDebounced();
    }
}

function syncWakeLockDebounced() {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(syncWakeLock, 50);
}

async function syncWakeLock() {
    shouldKeepAwake() ? await requestWakeLock() : await releaseWakeLock();
}

function applyKeepAwake(enabled) {
    if (isDesktopDevice) return;
    userWantsKeepAwake = !!enabled;
    syncWakeLockDebounced();
}

document.addEventListener('visibilitychange', syncWakeLockDebounced);

document.addEventListener('enterpictureinpicture', releaseWakeLock);
document.addEventListener('leavepictureinpicture', syncWakeLockDebounced);

window.addEventListener('pagehide', () => {
    wakeLockPageActive = false;
    clearTimeout(syncTimeout);
    releaseWakeLock();
});
window.addEventListener('pageshow', () => {
    wakeLockPageActive = true;
    syncWakeLockDebounced();
});
