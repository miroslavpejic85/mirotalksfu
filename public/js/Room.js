'use strict';

if (location.href.substr(0, 5) !== 'https') location.href = 'https' + location.href.substr(4, location.href.length - 4);

/**
 * MiroTalk SFU - Room component
 *
 * @link    GitHub: https://github.com/miroslavpejic85/mirotalksfu
 * @link    Official Live demo: https://sfu.mirotalk.com
 * @license For open source use: AGPLv3
 * @license For commercial or closed source, contact us at license.mirotalk@gmail.com or purchase directly via CodeCanyon
 * @license CodeCanyon: https://codecanyon.net/item/mirotalk-sfu-webrtc-realtime-video-conferences/40769970
 * @author  Miroslav Pejic - miroslav.pejic.85@gmail.com
 * @version 1.3.96
 *
 */

// ####################################################
// STATIC SETTINGS
// ####################################################

console.log('Window Location', window.location);

const socket = io({ transports: ['websocket'] });

let survey = {
    enabled: true,
    url: 'https://www.questionpro.com/t/AUs7VZq02P',
};

let redirect = {
    enabled: true,
    url: '/newroom',
};

let recCodecs = null;
let recPrioritizeH264 = false;

const _PEER = {
    presenter: '<i class="fa-solid fa-user-shield"></i>',
    guest: '<i class="fa-solid fa-signal"></i>',
    audioOn: '<i class="fas fa-microphone"></i>',
    audioOff: '<i style="color: red;" class="fas fa-microphone-slash"></i>',
    videoOn: '<i class="fas fa-video"></i>',
    videoOff: '<i style="color: red;" class="fas fa-video-slash"></i>',
    screenOn: '<i class="fas fa-desktop"></i>',
    screenOff: '<i style="color: red;" class="fas fa-desktop"></i>',
    raiseHand: '<i style="color: rgb(0, 255, 71);" class="fas fa-hand-paper pulsate"></i>',
    lowerHand: '',
    acceptPeer: '<i class="fas fa-check"></i>',
    banPeer: '<i class="fas fa-ban"></i>',
    ejectPeer: '<i class="fas fa-times"></i>',
    geoLocation: '<i class="fas fa-location-dot"></i>',
    sendFile: '<i class="fas fa-upload"></i>',
    sendMsg: '<i class="fas fa-paper-plane"></i>',
    sendVideo: '<i class="fab fa-youtube"></i>',
};

const initUser = document.getElementById('initUser');
const initVideoContainerClass = document.querySelector('.init-video-container');
const bars = document.querySelectorAll('.volume-bar');

const userAgent = navigator.userAgent.toLowerCase();
const isTabletDevice = isTablet(userAgent);
const isIPadDevice = isIpad(userAgent);

const Base64Prefix = 'data:application/pdf;base64,';

const wbImageInput = 'image/*';
const wbPdfInput = 'application/pdf';
const wbWidth = 1200;
const wbHeight = 600;

const swalImageUrl = '../images/pricing-illustration.svg';

// Media
const sinkId = 'sinkId' in HTMLMediaElement.prototype;

// ####################################################
// LOCAL STORAGE
// ####################################################

const lS = new LocalStorage();

const localStorageSettings = lS.getLocalStorageSettings() || lS.SFU_SETTINGS;

const localStorageDevices = lS.getLocalStorageDevices() || lS.LOCAL_STORAGE_DEVICES;

const localStorageInitConfig = lS.getLocalStorageInitConfig() || lS.INIT_CONFIG;

console.log('LOCAL_STORAGE', {
    localStorageSettings: localStorageSettings,
    localStorageDevices: localStorageDevices,
    localStorageInitConfig: localStorageInitConfig,
});

// ####################################################
// THEME CUSTOM COLOR - PICKER
// ####################################################

const themeCustom = {
    input: document.getElementById('themeColorPicker'),
    color: localStorageSettings.theme_color ? localStorageSettings.theme_color : '#000000',
    keep: localStorageSettings.theme_custom ? localStorageSettings.theme_custom : false,
};

const pickr = Pickr.create({
    el: themeCustom.input,
    theme: 'classic', // or 'monolith', or 'nano'
    default: themeCustom.color,
    useAsButton: true,

    swatches: [
        'rgba(244, 67, 54, 1)',
        'rgba(233, 30, 99, 0.95)',
        'rgba(156, 39, 176, 0.9)',
        'rgba(103, 58, 183, 0.85)',
        'rgba(63, 81, 181, 0.8)',
        'rgba(33, 150, 243, 0.75)',
        'rgba(3, 169, 244, 0.7)',
        'rgba(0, 188, 212, 0.7)',
        'rgba(0, 150, 136, 0.75)',
        'rgba(76, 175, 80, 0.8)',
        'rgba(139, 195, 74, 0.85)',
        'rgba(205, 220, 57, 0.9)',
        'rgba(255, 235, 59, 0.95)',
        'rgba(255, 193, 7, 1)',
    ],

    components: {
        // Main components
        preview: true,
        opacity: true,
        hue: true,

        // Input / output Options
        interaction: {
            hex: false,
            rgba: false,
            hsla: false,
            hsva: false,
            cmyk: false,
            input: false,
            clear: false,
            save: false,
        },
    },
})
    .on('init', (pickr) => {
        themeCustom.input.value = pickr.getSelectedColor().toHEXA().toString(0);
    })
    .on('change', (color) => {
        themeCustom.color = color.toHEXA().toString();
        themeCustom.input.value = themeCustom.color;
        setCustomTheme();
    })
    .on('changestop', (color) => {
        localStorageSettings.theme_color = themeCustom.color;
        lS.setSettings(localStorageSettings);
    });

// ####################################################
// ENUMERATE DEVICES SELECTS
// ####################################################

const videoSelect = getId('videoSelect');
const initVideoSelect = getId('initVideoSelect');
const microphoneSelect = getId('microphoneSelect');
const initMicrophoneSelect = getId('initMicrophoneSelect');
const speakerSelect = getId('speakerSelect');
const initSpeakerSelect = getId('initSpeakerSelect');

// ####################################################
// DYNAMIC SETTINGS
// ####################################################

let swalBackground = 'radial-gradient(#393939, #000000)'; //'rgba(0, 0, 0, 0.7)';

let rc = null;
let producer = null;
let participantsCount = 0;
let lobbyParticipantsCount = 0;
let chatMessagesId = 0;

let room_id = getRoomId();
let room_password = getRoomPassword();
let peer_name = getPeerName();
let peer_uuid = getPeerUUID();
let peer_token = getPeerToken();
let isScreenAllowed = getScreen();
let isHideMeActive = getHideMeActive();
let notify = getNotify();
isPresenter = isPeerPresenter();

let peer_info = null;

let isPushToTalkActive = false;
let isSpaceDown = false;
let isPitchBarEnabled = true;
let isSoundEnabled = true;
let isBroadcastingEnabled = false;
let isLobbyEnabled = false;
let isLobbyOpen = false;
let hostOnlyRecording = false;
let isEnumerateAudioDevices = false;
let isEnumerateVideoDevices = false;
let isAudioAllowed = false;
let isVideoAllowed = false;
let isVideoPrivacyActive = false;
let isRecording = false;
let isAudioVideoAllowed = false;
let isParticipantsListOpen = false;
let isVideoControlsOn = false;
let isChatPasteTxt = false;
let isChatMarkdownOn = false;
let isChatGPTOn = false;
let isSpeechSynthesisSupported = 'speechSynthesis' in window;
let joinRoomWithoutAudioVideo = true;
let joinRoomWithScreen = false;

let recTimer = null;
let recElapsedTime = null;

let wbCanvas = null;
let wbIsLock = false;
let wbIsDrawing = false;
let wbIsOpen = false;
let wbIsRedoing = false;
let wbIsEraser = false;
let wbIsBgTransparent = false;
let wbPop = [];
let coords = {};

let isButtonsVisible = false;
let isButtonsBarOver = false;

let isRoomLocked = false;

let initStream = null;

let scriptProcessor = null;

const RoomURL = window.location.origin + '/join/' + room_id; // window.location.origin + '/join/?room=' + roomId + '&token=' + myToken

let transcription;

// ####################################################
// INIT ROOM
// ####################################################

function initClient() {
    setTheme();

    // Transcription
    transcription = new Transcription();
    transcription.init();

    if (!DetectRTC.isMobileDevice) {
        refreshMainButtonsToolTipPlacement();
        setTippy('closeEmojiPickerContainer', 'Close', 'bottom');
        setTippy('mySettingsCloseBtn', 'Close', 'bottom');
        setTippy(
            'switchPushToTalk',
            'If Active, When SpaceBar keydown the microphone will be resumed, on keyup will be paused, like a walkie-talkie.',
            'right',
        );
        setTippy('lobbyAcceptAllBtn', 'Accept', 'top');
        setTippy('lobbyRejectAllBtn', 'Reject', 'top');
        setTippy(
            'switchBroadcasting',
            'Broadcasting is the dissemination of audio or video content to a large audience (one to many)',
            'right',
        );
        setTippy(
            'switchLobby',
            'Lobby mode lets you protect your meeting by only allowing people to enter after a formal approval by a moderator',
            'right',
        );
        setTippy('initVideoAudioRefreshButton', 'Refresh audio/video devices', 'top');
        setTippy('switchPitchBar', 'Toggle audio pitch bar', 'right');
        setTippy('switchSounds', 'Toggle the sounds notifications', 'right');
        setTippy('switchShare', "Show 'Share Room' popup on join", 'right');
        setTippy('roomId', 'Room name (click to copy)', 'right');
        setTippy('sessionTime', 'Session time', 'right');
        setTippy('recordingImage', 'Toggle recording', 'right');
        setTippy(
            'switchHostOnlyRecording',
            'Only the host (presenter) has the capability to record the meeting',
            'right',
        );
        setTippy(
            'switchH264Recording',
            'Prioritize h.264 with AAC or h.264 with Opus codecs over VP8 with Opus or VP9 with Opus codecs',
            'right',
        );
        setTippy('switchServerRecording', 'The recording will be stored on the server rather than locally', 'right');
        setTippy('whiteboardGhostButton', 'Toggle transparent background', 'bottom');
        setTippy('wbBackgroundColorEl', 'Background color', 'bottom');
        setTippy('wbDrawingColorEl', 'Drawing color', 'bottom');
        setTippy('whiteboardPencilBtn', 'Drawing mode', 'bottom');
        setTippy('whiteboardObjectBtn', 'Object mode', 'bottom');
        setTippy('whiteboardUndoBtn', 'Undo', 'bottom');
        setTippy('whiteboardRedoBtn', 'Redo', 'bottom');
        setTippy('whiteboardImgFileBtn', 'Add image file', 'bottom');
        setTippy('whiteboardPdfFileBtn', 'Add pdf file', 'bottom');
        setTippy('whiteboardImgUrlBtn', 'Add image url', 'bottom');
        setTippy('whiteboardTextBtn', 'Add text', 'bottom');
        setTippy('whiteboardLineBtn', 'Add line', 'bottom');
        setTippy('whiteboardRectBtn', 'Add rectangle', 'bottom');
        setTippy('whiteboardTriangleBtn', 'Add triangle', 'bottom');
        setTippy('whiteboardCircleBtn', 'Add circle', 'bottom');
        setTippy('whiteboardSaveBtn', 'Save', 'bottom');
        setTippy('whiteboardEraserBtn', 'Eraser', 'bottom');
        setTippy('whiteboardCleanBtn', 'Clean', 'bottom');
        setTippy('whiteboardLockButton', 'If enabled, participants cannot interact', 'right');
        setTippy('whiteboardCloseBtn', 'Close', 'right');
        setTippy('chatCleanTextButton', 'Clean', 'top');
        setTippy('chatPasteButton', 'Paste', 'top');
        setTippy('chatSendButton', 'Send', 'top');
        setTippy('showChatOnMsg', 'Show chat on new message comes', 'bottom');
        setTippy('speechIncomingMsg', 'Speech the incoming messages', 'bottom');
        setTippy('chatSpeechStartButton', 'Start speech recognition', 'top');
        setTippy('chatSpeechStopButton', 'Stop speech recognition', 'top');
        setTippy('chatEmojiButton', 'Emoji', 'top');
        setTippy('chatMarkdownButton', 'Markdown', 'top');
        setTippy('chatCloseButton', 'Close', 'bottom');
        setTippy('chatTogglePin', 'Toggle pin', 'bottom');
        setTippy('chatHideParticipantsList', 'Hide', 'bottom');
        setTippy('chatShowParticipantsList', 'Toggle participants list', 'bottom');
        setTippy('chatMaxButton', 'Maximize', 'bottom');
        setTippy('chatMinButton', 'Minimize', 'bottom');
        setTippy('participantsSaveBtn', 'Save participants info', 'bottom');
        setTippy('participantsRaiseHandBtn', 'Toggle raise hands', 'bottom');
        setTippy('participantsUnreadMessagesBtn', 'Toggle unread messages', 'bottom');
        setTippy('transcriptionCloseBtn', 'Close', 'bottom');
        setTippy('transcriptionTogglePinBtn', 'Toggle pin', 'bottom');
        setTippy('transcriptionMaxBtn', 'Maximize', 'bottom');
        setTippy('transcriptionMinBtn', 'Minimize', 'bottom');
        setTippy('transcriptionSpeechStatus', 'Status', 'bottom');
        setTippy('transcriptShowOnMsg', 'Show transcript on new message comes', 'bottom');
        setTippy('transcriptPersistentMode', 'Prevent stopping in the absence of speech', 'bottom');
        setTippy('transcriptionSpeechStart', 'Start transcription', 'top');
        setTippy('transcriptionSpeechStop', 'Stop transcription', 'top');
    }
    setupWhiteboard();
    initEnumerateDevices();
}

// ####################################################
// HANDLE MAIN BUTTONS TOOLTIP
// ####################################################

function refreshMainButtonsToolTipPlacement() {
    if (!DetectRTC.isMobileDevice) {
        const placement = BtnsBarPosition.options[BtnsBarPosition.selectedIndex].value == 'vertical' ? 'right' : 'top';
        setTippy('shareButton', 'Share room', placement);
        setTippy('hideMeButton', 'Toggle hide self view', placement);
        setTippy('startAudioButton', 'Start the audio', placement);
        setTippy('stopAudioButton', 'Stop the audio', placement);
        setTippy('startVideoButton', 'Start the video', placement);
        setTippy('stopVideoButton', 'Stop the video', placement);
        setTippy('startScreenButton', 'Start screen share', placement);
        setTippy('stopScreenButton', 'Stop screen share', placement);
        setTippy('startRecButton', 'Start recording', placement);
        setTippy('stopRecButton', 'Stop recording', placement);
        setTippy('raiseHandButton', 'Raise your hand', placement);
        setTippy('lowerHandButton', 'Lower your hand', placement);
        setTippy('emojiRoomButton', 'Toggle emoji reaction', placement);
        setTippy('swapCameraButton', 'Swap the camera', placement);
        setTippy('chatButton', 'Toggle the chat', placement);
        setTippy('transcriptionButton', 'Toggle transcription', placement);
        setTippy('whiteboardButton', 'Toggle the whiteboard', placement);
        setTippy('settingsButton', 'Toggle the settings', placement);
        setTippy('aboutButton', 'About this project', placement);
        setTippy('exitButton', 'Leave room', placement);
    }
}

// ####################################################
// HANDLE TOOLTIP
// ####################################################

function setTippy(elem, content, placement, allowHTML = false) {
    const element = document.getElementById(elem);
    if (element) {
        if (element._tippy) {
            element._tippy.destroy();
        }
        tippy(element, {
            content: content,
            placement: placement,
            allowHTML: allowHTML,
        });
    } else {
        console.warn('setTippy element not found with content', content);
    }
}

// ####################################################
// GET ROOM ID
// ####################################################

function getRoomId() {
    let qs = new URLSearchParams(window.location.search);
    let queryRoomId = filterXSS(qs.get('room'));
    let roomId = queryRoomId ? queryRoomId : location.pathname.substring(6);
    if (roomId == '') {
        roomId = makeId(12);
    }
    console.log('Direct join', { room: roomId });
    window.localStorage.lastRoom = roomId;
    return roomId;
}

