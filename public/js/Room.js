'use strict';

if (location.href.substr(0, 5) !== 'https') location.href = 'https' + location.href.substr(4, location.href.length - 4);

const RoomURL = window.location.href;

const swalBackground = 'rgba(0, 0, 0, 0.7)';
const swalImageUrl = '../images/pricing-illustration.svg';

const url = {
    ipLookup: 'https://extreme-ip-lookup.com/json/',
};

let rc = null;
let producer = null;

let peer_name = 'peer_' + getRandomNumber(5);
let peer_geo = null;
let peer_info = null;

let room_id = location.pathname.substring(6);
let isEnumerateDevices = false;

let isAudioAllowed = false;
let isVideoAllowed = false;
let isAudioOn = true;
let isVideoOn = true;

let recTimer = null;
let recElapsedTime = null;

const socket = io();

function getRandomNumber(length) {
    let result = '';
    let characters = '0123456789';
    let charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

function initClient() {
    if (!DetectRTC.isMobileDevice) {
        setTippy('sessionTime', 'Session time', 'bottom');
        setTippy('exitButton', 'Exit room', 'bottom');
        setTippy('shareButton', 'Share Room', 'bottom');
        setTippy('devicesButton', 'Devices', 'bottom');
        setTippy('chatButton', 'Chat', 'bottom');
        setTippy('chatCleanButton', 'Clean', 'bottom');
        setTippy('chatSaveButton', 'Save', 'bottom');
        setTippy('chatCloseButton', 'Close', 'bottom');
        setTippy('chatMessage', 'Press enter to send', 'top-start');
        setTippy('chatSendButton', 'Send', 'top');
        setTippy('chatEmojiButton', 'Emoji', 'top');
        setTippy('fullScreenButton', 'Full Screen', 'bottom');
        setTippy('recButton', 'Recording', 'bottom');
        setTippy('startRecButton', 'Start Recording', 'bottom');
        setTippy('stopRecButton', 'Stop Recording', 'bottom');
        setTippy('pauseRecButton', 'Pause Recording', 'bottom');
        setTippy('resumeRecButton', 'Resume Recording', 'bottom');
        setTippy('stopAudioButton', 'Stop Audio', 'bottom');
        setTippy('startAudioButton', 'Start Audio', 'bottom');
        setTippy('swapCameraButton', 'Swap Camera', 'bottom');
        setTippy('startVideoButton', 'Start Video', 'bottom');
        setTippy('stopVideoButton', 'Stop Video', 'bottom');
        setTippy('startScreenButton', 'Start Screen', 'bottom');
        setTippy('stopScreenButton', 'Stop Screen', 'bottom');
        setTippy('participantsButton', 'Show participants', 'bottom');
        setTippy('lockRoomButton', 'Room Lock', 'bottom');
        setTippy('unlockRoomButton', 'Room Unlock', 'bottom');
        setTippy('aboutButton', 'About', 'bottom');
    }
    initEnumerateDevices();
}

function setTippy(elem, content, placement) {
    tippy(document.getElementById(elem), {
        content: content,
        placement: placement,
    });
}

// ####################################################
// ENUMERATE DEVICES
// ####################################################

async function initEnumerateDevices() {
    if (isEnumerateDevices) return;
    console.log('01 ----> init Enumerate Devices');

    // allow the audio
    await navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
            enumerateAudioDevices(stream);
            isAudioAllowed = true;
        })
        .catch(() => {
            isAudioAllowed = false;
        });

    // allow the video
    await navigator.mediaDevices
        .getUserMedia({ video: true })
        .then((stream) => {
            enumerateVideoDevices(stream);
            isVideoAllowed = true;
        })
        .catch(() => {
            isVideoAllowed = false;
        });

    if (!isAudioAllowed && !isVideoAllowed) {
        window.location.href = `/permission?room_id=${room_id}&message=Not allowed both Audio and Video`;
    } else {
        getPeerGeoLocation();
        whoAreYou();
    }
}

