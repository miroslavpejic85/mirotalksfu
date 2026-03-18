'use strict';

console.log(window.location);

const settings = JSON.parse(localStorage.getItem('SFU_SETTINGS')) || {};
console.log('Settings:', settings);

const pollInterval = 5000;

const pathParts = window.location.pathname.split('/');
const roomId = filterXSS(pathParts[pathParts.length - 1]);

const statusEl = document.getElementById('waitingStatus');
const loginLink = document.getElementById('loginLink');
const waitingRoomNameEl = document.getElementById('waitingRoomName');
const waitingRoomNameText = document.getElementById('waitingRoomNameText');
const waitingElapsedText = document.getElementById('waitingElapsedText');
const spinnerDots = document.querySelectorAll('.waiting-spinner-dot');

window.sessionStorage.roomID = roomId;

let intervalId = null;
let roomActive = false;
const waitStartTime = Date.now();
let elapsedTimerId = null;

if (roomId && roomId !== 'whoAreYou') {
    waitingRoomNameText.textContent = roomId;
    waitingRoomNameEl.style.display = 'inline-block';
}

function updateElapsedTime() {
    const seconds = Math.floor((Date.now() - waitStartTime) / 1000);
    if (seconds < 60) {
        waitingElapsedText.textContent = getWaitingRoomBrand('waitingRoomElapsedJust', 'Just started waiting');
    } else {
        const minutes = Math.floor(seconds / 60);
        const template = getWaitingRoomBrand('waitingRoomElapsedMinutes', 'Waiting for {minutes}');
        waitingElapsedText.textContent = template.replace(
            '{minutes}',
            minutes + (minutes === 1 ? ' minute' : ' minutes')
        );
    }
}
elapsedTimerId = setInterval(updateElapsedTime, 10000);

function getWaitingRoomBrand(key, fallback) {
    try {
        return (typeof BRAND !== 'undefined' && BRAND?.whoAreYou?.[key]) || fallback;
    } catch (e) {
        return fallback;
    }
}

if (roomId && roomId !== 'whoAreYou') {
    loginLink.href = '/login?room=' + encodeURIComponent(roomId);
}

function playSound(name) {
    if (!settings.sounds) return;

    const soundSrc = `../sounds/${name}.wav`;
    const audio = new Audio(soundSrc);
    audio.volume = 0.5;

    audio.play().catch((err) => {
        console.error(`Error playing sound: ${err}`);
    });
}

function flashCheckingState() {
    spinnerDots.forEach((dot) => dot.classList.add('checking'));
    setTimeout(() => spinnerDots.forEach((dot) => dot.classList.remove('checking')), 600);
}

function checkRoom() {
    flashCheckingState();
    axios
        .post('/isRoomActive', { roomId: roomId })
        .then(function (response) {
            const isActive = response.data.message;
            console.log('Room active status:', isActive);

            if (isActive && !roomActive) {
                roomActive = true;
                playSound('roomActive');
                statusEl.textContent = getWaitingRoomBrand('waitingRoomReady', 'Room is ready! Joining...');
                statusEl.classList.add('ready');
                setTimeout(function () {
                    window.location.href = '/join/' + encodeURIComponent(roomId);
                }, 800);
            } else if (!isActive) {
                statusEl.textContent = getWaitingRoomBrand(
                    'waitingRoomWaiting',
                    'Waiting for host to start the meeting...'
                );
                scheduleNextCheck();
            }
        })
        .catch(function () {
            statusEl.textContent = getWaitingRoomBrand(
                'waitingRoomWaiting',
                'Waiting for host to start the meeting...'
            );
            scheduleNextCheck();
        });
}

function scheduleNextCheck() {
    if (intervalId) return;
    intervalId = setTimeout(function () {
        intervalId = null;
        if (document.visibilityState === 'visible') {
            checkRoom();
        } else {
            scheduleNextCheck();
        }
    }, pollInterval);
}

document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !roomActive) {
        checkRoom();
    }
});

checkRoom();