function makeId(length) {
    let result = '';
    let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

// ####################################################
// INIT ROOM
// ####################################################

async function initRoom() {
    if (!isAudioAllowed && !isVideoAllowed && !joinRoomWithoutAudioVideo) {
        openURL(`/permission?room_id=${room_id}&message=Not allowed both Audio and Video`);
    } else {
        setButtonsInit();
        handleSelectsInit();
        await whoAreYou();
        await setSelectsInit();
    }
}

// ####################################################
// ENUMERATE DEVICES
// ####################################################

async function initEnumerateDevices() {
    console.log('01 ----> init Enumerate Devices');
    await initEnumerateVideoDevices();
    await initEnumerateAudioDevices();
    await initRoom();
}

async function refreshMyAudioVideoDevices() {
    await refreshMyVideoDevices();
    await refreshMyAudioDevices();
}

async function refreshMyVideoDevices() {
    if (!isVideoAllowed) return;
    const initVideoSelectIndex = initVideoSelect ? initVideoSelect.selectedIndex : 0;
    const videoSelectIndex = videoSelect ? videoSelect.selectedIndex : 0;
    await initEnumerateVideoDevices();
    if (initVideoSelect) initVideoSelect.selectedIndex = initVideoSelectIndex;
    if (videoSelect) videoSelect.selectedIndex = videoSelectIndex;
}

async function refreshMyAudioDevices() {
    if (!isAudioAllowed) return;
    const initMicrophoneSelectIndex = initMicrophoneSelect ? initMicrophoneSelect.selectedIndex : 0;
    const initSpeakerSelectIndex = initSpeakerSelect ? initSpeakerSelect.selectedIndex : 0;
    const microphoneSelectIndex = microphoneSelect ? microphoneSelect.selectedIndex : 0;
    const speakerSelectIndex = speakerSelect ? speakerSelect.selectedIndex : 0;
    await initEnumerateAudioDevices();
    if (initMicrophoneSelect) initMicrophoneSelect.selectedIndex = initMicrophoneSelectIndex;
    if (initSpeakerSelect) initSpeakerSelect.selectedIndex = initSpeakerSelectIndex;
    if (microphoneSelect) microphoneSelect.selectedIndex = microphoneSelectIndex;
    if (speakerSelect) speakerSelect.selectedIndex = speakerSelectIndex;
}

async function initEnumerateVideoDevices() {
    // allow the video
    await navigator.mediaDevices
        .getUserMedia({ video: true })
        .then(async (stream) => {
            await enumerateVideoDevices(stream);
            isVideoAllowed = true;
        })
        .catch(() => {
            isVideoAllowed = false;
        });
}

async function enumerateVideoDevices(stream) {
    console.log('02 ----> Get Video Devices');

    if (videoSelect) videoSelect.innerHTML = '';
    if (initVideoSelect) initVideoSelect.innerHTML = '';

    await navigator.mediaDevices
        .enumerateDevices()
        .then((devices) =>
            devices.forEach(async (device) => {
                let el,
                    eli = null;
                if ('videoinput' === device.kind) {
                    if (videoSelect) el = videoSelect;
                    if (initVideoSelect) eli = initVideoSelect;
                    lS.DEVICES_COUNT.video++;
                }
                if (!el) return;
                await addChild(device, [el, eli]);
            }),
        )
        .then(async () => {
            await stopTracks(stream);
            isEnumerateVideoDevices = true;
        });
}

async function initEnumerateAudioDevices() {
    // allow the audio
    await navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then(async (stream) => {
            await enumerateAudioDevices(stream);
            await getMicrophoneVolumeIndicator(stream);
            isAudioAllowed = true;
        })
        .catch(() => {
            isAudioAllowed = false;
        });
}

async function enumerateAudioDevices(stream) {
    console.log('03 ----> Get Audio Devices');

    if (microphoneSelect) microphoneSelect.innerHTML = '';
    if (initMicrophoneSelect) initMicrophoneSelect.innerHTML = '';

    if (speakerSelect) speakerSelect.innerHTML = '';
    if (initSpeakerSelect) initSpeakerSelect.innerHTML = '';

    await navigator.mediaDevices
        .enumerateDevices()
        .then((devices) =>
            devices.forEach(async (device) => {
                let el,
                    eli = null;
                if ('audioinput' === device.kind) {
                    if (microphoneSelect) el = microphoneSelect;
                    if (initMicrophoneSelect) eli = initMicrophoneSelect;
                    lS.DEVICES_COUNT.audio++;
                } else if ('audiooutput' === device.kind) {
                    if (speakerSelect) el = speakerSelect;
                    if (initSpeakerSelect) eli = initSpeakerSelect;
                    lS.DEVICES_COUNT.speaker++;
                }
                if (!el) return;
                await addChild(device, [el, eli]);
            }),
        )
        .then(async () => {
            await stopTracks(stream);
            isEnumerateAudioDevices = true;
            speakerSelect.disabled = !sinkId;
            // Check if there is speakers
            if (!sinkId || initSpeakerSelect.options.length === 0) {
                hide(initSpeakerSelect);
                hide(speakerSelectDiv);
            }
        });
}

async function stopTracks(stream) {
    stream.getTracks().forEach((track) => {
        track.stop();
    });
}

async function addChild(device, els) {
    let kind = device.kind;
    els.forEach((el) => {
        let option = document.createElement('option');
        option.value = device.deviceId;
        switch (kind) {
            case 'videoinput':
                option.innerText = `📹 ` + device.label || `📹 camera ${el.length + 1}`;
                break;
            case 'audioinput':
                option.innerText = `🎤 ` + device.label || `🎤 microphone ${el.length + 1}`;
                break;
            case 'audiooutput':
                option.innerText = `🔈 ` + device.label || `🔈 speaker ${el.length + 1}`;
                break;
            default:
                break;
        }
        el.appendChild(option);
    });
}

// ####################################################
// MICROPHONE VOLUME INDICATOR
// ####################################################

async function getMicrophoneVolumeIndicator(stream) {
    if (isAudioContextSupported() && hasAudioTrack(stream)) {
        stopMicrophoneProcessing();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const microphone = audioContext.createMediaStreamSource(stream);
        scriptProcessor = audioContext.createScriptProcessor(1024, 1, 1);
        scriptProcessor.onaudioprocess = function (event) {
            const inputBuffer = event.inputBuffer.getChannelData(0);
            let sum = 0;
            for (let i = 0; i < inputBuffer.length; i++) {
                sum += inputBuffer[i] * inputBuffer[i];
            }
            const rms = Math.sqrt(sum / inputBuffer.length);
            const volume = Math.max(0, Math.min(1, rms * 10));
            updateVolumeIndicator(volume);
        };
        microphone.connect(scriptProcessor);
        scriptProcessor.connect(audioContext.destination);
    }
}

function stopMicrophoneProcessing() {
    if (scriptProcessor) {
        scriptProcessor.disconnect();
        scriptProcessor = null;
    }
    bars.forEach((bar) => {
        bar.classList.toggle('inactive');
    });
}

function updateVolumeIndicator(volume) {
    const activeBars = Math.ceil(volume * bars.length);
    bars.forEach((bar, index) => {
        bar.classList.toggle('active', index < activeBars);
    });
}

function isAudioContextSupported() {
    return !!(window.AudioContext || window.webkitAudioContext);
}

function hasAudioTrack(mediaStream) {
    const audioTracks = mediaStream.getAudioTracks();
    return audioTracks.length > 0;
}

function hasVideoTrack(mediaStream) {
    const videoTracks = mediaStream.getVideoTracks();
    return videoTracks.length > 0;
}

// ####################################################
// API CHECK
// ####################################################

function getScreen() {
    let qs = new URLSearchParams(window.location.search);
    let screen = filterXSS(qs.get('screen'));
    if (screen) {
        screen = screen.toLowerCase();
        let queryScreen = screen === '1' || screen === 'true';
        if (queryScreen != null && (navigator.getDisplayMedia || navigator.mediaDevices.getDisplayMedia)) {
            console.log('Direct join', { screen: queryScreen });
            return queryScreen;
        }
    }
    console.log('Direct join', { screen: false });
    return false;
}

function getNotify() {
    let qs = new URLSearchParams(window.location.search);
    let notify = filterXSS(qs.get('notify'));
    if (notify) {
        notify = notify.toLowerCase();
        let queryNotify = notify === '1' || notify === 'true';
        if (queryNotify != null) {
            console.log('Direct join', { notify: queryNotify });
            return queryNotify;
        }
    }
    notify = localStorageSettings.share_on_join;
    console.log('Direct join', { notify: notify });
    return notify;
}

function getHideMeActive() {
    let qs = new URLSearchParams(window.location.search);
    let hide = filterXSS(qs.get('hide'));
    let queryHideMe = false;
    if (hide) {
        hide = hide.toLowerCase();
        queryHideMe = hide === '1' || hide === 'true';
    }
    console.log('Direct join', { hide: queryHideMe });
    return queryHideMe;
}

function isPeerPresenter() {
    let qs = new URLSearchParams(window.location.search);
    let presenter = filterXSS(qs.get('isPresenter'));
    if (presenter) {
        presenter = presenter.toLowerCase();
        let queryPresenter = presenter === '1' || presenter === 'true';
        if (queryPresenter != null) {
            console.log('Direct join Reconnect', { isPresenter: queryPresenter });
            return queryPresenter;
        }
    }
    console.log('Direct join Reconnect', { presenter: false });
    return false;
}

function getPeerName() {
    const qs = new URLSearchParams(window.location.search);
    const name = filterXSS(qs.get('name'));
    if (isHtml(name)) {
        console.log('Direct join', { name: 'Invalid name' });
        return 'Invalid name';
    }
    console.log('Direct join', { name: name });
    return name;
}

function getPeerUUID() {
    if (lS.getItemLocalStorage('peer_uuid')) {
        return lS.getItemLocalStorage('peer_uuid');
    }
    const peer_uuid = getUUID();
    lS.setItemLocalStorage('peer_uuid', peer_uuid);
    return peer_uuid;
}

function getPeerToken() {
    if (window.sessionStorage.peer_token) return window.sessionStorage.peer_token;
    let qs = new URLSearchParams(window.location.search);
    let token = filterXSS(qs.get('token'));
    let queryToken = false;
    if (token) {
        queryToken = token;
    }
    console.log('Direct join', { token: queryToken });
    return queryToken;
}

function getRoomPassword() {
    let qs = new URLSearchParams(window.location.search);
    let roomPassword = filterXSS(qs.get('roomPassword'));
    if (roomPassword) {
        let queryNoRoomPassword = roomPassword === '0' || roomPassword === 'false';
        if (queryNoRoomPassword) {
            roomPassword = false;
        }
        console.log('Direct join', { password: roomPassword });
        return roomPassword;
    }
    return false;
}

// ####################################################
// INIT CONFIG
// ####################################################

async function checkInitConfig() {
    const localStorageInitConfig = lS.getLocalStorageInitConfig();
    console.log('04.5 ----> Get init config', localStorageInitConfig);
    if (localStorageInitConfig) {
        if (isAudioVideoAllowed && !localStorageInitConfig.audioVideo) {
            await handleAudioVideo();
        } else {
            if (isAudioAllowed && !localStorageInitConfig.audio) handleAudio();
            if (isVideoAllowed && !localStorageInitConfig.video) handleVideo();
        }
    }
}

// ####################################################
// SOME PEER INFO
// ####################################################

function getPeerInfo() {
    peer_info = {
        join_data_time: getDataTimeString(),
        peer_uuid: peer_uuid,
        peer_id: socket.id,
        peer_name: peer_name,
        peer_token: peer_token,
        peer_presenter: isPresenter,
        peer_audio: isAudioAllowed,
        peer_video: isVideoAllowed,
        peer_screen: isScreenAllowed,
        peer_recording: isRecording,
        peer_video_privacy: isVideoPrivacyActive,
        peer_hand: false,
        is_desktop_device: !DetectRTC.isMobileDevice && !isTabletDevice && !isIPadDevice,
        is_mobile_device: DetectRTC.isMobileDevice,
        is_tablet_device: isTabletDevice,
        is_ipad_pro_device: isIPadDevice,
        os_name: DetectRTC.osName,
        os_version: DetectRTC.osVersion,
        browser_name: DetectRTC.browser.name,
        browser_version: DetectRTC.browser.version,
        user_agent: userAgent,
    };
}

// ####################################################
// ENTER YOUR NAME | Enable/Disable AUDIO/VIDEO
// ####################################################

async function whoAreYou() {
    console.log('04 ----> Who are you?');

    hide(loadingDiv);
    document.body.style.background = 'var(--body-bg)';

    try {
        const response = await axios.get('/config', {
            timeout: 5000,
        });
        const serverButtons = response.data.message;
        if (serverButtons) {
            BUTTONS = serverButtons;
            console.log('04 ----> AXIOS ROOM BUTTONS SETTINGS', {
                serverButtons: serverButtons,
                clientButtons: BUTTONS,
            });
        }
    } catch (error) {
        console.error('04 ----> AXIOS GET CONFIG ERROR', error.message);
    }

    if (navigator.getDisplayMedia || navigator.mediaDevices.getDisplayMedia) {
        BUTTONS.main.startScreenButton && show(initStartScreenButton);
    }

    if (peer_name) {
        checkMedia();
        getPeerInfo();
        joinRoom(peer_name, room_id);
        return;
    }

    let default_name = window.localStorage.peer_name ? window.localStorage.peer_name : '';
    if (getCookie(room_id + '_name')) {
        default_name = getCookie(room_id + '_name');
    }

    if (!BUTTONS.main.startVideoButton) {
        isVideoAllowed = false;
        elemDisplay('initVideo', false);
        elemDisplay('initVideoButton', false);
        elemDisplay('initAudioVideoButton', false);
        elemDisplay('initVideoAudioRefreshButton', false);
        elemDisplay('initVideoSelect', false);
        elemDisplay('tabVideoDevicesBtn', false);
        initVideoContainerShow(false);
    }
    if (!BUTTONS.main.startAudioButton) {
        isAudioAllowed = false;
        elemDisplay('initAudioButton', false);
        elemDisplay('initAudioVideoButton', false);
        elemDisplay('initVideoAudioRefreshButton', false);
        elemDisplay('initMicrophoneSelect', false);
        elemDisplay('initSpeakerSelect', false);
        elemDisplay('tabAudioDevicesBtn', false);
    }
    if (!BUTTONS.main.startScreenButton) {
        hide(initStartScreenButton);
    }

    initUser.classList.toggle('hidden');

    Swal.fire({
        allowOutsideClick: false,
        allowEscapeKey: false,
        background: swalBackground,
        title: 'MiroTalk SFU',
        input: 'text',
        inputPlaceholder: 'Enter your name',
        inputAttributes: { maxlength: 32 },
        inputValue: default_name,
        html: initUser, // Inject HTML
        confirmButtonText: `Join meeting`,
        customClass: { popup: 'init-modal-size' },
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        inputValidator: (name) => {
            if (!name) return 'Please enter your name';
            if (name.length > 30) return 'Name must be max 30 char';
            name = filterXSS(name);
            if (isHtml(name)) return 'Invalid name!';
            if (!getCookie(room_id + '_name')) {
                window.localStorage.peer_name = name;
            }
            setCookie(room_id + '_name', name, 30);
            peer_name = name;
        },
    }).then(async () => {
        if (initStream && !joinRoomWithScreen) {
            await stopTracks(initStream);
            elemDisplay('initVideo', false);
            initVideoContainerShow(false);
        }
        getPeerInfo();
        joinRoom(peer_name, room_id);
    });

    if (!isVideoAllowed) {
        elemDisplay('initVideo', false);
        initVideoContainerShow(false);
        hide(initVideoSelect);
    }
    if (!isAudioAllowed) {
        hide(initMicrophoneSelect);
        hide(initSpeakerSelect);
    }
}

function handleAudio() {
    isAudioAllowed = isAudioAllowed ? false : true;
    initAudioButton.className = 'fas fa-microphone' + (isAudioAllowed ? '' : '-slash');
    setColor(initAudioButton, isAudioAllowed ? 'white' : 'red');
    setColor(startAudioButton, isAudioAllowed ? 'white' : 'red');
    checkInitAudio(isAudioAllowed);
    lS.setInitConfig(lS.MEDIA_TYPE.audio, isAudioAllowed);
}

function handleVideo() {
    isVideoAllowed = isVideoAllowed ? false : true;
    initVideoButton.className = 'fas fa-video' + (isVideoAllowed ? '' : '-slash');
    setColor(initVideoButton, isVideoAllowed ? 'white' : 'red');
    setColor(startVideoButton, isVideoAllowed ? 'white' : 'red');
    checkInitVideo(isVideoAllowed);
    lS.setInitConfig(lS.MEDIA_TYPE.video, isVideoAllowed);
}

async function handleAudioVideo() {
    isAudioVideoAllowed = isAudioVideoAllowed ? false : true;
    isAudioAllowed = isAudioVideoAllowed;
    isVideoAllowed = isAudioVideoAllowed;
    lS.setInitConfig(lS.MEDIA_TYPE.audio, isAudioVideoAllowed);
    lS.setInitConfig(lS.MEDIA_TYPE.video, isAudioVideoAllowed);
    lS.setInitConfig(lS.MEDIA_TYPE.audioVideo, isAudioVideoAllowed);
    initAudioButton.className = 'fas fa-microphone' + (isAudioVideoAllowed ? '' : '-slash');
    initVideoButton.className = 'fas fa-video' + (isAudioVideoAllowed ? '' : '-slash');
    initAudioVideoButton.className = 'fas fa-eye' + (isAudioVideoAllowed ? '' : '-slash');
    if (!isAudioVideoAllowed) {
        hide(initAudioButton);
        hide(initVideoButton);
        hide(initVideoAudioRefreshButton);
    }
    if (isAudioAllowed && isVideoAllowed && !DetectRTC.isMobileDevice) show(initVideoAudioRefreshButton);
    setColor(initAudioVideoButton, isAudioVideoAllowed ? 'white' : 'red');
    setColor(initAudioButton, isAudioAllowed ? 'white' : 'red');
    setColor(initVideoButton, isVideoAllowed ? 'white' : 'red');
    setColor(startAudioButton, isAudioAllowed ? 'white' : 'red');
    setColor(startVideoButton, isVideoAllowed ? 'white' : 'red');
    await checkInitVideo(isVideoAllowed);
    checkInitAudio(isAudioAllowed);
}

async function checkInitVideo(isVideoAllowed) {
    if (isVideoAllowed && BUTTONS.main.startVideoButton) {
        if (initVideoSelect.value) {
            initVideoContainerShow();
            await changeCamera(initVideoSelect.value);
        }
        sound('joined');
    } else {
        if (initStream) {
            stopTracks(initStream);
            elemDisplay('initVideo', false);
            initVideoContainerShow(false);
            sound('left');
        }
    }
    initVideoSelect.disabled = !isVideoAllowed;
}

function checkInitAudio(isAudioAllowed) {
    initMicrophoneSelect.disabled = !isAudioAllowed;
    initSpeakerSelect.disabled = !isAudioAllowed;
    isAudioAllowed ? sound('joined') : sound('left');
}

function initVideoContainerShow(show = true) {
    initVideoContainerClass.style.width = show ? '100%' : 'auto';
}

function checkMedia() {
    let qs = new URLSearchParams(window.location.search);
    let audio = filterXSS(qs.get('audio'));
    let video = filterXSS(qs.get('video'));
    if (audio) {
        audio = audio.toLowerCase();
        let queryPeerAudio = audio === '1' || audio === 'true';
        if (queryPeerAudio != null) isAudioAllowed = queryPeerAudio;
    }
    if (video) {
        video = video.toLowerCase();
        let queryPeerVideo = video === '1' || video === 'true';
        if (queryPeerVideo != null) isVideoAllowed = queryPeerVideo;
    }
    // elemDisplay('tabVideoDevicesBtn', isVideoAllowed);
    // elemDisplay('tabAudioDevicesBtn', isAudioAllowed);

    console.log('Direct join', {
        audio: isAudioAllowed,
        video: isVideoAllowed,
    });
}

// ####################################################
// SHARE ROOM
// ####################################################

async function shareRoom(useNavigator = false) {
    if (navigator.share && useNavigator) {
        try {
            await navigator.share({ url: RoomURL });
            userLog('info', 'Room Shared successfully', 'top-end');
        } catch (err) {
            share();
        }
    } else {
        share();
    }
    function share() {
        sound('open');

        Swal.fire({
            background: swalBackground,
            position: 'center',
            title: 'Share the room',
            html: `
            <div id="qrRoomContainer">
                <canvas id="qrRoom"></canvas>
            </div>
            <br/>
            <p style="background:transparent; color:rgb(8, 189, 89);">Join from your mobile device</p>
            <p style="background:transparent; color:white; font-family: Arial, Helvetica, sans-serif;">No need for apps, simply capture the QR code with your mobile camera Or Invite someone else to join by sending them the following URL</p>
            <p style="background:transparent; color:rgb(8, 189, 89);">${RoomURL}</p>`,
            showDenyButton: true,
            showCancelButton: true,
            cancelButtonColor: 'red',
            denyButtonColor: 'green',
            confirmButtonText: `Copy URL`,
            denyButtonText: `Email invite`,
            cancelButtonText: `Close`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                copyRoomURL();
            } else if (result.isDenied) {
                shareRoomByEmail();
            }
            // share screen on join
            if (isScreenAllowed) {
                rc.shareScreen();
            }
        });
        makeRoomQR();
    }
}

