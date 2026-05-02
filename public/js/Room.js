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
 * @version 2.2.44
 *
 */

// ####################################################
// STATIC SETTINGS
// ####################################################

console.log('Window Location', window.location);

const userAgent = navigator.userAgent;
const parser = new UAParser(userAgent);
const parserResult = parser.getResult();
const deviceType = parserResult.device.type || 'desktop';
const isMobileDevice = deviceType === 'mobile';
const isMobileSafari = isMobileDevice && parserResult.browser.name?.toLowerCase().includes('safari');
const isTabletDevice = deviceType === 'tablet';
const isIPadDevice = parserResult.device.model?.toLowerCase() === 'ipad';
const isDesktopDevice = deviceType === 'desktop';
const isFirefox = parserResult.browser.name?.toLowerCase() === 'firefox';
const thisInfo = getInfo();

const isEmbedded = window.self !== window.top;
const showDocumentPipBtn = !isEmbedded && 'documentPictureInPicture' in window;

/**
 * Initializes a Socket.IO client instance with custom connection and reconnection options.
 *
 * @property {string[]} transports - The transport mechanisms to use. Default: ['polling', 'websocket']. Here, only ['websocket'] is used.
 * @property {boolean} reconnection - Whether to automatically reconnect if connection is lost. Default: true.
 * @property {number} reconnectionAttempts - Maximum number of reconnection attempts before giving up. Default: Infinity. Here, set to 10.
 * @property {number} reconnectionDelay - How long to initially wait before attempting a new reconnection (in ms). Default: 1000. Here, set to 3000.
 * @property {number} reconnectionDelayMax - Maximum amount of time to wait between reconnections (in ms). Default: 5000. Here, set to 15000.
 * @property {number} timeout - Connection timeout before an error is emitted (in ms). Default: 20000.
 */
const socket = io({
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 3000,
    reconnectionDelayMax: 15000,
    timeout: 20000,
});

let survey = {
    enabled: true,
    url: 'https://www.questionpro.com/t/AUs7VZq02P',
};

let redirect = {
    enabled: true,
    url: '/newroom',
};

let recCodecs = null;

const _PEER = {
    presenter: '<i class="fa-solid fa-user-shield"></i>',
    guest: '<i class="fa-solid fa-signal"></i>',
    audioOn: '<i class="fas fa-microphone"></i>',
    audioOff: '<i class="fas fa-microphone-slash red"></i>',
    videoOn: '<i class="fas fa-video"></i>',
    videoOff: '<i class="fas fa-video-slash red"></i>',
    screenOn: '<i class="fas fa-desktop"></i>',
    screenOff: '<i class="fas fa-desktop red"></i>',
    raiseHand: '<i style="color: #FFD700;" class="fas fa-hand-paper pulsate"></i>',
    lowerHand: '',
    acceptPeer: '<i class="fas fa-check"></i>',
    banPeer: '<i class="fas fa-ban red"></i>',
    ejectPeer: '<i class="fas fa-right-from-bracket red"></i>',
    geoLocation: '<i class="fas fa-location-dot"></i>',
    sendFile: '<i class="fas fa-upload"></i>',
    sendMsg: '<i class="fas fa-paper-plane"></i>',
    sendVideo: '<i class="fab fa-youtube"></i>',
};

const initUser = document.getElementById('initUser');
const initVideoContainerClass = document.querySelector('.init-video-container');
const bars = document.querySelectorAll('.volume-bar');

const Base64Prefix = 'data:application/pdf;base64,';

// Whiteboard
const wbImageInput = 'image/*';
const wbPdfInput = 'application/pdf';
// Reference dimensions for whiteboard (16:9 aspect ratio)
const wbReferenceWidth = 1920;
const wbReferenceHeight = 1080;
const wbGridSize = 20;
const wbStroke = '#cccccc63';
let wbGridLines = [];
let wbGridVisible = false;

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

const participantsCountBadge = getId('participantsCountBadge');
const videoSelect = getId('videoSelect');
const videoQuality = getId('videoQuality');
const videoFps = getId('videoFps');
const screenQuality = getId('screenQuality');
const screenFps = getId('screenFps');
const screenOptimization = getId('screenOptimization');
const initVideoSelect = getId('initVideoSelect');
const microphoneSelect = getId('microphoneSelect');
const initMicrophoneSelect = getId('initMicrophoneSelect');
const speakerSelect = getId('speakerSelect');
const initSpeakerSelect = getId('initSpeakerSelect');

const startVideoBtn = getId('startVideoButton');
const startAudioBtn = getId('startAudioButton');
const stopVideoBtn = getId('stopVideoButton');
const stopAudioBtn = getId('stopAudioButton');
const videoDropdown = getId('startVideoDeviceDropdown');
const audioDropdown = getId('startAudioDeviceDropdown');
const videoToggle = getId('startVideoDeviceMenuButton');
const audioToggle = getId('startAudioDeviceMenuButton');
const videoMenu = getId('startVideoDeviceMenu');
const audioMenu = getId('startAudioDeviceMenu');

const settingsSplit = getId('settingsSplit');
const settingsExtraDropdown = getId('settingsExtraDropdown');
const settingsExtraToggle = getId('settingsExtraToggle');
const settingsExtraMenu = getId('settingsExtraMenu');
const noExtraButtons = getId('noExtraButtons');

// ####################################################
// VIRTUAL BACKGROUND DEFAULT IMAGES AND INIT CLASS
// ####################################################

const virtualBackgrounds = Object.values(image.virtualBackground);

const virtualBackground = new VirtualBackground();

const isMediaStreamTrackAndTransformerSupported = virtualBackground.checkSupport();

// ####################################################
// DYNAMIC SETTINGS
// ####################################################

let preventExit = false;
let bypassBeforeUnloadOnce = false;

let virtualBackgroundBlurLevel;
let virtualBackgroundSelectedImage;
let virtualBackgroundTransparent;

let swalBackground = 'radial-gradient(#393939, #000000)'; //'rgba(0, 0, 0, 0.7)';

let rc = null;
let producer = null;
let participantsCount = 0;
let lobbyParticipantsCount = 0;
let chatMessagesId = 0;

let room_id = getRoomId();
let room_password = getRoomPassword();
let room_duration = getRoomDuration();
let peer_name = getPeerName();
let peer_avatar = getPeerAvatar();
let hasTemporaryAvatar = !!(
    peer_avatar &&
    localStorageSettings.peer_avatar &&
    peer_avatar === localStorageSettings.peer_avatar
);
let peer_uuid = getPeerUUID();
let peer_token = getPeerToken();
let isScreenAllowed = getScreen();
let isHideMeActive = getHideMeActive();
let notify = getNotify();
let chat = getChat();
isPresenter = isPeerPresenter();

let peer_info = null;

let isPushToTalkActive = false;
let isSpaceDown = false;
let isPitchBarEnabled = true;
let isSoundEnabled = true;
let isKeepButtonsVisible = false;
let isChatPinEnabled = true;
let isShortcutsEnabled = false;
let isBroadcastingEnabled = false;
let isLobbyEnabled = false;
let hostOnlyRecording = false;
let isEnumerateAudioDevices = false;
let isEnumerateVideoDevices = false;
let isAudioAllowed = false;
let isVideoAllowed = false;
let isVideoPrivacyActive = false;
let isRecording = false;
let isAudioVideoAllowed = false;
let isParticipantsListOpen = false;
let isBreakoutPanelOpen = false;
let breakoutRooms = [];
let isVideoControlsOn = false;
let isChatPasteTxt = false;
let isChatMarkdownOn = false;
let isChatGPTOn = false;
let isDeepSeekOn = false;
let isSpeechSynthesisSupported = 'speechSynthesis' in window;
let joinRoomWithoutAudioVideo = true;
let joinRoomWithScreen = false;

let audio = false;
let video = false;
let screen = false;
let hand = false;
let camera = 'user';

let recTimer = null;
let recElapsedTime = null;
let recShowInfo = true;

let wbCanvas = null;
let wbIsLock = false;
let wbIsDrawing = false;
let wbIsOpen = false;
let wbIsRedoing = false;
let wbIsObject = false;
let wbIsEraser = false;
let wbIsPencil = false;
let wbIsVanishing = false;
let wbIsBgTransparent = false;
let wbPop = [];
let wbVanishingObjects = [];
let coords = {};

let isButtonsVisible = false;
let isButtonsBarOver = false;

let isRoomLocked = false;

let initStream = null;
let isInitVideoLoaded = false;

let audioContext = null;
let workletNode = null;

// window.location.origin + '/join/' + roomId
// window.location.origin + '/join/?room=' + roomId + '&token=' + myToken

let RoomURL = window.location.origin + '/join/' + room_id;

let isExiting = false;

let transcription;

let quill = null;

// ####################################################
// INIT ROOM
// ####################################################

document.addEventListener('DOMContentLoaded', function () {
    initCursorLightEffect();
    initDocumentListener();
    socket.once('connect', () => {
        initClient();
    });
});

// ####################################################
// MOUSE CURSOR LIGHT EFFECT
// ####################################################

function initCursorLightEffect() {
    if (!videoMediaContainer || !isDesktopDevice) return;
    videoMediaContainer.classList.add('mouse-light');
    videoMediaContainer.addEventListener('mousemove', function (e) {
        const rect = videoMediaContainer.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        videoMediaContainer.style.setProperty('--mouse-x', x + '%');
        videoMediaContainer.style.setProperty('--mouse-y', y + '%');
    });
}

function initDocumentListener() {
    // Close navbar dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.navbar-dropdown')) {
            document.querySelectorAll('.navbar-dropdown-content.show').forEach((el) => el.classList.remove('show'));
        }
    });
}

async function initClient() {
    await getThemes();
    setTheme();

    // Transcription
    transcription = new Transcription();
    transcription.init();

    if (!isMobileDevice) {
        refreshMainButtonsToolTipPlacement();
        setTippy('mySettingsCloseBtn', 'Close', 'bottom');
        setTippy(
            'switchDominantSpeakerFocus',
            'If Active, When a participant speaks, their video will be focused and enlarged',
            'right'
        );
        setTippy(
            'switchNoiseSuppression',
            'If Active, the audio will be processed to reduce background noise, making the voice clearer',
            'right'
        );
        setTippy(
            'switchPushToTalk',
            'If Active, When SpaceBar keydown the microphone will be resumed, on keyup will be paused, like a walkie-talkie',
            'right'
        );
        setTippy('lobbyAcceptAllBtn', 'Accept', 'top');
        setTippy('lobbyRejectAllBtn', 'Reject', 'top');
        setTippy(
            'switchBroadcasting',
            'Broadcasting is the dissemination of audio or video content to a large audience (one to many)',
            'right'
        );
        setTippy(
            'switchLobby',
            'Lobby mode lets you protect your meeting by only allowing people to enter after a formal approval by a moderator',
            'right'
        );
        setTippy('initVideoAudioRefreshButton', 'Refresh audio/video devices', 'top');
        setTippy(
            'screenOptimizationLabel',
            'Detail: For high fidelity (screen sharing with text/graphics)<br />Motion: For high frame rate (video playback, game streaming',
            'right',
            true
        );
        setTippy('switchPitchBar', 'Toggle audio pitch bar', 'right');
        setTippy('switchSounds', 'Toggle the sounds notifications', 'right');
        setTippy('switchShare', "Show 'Share Room' popup on join", 'right');
        setTippy('switchKeepButtonsVisible', 'Keep buttons always visible', 'right');
        setTippy('switchKeepAwake', 'Prevent the device from sleeping (if supported)', 'right');
        setTippy('switchChatPin', 'Auto pin chat when opened', 'right');
        setTippy('roomId', 'Room name (click to copy)', 'right');
        setTippy('sessionTime', 'Session time', 'right');
        setTippy('recordingImage', 'Toggle recording', 'right');
        setTippy(
            'switchHostOnlyRecording',
            'Only the host (presenter) has the capability to record the meeting',
            'right'
        );
        setTippy('refreshVideoFiles', 'Refresh', 'left');
        setTippy('switchServerRecording', 'The recording will be stored on the server rather than locally', 'right');
        setTippy('whiteboardGhostButton', 'Toggle transparent background', 'bottom');
        setTippy('whiteboardGridBtn', 'Toggle whiteboard grid', 'bottom');
        setTippy('wbBackgroundColorEl', 'Background color', 'bottom');
        setTippy('wbDrawingColorEl', 'Drawing color', 'bottom');
        setTippy('whiteboardPencilBtn', 'Drawing mode', 'bottom');
        setTippy('whiteboardVanishingBtn', 'Vanishing pen (disappears in 5s)', 'bottom');
        setTippy('whiteboardEraserBtn', 'Eraser', 'bottom');
        setTippy('whiteboardObjectBtn', 'Object mode', 'bottom');
        setTippy('whiteboardUndoBtn', 'Undo', 'bottom');
        setTippy('whiteboardRedoBtn', 'Redo', 'bottom');
        setTippy('whiteboardLockBtn', 'Toggle Lock whiteboard', 'right');
        setTippy('whiteboardUnlockBtn', 'Toggle Lock whiteboard', 'right');
        setTippy('whiteboardCloseBtn', 'Close', 'bottom');
        setTippy('chatCleanTextButton', 'Clean', 'top');
        setTippy('chatPasteButton', 'Paste', 'top');
        setTippy('chatSendButton', 'Send', 'top');
        setTippy('showChatOnMsg', 'Show chat on new message comes', 'bottom');
        setTippy('speechIncomingMsg', 'Speech the incoming messages', 'bottom');
        setTippy('chatSpeechStartButton', 'Start speech recognition', 'top');
        setTippy('chatSpeechStopButton', 'Stop speech recognition', 'top');
        setTippy('chatEmojiButton', 'Emoji', 'top');
        setTippy('chatShowParticipantsListBtn', 'Toggle participants list', 'bottom');
        setTippy('chatMarkdownButton', 'Markdown', 'top');
        setTippy('fileShareChatButton', 'Share the file', 'top');
        setTippy('chatCloseButton', 'Close', 'bottom');
        setTippy('chatTogglePin', 'Toggle pin', 'bottom');
        setTippy('chatHideParticipantsList', 'Hide', 'bottom');
        setTippy('chatMaxButton', 'Maximize', 'bottom');
        setTippy('chatMinButton', 'Minimize', 'bottom');
        setTippy('pollTogglePin', 'Toggle pin', 'bottom');
        setTippy('breakoutTogglePin', 'Toggle pin', 'bottom');
        setTippy('pollMaxButton', 'Maximize', 'bottom');
        setTippy('pollMinButton', 'Minimize', 'bottom');
        setTippy('pollSaveButton', 'Save results', 'bottom');
        setTippy('pollCloseBtn', 'Close', 'bottom');
        setTippy('editorLockBtn', 'Toggle Lock editor', 'bottom');
        setTippy('editorUnlockBtn', 'Toggle Lock editor', 'bottom');
        setTippy('editorTogglePin', 'Toggle pin', 'bottom');
        setTippy('editorUndoBtn', 'Undo', 'bottom');
        setTippy('editorRedoBtn', 'Redo', 'bottom');
        setTippy('editorCopyBtn', 'Copy', 'bottom');
        setTippy('editorSaveBtn', 'Save', 'bottom');
        setTippy('editorCloseBtn', 'Close', 'bottom');
        setTippy('editorCleanBtn', 'Clean', 'bottom');
        setTippy('pollAddOptionBtn', 'Add option', 'top');
        setTippy('pollDelOptionBtn', 'Delete option', 'top');
        setTippy('participantsSaveBtn', 'Save participants info', 'bottom');
        setTippy('participantsRaiseHandBtn', 'Toggle raise hands', 'bottom');
        setTippy('participantsUnreadMessagesBtn', 'Toggle unread messages', 'bottom');
        setTippy('transcriptionCloseBtn', 'Close', 'bottom');
        setTippy('transcriptionTogglePinBtn', 'Toggle pin', 'bottom');
        setTippy('transcriptionMaxBtn', 'Maximize', 'bottom');
        setTippy('transcriptionMinBtn', 'Minimize', 'bottom');
        setTippy('transcriptionSpeechStatus', 'Status', 'bottom');
        setTippy('transcriptShowOnMsg', 'Show transcript on new message comes', 'bottom');
        setTippy('transcriptSendToAll', 'When enabled, your transcription will be sent to all participants', 'bottom');
        setTippy('transcriptionSpeechStart', 'Start transcription', 'top');
        setTippy('transcriptionSpeechStop', 'Stop transcription', 'top');
    }
    setupWhiteboard();
    initEnumerateDevices();
    setupInitButtons();
}

// ####################################################
// HANDLE MAIN BUTTONS TOOLTIP
// ####################################################

function refreshMainButtonsToolTipPlacement() {
    if (!isMobileDevice) {
        //
        const position = BtnsBarPosition.options[BtnsBarPosition.selectedIndex].value;
        const bPlacement = position == 'vertical' ? 'top' : 'right';

        // Bottom buttons
        setTippy('startAudioButton', 'Start the audio', bPlacement);
        setTippy('stopAudioButton', 'Stop the audio', bPlacement);
        setTippy('startVideoButton', 'Start the video', bPlacement);
        setTippy('stopVideoButton', 'Stop the video', bPlacement);
        setTippy('swapCameraButton', 'Swap the camera', bPlacement);
        setTippy('startScreenButton', 'Start screen share', bPlacement);
        setTippy('stopScreenButton', 'Stop screen share', bPlacement);
        setTippy('raiseHandButton', 'Raise your hand', bPlacement);
        setTippy('lowerHandButton', 'Lower your hand', bPlacement);
        setTippy('chatButton', 'Toggle the chat', bPlacement);
        setTippy('participantsButton', 'Toggle participants list', bPlacement);
        setTippy('settingsButton', 'Toggle the settings', bPlacement);
        setTippy('exitButton', 'Leave room', bPlacement);
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
        try {
            tippy(element, {
                content: content,
                placement: placement,
                allowHTML: allowHTML,
            });
        } catch (err) {
            console.error('setTippy error', err.message);
        }
    } else {
        console.warn('setTippy element not found with content', content);
    }
}

// ####################################################
// HELPERS
// ####################################################

function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return filterXSS(urlParams.get(param));
}

// ####################################################
// GET ROOM ID
// ####################################################

function getRoomId() {
    let queryRoomId = getQueryParam('room');
    let roomId = queryRoomId ? queryRoomId : location.pathname.substring(6);
    if (roomId == '' || roomId === 'random') {
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
        handleUsernameEmojiPicker();
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
            })
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
            })
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
// INIT AUDIO/VIDEO/SCREEN BUTTONS
// ####################################################

function setupInitButtons() {
    initVideoAudioRefreshButton.onclick = () => {
        refreshMyAudioVideoDevices();
    };
    initVideoButton.onclick = () => {
        handleVideo();
    };
    initAudioButton.onclick = () => {
        handleAudio();
    };
    initAudioVideoButton.onclick = async (e) => {
        await handleAudioVideo(e);
    };
    initStartScreenButton.onclick = async () => {
        await toggleScreenSharing();
    };
    initStopScreenButton.onclick = async () => {
        await toggleScreenSharing();
    };
    initVideoMirrorButton.onclick = () => {
        initVideo.classList.toggle('mirror');
    };
    initVirtualBackgroundButton.onclick = () => {
        showImageSelector();
    };
    initUsernameEmojiButton.onclick = () => {
        getId('usernameInput').value = '';
        toggleUsernameEmoji();
    };
    initExitButton.onclick = () => {
        initLeaveMeeting();
    };
}

// ####################################################
// MICROPHONE VOLUME INDICATOR
// ####################################################

async function getMicrophoneVolumeIndicator(stream) {
    if (isAudioContextSupported() && hasAudioTrack(stream)) {
        try {
            stopMicrophoneProcessing();
            console.log('Start microphone volume indicator for audio track', stream.getAudioTracks()[0]);
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const microphone = audioContext.createMediaStreamSource(stream);
            await audioContext.audioWorklet.addModule('/js/VolumeProcessor.js');
            workletNode = new AudioWorkletNode(audioContext, 'volume-processor');

            // Handle data from VolumeProcessor.js
            workletNode.port.onmessage = (event) => {
                const data = event.data;
                switch (data.type) {
                    case 'volumeIndicator':
                        updateVolumeIndicator(data.volume);
                        break;
                    //...
                    default:
                        console.warn('Unknown message type from VolumeProcessor:', data.type);
                        break;
                }
            };

            microphone.connect(workletNode);
            workletNode.connect(audioContext.destination);
        } catch (error) {
            console.error('Error initializing microphone volume indicator:', error);
            stopMicrophoneProcessing();
        }
    } else {
        console.warn('Microphone volume indicator not supported for this browser');
    }
}

function stopMicrophoneProcessing() {
    console.log('Stop microphone volume indicator');
    if (workletNode) {
        try {
            workletNode.disconnect();
        } catch (error) {
            console.warn('Error disconnecting workletNode:', error);
        }
        workletNode = null;
    }
    if (audioContext) {
        try {
            if (audioContext.state !== 'closed') {
                audioContext.close();
            }
        } catch (error) {
            console.warn('Error closing audioContext:', error);
        }
        audioContext = null;
    }
}

function updateVolumeIndicator(volume) {
    const normalizedVolume = Math.max(0, Math.min(1, volume));
    const activeBars = Math.round(normalizedVolume * bars.length);
    bars.forEach((bar, index) => {
        bar.classList.toggle('active', index < activeBars);
    });
}

function isAudioContextSupported() {
    return !!(window.AudioContext || window.webkitAudioContext);
}

function hasAudioTrack(mediaStream) {
    if (!mediaStream) return false;
    const audioTracks = mediaStream.getAudioTracks();
    return audioTracks.length > 0;
}

function hasVideoTrack(mediaStream) {
    if (!mediaStream) return false;
    const videoTracks = mediaStream.getVideoTracks();
    return videoTracks.length > 0;
}

// ####################################################
// QUERY PARAMS CHECK
// ####################################################

