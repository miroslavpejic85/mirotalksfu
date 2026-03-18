'use strict';

console.log(window.location);

const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginButton');
const loginBtnText = document.getElementById('loginBtnText');
const loginBtnLoader = document.getElementById('loginBtnLoader');
const loginIconEl = document.getElementById('loginIconEl');

const joinRoomForm = document.getElementById('joinRoomForm');
const selectRoom = document.getElementById('selectRoom');
const joinSelectRoomBtn = document.getElementById('joinSelectRoomButton');
const generateRoomBtn = document.getElementById('generateRoomButton');

const togglePasswordBtn = document.getElementById('togglePassword');
if (togglePasswordBtn) {
    togglePasswordBtn.onclick = () => {
        const isPassword = passwordInput.type === 'password';
        passwordInput.type = isPassword ? 'text' : 'password';
        togglePasswordBtn.querySelector('i').className = isPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
        togglePasswordBtn.title = isPassword ? 'Hide password' : 'Show password';
    };
}

function setLoginLoading(loading) {
    loginBtn.disabled = loading;
    loginBtnText.style.display = loading ? 'none' : 'inline';
    loginBtnLoader.classList.toggle('show', loading);
    if (loading) {
        loginBtn.classList.remove('pulse');
    } else {
        loginBtn.classList.add('pulse');
    }
}

function showJoinRoomForm() {
    loginForm.style.opacity = '0';
    loginForm.style.transform = 'translateY(-10px)';
    setTimeout(() => {
        loginForm.style.display = 'none';
        joinRoomForm.classList.add('show');
        joinRoomForm.style.opacity = '0';
        joinRoomForm.style.transform = 'translateY(10px)';
        requestAnimationFrame(() => {
            joinRoomForm.style.opacity = '1';
            joinRoomForm.style.transform = 'translateY(0)';
        });
    }, 250);
}

joinSelectRoomBtn.onclick = (e) => {
    join();
};

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

const shareRoomBtn = document.getElementById('shareRoomButton');
if (shareRoomBtn) {
    shareRoomBtn.onclick = (e) => {
        e.preventDefault();
        const custom = document.getElementById('customRoomInput');
        const roomName =
            custom && custom.offsetParent !== null
                ? filterXSS(custom.value.trim())
                : selectRoom
                  ? filterXSS(selectRoom.value.trim())
                  : '';
        if (!roomName) {
            const inputEl = custom && custom.offsetParent !== null ? custom : selectRoom;
            if (inputEl) highlightEmpty(inputEl);
            return;
        }
        const roomUrl = window.location.origin + '/join/?room=' + roomName;
        if (navigator.share) {
            navigator.share({ title: 'Join my room', url: roomUrl }).catch(() => {});
        } else {
            navigator.clipboard
                .writeText(roomUrl)
                .then(() => popup('success', 'Room link copied to clipboard!'))
                .catch(() => popup('warning', 'Failed to copy link'));
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
        setLoginLoading(true);
        hideLoginError();

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
                    allowedRooms.forEach((room) => {
                        const option = document.createElement('option');
                        option.value = room;
                        option.text = room;
                        selectRoom.appendChild(option);
                    });
                    // Hide random button for limited users
                    if (generateRoomBtn) generateRoomBtn.style.display = 'none';
                    showJoinRoomForm();
                    return;
                }

                // Admin (all rooms)
                if (allowedRooms && allowedRooms.includes('*')) {
                    console.log('User detected with admin access!', allowedRooms);
                    selectRoom.innerHTML = '';
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.id = 'customRoomInput';
                    input.placeholder = 'Enter room name';
                    input.className = 'form-input';
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
                            window.localStorage.peer_name = displayname;
                            window.location.href =
                                '/join/?room=' + roomName + '&token=' + window.sessionStorage.peer_token;
                        } else {
                            highlightEmpty(document.getElementById('customRoomInput'));
                        }
                    };
                    showJoinRoomForm();
                    return;
                }

                const sessionRoom = window.sessionStorage.roomID;
                window.location.href = room
                    ? '/logged?room=' + room
                    : sessionRoom
                      ? '/logged?room=' + sessionRoom
                      : '/logged';
                return;
            })
            .catch(function (error) {
                console.error(error);
                setLoginLoading(false);
                if (error.response && error.response.status === 429) {
                    const msg = error.response.data?.message || 'Too many login attempts. Please try again later.';
                    showLoginError(msg);
                } else {
                    showLoginError('Invalid credentials. Please try again.');
                }
            });
        return;
    }
    if (!username && !password) {
        highlightEmpty(usernameInput);
        highlightEmpty(passwordInput);
        return;
    }
    if (!username) {
        highlightEmpty(usernameInput);
        return;
    }
    if (!password) {
        highlightEmpty(passwordInput);
        return;
    }
}

function highlightEmpty(input) {
    const group = input.closest('.login-input-group');
    if (!group) return;
    group.classList.remove('input-error');
    void group.offsetWidth; // force reflow to restart animation
    group.classList.add('input-error');
    input.focus();
    function clearError() {
        group.classList.remove('input-error');
        input.removeEventListener('input', clearError);
        input.removeEventListener('change', clearError);
        input.removeEventListener('blur', clearError);
    }
    input.addEventListener('input', clearError);
    input.addEventListener('change', clearError);
    input.addEventListener('blur', clearError);
}

function showLoginError(msg) {
    const el = document.getElementById('loginError');
    const text = document.getElementById('loginErrorText');
    if (!el || !text) return;
    text.textContent = msg;
    el.classList.add('show');
}

function hideLoginError() {
    const el = document.getElementById('loginError');
    if (el) el.classList.remove('show');
}

function join() {
    const username = filterXSS(document.getElementById('username').value);
    const roomId = filterXSS(document.getElementById('selectRoom').value);
    window.localStorage.peer_name = username;
    window.location.href = '/join/?room=' + roomId + '&token=' + window.sessionStorage.peer_token;
}

function getUUID4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
}
