'use strict';

console.log(window.location);

const presenterLoginBtn = document.getElementById('presenterLoginButton');
const guestJoinRoomBtn = document.getElementById('guestJoinRoomButton');

const pathParts = window.location.pathname.split('/');
const roomPath = filterXSS(pathParts[pathParts.length - 1]);

presenterLoginBtn.onclick = (e) => {
    window.location.href = '/login';
};

guestJoinRoomBtn.onclick = (e) => {
    window.location.href = '/join/' + roomPath;
};