function getScreen() {
    let screen = getQueryParam('screen');
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
    let notify = getQueryParam('notify');
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

function getChat() {
    let chat = getQueryParam('chat');
    if (chat) {
        chat = chat.toLowerCase();
        let queryChat = chat === '1' || chat === 'true';
        if (queryChat != null) {
            console.log('Direct join', { chat: queryChat });
            return queryChat;
        }
    }
    console.log('Direct join', { chat: chat });
    return chat;
}

function getHideMeActive() {
    let hide = getQueryParam('hide');
    let queryHideMe = false;
    if (hide) {
        hide = hide.toLowerCase();
        queryHideMe = hide === '1' || hide === 'true';
    }
    console.log('Direct join', { hide: queryHideMe });
    return queryHideMe;
}

function isPeerPresenter() {
    let presenter = getQueryParam('isPresenter');
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
    const name = getQueryParam('name');
    if (isHtml(name)) {
        console.log('Direct join', { name: 'Invalid name' });
        return 'Invalid name';
    }
    console.log('Direct join', { name: name });

    if (isValidEmail(name)) {
        getId('notifyEmailInput').value = name;
    }

    if (name === 'random') {
        const randomName = generateRandomName();
        console.log('Direct join', { name: randomName });
        return randomName;
    }

    return name;
}

function generateRandomName() {
    const adjectives = ['Quick', 'Lazy', 'Happy', 'Sad', 'Brave', 'Clever', 'Witty', 'Calm', 'Bright', 'Charming'];
    const nouns = ['Fox', 'Dog', 'Cat', 'Mouse', 'Lion', 'Tiger', 'Bear', 'Wolf', 'Eagle', 'Shark'];
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const number = Math.floor(Math.random() * 1000);
    return `${adjective}${noun}${number}`;
}

function getPeerAvatar() {
    const avatar = getQueryParam('avatar');
    const avatarDisabled = avatar === '0' || avatar === 'false';
    const isBase64Avatar = typeof avatar === 'string' && avatar.startsWith('data:');
    console.log('Direct join', { avatar: avatar });
    if (avatarDisabled || isBase64Avatar || !isValidAvatarURL(avatar)) {
        const saved = localStorageSettings.peer_avatar;
        if (saved && isValidAvatarURL(saved)) {
            console.log('Restored avatar from localStorage', { avatar: saved });
            return saved;
        }
        return false;
    }
    return avatar;
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
    let token = getQueryParam('token');
    let queryToken = false;
    if (token) {
        queryToken = token;
    }
    console.log('Direct join', { token: queryToken });
    return queryToken;
}

function getRoomPassword() {
    let roomPassword = getQueryParam('roomPassword');
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

function getRoomDuration() {
    const roomDuration = getQueryParam('duration');

    if (isValidDuration(roomDuration)) {
        if (roomDuration === 'unlimited') {
            console.log('The room has no time limit');
            return roomDuration;
        }
        const timeLimit = timeToMilliseconds(roomDuration);
        setTimeout(() => {
            sound('eject');
            Swal.fire({
                background: swalBackground,
                position: 'center',
                title: 'Time Limit Reached',
                text: 'The room has reached its time limit and will close shortly',
                icon: 'warning',
                timer: 6000, // 6 seconds
                timerProgressBar: true,
                showConfirmButton: false,
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                },
                willClose: () => {
                    rc.exitRoom(true);
                },
            });
        }, timeLimit);

        console.log('Direct join', { duration: roomDuration, timeLimit: timeLimit });
        return roomDuration;
    }
    return 'unlimited';
}

function timeToMilliseconds(timeString) {
    const [hours, minutes, seconds] = timeString.split(':').map(Number);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

function isValidDuration(duration) {
    if (duration === 'unlimited') return true;

    // Check if the format is HH:MM:SS
    const regex = /^(\d{2}):(\d{2}):(\d{2})$/;
    const match = duration.match(regex);
    if (!match) return false;
    const [hours, minutes, seconds] = match.slice(1).map(Number);
    // Validate ranges: hours, minutes, and seconds
    if (hours < 0 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
        return false;
    }
    return true;
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
        join_tz_offset: new Date().getTimezoneOffset(),
        peer_uuid: peer_uuid,
        peer_id: socket.id,
        peer_name: peer_name,
        peer_avatar: peer_avatar,
        peer_token: peer_token,
        peer_presenter: isPresenter,
        peer_audio: isAudioAllowed,
        peer_audio_volume: 100,
        peer_video: isVideoAllowed,
        peer_screen: isScreenAllowed,
        peer_recording: isRecording,
        peer_video_privacy: isVideoPrivacyActive,
        peer_hand: false,
        is_desktop_device: isDesktopDevice,
        is_mobile_device: isMobileDevice,
        is_tablet_device: isTabletDevice,
        is_ipad_pro_device: isIPadDevice,
        os_name: parserResult.os.name,
        os_version: parserResult.os.version,
        browser_name: parserResult.browser.name,
        browser_version: parserResult.browser.version,
        user_agent: userAgent,
    };
}

function getInfo() {
    try {
        console.log('Info', parserResult);

        const filterUnknown = (obj) => {
            const filtered = {};
            for (const [key, value] of Object.entries(obj)) {
                if (value && value !== 'Unknown') {
                    filtered[key] = value;
                }
            }
            return filtered;
        };

        const filteredResult = {
            //ua: parserResult.ua,
            browser: filterUnknown(parserResult.browser),
            cpu: filterUnknown(parserResult.cpu),
            device: filterUnknown(parserResult.device),
            engine: filterUnknown(parserResult.engine),
            os: filterUnknown(parserResult.os),
        };

        const sectionMeta = {
            browser: { iconMarkup: icons.infoBrowser, label: 'Browser' },
            cpu: { iconMarkup: icons.infoCpu, label: 'CPU info' },
            device: { iconMarkup: icons.infoDevice, label: 'Device' },
            engine: { iconMarkup: icons.infoEngine, label: 'Engine' },
            os: { iconMarkup: icons.infoOs, label: 'OS info' },
        };

        const rows = Object.entries(filteredResult)
            .filter(([, data]) => Object.keys(data).length > 0)
            .map(([section, data]) => {
                const { iconMarkup, label } = sectionMeta[section] || {
                    iconMarkup: icons.infoDefault,
                    label: section,
                };
                const badges = Object.entries(data)
                    .filter(([key]) => key !== 'major')
                    .map(([, val]) => renderRoomTemplate('extraInfoBadgeTemplate', { text: { value: String(val) } }))
                    .join('');
                return renderRoomTemplate('extraInfoRowTemplate', {
                    text: { label },
                    html: { iconMarkup, badges },
                    attrs: { rowClass: `extra-info-row extra-info-row--${section}` },
                });
            })
            .join('');

        extraInfo.innerHTML = renderRoomTemplate('extraInfoGridTemplate', { html: { rows } });

        return parserResult;
    } catch (error) {
        console.error('Error parsing user agent:', error);
    }
}

// ####################################################
// ENTER YOUR NAME | Enable/Disable AUDIO/VIDEO
// ####################################################

async function whoAreYou() {
    console.log('04 ----> Who are you?');

    // Initialize video loading state
    isInitVideoLoaded = !isVideoAllowed;

    document.body.style.background = 'var(--body-bg)';

    try {
        const response = await axios.get('/config', {
            timeout: 5000,
        });
        const serverButtons = response.data.message;
        if (serverButtons) {
            // Merge serverButtons into BUTTONS, keeping the existing keys in BUTTONS if they are not present in serverButtons
            BUTTONS = mergeConfig(BUTTONS, serverButtons);

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

    // Virtual Background if supported (Chrome/Edge/Opera/Vivaldi/...)
    if (
        isMediaStreamTrackAndTransformerSupported &&
        (BUTTONS.settings.virtualBackground !== undefined ? BUTTONS.settings.virtualBackground : true)
    ) {
        show(initVirtualBackgroundButton);
        show(videoVirtualBackground);
    }

    if (peer_name) {
        hide(loadingDiv);
        checkMedia();
        if (!BUTTONS.main.startScreenButton) isScreenAllowed = false;
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
        isInitVideoLoaded = true;
        elemDisplay('initVideo', false);
        elemDisplay('initVideoLoader', false);
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

    // Fetch the OIDC profile and manage peer_name
    let force_peer_name = false;

    try {
        // Prepare headers for profile request
        const headers = {};
        if (peer_token) {
            headers.Authorization = `Bearer ${peer_token}`;
        }

        const { data: profile } = await axios.get('/profile', {
            timeout: 5000,
            headers: headers,
        });

        if (profile) {
            console.log('AXIOS GET OIDC Profile retrieved successfully', profile);

            // Define peer_name based on the profile properties and preferences
            const peerNamePreference = profile.peer_name || {};
            default_name =
                (peerNamePreference.email && profile.email) ||
                (peerNamePreference.name && profile.name) ||
                default_name;

            // Set localStorage and force_peer_name if applicable
            if (default_name && peerNamePreference.force) {
                window.localStorage.peer_name = default_name;
                force_peer_name = true;
            }
        } else {
            console.warn('AXIOS GET Profile data is empty or undefined');
        }
    } catch (error) {
        console.error('AXIOS OIDC Error fetching profile', error.message || error);
    }

    Swal.fire({
        allowOutsideClick: false,
        allowEscapeKey: false,
        background: swalBackground,
        title: BRAND.app?.name,
        input: 'text',
        inputPlaceholder: 'Enter your email or name',
        inputAttributes: { maxlength: 254, id: 'usernameInput' },
        inputValue: default_name,
        html: initUser, // Inject HTML
        confirmButtonText: `Join meeting`,
        customClass: { popup: 'init-modal-size' },
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        willOpen: () => {
            hide(loadingDiv);
        },
        didOpen: () => {
            showMobileAudioGuidance();
        },
        inputValidator: (name) => {
            if (isVideoAllowed && !isInitVideoLoaded) {
                return 'Please wait for video to initialize...';
            }
            if (!name) return 'Please enter your email or name';
            const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name);
            if ((isEmail && name.length > 254) || (!isEmail && name.length > 32)) {
                return isEmail ? 'Email must be max 254 char' : 'Name must be max 32 char';
            }
            name = filterXSS(name);
            if (isHtml(name)) return 'Invalid name!';
            if (!getCookie(room_id + '_name')) {
                window.localStorage.peer_name = name;
            }
            setCookie(room_id + '_name', name, 30);
            peer_name = name;

            if (isValidEmail(peer_name)) {
                getId('notifyEmailInput').value = peer_name;
            }
        },
    }).then(async () => {
        if (!usernameEmoji.classList.contains('hidden')) {
            usernameEmoji.classList.add('hidden');
        }
        if (initStream && !joinRoomWithScreen) {
            await stopTracks(initStream);
            elemDisplay('initVideo', false);
            initVideoContainerShow(false);
        }
        getPeerInfo();
        joinRoom(peer_name, room_id);
    });

    // Show the init user container injected in Swal
    initUser.classList.toggle('hidden');

    if (force_peer_name) {
        getId('usernameInput').disabled = true;
        hide(initUsernameEmojiButton);
    }

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

function mergeConfig(current, updated) {
    for (const key of Object.keys(updated)) {
        if (!current.hasOwnProperty(key) || typeof updated[key] !== 'object') {
            current[key] = updated[key];
        } else {
            mergeConfig(current[key], updated[key]);
        }
    }
    return current;
}

function showMobileAudioGuidance() {
    if (!isMobileDevice) return;

    const guidance = isMobileSafari
        ? `
            <div class="mic-guidance ios">
                <p class="title">
                    <i class="fas fa-info-circle"></i>
                    iOS Audio Routing
                </p>
                <p class="text">
                    iOS automatically routes audio to connected Bluetooth or external devices.
                    Connect your preferred microphone <strong>before</strong> joining.
                </p>
            </div>
        `
        : `
            <div class="mic-guidance mobile">
                <p class="title">
                    <i class="fas fa-mobile-alt"></i>
                    External Microphones
                </p>
                <p class="text">
                    External microphones may require device reconnection to activate.
                </p>
            </div>
        `;

    const audioGuidanceDiv = document.createElement('div');
    audioGuidanceDiv.id = 'mobileAudioGuidance';
    audioGuidanceDiv.innerHTML = guidance;
    audioGuidanceDiv.style.transition = 'opacity 0.5s ease';

    const initUserContainer = document.getElementById('initUser');
    if (initUserContainer && initMicrophoneSelect) {
        initMicrophoneSelect.parentElement.insertBefore(audioGuidanceDiv, initMicrophoneSelect);
    }

    setTimeout(() => {
        audioGuidanceDiv.style.opacity = '0';
        setTimeout(() => {
            audioGuidanceDiv.remove();
        }, 500);
    }, 6000);
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

    elemDisplay('imageGrid', false);

    isVideoAllowed &&
    isMediaStreamTrackAndTransformerSupported &&
    (BUTTONS.settings.virtualBackground !== undefined ? BUTTONS.settings.virtualBackground : true)
        ? show(initVirtualBackgroundButton)
        : hide(initVirtualBackgroundButton);
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
    if (isAudioAllowed && isVideoAllowed && !isMobileDevice) show(initVideoAudioRefreshButton);
    setColor(initAudioVideoButton, isAudioVideoAllowed ? 'white' : 'red');
    setColor(initAudioButton, isAudioAllowed ? 'white' : 'red');
    setColor(initVideoButton, isVideoAllowed ? 'white' : 'red');
    setColor(startAudioButton, isAudioAllowed ? 'white' : 'red');
    setColor(startVideoButton, isVideoAllowed ? 'white' : 'red');
    await checkInitVideo(isVideoAllowed);
    checkInitAudio(isAudioAllowed);

    elemDisplay('imageGrid', false);

    isVideoAllowed &&
    isMediaStreamTrackAndTransformerSupported &&
    (BUTTONS.settings.virtualBackground !== undefined ? BUTTONS.settings.virtualBackground : true)
        ? show(initVirtualBackgroundButton)
        : hide(initVirtualBackgroundButton);
}

async function checkInitVideo(isVideoAllowed) {
    if (isVideoAllowed && BUTTONS.main.startVideoButton) {
        if (initVideoSelect.value) {
            initVideoContainerShow();
            await changeCamera(initVideoSelect.value);
            isInitVideoLoaded = true;
        }
        sound('joined');
    } else {
        if (initStream) {
            stopTracks(initStream);
            elemDisplay('initVideo', false);
            elemDisplay('initVideoLoader', false);
            initVideoContainerShow(false);
            sound('left');
        }
        isInitVideoLoaded = !isVideoAllowed;
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
    initVideoContainerClass.style.padding = show ? '10px' : '0px';
}

function checkMedia() {
    let audio = getQueryParam('audio');
    let video = getQueryParam('video');
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

    // Enforce BUTTONS config: URL params cannot override disabled buttons
    if (!BUTTONS.main.startAudioButton) isAudioAllowed = false;
    if (!BUTTONS.main.startVideoButton) isVideoAllowed = false;

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
            html: renderRoomTemplate('popupShareRoomTemplate', {
                text: {
                    roomUrl: RoomURL,
                },
            }),
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
    const qr = new QRious({
        element: document.getElementById('qrRoom'),
        value: RoomURL,
    });
    qr.set({
        size: 256,
    });
}

function makeRoomPopupQR() {
    const qr = new QRious({
        element: document.getElementById('qrRoomPopup'),
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

function copyToClipboard(txt, showTxt = true) {
    let tmpInput = document.createElement('input');
    document.body.appendChild(tmpInput);
    tmpInput.value = txt;
    tmpInput.select();
    tmpInput.setSelectionRange(0, 99999); // For mobile devices
    navigator.clipboard.writeText(tmpInput.value);
    document.body.removeChild(tmpInput);
    showTxt
        ? userLog('info', `${txt} copied to clipboard 👍`, 'top-end')
        : userLog('info', `Copied to clipboard 👍`, 'top-end');
}

function shareRoomByEmail() {
    Swal.fire({
        allowOutsideClick: false,
        allowEscapeKey: false,
        background: swalBackground,
        imageUrl: image.email,
        position: 'center',
        title: 'Select a Date and Time',
        html: renderRoomTemplate('popupDateTimePickerTemplate'),
        showCancelButton: true,
        confirmButtonText: 'OK',
        cancelButtonColor: 'red',
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        didOpen: () => {
            flatpickr('#datetimePicker', {
                enableTime: true,
                dateFormat: 'Y-m-d H:i',
                time_24hr: true,
            });
        },
        preConfirm: () => {
            const selectedDateTime = Swal.getPopup()?.querySelector('#datetimePicker')?.value?.trim() || '';

            if (!selectedDateTime) {
                Swal.showValidationMessage('Please select a date and time');
                return false;
            }

            const newLine = '\r\n\r\n';
            const roomPassword =
                isRoomLocked && (room_password || rc.RoomPassword)
                    ? 'Password: ' + (room_password || rc.RoomPassword) + newLine
                    : '';
            const emailSubject = `Please join our ${BRAND.app.name} Video Chat Meeting`;
            const emailBody = `The meeting is scheduled at:${newLine}DateTime: ${selectedDateTime}${newLine}${roomPassword}Click to join: ${RoomURL}${newLine}`;
            const mailtoUrl = `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

            bypassBeforeUnloadOnce = true;
            setTimeout(() => {
                bypassBeforeUnloadOnce = false;
            }, 1500);
            window.location.href = mailtoUrl;
        },
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
            roomIsReady
        );
        handleRoomClientEvents();
    }
}

function roomIsReady() {
    startRoomSession();

    makeRoomPopupQR();

    if (peer_avatar && isValidAvatarURL(peer_avatar)) {
        myProfileAvatar.setAttribute('src', peer_avatar);
    } else if (rc.isValidEmail(peer_name)) {
        myProfileAvatar.style.borderRadius = `50px`;
        myProfileAvatar.setAttribute('src', rc.genGravatar(peer_name));
    } else {
        myProfileAvatar.setAttribute('src', rc.genAvatarSvg(peer_name, 64));
    }

    updateMyAvatarResetButtonVisibility();

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
    BUTTONS.main.participantsButton && show(participantsButton);
    BUTTONS.main.pollButton && show(pollButton);
    BUTTONS.main.editorButton && show(editorButton);
    BUTTONS.main.raiseHandButton && show(raiseHandButton);
    BUTTONS.main.emojiRoomButton && show(emojiRoomButton);
    show(fileShareExtraButton);
    !BUTTONS.chat.chatSaveButton && hide(chatSaveButton);
    BUTTONS.chat.chatEmojiButton && show(chatEmojiButton);
    show(chatShowParticipantsListBtn);
    BUTTONS.chat.chatMarkdownButton && show(chatMarkdownButton);
    show(fileShareChatButton);

    !BUTTONS.poll.pollSaveButton && hide(pollSaveButton);

    speechRecognition && BUTTONS.chat.chatSpeechStartButton
        ? show(chatSpeechStartButton)
        : (BUTTONS.chat.chatSpeechStartButton = false);

    speechRecognition && BUTTONS.main.speechRecButton ? show(speechRecButton) : (BUTTONS.main.speechRecButton = false);

    transcription.isSupported() && BUTTONS.main.transcriptionButton
        ? show(transcriptionButton)
        : (BUTTONS.main.transcriptionButton = false);

    show(chatCleanTextButton);
    show(chatPasteButton);
    show(chatSendButton);
    if (isDesktopDevice) {
        show(whiteboardGridBtn);
    }
    if (isMobileDevice) {
        hide(initVideoAudioRefreshButton);
        BUTTONS.main.swapCameraButton && show(swapCameraButton);
        rc.chatMaximize();
        hide(chatTogglePin);
        hide(chatMaxButton);
        hide(chatMinButton);
        rc.pollMaximize();
        hide(pollTogglePin);
        hide(editorTogglePin);
        hide(breakoutTogglePin);
        hide(pollMaxButton);
        hide(pollMinButton);
        transcription.maximize();
        hide(transcriptionTogglePinBtn);
        hide(transcriptionMaxBtn);
        hide(transcriptionMinBtn);
    } else {
        //rc.makeDraggable(emojiPickerContainer, emojiPickerHeader);
        rc.makeDraggable(chatRoom, chatHeader);
        rc.makeDraggable(pollRoom, pollHeader);
        //rc.makeDraggable(editorRoom, editorHeader);
        rc.makeDraggable(mySettings, mySettingsHeader);
        rc.makeDraggable(whiteboard, whiteboardHeader);
        rc.makeDraggable(sendFileDiv, sendFileDragHandle);
        rc.makeDraggable(receiveFileDiv, receiveFileDragHandle);
        rc.makeDraggable(lobby, lobbyHeader);
        rc.makeDraggable(transcriptionRoom, transcriptionHeader);
        rc.makeDraggable(breakoutToolbar, breakoutToolbarHandle);
        rc.makeDraggable(breakoutPanel, breakoutPanelHeader);
        if (navigator.getDisplayMedia || navigator.mediaDevices.getDisplayMedia) {
            if (BUTTONS.main.startScreenButton) {
                show(startScreenButton);
                show(ScreenQualityDiv);
                show(ScreenFpsDiv);
            }
            BUTTONS.main.snapshotRoomButton && show(snapshotRoomButton);
        }
        BUTTONS.chat.chatPinButton && !isMobileDevice && show(chatTogglePin);
        BUTTONS.chat.chatMaxButton && show(chatMaxButton);
        BUTTONS.poll.pollPinButton && show(pollTogglePin);
        show(editorTogglePin);
        show(breakoutTogglePin);
        BUTTONS.poll.pollMaxButton && show(pollMaxButton);
        BUTTONS.settings.pushToTalk && show(pushToTalkDiv);
        BUTTONS.settings.tabRTMPStreamingBtn &&
            show(tabRTMPStreamingBtn) &&
            show(startRtmpButton) &&
            show(startRtmpURLButton) &&
            show(streamerRtmpButton);
    }
    if (BUTTONS.main.fullScreenButton && !parserResult.browser.name.toLowerCase().includes('safari')) {
        document.onfullscreenchange = () => {
            if (!document.fullscreenElement) rc.isDocumentOnFullScreen = false;
        };
        show(fullScreenButton);
    } else {
        hide(fullScreenButton);
    }
    BUTTONS.main.whiteboardButton && show(whiteboardButton);
    if (BUTTONS.main.documentPiPButton && showDocumentPipBtn) show(documentPiPButton);
    BUTTONS.main.settingsButton && show(settingsButton);
    isAudioAllowed ? show(stopAudioButton) : BUTTONS.main.startAudioButton && show(startAudioButton);
    isVideoAllowed ? show(stopVideoButton) : BUTTONS.main.startVideoButton && show(startVideoButton);
    if (!BUTTONS.main.startAudioButton) {
        elemDisplay('tabAudioDevicesBtn', false);
        elemDisplay('tabAudioDevices', false);
    }
    if (!BUTTONS.main.startVideoButton) {
        elemDisplay('tabVideoDevicesBtn', false);
        elemDisplay('tabVideoDevices', false);
    }
    BUTTONS.settings.activeRooms && show(activeRoomsButton);
    BUTTONS.settings.fileSharing && show(fileShareButton);
    BUTTONS.settings.lockRoomButton && show(lockRoomButton);
    BUTTONS.settings.broadcastingButton && show(broadcastingButton);
    BUTTONS.settings.lobbyButton && show(lobbyButton);
    BUTTONS.settings.sendEmailInvitation && show(sendEmailInvitation);
    !BUTTONS.settings.customNoiseSuppression && hide(noiseSuppressionButton);
    BUTTONS.settings.tabNotificationsBtn && show(tabNotificationsBtn);
    if (rc.recording.recSyncServerRecording) show(roomRecordingServer);
    BUTTONS.main.aboutButton && show(aboutButton);
    if (!isMobileDevice) show(pinUnpinGridDiv);
    if (!isSpeechSynthesisSupported) hide(speechMsgDiv);
    if (
        isMediaStreamTrackAndTransformerSupported &&
        (BUTTONS.settings.virtualBackground !== undefined ? BUTTONS.settings.virtualBackground : true)
    ) {
        rc.showVideoImageSelector();
    }
    handleButtons();
    handleSelects();
    handleInputs();
    handleChatEmojiPicker();
    handleRoomEmojiPicker();
    handleEditor();
    loadSettingsFromLocalStorage();
    startSessionTimer();
    handleButtonsBar();
    handleDropdownHover();
    setupSettingsExtraDropdown();
    setupQuickDeviceSwitchDropdowns();
    checkButtonsBar();
    checkBreakoutRoom();
    if (room_password) {
        lockRoomButton.click();
    }
    //show(restartICEButton); // TEST
}

// ####################################################
// PROFILE AVATAR URL
// ####################################################

async function updateMyPeerAvatarByUrl() {
    const result = await Swal.fire({
        background: swalBackground,
        title: 'Set avatar URL',
        input: 'url',
        inputLabel: 'Public image URL',
        inputPlaceholder: 'https://example.com/avatar.jpg',
        confirmButtonText: 'Apply',
        showCancelButton: true,
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        inputValidator: (value) => {
            if (!value) return 'Please enter an image URL';
            if (value.startsWith('data:')) return 'Base64 avatars are not supported';
            if (!isValidAvatarURL(value)) return 'Only http/https URLs are supported';
            return null;
        },
        preConfirm: (url) =>
            new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve(url);
                img.onerror = () => {
                    Swal.showValidationMessage(
                        'Could not load the image, the URL may be invalid, restricted, or not an image'
                    );
                    resolve(false);
                };
                img.src = url;
            }),
        didOpen: () => {
            const input = document.querySelector('.swal2-input');
            if (!input) return;

            // Preview image
            const preview = document.createElement('img');
            preview.style.cssText =
                'display:none;width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid #4caf50;margin:8px auto 4px;';
            input.parentNode.insertBefore(preview, input);

            function updatePreview(url) {
                if (!url) {
                    preview.style.display = 'none';
                    return;
                }
                preview.src = url;
                preview.style.display = 'block';
            }

            input.addEventListener('input', () => updatePreview(input.value.trim()));

            function makeAvatarImg(url) {
                const img = document.createElement('img');
                img.src = url;
                img.title = 'Click to use this avatar';
                img.style.cssText =
                    'width:48px;height:48px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:border-color 0.2s;object-fit:cover;background:#222;flex-shrink:0;';
                img.addEventListener('mouseover', () => (img.style.borderColor = '#4caf50'));
                img.addEventListener('mouseout', () => (img.style.borderColor = 'transparent'));
                img.addEventListener('click', () => {
                    input.value = url;
                    input.dispatchEvent(new Event('input'));
                    updatePreview(url);
                });
                return img;
            }

            // Self-hosted avatars
            const localLabel = document.createElement('p');
            localLabel.textContent = 'Pick an avatar:';
            localLabel.style.cssText = 'color:#aaa;font-size:12px;margin:10px 0 6px;text-align:center;';

            const localGrid = document.createElement('div');
            localGrid.style.cssText =
                'display:flex;flex-wrap:wrap;justify-content:center;gap:8px;max-height:120px;overflow-y:scroll;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:4px 2px;margin-bottom:4px;';
            localGrid.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });

            for (let i = 1; i <= 25; i++) {
                const url = `${window.location.origin}/images/avatars/avatar_${String(i).padStart(2, '0')}.png`;
                localGrid.appendChild(makeAvatarImg(url));
            }

            // DiceBear random avatars
            const randomAvatarLabel = document.createElement('p');
            randomAvatarLabel.textContent = 'Or pick a random avatar:';
            randomAvatarLabel.style.cssText = 'color:#aaa;font-size:12px;margin:10px 0 6px;text-align:center;';

            const randomAvatarGrid = document.createElement('div');
            randomAvatarGrid.style.cssText =
                'display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-bottom:4px;';
            const dicebearStyles = [
                'bottts-neutral',
                'adventurer-neutral',
                'thumbs',
                'initials',
                'identicon',
                'shapes',
            ];

            for (let i = 0; i < 6; i++) {
                const seed = Math.random().toString(36).substring(2, 10);
                const style = dicebearStyles[i % dicebearStyles.length];
                const url = `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
                randomAvatarGrid.appendChild(makeAvatarImg(url));
            }

            let insertAfter = input;
            for (const el of [localLabel, localGrid, randomAvatarLabel, randomAvatarGrid]) {
                insertAfter.parentNode.insertBefore(el, insertAfter.nextSibling);
                insertAfter = el;
            }
        },
    });

    if (!result.isConfirmed || !result.value) return;

    applyPeerAvatar(result.value);
}

function applyPeerAvatar(avatarSrc) {
    try {
        peer_avatar = avatarSrc;
        hasTemporaryAvatar = true;

        localStorageSettings.peer_avatar = peer_avatar;
        lS.setSettings(localStorageSettings);

        myProfileAvatar.setAttribute('src', peer_avatar);
        rc.setVideoAvatarImgName(rc.peer_id + '__img', peer_name, peer_avatar);
        rc.setMsgAvatar('left', peer_name, peer_avatar);
        updateMyAvatarResetButtonVisibility();

        rc.peer_avatar = peer_avatar;
        rc.peer_info.peer_avatar = peer_avatar;
        rc.updatePeerInfo(peer_name, rc.peer_id, 'avatar', peer_avatar);

        userLog('info', 'Avatar applied and saved for future sessions');
    } catch (err) {
        console.error('Failed to set avatar URL', err);
        userLog('error', 'Unable to apply avatar URL');
    }
}

function resetMyPeerAvatarInMemory() {
    peer_avatar = false;
    hasTemporaryAvatar = false;
    localStorageSettings.peer_avatar = '';
    lS.setSettings(localStorageSettings);

    if (rc.isValidEmail(peer_name)) {
        myProfileAvatar.style.borderRadius = '50px';
        myProfileAvatar.setAttribute('src', rc.genGravatar(peer_name));
    } else {
        myProfileAvatar.setAttribute('src', rc.genAvatarSvg(peer_name, 64));
    }

    rc.setVideoAvatarImgName(rc.peer_id + '__img', peer_name, false);
    rc.setMsgAvatar('left', peer_name, false);
    updateMyAvatarResetButtonVisibility();

    rc.peer_avatar = false;
    rc.peer_info.peer_avatar = false;
    rc.updatePeerInfo(peer_name, rc.peer_id, 'avatar', false);

    userLog('info', 'Avatar reset to default');
}

function updateMyAvatarResetButtonVisibility() {
    if (!myProfileAvatarResetBtn) return;
    myProfileAvatarResetBtn.classList.toggle('hidden', !hasTemporaryAvatar);
    if (myProfileAvatarUploadBtn) myProfileAvatarUploadBtn.classList.toggle('hidden', hasTemporaryAvatar);
}

// ####################################################
// UTILS
// ####################################################

function renderRoomTemplate(templateId, { text = {}, html = {}, attrs = {} } = {}) {
    const template = document.getElementById(templateId);
    if (!template || !template.content) return '';

    const wrapper = document.createElement('div');
    wrapper.appendChild(template.content.cloneNode(true));

    wrapper.querySelectorAll('*').forEach((element) => {
        element.getAttributeNames().forEach((name) => {
            if (!name.startsWith('data-template-attr-')) return;

            const attrName = name.replace('data-template-attr-', '');
            const key = element.getAttribute(name);
            const value = attrs[key];

            if (value === undefined || value === null) {
                element.removeAttribute(attrName);
            } else {
                element.setAttribute(attrName, value);
            }

            element.removeAttribute(name);
        });
    });

    wrapper.querySelectorAll('[data-template-text]').forEach((element) => {
        const key = element.getAttribute('data-template-text');
        element.textContent = text[key] ?? '';
    });

    wrapper.querySelectorAll('[data-template-html]').forEach((element) => {
        const key = element.getAttribute('data-template-html');
        element.innerHTML = html[key] ?? '';
    });

    return wrapper.innerHTML.trim();
}

function updateChatConversationsCount() {
    const el = getId('chatConversationsCount');
    if (!el) return;
    const list = getId('participantsList');
    const count = list ? list.querySelectorAll(':scope > li').length : 0;
    el.textContent = count > 0 ? `${count} conversation${count !== 1 ? 's' : ''}` : '';
}

function updateChatCharCount() {
    const el = getId('chatCharCount');
    if (!el) return;
    const len = chatMessage ? chatMessage.value.length : 0;
    el.textContent = `${len} / 4000`;
}

function updateChatEmptyNotice() {
    const chatLists = [
        getId('chatGPTMessages'),
        getId('deepSeekMessages'),
        getId('chatPublicMessages'),
        getId('chatPrivateMessages'),
    ].filter(Boolean);
    const emptyNotice = getId('chatEmptyNotice');
    if (!emptyNotice) return;
    const hasMessages = chatLists.some((ul) => ul.children.length > 0);
    hasMessages ? emptyNotice.classList.add('hidden') : emptyNotice.classList.remove('hidden');
}

function elemDisplay(elem, display, mode = 'block') {
    elem = typeof elem === 'string' ? getId(elem) : elem;
    if (!elem) {
        elementNotFound(elem);
        return;
    }
    elem.style.display = display ? mode : 'none';
}

function hide(elem) {
    elem = typeof elem === 'string' ? getId(elem) : elem;
    if (!elem || !elem.classList) {
        elementNotFound(elem);
        return;
    }
    if (!elem.classList.contains('hidden')) elem.classList.toggle('hidden');
}

function show(elem) {
    elem = typeof elem === 'string' ? getId(elem) : elem;
    if (!elem || !elem.classList) {
        elementNotFound(elem);
        return;
    }
    if (elem.classList.contains('hidden')) elem.classList.toggle('hidden');
}

function disable(elem, disabled) {
    elem = typeof elem === 'string' ? getId(elem) : elem;
    if (!elem) {
        elementNotFound(elem);
        return;
    }
    elem.disabled = disabled;
}

function setColor(elem, color) {
    elem = typeof elem === 'string' ? getId(elem) : elem;
    if (!elem) {
        elementNotFound(elem);
        return;
    }
    elem.style.color = color;
}

function getColor(elem) {
    elem = typeof elem === 'string' ? getId(elem) : elem;
    if (!elem) {
        elementNotFound(elem);
        return undefined;
    }
    return elem.style.color;
}

function elementNotFound(element) {
    console.error('Element Not Found', element);
    return false;
}

// ####################################################
// SESSION TIMER
// ####################################################

function startSessionTimer() {
    sessionTime.style.display = 'inline';
    let callStartTime = Date.now();
    let callElapsedSecondsTime = 0;
    setInterval(function printTime() {
        callElapsedSecondsTime++;
        let callElapsedTime = Date.now() - callStartTime;
        sessionTime.innerText = getTimeToString(callElapsedTime);
        const myCurrentSessionTime = document.querySelector('.current-session-time.notranslate');
        if (myCurrentSessionTime) myCurrentSessionTime.innerText = secondsToHms(callElapsedSecondsTime);
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

function secondsToHms(d) {
    d = Number(d);
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor((d % 3600) % 60);
    const hDisplay = h > 0 ? h + 'h' : '';
    const mDisplay = m > 0 ? m + 'm' : '';
    const sDisplay = s > 0 ? s + 's' : '';
    return hDisplay + ' ' + mDisplay + ' ' + sDisplay;
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
            rc._getRecIndicators().forEach((el) => {
                el.innerHTML = '🔴 ' + (recordingStatus.innerText !== '0s' ? recordingStatus.innerText : 'REC');
            });
        }
    }, 1000);
}
function stopRecordingTimer() {
    clearInterval(recTimer);
    recordingStatus.innerText = '0s';
}

// ####################################################
// HTML BUTTONS
// ####################################################

function handleButtons() {
    // Lobby...
    document.getElementById('lobbyUsers').addEventListener('click', function (event) {
        switch (event.target.id) {
            case 'lobbyAcceptAllBtn':
                rc.lobbyAcceptAll();
                break;
            case 'lobbyRejectAllBtn':
                rc.lobbyRejectAll();
                break;
            default:
                break;
        }
    });
    bottomButtons.onmouseover = () => {
        isButtonsBarOver = true;
    };
    bottomButtons.onmouseout = () => {
        isButtonsBarOver = false;
    };
    exitButton.onclick = () => {
        leaveRoom();
    };
    shareButton.onclick = () => {
        shareRoom(true);
    };
    shareButton.onmouseenter = () => {
        if (isMobileDevice || !BUTTONS.popup.shareRoomQrOnHover) return;
        show(qrRoomPopupContainer);
    };
    shareButton.onmouseleave = () => {
        if (isMobileDevice || !BUTTONS.popup.shareRoomQrOnHover) return;
        hide(qrRoomPopupContainer);
    };
    hideMeButton.onclick = (e) => {
        if (isHideALLVideosActive) {
            return userLog('warning', 'To use this feature, please toggle video focus mode', 'top-end', 6000);
        }
        isHideMeActive = !isHideMeActive;
        rc.handleHideMe();
        hideClassElements('videoMenuBar');
    };
    settingsButton.onclick = () => {
        rc.toggleMySettings();
    };
    mySettingsCloseBtn.onclick = () => {
        rc.toggleMySettings();
    };
    myProfileAvatarUploadBtn.onclick = async () => {
        await updateMyPeerAvatarByUrl();
    };
    myProfileAvatarResetBtn.onclick = () => {
        resetMyPeerAvatarInMemory();
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
    tabRTMPStreamingBtn.onclick = (e) => {
        rc.getRTMP();
        rc.openTab(e, 'tabRTMPStreaming');
    };
    refreshVideoFiles.onclick = () => {
        rc.getRTMP();
        userLog('info', 'Refreshed video files', 'top-end');
    };
    tabAspectBtn.onclick = (e) => {
        rc.openTab(e, 'tabAspect');
    };
    tabNotificationsBtn.onclick = (e) => {
        rc.openTab(e, 'tabNotifications');
    };
    tabModeratorBtn.onclick = (e) => {
        rc.openTab(e, 'tabModerator');
    };
    tabProfileBtn.onclick = (e) => {
        rc.openTab(e, 'tabProfile');
    };
    tabShortcutsBtn.onclick = (e) => {
        rc.openTab(e, 'tabShortcuts');
    };
    tabStylingBtn.onclick = (e) => {
        rc.openTab(e, 'tabStyling');
    };
    tabLanguagesBtn.onclick = (e) => {
        rc.openTab(e, 'tabLanguages');
    };
    notifyEmailCleanBtn.onclick = () => {
        rc.cleanNotifications();
        rc.saveNotifications(false);
    };
    saveNotificationsBtn.onclick = () => {
        rc.saveNotifications();
    };
    tabVideoAIBtn.onclick = (e) => {
        rc.openTab(e, 'tabVideoAI');
        rc.getAvatarList();
        rc.getVoiceList();
    };
    avatarVideoAIStart.onclick = (e) => {
        rc.stopSession();
        rc.handleVideoAI();
        rc.toggleMySettings();
    };
    avatarQuality.selectedIndex = 1;
    avatarQuality.onchange = (e) => {
        VideoAI.quality = e.target.value;
    };
    speakerTestBtn.onclick = () => {
        playSpeaker(speakerSelect?.value, 'ring');
    };
    roomId.onclick = () => {
        isMobileDevice ? shareRoom(true) : copyRoomURL();
    };
    roomSendEmail.onclick = () => {
        shareRoomByEmail();
    };
    chatButton.onclick = () => {
        rc.toggleChat();
    };
    participantsButton.onclick = async () => {
        rc.toggleParticipants();
    };
    // Voice Commands
    speechRecButton.onclick = () => {
        if (recognition) {
            isSpeechRecRunning ? stopSpeech() : startSpeech();
        }
    };
    // Polls
    pollButton.onclick = () => {
        rc.togglePoll();
    };
    pollMaxButton.onclick = () => {
        rc.pollMaximize();
    };
    pollMinButton.onclick = () => {
        rc.pollMinimize();
    };
    pollCloseBtn.onclick = () => {
        rc.togglePoll();
    };
    pollTogglePin.onclick = () => {
        rc.togglePollPin();
    };
    pollSaveButton.onclick = () => {
        rc.pollSaveResults();
    };
    pollAddOptionBtn.onclick = () => {
        rc.pollAddOptions();
    };
    pollDelOptionBtn.onclick = () => {
        rc.pollDeleteOptions();
    };
    pollCreateForm.onsubmit = (e) => {
        rc.pollCreateNewForm(e);
    };
    // Breakout Rooms
    breakoutRoomButton.onclick = () => {
        toggleBreakoutPanel();
    };
    breakoutReturnBtn.onclick = () => {
        returnToMainRoom();
    };
    breakoutHelpBtn.onclick = () => {
        askBreakoutHelp();
    };
    breakoutPanelCloseBtn.onclick = () => {
        toggleBreakoutPanel();
    };
    breakoutAddRoomBtn.onclick = () => {
        addBreakoutRoom();
    };
    breakoutRefreshBtn.onclick = () => {
        refreshBreakoutPanel();
    };
    breakoutTogglePin.onclick = () => {
        rc.toggleBreakoutPin();
    };
    breakoutLaunchBtn.onclick = () => {
        launchBreakoutRooms();
    };
    breakoutDeleteAllBtn.onclick = () => {
        deleteAllBreakoutRooms();
    };
    breakoutBroadcastAllBtn.onclick = () => {
        broadcastToBreakoutRooms();
    };
    breakoutBroadcastInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') broadcastToBreakoutRooms();
    });
    breakoutEndAllBtn.onclick = () => {
        endAllBreakoutSessions();
    };
    breakoutAutoAssignBtn.onclick = () => {
        autoAssignBreakoutRooms();
    };
    breakoutParticipantSearch.addEventListener('input', () => {
        filterBreakoutParticipants();
    });
    editorButton.onclick = () => {
        rc.toggleEditor();
        if (isPresenter && !rc.editorIsLocked()) {
            rc.editorSendAction('open');
        }
    };
    editorCloseBtn.onclick = () => {
        rc.toggleEditor();
        if (isPresenter && !rc.editorIsLocked()) {
            rc.editorSendAction('close');
        }
    };
    editorTogglePin.onclick = () => {
        rc.toggleEditorPin();
    };
    editorLockBtn.onclick = () => {
        rc.toggleLockUnlockEditor();
    };
    editorUnlockBtn.onclick = () => {
        rc.toggleLockUnlockEditor();
    };
    editorCleanBtn.onclick = () => {
        rc.editorClean();
    };
    editorCopyBtn.onclick = () => {
        rc.editorCopy();
    };
    editorSaveBtn.onclick = () => {
        rc.editorSave();
    };
    editorUndoBtn.onclick = () => {
        rc.editorUndo();
    };
    editorRedoBtn.onclick = () => {
        rc.editorRedo();
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
    transcriptionAllBtn.onclick = () => {
        transcription.startAll();
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
        rc.toggleShowParticipants(true);
    };
    chatShowParticipantsListBtn.onclick = (e) => {
        rc.toggleShowParticipants(true);
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
        rc.toggleRoomFullScreen();
    };
    recordingImage.onclick = () => {
        isRecording ? stopRecButton.click() : startRecButton.click();
    };
    startRecButton.onclick = () => {
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
        hideClassElements('videoMenuBar');
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

        const producerExist = rc.producerExist(RoomClient.mediaType.audio);
        console.log('START AUDIO producerExist --->', producerExist);

        producerExist
            ? await rc.resumeProducer(RoomClient.mediaType.audio)
            : await rc.produce(RoomClient.mediaType.audio, microphoneSelect.value);

        rc.updatePeerInfo(peer_name, socket.id, 'audio', true);
    };
    stopAudioButton.onclick = async () => {
        if (isPushToTalkActive) return;
        setAudioButtonsDisabled(true);

        const producerExist = rc.producerExist(RoomClient.mediaType.audio);
        console.log('STOP AUDIO producerExist --->', producerExist);

        producerExist
            ? await rc.pauseProducer(RoomClient.mediaType.audio)
            : await rc.closeProducer(RoomClient.mediaType.audio);

        rc.updatePeerInfo(peer_name, socket.id, 'audio', false);
    };
    startVideoButton.onclick = async () => {
        const moderator = rc.getModerator();
        if (moderator.video_cant_unhide) {
            return userLog('warning', 'The moderator does not allow you to unhide', 'top-end', 6000);
        }
        setVideoButtonsDisabled(true);
        if (!isEnumerateVideoDevices) await initEnumerateVideoDevices();
        await rc.produce(RoomClient.mediaType.video, videoSelect.value);
        // await rc.resumeProducer(RoomClient.mediaType.video);
    };
    stopVideoButton.onclick = () => {
        setVideoButtonsDisabled(true);
        rc.closeProducer(RoomClient.mediaType.video);
        // await rc.pauseProducer(RoomClient.mediaType.video);
    };
    startScreenButton.onclick = async () => {
        const moderator = rc.getModerator();
        if (moderator.screen_cant_share) {
            return userLog('warning', 'The moderator does not allow you to share the screen', 'top-end', 6000);
        }
        await rc.produce(RoomClient.mediaType.screen);
    };
    stopScreenButton.onclick = () => {
        rc.closeProducer(RoomClient.mediaType.screen);
    };
    copyRtmpUrlButton.onclick = () => {
        rc.copyRTMPUrl(rtmpLiveUrl.value);
    };
    startRtmpButton.onclick = () => {
        if (rc.selectedRtmpFilename == '') {
            userLog('warning', 'Please select the Video file to stream', 'top-end', 6000);
            return;
        }
        rc.startRTMP();
    };
    stopRtmpButton.onclick = () => {
        rc.stopRTMP();
    };
    streamerRtmpButton.onclick = () => {
        rc.openRTMPStreamer();
    };
    startRtmpURLButton.onclick = () => {
        rc.startRTMPfromURL(rtmpStreamURL.value);
    };
    stopRtmpURLButton.onclick = () => {
        rc.stopRTMPfromURL();
    };
    activeRoomsButton.onclick = () => {
        rc.showActiveRooms();
    };
    fileShareButton.onclick = () => {
        rc.selectFileToShare(socket.id, true);
    };
    fileShareExtraButton.onclick = () => {
        fileShareButton.click();
    };
    fileShareChatButton.onclick = () => {
        rc.chatPeerId === 'all' ? fileShareButton.click() : rc.selectFileToShare(rc.chatPeerId, false, rc.chatPeerName);
    };
    videoShareButton.onclick = () => {
        rc.shareVideo('all');
    };
    videoCloseBtn.onclick = () => {
        if (rc._moderator.media_cant_sharing) {
            return userLog('warning', 'The moderator does not allow you close this media', 'top-end', 6000);
        }
        rc.closeVideo(true);
    };
    sendAbortBtn.onclick = () => {
        rc.abortFileTransfer();
    };
    receiveAbortBtn.onclick = () => {
        rc.abortReceiveFileTransfer();
    };
    receiveHideBtn.onclick = () => {
        rc.hideFileTransfer();
    };
    whiteboardButton.onclick = () => {
        toggleWhiteboard();
    };
    documentPiPButton.onclick = () => {
        rc.toggleDocumentPIP();
    };
    snapshotRoomButton.onclick = () => {
        rc.snapshotRoom();
    };
    whiteboardPencilBtn.onclick = () => {
        whiteboardResetAllMode();
        whiteboardIsPencilMode(true);
    };
    whiteboardVanishingBtn.onclick = () => {
        whiteboardResetAllMode();
        whiteboardIsVanishingMode(true);
    };
    whiteboardObjectBtn.onclick = () => {
        whiteboardResetAllMode();
        whiteboardIsObjectMode(true);
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
    whiteboardStickyNoteBtn.onclick = () => {
        whiteboardAddObj('stickyNote');
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
        whiteboardResetAllMode();
        whiteboardIsEraserMode(true);
    };
    whiteboardCleanBtn.onclick = () => {
        confirmClearBoard();
    };
    whiteboardShortcutsBtn.onclick = () => {
        showWhiteboardShortcuts();
    };
    whiteboardCloseBtn.onclick = () => {
        whiteboardAction(getWhiteboardAction('close'));
    };
    whiteboardLockBtn.onclick = () => {
        toggleLockUnlockWhiteboard();
    };
    whiteboardUnlockBtn.onclick = () => {
        toggleLockUnlockWhiteboard();
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
    restartICEButton.onclick = async () => {
        await rc.restartIce();
    };
}

// ####################################################
// HANDLE INIT USER
// ####################################################

function setButtonsInit() {
    if (!isMobileDevice) {
        setTippy('initAudioButton', 'Toggle the audio', 'top');
        setTippy('initVideoButton', 'Toggle the video', 'top');
        setTippy('initAudioVideoButton', 'Toggle the audio & video', 'top');
        setTippy('initStartScreenButton', 'Toggle screen sharing', 'top');
        setTippy('initStopScreenButton', 'Toggle screen sharing', 'top');
        setTippy('initVideoMirrorButton', 'Toggle video mirror', 'top');
        setTippy('initVirtualBackgroundButton', 'Set Virtual Background or Blur', 'top');
        setTippy('initUsernameEmojiButton', 'Toggle username emoji', 'top');
        setTippy('initExitButton', 'Leave meeting', 'top');
    }
    if (!isAudioAllowed) hide(initAudioButton);
    if (!isVideoAllowed) hide(initVideoButton);
    if (!isAudioAllowed || !isVideoAllowed) hide(initAudioVideoButton);
    if ((!isAudioAllowed && !isVideoAllowed) || isMobileDevice) hide(initVideoAudioRefreshButton);
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
        elemDisplay('initVideoLoader', true, 'flex');
        initVideoContainerShow();
    }
    const videoConstraints = {
        audio: false,
        video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            deviceId: { exact: deviceId },
            aspectRatio: 1.777,
        },
    };
    await navigator.mediaDevices
        .getUserMedia(videoConstraints)
        .then(async (camStream) => {
            initVideo.srcObject = camStream;
            initStream = camStream;
            console.log(
                '04.5 ----> Success attached init cam video stream',
                initStream.getVideoTracks()[0].getSettings()
            );
            checkInitConfig();
            camera = detectCameraFacingMode(camStream);
            handleCameraMirror(initVideo);
            elemDisplay('initVideoLoader', false);
            isInitVideoLoaded = true;
        })
        .catch((error) => {
            console.error('[Error] changeCamera', error);
            handleMediaError('video/audio', error, '/');
            isInitVideoLoaded = false;
            elemDisplay('initVideoLoader', false);
        });

    if (isVideoAllowed) {
        await loadVirtualBackgroundSettings();
    }
}

function detectCameraFacingMode(stream) {
    if (!stream || !stream.getVideoTracks().length) {
        console.warn("No video track found in the stream. Defaulting to 'user'.");
        return 'user';
    }
    const videoTrack = stream.getVideoTracks()[0];
    const settings = videoTrack.getSettings();
    const capabilities = videoTrack.getCapabilities?.() || {};
    const facingMode = settings.facingMode || capabilities.facingMode?.[0] || 'user';
    return facingMode === 'environment' ? 'environment' : 'user';
}

// ####################################################
// HANDLE MEDIA ERROR
// ####################################################

function handleMediaError(mediaType, err, redirectURL = false) {
    sound('alert');

    let errMessage = err;
    let getUserMediaError = true;

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
            if (videoQuality.selectedIndex != 0) {
                videoQuality.selectedIndex = rc.videoQualitySelectedIndex;
            }
            break;
        case 'NotAllowedError':
        case 'PermissionDeniedError':
            errMessage = 'Permission denied in browser';
            break;
        case 'TypeError':
            errMessage = 'Empty constraints object';
            break;
        default:
            getUserMediaError = false;
            break;
    }

    if (mediaType === 'screenType' && err.name === 'NotAllowedError') {
        console.warn('User cancelled the screen sharing prompt');
        return;
    }

    let html = `
    <ul style="text-align: left">
        <li>Media type: ${mediaType}</li>
        <li>Error name: ${err.name}</li>
        <li>
            <p>Error message:</p>
            <p style="color: red">${errMessage}</p>
        </li>`;

    if (getUserMediaError) {
        html += `
        <li>Common: <a href="https://blog.addpipe.com/common-getusermedia-errors" target="_blank">getUserMedia errors</a></li>`;
    }
    html += `
        </ul>
    `;

    popupHtmlMessage(null, image.forbidden, 'Access denied', html, 'center', redirectURL);

    const errorOutput = getUserMediaError
        ? `Access denied for ${mediaType} device [${err.name}]: ${errMessage} check the common getUserMedia errors: https://blog.addpipe.com/common-getusermedia-errors/`
        : `${err.message}`;

    throw new Error(errorOutput);
}

function popupHtmlMessage(icon, imageUrl, title, html, position, redirectURL = false, reloadPage = false) {
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
        if (result.isConfirmed) {
            if (redirectURL) {
                return openURL(redirectURL);
            }
            if (reloadPage) {
                location.href = location.href;
            }
        }
    });
}

async function toggleScreenSharing() {
    if (initStream) {
        await stopTracks(initStream);
        elemDisplay('initVideo', true);
        elemDisplay('initVideoLoader', true, 'flex');
        initVideoContainerShow();
    }
    joinRoomWithScreen = !joinRoomWithScreen;
    if (joinRoomWithScreen) {
        const defaultFrameRate = { ideal: 30 };
        const selectedValue = getId('videoFps').options[localStorageSettings.screen_fps].value;
        const customFrameRate = parseInt(selectedValue, 10);
        const frameRate = selectedValue == 'max' ? defaultFrameRate : customFrameRate;
        await navigator.mediaDevices
            .getDisplayMedia({ audio: true, video: { frameRate: frameRate } })
            .then((screenStream) => {
                if (initVideo.classList.contains('mirror')) {
                    initVideo.classList.toggle('mirror');
                }
                initVideo.srcObject = screenStream;
                initStream = screenStream;
                console.log('04.6 ----> Success attached init screen video stream', initStream);
                elemDisplay('initVideoLoader', false);
                show(initStopScreenButton);
                hide(initStartScreenButton);
                disable(initVideoSelect, true);
                disable(initVideoButton, true);
                disable(initAudioVideoButton, true);
                disable(initVideoAudioRefreshButton, true);
                disable(initVirtualBackgroundButton, true);
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
        disable(initVirtualBackgroundButton, false);
    }
}

function handleCameraMirror(video) {
    camera === 'environment'
        ? video.classList.remove('mirror') // Back camera → No mirror
        : video.classList.add('mirror'); // Disable mirror for rear camera
}

function handleSelects() {
    // devices options
    videoSelect.onchange = (e) => {
        videoQuality.selectedIndex = 0;
        // If video is currently OFF, just update selection for the next start.
        if (video) rc.closeThenProduce(RoomClient.mediaType.video, videoSelect.value);
        refreshLsDevices();
    };
    videoQuality.onchange = () => {
        rc.closeThenProduce(RoomClient.mediaType.video, videoSelect.value);
    };
    screenQuality.onchange = () => {
        rc.closeThenProduce(RoomClient.mediaType.screen);
    };
    screenOptimization.onchange = () => {
        rc.closeThenProduce(RoomClient.mediaType.screen);
        localStorageSettings.screen_optimization = screenOptimization.selectedIndex;
        lS.setSettings(localStorageSettings);
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
        // If audio is currently OFF, just update selection for the next start.
        if (audio) rc.closeThenProduce(RoomClient.mediaType.audio, microphoneSelect.value);
        refreshLsDevices();
    };
    speakerSelect.onchange = () => {
        rc.changeAudioDestination();
        refreshLsDevices();
    };
    switchDominantSpeakerFocus.onchange = async (e) => {
        localStorageSettings.dominant_speaker_focus = e.currentTarget.checked;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchPushToTalk.onchange = async (e) => {
        const producerExist = rc.producerExist(RoomClient.mediaType.audio);
        if (!producerExist && !isPushToTalkActive) {
            console.log('Push-to-talk: start audio producer');
            setAudioButtonsDisabled(true);
            if (!isEnumerateAudioDevices) initEnumerateAudioDevices();
            await rc.produce(RoomClient.mediaType.audio, microphoneSelect.value);
            setTimeout(async function () {
                await rc.pauseProducer(RoomClient.mediaType.audio);
                rc.updatePeerInfo(peer_name, socket.id, 'audio', false);
            }, 1000);
        }
        isPushToTalkActive = !isPushToTalkActive;
        if (producerExist && !isPushToTalkActive) {
            console.log('Push-to-talk: resume audio producer');
            await rc.resumeProducer(RoomClient.mediaType.audio);
            rc.updatePeerInfo(peer_name, socket.id, 'audio', true);
        }
        e.target.blur(); // Removes focus from the element
        rc.roomMessage('ptt', isPushToTalkActive);
        console.log(`Push-to-talk enabled: ${isPushToTalkActive}`);
    };
    document.addEventListener('keydown', async (e) => {
        if (!isPushToTalkActive) return;
        if (e.code === 'Space') {
            if (isSpaceDown) return;
            await rc.resumeProducer(RoomClient.mediaType.audio);
            rc.updatePeerInfo(peer_name, socket.id, 'audio', true);
            isSpaceDown = true;
            console.log('Push-to-talk: audio resumed');
        }
    });
    document.addEventListener('keyup', async (e) => {
        if (!isPushToTalkActive) return;
        if (e.code === 'Space') {
            await rc.pauseProducer(RoomClient.mediaType.audio);
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
    switchKeepButtonsVisible.onchange = (e) => {
        isButtonsBarOver = isKeepButtonsVisible = e.currentTarget.checked;
        localStorageSettings.keep_buttons_visible = isButtonsBarOver;
        lS.setSettings(localStorageSettings);
        const status = isButtonsBarOver ? 'enabled' : 'disabled';
        userLog('info', `Buttons always visible ${status}`, 'top-end');
        e.target.blur();
    };

    // Wake Lock for mobile/tablet
    if (!isDesktopDevice && isWakeLockSupported()) {
        switchKeepAwake.onchange = async (e) => {
            e.target.blur();
            applyKeepAwake(e.currentTarget.checked);
        };
    } else {
        hide(keepAwakeButton);
    }

    switchChatPin.onchange = (e) => {
        isChatPinEnabled = e.currentTarget.checked;
        localStorageSettings.chat_pin = isChatPinEnabled;
        lS.setSettings(localStorageSettings);
        const status = isChatPinEnabled ? 'enabled' : 'disabled';
        userLog('info', `Chat auto pin ${status}`, 'top-end');
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
    switchServerRecording.onchange = (e) => {
        rc.recording.recSyncServerRecording = e.currentTarget.checked;
        rc.roomMessage('recSyncServer', rc.recording.recSyncServerRecording);
        localStorageSettings.rec_server = rc.recording.recSyncServerRecording;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    // styling
    keepCustomTheme.onchange = (e) => {
        themeCustom.keep = e.currentTarget.checked;
        selectTheme.disabled = themeCustom.keep;
        updateThemeCardsDisabled();
        rc.roomMessage('customThemeKeep', themeCustom.keep);
        localStorageSettings.theme_custom = themeCustom.keep;
        localStorageSettings.theme_color = themeCustom.color;
        lS.setSettings(localStorageSettings);
        setTheme();
        e.target.blur();
    };
    BtnAspectRatio.onchange = () => {
        adaptAspectRatio(videoMediaContainer.childElementCount);
        localStorageSettings.aspect_ratio = BtnAspectRatio.selectedIndex;
        lS.setSettings(localStorageSettings);
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
    document.querySelectorAll('.theme-card').forEach((card) => {
        card.onclick = () => {
            if (card.classList.contains('disabled')) return;
            const index = parseInt(card.dataset.index);
            selectTheme.selectedIndex = index;
            selectTheme.onchange();
        };
    });
    BtnsBarPosition.onchange = () => {
        rc.changeBtnsBarPosition(BtnsBarPosition.value);
        localStorageSettings.buttons_bar = BtnsBarPosition.selectedIndex;
        lS.setSettings(localStorageSettings);
        refreshMainButtonsToolTipPlacement();
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
    transcriptShowOnMsg.onchange = (e) => {
        transcription.showOnMessage = e.currentTarget.checked;
        rc.roomMessage('transcriptShowOnMsg', transcription.showOnMessage);
        localStorageSettings.transcript_show_on_msg = transcription.showOnMessage;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    transcriptSendToAll.onchange = (e) => {
        transcription.sendToAll = e.currentTarget.checked;
        rc.roomMessage('transcriptSendToAll', transcription.sendToAll);
        localStorageSettings.transcript_send_to_all = transcription.sendToAll;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    // whiteboard options
    wbDrawingColorEl.onchange = () => {
        wbCanvas.freeDrawingBrush.color = wbDrawingColorEl.value;
        whiteboardResetAllMode();
        whiteboardIsPencilMode(true);
    };
    wbBackgroundColorEl.onchange = () => {
        setWhiteboardBgColor(wbBackgroundColorEl.value);
    };
    whiteboardGhostButton.onclick = (e) => {
        wbIsBgTransparent = !wbIsBgTransparent;
        wbIsBgTransparent ? wbCanvasBackgroundColor('rgba(0, 0, 0, 0.100)') : setTheme();
    };
    whiteboardGridBtn.onclick = (e) => {
        toggleCanvasGrid();
    };
    // room moderator rules
    switchEveryonePrivacy.onchange = (e) => {
        const videoStartPrivacy = e.currentTarget.checked;
        isVideoPrivacyActive = !videoStartPrivacy;
        rc.toggleVideoPrivacyMode();
        rc.updateRoomModerator({ type: 'video_start_privacy', status: videoStartPrivacy });
        rc.roomMessage('video_start_privacy', videoStartPrivacy);
        localStorageSettings.moderator_video_start_privacy = videoStartPrivacy;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
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
    switchEveryoneCantChatDeepSeek.onchange = (e) => {
        const chatCantDeepSeek = e.currentTarget.checked;
        rc.updateRoomModerator({ type: 'chat_cant_deep_seek', status: chatCantDeepSeek });
        rc.roomMessage('chat_cant_deep_seek', chatCantDeepSeek);
        localStorageSettings.moderator_chat_cant_deep_seek = chatCantDeepSeek;
        lS.setSettings(localStorageSettings);
        e.target.blur();
    };
    switchEveryoneCantMediaSharing.onchange = (e) => {
        const mediaCantSharing = e.currentTarget.checked;
        rc.updateRoomModerator({ type: 'media_cant_sharing', status: mediaCantSharing });
        rc.roomMessage('media_cant_sharing', mediaCantSharing);
        localStorageSettings.moderator_media_cant_sharing = mediaCantSharing;
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
    switchEveryoneFollowMe.onchange = (e) => {
        const followMe = e.currentTarget.checked;
        rc.toggleFollowMe(followMe);
        rc.roomMessage('everyone_follows_me', followMe);
        e.target.blur();
    };

    // handle Shortcuts
    handleKeyboardShortcuts();
}

// ####################################################
// KEYBOARD SHORTCUTS
// ####################################################

function handleKeyboardShortcuts() {
    if (!isDesktopDevice || !BUTTONS.settings.keyboardShortcuts) {
        elemDisplay('tabShortcutsBtn', false);
        setKeyboardShortcuts(false);
    } else {
        switchShortcuts.onchange = (e) => {
            const status = setKeyboardShortcuts(e.currentTarget.checked);
            userLog('info', `Keyboard shortcuts ${status}`, 'top-end');
            e.target.blur();
        };

        document.addEventListener('keydown', (event) => {
            if (
                !isShortcutsEnabled ||
                rc.isChatOpen ||
                wbIsOpen ||
                rc.isEditorOpen ||
                (!isPresenter && isBroadcastingEnabled)
            )
                return;

            const key = event.key.toLowerCase(); // Convert to lowercase for simplicity
            console.log(`Detected shortcut: ${key}`);

            const { audio_cant_unmute, video_cant_unhide, screen_cant_share } = rc._moderator;
            const notPresenter = isRulesActive && !isPresenter;

            switch (key) {
                case 'a':
                    if (notPresenter && !audio && (audio_cant_unmute || !BUTTONS.main.startAudioButton)) {
                        userLog('warning', 'The presenter has disabled your ability to enable audio', 'top-end');
                        break;
                    }
                    audio ? stopAudioButton.click() : startAudioButton.click();
                    break;
                case 'v':
                    if (notPresenter && !video && (video_cant_unhide || !BUTTONS.main.startVideoButton)) {
                        userLog('warning', 'The presenter has disabled your ability to enable video', 'top-end');
                        break;
                    }
                    video ? stopVideoButton.click() : startVideoButton.click();
                    break;
                case 's':
                    if (notPresenter && !screen && (screen_cant_share || !BUTTONS.main.startScreenButton)) {
                        userLog('warning', 'The presenter has disabled your ability to share the screen', 'top-end');
                        break;
                    }
                    screen ? stopScreenButton.click() : startScreenButton.click();
                    break;
                case 'h':
                    if (notPresenter && !BUTTONS.main.raiseHandButton) {
                        userLog('warning', 'The presenter has disabled your ability to raise your hand', 'top-end');
                        break;
                    }
                    hand ? lowerHandButton.click() : raiseHandButton.click();
                    break;
                case 'c':
                    if (notPresenter && !BUTTONS.main.chatButton) {
                        userLog('warning', 'The presenter has disabled your ability to open the chat', 'top-end');
                        break;
                    }
                    chatButton.click();
                    break;
                case 'o':
                    if (notPresenter && !BUTTONS.main.settingsButton) {
                        userLog('warning', 'The presenter has disabled your ability to open the settings', 'top-end');
                        break;
                    }
                    settingsButton.click();
                    break;
                case 'x':
                    if (notPresenter && !BUTTONS.main.hideMeButton) {
                        userLog('warning', 'The presenter has disabled your ability to hide yourself', 'top-end');
                        break;
                    }
                    hideMeButton.click();
                    break;
                case 'r':
                    if (notPresenter && (hostOnlyRecording || !BUTTONS.settings.tabRecording)) {
                        userLog('warning', 'The presenter has disabled your ability to start recording', 'top-end');
                        break;
                    }
                    isRecording ? stopRecButton.click() : startRecButton.click();
                    break;
                case 'j':
                    if (notPresenter && !BUTTONS.main.emojiRoomButton) {
                        userLog('warning', 'The presenter has disabled your ability to open the room emoji', 'top-end');
                        break;
                    }
                    emojiRoomButton.click();
                    break;
                case 'k':
                    if (notPresenter && !BUTTONS.main.transcriptionButton) {
                        userLog('warning', 'The presenter has disabled your ability to start transcription', 'top-end');
                        break;
                    }
                    transcriptionButton.click();
                    break;
                case 'p':
                    if (notPresenter && !BUTTONS.main.pollButton) {
                        userLog('warning', 'The presenter has disabled your ability to start a poll', 'top-end');
                        break;
                    }
                    pollButton.click();
                    break;
                case 'e':
                    if (notPresenter && !BUTTONS.main.editorButton) {
                        userLog('warning', 'The presenter has disabled your ability to open the editor', 'top-end');
                        break;
                    }
                    editorButton.click();
                    break;
                case 'w':
                    if (notPresenter && !BUTTONS.main.whiteboardButton) {
                        userLog('warning', 'The presenter has disabled your ability to open the whiteboard', 'top-end');
                        break;
                    }
                    whiteboardButton.click();
                    break;
                case 'd':
                    if (!showDocumentPipBtn) {
                        userLog('warning', 'The document PIP is not supported in this browser', 'top-end');
                        break;
                    }
                    if (notPresenter && !BUTTONS.main.documentPiPButton) {
                        userLog(
                            'warning',
                            'The presenter has disabled your ability to open the document PIP',
                            'top-end'
                        );
                        break;
                    }
                    documentPiPButton.click();
                    break;
                case 't':
                    if (notPresenter && !BUTTONS.main.snapshotRoomButton) {
                        userLog('warning', 'The presenter has disabled your ability to take a snapshot', 'top-end');
                        break;
                    }
                    snapshotRoomButton.click();
                    break;
                case 'f':
                    if (notPresenter && !BUTTONS.settings.fileSharing) {
                        userLog('warning', 'The presenter has disabled your ability to share files', 'top-end');
                        break;
                    }
                    fileShareButton.click();
                    break;
                //...
                default:
                    console.log(`Unhandled shortcut key: ${key}`);
            }
        });
    }
}

function setKeyboardShortcuts(enabled) {
    isShortcutsEnabled = enabled;
    localStorageSettings.keyboard_shortcuts = isShortcutsEnabled;
    lS.setSettings(localStorageSettings);
    return isShortcutsEnabled ? 'enabled' : 'disabled';
}

// ####################################################
// HTML INPUTS
// ####################################################

function handleInputs() {
    chatMessage.onkeydown = (e) => {
        if (e.key === 'Enter' && (isMobileDevice || !e.shiftKey)) {
            e.preventDefault();
            chatSendButton.click();
        }
    };
    chatMessage.oninput = function () {
        if (isChatPasteTxt) return;
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
            'gim'
        );
        // Replace matching patterns with corresponding emojis
        this.value = this.value.replace(regexPattern, (match) => chatInputEmoji[match]);
        rc.checkLineBreaks();
        updateChatCharCount();
    };

    chatMessage.onpaste = () => {
        isChatPasteTxt = true;
        rc.checkLineBreaks();
    };
}

// ####################################################
// EMOJI PIKER
// ####################################################

function toggleUsernameEmoji() {
    getId('usernameEmoji').classList.toggle('hidden');
}

function handleUsernameEmojiPicker() {
    const pickerOptions = {
        theme: 'dark',
        onEmojiSelect: addEmojiToUsername,
    };
    const emojiUsernamePicker = new EmojiMart.Picker(pickerOptions);
    getId('usernameEmoji').appendChild(emojiUsernamePicker);

    function addEmojiToUsername(data) {
        getId('usernameInput').value += data.native;
        toggleUsernameEmoji();
    }

    const initUsernameEmojiButton = getId('initUsernameEmojiButton');
    const usernameEmoji = getId('usernameEmoji');
    handleClickOutside(emojiUsernamePicker, initUsernameEmojiButton, () => {
        if (usernameEmoji && !usernameEmoji.classList.contains('hidden')) {
            usernameEmoji.classList.add('hidden');
        }
    });
}

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

    const chatEmojiButton = getId('chatEmojiButton');
    const chatEmoji = getId('chatEmoji');
    handleClickOutside(emojiPicker, chatEmojiButton, () => {
        if (chatEmoji && chatEmoji.classList.contains('show')) {
            chatEmoji.classList.remove('show');
            chatEmojiButton.style.color = '#FFFFFF';
        }
    });
}

function handleRoomEmojiPicker() {
    const soundEmojis = [
        { emoji: '👍', shortcodes: ':+1:' },
        { emoji: '👎', shortcodes: ':-1:' },
        { emoji: '👌', shortcodes: ':ok_hand:' },
        { emoji: '😀', shortcodes: ':grinning:' },
        { emoji: '😃', shortcodes: ':smiley:' },
        { emoji: '😂', shortcodes: ':joy:' },
        { emoji: '😘', shortcodes: ':kissing_heart:' },
        { emoji: '❤️', shortcodes: ':heart:' },
        { emoji: '🎺', shortcodes: ':trumpet:' },
        { emoji: '🎉', shortcodes: ':tada:' },
        { emoji: '😮', shortcodes: ':open_mouth:' },
        { emoji: '👏', shortcodes: ':clap:' },
        { emoji: '✨', shortcodes: ':sparkles:' },
        { emoji: '⭐', shortcodes: ':star:' },
        { emoji: '🌟', shortcodes: ':star2:' },
        { emoji: '💫', shortcodes: ':dizzy:' },
        { emoji: '🚀', shortcodes: ':rocket:' },
    ];

    const header = document.createElement('div');
    header.className = 'room-emoji-header';

    const title = document.createElement('span');
    title.textContent = 'Emoji Picker';
    title.className = 'room-emoji-title';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'room-emoji-close-btn';
    closeBtn.innerHTML = '<i class="fa fa-times"></i>';

    header.appendChild(title);
    header.appendChild(closeBtn);

    const tabContainer = document.createElement('div');
    tabContainer.className = 'room-emoji-tab-container';

    const allTab = document.createElement('button');
    allTab.textContent = 'All';
    allTab.className = 'room-emoji-tab active';

    const soundTab = document.createElement('button');
    soundTab.textContent = 'Sounds';
    soundTab.className = 'room-emoji-tab';

    tabContainer.appendChild(allTab);
    tabContainer.appendChild(soundTab);

    const emojiMartDiv = document.createElement('div');
    emojiMartDiv.className = 'room-emoji-mart';
    const pickerRoomOptions = {
        theme: 'dark',
        onEmojiSelect: sendEmojiToRoom,
    };
    const emojiRoomPicker = new EmojiMart.Picker(pickerRoomOptions);
    emojiMartDiv.appendChild(emojiRoomPicker);

    const emojiGrid = document.createElement('div');
    emojiGrid.className = 'room-emoji-grid';

    function showEmojiGrid() {
        emojiGrid.classList.add('visible');
    }
    function hideEmojiGrid() {
        emojiGrid.classList.remove('visible');
    }

    soundEmojis.forEach(({ emoji, shortcodes }) => {
        const btn = document.createElement('button');
        btn.textContent = emoji;
        btn.className = 'room-emoji-btn';
        btn.onclick = () => sendEmojiToRoom({ native: emoji, shortcodes });
        emojiGrid.appendChild(btn);
    });

    allTab.onclick = () => {
        allTab.classList.add('active');
        soundTab.classList.remove('active');
        emojiMartDiv.style.display = 'block';
        hideEmojiGrid();
    };
    soundTab.onclick = () => {
        soundTab.classList.add('active');
        allTab.classList.remove('active');
        emojiMartDiv.style.display = 'none';
        showEmojiGrid();
    };

    emojiPickerContainer.innerHTML = '';
    emojiPickerContainer.appendChild(header);
    emojiPickerContainer.appendChild(tabContainer);
    emojiPickerContainer.appendChild(emojiMartDiv);
    emojiPickerContainer.appendChild(emojiGrid);
    emojiPickerContainer.style.display = 'none';

    if (!isMobileDevice) {
        rc.makeDraggable(emojiPickerContainer, header);
    }

    emojiRoomButton.onclick = () => {
        toggleEmojiPicker();
    };
    closeBtn.addEventListener('click', (e) => {
        toggleEmojiPicker();
    });

    function sendEmojiToRoom(data) {
        console.log('Selected Emoji', data.native);
        const cmd = {
            type: 'roomEmoji',
            peer_name: peer_name,
            emoji: data.native,
            shortcodes: data.shortcodes,
            broadcast: true,
        };
        if (rc.thereAreParticipants()) {
            rc.emitCmd(cmd);
        }
        rc.handleCmd(cmd);
        // toggleEmojiPicker();
    }

    function toggleEmojiPicker() {
        const emojiRoomIcon = emojiRoomButton.querySelector('i');
        if (emojiPickerContainer.style.display === 'block') {
            emojiPickerContainer.style.display = 'none';
            setColor(emojiRoomIcon, 'white');
        } else {
            emojiPickerContainer.style.display = 'block';
            setColor(emojiRoomIcon, '#FFD600');
        }
    }
}

// ####################################################
// ROOM EDITOR
// ####################################################

function handleEditor() {
    const toolbarOptions = [
        [{ header: [1, 2, 3, false] }, { align: [] }, { background: [] }],
        ['bold', 'italic', 'underline', 'strike', 'link', 'image', 'code-block'],
        [{ list: 'ordered' }, { list: 'bullet' }, { list: 'check' }],
        [{ indent: '+1' }, { indent: '-1' }],
        ['clean'], // Custom button to clear formatting
        //...
    ];

    quill = new Quill('#editor', {
        modules: {
            toolbar: {
                container: toolbarOptions,
            },
            syntax: true,
        },
        theme: 'snow',
    });

    applySyntaxHighlighting();

    quill.on('text-change', (delta, oldDelta, source) => {
        if (!isPresenter && rc.editorIsLocked()) {
            return;
        }
        // console.log('text-change', { delta, oldDelta, source });
        applySyntaxHighlighting();
        if (rc.thereAreParticipants() && source === 'user') {
            socket.emit('editorChange', delta);
        }
    });
}

function applySyntaxHighlighting() {
    const codeBlocks = document.querySelectorAll('.ql-syntax');
    codeBlocks.forEach((block) => {
        hljs.highlightElement(block);
    });
}

// ####################################################
// LOAD SETTINGS FROM LOCAL STORAGE
// ####################################################

function loadSettingsFromLocalStorage() {
    rc.showChatOnMessage = localStorageSettings.show_chat_on_msg;
    transcription.showOnMessage = localStorageSettings.transcript_show_on_msg;
    transcription.sendToAll =
        localStorageSettings.transcript_send_to_all !== undefined ? localStorageSettings.transcript_send_to_all : true;
    rc.speechInMessages = localStorageSettings.speech_in_msg;
    isPitchBarEnabled = localStorageSettings.pitch_bar;
    isSoundEnabled = localStorageSettings.sounds;
    isKeepButtonsVisible = localStorageSettings.keep_buttons_visible;
    isChatPinEnabled = localStorageSettings.chat_pin !== undefined ? localStorageSettings.chat_pin : true;
    isShortcutsEnabled = localStorageSettings.keyboard_shortcuts;
    showChatOnMsg.checked = rc.showChatOnMessage;
    transcriptShowOnMsg.checked = transcription.showOnMessage;
    transcriptSendToAll.checked = transcription.sendToAll;
    speechIncomingMsg.checked = rc.speechInMessages;
    switchPitchBar.checked = isPitchBarEnabled;
    switchSounds.checked = isSoundEnabled;
    switchShare.checked = notify;
    switchKeepButtonsVisible.checked = isKeepButtonsVisible;
    switchChatPin.checked = isChatPinEnabled;
    switchShortcuts.checked = isShortcutsEnabled;

    switchServerRecording.checked = localStorageSettings.rec_server;

    keepCustomTheme.checked = themeCustom.keep;
    selectTheme.disabled = themeCustom.keep;
    updateThemeCardsDisabled();
    themeCustom.input.value = themeCustom.color;

    switchDominantSpeakerFocus.checked = localStorageSettings.dominant_speaker_focus;
    switchNoiseSuppression.checked = localStorageSettings.mic_noise_suppression;

    screenOptimization.selectedIndex = localStorageSettings.screen_optimization;
    videoFps.selectedIndex = localStorageSettings.video_fps;
    screenFps.selectedIndex = localStorageSettings.screen_fps;
    BtnAspectRatio.selectedIndex = localStorageSettings.aspect_ratio;
    BtnVideoObjectFit.selectedIndex = localStorageSettings.video_obj_fit;
    BtnVideoControls.selectedIndex = localStorageSettings.video_controls;
    BtnsBarPosition.selectedIndex = localStorageSettings.buttons_bar;
    pinVideoPosition.selectedIndex = localStorageSettings.pin_grid;
    rc.handleVideoObjectFit(BtnVideoObjectFit.value);
    rc.handleVideoControls(BtnVideoControls.value);
    rc.changeBtnsBarPosition(BtnsBarPosition.value);
    rc.toggleVideoPin(pinVideoPosition.value);
    refreshMainButtonsToolTipPlacement();
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
        rc.showRecordingIndicator();
    });
    rc.on(RoomClient.EVENTS.pauseRec, () => {
        console.log('Room event: Client pause recoding');
        hide(pauseRecButton);
        show(resumeRecButton);
        rc.pauseRecordingIndicator();
    });
    rc.on(RoomClient.EVENTS.resumeRec, () => {
        console.log('Room event: Client resume recoding');
        hide(resumeRecButton);
        show(pauseRecButton);
        rc.resumeRecordingIndicator();
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
        rc.hideRecordingIndicator();
    });
    rc.on(RoomClient.EVENTS.raiseHand, () => {
        console.log('Room event: Client raise hand');
        hide(raiseHandButton);
        show(lowerHandButton);
        setColor(lowerHandIcon, '#FFD700');
        hand = true;
    });
    rc.on(RoomClient.EVENTS.lowerHand, () => {
        console.log('Room event: Client lower hand');
        hide(lowerHandButton);
        show(raiseHandButton);
        setColor(lowerHandIcon, 'white');
        hand = false;
    });
    rc.on(RoomClient.EVENTS.startAudio, () => {
        console.log('Room event: Client start audio');
        hide(startAudioButton);
        show(stopAudioButton);
        setColor(startAudioButton, 'red');
        setAudioButtonsDisabled(false);
        audio = true;
        applyKeepAwake(audio);
    });
    rc.on(RoomClient.EVENTS.pauseAudio, () => {
        console.log('Room event: Client pause audio');
        hide(stopAudioButton);
        BUTTONS.main.startAudioButton && show(startAudioButton);
        setColor(startAudioButton, 'red');
        setAudioButtonsDisabled(false);
        audio = false;
        applyKeepAwake(audio);
    });
    rc.on(RoomClient.EVENTS.resumeAudio, () => {
        console.log('Room event: Client resume audio');
        hide(startAudioButton);
        BUTTONS.main.startAudioButton && show(stopAudioButton);
        setAudioButtonsDisabled(false);
        audio = true;
        applyKeepAwake(audio);
    });
    rc.on(RoomClient.EVENTS.stopAudio, () => {
        console.log('Room event: Client stop audio');
        hide(stopAudioButton);
        show(startAudioButton);
        setAudioButtonsDisabled(false);
        stopMicrophoneProcessing();
        audio = false;
        applyKeepAwake(audio);
    });
    rc.on(RoomClient.EVENTS.startVideo, () => {
        console.log('Room event: Client start video');
        hide(startVideoButton);
        show(stopVideoButton);
        setColor(startVideoButton, 'red');
        setVideoButtonsDisabled(false);
        hideClassElements('videoMenuBar');
        // if (isParticipantsListOpen) getRoomParticipants();
        video = true;
        applyKeepAwake(audio);
    });
    rc.on(RoomClient.EVENTS.pauseVideo, () => {
        console.log('Room event: Client pause video');
        hide(stopVideoButton);
        BUTTONS.main.startVideoButton && show(startVideoButton);
        setColor(startVideoButton, 'red');
        setVideoButtonsDisabled(false);
        hideClassElements('videoMenuBar');
        video = false;
        applyKeepAwake(audio);
    });
    rc.on(RoomClient.EVENTS.resumeVideo, () => {
        console.log('Room event: Client resume video');
        hide(startVideoButton);
        BUTTONS.main.startVideoButton && show(stopVideoButton);
        setVideoButtonsDisabled(false);
        isVideoPrivacyActive = false;
        hideClassElements('videoMenuBar');
        video = true;
        applyKeepAwake(audio);
    });
    rc.on(RoomClient.EVENTS.stopVideo, () => {
        console.log('Room event: Client stop video');
        hide(stopVideoButton);
        show(startVideoButton);
        setVideoButtonsDisabled(false);
        isVideoPrivacyActive = false;
        hideClassElements('videoMenuBar');
        // if (isParticipantsListOpen) getRoomParticipants();
        video = false;
        applyKeepAwake(audio);
    });
    rc.on(RoomClient.EVENTS.startScreen, () => {
        console.log('Room event: Client start screen');
        hide(startScreenButton);
        show(stopScreenButton);
        hideClassElements('videoMenuBar');
        // if (isParticipantsListOpen) getRoomParticipants();
        screen = true;
    });
    rc.on(RoomClient.EVENTS.pauseScreen, () => {
        console.log('Room event: Client pause screen');
        hide(startScreenButton);
        show(stopScreenButton);
        hideClassElements('videoMenuBar');
        screen = false;
    });
    rc.on(RoomClient.EVENTS.resumeScreen, () => {
        console.log('Room event: Client resume screen');
        hide(stopScreenButton);
        show(startScreenButton);
        hideClassElements('videoMenuBar');
        screen = true;
    });
    rc.on(RoomClient.EVENTS.stopScreen, () => {
        console.log('Room event: Client stop screen');
        hide(stopScreenButton);
        show(startScreenButton);
        hideClassElements('videoMenuBar');
        // if (isParticipantsListOpen) getRoomParticipants();
        screen = false;
    });
    rc.on(RoomClient.EVENTS.roomLock, () => {
        console.log('Room event: Client lock room');
        hide(lockRoomButton);
        show(unlockRoomButton);
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
            if (rc.isRecording() || rc.hasActiveRecorder()) {
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
    rc.on(RoomClient.EVENTS.startRTMP, () => {
        console.log('Room event: RTMP started');
        hide(startRtmpButton);
        show(stopRtmpButton);
    });
    rc.on(RoomClient.EVENTS.stopRTMP, () => {
        console.log('Room event: RTMP stopped');
        hide(stopRtmpButton);
        show(startRtmpButton);
    });
    rc.on(RoomClient.EVENTS.endRTMP, () => {
        console.log('Room event: RTMP ended');
        hide(stopRtmpButton);
        show(startRtmpButton);
    });
    rc.on(RoomClient.EVENTS.startRTMPfromURL, () => {
        console.log('Room event: RTMP from URL started');
        hide(startRtmpURLButton);
        show(stopRtmpURLButton);
    });
    rc.on(RoomClient.EVENTS.stopRTMPfromURL, () => {
        console.log('Room event: RTMP from URL stopped');
        hide(stopRtmpURLButton);
        show(startRtmpURLButton);
    });
    rc.on(RoomClient.EVENTS.endRTMPfromURL, () => {
        console.log('Room event: RTMP from URL ended');
        hide(stopRtmpURLButton);
        show(startRtmpURLButton);
    });
    rc.on(RoomClient.EVENTS.exitRoom, () => {
        if (isExiting) return;
        isExiting = true;

        console.log('Room event: Client leave room');

        endRoomSession();

        if (rc.isRecording() || rc.hasActiveRecorder()) {
            rc.saveRecording('Room event: Client save recording before to exit');
        }

        leaveRoom(false); // Don't touch :)
    });
}

// ####################################################
// UTILITY
// ####################################################

function initLeaveMeeting() {
    openURL('/newroom');
}

async function leaveRoom(allowCancel = true) {
    if (rc.isRecording() || rc.hasActiveRecorder()) {
        recShowInfo = false;
        rc.saveRecording('User is leaving the room, saving recording before exit');
        rc.popupRecordingOnLeaveRoom();
        return;
    }
    survey && survey.enabled ? leaveFeedback(allowCancel) : redirectOnLeave();
}

function leaveFeedback(allowCancel) {
    Swal.fire({
        allowOutsideClick: false,
        allowEscapeKey: false,
        showDenyButton: true,
        showCancelButton: allowCancel,
        confirmButtonColor: 'green',
        denyButtonColor: 'red',
        cancelButtonColor: 'gray',
        background: swalBackground,
        imageUrl: image.feedback,
        position: 'top',
        title: 'Leave a feedback',
        text: 'Do you want to rate your MiroTalk experience?',
        confirmButtonText: `Yes`,
        denyButtonText: `No`,
        cancelButtonText: `Cancel`,
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    }).then((result) => {
        if (result.isConfirmed) {
            endRoomSession();
            openURL(survey.url);
        } else if (result.isDenied) {
            redirectOnLeave();
        }
    });
}

function redirectOnLeave() {
    endRoomSession();
    rc.exitRoom();
    redirect && redirect.enabled ? openURL(redirect.url) : openURL('/newroom');
}

function userLog(icon, message, position = 'top-end', timer = 3000) {
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
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
    if (window.localStorage.uuid) {
        return window.localStorage.uuid;
    }
    window.localStorage.uuid = uuid4;
    return uuid4;
}

function handleButtonsBar() {
    const showButtonsHandler = () => showButtons();
    isDesktopDevice
        ? document.body.addEventListener('mousemove', showButtonsHandler)
        : document.body.addEventListener('touchstart', showButtonsHandler);
}

function handleDropdownHover(dropdownElement = null) {
    const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!supportsHover) return;

    const dropdowns = dropdownElement ? dropdownElement : document.querySelectorAll('.dropdown');
    console.log(`Dropdown found: ${dropdowns.length}`);

    dropdowns.forEach((dropdown) => {
        const toggle = dropdown.querySelector('.dropdown-toggle');
        const menu = dropdown.querySelector('.dropdown-menu');

        if (!toggle || !menu) return;

        let timeoutId;

        dropdown.addEventListener('mouseenter', () => {
            clearTimeout(timeoutId);
            const bsDropdown = bootstrap.Dropdown.getInstance(toggle) || new bootstrap.Dropdown(toggle);
            bsDropdown.show();
        });

        dropdown.addEventListener('mouseleave', () => {
            timeoutId = setTimeout(() => {
                const bsDropdown = bootstrap.Dropdown.getInstance(toggle);
                if (bsDropdown) {
                    bsDropdown.hide();
                }
            }, 200);
        });

        menu.addEventListener('mouseenter', () => {
            clearTimeout(timeoutId);
        });

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    });
}

function showButtons() {
    if (
        wbIsBgTransparent ||
        isButtonsBarOver ||
        isButtonsVisible ||
        rc.isVideoBarDropDownOpen ||
        (isMobileDevice && rc.isChatOpen) ||
        (isMobileDevice && rc.isMySettingsOpen)
    )
        return;
    bottomButtons.style.display = 'flex';
    toggleClassElements('username', 'flex');
    isButtonsVisible = true;
}

function checkButtonsBar() {
    if (localStorageSettings.keep_buttons_visible) {
        bottomButtons.style.display = 'flex';
        toggleClassElements('username', 'flex');
        isButtonsVisible = true;
    } else {
        if (!isButtonsBarOver) {
            bottomButtons.style.display = 'none';
            toggleClassElements('username', 'none');
            isButtonsVisible = false;
        }
    }
    setTimeout(() => {
        checkButtonsBar();
    }, 10000);
}

function toggleClassElements(className, displayState) {
    const elements = rc.getEcN(className);
    for (let i = 0; i < elements.length; i++) {
        elements[i].style.display = displayState;
    }
}

function hideClassElements(className) {
    const elements = rc.getEcN(className);
    for (let i = 0; i < elements.length; i++) {
        hide(elements[i]);
    }
    setCamerasBorderNone();
}

function setCamerasBorderNone() {
    const cameras = rc.getEcN('Camera');
    for (let i = 0; i < cameras.length; i++) {
        cameras[i].style.setProperty('border', 'none', 'important');
    }
}

function hideVideoMenuBar(videoBarId) {
    const videoMenuBar = rc.getEcN('videoMenuBar');
    for (let i = 0; i < videoMenuBar.length; i++) {
        const menuBar = videoMenuBar[i];
        if (menuBar.id != videoBarId) {
            hide(menuBar);
        }
    }
}

// https://animate.style

function animateCSS(element, animation, prefix = 'animate__') {
    return new Promise((resolve, reject) => {
        const animationName = `${prefix}${animation}`;
        element.classList.add(`${prefix}animated`, animationName);
        function handleAnimationEnd(event) {
            event.stopPropagation();
            element.classList.remove(`${prefix}animated`, animationName);
            resolve('Animation ended');
        }
        element.addEventListener('animationend', handleAnimationEnd, { once: true });
    });
}

function setAudioButtonsDisabled(disabled) {
    startAudioButton.disabled = disabled;
    stopAudioButton.disabled = disabled;
}

function setVideoButtonsDisabled(disabled) {
    startVideoButton.disabled = disabled;
    stopVideoButton.disabled = disabled;
}

async function playSpeaker(deviceId = null, name, path = '../sounds/') {
    const selectedDeviceId = deviceId || audioOutputSelect?.value;
    if (selectedDeviceId) {
        const sound = path + name + '.wav';
        const audioToPlay = new Audio(sound);
        try {
            if (typeof audioToPlay.setSinkId === 'function') {
                await audioToPlay.setSinkId(selectedDeviceId);
            }
            audioToPlay.volume = 0.5;
            await audioToPlay.play();
        } catch (err) {
            console.error('Cannot play test sound:', err);
        }
    } else {
        sound(name, true);
    }
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

function isValidEmail(email) {
    const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
    return emailRegex.test(email);
}

function isValidAvatarURL(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

async function isImageURL(url) {
    if (!url) return false;
    try {
        const response = await fetch(url, { method: 'HEAD' });
        const contentType = response.headers.get('content-type');
        return contentType && contentType.startsWith('image/');
    } catch {
        return false;
    }
}

function isMobile(userAgent) {
    return !!/Android|webOS|iPhone|iPad|iPod|BB10|BlackBerry|IEMobile|Opera Mini|Mobile|mobile/i.test(userAgent || '');
}

function isTablet(userAgent) {
    return /(ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk|(puffin(?!.*(IP|AP|WP))))/.test(
        userAgent
    );
}

function isIpad(userAgent) {
    return /macintosh/.test(userAgent) && 'ontouchend' in document;
}

function isDesktop() {
    return !isMobileDevice && !isTabletDevice && !isIPadDevice;
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

function handleClickOutside(targetElement, triggerElement, callback, minWidth = 0) {
    document.addEventListener('click', (e) => {
        if (minWidth && window.innerWidth > minWidth) return;
        let el = e.target;
        let shouldExclude = false;
        while (el) {
            if (el instanceof HTMLElement && (el === targetElement || el === triggerElement)) {
                shouldExclude = true;
                break;
            }
            el = el.parentElement;
        }
        if (!shouldExclude) callback();
    });
}

function getId(id) {
    return document.getElementById(id);
}

// ####################################################
// SETTINGS EXTRA (buttons dropdown)
// ####################################################

function setupSettingsExtraDropdown() {
    if (!settingsSplit || !settingsExtraDropdown || !settingsExtraToggle || !settingsExtraMenu) return;

    // TODO improve me.....
    if (BUTTONS.main.extraButton) {
        show(settingsExtraDropdown);
        show(settingsExtraMenu);
    } else {
        hide(settingsExtraDropdown);
        hide(settingsExtraMenu);
        elemDisplay(noExtraButtons, true);
        settingsButton.style.borderRadius = '10px';
    }

    let showTimeout;
    let hideTimeout;

    function showMenu() {
        clearTimeout(hideTimeout);
        show(settingsExtraMenu);
    }
    function hideMenu() {
        clearTimeout(showTimeout);
        hide(settingsExtraMenu);
    }

    settingsExtraToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        !settingsExtraMenu.classList.contains('hidden') ? hideMenu() : showMenu();
    });

    const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (supportsHover) {
        let closeTimeout;
        const cancelClose = () => {
            if (!closeTimeout) return;
            clearTimeout(closeTimeout);
            closeTimeout = null;
        };
        const scheduleClose = () => {
            cancelClose();
            closeTimeout = setTimeout(() => hideMenu(), 180);
        };
        settingsExtraToggle.addEventListener('mouseenter', () => {
            cancelClose();
            showMenu();
        });
        settingsExtraToggle.addEventListener('mouseleave', scheduleClose);
        settingsExtraMenu.addEventListener('mouseenter', cancelClose);
        settingsExtraMenu.addEventListener('mouseleave', scheduleClose);
    }

    // Prevent closing when clicking inside the menu
    settingsExtraMenu.addEventListener('click', function (e) {
        e.stopPropagation();
    });

    document.addEventListener('click', function (e) {
        if (!settingsExtraToggle.contains(e.target) && !settingsExtraMenu.contains(e.target)) {
            hideMenu();
        }
    });

    // Auto-hide group headers/dividers when all their buttons are hidden
    updateSettingsExtraGroups();
    const observer = new MutationObserver(updateSettingsExtraGroups);
    settingsExtraMenu.querySelectorAll('button').forEach((btn) => {
        observer.observe(btn, { attributes: true, attributeFilter: ['class', 'style'] });
    });
}

function updateSettingsExtraGroups() {
    settingsExtraMenu.querySelectorAll('.extra-menu-group').forEach((header) => {
        const ids = (header.dataset.buttons || '').split(',');
        const anyVisible = ids.some((id) => {
            const btn = document.getElementById(id.trim());
            return btn && !btn.classList.contains('hidden') && btn.style.display !== 'none';
        });
        header.style.display = anyVisible ? '' : 'none';
    });
    settingsExtraMenu.querySelectorAll('.extra-menu-divider').forEach((div) => {
        let prev = div.previousElementSibling;
        while (prev && !prev.classList.contains('extra-menu-group')) {
            prev = prev.previousElementSibling;
        }
        let next = div.nextElementSibling;
        while (next && !next.classList.contains('extra-menu-group')) {
            next = next.nextElementSibling;
        }
        const prevVisible = prev && prev.style.display !== 'none';
        const nextVisible = next && next.style.display !== 'none';
        div.style.display = prevVisible && nextVisible ? '' : 'none';
    });
}

// ####################################################
// QUICK DEVICE SWITCH (Start Audio/Video dropdowns)
// ####################################################

function restoreSplitButtonsBorderRadius() {
    document.querySelectorAll('#bottomButtons .split-btn').forEach((group) => {
        group.querySelectorAll('button').forEach((button) => {
            if (button.id != 'settingsExtraToggle' && button.id != 'settingsButton') {
                button.style.setProperty('border-radius', '10px', 'important');
            }
        });
        const toggle = group.querySelector('.device-dropdown-toggle');
        if (toggle) toggle.style.setProperty('border-left', 'none', 'important');
    });
}

function setupQuickDeviceSwitchDropdowns() {
    // For now keep this feature only for desktop devices
    if (!isDesktopDevice) {
        restoreSplitButtonsBorderRadius();
        return;
    }

    if (
        !startVideoBtn ||
        !startAudioBtn ||
        !stopVideoBtn ||
        !stopAudioBtn ||
        !videoDropdown ||
        !audioDropdown ||
        !videoToggle ||
        !audioToggle
    ) {
        return;
    }

    function syncVisibility() {
        // Keep dropdown visible while either Start or Stop button is visible
        const showVideo = !startVideoBtn.classList.contains('hidden') || !stopVideoBtn.classList.contains('hidden');
        const showAudio = !startAudioBtn.classList.contains('hidden') || !stopAudioBtn.classList.contains('hidden');
        videoDropdown.classList.toggle('hidden', !showVideo);
        audioDropdown.classList.toggle('hidden', !showAudio);
    }

    function appendMenuHeader(menuEl, iconClass, title) {
        const header = document.createElement('div');
        header.className = 'device-menu-header';

        const icon = document.createElement('i');
        icon.className = iconClass;

        const text = document.createElement('span');
        text.textContent = title;

        header.appendChild(icon);
        header.appendChild(text);
        menuEl.appendChild(header);
    }

    function appendMenuDivider(menuEl) {
        const divider = document.createElement('div');
        divider.className = 'device-menu-divider';
        menuEl.appendChild(divider);
    }

    function appendSelectOptions(menuEl, selectEl, emptyLabel, rebuildFn) {
        if (!selectEl) return;

        const options = Array.from(selectEl.options || []).filter((o) => o && o.value);
        if (options.length === 0) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.disabled = true;
            btn.textContent = emptyLabel;
            menuEl.appendChild(btn);
            return;
        }

        options.forEach((opt) => {
            const btn = document.createElement('button');
            btn.type = 'button';

            const isSelected = opt.value === selectEl.value;
            const label = opt.textContent || opt.label || opt.value;

            btn.replaceChildren();
            if (isSelected) {
                const icon = document.createElement('i');
                icon.className = 'fas fa-check';
                btn.appendChild(icon);
                btn.appendChild(document.createTextNode(` ${label}`));
            } else {
                const spacer = document.createElement('span');
                spacer.style.display = 'inline-block';
                spacer.style.width = '1.25em';
                btn.appendChild(spacer);
                btn.appendChild(document.createTextNode(label));
            }

            btn.addEventListener('click', () => {
                if (selectEl.value === opt.value) return;
                selectEl.value = opt.value;
                selectEl.dispatchEvent(new Event('change'));
            });

            menuEl.appendChild(btn);
        });
    }

    function buildVideoMenu() {
        if (!videoMenu || !videoSelect) return;
        videoMenu.innerHTML = '';

        appendMenuHeader(videoMenu, 'fas fa-video', 'Cameras');
        appendSelectOptions(videoMenu, videoSelect, 'No cameras found', buildVideoMenu);

        // Add settings button
        appendMenuDivider(videoMenu);
        const settingsBtn = document.createElement('button');
        settingsBtn.type = 'button';
        settingsBtn.className = 'device-menu-action-btn';
        const settingsIcon = document.createElement('i');
        settingsIcon.className = 'fas fa-cog';
        settingsBtn.appendChild(settingsIcon);
        settingsBtn.appendChild(document.createTextNode(' Open Video Settings'));
        settingsBtn.addEventListener('click', () => {
            rc.toggleMySettings();
            // Simulate tab click to open video devices tab
            setTimeout(() => {
                tabVideoDevicesBtn.click();
            }, 100);
        });
        videoMenu.appendChild(settingsBtn);
    }

    function buildAudioMenu() {
        if (!audioMenu) return;

        audioMenu.innerHTML = '';

        appendMenuHeader(audioMenu, 'fas fa-microphone', 'Microphones');
        appendSelectOptions(audioMenu, microphoneSelect, 'No microphones found', buildAudioMenu);

        // Noise cancellation toggle (only when custom noise suppression is enabled & supported)
        if (BUTTONS.settings.customNoiseSuppression && rc.isRNNoiseSupported) {
            appendMenuDivider(audioMenu);
            appendMenuHeader(audioMenu, 'fas fa-ear-listen', 'Microphone Effects');

            const toggleRow = document.createElement('div');
            toggleRow.className = 'device-menu-toggle-row';

            const labelDiv = document.createElement('div');
            labelDiv.className = 'title';
            const label = document.createElement('p');
            label.textContent = 'Noise cancellation';
            labelDiv.appendChild(label);

            const switchDiv = document.createElement('div');
            switchDiv.className = 'form-check form-switch form-switch-md title';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'form-check-input';
            checkbox.checked = switchNoiseSuppression ? switchNoiseSuppression.checked : false;

            switchDiv.appendChild(checkbox);

            toggleRow.appendChild(labelDiv);
            toggleRow.appendChild(switchDiv);

            checkbox.addEventListener('change', () => {
                // Sync with the settings switch
                if (switchNoiseSuppression) {
                    switchNoiseSuppression.checked = checkbox.checked;
                    switchNoiseSuppression.dispatchEvent(new Event('change'));
                }
            });

            audioMenu.appendChild(toggleRow);

            appendMenuDivider(audioMenu);
        } else {
            appendMenuDivider(audioMenu);
        }

        appendMenuHeader(audioMenu, 'fas fa-volume-high', 'Speakers');
        if (!speakerSelect || speakerSelect.disabled) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.disabled = true;
            btn.textContent = 'Speaker selection not supported';
            audioMenu.appendChild(btn);
            return;
        }
        appendSelectOptions(audioMenu, speakerSelect, 'No speakers found', buildAudioMenu);

        // Add action buttons
        appendMenuDivider(audioMenu);

        // Test speaker button
        const testBtn = document.createElement('button');
        testBtn.type = 'button';
        testBtn.className = 'device-menu-action-btn';
        const testIcon = document.createElement('i');
        testIcon.className = 'fa-solid fa-circle-play';
        testBtn.appendChild(testIcon);
        testBtn.appendChild(document.createTextNode(' Test Speaker'));
        testBtn.addEventListener('click', () => {
            playSpeaker(speakerSelect?.value, 'ring');
        });
        audioMenu.appendChild(testBtn);

        // Settings button
        const settingsBtn = document.createElement('button');
        settingsBtn.type = 'button';
        settingsBtn.className = 'device-menu-action-btn';
        const settingsIcon = document.createElement('i');
        settingsIcon.className = 'fas fa-cog';
        settingsBtn.appendChild(settingsIcon);
        settingsBtn.appendChild(document.createTextNode(' Open Audio Settings'));
        settingsBtn.addEventListener('click', () => {
            rc.toggleMySettings();
            // Simulate tab click to open audio devices tab
            setTimeout(() => {
                tabAudioDevicesBtn.click();
            }, 100);
        });
        audioMenu.appendChild(settingsBtn);
    }

    function rebuildVideoMenu() {
        // Debounce rebuilds to prevent interference with selection
        clearTimeout(rebuildVideoMenu.timeoutId);
        rebuildVideoMenu.timeoutId = setTimeout(() => {
            buildVideoMenu();
        }, 10);
    }

    function rebuildAudioMenu() {
        // Debounce rebuilds to prevent interference with selection
        clearTimeout(rebuildAudioMenu.timeoutId);
        rebuildAudioMenu.timeoutId = setTimeout(() => {
            buildAudioMenu();
        }, 10);
    }

    // Build menus when opening (click or hover)
    videoDropdown.addEventListener('click', rebuildVideoMenu);
    audioDropdown.addEventListener('click', rebuildAudioMenu);
    videoToggle.addEventListener('mouseenter', rebuildVideoMenu);
    audioToggle.addEventListener('mouseenter', rebuildAudioMenu);

    // Keep UI synced when settings panel changes device
    if (videoSelect) videoSelect.addEventListener('change', rebuildVideoMenu);
    if (microphoneSelect) microphoneSelect.addEventListener('change', rebuildAudioMenu);
    if (speakerSelect) speakerSelect.addEventListener('change', rebuildAudioMenu);

    // Keep arrow buttons visible only when Start buttons are visible
    syncVisibility();
    const observer = new MutationObserver(syncVisibility);
    observer.observe(startVideoBtn, { attributes: true, attributeFilter: ['class'] });
    observer.observe(startAudioBtn, { attributes: true, attributeFilter: ['class'] });
    observer.observe(stopVideoBtn, { attributes: true, attributeFilter: ['class'] });
    observer.observe(stopAudioBtn, { attributes: true, attributeFilter: ['class'] });

    // Re-enumerate & refresh lists on hardware changes
    if (navigator.mediaDevices) {
        let deviceChangeFrame;
        let lastChangeTime = 0;

        navigator.mediaDevices.addEventListener('devicechange', async () => {
            const now = Date.now();

            // Debounce: ignore rapid-fire changes
            if (now - lastChangeTime < 1000) return;
            lastChangeTime = now;

            if (deviceChangeFrame) cancelAnimationFrame(deviceChangeFrame);

            deviceChangeFrame = requestAnimationFrame(async () => {
                console.log('🔄 Audio devices changed - refreshing...');
                // Give OS time to finish routing (especially important on mobile)
                await new Promise((resolve) => setTimeout(resolve, isMobileDevice ? 1500 : 500));
                try {
                    await refreshMyAudioVideoDevices();
                } catch (err) {
                    console.warn('Device refresh failed:', err);
                }
                setTimeout(() => {
                    rebuildVideoMenu();
                    rebuildAudioMenu();
                }, 50);
            });
        });
    }
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
    whiteboard.style.transform = 'translate(-50%, -50%)';
}

function setupWhiteboard() {
    setupWhiteboardCanvas();
    setupWhiteboardCanvasSize();
    setupWhiteboardLocalListeners();
    setupWhiteboardShortcuts();
    setupWhiteboardDragAndDrop();
    setupWhiteboardResizeListener();
}

function setupWhiteboardCanvas() {
    wbCanvas = new fabric.Canvas('wbCanvas');
    wbCanvas.freeDrawingBrush.color = '#FFFFFF';
    wbCanvas.freeDrawingBrush.width = 3;
    whiteboardIsPencilMode(true);
}

function setupWhiteboardCanvasSize() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const containerPadding = isMobileDevice ? 10 : 20;
    const headerHeight = isMobileDevice ? 40 : 60;
    const extraMargin = 20;

    const availableWidth = viewportWidth - containerPadding - extraMargin;
    const availableHeight = viewportHeight - containerPadding - headerHeight - extraMargin;

    const scaleX = availableWidth / wbReferenceWidth;
    const scaleY = availableHeight / wbReferenceHeight;
    const scale = Math.min(scaleX, scaleY);

    const canvasWidth = wbReferenceWidth * scale;
    const canvasHeight = wbReferenceHeight * scale;

    wbCanvas.setWidth(canvasWidth);
    wbCanvas.setHeight(canvasHeight);
    wbCanvas.setZoom(scale);

    setWhiteboardSize(canvasWidth + containerPadding, canvasHeight + headerHeight + containerPadding);

    whiteboardCenter();

    wbCanvas.calcOffset();
    wbCanvas.renderAll();
}

function setWhiteboardSize(w, h) {
    document.documentElement.style.setProperty('--wb-width', w);
    document.documentElement.style.setProperty('--wb-height', h);
}

function setupWhiteboardResizeListener() {
    let resizeFrame;
    window.addEventListener('resize', () => {
        if (resizeFrame) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
            if (wbCanvas && wbIsOpen) {
                setupWhiteboardCanvasSize();
            }
        });
    });
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            if (wbCanvas && wbIsOpen) {
                setupWhiteboardCanvasSize();
            }
        }, 300);
    });
}

function drawCanvasGrid() {
    // Use reference dimensions for grid, zoom will handle scaling
    const width = wbReferenceWidth;
    const height = wbReferenceHeight;

    removeCanvasGrid();

    // Draw vertical lines
    for (let i = 0; i <= width; i += wbGridSize) {
        wbGridLines.push(createGridLine(i, 0, i, height));
    }
    // Draw horizontal lines
    for (let i = 0; i <= height; i += wbGridSize) {
        wbGridLines.push(createGridLine(0, i, width, i));
    }

    // Create a group for grid lines and send it to the back
    const gridGroup = new fabric.Group(wbGridLines, { selectable: false, evented: false });
    wbCanvas.add(gridGroup);
    gridGroup.sendToBack();
    wbCanvas.renderAll();
    setColor(whiteboardGridBtn, 'green');
}

function createGridLine(x1, y1, x2, y2) {
    return new fabric.Line([x1, y1, x2, y2], {
        stroke: wbStroke,
        selectable: false,
        evented: false,
    });
}

function removeCanvasGrid() {
    wbGridLines.forEach((line) => {
        line.set({ stroke: wbGridVisible ? wbStroke : 'rgba(255, 255, 255, 0)' });
        wbCanvas.remove(line);
    });
    wbGridLines = [];
    wbCanvas.renderAll();
    setColor(whiteboardGridBtn, 'white');
}

function toggleCanvasGrid() {
    wbGridVisible = !wbGridVisible;
    wbGridVisible ? drawCanvasGrid() : removeCanvasGrid();
    wbCanvasToJson();
}

function setWhiteboardBgColor(color) {
    let data = {
        peer_name: peer_name,
        action: 'bgcolor',
        color: color,
    };
    whiteboardAction(data);
}

function whiteboardResetAllMode() {
    whiteboardIsPencilMode(false);
    whiteboardIsVanishingMode(false);
    whiteboardIsObjectMode(false);
    whiteboardIsEraserMode(false);
}

function whiteboardIsPencilMode(status) {
    wbCanvas.isDrawingMode = status;
    wbIsPencil = status;
    setColor(whiteboardPencilBtn, wbIsPencil ? 'green' : 'white');
}

function whiteboardIsVanishingMode(status) {
    wbCanvas.isDrawingMode = status;
    wbIsVanishing = status;
    wbCanvas.freeDrawingBrush.color = wbIsVanishing ? 'yellow' : wbDrawingColorEl.value;
    setColor(whiteboardVanishingBtn, wbIsVanishing ? 'green' : 'white');
}

function whiteboardIsObjectMode(status) {
    wbIsObject = status;
    setColor(whiteboardObjectBtn, status ? 'green' : 'white');
}

function whiteboardIsEraserMode(status) {
    wbIsEraser = status;
    setColor(whiteboardEraserBtn, wbIsEraser ? 'green' : 'white');
}

function whiteboardAddObj(type) {
    wbCanvas.freeDrawingBrush.color = wbDrawingColorEl.value;

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
            setupFileSelection('Select the image', wbImageInput, renderImageToCanvas);
            break;
        case 'pdfFile':
            setupFileSelection('Select the PDF', wbPdfInput, renderPdfToCanvas);
            break;
        case 'text':
            const text = new fabric.IText('Lorem Ipsum', {
                top: 0,
                left: 0,
                fontFamily: 'Montserrat',
                fill: wbCanvas.freeDrawingBrush.color,
                strokeWidth: wbCanvas.freeDrawingBrush.width,
                stroke: wbCanvas.freeDrawingBrush.color,
            });
            addWbCanvasObj(text);
            break;
        case 'stickyNote':
            createStickyNote();
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

function whiteboardDeleteObject() {
    const obj = wbCanvas?.getActiveObject?.();
    if (!obj) return;
    const tag = document.activeElement?.tagName;
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && !obj.isEditing) return;
    if (obj.isEditing && obj.exitEditing) obj.exitEditing();
    whiteboardEraseObject();
    return;
}

function whiteboardEraseObject() {
    if (wbCanvas && typeof wbCanvas.getActiveObjects === 'function') {
        const activeObjects = wbCanvas.getActiveObjects();
        if (activeObjects && activeObjects.length > 0) {
            // Remove all selected objects
            activeObjects.forEach((obj) => {
                wbCanvas.remove(obj);
            });
            wbCanvas.discardActiveObject();
            wbCanvas.requestRenderAll();
            wbCanvasToJson();
        }
    }
}

function whiteboardCloneObject() {
    if (wbCanvas && typeof wbCanvas.getActiveObjects === 'function') {
        const activeObjects = wbCanvas.getActiveObjects();
        if (activeObjects && activeObjects.length > 0) {
            activeObjects.forEach((obj, idx) => {
                obj.clone((cloned) => {
                    // Offset each clone for visibility
                    cloned.set({
                        left: obj.left + 30 + idx * 10,
                        top: obj.top + 30 + idx * 10,
                        evented: true,
                    });
                    wbCanvas.add(cloned);
                    wbCanvas.setActiveObject(cloned);
                    wbCanvasToJson();
                });
            });
            wbCanvas.requestRenderAll();
        }
    }
}

function wbHandleVanishingObjects() {
    if (wbIsVanishing && wbCanvas._objects.length > 0) {
        const obj = wbCanvas._objects[wbCanvas._objects.length - 1];
        if (obj && obj.type === 'path') {
            wbVanishingObjects.push(obj);
            const fadeDuration = 1000,
                vanishTimeout = 5000;
            setTimeout(() => {
                const start = performance.now();
                function fade(ts) {
                    const p = Math.min((ts - start) / fadeDuration, 1);
                    obj.set('opacity', 1 - p);
                    wbCanvas.requestRenderAll();
                    if (p < 1) requestAnimationFrame(fade);
                }
                requestAnimationFrame(fade);
            }, vanishTimeout - fadeDuration);
            setTimeout(() => {
                wbCanvas.remove(obj);
                wbCanvas.renderAll();
                wbCanvasToJson();
                wbVanishingObjects.splice(wbVanishingObjects.indexOf(obj), 1);
            }, vanishTimeout);
        }
    }
}

function createStickyNote() {
    Swal.fire({
        background: swalBackground,
        title: 'Create Sticky Note',
        html: renderRoomTemplate('popupStickyNoteTemplate'),
        showCancelButton: true,
        confirmButtonText: 'Create',
        cancelButtonText: 'Cancel',
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        preConfirm: () => {
            return {
                text: getId('stickyNoteText').value,
                color: getId('stickyNoteColor').value,
                textColor: getId('stickyNoteTextColor').value,
            };
        },
        didOpen: () => {
            // Focus textarea for quick typing
            setTimeout(() => {
                getId('stickyNoteText').focus();
            }, 100);
        },
    }).then((result) => {
        if (result.isConfirmed) {
            const noteData = result.value;

            // Create sticky note background (rectangle)
            const noteRect = new fabric.Rect({
                left: 100,
                top: 100,
                width: 220,
                height: 160,
                fill: noteData.color,
                shadow: 'rgba(0,0,0,0.18) 0px 4px 12px',
                rx: 14,
                ry: 14,
            });

            // Create text for sticky note
            const noteText = new fabric.Textbox(noteData.text, {
                left: 110,
                top: 110,
                width: 200,
                fontSize: 18,
                fontFamily: 'Segoe UI, Arial, sans-serif',
                fill: noteData.textColor,
                textAlign: 'left',
                editable: true,
                fontWeight: 'bold',
                shadow: new fabric.Shadow({
                    color: 'rgba(255,255,255,0.18)',
                    blur: 2,
                    offsetX: 1,
                    offsetY: 1,
                }),
                padding: 8,
                cornerSize: 8,
            });

            // Group rectangle and text together
            const stickyNoteGroup = new fabric.Group([noteRect, noteText], {
                left: 100,
                top: 100,
                selectable: true,
                hasControls: true,
                hoverCursor: 'pointer',
            });

            // Make the text editable by handling double-click events
            stickyNoteGroup.on('mousedblclick', function () {
                noteText.enterEditing();
                noteText.hiddenTextarea && noteText.hiddenTextarea.focus();
            });

            // Exit editing when clicking outside the noteText
            wbCanvas.on('mouse:down', function (e) {
                if (noteText.isEditing && e.target !== noteText) {
                    noteText.exitEditing();
                }
            });

            addWbCanvasObj(stickyNoteGroup);
        }
    });
}

function setupFileSelection(title, accept, renderToCanvas) {
    Swal.fire({
        allowOutsideClick: false,
        background: swalBackground,
        position: 'center',
        title: title,
        input: 'file',
        html: renderRoomTemplate('popupFileDropTemplate'),
        inputAttributes: {
            accept: accept,
            'aria-label': title,
        },
        didOpen: () => {
            const dropArea = document.getElementById('dropArea');
            dropArea.addEventListener('dragenter', handleDragEnter);
            dropArea.addEventListener('dragover', handleDragOver);
            dropArea.addEventListener('dragleave', handleDragLeave);
            dropArea.addEventListener('drop', handleDrop);
        },
        showDenyButton: true,
        confirmButtonText: `OK`,
        denyButtonText: `Cancel`,
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    }).then((result) => {
        if (result.isConfirmed) {
            renderToCanvas(result.value);
        }
    });

    function handleDragEnter(e) {
        e.preventDefault();
        e.stopPropagation();
        e.target.style.background = 'var(--body-bg)';
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
    }

    function handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        e.target.style.background = '';
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
        e.target.style.background = '';
    }

    function handleFiles(files) {
        if (files.length > 0) {
            const file = files[0];
            console.log('Selected file:', file);
            Swal.close();
            renderToCanvas(file);
        }
    }
}

function renderImageToCanvas(wbCanvasImg) {
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
    }
}

async function renderPdfToCanvas(wbCanvasPdf) {
    if (wbCanvasPdf && wbCanvasPdf.size > 0) {
        let reader = new FileReader();
        reader.onload = async function (event) {
            wbCanvas.requestRenderAll();
            await pdfToImage(event.target.result, wbCanvas);
            whiteboardResetAllMode();
            whiteboardIsObjectMode(true);
            wbCanvasToJson();
        };
        reader.readAsDataURL(wbCanvasPdf);
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
            })
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
                })
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
        whiteboardResetAllMode();
        whiteboardIsObjectMode(true);
        wbCanvasToJson();
    } else {
        console.error('Invalid input. Expected an obj of canvas elements');
    }
}

function setupWhiteboardLocalListeners() {
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
        if (!wbVanishingObjects.includes(e.target)) {
            wbPop.push(e.target); // To allow redo
        }
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
    wbHandleVanishingObjects();
}

function wbCanvasBackgroundColor(color) {
    document.documentElement.style.setProperty('--wb-bg', color);
    wbBackgroundColorEl.value = color;
    wbCanvas.setBackgroundColor(color);
    wbCanvas.renderAll();
}

function wbCanvasUndo() {
    if (wbCanvas._objects.length > 0) {
        const obj = wbCanvas._objects.pop();
        if (!wbVanishingObjects.includes(obj)) {
            wbPop.push(obj);
        }
        wbCanvas.renderAll();
    }
}

function wbCanvasRedo() {
    if (wbPop.length > 0) {
        wbIsRedoing = true;
        wbCanvas.add(wbPop.pop());
    }
}

function wbCanvasClear() {
    wbCanvas.clear();
    wbCanvas.renderAll();
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
    console.log('wbCanvasToJson called');
    if (!isPresenter && wbIsLock) {
        console.log('Not presenter and whiteboard is locked. Exiting');
        return;
    }
    if (!rc.thereAreParticipants()) {
        console.log('No participants. Exiting');
        return;
    }
    let wbCanvasJson = JSON.stringify(wbCanvas.toJSON());
    console.log('Emitting wbCanvasToJson');
    rc.socket.emit('wbCanvasToJson', wbCanvasJson);
}

function JsonToWbCanvas(json) {
    if (!wbIsOpen) toggleWhiteboard();
    wbIsRedoing = true;
    wbCanvas.loadFromJSON(json, function () {
        setupWhiteboardCanvasSize();
        wbIsRedoing = false;
    });
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
        position: 'top',
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

function showWhiteboardShortcuts() {
    const whiteboardShortcutsContent = getId('whiteboardShortcutsContent');
    if (!whiteboardShortcutsContent) {
        console.error('Whiteboard shortcuts content not found');
        return;
    }
    Swal.fire({
        background: swalBackground,
        position: 'center',
        title: 'Whiteboard Shortcuts',
        html: whiteboardShortcutsContent.innerHTML,
        confirmButtonText: 'Got it!',
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    });
}

function toggleLockUnlockWhiteboard() {
    wbIsLock = !wbIsLock;

    const btnToShow = wbIsLock ? whiteboardLockBtn : whiteboardUnlockBtn;
    const btnToHide = wbIsLock ? whiteboardUnlockBtn : whiteboardLockBtn;
    const btnColor = wbIsLock ? 'red' : 'white';
    const action = wbIsLock ? 'lock' : 'unlock';

    show(btnToShow);
    hide(btnToHide);
    setColor(whiteboardLockBtn, btnColor);

    whiteboardAction(getWhiteboardAction(action));

    if (wbIsLock) {
        userLog('info', 'The whiteboard is locked. \n The participants cannot interact with it.', 'top-right');
        sound('locked');
    }
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
            'top-end'
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
            wbCanvasClear();
            removeCanvasGrid();
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
                elemDisplay('whiteboardOptions', true, 'flex');
                elemDisplay('whiteboardButton', true);
                wbDrawing(true);
                wbIsLock = false;
            }
            break;
        case 'close':
            if (wbIsOpen) toggleWhiteboard();
            if (wbIsBgTransparent) setTheme();
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
// HANDLE WHITEBOARD DRAG AND DROP
// ####################################################

function setupWhiteboardDragAndDrop() {
    if (!wbCanvas) return;

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
        wbCanvas.upperCanvasEl.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // Highlight drop area
    ['dragenter', 'dragover'].forEach((eventName) => {
        wbCanvas.upperCanvasEl.addEventListener(
            eventName,
            () => {
                wbCanvas.upperCanvasEl.style.border = '1px dashed #fff';
            },
            false
        );
    });

    ['dragleave', 'drop'].forEach((eventName) => {
        wbCanvas.upperCanvasEl.addEventListener(
            eventName,
            () => {
                wbCanvas.upperCanvasEl.style.border = '';
            },
            false
        );
    });

    // Handle dropped files
    wbCanvas.upperCanvasEl.addEventListener('drop', handleWhiteboardDrop, false);
}

function handleWhiteboardDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;

    if (files.length === 0) return;

    const file = files[0];
    const fileType = file.type;

    switch (true) {
        case fileType.startsWith('image/'):
            renderImageToCanvas(file);
            break;
        case fileType === 'application/pdf':
            renderPdfToCanvas(file);
            break;
        default:
            userLog('warning', `Unsupported file type: ${fileType}. Please drop an image or PDF file.`, 'top-end');
            break;
    }
}

// ####################################################
// HANDLE WHITEBOARD SHORTCUTS
// ####################################################

function setupWhiteboardShortcuts() {
    document.addEventListener('keydown', (event) => {
        if (!wbIsOpen) return;

        // Whiteboard clone shortcut: Cmd+C/Ctrl+C
        if ((event.key === 'c' || event.key === 'C') && (event.ctrlKey || event.metaKey)) {
            whiteboardCloneObject();
            event.preventDefault();
            return;
        }
        // Whiteboard erase shortcut: Cmd+X/Ctrl+X
        if ((event.key === 'x' || event.key === 'X') && (event.ctrlKey || event.metaKey)) {
            whiteboardEraseObject();
            event.preventDefault();
            return;
        }

        // Whiteboard undo shortcuts: Cmd+Z/Ctrl+Z
        if ((event.key === 'z' || event.key === 'Z') && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
            whiteboardAction(getWhiteboardAction('undo'));
            event.preventDefault();
            return;
        }
        // Whiteboard Redo shortcuts: Cmd+Shift+Z/Ctrl+Shift+Z or Cmd+Y/Ctrl+Y
        if (
            ((event.key === 'z' || event.key === 'Z') && (event.ctrlKey || event.metaKey) && event.shiftKey) ||
            ((event.key === 'y' || event.key === 'Y') && (event.ctrlKey || event.metaKey))
        ) {
            whiteboardAction(getWhiteboardAction('redo'));
            event.preventDefault();
            return;
        }
        // Whiteboard delete shortcut: Delete / Backspace
        if (event.key === 'Delete' || event.key === 'Backspace') {
            whiteboardDeleteObject();
            event.preventDefault();
            return;
        }

        // Use event.code and check for Alt+Meta (Mac) or Alt+Ctrl (Windows/Linux)
        if (event.code && event.altKey && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
            switch (event.code) {
                case 'KeyT': // Text
                    whiteboardAddObj('text');
                    event.preventDefault();
                    break;
                case 'KeyL': // Line
                    whiteboardAddObj('line');
                    event.preventDefault();
                    break;
                case 'KeyC': // Circle
                    whiteboardAddObj('circle');
                    event.preventDefault();
                    break;
                case 'KeyR': // Rectangle
                    whiteboardAddObj('rect');
                    event.preventDefault();
                    break;
                case 'KeyG': // Triangle (G for Geometry)
                    whiteboardAddObj('triangle');
                    event.preventDefault();
                    break;
                case 'KeyN': // Sticky Note
                    whiteboardAddObj('stickyNote');
                    event.preventDefault();
                    break;
                case 'KeyU': // Image (from URL)
                    whiteboardAddObj('imgUrl');
                    event.preventDefault();
                    break;
                case 'KeyV': // Vanishing Pen
                    whiteboardResetAllMode();
                    whiteboardIsVanishingMode(!wbIsVanishing);
                    event.preventDefault();
                    break;
                case 'KeyI': // Image (from file)
                    whiteboardAddObj('imgFile');
                    event.preventDefault();
                    break;
                case 'KeyP': // PDF (from file)
                    whiteboardAddObj('pdfFile');
                    event.preventDefault();
                    break;
                case 'KeyQ': // Clear Board
                    confirmClearBoard();
                    event.preventDefault();
                    break;
                default:
                    break;
            }
        }
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
    handleDropdownHover(participantsList.querySelectorAll('.dropdown'));
    refreshParticipantsCount(participantsCount, false);
    setParticipantsTippy(peers);
    updateChatConversationsCount();
    if (isBreakoutPanelOpen) refreshBreakoutPanel();
    console.log('*** Refresh Chat participant lists ***');
}

function getParticipantsList(peers) {
    let li = '';

    function renderParticipantStatus(statusText) {
        return renderRoomTemplate('participantListStatusTemplate', {
            text: { statusText },
        });
    }

    function renderParticipantActionButton({ buttonClass = 'ml5', buttonId, onClick, iconHtml, label = '' }) {
        return renderRoomTemplate('participantListActionButtonTemplate', {
            text: { label },
            html: { iconHtml },
            attrs: {
                buttonClass,
                buttonId,
                onClick,
            },
        });
    }

    function renderParticipantMenuItem(buttonHtml) {
        return renderRoomTemplate('participantListMenuItemTemplate', {
            html: { buttonHtml },
        });
    }

    function renderParticipantDropdown(menuId, menuItems) {
        return renderRoomTemplate('participantListDropdownTemplate', {
            html: { menuItems },
            attrs: { menuId },
        });
    }

    function renderParticipantButtons(buttons) {
        return renderRoomTemplate('participantListActionButtonsTemplate', {
            html: { buttons },
        });
    }

    function renderParticipantItem({
        itemId,
        toId,
        toName,
        itemClass,
        onClick,
        avatarSrc,
        name,
        nameSuffix = '',
        statusHtml,
        dropdownHtml = '',
        buttonsHtml = '',
    }) {
        return renderRoomTemplate('participantListItemTemplate', {
            text: { name },
            html: { nameSuffix, statusHtml, dropdownHtml, buttonsHtml },
            attrs: {
                itemId,
                toId,
                toName,
                itemClass,
                onClick,
                avatarSrc,
            },
        });
    }

    const chatGPT = BUTTONS.chat.chatGPT !== undefined ? BUTTONS.chat.chatGPT : true;

    // CHAT-GPT
    if (chatGPT) {
        const chatgpt_active = rc.chatPeerName === 'ChatGPT' ? ' active' : '';

        li = renderParticipantItem({
            itemId: 'ChatGPT',
            toId: 'ChatGPT',
            toName: 'ChatGPT',
            itemClass: `clearfix${chatgpt_active}`,
            onClick: "rc.showPeerAboutAndMessages(this.id, 'ChatGPT', '', event)",
            avatarSrc: image.chatgpt,
            name: 'ChatGPT',
            nameSuffix: ' <span class="chat-peer-badge assistant-green">Assistant</span>',
            statusHtml: renderParticipantStatus('Private assistant replies'),
        });
    }

    const deepSeek = BUTTONS.chat.deepSeek !== undefined ? BUTTONS.chat.deepSeek : true;

    // DEEP-SEEK
    if (deepSeek) {
        const deepSeek_active = rc.chatPeerName === 'DeepSeek' ? ' active' : '';

        li += renderParticipantItem({
            itemId: 'DeepSeek',
            toId: 'DeepSeek',
            toName: 'DeepSeek',
            itemClass: `clearfix${deepSeek_active}`,
            onClick: "rc.showPeerAboutAndMessages(this.id, 'DeepSeek', '', event)",
            avatarSrc: image.deepSeek,
            name: 'DeepSeek',
            nameSuffix: ' <span class="chat-peer-badge assistant">Assistant</span>',
            statusHtml: renderParticipantStatus('Private assistant replies'),
        });
    }

    const public_chat_active = rc.chatPeerName === 'all' ? ' active' : '';

    // ALL
    let publicDropdownHtml = '';
    let publicButtonsHtml = '';

    // ONLY PRESENTER CAN EXECUTE THIS CMD
    if (!isRulesActive || isPresenter) {
        let menuItems = '';

        menuItems += renderParticipantMenuItem(
            renderParticipantActionButton({
                buttonId: 'muteAllParticipantsButton',
                onClick: `rc.peerAction('me','${socket.id}','mute',true,true)`,
                iconHtml: _PEER.audioOff,
                label: 'Mute all participants',
            })
        );
        menuItems += renderParticipantMenuItem(
            renderParticipantActionButton({
                buttonId: 'hideAllParticipantsButton',
                onClick: `rc.peerAction('me','${socket.id}','hide',true,true)`,
                iconHtml: _PEER.videoOff,
                label: 'Hide all participants',
            })
        );
        menuItems += renderParticipantMenuItem(
            renderParticipantActionButton({
                buttonId: 'stopAllParticipantsButton',
                onClick: `rc.peerAction('me','${socket.id}','stop',true,true)`,
                iconHtml: _PEER.screenOff,
                label: 'Stop all screens sharing',
            })
        );

        if (BUTTONS.participantsList.sendFileAllButton) {
            menuItems += renderParticipantMenuItem(
                renderParticipantActionButton({
                    buttonClass: 'btn-sm ml5',
                    buttonId: 'sendAllButton',
                    onClick: `rc.selectFileToShare('${socket.id}', true)`,
                    iconHtml: _PEER.sendFile,
                    label: 'Share file to all',
                })
            );
        }

        menuItems += renderParticipantMenuItem(
            renderParticipantActionButton({
                buttonClass: 'btn-sm ml5',
                buttonId: 'sendVideoToAll',
                onClick: `rc.shareVideo('all');`,
                iconHtml: _PEER.sendVideo,
                label: 'Share audio/video to all',
            })
        );

        if (BUTTONS.participantsList.ejectAllButton) {
            menuItems += renderParticipantMenuItem(
                renderParticipantActionButton({
                    buttonClass: 'btn-sm ml5',
                    buttonId: 'ejectAllButton',
                    onClick: `rc.peerAction('me','${socket.id}','eject',true,true)`,
                    iconHtml: _PEER.ejectPeer,
                    label: 'Eject all participants',
                })
            );
        }

        publicDropdownHtml = renderParticipantDropdown(`${socket.id}-chatDropDownMenu`, menuItems);
        publicButtonsHtml = renderParticipantButtons(
            renderParticipantActionButton({
                buttonId: 'muteAllButton',
                onClick: `rc.peerAction('me','${socket.id}','mute',true,true)`,
                iconHtml: _PEER.audioOff,
            }) +
                renderParticipantActionButton({
                    buttonId: 'hideAllButton',
                    onClick: `rc.peerAction('me','${socket.id}','hide',true,true)`,
                    iconHtml: _PEER.videoOff,
                }) +
                renderParticipantActionButton({
                    buttonId: 'stopAllButton',
                    onClick: `rc.peerAction('me','${socket.id}','stop',true,true)`,
                    iconHtml: _PEER.screenOff,
                })
        );
    }

    li += renderParticipantItem({
        itemId: 'all',
        toId: 'all',
        toName: 'all',
        itemClass: `clearfix${public_chat_active}`,
        onClick: "rc.showPeerAboutAndMessages(this.id, 'all', '', event)",
        avatarSrc: image.all,
        name: 'Public chat',
        nameSuffix: ' <span id="all-unread-count" class="unread-count hidden"></span>',
        statusHtml: renderParticipantStatus(`Everyone in room ${participantsCount}`),
        dropdownHtml: publicDropdownHtml,
        buttonsHtml: publicButtonsHtml,
    });

    // PEERS IN THE CURRENT ROOM
    for (const peer of Array.from(peers.keys())) {
        const peer_info = peers.get(peer).peer_info;
        console.log('PEER-INFO------->', peer_info);
        const peer_name = peer_info.peer_name;
        const peer_avatar = peer_info.peer_avatar;
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
        const avatarImg = getParticipantAvatar(peer_name, peer_avatar);

        const peer_chat_active = rc.chatPeerId === peer_id ? ' active' : '';

        // NOT ME
        if (socket.id !== peer_id) {
            // PRESENTER HAS MORE OPTIONS
            if (isRulesActive && isPresenter) {
                let menuItems = '';

                menuItems += renderParticipantMenuItem(
                    renderParticipantActionButton({
                        buttonId: `${peer_id}___pAudioMute`,
                        onClick: `rc.peerAction('me',this.id,'mute')`,
                        iconHtml: _PEER.audioOn,
                        label: 'Toggle audio',
                    })
                );
                menuItems += renderParticipantMenuItem(
                    renderParticipantActionButton({
                        buttonId: `${peer_id}___pVideoHide`,
                        onClick: `rc.peerAction('me',this.id,'hide')`,
                        iconHtml: _PEER.videoOn,
                        label: 'Toggle video',
                    })
                );
                menuItems += renderParticipantMenuItem(
                    renderParticipantActionButton({
                        buttonId: `${peer_id}___pScreenStop`,
                        onClick: `rc.peerAction('me',this.id,'stop')`,
                        iconHtml: _PEER.screenOn,
                        label: 'Toggle screen',
                    })
                );

                if (BUTTONS.participantsList.sendFileButton) {
                    menuItems += renderParticipantMenuItem(
                        renderParticipantActionButton({
                            buttonClass: 'btn-sm ml5',
                            buttonId: `${peer_id}___shareFile`,
                            onClick: `rc.selectFileToShare('${peer_id}', false, ${JSON.stringify(peer_name)})`,
                            iconHtml: peer_sendFile,
                            label: 'Share file',
                        })
                    );
                }

                menuItems += renderParticipantMenuItem(
                    renderParticipantActionButton({
                        buttonClass: 'btn-sm ml5',
                        buttonId: `${peer_id}___sendVideoTo`,
                        onClick: `rc.shareVideo('${peer_id}', ${JSON.stringify(peer_name)});`,
                        iconHtml: _PEER.sendVideo,
                        label: 'Share audio/video',
                    })
                );

                if (BUTTONS.participantsList.geoLocationButton) {
                    menuItems += renderParticipantMenuItem(
                        renderParticipantActionButton({
                            buttonClass: 'btn-sm ml5',
                            buttonId: `${peer_id}___geoLocation`,
                            onClick: `rc.askPeerGeoLocation(this.id)`,
                            iconHtml: peer_geoLocation,
                            label: 'Get geolocation',
                        })
                    );
                }
                if (BUTTONS.participantsList.banButton) {
                    menuItems += renderParticipantMenuItem(
                        renderParticipantActionButton({
                            buttonClass: 'btn-sm ml5',
                            buttonId: `${peer_id}___pBan`,
                            onClick: `rc.peerAction('me',this.id,'ban')`,
                            iconHtml: peer_ban,
                            label: 'Ban participant',
                        })
                    );
                }
                if (BUTTONS.participantsList.ejectButton) {
                    menuItems += renderParticipantMenuItem(
                        renderParticipantActionButton({
                            buttonClass: 'btn-sm ml5',
                            buttonId: `${peer_id}___pEject`,
                            onClick: `rc.peerAction('me',this.id,'eject')`,
                            iconHtml: peer_eject,
                            label: 'Eject participant',
                        })
                    );
                }
                const dropdownHtml = renderParticipantDropdown(`${peer_id}-chatDropDownMenu`, menuItems);

                let buttons =
                    renderParticipantActionButton({
                        buttonId: `${peer_id}___pAudio`,
                        onClick: `rc.peerAction('me',this.id,'mute')`,
                        iconHtml: peer_audio,
                    }) +
                    renderParticipantActionButton({
                        buttonId: `${peer_id}___pVideo`,
                        onClick: `rc.peerAction('me',this.id,'hide')`,
                        iconHtml: peer_video,
                    }) +
                    renderParticipantActionButton({
                        buttonId: `${peer_id}___pScreen`,
                        onClick: `rc.peerAction('me',this.id,'stop')`,
                        iconHtml: peer_screen,
                    });

                if (peer_info.peer_hand) {
                    buttons += renderParticipantActionButton({ iconHtml: peer_hand });
                }

                li += renderParticipantItem({
                    itemId: peer_id,
                    toId: peer_id,
                    toName: peer_name,
                    itemClass: `clearfix${peer_chat_active}`,
                    onClick: `rc.showPeerAboutAndMessages(this.id, ${JSON.stringify(peer_name)}, ${JSON.stringify(peer_avatar || '')}, event)`,
                    avatarSrc: avatarImg,
                    name: peer_name_limited,
                    nameSuffix: ` <span id="${peer_id}-unread-count" class="unread-count hidden"></span>`,
                    statusHtml: renderParticipantStatus('Private messages'),
                    dropdownHtml,
                    buttonsHtml: renderParticipantButtons(buttons),
                });
            } else {
                // GUEST USER
                let dropdownHtml = '';

                // NO ROOM BROADCASTING
                if (!isBroadcastingEnabled) {
                    let menuItems = '';

                    if (BUTTONS.participantsList.sendFileButton) {
                        menuItems += renderParticipantMenuItem(
                            renderParticipantActionButton({
                                buttonClass: 'btn-sm ml5',
                                buttonId: `${peer_id}___shareFile`,
                                onClick: `rc.selectFileToShare('${peer_id}', false, ${JSON.stringify(peer_name)})`,
                                iconHtml: peer_sendFile,
                                label: 'Share file',
                            })
                        );
                    }

                    menuItems += renderParticipantMenuItem(
                        renderParticipantActionButton({
                            buttonClass: 'btn-sm ml5',
                            buttonId: `${peer_id}___sendVideoTo`,
                            onClick: `rc.shareVideo('${peer_id}', ${JSON.stringify(peer_name)});`,
                            iconHtml: _PEER.sendVideo,
                            label: 'Share Audio/Video',
                        })
                    );

                    dropdownHtml = renderParticipantDropdown(`${peer_id}-chatDropDownMenu`, menuItems);
                }

                let buttons =
                    renderParticipantActionButton({
                        buttonId: `${peer_id}___pAudio`,
                        onClick: `rc.peerGuestNotAllowed('audio')`,
                        iconHtml: peer_audio,
                    }) +
                    renderParticipantActionButton({
                        buttonId: `${peer_id}___pVideo`,
                        onClick: `rc.peerGuestNotAllowed('video')`,
                        iconHtml: peer_video,
                    }) +
                    renderParticipantActionButton({
                        buttonId: `${peer_id}___pScreen`,
                        onClick: `rc.peerGuestNotAllowed('screen')`,
                        iconHtml: peer_screen,
                    });

                if (peer_info.peer_hand) {
                    buttons += renderParticipantActionButton({ iconHtml: peer_hand });
                }

                li += renderParticipantItem({
                    itemId: peer_id,
                    toId: peer_id,
                    toName: peer_name,
                    itemClass: `clearfix${peer_chat_active}`,
                    onClick: `rc.showPeerAboutAndMessages(this.id, ${JSON.stringify(peer_name)}, ${JSON.stringify(peer_avatar || '')}, event)`,
                    avatarSrc: avatarImg,
                    name: peer_name_limited,
                    nameSuffix: ` <span id="${peer_id}-unread-count" class="unread-count hidden"></span>`,
                    statusHtml: renderParticipantStatus('Private messages'),
                    dropdownHtml,
                    buttonsHtml: renderParticipantButtons(buttons),
                });
            }
        }
    }
    return li;
}

function setParticipantsTippy(peers) {
    //
    if (!isMobileDevice) {
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

function getParticipantAvatar(peerName, peerAvatar = false) {
    if (peerAvatar && isValidAvatarURL(peerAvatar)) {
        return peerAvatar;
    }
    if (rc.isValidEmail(peerName)) {
        return rc.genGravatar(peerName);
    }
    return rc.genAvatarSvg(peerName, 32);
}

// ####################################################
// SET THEME
// ####################################################

/**
 * Get Themes config from server side and merge with built-in defaults
 */
async function getThemes() {
    try {
        const response = await axios.get('/themes', {
            timeout: 5000,
        });
        const serverThemes = response.data.message;
        if (serverThemes) {
            // Deep merge each theme: server overrides take precedence
            for (const [name, vars] of Object.entries(serverThemes)) {
                themeMap[name] = themeMap[name] ? { ...themeMap[name], ...vars } : vars;
            }
            renderDynamicThemeCards();
            console.log('AXIOS ROOM THEMES SETTINGS', {
                serverThemes: serverThemes,
                clientThemes: Object.keys(themeMap),
            });
        }
    } catch (error) {
        console.error('AXIOS GET THEMES ERROR', error.message);
    }
}

/**
 * Dynamically add theme cards & dropdown options for server-defined themes
 * that are not part of the built-in defaults.
 */
function renderDynamicThemeCards() {
    const grid = getId('themeCardsGrid');
    if (!grid) return;

    const builtInThemes = new Set(Array.from(selectTheme.options).map((opt) => opt.value));

    const iconPool = [
        'fa-solid fa-wand-magic-sparkles',
        'fa-solid fa-palette',
        'fa-solid fa-paint-roller',
        'fa-solid fa-swatchbook',
        'fa-solid fa-brush',
        'fa-solid fa-eye-dropper',
        'fa-solid fa-fill-drip',
        'fa-solid fa-circle-half-stroke',
    ];
    let iconIndex = 0;

    for (const [name, vars] of Object.entries(themeMap)) {
        if (builtInThemes.has(name)) continue;

        // Add <option> to the hidden select
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name.charAt(0).toUpperCase() + name.slice(1);
        selectTheme.appendChild(option);

        const index = selectTheme.options.length - 1;

        // Pick an icon and a color from the theme's --dd-color
        const iconClass = iconPool[iconIndex % iconPool.length];
        iconIndex++;
        const iconColor = vars['--dd-color'] || '#c0c0c0';

        // Create the card
        const card = document.createElement('div');
        card.className = 'theme-card';
        card.dataset.theme = name;
        card.dataset.index = index;
        card.innerHTML = renderRoomTemplate('themeCardTemplate', {
            text: { label: option.textContent },
            attrs: { iconClass },
        });

        // Apply dynamic icon color via inline style
        const icon = card.querySelector('i');
        icon.style.color = iconColor;

        // Set dynamic active border color
        card.style.setProperty('--dynamic-theme-color', iconColor);

        // Click handler (same logic as built-in cards)
        card.onclick = () => {
            if (card.classList.contains('disabled')) return;
            selectTheme.selectedIndex = index;
            selectTheme.onchange();
        };

        grid.appendChild(card);
    }
}

let themeMap = {
    default: {
        '--body-bg': 'linear-gradient(135deg, #0e0e14, #1e1e28)',
        '--trx-bg': 'linear-gradient(135deg, #0e0e14, #1e1e28)',
        '--msger-bg': 'linear-gradient(135deg, #0e0e14, #1e1e28)',
        '--left-msg-bg': '#141420',
        '--right-msg-bg': '#1a1a26',
        '--select-bg': '#161622',
        '--select-focus-color': 'rgba(102, 190, 255, 0.5)',
        '--tab-btn-active': '#1e1e28',
        '--settings-bg': 'linear-gradient(135deg, #0e0e14, #1e1e28)',
        '--wb-bg': 'linear-gradient(135deg, #0e0e14, #1e1e28)',
        '--btns-bg-color': 'rgba(10, 10, 16, 0.8)',
        '--dd-color': '#E8E8EC',
    },
    dark: {
        '--body-bg': 'linear-gradient(135deg, #0d0d12, #181820)',
        '--trx-bg': 'linear-gradient(135deg, #0d0d12, #181820)',
        '--msger-bg': 'linear-gradient(135deg, #0d0d12, #181820)',
        '--left-msg-bg': '#111118',
        '--right-msg-bg': '#1a1a22',
        '--select-bg': '#14141c',
        '--select-focus-color': 'rgba(154, 186, 255, 0.42)',
        '--tab-btn-active': '#181820',
        '--settings-bg': 'linear-gradient(135deg, #0d0d12, #181820)',
        '--wb-bg': 'linear-gradient(135deg, #0d0d12, #181820)',
        '--btns-bg-color': 'rgba(10, 10, 16, 0.85)',
        '--dd-color': '#E0E0E6',
    },
    grey: {
        '--body-bg': 'linear-gradient(135deg, #1c1c24, #3a3a46)',
        '--trx-bg': 'linear-gradient(135deg, #1c1c24, #3a3a46)',
        '--msger-bg': 'linear-gradient(135deg, #1c1c24, #3a3a46)',
        '--left-msg-bg': '#24242e',
        '--right-msg-bg': '#32323e',
        '--select-bg': '#222230',
        '--select-focus-color': 'rgba(196, 204, 224, 0.38)',
        '--tab-btn-active': '#3a3a46',
        '--settings-bg': 'linear-gradient(135deg, #1c1c24, #3a3a46)',
        '--wb-bg': 'linear-gradient(135deg, #1c1c24, #3a3a46)',
        '--btns-bg-color': 'rgba(22, 22, 30, 0.75)',
        '--dd-color': '#E4E4EA',
    },
    green: {
        '--body-bg': 'linear-gradient(135deg, #0f1d1a, #1a3830)',
        '--trx-bg': 'linear-gradient(135deg, #0f1d1a, #1a3830)',
        '--msger-bg': 'linear-gradient(135deg, #0f1d1a, #1a3830)',
        '--left-msg-bg': '#0d1816',
        '--right-msg-bg': '#1e2e2a',
        '--select-bg': '#122420',
        '--select-focus-color': 'rgba(111, 207, 151, 0.42)',
        '--tab-btn-active': '#1a3830',
        '--settings-bg': 'linear-gradient(135deg, #0f1d1a, #1a3830)',
        '--wb-bg': 'linear-gradient(135deg, #0f1d1a, #1a3830)',
        '--btns-bg-color': 'rgba(12, 24, 20, 0.75)',
        '--dd-color': '#6FCF97',
    },
    blue: {
        '--body-bg': 'linear-gradient(135deg, #111827, #1e3050)',
        '--trx-bg': 'linear-gradient(135deg, #111827, #1e3050)',
        '--msger-bg': 'linear-gradient(135deg, #111827, #1e3050)',
        '--left-msg-bg': '#0e1420',
        '--right-msg-bg': '#1a2840',
        '--select-bg': '#131c30',
        '--select-focus-color': 'rgba(107, 163, 214, 0.45)',
        '--tab-btn-active': '#1e3050',
        '--settings-bg': 'linear-gradient(135deg, #111827, #1e3050)',
        '--wb-bg': 'linear-gradient(135deg, #111827, #1e3050)',
        '--btns-bg-color': 'rgba(14, 20, 34, 0.75)',
        '--dd-color': '#6BA3D6',
    },
    red: {
        '--body-bg': 'linear-gradient(135deg, #1c1015, #332028)',
        '--trx-bg': 'linear-gradient(135deg, #1c1015, #332028)',
        '--msger-bg': 'linear-gradient(135deg, #1c1015, #332028)',
        '--left-msg-bg': '#180e12',
        '--right-msg-bg': '#2a1c22',
        '--select-bg': '#20141a',
        '--select-focus-color': 'rgba(224, 112, 112, 0.42)',
        '--tab-btn-active': '#332028',
        '--settings-bg': 'linear-gradient(135deg, #1c1015, #332028)',
        '--wb-bg': 'linear-gradient(135deg, #1c1015, #332028)',
        '--btns-bg-color': 'rgba(22, 12, 16, 0.75)',
        '--dd-color': '#E07070',
    },
    purple: {
        '--body-bg': 'linear-gradient(135deg, #18102a, #2e2045)',
        '--trx-bg': 'linear-gradient(135deg, #18102a, #2e2045)',
        '--msger-bg': 'linear-gradient(135deg, #18102a, #2e2045)',
        '--left-msg-bg': '#140e22',
        '--right-msg-bg': '#261c3a',
        '--select-bg': '#1c1430',
        '--select-focus-color': 'rgba(176, 124, 200, 0.42)',
        '--tab-btn-active': '#2e2045',
        '--settings-bg': 'linear-gradient(135deg, #18102a, #2e2045)',
        '--wb-bg': 'linear-gradient(135deg, #18102a, #2e2045)',
        '--btns-bg-color': 'rgba(18, 12, 34, 0.75)',
        '--dd-color': '#B07CC8',
    },
    orange: {
        '--body-bg': 'linear-gradient(135deg, #1c1510, #3a2a1a)',
        '--trx-bg': 'linear-gradient(135deg, #1c1510, #3a2a1a)',
        '--msger-bg': 'linear-gradient(135deg, #1c1510, #3a2a1a)',
        '--left-msg-bg': '#18120e',
        '--right-msg-bg': '#302218',
        '--select-bg': '#221a12',
        '--select-focus-color': 'rgba(232, 165, 96, 0.45)',
        '--tab-btn-active': '#3a2a1a',
        '--settings-bg': 'linear-gradient(135deg, #1c1510, #3a2a1a)',
        '--wb-bg': 'linear-gradient(135deg, #1c1510, #3a2a1a)',
        '--btns-bg-color': 'rgba(22, 16, 12, 0.75)',
        '--dd-color': '#E8A560',
    },
    pink: {
        '--body-bg': 'linear-gradient(135deg, #1c1018, #382030)',
        '--trx-bg': 'linear-gradient(135deg, #1c1018, #382030)',
        '--msger-bg': 'linear-gradient(135deg, #1c1018, #382030)',
        '--left-msg-bg': '#180e14',
        '--right-msg-bg': '#2e1c28',
        '--select-bg': '#201420',
        '--select-focus-color': 'rgba(216, 139, 160, 0.42)',
        '--tab-btn-active': '#382030',
        '--settings-bg': 'linear-gradient(135deg, #1c1018, #382030)',
        '--wb-bg': 'linear-gradient(135deg, #1c1018, #382030)',
        '--btns-bg-color': 'rgba(22, 12, 18, 0.75)',
        '--dd-color': '#D88BA0',
    },
    yellow: {
        '--body-bg': 'linear-gradient(135deg, #1a1810, #36321a)',
        '--trx-bg': 'linear-gradient(135deg, #1a1810, #36321a)',
        '--msger-bg': 'linear-gradient(135deg, #1a1810, #36321a)',
        '--left-msg-bg': '#16140e',
        '--right-msg-bg': '#2c2a18',
        '--select-bg': '#201e12',
        '--select-focus-color': 'rgba(212, 184, 92, 0.44)',
        '--tab-btn-active': '#36321a',
        '--settings-bg': 'linear-gradient(135deg, #1a1810, #36321a)',
        '--wb-bg': 'linear-gradient(135deg, #1a1810, #36321a)',
        '--btns-bg-color': 'rgba(20, 18, 12, 0.75)',
        '--dd-color': '#D4B85C',
    },
};

function applyTheme(props) {
    const root = document.documentElement.style;
    for (const [key, value] of Object.entries(props)) {
        root.setProperty(key, value);
    }
    swalBackground = props['--body-bg'];
    document.body.style.background = props['--body-bg'];
}

function setCustomTheme() {
    const color = themeCustom.color;
    const grad = `radial-gradient(${color}, ${color})`;
    applyTheme({
        '--body-bg': grad,
        '--trx-bg': grad,
        '--msger-bg': grad,
        '--left-msg-bg': color,
        '--right-msg-bg': color,
        '--select-bg': color,
        '--select-focus-color': `color-mix(in srgb, ${color} 58%, white)`,
        '--tab-btn-active': color,
        '--settings-bg': grad,
        '--wb-bg': grad,
        '--btns-bg-color': 'rgba(0, 0, 0, 0.7)',
        '--dd-color': '#FFFFFF',
    });
}

function setTheme() {
    if (themeCustom.keep) return setCustomTheme();

    selectTheme.selectedIndex = localStorageSettings.theme;
    const theme = selectTheme.value;
    const themeNames = Object.keys(themeMap);
    const themeIndex = themeNames.indexOf(theme);

    if (themeIndex !== -1) {
        applyTheme(themeMap[theme]);
        selectTheme.selectedIndex = themeIndex;
    }

    wbIsBgTransparent = false;
    if (rc) rc.isChatBgTransparent = false;
    updateThemeCardsActive();
}

function updateThemeCardsActive() {
    const cards = document.querySelectorAll('.theme-card');
    cards.forEach((card) => {
        const isActive = parseInt(card.dataset.index) === selectTheme.selectedIndex;
        card.classList.toggle('active', isActive);
        // For dynamic (server-added) cards, apply active border/shadow via inline style
        const dynamicColor = card.style.getPropertyValue('--dynamic-theme-color');
        if (dynamicColor) {
            card.style.borderColor = isActive ? dynamicColor : '';
            card.style.boxShadow = isActive ? `0 0 12px ${dynamicColor}33` : '';
        }
    });
}

function updateThemeCardsDisabled() {
    const cards = document.querySelectorAll('.theme-card');
    cards.forEach((card) => {
        card.classList.toggle('disabled', selectTheme.disabled);
    });
}

// ####################################################
// HANDLE ASPECT RATIO
// ####################################################

function handleAspectRatio() {
    if (videoMediaContainer.childElementCount > 1) {
        adaptAspectRatio(videoMediaContainer.childElementCount);
    } else {
        resizeVideoMedia();
    }
}

function adaptAspectRatio(participantsCount) {
    if (BtnAspectRatio.selectedIndex !== 0) {
        // User preferred aspect ratio
        setAspectRatio(BtnAspectRatio.selectedIndex);
        return;
    }

    // Update the participants count badge
    if (participantsCountBadge) {
        participantsCountBadge.textContent = participantsCount;
        participantsCount > 1
            ? elemDisplay('participantsCountBadge', true, 'flex')
            : elemDisplay('participantsCountBadge', false);
    }

    /* 
        ['0:0', '4:3', '16:9', '1:1', '1:2'];
    */
    let desktop,
        mobile = 1;
    // desktop aspect ratio
    switch (participantsCount) {
        case 1:
        //case 2:
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

    const aspectRatio = isMobileDevice ? mobile : desktop;
    setAspectRatio(aspectRatio);
}

// ####################################################
// HANDLE INIT VIRTUAL BACKGROUND AND BLUR
// ####################################################

function showImageSelector() {
    elemDisplay('imageGrid', true, 'grid');
    if (imageGrid.innerHTML !== '') return;

    imageGrid.innerHTML = ''; // Clear previous images

    function createImage(id, src, tooltip, index, clickHandler) {
        const img = document.createElement('img');
        img.id = id;
        img.src = src;
        img.dataset.index = index;
        img.addEventListener('click', clickHandler);
        imageGrid.appendChild(img);
        if (tooltip) {
            setTippy(img.id, tooltip, 'top');
        }
    }

    // Common function to handle virtual background changes
    async function handleVirtualBackground(blurLevel = null, imgSrc = null, bgTransparent = null) {
        if (!blurLevel && !imgSrc && !bgTransparent) {
            virtualBackgroundBlurLevel = null;
            virtualBackgroundSelectedImage = null;
            virtualBackgroundTransparent = null;
            elemDisplay('imageGrid', false);
        }
        await applyVirtualBackground(initVideo, initStream, blurLevel, imgSrc, bgTransparent);
    }

    // Create clean virtual bg Image
    createImage('initCleanVbImg', image.user, 'Remove virtual background', 'cleanVb', () =>
        handleVirtualBackground(null, null)
    );

    // Create High Blur Image
    createImage('initHighBlurImg', image.blurHigh, 'High Blur', 'high', () => handleVirtualBackground(20));

    // Create Low Blur Image
    createImage('initLowBlurImg', image.blurLow, 'Low Blur', 'low', () => handleVirtualBackground(10));

    // Create transparent virtual bg Image
    createImage('initTransparentBg', image.transparentBg, 'Transparent Virtual background', 'transparentVb', () =>
        handleVirtualBackground(null, null, true)
    );

    // Handle file upload (common logic for file selection)
    function setupFileUploadButton(buttonId, sourceImg, tooltip, handler) {
        const imgButton = document.createElement('img');
        imgButton.id = buttonId;
        imgButton.src = sourceImg;
        imgButton.addEventListener('click', handler);
        imageGrid.appendChild(imgButton);
        setTippy(imgButton.id, tooltip, 'top');
    }

    function handleFileUpload(file) {
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const imgData = e.target.result;
                await indexedDBHelper.saveImage(imgData);
                addImageToUI(imgData);
            };
            reader.readAsDataURL(file);
        }
    }

    function createUploadImageButton() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', (event) => {
            handleFileUpload(event.target.files[0]);
        });

        setupFileUploadButton('initUploadImg', image.upload, 'Upload your custom image', () => fileInput.click());

        return fileInput;
    }

    // Function to add an image to UI
    function addImageToUI(imgData) {
        const imageContainer = document.createElement('div');
        imageContainer.className = 'image-wrapper';

        const customImg = document.createElement('img');
        customImg.src = imgData;
        customImg.addEventListener('click', () => handleVirtualBackground(null, imgData));

        const deleteBtn = document.createElement('span');
        deleteBtn.className = 'delete-icon fas fa-times';
        deleteBtn.addEventListener('click', async (event) => {
            event.stopPropagation();
            await indexedDBHelper.removeImage(imgData);
            imageContainer.remove();
        });

        imageContainer.appendChild(customImg);
        imageContainer.appendChild(deleteBtn);
        imageGrid.appendChild(imageContainer);
    }

    // Function to fetch and store an image from URL
    async function fetchAndStoreImage(url) {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const reader = new FileReader();
            reader.onload = async (e) => {
                const imgData = e.target.result;
                await indexedDBHelper.saveImage(imgData);
                addImageToUI(imgData);
            };
            reader.readAsDataURL(blob);
        } catch (error) {
            console.error('Error fetching image:', error);
            // Detect CORS issue and provide a clearer error message
            error.message.includes('Failed to fetch')
                ? showError(initErrorMessage, 'Error: Unable to fetch image. CORS policy may be blocking the request.')
                : showError(initErrorMessage, `Error fetching image: ${error.message}`);
        }
    }

    // Paste image from URL
    function askForImageURL() {
        elemDisplay(initImageUrlModal.id, true);
        navigator.clipboard
            .readText()
            .then((clipboardText) => {
                if (isValidImageURL(filterXSS(clipboardText))) {
                    initImageUrlInput.value = clipboardText;
                }
            })
            .catch(() => {});
    }

    initSaveImageUrlBtn.addEventListener('click', async () => {
        elemDisplay(initImageUrlModal.id, false);
        if (isValidImageURL(initImageUrlInput.value)) {
            await fetchAndStoreImage(initImageUrlInput.value);
            initImageUrlInput.value = '';
        }
    });

    initCancelImageUrlBtn.addEventListener('click', () => {
        elemDisplay(initImageUrlModal.id, false);
        initImageUrlInput.value = '';
    });

    // Upload from file button
    createUploadImageButton();

    // Upload from URL button
    setupFileUploadButton('initLinkImage', image.link, 'Upload Image from URL', askForImageURL);

    // Load default virtual backgrounds
    virtualBackgrounds.forEach((imageUrl, index) => {
        createImage(`initVirtualBg${index}`, imageUrl, null, index + 1, () => handleVirtualBackground(null, imageUrl));
    });

    // Load stored images and add to image grid UI
    indexedDBHelper.getAllImages().then((images) => images.forEach(addImageToUI));

    // Upload image with drag and drop
    imageGrid.addEventListener('dragover', (event) => {
        event.preventDefault();
        imageGrid.classList.add('drag-over');
    });

    imageGrid.addEventListener('dragleave', () => {
        imageGrid.classList.remove('drag-over');
    });

    imageGrid.addEventListener('drop', (event) => {
        event.preventDefault();
        imageGrid.classList.remove('drag-over');
        if (event.dataTransfer.files.length > 0) {
            handleFileUpload(event.dataTransfer.files[0]);
        }
    });
}

// ####################################################
// VIRTUAL BACKGROUND HELPER
// ####################################################

async function applyVirtualBackground(videoElement, stream, blurLevel, backgroundImage, backgroundTransparent) {
    const videoTrack = stream.getVideoTracks()[0];

    if (blurLevel) {
        videoElement.srcObject = await virtualBackground.applyBlurToWebRTCStream(videoTrack, blurLevel);
        virtualBackgroundBlurLevel = blurLevel;
        virtualBackgroundSelectedImage = null;
        virtualBackgroundTransparent = null;
    } else if (backgroundImage) {
        videoElement.srcObject = await virtualBackground.applyVirtualBackgroundToWebRTCStream(
            videoTrack,
            backgroundImage
        );
        virtualBackgroundSelectedImage = backgroundImage;
        virtualBackgroundBlurLevel = null;
        virtualBackgroundTransparent = null;
    } else if (backgroundTransparent) {
        videoElement.srcObject = await virtualBackground.applyTransparentVirtualBackgroundToWebRTCStream(videoTrack);
        virtualBackgroundBlurLevel = null;
        virtualBackgroundSelectedImage = null;
        virtualBackgroundTransparent = true;
    } else {
        videoElement.srcObject = stream; // Default case, use original stream
        virtualBackgroundBlurLevel = null;
        virtualBackgroundSelectedImage = null;
        virtualBackgroundTransparent = null;
    }

    saveVirtualBackgroundSettings(blurLevel, backgroundImage, backgroundTransparent);
}

function isValidImageURL(url) {
    return (
        url.match(/\.(jpeg|jpg|png|gif|webp|bmp|svg|apng|avif|heif|heic|tiff?|ico|cur|jfif|pjpeg|pjp|raw)$/i) !== null
    );
}

// ####################################################
// VIRTUAL BACKGROUND INDEXDB HELPER
// ####################################################

const indexedDBHelper = {
    async openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('customImageDB', 1);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('images')) {
                    db.createObjectStore('images', { keyPath: 'id', autoIncrement: true });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },
    async saveImage(imgData) {
        const db = await this.openDB();
        const transaction = db.transaction('images', 'readwrite');
        transaction.objectStore('images').add({ imgData });
    },
    async getAllImages() {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('images', 'readonly');
            const store = transaction.objectStore('images');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result.map((item) => item.imgData));
            request.onerror = () => reject(request.error);
        });
    },
    async removeImage(imgData) {
        const db = await this.openDB();
        const transaction = db.transaction('images', 'readwrite');
        const store = transaction.objectStore('images');

        const request = store.getAll();
        request.onsuccess = () => {
            const item = request.result.find((item) => item.imgData === imgData);
            if (item) store.delete(item.id);
        };
    },
};

