'use strict';

let autoFillRoomName = false;

if (window.MiroTalkAutoFillRoomName === true) {
    autoFillRoomName = true;
} else {
    try {
        const brandData = window.sessionStorage.getItem('brandData');
        if (brandData) {
            const parsedBrand = JSON.parse(brandData);
            if (parsedBrand?.app?.autoFillRoomName === true) {
                autoFillRoomName = true;
            }
        }
    } catch (error) {
        console.warn('Unable to determine autoFillRoomName preference from brand data.', error);
    }
}

window.MiroTalkAutoFillRoomName = autoFillRoomName;

const urlParams = new URLSearchParams(window.location.search);

// ####################################################################
// NEW ROOM
// ####################################################################

const roomNameInput = document.getElementById('roomName');

if (roomNameInput) {
    roomNameInput.value = '';

    const roomFromQuery = getRoomFromQuery();
    if (roomFromQuery) {
        roomNameInput.value = roomFromQuery;
        roomNameInput.placeholder = '';
        roomNameInput.dataset.suggested = '';
    } else {
        setRoomSuggestion(getUUID4());
    }

    roomNameInput.addEventListener('input', handleRoomNameInputChange);

    const storedRoomId = window.sessionStorage.getItem('roomID');

    if (storedRoomId && storedRoomId !== 'false') {
        window.sessionStorage.removeItem('roomID');

        if (autoFillRoomName) {
            roomNameInput.value = storedRoomId;
            joinRoom();
        }
    }

    roomNameInput.onkeyup = (e) => {
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

function setRoomSuggestion(suggestedRoom) {
    if (!roomNameInput || !suggestedRoom) {
        if (roomNameInput && !suggestedRoom) {
            roomNameInput.dataset.suggested = '';
        }
        return;
    }

    roomNameInput.placeholder = suggestedRoom;
    roomNameInput.dataset.suggested = suggestedRoom;
}

function handleRoomNameInputChange() {
    if (!roomNameInput) {
        return;
    }

    if (roomNameInput.value.trim() === '' && !roomNameInput.dataset?.suggested) {
        setRoomSuggestion(getUUID4());
    }
}

function genRoom() {
    const suggestedRoom = getUUID4();
    setRoomSuggestion(suggestedRoom);
}

function getUUID4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
}

function normalizeRoomName(input) {
    if (!input || typeof input !== 'string') {
        return '';
    }

    return input.trim().replace(/\s+/g, '-');
}

function getRoomFromQuery() {
    const room = urlParams.get('room');
    if (!room) {
        return '';
    }

    return normalizeRoomName(filterXSS(room));
}

function joinRoom() {
    if (!roomNameInput) {
        return;
    }

    let room = normalizeRoomName(filterXSS(roomNameInput.value));

    if (!room) {
        const suggestedRoom = roomNameInput.dataset?.suggested
            ? normalizeRoomName(filterXSS(roomNameInput.dataset.suggested))
            : '';
        room = suggestedRoom;
    }

    const roomValid = isValidRoomName(room);

    if (!roomValid) return;

    //window.location.href = '/join/' + room;
    window.location.href = '/join/?room=' + room;
    if (autoFillRoomName) {
        window.localStorage.lastRoom = room;
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

const room_id = filterXSS(urlParams.get('room_id'));
const message = filterXSS(urlParams.get('message'));
const showMessage = document.getElementById('message');
console.log('Allow Camera or Audio', {
    room_id: room_id,
    message: message,
});
if (showMessage) showMessage.innerHTML = message;