// ####################################################
// ROOM UTILITY
// ####################################################

function makeRoomQR() {
    let qr = new QRious({
        element: document.getElementById('qrRoom'),
        value: RoomURL,
    });
    qr.set({
        size: 256,
    });
}

function copyRoomURL() {
    let tmpInput = document.createElement('input');
    document.body.appendChild(tmpInput);
    tmpInput.value = RoomURL;
    tmpInput.select();
    tmpInput.setSelectionRange(0, 99999); // For mobile devices
    navigator.clipboard.writeText(tmpInput.value);
    document.body.removeChild(tmpInput);
    userLog('info', 'Meeting URL copied to clipboard 👍', 'top-end');
}

function shareRoomByEmail() {
    Swal.fire({
        allowOutsideClick: false,
        allowEscapeKey: false,
        background: swalBackground,
        imageUrl: image.email,
        position: 'center',
        title: 'Select a Date and Time',
        html: '<input type="text" id="datetimePicker" class="flatpickr" />',
        showCancelButton: true,
        confirmButtonText: 'OK',
        cancelButtonColor: 'red',
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        preConfirm: () => {
            const newLine = '%0D%0A%0D%0A';
            const selectedDateTime = document.getElementById('datetimePicker').value;
            const roomPassword =
                isRoomLocked && (room_password || rc.RoomPassword)
                    ? 'Password: ' + (room_password || rc.RoomPassword) + newLine
                    : '';
            const email = '';
            const emailSubject = `Please join our MiroTalk SFU Video Chat Meeting`;
            const emailBody = `The meeting is scheduled at: ${newLine} DateTime: ${selectedDateTime} ${newLine}${roomPassword}Click to join: ${RoomURL} ${newLine}`;
            document.location = 'mailto:' + email + '?subject=' + emailSubject + '&body=' + emailBody;
        },
    });
    flatpickr('#datetimePicker', {
        enableTime: true,
        dateFormat: 'Y-m-d H:i',
        time_24hr: true,
    });
}

// ####################################################
// JOIN ROOM
// ####################################################

function joinRoom(peer_name, room_id) {
    if (rc && rc.isConnected()) {
        console.log('Already connected to a room');
    } else {
        console.log('05 ----> join Room ' + room_id);
        roomId.innerText = room_id;
        userName.innerText = peer_name;
        isUserPresenter.innerText = isPresenter;
        rc = new RoomClient(
            localAudio,
            remoteAudios,
            videoMediaContainer,
            videoPinMediaContainer,
            window.mediasoupClient,
            socket,
            room_id,
            peer_name,
            peer_uuid,
            peer_info,
            isAudioAllowed,
            isVideoAllowed,
            isScreenAllowed,
            joinRoomWithScreen,
            isSpeechSynthesisSupported,
            transcription,
            roomIsReady,
        );
        handleRoomClientEvents();
        //notify ? shareRoom() : sound('joined');
    }
}

function roomIsReady() {
    if (rc.isValidEmail(peer_name)) {
        myProfileAvatar.style.borderRadius = `50px`;
        myProfileAvatar.setAttribute('src', rc.genGravatar(peer_name));
    } else {
        myProfileAvatar.setAttribute('src', rc.genAvatarSvg(peer_name, 64));
    }
    BUTTONS.main.exitButton && show(exitButton);
    BUTTONS.main.shareButton && show(shareButton);
    BUTTONS.main.hideMeButton && show(hideMeButton);
    if (BUTTONS.settings.tabRecording) {
        show(startRecButton);
    } else {
        hide(startRecButton);
        hide(tabRecordingBtn);
    }
    BUTTONS.main.chatButton && show(chatButton);
    BUTTONS.main.raiseHandButton && show(raiseHandButton);
    BUTTONS.main.emojiRoomButton && show(emojiRoomButton);
    !BUTTONS.chat.chatSaveButton && hide(chatSaveButton);
    BUTTONS.chat.chatEmojiButton && show(chatEmojiButton);
    BUTTONS.chat.chatMarkdownButton && show(chatMarkdownButton);

    isWebkitSpeechRecognitionSupported && BUTTONS.chat.chatSpeechStartButton
        ? show(chatSpeechStartButton)
        : (BUTTONS.chat.chatSpeechStartButton = false);

    transcription.isSupported() && BUTTONS.main.transcriptionButton
        ? show(transcriptionButton)
        : (BUTTONS.main.transcriptionButton = false);

    show(chatCleanTextButton);
    show(chatPasteButton);
    show(chatSendButton);
    if (DetectRTC.isMobileDevice) {
        hide(initVideoAudioRefreshButton);
        hide(refreshVideoDevices);
        hide(refreshAudioDevices);
        BUTTONS.main.swapCameraButton && show(swapCameraButton);
        rc.chatMaximize();
        hide(chatTogglePin);
        hide(chatMaxButton);
        hide(chatMinButton);
        transcription.maximize();
        hide(transcriptionTogglePinBtn);
        hide(transcriptionMaxBtn);
        hide(transcriptionMinBtn);
    } else {
        rc.makeDraggable(emojiPickerContainer, emojiPickerHeader);
        rc.makeDraggable(chatRoom, chatHeader);
        rc.makeDraggable(mySettings, mySettingsHeader);
        rc.makeDraggable(whiteboard, whiteboardHeader);
        rc.makeDraggable(sendFileDiv, imgShareSend);
        rc.makeDraggable(receiveFileDiv, imgShareReceive);
        rc.makeDraggable(lobby, lobbyHeader);
        rc.makeDraggable(transcriptionRoom, transcriptionHeader);
        if (navigator.getDisplayMedia || navigator.mediaDevices.getDisplayMedia) {
            if (BUTTONS.main.startScreenButton) {
                show(startScreenButton);
                show(ScreenFpsDiv);
            }
        }
        BUTTONS.chat.chatPinButton && show(chatTogglePin);
        BUTTONS.chat.chatMaxButton && show(chatMaxButton);
        BUTTONS.settings.pushToTalk && show(pushToTalkDiv);
    }
    if (DetectRTC.browser.name != 'Safari') {
        document.onfullscreenchange = () => {
            if (!document.fullscreenElement) rc.isDocumentOnFullScreen = false;
        };
        show(fullScreenButton);
    }
    BUTTONS.main.whiteboardButton && show(whiteboardButton);
    BUTTONS.main.settingsButton && show(settingsButton);
    isAudioAllowed ? show(stopAudioButton) : BUTTONS.main.startAudioButton && show(startAudioButton);
    isVideoAllowed ? show(stopVideoButton) : BUTTONS.main.startVideoButton && show(startVideoButton);
    BUTTONS.settings.fileSharing && show(fileShareButton);
    BUTTONS.settings.lockRoomButton && show(lockRoomButton);
    BUTTONS.settings.broadcastingButton && show(broadcastingButton);
    BUTTONS.settings.lobbyButton && show(lobbyButton);
    BUTTONS.settings.sendEmailInvitation && show(sendEmailInvitation);
    if (BUTTONS.settings.host_only_recording) {
        show(recordingImage);
        show(roomHostOnlyRecording);
        show(roomRecordingOptions);
    }
    if (rc.recSyncServerRecording) show(roomRecordingServer);
    BUTTONS.main.aboutButton && show(aboutButton);
    if (!DetectRTC.isMobileDevice) show(pinUnpinGridDiv);
    if (!isSpeechSynthesisSupported) hide(speechMsgDiv);
    handleButtons();
    handleSelects();
    handleInputs();
    handleChatEmojiPicker();
    handleRoomEmojiPicker();
    loadSettingsFromLocalStorage();
    startSessionTimer();
    document.body.addEventListener('mousemove', (e) => {
        showButtons();
    });
    checkButtonsBar();
    if (room_password) {
        lockRoomButton.click();
    }
}

function elemDisplay(element, display, mode = 'block') {
    const elem = document.getElementById(element);
    elem ? (elem.style.display = display ? mode : 'none') : console.error('elemDisplay not found', element);
}

function hide(elem) {
    if (!elem.classList.contains('hidden')) elem.classList.toggle('hidden');
}

function show(elem) {
    if (elem.classList.contains('hidden')) elem.classList.toggle('hidden');
}

function disable(elem, disabled) {
    elem.disabled = disabled;
}

function setColor(elem, color) {
    elem.style.color = color;
}

// ####################################################
// SESSION TIMER
// ####################################################

function startSessionTimer() {
    sessionTime.style.display = 'inline';
    let callStartTime = Date.now();
    setInterval(function printTime() {
        let callElapsedTime = Date.now() - callStartTime;
        sessionTime.innerText = getTimeToString(callElapsedTime);
    }, 1000);
}

function getTimeToString(time) {
    let diffInHrs = time / 3600000;
    let hh = Math.floor(diffInHrs);
    let diffInMin = (diffInHrs - hh) * 60;
    let mm = Math.floor(diffInMin);
    let diffInSec = (diffInMin - mm) * 60;
    let ss = Math.floor(diffInSec);
    let formattedHH = hh.toString().padStart(2, '0');
    let formattedMM = mm.toString().padStart(2, '0');
    let formattedSS = ss.toString().padStart(2, '0');
    return `${formattedHH}:${formattedMM}:${formattedSS}`;
}

// ####################################################
// RECORDING TIMER
// ####################################################

function secondsToHms(d) {
    d = Number(d);
    let h = Math.floor(d / 3600);
    let m = Math.floor((d % 3600) / 60);
    let s = Math.floor((d % 3600) % 60);
    let hDisplay = h > 0 ? h + 'h' : '';
    let mDisplay = m > 0 ? m + 'm' : '';
    let sDisplay = s > 0 ? s + 's' : '';
    return hDisplay + ' ' + mDisplay + ' ' + sDisplay;
}

function startRecordingTimer() {
    recElapsedTime = 0;
    recTimer = setInterval(function printTime() {
        if (rc.isRecording()) {
            recElapsedTime++;
            recordingStatus.innerText = secondsToHms(recElapsedTime);
        }
    }, 1000);
}
function stopRecordingTimer() {
    clearInterval(recTimer);
}

// ####################################################
// HTML BUTTONS
// ####################################################

