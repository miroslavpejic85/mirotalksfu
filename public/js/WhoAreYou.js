'use strict';

console.log(window.location);

const settings = JSON.parse(localStorage.getItem('SFU_SETTINGS')) || {};
console.log('Settings:', settings);

const pollInterval = 5000;

const pathParts = window.location.pathname.split('/');
const roomId = filterXSS(pathParts[pathParts.length - 1]);

const statusEl = document.getElementById('waitingStatus');
const loginLink = document.getElementById('loginLink');
const waitingRoomNameEl = document.getElementById('waitingRoomName');
const waitingRoomNameText = document.getElementById('waitingRoomNameText');
const waitingElapsedText = document.getElementById('waitingElapsedText');
const spinnerDots = document.querySelectorAll('.waiting-spinner-dot');

window.sessionStorage.roomID = roomId;

let intervalId = null;
let roomActive = false;
const waitStartTime = Date.now();
let elapsedTimerId = null;

if (roomId && roomId !== 'whoAreYou') {
    let displayName = roomId;
    try {
        displayName = decodeURIComponent(roomId);
    } catch (error) {
        // malformed percent-encoding: keep raw roomId as fallback
    }
    waitingRoomNameText.textContent = displayName;
    waitingRoomNameEl.style.display = 'inline-block';
}

function updateElapsedTime() {
    const seconds = Math.floor((Date.now() - waitStartTime) / 1000);
    if (seconds < 60) {
        waitingElapsedText.textContent = getWaitingRoomText('waitingRoomElapsedJust', 'Just started waiting');
    } else {
        const minutes = Math.floor(seconds / 60);
        const template = getWaitingRoomText('waitingRoomElapsedMinutes', 'Waiting for {minutes}');
        waitingElapsedText.textContent = template.replace('{minutes}', formatMinutes(minutes));
    }
}

// Unit in the UI language (e.g. "3 minuten" for nl). Stays English when Google Translate is
// allowed, since Google then translates the page from English.
function formatMinutes(minutes) {
    const i18n = window.i18n;
    const nativeLang = i18n && (i18n.googleAllowed === false || i18n.isNative?.()) ? i18n.getLang?.() : null;
    const lang = nativeLang || 'en';
    try {
        return new Intl.NumberFormat(lang, { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(minutes);
    } catch (e) {
        return minutes + (minutes === 1 ? ' minute' : ' minutes');
    }
}

// Show the configured text right away instead of the static HTML fallback until the first tick.
function onBrandReady(callback) {
    if (window.brandReady) return callback();
    document.addEventListener('brand:ready', () => callback(), { once: true });
}

onBrandReady(updateElapsedTime);
elapsedTimerId = setInterval(updateElapsedTime, 10000);

function getWaitingRoomBrand(key, fallback) {
    try {
        return (typeof BRAND !== 'undefined' && BRAND?.whoAreYou?.[key]) || fallback;
    } catch (e) {
        return fallback;
    }
}

// BRAND defaults are English: translate them like the static page; custom texts without a key stay as-is.
function getWaitingRoomText(key, fallback) {
    const text = getWaitingRoomBrand(key, fallback);
    return window.i18n?.t?.(text, 'labels') || text;
}

// Keeps the English source so I18n.js can re-translate the attribute on a live language switch.
function setTranslatedAttribute(element, attribute, source, namespace) {
    element[`__i18nAttr_${attribute}`] = source;
    element.setAttribute(attribute, window.i18n?.t?.(source, namespace) || source);
}

if (roomId && roomId !== 'whoAreYou') {
    loginLink.href = '/login?room=' + encodeURIComponent(roomId);
}

function playSound(name) {
    if (!settings.sounds) return;

    const soundSrc = `../sounds/${name}.wav`;
    const audio = new Audio(soundSrc);
    audio.volume = 0.5;

    audio.play().catch((err) => {
        console.error(`Error playing sound: ${err}`);
    });
}

function flashCheckingState() {
    spinnerDots.forEach((dot) => dot.classList.add('checking'));
    setTimeout(() => spinnerDots.forEach((dot) => dot.classList.remove('checking')), 600);
}

function checkRoom() {
    flashCheckingState();
    axios
        .post(`/isRoomActive?room=${encodeURIComponent(roomId)}`, { roomId: roomId }) // ?room= lets a load balancer route to the room's node
        .then(function (response) {
            const isActive = response.data.message;
            console.log('Room active status:', isActive);

            if (isActive && !roomActive) {
                roomActive = true;
                if (waitingAudio) {
                    waitingAudio.pause();
                    waitingAudio = null;
                }
                playSound('roomActive');
                statusEl.textContent = getWaitingRoomText('waitingRoomReady', 'Room is ready! Joining...');
                statusEl.classList.add('ready');
                setTimeout(function () {
                    window.location.href = '/join/' + encodeURIComponent(roomId);
                }, 800);
            } else if (!isActive) {
                statusEl.textContent = getWaitingRoomText(
                    'waitingRoomWaiting',
                    'Waiting for host to start the meeting...'
                );
                scheduleNextCheck();
            }
        })
        .catch(function () {
            statusEl.textContent = getWaitingRoomText('waitingRoomWaiting', 'Waiting for host to start the meeting...');
            scheduleNextCheck();
        });
}

function scheduleNextCheck() {
    if (intervalId) return;
    intervalId = setTimeout(function () {
        intervalId = null;
        if (document.visibilityState === 'visible') {
            checkRoom();
        } else {
            scheduleNextCheck();
        }
    }, pollInterval);
}

document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !roomActive) {
        checkRoom();
    }
});