// ####################################################
// VIRTUAL BACKGROUND LOCAL STORAGE SETTINGS
// ####################################################

function saveVirtualBackgroundSettings(blurLevel, imageUrl, transparent) {
    const settings = {
        blurLevel: blurLevel || null,
        imageUrl: imageUrl || null,
        transparent: transparent || null,
    };
    localStorage.setItem('virtualBackgroundSettings', JSON.stringify(settings));
}

async function loadVirtualBackgroundSettings() {
    if (!isMediaStreamTrackAndTransformerSupported) return;

    const savedSettings = localStorage.getItem('virtualBackgroundSettings');

    if (!savedSettings) return;

    const { blurLevel, imageUrl, transparent } = JSON.parse(savedSettings);

    if (blurLevel) {
        await applyVirtualBackground(initVideo, initStream, blurLevel);
    } else if (imageUrl) {
        await applyVirtualBackground(initVideo, initStream, null, imageUrl);
    } else if (transparent) {
        await applyVirtualBackground(initVideo, initStream, null, null, true);
    }

    if (virtualBackgroundBlurLevel || virtualBackgroundSelectedImage || virtualBackgroundTransparent) {
        initVirtualBackgroundButton.click();
    }
}

// ####################################################
// HANDLE ERRORS
// ####################################################