function enumerateAudioDevices(stream) {
    console.log('02 ----> Get Audio Devices');
    navigator.mediaDevices
        .enumerateDevices()
        .then((devices) =>
            devices.forEach((device) => {
                let el = null;
                if ('audioinput' === device.kind) {
                    el = microphoneSelect;
                } else if ('audiooutput' === device.kind) {
                    el = speakerSelect;
                }
                if (!el) return;
                appenChild(device, el);
            }),
        )
        .then(() => {
            stopTracks(stream);
            isEnumerateDevices = true;
            speakerSelect.disabled = !('sinkId' in HTMLMediaElement.prototype);
        });
}

function enumerateVideoDevices(stream) {
    console.log('03 ----> Get Video Devices');
    navigator.mediaDevices
        .enumerateDevices()
        .then((devices) =>
            devices.forEach((device) => {
                let el = null;
                if ('videoinput' === device.kind) {
                    el = videoSelect;
                }
                if (!el) return;
                appenChild(device, el);
            }),
        )
        .then(() => {
            stopTracks(stream);
            isEnumerateDevices = true;
        });
}

function stopTracks(stream) {
    stream.getTracks().forEach((track) => {
        track.stop();
    });
}

function appenChild(device, el) {
    let option = document.createElement('option');
    option.value = device.deviceId;
    option.innerText = device.label;
    el.appendChild(option);
}

// ####################################################
// SOME PEER INFO
// ####################################################

function getPeerInfo() {
    peer_info = {
        detect_rtc_version: DetectRTC.version,
        is_webrtc_Supported: DetectRTC.isWebRTCSupported,
        is_mobile_device: DetectRTC.isMobileDevice,
        os_name: DetectRTC.osName,
        os_version: DetectRTC.osVersion,
        browser_name: DetectRTC.browser.name,
        browser_version: DetectRTC.browser.version,
        peer_id: socket.id,
        peer_name: peer_name,
        peer_audio: isAudioOn,
        peer_video: isVideoOn,
    };
}

function getPeerGeoLocation() {
    fetch(url.ipLookup)
        .then((res) => res.json())
        .then((outJson) => {
            peer_geo = outJson;
        })
        .catch((ex) => console.warn('IP Lookup', ex));
}

// ####################################################
// ENTER YOUR NAME | Enable/Disable AUDIO/VIDEO
// ####################################################

function whoAreYou() {
    console.log('04 ----> Who are you');

    Swal.fire({
        allowOutsideClick: false,
        allowEscapeKey: false,
        background: swalBackground,
        input: 'text',
        inputPlaceholder: 'Enter your name',
        html: `<br />
        <button id="initAudioButton" class="fas fa-microphone" onclick="handleAudio(event)"></button>
        <button id="initVideoButton" class="fas fa-video" onclick="handleVideo(event)"></button>`,
        confirmButtonText: `Join meeting`,
        showClass: {
            popup: 'animate__animated animate__fadeInDown',
        },
        hideClass: {
            popup: 'animate__animated animate__fadeOutUp',
        },
        inputValidator: (name) => {
            if (!name) return 'Please enter your name';
            peer_name = name;
        },
    }).then(() => {
        getPeerInfo();
        shareRoom();
        joinRoom(peer_name, room_id);
    });

    let initAudioButton = document.getElementById('initAudioButton');
    let initVideoButton = document.getElementById('initVideoButton');
    if (!isAudioAllowed) initAudioButton.className = 'hidden';
    if (!isVideoAllowed) initVideoButton.className = 'hidden';
    if (!DetectRTC.isMobileDevice) {
        setTippy('initAudioButton', 'Enable / Disable audio', 'left');
        setTippy('initVideoButton', 'Enable / Disable video', 'right');
    }
}

function handleAudio(e) {
    isAudioOn = isAudioOn ? false : true;
    e.target.className = 'fas fa-microphone' + (isAudioOn ? '' : '-slash');
}

