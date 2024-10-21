'use strict';

console.log(window.location);

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

setInterval(() => checkRoomStatus(roomId), 5000); // Start checking room status every 5 seconds