function showError(errorElement, message, delay = 5000) {
    errorElement.innerText = message;

    elemDisplay(errorElement.id, true);

    setTimeout(() => {
        errorElement.classList.add('fade-in');
        errorElement.classList.remove('fade-out');
    }, 100);

    setTimeout(() => {
        errorElement.classList.remove('fade-in');
        errorElement.classList.add('fade-out');
    }, delay);

    setTimeout(() => {
        if (errorElement.classList.contains('fade-out')) {
            elemDisplay(errorElement.id, false);
        }
    }, delay + 500);
}

// ####################################################
// HANDLE SESSION EXIT
// ####################################################

// Call this when the session starts (e.g., after joining a room)
function startRoomSession() {
    preventExit = true;
    // Push a new state so the back button can be intercepted
    history.pushState({ sessionActive: true }, '', location.href);
}

// Call this when the session ends (e.g., after leaving a room)
function endRoomSession() {
    preventExit = false;
}

// Intercept browser BACK button
window.addEventListener('popstate', (event) => {
    if (!preventExit) return;
    // Show a custom confirmation dialog
    Swal.fire({
        background: swalBackground,
        position: 'top',
        title: 'Leave session?',
        text: 'Are you sure you want to exit this session?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes',
        cancelButtonText: 'No',
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    }).then((result) => {
        if (result.isConfirmed) {
            // Save recording if in progress
            if (rc.isRecording() || rc.hasActiveRecorder()) {
                recShowInfo = false;
                rc.saveRecording('User popstate changes');
            }
            preventExit = false;
            // Actually go back in history
            history.back();
        } else {
            // Stay in session: push state again to prevent exit
            history.pushState({ sessionActive: true }, '', location.href);
        }
    });
});