function handleVideo(e) {
    isVideoOn = isVideoOn ? false : true;
    e.target.className = 'fas fa-video' + (isVideoOn ? '' : '-slash');
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
            title: '<strong>Hello ' + peer_name + '</strong>',
            html:
                `
            <br/>
            <div id="qrRoomContainer">
                <canvas id="qrRoom"></canvas>
            </div>
            <br/><br/>
            <p style="color:white;">Share this meeting invite others to join.</p>
            <p style="color:rgb(8, 189, 89);">` +
                RoomURL +
                `</p>`,
            showDenyButton: true,
            showCancelButton: true,
            confirmButtonText: `Copy meeting URL`,
            denyButtonText: `Email invite`,
            cancelButtonText: `Close`,
            showClass: {
                popup: 'animate__animated animate__fadeInUp',
            },
            hideClass: {
                popup: 'animate__animated animate__fadeOutUp',
            },
        }).then((result) => {
            if (result.isConfirmed) {
                copyRoomURL();
            } else if (result.isDenied) {
                let message = {
                    email: '',
                    subject: 'Please join our MiroTalkSfu Video Chat Meeting',
                    body: 'Click to join: ' + RoomURL,
                };
                shareRoomByEmail(message);
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
    document.execCommand('copy');
    document.body.removeChild(tmpInput);
    userLog('info', 'Room URL copied to clipboard', 'top-end');
}

function shareRoomByEmail(message) {
    let email = message.email;
    let subject = message.subject;
    let emailBody = message.body;
    document.location = 'mailto:' + email + '?subject=' + subject + '&body=' + emailBody;
}

// ####################################################
// JOIN TO ROOM
// ####################################################

function joinRoom(peer_name, room_id) {
    if (rc && rc.isConnected()) {
        console.log('Already connected to a room');
    } else {
        console.log('05 ----> join to Room ' + room_id);
        rc = new RoomClient(
            localMedia,
            remoteVideos,
            remoteAudios,
            window.mediasoupClient,
            socket,
            room_id,
            peer_name,
            peer_geo,
            peer_info,
            isAudioAllowed,
            isVideoAllowed,
            isAudioOn,
            isVideoOn,
            roomIsReady,
        );
        handleRoomClientEvents();
    }
}

function roomIsReady() {
    control.className = '';
    show(exitButton);
    show(shareButton);
    show(recButton);
    show(startRecButton);
    show(chatButton);
    show(chatSendButton);
    show(chatEmojiButton);
    if (DetectRTC.isMobileDevice) {
        show(swapCameraButton);
        setChatSize();
    } else {
        rc.makeDraggable(chatRoom, chatHeader);
        show(startScreenButton);
    }
    if (DetectRTC.browser.name != 'Safari') {
        document.onfullscreenchange = () => {
            if (!document.fullscreenElement) rc.isDocumentOnFullScreen = false;
        };
        show(fullScreenButton);
    }
    show(devicesButton);
    if (isAudioAllowed) show(startAudioButton);
    if (isVideoAllowed) show(startVideoButton);
    show(videoMedia);
    show(participantsButton);
    show(lockRoomButton);
    show(aboutButton);
    handleButtons();
    handleSelects();
    handleInputs();
    startSessionTimer();
}

function hide(elem) {
    elem.className = 'hidden';
}

function show(elem) {
    elem.className = '';
}

// ####################################################
// SET CHAT MOBILE
// ####################################################

function setChatSize() {
    document.documentElement.style.setProperty('--msger-width', '99%');
    document.documentElement.style.setProperty('--msger-height', '99%');
}

// ####################################################
// SESSION TIMER
// ####################################################

function startSessionTimer() {
    sessionTime.style.display = 'inline';
    let callStartTime = Date.now();
    setInterval(function printTime() {
        let callElapsedTime = Date.now() - callStartTime;
        sessionTime.innerHTML = getTimeToString(callElapsedTime);
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
            recordingStatus.innerHTML = '🔴 REC ' + secondsToHms(recElapsedTime);
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
    exitButton.onclick = () => {
        rc.exit();
    };
    shareButton.onclick = () => {
        shareRoom(true);
    };
    devicesButton.onclick = () => {
        rc.toggleDevices();
    };
    chatButton.onclick = () => {
        rc.toggleChat();
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
    chatSendButton.onclick = () => {
        rc.sendMessage();
    };
    chatEmojiButton.onclick = () => {
        rc.toggleChatEmoji();
    };
    fullScreenButton.onclick = () => {
        rc.toggleFullScreen();
    };
    recButton.onclick = () => {
        rc.toggleRecording();
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
        rc.closeThenProduce(RoomClient.mediaType.video, null, true);
    };
    startAudioButton.onclick = () => {
        rc.produce(RoomClient.mediaType.audio, microphoneSelect.value);
        // rc.resumeProducer(RoomClient.mediaType.audio);
    };
    stopAudioButton.onclick = () => {
        rc.closeProducer(RoomClient.mediaType.audio);
        // rc.pauseProducer(RoomClient.mediaType.audio);
    };
    startVideoButton.onclick = () => {
        rc.produce(RoomClient.mediaType.video, videoSelect.value);
        // rc.resumeProducer(RoomClient.mediaType.video);
    };
    stopVideoButton.onclick = () => {
        rc.closeProducer(RoomClient.mediaType.video);
        // rc.pauseProducer(RoomClient.mediaType.video);
    };
    startScreenButton.onclick = () => {
        rc.produce(RoomClient.mediaType.screen);
    };
    stopScreenButton.onclick = () => {
        rc.closeProducer(RoomClient.mediaType.screen);
    };
    participantsButton.onclick = () => {
        getRoomParticipants();
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
// HTML SELECTS
// ####################################################

function handleSelects() {
    microphoneSelect.onchange = () => {
        rc.closeThenProduce(RoomClient.mediaType.audio, microphoneSelect.value);
    };
    speakerSelect.onchange = () => {
        rc.attachSinkId(localMedia, speakerSelect.value);
    };
    videoSelect.onchange = () => {
        rc.closeThenProduce(RoomClient.mediaType.video, videoSelect.value);
    };
}

// ####################################################
// HTML INPUTS
// ####################################################

function handleInputs() {
    chatMessage.onkeyup = (e) => {
        if (e.keyCode === 13) {
            e.preventDefault();
            chatSendButton.click();
        }
    };
    rc.getId('chatEmoji').addEventListener('emoji-click', (e) => {
        chatMessage.value += e.detail.emoji.unicode;
        rc.toggleChatEmoji();
    });
}

// ####################################################
// ROOM CLIENT EVENT LISTNERS
// ####################################################

function handleRoomClientEvents() {
    rc.on(RoomClient.EVENTS.startRec, () => {
        hide(startRecButton);
        show(stopRecButton);
        show(pauseRecButton);
        startRecordingTimer();
    });
    rc.on(RoomClient.EVENTS.pauseRec, () => {
        hide(pauseRecButton);
        show(resumeRecButton);
    });
    rc.on(RoomClient.EVENTS.resumeRec, () => {
        hide(resumeRecButton);
        show(pauseRecButton);
    });
    rc.on(RoomClient.EVENTS.stopRec, () => {
        hide(stopRecButton);
        hide(pauseRecButton);
        hide(resumeRecButton);
        show(startRecButton);
        stopRecordingTimer();
    });
    rc.on(RoomClient.EVENTS.startAudio, () => {
        hide(startAudioButton);
        show(stopAudioButton);
    });
    rc.on(RoomClient.EVENTS.pauseAudio, () => {
        console.log('Room Client pause audio');
        hide(stopAudioButton);
        show(startAudioButton);
    });
    rc.on(RoomClient.EVENTS.resumeAudio, () => {
        console.log('Room Client resume audio');
        hide(startAudioButton);
        show(stopAudioButton);
    });
    rc.on(RoomClient.EVENTS.stopAudio, () => {
        hide(stopAudioButton);
        show(startAudioButton);
    });
    rc.on(RoomClient.EVENTS.startVideo, () => {
        hide(startVideoButton);
        show(stopVideoButton);
    });
    rc.on(RoomClient.EVENTS.pauseVideo, () => {
        console.log('Room Client pause video');
        hide(stopVideoButton);
        show(startVideoButton);
    });
    rc.on(RoomClient.EVENTS.resumeVideo, () => {
        console.log('Room Client resume video');
        hide(startVideoButton);
        show(stopVideoButton);
    });
    rc.on(RoomClient.EVENTS.stopVideo, () => {
        hide(stopVideoButton);
        show(startVideoButton);
    });
    rc.on(RoomClient.EVENTS.startScreen, () => {
        hide(startScreenButton);
        show(stopScreenButton);
    });
    rc.on(RoomClient.EVENTS.pauseScreen, () => {
        console.log('Room Client pause screen');
    });
    rc.on(RoomClient.EVENTS.resumeScreen, () => {
        console.log('Room Client resume screen');
    });
    rc.on(RoomClient.EVENTS.stopScreen, () => {
        hide(stopScreenButton);
        show(startScreenButton);
    });
    rc.on(RoomClient.EVENTS.roomLock, () => {
        hide(lockRoomButton);
        show(unlockRoomButton);
    });
    rc.on(RoomClient.EVENTS.roomUnlock, () => {
        hide(unlockRoomButton);
        show(lockRoomButton);
    });
    rc.on(RoomClient.EVENTS.exitRoom, () => {
        window.location.href = '/newroom';
    });
}

// ####################################################
// SHOW LOG
// ####################################################

function userLog(icon, message, position) {
    const Toast = Swal.mixin({
        background: swalBackground,
        toast: true,
        position: position,
        showConfirmButton: false,
        timer: 3000,
    });
    Toast.fire({
        icon: icon,
        title: message,
    });
}

// ####################################################
// SOUND
// ####################################################

async function sound(name) {
    let sound = '../sounds/' + name + '.wav';
    let audio = new Audio(sound);
    try {
        await audio.play();
    } catch (err) {
        return false;
    }
}

// ####################################################
// HANDLE PARTICIPANTS
// ####################################################

async function getRoomParticipants() {
    let room_info = await rc.getRoomInfo();
    let peers = new Map(JSON.parse(room_info.peers));
    let lists = `<div id="roomParticipants"><ul>`;

    for (let peer of Array.from(peers.keys())) {
        let peer_info = peers.get(peer).peer_info;
        let peer_name = peer_info.peer_name;
        let peer_id = peer_info.peer_id;
        rc.peer_id === peer_id
            ? (lists += `<li>👤 ${peer_name} (me)</li>`)
            : (lists += `<li id='${peer_id}'>👤 ${peer_name} <button id='${peer_id}' onclick="rc.peerAction('me',this.id,'eject')">eject</button></li>`);
    }
    lists += `</ul></div>`;

    sound('open');

    Swal.fire({
        background: swalBackground,
        position: 'center',
        title: `Participants ${peers.size}`,
        html: lists,
        showClass: {
            popup: 'animate__animated animate__fadeInDown',
        },
        hideClass: {
            popup: 'animate__animated animate__fadeOutUp',
        },
    });
}

// ####################################################
// ABOUT
// ####################################################

function showAbout() {
    sound('open');

    Swal.fire({
        background: swalBackground,
        imageUrl: swalImageUrl,
        imageWidth: 300,
        imageHeight: 150,
        position: 'center',
        html: `
        <br/>
        <div id="about">
            <b>Open Source</b> project on
            <a href="https://github.com/miroslavpejic85/mirotalksfu" target="_blank"><br/><br />
            <img alt="mirotalksfu-github" src="../images/github.png"></a><br/><br />
            <button class="far fa-heart pulsate" onclick="window.open('https://github.com/sponsors/miroslavpejic85?o=esb')"> Sponsor</button>
            <br /><br />
            Contact: <a href="https://www.linkedin.com/in/miroslav-pejic-976a07101/" target="_blank"> Miroslav Pejic</a>
        </div>
        `,
        showClass: {
            popup: 'animate__animated animate__fadeInUp',
        },
        hideClass: {
            popup: 'animate__animated animate__fadeOutUp',
        },
    });
}
