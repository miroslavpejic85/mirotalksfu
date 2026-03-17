'use strict';

console.log(window.location);

const settings = JSON.parse(localStorage.getItem('SFU_SETTINGS')) || {};
console.log('Settings:', settings);

const pollInterval = 5000;

const pathParts = window.location.pathname.split('/');
const roomId = filterXSS(pathParts[pathParts.length - 1]);

const statusEl = document.getElementById('waitingStatus');
const loginLink = document.getElementById('loginLink');

// Store the room in the session for auto-join from the landing page after successful login
window.sessionStorage.roomID = roomId;

let intervalId = null;
let roomActive = false;

// Brand text helper (overridden by Brand.js if configured)
function getWaitingRoomBrand(key, fallback) {
    try {
        return (typeof BRAND !== 'undefined' && BRAND?.whoAreYou?.[key]) || fallback;
    } catch (e) {
        return fallback;
    }
}

// Set login link with room param so host returns to the room after login
if (roomId && roomId !== 'whoAreYou') {
    loginLink.href = '/login?room=' + encodeURIComponent(roomId);
}

// Function to play sound
function playSound(name) {
    if (!settings.sounds) return;

    const soundSrc = `../sounds/${name}.wav`;
    const audio = new Audio(soundSrc);
    audio.volume = 0.5;

    audio.play().catch((err) => {
        console.error(`Error playing sound: ${err}`);
    });
}

// Function to check room status from the server
function checkRoom() {
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

// Schedule next check, pausing when page is hidden
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

// Page visibility change handler
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !roomActive) {
        checkRoom();
    }
});

// Start checking
checkRoom();