// Intercept tab close, refresh, or direct URL navigation
window.addEventListener('beforeunload', (e) => {
    // Save recording if in progress
    if (rc.isRecording() || rc.hasActiveRecorder()) {
        recShowInfo = false;
        rc.saveRecording('User is closing the tab, refreshing, or navigating away');
    }

    if (bypassBeforeUnloadOnce || !preventExit || window.localStorage.isReconnected === 'true') return;
    // Modern browsers ignore custom messages, but this triggers the prompt
    e.preventDefault();
    e.returnValue = '';
});

// ####################################################
// ABOUT
// ####################################################

function showAbout() {
    sound('open');

    Swal.fire({
        background: swalBackground,
        position: 'center',
        imageUrl: BRAND.about?.imageUrl && BRAND.about.imageUrl.trim() !== '' ? BRAND.about.imageUrl : image.about,
        customClass: { image: 'img-about' },
        title: BRAND.about?.title && BRAND.about.title.trim() !== '' ? BRAND.about.title : 'WebRTC SFU v2.2.44',
        html: renderRoomTemplate('popupAboutTemplate', {
            html: {
                aboutContent: BRAND.about.html,
            },
        }),
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    });
}

// ####################################################
// BREAKOUT ROOMS
// ####################################################

async function getBreakoutRoomsInfo() {
    try {
        return await rc.socket.request('getBreakoutRoomsInfo', { mainRoom: room_id });
    } catch (e) {
        console.warn('Failed to get breakout rooms info', e);
        return [];
    }
}

