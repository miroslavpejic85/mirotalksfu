'use strict';

console.log(window.location);

const mediaQuery = window.matchMedia('(max-width: 640px)');

const settings = JSON.parse(localStorage.getItem('SFU_SETTINGS'));

console.log('Settings', settings);

const autoJoinRoom = false; // automatically join the guest to the meeting

const intervalTime = 5000; // check room status every 5 seconds

const presenterLoginBtn = document.getElementById('presenterLoginButton');
const guestJoinRoomBtn = document.getElementById('guestJoinRoomButton');

guestJoinRoomBtn.classList.add('disabled');

const pathParts = window.location.pathname.split('/');
const roomId = filterXSS(pathParts[pathParts.length - 1]);

let intervalId;
let roomActive = false;

presenterLoginBtn.onclick = () => {
    window.location.href = '/login';
};

guestJoinRoomBtn.onclick = () => {
    window.location.href = '/join/' + roomId;
};

function sound(name) {
    if (!settings.sounds) return;
    const sound = '../sounds/' + name + '.wav';
    const audio = new Audio(sound);
    audio.volume = 0.5;
    audio.play().catch((err) => {
        return false;
    });
}

function handleScreenResize(e) {
    if (roomActive) return;
    presenterLoginBtn.style.display = e.matches ? 'flex' : 'inline-flex';
}

function checkRoomStatus(roomId) {
    if (!roomId) {
        console.warn('Room ID empty!');
        return;
    }
    axios
        .post('/isRoomActive', { roomId })
        .then((response) => {
            console.log('isRoomActive', response.data);
            roomActive = response.data.message;
            if (roomActive) {
                sound('roomActive');
                guestJoinRoomBtn.classList.remove('disabled');
                presenterLoginBtn.style.display = 'none';
                if (autoJoinRoom) guestJoinRoomBtn.click();
            } else {
                guestJoinRoomBtn.classList.add('disabled');
                handleScreenResize(mediaQuery);
            }
        })
        .catch((error) => {
            console.error('Error checking room status', error);
        });
}

handleScreenResize(mediaQuery);

checkRoomStatus(roomId);

mediaQuery.addEventListener('change', handleScreenResize);

function startCheckingRoomStatus() {
    // Function to run every 5 seconds
    intervalId = setInterval(() => {
        if (document.visibilityState === 'visible') {
            checkRoomStatus(roomId);
        }
    }, intervalTime);
}

// Fallback to setTimeout if needed for better control
function fallbackCheckRoomStatus() {
    if (document.visibilityState === 'visible') {
        checkRoomStatus(roomId);
    }
    setTimeout(fallbackCheckRoomStatus, intervalTime);
}

// Use Page Visibility API to pause/resume the checks
document.addEventListener('visibilitychange', () => {
    checkRoomStatus(roomId);
    //
    if (document.visibilityState === 'visible') {
        console.log('Page is visible. Resuming room status checks.');
        if (!intervalId) startCheckingRoomStatus();
    } else {
        console.log('Page is hidden. Pausing room status checks.');
        clearInterval(intervalId);
        intervalId = null;
    }
});

// Start checking room status when the page is first loaded
startCheckingRoomStatus();