function handleButtons() {
    control.onmouseover = () => {
        isButtonsBarOver = true;
    };
    control.onmouseout = () => {
        isButtonsBarOver = false;
    };
    exitButton.onclick = () => {
        rc.exitRoom();
    };
    shareButton.onclick = () => {
        shareRoom(true);
    };
    hideMeButton.onclick = (e) => {
        isHideMeActive = !isHideMeActive;
        rc.handleHideMe();
    };
    settingsButton.onclick = () => {
        rc.toggleMySettings();
    };
    mySettingsCloseBtn.onclick = () => {
        rc.toggleMySettings();
    };
    tabVideoDevicesBtn.onclick = (e) => {
        rc.openTab(e, 'tabVideoDevices');
    };
    tabAudioDevicesBtn.onclick = (e) => {
        rc.openTab(e, 'tabAudioDevices');
    };
    tabRecordingBtn.onclick = (e) => {
        rc.openTab(e, 'tabRecording');
    };
    tabRoomBtn.onclick = (e) => {
        rc.openTab(e, 'tabRoom');
    };
    tabVideoShareBtn.onclick = (e) => {
        rc.openTab(e, 'tabVideoShare');
    };
    tabAspectBtn.onclick = (e) => {
        rc.openTab(e, 'tabAspect');
    };
    tabModeratorBtn.onclick = (e) => {
        rc.openTab(e, 'tabModerator');
    };
    tabProfileBtn.onclick = (e) => {
        rc.openTab(e, 'tabProfile');
    };
    tabStylingBtn.onclick = (e) => {
        rc.openTab(e, 'tabStyling');
    };
    tabLanguagesBtn.onclick = (e) => {
        rc.openTab(e, 'tabLanguages');
    };
    refreshVideoDevices.onclick = async () => {
        await refreshMyVideoDevices();
        userLog('info', 'Refreshed video devices', 'top-end');
    };
    refreshAudioDevices.onclick = async () => {
        await refreshMyAudioDevices();
        userLog('info', 'Refreshed audio devices', 'top-end');
    };
    applyAudioOptionsButton.onclick = () => {
        rc.closeThenProduce(RoomClient.mediaType.audio, microphoneSelect.value);
    };
    speakerTestBtn.onclick = () => {
        sound('ring', true);
    };
    roomId.onclick = () => {
        DetectRTC.isMobileDevice ? shareRoom(true) : copyRoomURL();
    };
    roomSendEmail.onclick = () => {
        shareRoomByEmail();
    };
    chatButton.onclick = () => {
        rc.toggleChat();
        if (DetectRTC.isMobileDevice) {
            rc.toggleShowParticipants();
        }
    };
    transcriptionButton.onclick = () => {
        transcription.toggle();
    };
    transcriptionCloseBtn.onclick = () => {
        transcription.toggle();
    };
    transcriptionTogglePinBtn.onclick = () => {
        transcription.togglePinUnpin();
    };
    transcriptionMaxBtn.onclick = () => {
        transcription.maximize();
    };
    transcriptionMinBtn.onclick = () => {
        transcription.minimize();
    };
    transcriptionGhostBtn.onclick = () => {
        transcription.toggleBg();
    };
    transcriptionSaveBtn.onclick = () => {
        transcription.save();
    };
    transcriptionCleanBtn.onclick = () => {
        transcription.delete();
    };
    chatHideParticipantsList.onclick = (e) => {
        rc.toggleShowParticipants();
    };
    chatShowParticipantsList.onclick = (e) => {
        rc.toggleShowParticipants();
    };
    chatShareRoomBtn.onclick = (e) => {
        shareRoom(true);
    };
    chatGhostButton.onclick = (e) => {
        rc.chatToggleBg();
    };
    chatCleanButton.onclick = () => {
        rc.chatClean();
    };
    chatSaveButton.onclick = () => {
        rc.chatSave();
    };
    chatCloseButton.onclick = () => {
        rc.toggleChat();
    };
    chatTogglePin.onclick = () => {
        rc.toggleChatPin();
    };
    chatMaxButton.onclick = () => {
        rc.chatMaximize();
    };
    chatMinButton.onclick = () => {
        rc.chatMinimize();
    };
    chatCleanTextButton.onclick = () => {
        rc.cleanMessage();
    };
    chatPasteButton.onclick = () => {
        rc.pasteMessage();
    };
    chatSendButton.onclick = () => {
        rc.sendMessage();
    };
    chatEmojiButton.onclick = () => {
        rc.toggleChatEmoji();
    };
    chatMarkdownButton.onclick = () => {
        isChatMarkdownOn = !isChatMarkdownOn;
        setColor(chatMarkdownButton, isChatMarkdownOn ? 'lime' : 'white');
    };
    chatSpeechStartButton.onclick = () => {
        startSpeech();
    };
    chatSpeechStopButton.onclick = () => {
        stopSpeech();
    };
    transcriptionSpeechStart.onclick = () => {
        transcription.start();
    };
    transcriptionSpeechStop.onclick = () => {
        transcription.stop();
    };
    fullScreenButton.onclick = () => {
        rc.toggleFullScreen();
    };
    recordingImage.onclick = () => {
        isRecording ? stopRecButton.click() : startRecButton.click();
    };
    startRecButton.onclick = () => {
        if (participantsCount == 1 && !rc.peer_info.peer_audio) {
            return userLog('warning', '🔴 Recording requires your audio to be enabled', 'top-end', 6000);
        }
        rc.startRecording();
    };
    stopRecButton.onclick = () => {
        rc.stopRecording();
    };
    pauseRecButton.onclick = () => {
        rc.pauseRecording();
    };
    resumeRecButton.onclick = () => {
        rc.resumeRecording();
    };
    swapCameraButton.onclick = () => {
        if (isHideMeActive) rc.handleHideMe();
        rc.closeThenProduce(RoomClient.mediaType.video, null, true);
    };
    raiseHandButton.onclick = () => {
        rc.updatePeerInfo(peer_name, socket.id, 'hand', true);
    };
    lowerHandButton.onclick = () => {
        rc.updatePeerInfo(peer_name, socket.id, 'hand', false);
    };
    startAudioButton.onclick = async () => {
        const moderator = rc.getModerator();
        if (moderator.audio_cant_unmute) {
            return userLog('warning', 'The moderator does not allow you to unmute', 'top-end', 6000);
        }
        if (isPushToTalkActive) return;
        setAudioButtonsDisabled(true);
        if (!isEnumerateAudioDevices) await initEnumerateAudioDevices();
        rc.produce(RoomClient.mediaType.audio, microphoneSelect.value);
        rc.updatePeerInfo(peer_name, socket.id, 'audio', true);
        // rc.resumeProducer(RoomClient.mediaType.audio);
    };
    stopAudioButton.onclick = () => {
        if (isPushToTalkActive) return;
        setAudioButtonsDisabled(true);
        rc.closeProducer(RoomClient.mediaType.audio);
        rc.updatePeerInfo(peer_name, socket.id, 'audio', false);
        // rc.pauseProducer(RoomClient.mediaType.audio);
    };
    startVideoButton.onclick = async () => {
        const moderator = rc.getModerator();
        if (moderator.video_cant_unhide) {
            return userLog('warning', 'The moderator does not allow you to unhide', 'top-end', 6000);
        }
        setVideoButtonsDisabled(true);
        if (!isEnumerateVideoDevices) await initEnumerateVideoDevices();
        rc.produce(RoomClient.mediaType.video, videoSelect.value);
        // rc.resumeProducer(RoomClient.mediaType.video);
    };
    stopVideoButton.onclick = () => {
        setVideoButtonsDisabled(true);
        rc.closeProducer(RoomClient.mediaType.video);
        // rc.pauseProducer(RoomClient.mediaType.video);
    };
    startScreenButton.onclick = () => {
        const moderator = rc.getModerator();
        if (moderator.screen_cant_share) {
            return userLog('warning', 'The moderator does not allow you to share the screen', 'top-end', 6000);
        }
        rc.produce(RoomClient.mediaType.screen);
    };
    stopScreenButton.onclick = () => {
        rc.closeProducer(RoomClient.mediaType.screen);
    };
    fileShareButton.onclick = () => {
        rc.selectFileToShare(socket.id, true);
    };
    videoShareButton.onclick = () => {
        rc.shareVideo('all');
    };
    videoCloseBtn.onclick = () => {
        rc.closeVideo(true);
    };
    sendAbortBtn.onclick = () => {
        rc.abortFileTransfer();
    };
    receiveHideBtn.onclick = () => {
        rc.hideFileTransfer();
    };
    whiteboardButton.onclick = () => {
        toggleWhiteboard();
    };
    whiteboardPencilBtn.onclick = () => {
        whiteboardIsDrawingMode(true);
    };
    whiteboardObjectBtn.onclick = () => {
        whiteboardIsDrawingMode(false);
    };
    whiteboardUndoBtn.onclick = () => {
        whiteboardAction(getWhiteboardAction('undo'));
    };
    whiteboardRedoBtn.onclick = () => {
        whiteboardAction(getWhiteboardAction('redo'));
    };
    whiteboardSaveBtn.onclick = () => {
        wbCanvasSaveImg();
    };
    whiteboardImgFileBtn.onclick = () => {
        whiteboardAddObj('imgFile');
    };
    whiteboardPdfFileBtn.onclick = () => {
        whiteboardAddObj('pdfFile');
    };
    whiteboardImgUrlBtn.onclick = () => {
        whiteboardAddObj('imgUrl');
    };
    whiteboardTextBtn.onclick = () => {
        whiteboardAddObj('text');
    };
    whiteboardLineBtn.onclick = () => {
        whiteboardAddObj('line');
    };
    whiteboardRectBtn.onclick = () => {
        whiteboardAddObj('rect');
    };
    whiteboardTriangleBtn.onclick = () => {
        whiteboardAddObj('triangle');
    };
    whiteboardCircleBtn.onclick = () => {
        whiteboardAddObj('circle');
    };
    whiteboardEraserBtn.onclick = () => {
        whiteboardIsEraser(true);
    };
    whiteboardCleanBtn.onclick = () => {
        confirmClearBoard();
    };
    whiteboardLockButton.onchange = () => {
        wbIsLock = !wbIsLock;
        whiteboardAction(getWhiteboardAction(wbIsLock ? 'lock' : 'unlock'));
    };
    whiteboardCloseBtn.onclick = () => {
        whiteboardAction(getWhiteboardAction('close'));
    };
    participantsSaveBtn.onclick = () => {
        saveRoomPeers();
    };
    participantsUnreadMessagesBtn.onclick = () => {
        rc.toggleUnreadMsg();
    };
    participantsRaiseHandBtn.onclick = () => {
        rc.toggleRaiseHands();
    };
    searchParticipantsFromList.onkeyup = () => {
        rc.searchPeer();
    };
    lockRoomButton.onclick = () => {
        rc.roomAction('lock');
    };
    unlockRoomButton.onclick = () => {
        rc.roomAction('unlock');
    };
    aboutButton.onclick = () => {
        showAbout();
    };
}

// ####################################################
// HANDLE INIT USER
// ####################################################

function setButtonsInit() {
    if (!DetectRTC.isMobileDevice) {
        setTippy('initAudioButton', 'Toggle the audio', 'top');
        setTippy('initVideoButton', 'Toggle the video', 'top');
        setTippy('initAudioVideoButton', 'Toggle the audio & video', 'top');
        setTippy('initStartScreenButton', 'Toggle screen sharing', 'top');
        setTippy('initStopScreenButton', 'Toggle screen sharing', 'top');
    }
    if (!isAudioAllowed) hide(initAudioButton);
    if (!isVideoAllowed) hide(initVideoButton);
    if (!isAudioAllowed || !isVideoAllowed) hide(initAudioVideoButton);
    if ((!isAudioAllowed && !isVideoAllowed) || DetectRTC.isMobileDevice) hide(initVideoAudioRefreshButton);
    isAudioVideoAllowed = isAudioAllowed && isVideoAllowed;
}

function handleSelectsInit() {
    // devices init options
    initVideoSelect.onchange = async () => {
        await changeCamera(initVideoSelect.value);
        videoSelect.selectedIndex = initVideoSelect.selectedIndex;
        refreshLsDevices();
    };
    initMicrophoneSelect.onchange = () => {
        microphoneSelect.selectedIndex = initMicrophoneSelect.selectedIndex;
        refreshLsDevices();
    };
    initSpeakerSelect.onchange = () => {
        speakerSelect.selectedIndex = initSpeakerSelect.selectedIndex;
        refreshLsDevices();
    };
}

async function setSelectsInit() {
    if (localStorageDevices) {
        console.log('04.0 ----> Get Local Storage Devices before', localStorageDevices);
        //
        const initMicrophoneExist = selectOptionByValueExist(initMicrophoneSelect, localStorageDevices.audio.select);
        const initSpeakerExist = selectOptionByValueExist(initSpeakerSelect, localStorageDevices.speaker.select);
        const initVideoExist = selectOptionByValueExist(initVideoSelect, localStorageDevices.video.select);
        //
        const microphoneExist = selectOptionByValueExist(microphoneSelect, localStorageDevices.audio.select);
        const speakerExist = selectOptionByValueExist(speakerSelect, localStorageDevices.speaker.select);
        const videoExist = selectOptionByValueExist(videoSelect, localStorageDevices.video.select);

        console.log('Check for audio changes', {
            previous: localStorageDevices.audio.select,
            current: microphoneSelect.value,
        });

        if (!initMicrophoneExist || !microphoneExist) {
            console.log('04.1 ----> Audio devices seems changed, use default index 0');
            initMicrophoneSelect.selectedIndex = 0;
            microphoneSelect.selectedIndex = 0;
            refreshLsDevices();
        }

        console.log('Check for speaker changes', {
            previous: localStorageDevices.speaker.select,
            current: speakerSelect.value,
        });

        if (!initSpeakerExist || !speakerExist) {
            console.log('04.2 ----> Speaker devices seems changed, use default index 0');
            initSpeakerSelect.selectedIndex = 0;
            speakerSelect.selectedIndex = 0;
            refreshLsDevices();
        }

        console.log('Check for video changes', {
            previous: localStorageDevices.video.select,
            current: videoSelect.value,
        });

        if (!initVideoExist || !videoExist) {
            console.log('04.3 ----> Video devices seems changed, use default index 0');
            initVideoSelect.selectedIndex = 0;
            videoSelect.selectedIndex = 0;
            refreshLsDevices();
        }

        //
        console.log('04.4 ----> Get Local Storage Devices after', lS.getLocalStorageDevices());
    }
    if (initVideoSelect.value) await changeCamera(initVideoSelect.value);
}

function selectOptionByValueExist(selectElement, value) {
    let foundValue = false;
    for (let i = 0; i < selectElement.options.length; i++) {
        if (selectElement.options[i].value === value) {
            selectElement.selectedIndex = i;
            foundValue = true;
            break;
        }
    }
    return foundValue;
}

function refreshLsDevices() {
    lS.setLocalStorageDevices(lS.MEDIA_TYPE.video, videoSelect.selectedIndex, videoSelect.value);
    lS.setLocalStorageDevices(lS.MEDIA_TYPE.audio, microphoneSelect.selectedIndex, microphoneSelect.value);
    lS.setLocalStorageDevices(lS.MEDIA_TYPE.speaker, speakerSelect.selectedIndex, speakerSelect.value);
}

async function changeCamera(deviceId) {
    if (initStream) {
        await stopTracks(initStream);
        elemDisplay('initVideo', true);
        initVideoContainerShow();
        if (!initVideo.classList.contains('mirror')) {
            initVideo.classList.toggle('mirror');
        }
    }
    const videoConstraints = {
        audio: false,
        video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            deviceId: deviceId,
            aspectRatio: 1.777,
        },
    };
    navigator.mediaDevices
        .getUserMedia(videoConstraints)
        .then((camStream) => {
            initVideo.className = 'mirror';
            initVideo.srcObject = camStream;
            initStream = camStream;
            console.log(
                '04.5 ----> Success attached init cam video stream',
                initStream.getVideoTracks()[0].getSettings(),
            );
            checkInitConfig();
            handleCameraMirror(initVideo);
        })
        .catch((error) => {
            console.error('[Error] changeCamera', error);
            handleMediaError('video/audio', error);
        });
}

// ####################################################
// HANDLE MEDIA ERROR
// ####################################################

function handleMediaError(mediaType, err) {
    sound('alert');

    let errMessage = err;

    switch (err.name) {
        case 'NotFoundError':
        case 'DevicesNotFoundError':
            errMessage = 'Required track is missing';
            break;
        case 'NotReadableError':
        case 'TrackStartError':
            errMessage = 'Already in use';
            break;
        case 'OverconstrainedError':
        case 'ConstraintNotSatisfiedError':
            errMessage = 'Constraints cannot be satisfied by available devices';
            break;
        case 'NotAllowedError':
        case 'PermissionDeniedError':
            errMessage = 'Permission denied in browser';
            break;
        case 'TypeError':
            errMessage = 'Empty constraints object';
            break;
        default:
            break;
    }

    const $html = `
        <ul style="text-align: left">
            <li>Media type: ${mediaType}</li>
            <li>Error name: ${err.name}</li>
            <li>Error message: <p style="color: red">${errMessage}</p></li>
            <li>Common: <a href="https://blog.addpipe.com/common-getusermedia-errors" target="_blank">getUserMedia errors</a></li>
        </ul>
    `;

    popupHtmlMessage(null, image.forbidden, 'Access denied', $html, 'center', '/');

    throw new Error(
        `Access denied for ${mediaType} device [${err.name}]: ${errMessage} check the common getUserMedia errors: https://blog.addpipe.com/common-getusermedia-errors/`,
    );
}

function popupHtmlMessage(icon, imageUrl, title, html, position, redirectURL = false) {
    Swal.fire({
        allowOutsideClick: false,
        allowEscapeKey: false,
        background: swalBackground,
        position: position,
        icon: icon,
        imageUrl: imageUrl,
        title: title,
        html: html,
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    }).then((result) => {
        if (result.isConfirmed && redirectURL) {
            openURL(redirectURL);
        }
    });
}

async function toggleScreenSharing() {
    if (initStream) {
        await stopTracks(initStream);
        elemDisplay('initVideo', true);
        initVideoContainerShow();
    }
    joinRoomWithScreen = !joinRoomWithScreen;
    if (joinRoomWithScreen) {
        navigator.mediaDevices
            .getDisplayMedia({ audio: true, video: true })
            .then((screenStream) => {
                if (initVideo.classList.contains('mirror')) {
                    initVideo.classList.toggle('mirror');
                }
                initVideo.srcObject = screenStream;
                initStream = screenStream;
                console.log('04.6 ----> Success attached init screen video stream', initStream);
                show(initStopScreenButton);
                hide(initStartScreenButton);
                disable(initVideoSelect, true);
                disable(initVideoButton, true);
                disable(initAudioVideoButton, true);
                disable(initVideoAudioRefreshButton, true);
            })
            .catch((error) => {
                console.error('[Error] toggleScreenSharing', error);
                joinRoomWithScreen = false;
                return checkInitVideo(isVideoAllowed);
            });
    } else {
        checkInitVideo(isVideoAllowed);
        hide(initStopScreenButton);
        show(initStartScreenButton);
        disable(initVideoSelect, false);
        disable(initVideoButton, false);
        disable(initAudioVideoButton, false);
        disable(initVideoAudioRefreshButton, false);
    }
}

function handleCameraMirror(video) {
    const isDesktopDevice = !DetectRTC.isMobileDevice && !isTabletDevice && !isIPadDevice;
    if (isDesktopDevice) {
        // Desktop devices...
        if (!video.classList.contains('mirror')) {
            video.classList.toggle('mirror');
        }
    } else {
        // Mobile, Tablet, IPad devices...
        if (video.classList.contains('mirror')) {
            video.classList.remove('mirror');
        }
    }
}