function parseDurationToSeconds(duration) {
    if (!duration || duration === 'unlimited') return 0;
    const match = duration.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!match) return 0;
    return parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseInt(match[3], 10);
}

function navigateToRoom(room, extraParams = {}) {
    const baseUrl = `${window.location.origin}/join`;
    const queryParams = new URLSearchParams({
        room: room,
        name: peer_name,
        audio: rc.peer_info.peer_audio ? '1' : '0',
        video: rc.peer_info.peer_video ? '1' : '0',
        notify: '0',
        ...extraParams,
    });
    if (peer_token) queryParams.set('token', peer_token);

    if (typeof preventExit !== 'undefined') preventExit = false;
    rc.exit(true);
    openURL(`${baseUrl}?${queryParams.toString()}`);
}

function checkBreakoutRoom() {
    const breakoutMain = getQueryParam('breakoutMain');
    if (breakoutMain) {
        const toolbar = getId('breakoutToolbar');
        const roomLabel = getId('breakoutToolbarRoomName');
        if (toolbar && roomLabel) {
            roomLabel.textContent = getQueryParam('breakoutName') || room_id;
            toolbar.classList.remove('hidden');
            toolbar.dataset.mainRoom = breakoutMain;
        }
        checkBreakoutTimer();
    }
}

function returnToMainRoom() {
    const toolbar = getId('breakoutToolbar');
    const mainRoom = toolbar ? toolbar.dataset.mainRoom : null;
    if (!mainRoom || !rc) return;
    navigateToRoom(mainRoom);
}

