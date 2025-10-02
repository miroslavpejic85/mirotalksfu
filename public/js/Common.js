'use strict';

let autoFillRoomName = true;

if (window.MiroTalkAutoFillRoomName === false) {
    autoFillRoomName = false;
} else {
    try {
        const brandData = window.sessionStorage.getItem('brandData');
        if (brandData) {
            const parsedBrand = JSON.parse(brandData);
            if (parsedBrand?.app?.autoFillRoomName === false) {
                autoFillRoomName = false;
            }
        }
    } catch (error) {
        console.warn('Unable to determine autoFillRoomName preference from brand data.', error);
    }
}

window.MiroTalkAutoFillRoomName = autoFillRoomName;

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js');
    });
}

const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
if (autoFillRoomName && isStandalone && window.localStorage.lastRoom && window.location.pathname === '/') {
    window.location.href = '/join/?room=' + window.localStorage.lastRoom;
}

// ####################################################################
// NEW ROOM
// ####################################################################

const roomName = document.getElementById('roomName');

if (roomName) {
    roomName.value = '';

    const storedRoomId = window.sessionStorage.getItem('roomID');

    if (storedRoomId && storedRoomId !== 'false') {
        window.sessionStorage.removeItem('roomID');

        if (autoFillRoomName) {
            roomName.value = storedRoomId;
            joinRoom();
        }
    }

    roomName.onkeyup = (e) => {
        if (e.keyCode === 13) {
            e.preventDefault();
            joinRoom();
        }
    };
}

// ####################################################################
// LANDING | NEW ROOM
// ####################################################################

const lastRoomContainer = document.getElementById('lastRoomContainer');
const lastRoom = document.getElementById('lastRoom');
const lastRoomName = autoFillRoomName && window.localStorage.lastRoom ? window.localStorage.lastRoom : '';

if (lastRoomContainer && lastRoom && lastRoomName) {
    lastRoomContainer.style.display = 'inline-flex';
    lastRoom.setAttribute('href', '/join/?room=' + lastRoomName);
    lastRoom.innerText = lastRoomName;
}

const genRoomButton = document.getElementById('genRoomButton');
const joinRoomButton = document.getElementById('joinRoomButton');
const adultCnt = document.getElementById('adultCnt');

if (genRoomButton) {
    genRoomButton.onclick = () => {
        genRoom();
    };
}

if (joinRoomButton) {
    joinRoomButton.onclick = () => {
        joinRoom();
    };
}

if (adultCnt) {
    adultCnt.onclick = () => {
        adultContent();
    };
}

function genRoom() {
    document.getElementById('roomName').value = getUUID4();
}

function getUUID4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
}

function joinRoom() {
    const roomName = filterXSS(document.getElementById('roomName').value).trim().replace(/\s+/g, '-');
    const roomValid = isValidRoomName(roomName);

    if (!roomValid) return;

    //window.location.href = '/join/' + roomName;
    window.location.href = '/join/?room=' + roomName;
    if (autoFillRoomName) {
        window.localStorage.lastRoom = roomName;
    } else {
        window.localStorage.removeItem('lastRoom');
    }
}

function isValidRoomName(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }

    if (!input || ['false', 'undefined', ''].includes(input.trim().toLowerCase())) {
        return false;
    }

    const pathTraversalPattern = /(\.\.(\/|\\))+/;
    return !pathTraversalPattern.test(input);
}

function adultContent() {
    if (
        confirm(
            '18+ WARNING! ADULTS ONLY!\n\nExplicit material for viewing by adults 18 years of age or older. You must be at least 18 years old to access to this site!\n\nProceeding you are agree and confirm to have 18+ year.'
        )
    ) {
        window.open('https://luvlounge.ca', '_blank');
    }
}

// #########################################################
// PERMISSIONS
// #########################################################

const qs = new URLSearchParams(window.location.search);
const room_id = filterXSS(qs.get('room_id'));
const message = filterXSS(qs.get('message'));
const showMessage = document.getElementById('message');
console.log('Allow Camera or Audio', {
    room_id: room_id,
    message: message,
});
if (showMessage) showMessage.innerHTML = message;