function handleSelects() {
    // devices options
    videoSelect.onchange = () => {
        videoQuality.selectedIndex = 0;
        rc.closeThenProduce(RoomClient.mediaType.video, videoSelect.value);
        refreshLsDevices();
    };
    videoQuality.onchange = () => {
        rc.closeThenProduce(RoomClient.mediaType.video, videoSelect.value);
    };
    videoFps.onchange = () => {
        rc.closeThenProduce(RoomClient.mediaType.video, videoSelect.value);
        localStorageSettings.video_fps = videoFps.selectedIndex;
        lS.setSettings(localStorageSettings);
    };
    screenFps.onchange = () => {
        rc.closeThenProduce(RoomClient.mediaType.screen);
        localStorageSettings.screen_fps = screenFps.selectedIndex;
        lS.setSettings(localStorageSettings);
    };
    microphoneSelect.onchange = () => {
        rc.closeThenProduce(RoomClient.mediaType.audio, microphoneSelect.value);
        refreshLsDevices();
    };
    speakerSelect.onchange = () => {
        rc.changeAudioDestination();
        refreshLsDevices();
    };
    switchPushToTalk.onchange = (e) => {
        const producerExist = rc.producerExist(RoomClient.mediaType.audio);
        if (!producerExist && !isPushToTalkActive) {
            console.log('Push-to-talk: start audio producer');
            setAudioButtonsDisabled(true);
            if (!isEnumerateAudioDevices) initEnumerateAudioDevices();
            rc.produce(RoomClient.mediaType.audio, microphoneSelect.value);
            setTimeout(function () {
                rc.pauseProducer(RoomClient.mediaType.audio);
                rc.updatePeerInfo(peer_name, socket.id, 'audio', false);
            }, 1000);
        }
        isPushToTalkActive = !isPushToTalkActive;
        if (producerExist && !isPushToTalkActive) {
            console.log('Push-to-talk: resume audio producer');
            rc.resumeProducer(RoomClient.mediaType.audio);
            rc.updatePeerInfo(peer_name, socket.id, 'audio', true);
        }
        e.target.blur(); // Removes focus from the element
        rc.roomMessage('ptt', isPushToTalkActive);
        console.log(`Push-to-talk enabled: ${isPushToTalkActive}`);
    };
    document.addEventListener('keydown', (e) => {
        if (!isPushToTalkActive) return;
        if (e.code === 'Space') {
            if (isSpaceDown) return;
            rc.resumeProducer(RoomClient.mediaType.audio);
            rc.updatePeerInfo(peer_name, socket.id, 'audio', true);
            isSpaceDown = true;
            console.log('Push-to-talk: audio resumed');
        }
    });
    document.addEventListener('keyup', (e) => {
        if (!isPushToTalkActive) return;
        if (e.code === 'Space') {
            rc.pauseProducer(RoomClient.mediaType.audio);
            rc.updatePeerInfo(peer_name, socket.id, 'audio', false);
            isSpaceDown = false;
            console.log('Push-to-talk: audio paused');
        }
    });
    // room
    switchBroadcasting.onchange = (e) => {
        isBroadcastingEnabled = e.currentTarget.checked;
        rc.roomAction('broadcasting');
        localStorageSettings.broadcasting = isBroadcastingEnabled;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchLobby.onchange = (e) => {
        isLobbyEnabled = e.currentTarget.checked;
        rc.roomAction(isLobbyEnabled ? 'lobbyOn' : 'lobbyOff');
        rc.lobbyToggle();
        localStorageSettings.lobby = isLobbyEnabled;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchPitchBar.onchange = (e) => {
        isPitchBarEnabled = e.currentTarget.checked;
        rc.roomMessage('pitchBar', isPitchBarEnabled);
        localStorageSettings.pitch_bar = isPitchBarEnabled;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchSounds.onchange = (e) => {
        isSoundEnabled = e.currentTarget.checked;
        rc.roomMessage('sounds', isSoundEnabled);
        localStorageSettings.sounds = isSoundEnabled;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchShare.onchange = (e) => {
        notify = e.currentTarget.checked;
        rc.roomMessage('notify', notify);
        localStorageSettings.share_on_join = notify;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    // audio options
    switchAutoGainControl.onchange = (e) => {
        localStorageSettings.mic_auto_gain_control = e.currentTarget.checked;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchEchoCancellation.onchange = (e) => {
        localStorageSettings.mic_echo_cancellations = e.currentTarget.checked;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchNoiseSuppression.onchange = (e) => {
        localStorageSettings.mic_noise_suppression = e.currentTarget.checked;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    sampleRateSelect.onchange = (e) => {
        localStorageSettings.mic_sample_rate = e.currentTarget.selectedIndex;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    sampleSizeSelect.onchange = (e) => {
        localStorageSettings.mic_sample_size = e.currentTarget.selectedIndex;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    channelCountSelect.onchange = (e) => {
        localStorageSettings.mic_channel_count = e.currentTarget.selectedIndex;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    micLatencyRange.oninput = (e) => {
        localStorageSettings.mic_latency = e.currentTarget.value;
        lS.setSettings(localStorageSettings);
        micLatencyValue.innerText = e.currentTarget.value;
        e.target.blur();
    };
    micVolumeRange.oninput = (e) => {
        localStorageSettings.mic_volume = e.currentTarget.value;
        lS.setSettings(localStorageSettings);
        micVolumeValue.innerText = e.currentTarget.value;
        e.target.blur();
    };
    // recording
    switchHostOnlyRecording.onchange = (e) => {
        hostOnlyRecording = e.currentTarget.checked;
        rc.roomAction(hostOnlyRecording ? 'hostOnlyRecordingOn' : 'hostOnlyRecordingOff');
        localStorageSettings.host_only_recording = hostOnlyRecording;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchH264Recording.onchange = (e) => {
        recPrioritizeH264 = e.currentTarget.checked;
        rc.roomMessage('recPrioritizeH264', recPrioritizeH264);
        localStorageSettings.rec_prioritize_h264 = recPrioritizeH264;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchServerRecording.onchange = (e) => {
        rc.recSyncServerRecording = e.currentTarget.checked;
        rc.roomMessage('recSyncServer', rc.recSyncServerRecording);
        localStorageSettings.rec_server = rc.recSyncServerRecording;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    // styling
    keepCustomTheme.onchange = (e) => {
        themeCustom.keep = e.currentTarget.checked;
        selectTheme.disabled = themeCustom.keep;
        rc.roomMessage('customThemeKeep', themeCustom.keep);
        localStorageSettings.theme_custom = themeCustom.keep;
        localStorageSettings.theme_color = themeCustom.color;
        lS.setSettings(localStorageSettings);
        setTheme();
        e.target.blur();
    };
    BtnAspectRatio.onchange = () => {
        setAspectRatio(BtnAspectRatio.value);
    };
    BtnVideoObjectFit.onchange = () => {
        rc.handleVideoObjectFit(BtnVideoObjectFit.value);
        localStorageSettings.video_obj_fit = BtnVideoObjectFit.selectedIndex;
        lS.setSettings(localStorageSettings);
    }; // cover
    BtnVideoControls.onchange = () => {
        rc.handleVideoControls(BtnVideoControls.value);
        localStorageSettings.video_controls = BtnVideoControls.selectedIndex;
        lS.setSettings(localStorageSettings);
    };
    selectTheme.onchange = () => {
        localStorageSettings.theme = selectTheme.selectedIndex;
        lS.setSettings(localStorageSettings);
        setTheme();
    };
    BtnsBarPosition.onchange = () => {
        rc.changeBtnsBarPosition(BtnsBarPosition.value);
        localStorageSettings.buttons_bar = BtnsBarPosition.selectedIndex;
        lS.setSettings(localStorageSettings);
        refreshMainButtonsToolTipPlacement();
        resizeMainButtons();
    };
    pinVideoPosition.onchange = () => {
        rc.toggleVideoPin(pinVideoPosition.value);
        localStorageSettings.pin_grid = pinVideoPosition.selectedIndex;
        lS.setSettings(localStorageSettings);
    };
    // chat
    showChatOnMsg.onchange = (e) => {
        rc.showChatOnMessage = e.currentTarget.checked;
        rc.roomMessage('showChat', rc.showChatOnMessage);
        localStorageSettings.show_chat_on_msg = rc.showChatOnMessage;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    speechIncomingMsg.onchange = (e) => {
        rc.speechInMessages = e.currentTarget.checked;
        rc.roomMessage('speechMessages', rc.speechInMessages);
        localStorageSettings.speech_in_msg = rc.speechInMessages;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    // transcript
    transcriptPersistentMode.onchange = (e) => {
        transcription.isPersistentMode = e.currentTarget.checked;
        rc.roomMessage('transcriptIsPersistentMode', transcription.isPersistentMode);
        localStorageSettings.transcript_persistent_mode = transcription.isPersistentMode;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    transcriptShowOnMsg.onchange = (e) => {
        transcription.showOnMessage = e.currentTarget.checked;
        rc.roomMessage('transcriptShowOnMsg', transcription.showOnMessage);
        localStorageSettings.transcript_show_on_msg = transcription.showOnMessage;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    // whiteboard options
    wbDrawingColorEl.onchange = () => {
        wbCanvas.freeDrawingBrush.color = wbDrawingColorEl.value;
        whiteboardIsDrawingMode(true);
    };
    wbBackgroundColorEl.onchange = () => {
        setWhiteboardBgColor(wbBackgroundColorEl.value);
    };
    whiteboardGhostButton.onclick = (e) => {
        wbIsBgTransparent = !wbIsBgTransparent;
        wbIsBgTransparent ? wbCanvasBackgroundColor('rgba(0, 0, 0, 0.100)') : setTheme();
    };
    // room moderator rules
    switchEveryoneMute.onchange = (e) => {
        const audioStartMuted = e.currentTarget.checked;
        rc.updateRoomModerator({ type: 'audio_start_muted', status: audioStartMuted });
        rc.roomMessage('audio_start_muted', audioStartMuted);
        localStorageSettings.moderator_audio_start_muted = audioStartMuted;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchEveryoneHidden.onchange = (e) => {
        const videoStartHidden = e.currentTarget.checked;
        rc.updateRoomModerator({ type: 'video_start_hidden', status: videoStartHidden });
        rc.roomMessage('video_start_hidden', videoStartHidden);
        localStorageSettings.moderator_video_start_hidden = videoStartHidden;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchEveryoneCantUnmute.onchange = (e) => {
        const audioCantUnmute = e.currentTarget.checked;
        rc.updateRoomModerator({ type: 'audio_cant_unmute', status: audioCantUnmute });
        rc.roomMessage('audio_cant_unmute', audioCantUnmute);
        localStorageSettings.moderator_audio_cant_unmute = audioCantUnmute;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchEveryoneCantUnhide.onchange = (e) => {
        const videoCantUnhide = e.currentTarget.checked;
        rc.updateRoomModerator({ type: 'video_cant_unhide', status: videoCantUnhide });
        rc.roomMessage('video_cant_unhide', videoCantUnhide);
        localStorageSettings.moderator_video_cant_unhide = videoCantUnhide;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchEveryoneCantShareScreen.onchange = (e) => {
        const screenCantShare = e.currentTarget.checked;
        rc.updateRoomModerator({ type: 'screen_cant_share', status: screenCantShare });
        rc.roomMessage('screen_cant_share', screenCantShare);
        localStorageSettings.moderator_screen_cant_share = screenCantShare;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchEveryoneCantChatPrivately.onchange = (e) => {
        const chatCantPrivately = e.currentTarget.checked;
        rc.updateRoomModerator({ type: 'chat_cant_privately', status: chatCantPrivately });
        rc.roomMessage('chat_cant_privately', chatCantPrivately);
        localStorageSettings.moderator_chat_cant_privately = chatCantPrivately;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchEveryoneCantChatChatGPT.onchange = (e) => {
        const chatCantChatGPT = e.currentTarget.checked;
        rc.updateRoomModerator({ type: 'chat_cant_chatgpt', status: chatCantChatGPT });
        rc.roomMessage('chat_cant_chatgpt', chatCantChatGPT);
        localStorageSettings.moderator_chat_cant_chatgpt = chatCantChatGPT;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchDisconnectAllOnLeave.onchange = (e) => {
        const disconnectAll = e.currentTarget.checked;
        rc.roomMessage('disconnect_all_on_leave', disconnectAll);
        localStorageSettings.moderator_disconnect_all_on_leave = disconnectAll;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
}

// ####################################################
// HTML INPUTS
// ####################################################

function handleInputs() {
    chatMessage.onkeyup = (e) => {
        if (e.keyCode === 13 && (DetectRTC.isMobileDevice || !e.shiftKey)) {
            e.preventDefault();
            chatSendButton.click();
        }
    };
    chatMessage.oninput = function () {
        const chatInputEmoji = {
            '<3': '❤️',
            '</3': '💔',
            ':D': '😀',
            ':)': '😃',
            ';)': '😉',
            ':(': '😒',
            ':p': '😛',
            ';p': '😜',
            ":'(": '😢',
            ':+1:': '👍',
            ':*': '😘',
            ':O': '😲',
            ':|': '😐',
            ':*(': '😭',
            XD: '😆',
            ':B': '😎',
            ':P': '😜',
            '<(': '👎',
            '>:(': '😡',
            ':S': '😟',
            ':X': '🤐',
            ';(': '😥',
            ':T': '😖',
            ':@': '😠',
            ':$': '🤑',
            ':&': '🤗',
            ':#': '🤔',
            ':!': '😵',
            ':W': '😷',
            ':%': '🤒',
            ':*!': '🤩',
            ':G': '😬',
            ':R': '😋',
            ':M': '🤮',
            ':L': '🥴',
            ':C': '🥺',
            ':F': '🥳',
            ':Z': '🤢',
            ':^': '🤓',
            ':K': '🤫',
            ':D!': '🤯',
            ':H': '🧐',
            ':U': '🤥',
            ':V': '🤪',
            ':N': '🥶',
            ':J': '🥴',
        };
        // Create a regular expression pattern for all keys in chatInputEmoji
        const regexPattern = new RegExp(
            Object.keys(chatInputEmoji)
                .map((key) => key.replace(/([()[{*+.$^\\|?])/g, '\\$1'))
                .join('|'),
            'gim',
        );
        // Replace matching patterns with corresponding emojis
        this.value = this.value.replace(regexPattern, (match) => chatInputEmoji[match]);

        rc.checkLineBreaks();
    };

    chatMessage.onpaste = () => {
        isChatPasteTxt = true;
        rc.checkLineBreaks();
    };
}

// ####################################################
// EMOJI PIKER
// ####################################################

function handleChatEmojiPicker() {
    const pickerOptions = {
        theme: 'dark',
        onEmojiSelect: addEmojiToMsg,
    };
    const emojiPicker = new EmojiMart.Picker(pickerOptions);
    rc.getId('chatEmoji').appendChild(emojiPicker);

    function addEmojiToMsg(data) {
        chatMessage.value += data.native;
        rc.toggleChatEmoji();
    }
}

function handleRoomEmojiPicker() {
    const pickerRoomOptions = {
        theme: 'dark',
        onEmojiSelect: sendEmojiToRoom,
    };

    const emojiRoomPicker = new EmojiMart.Picker(pickerRoomOptions);
    emojiPickerContainer.appendChild(emojiRoomPicker);
    emojiPickerContainer.style.display = 'none';

    emojiRoomButton.onclick = () => {
        toggleEmojiPicker();
    };
    closeEmojiPickerContainer.onclick = () => {
        toggleEmojiPicker();
    };

    function sendEmojiToRoom(data) {
        console.log('Selected Emoji', data.native);
        const cmd = {
            type: 'roomEmoji',
            peer_name: peer_name,
            emoji: data.native,
            broadcast: true,
        };
        if (rc.thereAreParticipants()) {
            rc.emitCmd(cmd);
        }
        rc.handleCmd(cmd);
        // toggleEmojiPicker();
    }

    function toggleEmojiPicker() {
        if (emojiPickerContainer.style.display === 'block') {
            emojiPickerContainer.style.display = 'none';
            setColor(emojiRoomButton, 'white');
        } else {
            emojiPickerContainer.style.display = 'block';
            setColor(emojiRoomButton, 'yellow');
        }
    }
}

// ####################################################
// LOAD SETTINGS FROM LOCAL STORAGE
// ####################################################

function loadSettingsFromLocalStorage() {
    rc.showChatOnMessage = localStorageSettings.show_chat_on_msg;
    transcription.isPersistentMode = localStorageSettings.transcript_persistent_mode;
    transcription.showOnMessage = localStorageSettings.transcript_show_on_msg;
    rc.speechInMessages = localStorageSettings.speech_in_msg;
    isPitchBarEnabled = localStorageSettings.pitch_bar;
    isSoundEnabled = localStorageSettings.sounds;
    showChatOnMsg.checked = rc.showChatOnMessage;
    transcriptPersistentMode.checked = transcription.isPersistentMode;
    transcriptShowOnMsg.checked = transcription.showOnMessage;
    speechIncomingMsg.checked = rc.speechInMessages;
    switchPitchBar.checked = isPitchBarEnabled;
    switchSounds.checked = isSoundEnabled;
    switchShare.checked = notify;

    recPrioritizeH264 = localStorageSettings.rec_prioritize_h264;
    switchH264Recording.checked = recPrioritizeH264;

    switchServerRecording.checked = localStorageSettings.rec_server;

    keepCustomTheme.checked = themeCustom.keep;
    selectTheme.disabled = themeCustom.keep;
    themeCustom.input.value = themeCustom.color;

    switchAutoGainControl.checked = localStorageSettings.mic_auto_gain_control;
    switchEchoCancellation.checked = localStorageSettings.mic_echo_cancellations;
    switchNoiseSuppression.checked = localStorageSettings.mic_noise_suppression;
    sampleRateSelect.selectedIndex = localStorageSettings.mic_sample_rate;
    sampleSizeSelect.selectedIndex = localStorageSettings.mic_sample_size;
    channelCountSelect.selectedIndex = localStorageSettings.mic_channel_count;

    micLatencyRange.value = localStorageSettings.mic_latency || 50;
    micLatencyValue.innerText = localStorageSettings.mic_latency || 50;
    micVolumeRange.value = localStorageSettings.mic_volume || 100;
    micVolumeValue.innerText = localStorageSettings.mic_volume || 100;

    videoFps.selectedIndex = localStorageSettings.video_fps;
    screenFps.selectedIndex = localStorageSettings.screen_fps;
    BtnVideoObjectFit.selectedIndex = localStorageSettings.video_obj_fit;
    BtnVideoControls.selectedIndex = localStorageSettings.video_controls;
    BtnsBarPosition.selectedIndex = localStorageSettings.buttons_bar;
    pinVideoPosition.selectedIndex = localStorageSettings.pin_grid;
    rc.handleVideoObjectFit(BtnVideoObjectFit.value);
    rc.handleVideoControls(BtnVideoControls.value);
    rc.changeBtnsBarPosition(BtnsBarPosition.value);
    rc.toggleVideoPin(pinVideoPosition.value);
    refreshMainButtonsToolTipPlacement();
    resizeMainButtons();
}

// ####################################################
// ROOM CLIENT EVENT LISTNERS
// ####################################################

function handleRoomClientEvents() {
    rc.on(RoomClient.EVENTS.startRec, () => {
        console.log('Room event: Client start recoding');
        hide(startRecButton);
        show(stopRecButton);
        show(pauseRecButton);
        show(recordingTime);
        startRecordingTimer();
        isRecording = true;
        rc.updatePeerInfo(peer_name, socket.id, 'recording', true);
    });
    rc.on(RoomClient.EVENTS.pauseRec, () => {
        console.log('Room event: Client pause recoding');
        hide(pauseRecButton);
        show(resumeRecButton);
    });
    rc.on(RoomClient.EVENTS.resumeRec, () => {
        console.log('Room event: Client resume recoding');
        hide(resumeRecButton);
        show(pauseRecButton);
    });
    rc.on(RoomClient.EVENTS.stopRec, () => {
        console.log('Room event: Client stop recoding');
        hide(stopRecButton);
        hide(pauseRecButton);
        hide(resumeRecButton);
        hide(recordingTime);
        show(startRecButton);
        stopRecordingTimer();
        isRecording = false;
        rc.updatePeerInfo(peer_name, socket.id, 'recording', false);
    });
    rc.on(RoomClient.EVENTS.raiseHand, () => {
        console.log('Room event: Client raise hand');
        hide(raiseHandButton);
        show(lowerHandButton);
        setColor(lowerHandIcon, 'lime');
    });
    rc.on(RoomClient.EVENTS.lowerHand, () => {
        console.log('Room event: Client lower hand');
        hide(lowerHandButton);
        show(raiseHandButton);
        setColor(lowerHandIcon, 'white');
    });
    rc.on(RoomClient.EVENTS.startAudio, () => {
        console.log('Room event: Client start audio');
        hide(startAudioButton);
        show(stopAudioButton);
        setColor(startAudioButton, 'red');
        setAudioButtonsDisabled(false);
    });
    rc.on(RoomClient.EVENTS.pauseAudio, () => {
        console.log('Room event: Client pause audio');
        hide(stopAudioButton);
        show(startAudioButton);
    });
    rc.on(RoomClient.EVENTS.resumeAudio, () => {
        console.log('Room event: Client resume audio');
        hide(startAudioButton);
        show(stopAudioButton);
    });
    rc.on(RoomClient.EVENTS.stopAudio, () => {
        console.log('Room event: Client stop audio');
        hide(stopAudioButton);
        show(startAudioButton);
        setAudioButtonsDisabled(false);
        stopMicrophoneProcessing();
    });
    rc.on(RoomClient.EVENTS.startVideo, () => {
        console.log('Room event: Client start video');
        hide(startVideoButton);
        show(stopVideoButton);
        setColor(startVideoButton, 'red');
        setVideoButtonsDisabled(false);
        // if (isParticipantsListOpen) getRoomParticipants();
    });
    rc.on(RoomClient.EVENTS.pauseVideo, () => {
        console.log('Room event: Client pause video');
        hide(stopVideoButton);
        show(startVideoButton);
    });
    rc.on(RoomClient.EVENTS.resumeVideo, () => {
        console.log('Room event: Client resume video');
        hide(startVideoButton);
        show(stopVideoButton);
    });
    rc.on(RoomClient.EVENTS.stopVideo, () => {
        console.log('Room event: Client stop video');
        hide(stopVideoButton);
        show(startVideoButton);
        setVideoButtonsDisabled(false);
        isVideoPrivacyActive = false;
        // if (isParticipantsListOpen) getRoomParticipants();
    });
    rc.on(RoomClient.EVENTS.startScreen, () => {
        console.log('Room event: Client start screen');
        hide(startScreenButton);
        show(stopScreenButton);
        // if (isParticipantsListOpen) getRoomParticipants();
    });
    rc.on(RoomClient.EVENTS.pauseScreen, () => {
        console.log('Room event: Client pause screen');
    });
    rc.on(RoomClient.EVENTS.resumeScreen, () => {
        console.log('Room event: Client resume screen');
    });
    rc.on(RoomClient.EVENTS.stopScreen, () => {
        console.log('Room event: Client stop screen');
        hide(stopScreenButton);
        show(startScreenButton);
        // if (isParticipantsListOpen) getRoomParticipants();
    });
    rc.on(RoomClient.EVENTS.roomLock, () => {
        console.log('Room event: Client lock room');
        hide(lockRoomButton);
        show(unlockRoomButton);
        setColor(unlockRoomButton, 'red');
        isRoomLocked = true;
    });
    rc.on(RoomClient.EVENTS.roomUnlock, () => {
        console.log('Room event: Client unlock room');
        hide(unlockRoomButton);
        show(lockRoomButton);
        isRoomLocked = false;
    });
    rc.on(RoomClient.EVENTS.lobbyOn, () => {
        console.log('Room event: Client room lobby enabled');
        if (isRulesActive && !isPresenter) {
            hide(lobbyButton);
        }
        sound('lobby');
        isLobbyEnabled = true;
    });
    rc.on(RoomClient.EVENTS.lobbyOff, () => {
        console.log('Room event: Client room lobby disabled');
        isLobbyEnabled = false;
    });
    rc.on(RoomClient.EVENTS.hostOnlyRecordingOn, () => {
        if (isRulesActive && !isPresenter) {
            console.log('Room event: host only recording enabled');
            // Stop recording ...
            if (rc.isRecording() || recordingStatus.innerText != '0s') {
                rc.saveRecording('Room event: host only recording enabled, going to stop recording');
            }
            hide(startRecButton);
            hide(recordingImage);
            hide(roomHostOnlyRecording);
            hide(roomRecordingOptions);
            hide(roomRecordingServer);
            show(recordingMessage);
            hostOnlyRecording = true;
        }
    });
    rc.on(RoomClient.EVENTS.hostOnlyRecordingOff, () => {
        if (isRulesActive && !isPresenter) {
            console.log('Room event: host only recording disabled');
            show(startRecButton);
            show(recordingImage);
            hide(roomHostOnlyRecording);
            hide(recordingMessage);
            hostOnlyRecording = false;
        }
    });
    rc.on(RoomClient.EVENTS.exitRoom, () => {
        console.log('Room event: Client leave room');
        if (rc.isRecording() || recordingStatus.innerText != '0s') {
            rc.saveRecording('Room event: Client save recording before to exit');
        }
        if (survey && survey.enabled) {
            leaveFeedback();
        } else {
            redirectOnLeave();
        }
    });
}

// ####################################################
// UTILITY
// ####################################################

function leaveFeedback() {
    Swal.fire({
        allowOutsideClick: false,
        allowEscapeKey: false,
        showDenyButton: true,
        background: swalBackground,
        imageUrl: image.feedback,
        title: 'Leave a feedback',
        text: 'Do you want to rate your MiroTalk experience?',
        confirmButtonText: `Yes`,
        denyButtonText: `No`,
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    }).then((result) => {
        if (result.isConfirmed) {
            openURL(survey.url);
        } else {
            redirectOnLeave();
        }
    });
}

function redirectOnLeave() {
    redirect && redirect.enabled ? openURL(redirect.url) : openURL('/newroom');
}

function userLog(icon, message, position, timer = 3000) {
    const Toast = Swal.mixin({
        background: swalBackground,
        toast: true,
        position: position,
        showConfirmButton: false,
        timer: timer,
        timerProgressBar: true,
    });
    Toast.fire({
        icon: icon,
        title: message,
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    });
}

function saveDataToFile(dataURL, fileName) {
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = dataURL;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(dataURL);
    }, 100);
}

function saveObjToJsonFile(dataObj, name) {
    console.log('Save data', { dataObj: dataObj, name: name });
    const dataTime = getDataTimeString();
    let a = document.createElement('a');
    a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(dataObj, null, 1));
    a.download = `${dataTime}-${name}.txt`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 100);
    sound('download');
}

function getDataTimeString() {
    const d = new Date();
    const date = d.toISOString().split('T')[0];
    const time = d.toTimeString().split(' ')[0];
    return `${date}-${time}`;
}

function getDataTimeStringFormat() {
    const d = new Date();
    const date = d.toISOString().split('T')[0].replace(/-/g, '_');
    const time = d.toTimeString().split(' ')[0].replace(/:/g, '_');
    return `${date}_${time}`;
}

function getUUID() {
    const uuid4 = ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16),
    );
    if (window.localStorage.uuid) {
        return window.localStorage.uuid;
    }
    window.localStorage.uuid = uuid4;
    return uuid4;
}

function showButtons() {
    if (
        isButtonsBarOver ||
        isButtonsVisible ||
        (rc.isMobileDevice && rc.isChatOpen) ||
        (rc.isMobileDevice && rc.isMySettingsOpen)
    )
        return;
    toggleClassElements('videoMenuBar', 'inline');
    control.style.display = 'flex';
    isButtonsVisible = true;
}

function checkButtonsBar() {
    if (!isButtonsBarOver) {
        toggleClassElements('videoMenuBar', 'none');
        control.style.display = 'none';
        isButtonsVisible = false;
    }
    setTimeout(() => {
        checkButtonsBar();
    }, 10000);
}

function toggleClassElements(className, displayState) {
    let elements = rc.getEcN(className);
    for (let i = 0; i < elements.length; i++) {
        elements[i].style.display = displayState;
    }
}

function setAudioButtonsDisabled(disabled) {
    startAudioButton.disabled = disabled;
    stopAudioButton.disabled = disabled;
}

function setVideoButtonsDisabled(disabled) {
    startVideoButton.disabled = disabled;
    stopVideoButton.disabled = disabled;
}

async function sound(name, force = false) {
    if (!isSoundEnabled && !force) return;
    let sound = '../sounds/' + name + '.wav';
    let audio = new Audio(sound);
    try {
        audio.volume = 0.5;
        await audio.play();
    } catch (err) {
        return false;
    }
}

function isImageURL(url) {
    return url.match(/\.(jpeg|jpg|gif|png|tiff|bmp)$/) != null;
}

function isMobile(userAgent) {
    return !!/Android|webOS|iPhone|iPad|iPod|BB10|BlackBerry|IEMobile|Opera Mini|Mobile|mobile/i.test(userAgent || '');
}

function isTablet(userAgent) {
    return /(ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk|(puffin(?!.*(IP|AP|WP))))/.test(
        userAgent,
    );
}

function isIpad(userAgent) {
    return /macintosh/.test(userAgent) && 'ontouchend' in document;
}

function openURL(url, blank = false) {
    blank ? window.open(url, '_blank') : (window.location.href = url);
}

function bytesToSize(bytes) {
    let sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes == 0) return '0 Byte';
    let i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
}

function setCookie(name, value, expDays) {
    let date = new Date();
    date.setTime(date.getTime() + expDays * 24 * 60 * 60 * 1000);
    const expires = 'expires=' + date.toUTCString();
    document.cookie = name + '=' + value + '; ' + expires + '; path=/';
}

function getCookie(cName) {
    const name = cName + '=';
    const cDecoded = decodeURIComponent(document.cookie);
    const cArr = cDecoded.split('; ');
    let res;
    cArr.forEach((val) => {
        if (val.indexOf(name) === 0) res = val.substring(name.length);
    });
    return res;
}

function isHtml(str) {
    var a = document.createElement('div');
    a.innerHTML = str;
    for (var c = a.childNodes, i = c.length; i--; ) {
        if (c[i].nodeType == 1) return true;
    }
    return false;
}

function getId(id) {
    return document.getElementById(id);
}

// ####################################################
// HANDLE WHITEBOARD
// ####################################################

function toggleWhiteboard() {
    if (!wbIsOpen) rc.sound('open');
    whiteboardCenter();
    whiteboard.classList.toggle('show');
    wbIsOpen = !wbIsOpen;
}

function whiteboardCenter() {
    whiteboard.style.top = '50%';
    whiteboard.style.left = '50%';
}

function setupWhiteboard() {
    setupWhiteboardCanvas();
    setupWhiteboardCanvasSize();
    setupWhiteboardLocalListners();
}

function setupWhiteboardCanvas() {
    wbCanvas = new fabric.Canvas('wbCanvas');
    wbCanvas.freeDrawingBrush.color = '#FFFFFF';
    wbCanvas.freeDrawingBrush.width = 3;
    whiteboardIsDrawingMode(true);
}

function setupWhiteboardCanvasSize() {
    let optimalSize = [wbWidth, wbHeight];
    let scaleFactorX = window.innerWidth / optimalSize[0];
    let scaleFactorY = window.innerHeight / optimalSize[1];
    if (scaleFactorX < scaleFactorY && scaleFactorX < 1) {
        wbCanvas.setWidth(optimalSize[0] * scaleFactorX);
        wbCanvas.setHeight(optimalSize[1] * scaleFactorX);
        wbCanvas.setZoom(scaleFactorX);
        setWhiteboardSize(optimalSize[0] * scaleFactorX, optimalSize[1] * scaleFactorX);
    } else if (scaleFactorX > scaleFactorY && scaleFactorY < 1) {
        wbCanvas.setWidth(optimalSize[0] * scaleFactorY);
        wbCanvas.setHeight(optimalSize[1] * scaleFactorY);
        wbCanvas.setZoom(scaleFactorY);
        setWhiteboardSize(optimalSize[0] * scaleFactorY, optimalSize[1] * scaleFactorY);
    } else {
        wbCanvas.setWidth(optimalSize[0]);
        wbCanvas.setHeight(optimalSize[1]);
        wbCanvas.setZoom(1);
        setWhiteboardSize(optimalSize[0], optimalSize[1]);
    }
    wbCanvas.calcOffset();
    wbCanvas.renderAll();
}

function setWhiteboardSize(w, h) {
    document.documentElement.style.setProperty('--wb-width', w);
    document.documentElement.style.setProperty('--wb-height', h);
}

function setWhiteboardBgColor(color) {
    let data = {
        peer_name: peer_name,
        action: 'bgcolor',
        color: color,
    };
    whiteboardAction(data);
}

function whiteboardIsDrawingMode(status) {
    wbCanvas.isDrawingMode = status;
    if (status) {
        setColor(whiteboardPencilBtn, 'green');
        setColor(whiteboardObjectBtn, 'white');
        setColor(whiteboardEraserBtn, 'white');
        wbIsEraser = false;
    } else {
        setColor(whiteboardPencilBtn, 'white');
        setColor(whiteboardObjectBtn, 'green');
    }
}

function whiteboardIsEraser(status) {
    whiteboardIsDrawingMode(false);
    wbIsEraser = status;
    setColor(whiteboardEraserBtn, wbIsEraser ? 'green' : 'white');
}

function whiteboardAddObj(type) {
    switch (type) {
        case 'imgUrl':
            Swal.fire({
                background: swalBackground,
                title: 'Image URL',
                input: 'text',
                showCancelButton: true,
                confirmButtonText: 'OK',
                showClass: { popup: 'animate__animated animate__fadeInDown' },
                hideClass: { popup: 'animate__animated animate__fadeOutUp' },
            }).then((result) => {
                if (result.isConfirmed) {
                    let wbCanvasImgURL = result.value;
                    if (isImageURL(wbCanvasImgURL)) {
                        fabric.Image.fromURL(wbCanvasImgURL, function (myImg) {
                            addWbCanvasObj(myImg);
                        });
                    } else {
                        userLog('error', 'The URL is not a valid image', 'top-end');
                    }
                }
            });
            break;
        case 'imgFile':
            Swal.fire({
                allowOutsideClick: false,
                background: swalBackground,
                position: 'center',
                title: 'Select the image',
                input: 'file',
                inputAttributes: {
                    accept: wbImageInput,
                    'aria-label': 'Select the image',
                },
                showDenyButton: true,
                confirmButtonText: `OK`,
                denyButtonText: `Cancel`,
                showClass: { popup: 'animate__animated animate__fadeInDown' },
                hideClass: { popup: 'animate__animated animate__fadeOutUp' },
            }).then((result) => {
                if (result.isConfirmed) {
                    let wbCanvasImg = result.value;
                    if (wbCanvasImg && wbCanvasImg.size > 0) {
                        let reader = new FileReader();
                        reader.onload = function (event) {
                            let imgObj = new Image();
                            imgObj.src = event.target.result;
                            imgObj.onload = function () {
                                let image = new fabric.Image(imgObj);
                                image.set({ top: 0, left: 0 }).scale(0.3);
                                addWbCanvasObj(image);
                            };
                        };
                        reader.readAsDataURL(wbCanvasImg);
                    } else {
                        userLog('error', 'File not selected or empty', 'top-end');
                    }
                }
            });
            break;
        case 'pdfFile':
            Swal.fire({
                allowOutsideClick: false,
                background: swalBackground,
                position: 'center',
                title: 'Select the PDF',
                input: 'file',
                inputAttributes: {
                    accept: wbPdfInput,
                    'aria-label': 'Select the PDF',
                },
                showDenyButton: true,
                confirmButtonText: `OK`,
                denyButtonText: `Cancel`,
                showClass: { popup: 'animate__animated animate__fadeInDown' },
                hideClass: { popup: 'animate__animated animate__fadeOutUp' },
            }).then((result) => {
                if (result.isConfirmed) {
                    let wbCanvasPdf = result.value;
                    if (wbCanvasPdf && wbCanvasPdf.size > 0) {
                        let reader = new FileReader();
                        reader.onload = async function (event) {
                            wbCanvas.requestRenderAll();
                            await pdfToImage(event.target.result, wbCanvas);
                            whiteboardIsDrawingMode(false);
                            wbCanvasToJson();
                        };
                        reader.readAsDataURL(wbCanvasPdf);
                    } else {
                        userLog('error', 'File not selected or empty', 'top-end');
                    }
                }
            });
            break;
        case 'text':
            const text = new fabric.IText('Lorem Ipsum', {
                top: 0,
                left: 0,
                fontFamily: 'Comfortaa',
                fill: wbCanvas.freeDrawingBrush.color,
                strokeWidth: wbCanvas.freeDrawingBrush.width,
                stroke: wbCanvas.freeDrawingBrush.color,
            });
            addWbCanvasObj(text);
            break;
        case 'line':
            const line = new fabric.Line([50, 100, 200, 200], {
                top: 0,
                left: 0,
                fill: wbCanvas.freeDrawingBrush.color,
                strokeWidth: wbCanvas.freeDrawingBrush.width,
                stroke: wbCanvas.freeDrawingBrush.color,
            });
            addWbCanvasObj(line);
            break;
        case 'circle':
            const circle = new fabric.Circle({
                radius: 50,
                fill: 'transparent',
                stroke: wbCanvas.freeDrawingBrush.color,
                strokeWidth: wbCanvas.freeDrawingBrush.width,
            });
            addWbCanvasObj(circle);
            break;
        case 'rect':
            const rect = new fabric.Rect({
                top: 0,
                left: 0,
                width: 150,
                height: 100,
                fill: 'transparent',
                stroke: wbCanvas.freeDrawingBrush.color,
                strokeWidth: wbCanvas.freeDrawingBrush.width,
            });
            addWbCanvasObj(rect);
            break;
        case 'triangle':
            const triangle = new fabric.Triangle({
                top: 0,
                left: 0,
                width: 150,
                height: 100,
                fill: 'transparent',
                stroke: wbCanvas.freeDrawingBrush.color,
                strokeWidth: wbCanvas.freeDrawingBrush.width,
            });
            addWbCanvasObj(triangle);
            break;
        default:
            break;
    }
}

function readBlob(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(reader.result));
        reader.addEventListener('error', reject);
        reader.readAsDataURL(blob);
    });
}

async function loadPDF(pdfData, pages) {
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfData = pdfData instanceof Blob ? await readBlob(pdfData) : pdfData;
    const data = atob(pdfData.startsWith(Base64Prefix) ? pdfData.substring(Base64Prefix.length) : pdfData);
    try {
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        const numPages = pdf.numPages;
        const canvases = await Promise.all(
            Array.from({ length: numPages }, (_, i) => {
                const pageNumber = i + 1;
                if (pages && pages.indexOf(pageNumber) === -1) return null;
                return pdf.getPage(pageNumber).then(async (page) => {
                    const viewport = page.getViewport({ scale: window.devicePixelRatio });
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport,
                    };
                    await page.render(renderContext).promise;
                    return canvas;
                });
            }),
        );
        return canvases.filter((canvas) => canvas !== null);
    } catch (error) {
        console.error('Error loading PDF', error.message);
        throw error.message;
    }
}

async function pdfToImage(pdfData, canvas) {
    const scale = 1 / window.devicePixelRatio;
    try {
        const canvases = await loadPDF(pdfData);
        canvases.forEach(async (c) => {
            canvas.add(
                new fabric.Image(await c, {
                    scaleX: scale,
                    scaleY: scale,
                }),
            );
        });
    } catch (error) {
        console.error('Error converting PDF to images', error.message);
        throw error.message;
    }
}

function addWbCanvasObj(obj) {
    if (obj) {
        wbCanvas.add(obj).setActiveObject(obj);
        whiteboardIsDrawingMode(false);
        wbCanvasToJson();
    } else {
        console.error('Invalid input. Expected an obj of canvas elements');
    }
}

function setupWhiteboardLocalListners() {
    wbCanvas.on('mouse:down', function (e) {
        mouseDown(e);
    });
    wbCanvas.on('mouse:up', function () {
        mouseUp();
    });
    wbCanvas.on('mouse:move', function () {
        mouseMove();
    });
    wbCanvas.on('object:added', function () {
        objectAdded();
    });
}

function mouseDown(e) {
    wbIsDrawing = true;
    if (wbIsEraser && e.target) {
        wbCanvas.remove(e.target);
        return;
    }
}

function mouseUp() {
    wbIsDrawing = false;
    wbCanvasToJson();
}

function mouseMove() {
    if (wbIsEraser) {
        wbCanvas.hoverCursor = 'not-allowed';
        return;
    } else {
        wbCanvas.hoverCursor = 'move';
    }
    if (!wbIsDrawing) return;
}

function objectAdded() {
    if (!wbIsRedoing) wbPop = [];
    wbIsRedoing = false;
}

function wbCanvasBackgroundColor(color) {
    document.documentElement.style.setProperty('--wb-bg', color);
    wbBackgroundColorEl.value = color;
    wbCanvas.setBackgroundColor(color);
    wbCanvas.renderAll();
}

function wbCanvasUndo() {
    if (wbCanvas._objects.length > 0) {
        wbPop.push(wbCanvas._objects.pop());
        wbCanvas.renderAll();
    }
}

function wbCanvasRedo() {
    if (wbPop.length > 0) {
        wbIsRedoing = true;
        wbCanvas.add(wbPop.pop());
    }
}

function wbCanvasSaveImg() {
    const dataURL = wbCanvas.toDataURL({
        width: wbCanvas.getWidth(),
        height: wbCanvas.getHeight(),
        left: 0,
        top: 0,
        format: 'png',
    });
    const dataNow = getDataTimeString();
    const fileName = `whiteboard-${dataNow}.png`;
    saveDataToFile(dataURL, fileName);
}

function wbUpdate() {
    if (wbIsOpen && (!isRulesActive || isPresenter)) {
        console.log('IsPresenter: update whiteboard canvas to the participants in the room');
        wbCanvasToJson();
        whiteboardAction(getWhiteboardAction(wbIsLock ? 'lock' : 'unlock'));
    }
}

function wbCanvasToJson() {
    if (!isPresenter && wbIsLock) return;
    if (rc.thereAreParticipants()) {
        let wbCanvasJson = JSON.stringify(wbCanvas.toJSON());
        rc.socket.emit('wbCanvasToJson', wbCanvasJson);
    }
}

function JsonToWbCanvas(json) {
    if (!wbIsOpen) toggleWhiteboard();
    wbCanvas.loadFromJSON(json);
    wbCanvas.renderAll();
    if (!isPresenter && !wbCanvas.isDrawingMode && wbIsLock) {
        wbDrawing(false);
    }
}

function getWhiteboardAction(action) {
    return {
        peer_name: peer_name,
        action: action,
    };
}

function confirmClearBoard() {
    Swal.fire({
        background: swalBackground,
        imageUrl: image.delete,
        position: 'center',
        title: 'Clean the board',
        text: 'Are you sure you want to clean the board?',
        showDenyButton: true,
        confirmButtonText: `Yes`,
        denyButtonText: `No`,
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    }).then((result) => {
        if (result.isConfirmed) {
            whiteboardAction(getWhiteboardAction('clear'));
            sound('delete');
        }
    });
}

function whiteboardAction(data, emit = true) {
    if (emit) {
        if (rc.thereAreParticipants()) {
            rc.socket.emit('whiteboardAction', data);
        }
    } else {
        userLog(
            'info',
            `${data.peer_name} <i class="fas fa-chalkboard-teacher"></i> whiteboard action: ${data.action}`,
            'top-end',
        );
    }

    switch (data.action) {
        case 'bgcolor':
            wbCanvasBackgroundColor(data.color);
            break;
        case 'undo':
            wbCanvasUndo();
            break;
        case 'redo':
            wbCanvasRedo();
            break;
        case 'clear':
            wbCanvas.clear();
            break;
        case 'lock':
            if (!isPresenter) {
                elemDisplay('whiteboardTitle', false);
                elemDisplay('whiteboardOptions', false);
                elemDisplay('whiteboardButton', false);
                wbDrawing(false);
                wbIsLock = true;
            }
            break;
        case 'unlock':
            if (!isPresenter) {
                elemDisplay('whiteboardTitle', true, 'flex');
                elemDisplay('whiteboardOptions', true, 'inline');
                elemDisplay('whiteboardButton', true);
                wbDrawing(true);
                wbIsLock = false;
            }
            break;
        case 'close':
            if (wbIsOpen) toggleWhiteboard();
            break;
        default:
            break;
        //...
    }
}

function wbDrawing(status) {
    wbCanvas.isDrawingMode = status; // Disable free drawing
    wbCanvas.selection = status; // Disable object selection
    wbCanvas.forEachObject(function (obj) {
        obj.selectable = status; // Make all objects unselectable
    });
}

// ####################################################
// HANDLE PARTICIPANTS
// ####################################################

async function getRemotePeerInfo(peer_id) {
    const peers = await getRoomPeers();
    for (let peer of Array.from(peers.keys()).filter((id) => id === peer_id)) {
        return peers.get(peer).peer_info;
    }
    return false;
}

async function getRoomPeers() {
    let room_info = await rc.getRoomInfo();
    return new Map(JSON.parse(room_info.peers));
}

async function saveRoomPeers() {
    const peers = await getRoomPeers();
    let peersToSave = [];
    for (let peer of Array.from(peers.keys())) {
        peersToSave.push(peers.get(peer).peer_info);
    }
    saveObjToJsonFile(peersToSave, 'PARTICIPANTS');
}

async function getRoomParticipants() {
    const peers = await getRoomPeers();
    const lists = getParticipantsList(peers);
    participantsCount = peers.size;
    participantsList.innerHTML = lists;
    refreshParticipantsCount(participantsCount, false);
    setParticipantsTippy(peers);
    console.log('*** Refresh Chat participant lists ***');
}

function getParticipantsList(peers) {
    // CHAT-GPT
    let li = `
    <li 
        id="ChatGPT" 
        data-to-id="ChatGPT"
        data-to-name="ChatGPT"
        class="clearfix" 
        onclick="rc.showPeerAboutAndMessages(this.id, 'ChatGPT', event)"
    >
        <img 
            src="${image.chatgpt}"
            alt="avatar"
        />
        <div class="about">
            <div class="name">ChatGPT</div>
            <div class="status"><i class="fa fa-circle online"></i> online</div>
        </div>
    </li>
    `;

    // ALL
    li += `
    <li id="all"
        data-to-id="all"
        data-to-name="all"
        class="clearfix active" 
        onclick="rc.showPeerAboutAndMessages(this.id, 'all', event)"
    >
        <img 
            src="${image.all}"
            alt="avatar"
        />
        <div class="about">
            <div class="name">Public chat</div>
            <div class="status"> <i class="fa fa-circle online"></i> online ${participantsCount}</div>
        </div>`;

    // ONLY PRESENTER CAN EXECUTE THIS CMD
    if (!isRulesActive || isPresenter) {
        li += `
        <div style="class="dropdown">
            <button 
                class="dropdown-toggle" 
                type="button" 
                id="${socket.id}-chatDropDownMenu" 
                data-bs-toggle="dropdown" 
                aria-expanded="false"
                style="float: right"
            >
            <!-- <i class="fas fa-bars"></i> -->
            <i class="fas fa-ellipsis-vertical"></i>
            </button>
            <ul class="dropdown-menu text-start" aria-labelledby="${socket.id}-chatDropDownMenu">`;

        if (BUTTONS.participantsList.sendFileAllButton) {
            li += `<li><button class="btn-sm ml5" id="sendAllButton" onclick="rc.selectFileToShare('${socket.id}', true)">${_PEER.sendFile} Share file to all</button></li>`;
        }

        li += `<li><button class="btn-sm ml5" id="sendVideoToAll" onclick="rc.shareVideo('all');">${_PEER.sendVideo} Share audio/video to all</button></li>`;

        if (BUTTONS.participantsList.ejectAllButton) {
            li += `<li><button class="btn-sm ml5" id="ejectAllButton" onclick="rc.peerAction('me','${socket.id}','eject',true,true)">${_PEER.ejectPeer} Eject all participants</button></li>`;
        }

        li += `</ul>
        </div>

        <br/>

        <div class="about-buttons mt5">
            <button class="ml5" id="muteAllButton" onclick="rc.peerAction('me','${socket.id}','mute',true,true)">${_PEER.audioOff}</button>
            <button class="ml5" id="hideAllButton" onclick="rc.peerAction('me','${socket.id}','hide',true,true)">${_PEER.videoOff}</button>
            <button class="ml5" id="stopAllButton" onclick="rc.peerAction('me','${socket.id}','stop',true,true)">${_PEER.screenOff}</button>
        </div>`;
    }

    li += `
    </li>
    `;

    // PEERS IN THE CURRENT ROOM
    for (const peer of Array.from(peers.keys())) {
        const peer_info = peers.get(peer).peer_info;
        const peer_name = peer_info.peer_name;
        const peer_name_limited = peer_name.length > 15 ? peer_name.substring(0, 10) + '*****' : peer_name;
        //const peer_presenter = peer_info.peer_presenter ? _PEER.presenter : _PEER.guest;
        const peer_audio = peer_info.peer_audio ? _PEER.audioOn : _PEER.audioOff;
        const peer_video = peer_info.peer_video ? _PEER.videoOn : _PEER.videoOff;
        const peer_screen = peer_info.peer_screen ? _PEER.screenOn : _PEER.screenOff;
        const peer_hand = peer_info.peer_hand ? _PEER.raiseHand : _PEER.lowerHand;
        const peer_ban = _PEER.banPeer;
        const peer_eject = _PEER.ejectPeer;
        const peer_geoLocation = _PEER.geoLocation;
        const peer_sendFile = _PEER.sendFile;
        const peer_id = peer_info.peer_id;
        const avatarImg = getParticipantAvatar(peer_name);

        // NOT ME
        if (socket.id !== peer_id) {
            // PRESENTER HAS MORE OPTIONS
            if (isRulesActive && isPresenter) {
                li += `
                <li 
                    id='${peer_id}'
                    data-to-id="${peer_id}" 
                    data-to-name="${peer_name}"
                    class="clearfix" 
                    onclick="rc.showPeerAboutAndMessages(this.id, '${peer_name}', event)"
                >
                    <img
                        src="${avatarImg}"
                        alt="avatar" 
                    />
                    <div class="about">
                        <div class="name">${peer_name_limited}</div>
                        <div class="status"> <i class="fa fa-circle online"></i> online <i id="${peer_id}-unread-msg" class="fas fa-comments hidden"></i> </div>
                    </div>

                    <div style="class="dropdown">
                        <button 
                            class="dropdown-toggle" 
                            type="button" 
                            id="${peer_id}-chatDropDownMenu" 
                            data-bs-toggle="dropdown" 
                            aria-expanded="false"
                            style="float: right"
                        >
                        <!-- <i class="fas fa-bars"></i> -->
                        <i class="fas fa-ellipsis-vertical"></i>
                        </button>
                        <ul class="dropdown-menu text-start" aria-labelledby="${peer_id}-chatDropDownMenu">`;

                if (BUTTONS.participantsList.sendFileButton) {
                    li += `<li><button class="btn-sm ml5" id='${peer_id}___shareFile' onclick="rc.selectFileToShare('${peer_id}', false)">${peer_sendFile} Share file</button></li>`;
                }

                li += `<li><button class="btn-sm ml5" id="${peer_id}___sendVideoTo" onclick="rc.shareVideo('${peer_id}');">${_PEER.sendVideo} Share audio/video</button></li>`;

                if (BUTTONS.participantsList.geoLocationButton) {
                    li += `<li><button class="btn-sm ml5" id='${peer_id}___geoLocation' onclick="rc.askPeerGeoLocation(this.id)">${peer_geoLocation} Get geolocation</button></li>`;
                }
                if (BUTTONS.participantsList.banButton) {
                    li += `<li><button class="btn-sm ml5" id='${peer_id}___pBan' onclick="rc.peerAction('me',this.id,'ban')">${peer_ban} Ban participant</button></li>`;
                }
                if (BUTTONS.participantsList.ejectButton) {
                    li += `<li><button class="btn-sm ml5" id='${peer_id}___pEject' onclick="rc.peerAction('me',this.id,'eject')">${peer_eject} Eject participant</button></li>`;
                }

                li += `</ul>
                    </div>

                    <br/>

                    <div class="about-buttons mt5"> 
                        <button class="ml5" id='${peer_id}___pAudio' onclick="rc.peerAction('me',this.id,'mute')">${peer_audio}</button>
                        <button class="ml5" id='${peer_id}___pVideo' onclick="rc.peerAction('me',this.id,'hide')">${peer_video}</button>
                        <button class="ml5" id='${peer_id}___pScreen' onclick="rc.peerAction('me',this.id,'stop')">${peer_screen}</button>
                `;

                // li += `
                //         <button class="ml5" >${peer_presenter}</button>`;

                if (peer_info.peer_hand) {
                    li += `
                        <button class="ml5" >${peer_hand}</button>`;
                }

                li += ` 
                    </div>
                </li>
                `;
            } else {
                // GUEST USER
                li += `
                <li 
                    id='${peer_id}' 
                    data-to-id="${peer_id}"
                    data-to-name="${peer_name}"
                    class="clearfix" 
                    onclick="rc.showPeerAboutAndMessages(this.id, '${peer_name}', event)"
                >
                <img 
                    src="${avatarImg}"
                    alt="avatar" 
                />
                    <div class="about">
                        <div class="name">${peer_name_limited}</div>
                        <div class="status"> <i class="fa fa-circle online"></i> online <i id="${peer_id}-unread-msg" class="fas fa-comments hidden"></i> </div>
                    </div>
                `;

                // NO ROOM BROADCASTING
                if (!isBroadcastingEnabled) {
                    li += `
                    <div style="class="dropdown">
                        <button 
                            class="dropdown-toggle" 
                            type="button" 
                            id="${peer_id}-chatDropDownMenu" 
                            data-bs-toggle="dropdown" 
                            aria-expanded="false"
                            style="float: right"
                        >
                        <!-- <i class="fas fa-bars"></i> -->
                        <i class="fas fa-ellipsis-vertical"></i>
                        </button>
                        <ul class="dropdown-menu text-start" aria-labelledby="${peer_id}-chatDropDownMenu">`;

                    if (BUTTONS.participantsList.sendFileButton) {
                        li += `<li><button class="btn-sm ml5" id='${peer_id}___shareFile' onclick="rc.selectFileToShare('${peer_id}', false)">${peer_sendFile} Share file</button></li>`;
                    }

                    li += `<li><button class="btn-sm ml5" id="${peer_id}___sendVideoTo" onclick="rc.shareVideo('${peer_id}');">${_PEER.sendVideo} Share Audio/Video</button></li>
                        </ul>
                    </div>
                    `;
                }

                li += `
                    <br/>

                    <div class="about-buttons mt5"> 
                        <button class="ml5" id='${peer_id}___pAudio' onclick="rc.peerGuestNotAllowed('audio')">${peer_audio}</button>
                        <button class="ml5" id='${peer_id}___pVideo' onclick="rc.peerGuestNotAllowed('video')">${peer_video}</button>
                        <button class="ml5" id='${peer_id}___pScreen' onclick="rc.peerGuestNotAllowed('screen')">${peer_screen}</button>
                        `;

                // li += `
                //         <button class="ml5" >${peer_presenter}</button>`;

                if (peer_info.peer_hand) {
                    li += ` 
                        <button class="ml5" >${peer_hand}</button>`;
                }

                li += ` 
                    </div>
                </li>
                `;
            }
        }
    }
    return li;
}

function setParticipantsTippy(peers) {
    //
    if (!DetectRTC.isMobileDevice) {
        setTippy('muteAllButton', 'Mute all participants', 'top');
        setTippy('hideAllButton', 'Hide all participants', 'top');
        setTippy('stopAllButton', 'Stop screen share to all participants', 'top');
        //
        for (let peer of Array.from(peers.keys())) {
            const peer_info = peers.get(peer).peer_info;
            const peer_id = peer_info.peer_id;

            const peerAudioBtn = rc.getId(peer_id + '___pAudio');
            const peerVideoBtn = rc.getId(peer_id + '___pVideo');
            const peerScreenBtn = rc.getId(peer_id + '___pScreen');

            if (peerAudioBtn) setTippy(peerAudioBtn.id, 'Mute', 'top');
            if (peerVideoBtn) setTippy(peerVideoBtn.id, 'Hide', 'top');
            if (peerScreenBtn) setTippy(peerScreenBtn.id, 'Stop', 'top');
        }
    }
}

function refreshParticipantsCount(count, adapt = true) {
    if (adapt) adaptAspectRatio(count);
}

function getParticipantAvatar(peerName) {
    if (rc.isValidEmail(peerName)) {
        return rc.genGravatar(peerName);
    }
    return rc.genAvatarSvg(peerName, 32);
}

// ####################################################
// SET THEME
// ####################################################

function setCustomTheme() {
    const color = themeCustom.color;
    swalBackground = `radial-gradient(${color}, ${color})`;
    document.documentElement.style.setProperty('--body-bg', `radial-gradient(${color}, ${color})`);
    document.documentElement.style.setProperty('--transcription-bg', `radial-gradient(${color}, ${color})`);
    document.documentElement.style.setProperty('--msger-bg', `radial-gradient(${color}, ${color})`);
    document.documentElement.style.setProperty('--left-msg-bg', `${color}`);
    document.documentElement.style.setProperty('--right-msg-bg', `${color}`);
    document.documentElement.style.setProperty('--select-bg', `${color}`);
    document.documentElement.style.setProperty('--tab-btn-active', `${color}`);
    document.documentElement.style.setProperty('--settings-bg', `radial-gradient(${color}, ${color})`);
    document.documentElement.style.setProperty('--wb-bg', `radial-gradient(${color}, ${color})`);
    document.documentElement.style.setProperty('--btns-bg-color', 'rgba(0, 0, 0, 0.7)');
    document.body.style.background = `radial-gradient(${color}, ${color})`;
}

function setTheme() {
    if (themeCustom.keep) return setCustomTheme();

    selectTheme.selectedIndex = localStorageSettings.theme;
    const theme = selectTheme.value;
    switch (theme) {
        case 'dark':
            swalBackground = 'radial-gradient(#393939, #000000)';
            document.documentElement.style.setProperty('--body-bg', 'radial-gradient(#393939, #000000)');
            document.documentElement.style.setProperty('--transcription-bg', 'radial-gradient(#393939, #000000)');
            document.documentElement.style.setProperty('--msger-bg', 'radial-gradient(#393939, #000000)');
            document.documentElement.style.setProperty('--left-msg-bg', '#056162');
            document.documentElement.style.setProperty('--right-msg-bg', '#252d31');
            document.documentElement.style.setProperty('--select-bg', '#2c2c2c');
            document.documentElement.style.setProperty('--tab-btn-active', '#393939');
            document.documentElement.style.setProperty('--settings-bg', 'radial-gradient(#393939, #000000)');
            document.documentElement.style.setProperty('--wb-bg', 'radial-gradient(#393939, #000000)');
            document.documentElement.style.setProperty('--btns-bg-color', 'rgba(0, 0, 0, 0.7)');
            document.body.style.background = 'radial-gradient(#393939, #000000)';
            selectTheme.selectedIndex = 0;
            break;
        case 'grey':
            swalBackground = 'radial-gradient(#666, #333)';
            document.documentElement.style.setProperty('--body-bg', 'radial-gradient(#666, #333)');
            document.documentElement.style.setProperty('--transcription-bg', 'radial-gradient(#666, #333)');
            document.documentElement.style.setProperty('--msger-bg', 'radial-gradient(#666, #333)');
            document.documentElement.style.setProperty('--left-msg-bg', '#056162');
            document.documentElement.style.setProperty('--right-msg-bg', '#252d31');
            document.documentElement.style.setProperty('--select-bg', '#2c2c2c');
            document.documentElement.style.setProperty('--tab-btn-active', '#666');
            document.documentElement.style.setProperty('--settings-bg', 'radial-gradient(#666, #333)');
            document.documentElement.style.setProperty('--wb-bg', 'radial-gradient(#797979, #000)');
            document.documentElement.style.setProperty('--btns-bg-color', 'rgba(0, 0, 0, 0.7)');
            document.body.style.background = 'radial-gradient(#666, #333)';
            selectTheme.selectedIndex = 1;
            break;
        case 'green':
            swalBackground = 'radial-gradient(#003934, #001E1A)';
            document.documentElement.style.setProperty('--body-bg', 'radial-gradient(#003934, #001E1A)');
            document.documentElement.style.setProperty('--transcription-bg', 'radial-gradient(#003934, #001E1A)');
            document.documentElement.style.setProperty('--msger-bg', 'radial-gradient(#003934, #001E1A)');
            document.documentElement.style.setProperty('--left-msg-bg', '#001E1A');
            document.documentElement.style.setProperty('--right-msg-bg', '#003934');
            document.documentElement.style.setProperty('--select-bg', '#001E1A');
            document.documentElement.style.setProperty('--tab-btn-active', '#003934');
            document.documentElement.style.setProperty('--settings-bg', 'radial-gradient(#003934, #001E1A)');
            document.documentElement.style.setProperty('--wb-bg', 'radial-gradient(#003934, #001E1A)');
            document.documentElement.style.setProperty('--btns-bg-color', 'radial-gradient(#003934, #001E1A)');
            document.body.style.background = 'radial-gradient(#003934, #001E1A)';
            selectTheme.selectedIndex = 2;
            break;
        case 'blue':
            swalBackground = 'radial-gradient(#306bac, #141B41)';
            document.documentElement.style.setProperty('--body-bg', 'radial-gradient(#306bac, #141B41)');
            document.documentElement.style.setProperty('--transcription-bg', 'radial-gradient(#306bac, #141B41)');
            document.documentElement.style.setProperty('--msger-bg', 'radial-gradient(#306bac, #141B41)');
            document.documentElement.style.setProperty('--left-msg-bg', '#141B41');
            document.documentElement.style.setProperty('--right-msg-bg', '#306bac');
            document.documentElement.style.setProperty('--select-bg', '#141B41');
            document.documentElement.style.setProperty('--tab-btn-active', '#306bac');
            document.documentElement.style.setProperty('--settings-bg', 'radial-gradient(#306bac, #141B41)');
            document.documentElement.style.setProperty('--wb-bg', 'radial-gradient(#306bac, #141B41)');
            document.documentElement.style.setProperty('--btns-bg-color', 'radial-gradient(#141B41, #306bac)');
            document.body.style.background = 'radial-gradient(#306bac, #141B41)';
            selectTheme.selectedIndex = 3;
            break;
        case 'red':
            swalBackground = 'radial-gradient(#69140E, #3C1518)';
            document.documentElement.style.setProperty('--body-bg', 'radial-gradient(#69140E, #3C1518)');
            document.documentElement.style.setProperty('--transcription-bg', 'radial-gradient(#69140E, #3C1518)');
            document.documentElement.style.setProperty('--msger-bg', 'radial-gradient(#69140E, #3C1518)');
            document.documentElement.style.setProperty('--left-msg-bg', '#3C1518');
            document.documentElement.style.setProperty('--right-msg-bg', '#69140E');
            document.documentElement.style.setProperty('--select-bg', '#3C1518');
            document.documentElement.style.setProperty('--tab-btn-active', '#69140E');
            document.documentElement.style.setProperty('--settings-bg', 'radial-gradient(#69140E, #3C1518)');
            document.documentElement.style.setProperty('--wb-bg', 'radial-gradient(#69140E, #3C1518)');
            document.documentElement.style.setProperty('--btns-bg-color', 'radial-gradient(#69140E, #3C1518)');
            document.body.style.background = 'radial-gradient(#69140E, #3C1518)';
            selectTheme.selectedIndex = 4;
            break;
        default:
            break;
        //...
    }
    wbIsBgTransparent = false;
    if (rc) rc.isChatBgTransparent = false;
}

// ####################################################
// HANDLE ASPECT RATIO
// ####################################################

function handleAspectRatio() {
    if (participantsCount > 1) {
        adaptAspectRatio(videoMediaContainer.childElementCount);
    } else {
        resizeVideoMedia();
    }
}

function adaptAspectRatio(participantsCount) {
    /* 
        ['0:0', '4:3', '16:9', '1:1', '1:2'];
    */
    let desktop,
        mobile = 1;
    // desktop aspect ratio
    switch (participantsCount) {
        case 1:
        case 3:
        case 4:
        case 7:
        case 9:
            desktop = 2; // (16:9)
            break;
        case 5:
        case 6:
        case 10:
        case 11:
            desktop = 1; // (4:3)
            break;
        case 2:
        case 8:
            desktop = 3; // (1:1)
            break;
        default:
            desktop = 0; // (0:0)
    }
    // mobile aspect ratio
    switch (participantsCount) {
        case 3:
        case 9:
        case 10:
            mobile = 2; // (16:9)
            break;
        case 2:
        case 7:
        case 8:
        case 11:
            mobile = 1; // (4:3)
            break;
        case 1:
        case 4:
        case 5:
        case 6:
            mobile = 3; // (1:1)
            break;
        default:
            mobile = 3; // (1:1)
    }
    if (participantsCount > 11) {
        desktop = 1; // (4:3)
        mobile = 3; // (1:1)
    }
    BtnAspectRatio.selectedIndex = DetectRTC.isMobileDevice ? mobile : desktop;
    setAspectRatio(BtnAspectRatio.selectedIndex);
}

// ####################################################
// ABOUT
// ####################################################

function showAbout() {
    sound('open');

    Swal.fire({
        background: swalBackground,
        imageUrl: image.about,
        customClass: { image: 'img-about' },
        position: 'center',
        title: 'WebRTC SFU',
        html: `
        <br/>
        <div id="about">
            <button 
                id="support-button" 
                data-umami-event="Support button" 
                class="pulsate" 
                onclick="window.open('https://codecanyon.net/user/miroslavpejic85')">
                <i class="fas fa-heart"></i> 
                Support
            </button>
            <br /><br />
            Author: <a 
                id="linkedin-button" 
                data-umami-event="Linkedin button" 
                href="https://www.linkedin.com/in/miroslav-pejic-976a07101/" target="_blank"> 
                Miroslav Pejic
            </a>
            <br /><br />
            Email:<a 
                id="email-button" 
                data-umami-event="Email button" 
                href="mailto:miroslav.pejic.85@gmail.com?subject=MiroTalk SFU info"> 
                miroslav.pejic.85@gmail.com
            </a>
        </div>
        `,
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    });
}