function askBreakoutHelp() {
    const toolbar = getId('breakoutToolbar');
    const mainRoom = toolbar ? toolbar.dataset.mainRoom : null;
    if (!mainRoom || !rc) return;

    rc.socket.emit('breakoutRoomHelp', {
        peer_name: peer_name,
        mainRoom: mainRoom,
        breakoutRoom: room_id,
    });

    rc.userLog('info', 'Help request sent to presenter', 'top-end', 3000);
    sound('notification');
}

function toggleBreakoutPanel() {
    if (!rc || !isPresenter) return;
    const panel = getId('breakoutPanel');
    if (!panel) return;

    isBreakoutPanelOpen = !isBreakoutPanelOpen;

    if (isBreakoutPanelOpen) {
        show(panel);
        refreshBreakoutPanel();
        sound('open');

        if (rc.isBreakoutPinned) rc.breakoutUnpin();

        if (!rc.isMobileDevice && rc.canBePinned()) {
            rc.toggleBreakoutPin();
        }
    } else {
        if (rc.isBreakoutPinned) rc.breakoutUnpin();
        hide(panel);
    }
}

function addBreakoutRoom() {
    const index = breakoutRooms.length + 1;
    breakoutRooms.push({ id: `${room_id}_breakout_${index}`, duration: 'unlimited', name: `Room ${index}` });
    refreshBreakoutPanel();
}

