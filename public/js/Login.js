'use strict';

console.log(window.location);

const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginButton');

const joinRoomForm = document.getElementById('joinRoomForm');
const selectRoom = document.getElementById('selectRoom');
const joinSelectRoomBtn = document.getElementById('joinSelectRoomButton');

usernameInput.onkeyup = (e) => {
    if (e.keyCode === 13) {
        e.preventDefault();
        login();
    }
};
passwordInput.onkeyup = (e) => {
    if (e.keyCode === 13) {
        e.preventDefault();
        login();
    }
};

loginBtn.onclick = (e) => {
    login();
};

joinSelectRoomBtn.onclick = (e) => {
    join();
};

function login() {
    const username = filterXSS(document.getElementById('username').value);
    const password = filterXSS(document.getElementById('password').value);

    // http://localhost:3010/join/?room=test
    // http://localhost:3010/join/?room=test&roomPassword=0&name=admin&audio=0&video=0&screen=0&notify=0

    const qs = new URLSearchParams(window.location.search);
    const room = filterXSS(qs.get('room'));

    // http://localhost:3010/join/test
    const pathParts = window.location.pathname.split('/');
    const roomPath = filterXSS(pathParts[pathParts.length - 1]);

    if (username && password) {
        axios
            .post('/login', {
                username: username,
                password: password,
            })
            .then(function (response) {
                console.log(response);

                // Store in session
                const token = response.data.message;
                window.sessionStorage.peer_token = token;

                // Allowed rooms
                const allowedRooms = response.data.allowedRooms;
                if (allowedRooms && !allowedRooms.includes('*')) {
                    console.log('User detected with limited join room access!', allowedRooms);
                    loginForm.style.display = 'none';
                    joinRoomForm.style.display = 'block';
                    allowedRooms.forEach((room) => {
                        const option = document.createElement('option');
                        option.value = room;
                        option.text = room;
                        selectRoom.appendChild(option);
                    });
                    return;
                }

                if (room) {
                    return (window.location.href = '/join/' + window.location.search);
                    // return (window.location.href = '/join/?room=' + room + '&token=' + token);
                }
                if (roomPath && roomPath !== 'login') {
                    return (window.location.href = '/join/' + roomPath);
                    // return (window.location.href ='/join/?room=' + roomPath + '&token=' + token);
                }

                return (window.location.href = '/logged');
            })
            .catch(function (error) {
                console.error(error);
                alert('Unauthorized');
            });
        return;
    }
    if (!username && !password) {
        alert('Username and Password required');
        return;
    }
    if (!username) {
        alert('Username required');
        return;
    }
    if (!password) {
        alert('Password required');
        return;
    }
}

function join() {
    //window.location.href = '/join/' + selectRoom.value;
    const username = filterXSS(document.getElementById('username').value);
    const roomId = filterXSS(document.getElementById('selectRoom').value);
    window.location.href = '/join/?room=' + roomId + '&name=' + username + '&token=' + window.sessionStorage.peer_token;
}
