'use strict';

console.log(window.location);

const settings = JSON.parse(localStorage.getItem('SFU_SETTINGS'));

console.log('Settings', settings);

const autoJoinRoom = false; // automatically join the guest to the meeting

const presenterLoginBtn = document.getElementById('presenterLoginButton');
const guestJoinRoomBtn = document.getElementById('guestJoinRoomButton');

guestJoinRoomBtn.classList.add('disabled');

const pathParts = window.location.pathname.split('/');
const roomId = filterXSS(pathParts[pathParts.length - 1]);

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

function checkRoomStatus(roomId) {
    if (!roomId) {
        console.warn('Room ID empty!');
        return;
    }
    axios
        .post('/isRoomActive', { roomId })
        .then((response) => {
            console.log('isRoomActive', response.data);
            const roomActive = response.data.message;
            if (roomActive) {
                sound('roomActive');
                guestJoinRoomBtn.classList.remove('disabled');
                presenterLoginBtn.style.display = 'none';
                if (autoJoinRoom) guestJoinRoomBtn.click();
            } else {
                guestJoinRoomBtn.classList.add('disabled');
                presenterLoginBtn.style.display = 'inline-flex';
            }
        })
        .catch((error) => {
            console.error('Error checking room status', error);
        });
}

checkRoomStatus(roomId);

setInterval(() => checkRoomStatus(roomId), 5000); // Start checking room status every 5 seconds