async function deleteAllBreakoutRooms() {
    if (breakoutRooms.length === 0) return;

    const breakoutInfo = await getBreakoutRoomsInfo();
    const activeRoomIds = new Set(breakoutInfo.filter((room) => room.peers > 0).map((room) => room.room));
    const inactiveRooms = breakoutRooms.filter((room) => !activeRoomIds.has(room.id));
    const activeRooms = breakoutRooms.filter((room) => activeRoomIds.has(room.id));

    if (inactiveRooms.length === 0) {
        return rc.userLog(
            'warning',
            'No inactive breakout rooms available to delete. Active breakout rooms must be ended first.',
            'top-end',
            5000
        );
    }

    const deletingAllRooms = activeRooms.length === 0;
    const confirmed = await Swal.fire({
        background: swalBackground,
        position: 'top',
        title: deletingAllRooms ? 'Delete All Breakout Rooms?' : 'Delete Inactive Breakout Rooms?',
        html: `
            <div class="popup-template-copy popup-template-copy--left">
                <b>${deletingAllRooms ? 'This will remove every breakout room.' : `This will remove ${inactiveRooms.length} inactive breakout room${inactiveRooms.length !== 1 ? 's' : ''}.`}</b><br /><br />
                ${
                    activeRooms.length > 0
                        ? `${activeRooms.length} active breakout room${activeRooms.length !== 1 ? 's will remain open because participant' : ' will remain open because a participant is'} still inside.`
                        : 'Participants will no longer be able to join these rooms until you create them again.'
                }
            </div>
        `,
        showDenyButton: true,
        confirmButtonText: '<i class="fas fa-trash"></i> Delete',
        denyButtonText: 'Cancel',
        customClass: {
            popup: 'breakout-swal breakout-swal--end',
            htmlContainer: 'breakout-swal-html',
            confirmButton: 'breakout-swal-confirm breakout-swal-confirm--end',
            denyButton: 'breakout-swal-deny',
        },
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    });

    if (!confirmed.isConfirmed) return;

    breakoutRooms = activeRooms;
    refreshBreakoutPanel();

    return rc.userLog(
        'info',
        deletingAllRooms
            ? 'All breakout rooms deleted'
            : `Deleted ${inactiveRooms.length} inactive breakout room${inactiveRooms.length !== 1 ? 's' : ''}`,
        'top-end',
        3000
    );
}

async function removeBreakoutRoom(index) {
    const room = breakoutRooms[index];
    if (!room) return;

    const breakoutInfo = await getBreakoutRoomsInfo();
    const info = breakoutInfo.find((r) => r.room === room.id);
    if (info && info.peers > 0) {
        return rc.userLog(
            'warning',
            `Cannot remove room with ${info.peers} active peer(s). Wait for them to return or broadcast a message first.`,
            'top-end',
            5000
        );
    }

    breakoutRooms.splice(index, 1);
    refreshBreakoutPanel();
}

async function refreshBreakoutPanel() {
    if (!isBreakoutPanelOpen || !rc) return;

    // Get current room peers
    const peers = await getRoomPeers();
    const peerList = [];
    for (const [id, data] of peers) {
        if (id === rc.peer_id) continue;
        const avatar = getParticipantAvatar(data.peer_info.peer_name, data.peer_info.peer_avatar);
        peerList.push({ id, name: data.peer_info.peer_name, avatar });
    }

    // Save current select values before re-render
    const savedAssignments = {};
    document.querySelectorAll('.breakout-room-select').forEach((sel) => {
        if (sel.value) savedAssignments[sel.dataset.peerId] = sel.value;
    });

    // Get breakout room info from server (which rooms actually exist and peer counts)
    const breakoutInfo = await getBreakoutRoomsInfo();

    // Ensure rooms discovered on server are in our local list
    for (const info of breakoutInfo) {
        if (!breakoutRooms.some((r) => r.id === info.room)) {
            breakoutRooms.push({
                id: info.room,
                duration: 'unlimited',
                name: info.room.split('_breakout_').pop() || 'Room',
            });
        }
    }

    // Update rooms section label
    const roomsLabel = getId('breakoutRoomsLabel');
    roomsLabel.textContent = breakoutRooms.length > 0 ? `Rooms (${breakoutRooms.length})` : 'Rooms';

    // Build rooms list
    const roomsList = getId('breakoutRoomsList');
    const emptyState = getId('breakoutEmptyState');
    let roomsHtml = '';
    const roomTooltips = [];
    breakoutRooms.forEach((room, idx) => {
        const displayName = room.name || `Room ${idx + 1}`;
        const info = breakoutInfo.find((r) => r.room === room.id);
        const peerCount = info ? info.peers : 0;
        const peerNames = info && info.peerNames ? info.peerNames : [];
        const durationDisplay =
            room.duration === 'unlimited'
                ? '<i class="fas fa-infinity"></i>'
                : `<i class="fas fa-clock"></i> ${room.duration}`;
        const activeClass = peerCount > 0 ? ' breakout-room-active' : '';
        const countId = `breakoutRoomCount-${idx}`;
        const nameId = `breakoutRoomName-${idx}`;
        const durationId = `breakoutRoomDuration-${idx}`;
        roomsHtml += renderRoomTemplate('breakoutRoomCardTemplate', {
            text: {
                displayName,
                peerCountLabel: `${peerCount} peer${peerCount !== 1 ? 's' : ''}`,
            },
            html: {
                durationDisplay,
            },
            attrs: {
                cardClass: `breakout-room-card${activeClass}`,
                nameId,
                nameOnClick: `renameBreakoutRoom(${idx})`,
                nameTitle: 'Click to rename',
                countId,
                durationId,
                durationOnClick: `editBreakoutDuration(${idx})`,
                durationTitle: 'Click to change duration',
                joinOnClick: `presenterJoinBreakoutRoom('${room.id}')`,
                messageOnClick: `broadcastToBreakoutRooms('${room.id}')`,
                removeOnClick: `removeBreakoutRoom(${idx})`,
            },
        });
        if (peerNames.length > 0) {
            const namesHtml = peerNames
                .map((n) => `<i class="fas fa-user breakout-room-peer-icon"></i>${n}`)
                .join('<br>');
            roomTooltips.push({ id: countId, content: namesHtml });
        }
    });
    roomsList.innerHTML = roomsHtml;

    // Apply tooltips to peer count spans (appendTo body to avoid overflow clipping)
    roomTooltips.forEach((t) => {
        const el = getId(t.id);
        if (!el) return;
        if (el._tippy) el._tippy.destroy();
        tippy(el, {
            content: t.content,
            placement: 'top',
            allowHTML: true,
            appendTo: document.body,
        });
    });

    // Toggle empty state vs rooms list
    const hasRooms = breakoutRooms.length > 0;
    hasRooms ? hide(emptyState) : show(emptyState);
    hasRooms ? show(roomsList) : hide(roomsList);

    // Show/hide launch button and header actions
    const launchBtn = getId('breakoutLaunchBtn');
    const deleteAllBtn = getId('breakoutDeleteAllBtn');
    hasRooms ? show(launchBtn) : hide(launchBtn);
    hasRooms ? show(deleteAllBtn) : hide(deleteAllBtn);

    // Show/hide actions bar when rooms exist
    const actionsBar = getId('breakoutActionsBar');
    const endAllBtn = getId('breakoutEndAllBtn');
    const broadcastAllBtn = getId('breakoutBroadcastAllBtn');
    const hasActivePeers = breakoutInfo.some((r) => r.peers > 0);

    hasRooms ? show(actionsBar) : hide(actionsBar);
    hasActivePeers ? show(endAllBtn) : hide(endAllBtn);

    syncPinnedBreakoutPanelLayout(hasRooms);

    broadcastAllBtn.disabled = !hasRooms;

    // Show/hide auto-assign button when rooms and participants exist
    const autoAssignBtn = getId('breakoutAutoAssignBtn');
    hasRooms && peerList.length > 0 ? show(autoAssignBtn) : hide(autoAssignBtn);

    // Update participants section label
    const participantsLabel = getId('breakoutParticipantsLabel');
    participantsLabel.textContent = peerList.length > 0 ? `Participants (${peerList.length})` : 'Participants';

    // Build participants list with room assignment dropdowns
    const bpList = getId('breakoutParticipantsList');
    const roomOptions = breakoutRooms
        .map((room, idx) =>
            renderRoomTemplate('breakoutRoomOptionTemplate', {
                text: { label: room.name || `Room ${idx + 1}` },
                attrs: { value: room.id },
            })
        )
        .join('');
    const breakoutParticipantOptions =
        renderRoomTemplate('breakoutRoomOptionTemplate', {
            text: { label: 'Not assigned' },
            attrs: { value: '' },
        }) + roomOptions;

    let participantsHtml = '';
    for (const p of peerList) {
        participantsHtml += renderRoomTemplate('breakoutParticipantRowTemplate', {
            text: {
                peerName: p.name,
            },
            html: {
                roomOptions: breakoutParticipantOptions,
            },
            attrs: {
                avatarSrc: p.avatar,
                peerId: p.id,
                peerNameAttr: p.name,
            },
        });
    }

    if (peerList.length === 0) {
        participantsHtml = renderRoomTemplate('breakoutNoParticipantsTemplate');
    }
    bpList.innerHTML = participantsHtml;

    // Restore saved select values
    document.querySelectorAll('.breakout-room-select').forEach((sel) => {
        const saved = savedAssignments[sel.dataset.peerId];
        if (saved && Array.from(sel.options).some((o) => o.value === saved)) {
            sel.value = saved;
        }
    });
}

function syncPinnedBreakoutPanelLayout(hasRooms) {
    if (!rc || !rc.isBreakoutPinned) return;

    const body = getId('breakoutPanel')?.querySelector('.breakout-panel-body');
    const sections = document.querySelectorAll('#breakoutPanel .breakout-section');
    const roomsSection = sections[0];

    if (!body || !roomsSection) return;

    if (hasRooms) {
        roomsSection.style.display = 'flex';
        roomsSection.style.flexDirection = 'column';
        roomsSection.style.minHeight = '0';
        roomsSection.style.overflow = 'hidden';
        body.style.gridTemplateRows = 'auto minmax(0, 1fr) auto minmax(0, 1fr)';
        return;
    }

    roomsSection.style.display = 'none';
    roomsSection.style.flexDirection = '';
    roomsSection.style.minHeight = '';
    roomsSection.style.overflow = '';
    body.style.gridTemplateRows = 'auto minmax(220px, 1fr)';
}

async function launchBreakoutRooms() {
    const selects = document.querySelectorAll('.breakout-room-select');
    const assignments = [];

    selects.forEach((select) => {
        if (select.value) {
            assignments.push({
                peerId: select.dataset.peerId,
                peerName: select.dataset.peerName,
                breakoutRoom: select.value,
            });
        }
    });

    if (assignments.length === 0) {
        return rc.userLog('warning', 'Please assign at least one participant to a room', 'top-end', 4000);
    }

    // Group assignments by room for summary
    const roomCounts = {};
    assignments.forEach((a) => {
        const idx = breakoutRooms.findIndex((r) => r.id === a.breakoutRoom);
        const room = breakoutRooms[idx];
        const name = room ? room.name || `Room ${idx + 1}` : `Room ${idx + 1}`;
        roomCounts[name] = (roomCounts[name] || 0) + 1;
    });
    const summary = Object.entries(roomCounts)
        .map(([name, count]) =>
            renderRoomTemplate('popupBreakoutSummaryRowTemplate', {
                text: {
                    roomName: name,
                    countValue: String(count),
                },
                attrs: {
                    roomIconClass: 'fas fa-door-open',
                    countIconClass: `fas fa-user${count > 1 ? 's' : ''}`,
                },
            })
        )
        .join('');

    const confirmed = await Swal.fire({
        background: swalBackground,
        position: 'top',
        title: 'Launch Breakout Rooms',
        html: renderRoomTemplate('popupBreakoutLaunchTemplate', {
            text: {
                participantCount: String(assignments.length),
                participantLabel: `participant${assignments.length !== 1 ? 's' : ''}`,
            },
            html: {
                summary,
            },
        }),
        showDenyButton: true,
        confirmButtonText: '<i class="fas fa-rocket"></i> Launch',
        denyButtonText: 'Cancel',
        customClass: {
            popup: 'breakout-swal breakout-swal--launch',
            htmlContainer: 'breakout-swal-html',
            confirmButton: 'breakout-swal-confirm breakout-swal-confirm--launch',
            denyButton: 'breakout-swal-deny',
        },
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    });

    if (!confirmed.isConfirmed) return;

    // Use per-room durations and names from assignments
    const assignmentsWithDuration = assignments.map((a) => {
        const idx = breakoutRooms.findIndex((r) => r.id === a.breakoutRoom);
        const room = idx !== -1 ? breakoutRooms[idx] : null;
        return {
            ...a,
            duration: room ? room.duration : 'unlimited',
            roomName: room ? room.name || `Room ${idx + 1}` : a.breakoutRoom,
        };
    });

    rc.socket.emit('breakoutRoom', {
        peer_name: peer_name,
        peer_uuid: peer_uuid,
        mainRoom: room_id,
        assignments: assignmentsWithDuration,
        duration: 'per-room',
    });

    rc.userLog('info', `Breakout rooms launched! ${assignments.length} participant(s) assigned`, 'top-end', 4000);

    // Staggered refresh to show updated counts as participants join their rooms
    setTimeout(() => refreshBreakoutPanel(), 2000);
    setTimeout(() => refreshBreakoutPanel(), 5000);
    setTimeout(() => refreshBreakoutPanel(), 10000);
}

async function presenterJoinBreakoutRoom(breakoutRoom) {
    if (!rc) return;

    const breakoutInfo = await getBreakoutRoomsInfo();
    const info = breakoutInfo.find((r) => r.room === breakoutRoom);
    if (!info || info.peers === 0) {
        return rc.userLog('warning', 'No peers in this room yet', 'top-end', 3000);
    }

    const room = breakoutRooms.find((r) => r.id === breakoutRoom);
    const duration = room ? room.duration : getBreakoutDuration();
    const breakoutName = room ? room.name || breakoutRoom : breakoutRoom;

    navigateToRoom(breakoutRoom, { breakoutMain: room_id, duration: duration, breakoutName: breakoutName });
}

function broadcastToBreakoutRooms(targetRoom = null) {
    if (!rc || !isPresenter) return;

    const input = getId('breakoutBroadcastInput');
    const message = input.value.trim();
    if (!message) {
        return rc.userLog('warning', 'Please type a message to broadcast', 'top-end', 3000);
    }

    rc.socket.emit('breakoutRoomBroadcast', {
        peer_name: peer_name,
        peer_uuid: peer_uuid,
        mainRoom: room_id,
        targetRoom: targetRoom,
        message: message,
    });

    const logMsg = targetRoom ? 'Message sent to room' : 'Message broadcast to all breakout rooms';
    rc.userLog('info', logMsg, 'top-end', 3000);
    input.value = '';
}

function filterBreakoutParticipants() {
    const query = getId('breakoutParticipantSearch').value.toLowerCase().trim();
    const rows = document.querySelectorAll('.breakout-participant-row');
    rows.forEach((row) => {
        const name = row.querySelector('.breakout-peer-name');
        if (!name) return;
        row.style.display = name.textContent.toLowerCase().includes(query) ? '' : 'none';
    });
}

function renameBreakoutRoom(index) {
    const room = breakoutRooms[index];
    if (!room) return;

    const nameEl = getId(`breakoutRoomName-${index}`);
    if (!nameEl) return;

    const currentName = room.name || `Room ${index + 1}`;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'breakout-room-name-input';
    input.value = currentName;
    input.maxLength = 30;

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    function saveName() {
        const newName = input.value.trim() || `Room ${index + 1}`;
        room.name = newName;
        refreshBreakoutPanel();
    }

    input.addEventListener('blur', saveName);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
            input.value = currentName;
            input.blur();
        }
    });
}

function editBreakoutDuration(index) {
    const room = breakoutRooms[index];
    if (!room) return;

    const currentValue = room.duration === 'unlimited' ? '' : room.duration;

    Swal.fire({
        background: swalBackground,
        position: 'center',
        title: 'Set Room Duration',
        html: renderRoomTemplate('popupBreakoutDurationPickerTemplate'),
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Set',
        denyButtonText: 'Unlimited',
        cancelButtonText: 'Cancel',
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        didOpen: () => {
            flatpickr('#breakoutDurationPicker', {
                enableTime: true,
                noCalendar: true,
                dateFormat: 'H:i:S',
                enableSeconds: true,
                time_24hr: true,
                defaultHour: 0,
                defaultMinute: 30,
                defaultSeconds: 0,
                defaultDate: currentValue || '0:30:00',
                inline: true,
                disableMobile: true,
            });
        },
        preConfirm: () => {
            const val = document.getElementById('breakoutDurationPicker').value.trim();
            if (!val) return null;
            return val;
        },
    }).then((result) => {
        if (result.isDenied) {
            room.duration = 'unlimited';
            refreshBreakoutPanel();
        } else if (result.isConfirmed) {
            const val = result.value;
            if (!val) {
                room.duration = 'unlimited';
            } else {
                const validated = validateBreakoutDuration(val);
                room.duration = validated === null ? 'unlimited' : validated;
            }
            refreshBreakoutPanel();
        }
    });
}

function autoAssignBreakoutRooms() {
    if (breakoutRooms.length === 0) {
        return rc.userLog('warning', 'Add at least one room first', 'top-end', 3000);
    }

    const selects = Array.from(document.querySelectorAll('.breakout-room-select'));
    if (selects.length === 0) {
        return rc.userLog('warning', 'No participants to assign', 'top-end', 3000);
    }

    // Only assign unassigned participants
    const unassigned = selects.filter((sel) => !sel.value);
    if (unassigned.length === 0) {
        return rc.userLog('info', 'All participants are already assigned', 'top-end', 3000);
    }

    // Shuffle unassigned participants randomly
    for (let i = unassigned.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [unassigned[i], unassigned[j]] = [unassigned[j], unassigned[i]];
    }

    // Round-robin assignment across rooms
    unassigned.forEach((sel, i) => {
        const roomIndex = i % breakoutRooms.length;
        sel.value = breakoutRooms[roomIndex].id;
    });

    rc.userLog(
        'info',
        `${unassigned.length} participant(s) auto-assigned to ${breakoutRooms.length} room(s)`,
        'top-end',
        3000
    );
}

async function endAllBreakoutSessions() {
    if (!rc || !isPresenter) return;

    const breakoutInfo = await getBreakoutRoomsInfo();
    const totalPeers = breakoutInfo.reduce((sum, r) => sum + r.peers, 0);

    if (totalPeers === 0) {
        breakoutRooms = [];
        refreshBreakoutPanel();
        return rc.userLog('info', 'All breakout rooms cleared', 'top-end', 3000);
    }

    const confirmed = await Swal.fire({
        background: swalBackground,
        position: 'top',
        title: 'End All Breakout Sessions?',
        html: renderRoomTemplate('popupBreakoutEndTemplate', {
            text: {
                participantCount: String(totalPeers),
                participantLabel: `participant${totalPeers !== 1 ? 's' : ''}`,
            },
        }),
        showDenyButton: true,
        confirmButtonText: '<i class="fas fa-door-open"></i> End All',
        denyButtonText: 'Cancel',
        customClass: {
            popup: 'breakout-swal breakout-swal--end',
            htmlContainer: 'breakout-swal-html',
            confirmButton: 'breakout-swal-confirm breakout-swal-confirm--end',
            denyButton: 'breakout-swal-deny',
        },
        showClass: { popup: 'animate__animated animate__fadeInDown' },
        hideClass: { popup: 'animate__animated animate__fadeOutUp' },
    });

    if (!confirmed.isConfirmed) return;

    const countdownEl = document.getElementById('breakoutEndCountdown');
    const countdown = countdownEl ? parseInt(countdownEl.value) : 0;

    if (countdown > 0) {
        rc.socket.emit('breakoutRoomCountdown', {
            peer_name: peer_name,
            peer_uuid: peer_uuid,
            mainRoom: room_id,
            countdown: countdown,
        });
        rc.userLog('info', `Breakout sessions ending in ${countdown} seconds...`, 'top-end', 3000);
    } else {
        rc.socket.emit('breakoutRoomEnd', {
            peer_name: peer_name,
            peer_uuid: peer_uuid,
            mainRoom: room_id,
        });
        rc.userLog('info', 'Ending all breakout sessions...', 'top-end', 3000);
    }

    setTimeout(
        () => {
            breakoutRooms = [];
            refreshBreakoutPanel();
        },
        (countdown + 3) * 1000
    );
}

function validateBreakoutDuration(input) {
    if (!input || input.toLowerCase() === 'unlimited') return 'unlimited';
    const total = parseDurationToSeconds(input);
    if (total === 0) {
        const match = input.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
        if (!match) {
            rc.userLog('warning', 'Invalid duration format. Use the time picker or set unlimited', 'top-end', 4000);
            return null;
        }
        const minutes = parseInt(match[2], 10);
        const seconds = parseInt(match[3], 10);
        if (minutes > 59 || seconds > 59) {
            rc.userLog('warning', 'Invalid duration. Minutes and seconds must be 0-59', 'top-end', 4000);
            return null;
        }
        rc.userLog('warning', 'Duration must be greater than 0', 'top-end', 4000);
        return null;
    }
    return input;
}

let breakoutTimerInterval = null;

function checkBreakoutTimer() {
    const duration = getQueryParam('duration');
    if (!duration || duration === 'unlimited') return;

    const seconds = parseDurationToSeconds(duration);
    if (seconds <= 0) return;

    startBreakoutCountdown(seconds, { warn: false });
}

function startBreakoutEndCountdown(seconds) {
    if (!rc || seconds <= 0) return;
    startBreakoutCountdown(seconds, { warn: true });
}

function startBreakoutCountdown(seconds, { warn = false } = {}) {
    if (breakoutTimerInterval) {
        clearInterval(breakoutTimerInterval);
        breakoutTimerInterval = null;
    }

    let remaining = seconds;

    const timerEl = getId('breakoutTimer');
    const displayEl = getId('breakoutTimerDisplay');
    if (!timerEl || !displayEl) return;

    timerEl.classList.remove('hidden');
    if (warn) timerEl.parentElement.classList.add('breakout-timer-warning');
    updateTimerDisplay(displayEl, remaining);

    if (warn && rc) {
        rc.userLog('warning', `Breakout session closing in ${remaining} seconds`, 'top-end', 5000);
    }

    breakoutTimerInterval = setInterval(() => {
        remaining--;
        updateTimerDisplay(displayEl, remaining);

        if (warn) {
            if ((remaining === 30 || remaining === 10 || remaining === 5) && rc) {
                rc.userLog('warning', `Returning to main room in ${remaining} seconds`, 'top-end', 3000);
                sound('notification');
            }
        } else {
            if (remaining <= 30 && remaining > 0 && remaining % 10 === 0 && rc) {
                rc.userLog('warning', `Breakout session ends in ${remaining} seconds`, 'top-end', 3000);
            }
        }

        if (remaining <= 0) {
            clearInterval(breakoutTimerInterval);
            breakoutTimerInterval = null;
            if (rc) rc.userLog('info', 'Breakout session ended. Returning to main room...', 'top-end', 4000);
            setTimeout(() => returnToMainRoom(), 2000);
        }
    }, 1000);
}

function updateTimerDisplay(el, seconds) {
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    el.textContent = `${h}:${m}:${s}`;
    if (seconds <= 30) {
        el.parentElement.classList.add('breakout-timer-warning');
    }
}
