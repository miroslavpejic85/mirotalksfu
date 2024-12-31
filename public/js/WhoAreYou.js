'use strict';

console.log(window.location);

const mediaQuery = window.matchMedia('(max-width: 640px)');

const settings = JSON.parse(localStorage.getItem('SFU_SETTINGS')) || {};
console.log('Settings:', settings);

const autoJoinRoom = false; // Automatically join the guest to the meeting
const intervalTime = 5000; // Interval to check room status

const presenterLoginBtn = document.getElementById('presenterLoginButton');
const guestJoinRoomBtn = document.getElementById('guestJoinRoomButton');

// Disable the guest join button initially
guestJoinRoomBtn.classList.add('disabled');

// Extract room ID from URL path using XSS filtering
const pathParts = window.location.pathname.split('/');
const roomId = filterXSS(pathParts[pathParts.length - 1]);

// Store the room in the session for auto-join from the landing page after successful login
window.sessionStorage.roomID = roomId;

let intervalId = null;
let roomActive = false;

// Button event handlers
presenterLoginBtn.addEventListener('click', () => {
    window.location.href = '/login';
});

guestJoinRoomBtn.addEventListener('click', () => {
    window.location.href = `/join/${roomId}`;
});

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

// Handle screen resize to adjust presenter login button visibility
function handleScreenResize(e) {
    if (!roomActive) {
        presenterLoginBtn.style.display = e.matches ? 'flex' : 'inline-flex';
    }
}

// Function to check room status from the server
async function checkRoomStatus(roomId) {
    if (!roomId) {
        console.warn('Room ID is empty!');
        return;
    }

    try {
        const response = await axios.post('/isRoomActive', { roomId });
        const isActive = response.data.message;
        console.log('Room active status:', isActive);

        roomActive = isActive;
        if (roomActive) {
            playSound('roomActive');
            guestJoinRoomBtn.classList.remove('disabled');
            presenterLoginBtn.style.display = 'none';

            if (autoJoinRoom) {
                guestJoinRoomBtn.click();
            }
        } else {
            guestJoinRoomBtn.classList.add('disabled');
            handleScreenResize(mediaQuery);
        }
    } catch (error) {
        console.error('Error checking room status:', error);
    }
}

// Start interval to check room status every 5 seconds
function startRoomStatusCheck() {
    intervalId = setInterval(() => {
        if (document.visibilityState === 'visible') {
            checkRoomStatus(roomId);
        }
    }, intervalTime);
}

// Fallback to setTimeout for room status checks
function fallbackRoomStatusCheck() {
    if (document.visibilityState === 'visible') {
        checkRoomStatus(roomId);
    }
    setTimeout(fallbackRoomStatusCheck, intervalTime);
}

// Page visibility change handler to pause or resume status checks
function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
        console.log('Page is visible. Resuming room status checks.');
        checkRoomStatus(roomId);
        if (!intervalId) startRoomStatusCheck();
    } else {
        console.log('Page is hidden. Pausing room status checks.');
        clearInterval(intervalId);
        intervalId = null;
    }
}

// Initialize event listeners
mediaQuery.addEventListener('change', handleScreenResize);
document.addEventListener('visibilitychange', handleVisibilityChange);

// Start checking room status on page load
handleScreenResize(mediaQuery);
checkRoomStatus(roomId);
startRoomStatusCheck();