// Waiting room audio player
const audioPlayerEl = document.getElementById('waitingAudioPlayer');
const audioBtn = document.getElementById('waitingAudioBtn');
const audioIcon = document.getElementById('waitingAudioIcon');
const audioMuteBtn = document.getElementById('waitingAudioMute');
const audioMuteIcon = document.getElementById('waitingAudioMuteIcon');
const audioProgress = document.getElementById('waitingAudioProgress');

let waitingAudio = null;
let audioPlaying = false;

function initWaitingAudio() {
    const songUrl = getWaitingRoomBrand('waitingRoomSongUrl', '');
    if (!songUrl || !audioPlayerEl) return;

    waitingAudio = new Audio(songUrl);
    waitingAudio.loop = true;
    waitingAudio.volume = 0.3;
    waitingAudio.preload = 'auto';

    waitingAudio.addEventListener('error', function () {
        console.warn('Waiting room audio failed to load:', songUrl);
        audioPlayerEl.style.display = 'none';
        waitingAudio = null;
    });

    waitingAudio.addEventListener(
        'canplaythrough',
        function () {
            audioPlayerEl.style.display = 'flex';
        },
        { once: true }
    );

    waitingAudio.addEventListener('timeupdate', function () {
        if (waitingAudio.duration) {
            const pct = (waitingAudio.currentTime / waitingAudio.duration) * 100;
            audioProgress.style.width = pct + '%';
        }
    });

    audioBtn.onclick = function () {
        if (audioPlaying) {
            waitingAudio.pause();
            audioIcon.className = 'fa-solid fa-play';
            setTranslatedAttribute(audioBtn, 'title', 'Play music', 'buttons');
        } else {
            waitingAudio.play().catch(function (err) {
                console.warn('Audio play blocked:', err.message);
            });
            audioIcon.className = 'fa-solid fa-pause';
            setTranslatedAttribute(audioBtn, 'title', 'Pause music', 'buttons');
        }
        audioPlaying = !audioPlaying;
    };

    audioMuteBtn.onclick = function () {
        waitingAudio.muted = !waitingAudio.muted;
        audioMuteIcon.className = waitingAudio.muted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high';
        setTranslatedAttribute(audioMuteBtn, 'title', waitingAudio.muted ? 'Unmute' : 'Mute', 'buttons');
    };
}

// Wait for Brand.js to load before initializing audio
setTimeout(initWaitingAudio, 1000);

checkRoom();
