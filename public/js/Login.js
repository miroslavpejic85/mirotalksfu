'use strict';

console.log(window.location);

const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginButton');

const joinRoomForm = document.getElementById('joinRoomForm');
const selectRoom = document.getElementById('selectRoom');
const joinSelectRoomBtn = document.getElementById('joinSelectRoomButton');
const generateRoomBtn = document.getElementById('generateRoomButton');

// Default handler (will be overridden for admin below)
joinSelectRoomBtn.onclick = (e) => {
    join();
};

// Generate random room -> fills the custom input (admin mode). Hidden for limited users.
if (generateRoomBtn) {
    generateRoomBtn.onclick = (e) => {
        e.preventDefault();
        const uuid = getUUID4();
        const custom = document.getElementById('customRoomInput');
        if (custom && custom.offsetParent !== null) {
            custom.value = uuid;
        } else if (selectRoom && selectRoom.style.display !== 'none') {
            popup('warning', 'Random room is available for Admin users only');
        }
    };
}

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

                // Redirect to room if specified in URL
                if (room) {
                    window.location.href = '/join/' + window.location.search;
                    return;
                }
                // Redirect to room if specified in path
                if (roomPath && roomPath !== 'login') {
                    window.location.href = '/join/' + roomPath;
                    return;
                }

                // User (limited rooms)
                const allowedRooms = response.data.allowedRooms;
                if (allowedRooms && !allowedRooms.includes('*')) {
                    console.log('User detected with limited join room access!', allowedRooms);
                    loginForm.style.display = 'none';
                    joinRoomForm.style.display = 'block';
                    // Hide random button for limited users
                    if (generateRoomBtn) generateRoomBtn.style.display = 'none';
                    allowedRooms.forEach((room) => {
                        const option = document.createElement('option');
                        option.value = room;
                        option.text = room;
                        selectRoom.appendChild(option);
                    });
                    return;
                }

                // Admin (all rooms)
                if (allowedRooms && allowedRooms.includes('*')) {
                    console.log('User detected with admin access!', allowedRooms);
                    loginForm.style.display = 'none';
                    joinRoomForm.style.display = 'block';
                    selectRoom.innerHTML = '';
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.id = 'customRoomInput';
                    input.placeholder = 'Enter room name';
                    input.className = 'form-control mb-2';
                    input.maxLength = 32;
                    selectRoom.parentNode.insertBefore(input, selectRoom);
                    selectRoom.style.display = 'none';
                    // Show random button for admin
                    if (generateRoomBtn) generateRoomBtn.style.display = 'block';
                    // Join uses the custom input + token
                    joinSelectRoomBtn.onclick = () => {
                        const roomName = filterXSS(document.getElementById('customRoomInput').value);
                        const displayname = response.data.displayname;
                        if (roomName) {
                            window.location.href =
                                '/join/?room=' +
                                roomName +
                                '&name=' +
                                displayname +
                                '&token=' +
                                window.sessionStorage.peer_token;
                        } else {
                            popup('warning', 'Room name required');
                        }
                    };
                    return;
                }

                window.location.href = '/logged';
                return;
            })
            .catch(function (error) {
                console.error(error);
                popup('warning', 'Invalid credentials. Please try again.');
            });
        return;
    }
    if (!username && !password) {
        popup('warning', 'Username and Password required');
        return;
    }
    if (!username) {
        popup('warning', 'Username required');
        return;
    }
    if (!password) {
        popup('warning', 'Password required');
        return;
    }
}

function join() {
    const username = filterXSS(document.getElementById('username').value);
    const roomId = filterXSS(document.getElementById('selectRoom').value);
    window.location.href = '/join/?room=' + roomId + '&name=' + username + '&token=' + window.sessionStorage.peer_token;
}

function getUUID4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
}
