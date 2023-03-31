'use strict';

let isWebkitSpeechRecognitionSupported = false;
let recognition;
let isVoiceCommandsEnabled = true;
let browserLanguage = navigator.language || navigator.userLanguage;
let isVoiceCommandSupported = browserLanguage.includes('en-');

const speechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const commands = {
    shareRoom: 'room',
    hideMe: 'hide me',
    showMe: 'show me',
    newRoom: 'new room',
    leaveRoom: 'exit the room',
    audioOn: 'start the audio',
    audioOff: 'stop the audio',
    videoOn: 'start the video',
    videoOff: 'stop the video',
    screenOn: 'start the screen',
    screenOff: 'stop the screen',
    chatOn: 'open the chat',
    chatSend: 'send',
    chatOff: 'close the chat',
    whiteboardOn: 'open the whiteboard',
    whiteboardOff: 'close the whiteboard',
    recordingOn: 'start the recording',
    recordingPause: 'pause the recording',
    recordingResume: 'resume the recording',
    recordingOff: 'stop the recording',
    settingsOn: 'open the settings',
    settingsOff: 'close the settings',
    participantsOn: 'show the participants',
    participantsOff: 'hide the participants',
    participantsVideoOff: 'stop the participants video',
    participantsAudioOff: 'stop the participants audio',
    participantsKickOut: 'kick out the participants',
    fileShareOn: 'open a file',
    fileShareOff: 'close a file',
    videoShareOn: 'share the video',
    videoShareOff: 'close the video',
    swapCamera: 'swap the camera',
    raiseHand: 'raise the hand',
    lowerHand: 'lower the hand',
    roomLock: 'lock the room',
    roomUnlock: 'unlock the room',
    about: 'show the about',
    email: 'open email',
    google: 'open google',
    googleTr: 'open google translate',
    youtube: 'open youtube',
    facebook: 'open facebook',
    linkedin: 'open linkedin',
    twitter: 'open twitter',
    tiktok: 'open tiktok',
    github: 'open github',
    survey: 'open survey',
    stopRecognition: 'stop the voice recognition',
};

const browser = {
    newroom: '/newroom',
    email: 'mailto:?subject=&body=',
    google: 'https://www.google.com',
    googleTr: 'https://translate.google.com/',
    youtube: 'https://www.youtube.com',
    facebook: 'https://www.facebook.com',
    linkedin: 'https://www.linkedin.com',
    twitter: 'https://www.twitter.com',
    tiktok: 'https://www.tiktok.com',
    github: 'https://github.com/miroslavpejic85',
};

if (speechRecognition) {
    recognition = new speechRecognition();

    recognition.maxAlternatives = 1;
    recognition.continuous = true;
    recognition.lang = browserLanguage;

    console.log('Speech recognition', recognition);

    recognition.onstart = function () {
        console.log('Start speech recognition');
        hide(chatSpeechStartButton);
        show(chatSpeechStopButton);
        setColor(chatSpeechStopButton, 'lime');
    };

    recognition.onresult = (e) => {
        let current = e.resultIndex;
        let transcript = e.results[current][0].transcript;

        if (transcript.trim().toLowerCase() != commands.chatSend) {
            chatMessage.value = transcript;
        }

        if (isVoiceCommandsEnabled && isVoiceCommandSupported) {
            execVoiceCommands(transcript);
        }
    };

    recognition.onerror = function (event) {
        console.warn('Speech recognition error', event.error);
    };

    recognition.onend = function () {
        console.log('Stop speech recognition');
        show(chatSpeechStartButton);
        hide(chatSpeechStopButton);
        setColor(chatSpeechStopButton, 'white');
    };

    isWebkitSpeechRecognitionSupported = true;
    console.info('Browser supports webkitSpeechRecognition');
} else {
    console.warn('This browser not supports webkitSpeechRecognition');
}

function startSpeech(action) {
    if (action) {
        recognition.lang = browserLanguage;
        recognition.start();
    } else {
        recognition.stop();
    }
}

function execVoiceCommands(transcript) {
    switch (transcript.trim().toLowerCase()) {
        case commands.shareRoom:
            printCommand(commands.shareRoom);
            shareButton.click();
            break;
        case commands.hideMe:
            printCommand(commands.hideMe);
            hideMeButton.click();
            break;
        case commands.showMe:
            printCommand(commands.showMe);
            hideMeButton.click();
            break;
        case commands.newRoom:
            printCommand(commands.newRoom);
            openURL(browser.newroom);
            break;
        case commands.leaveRoom:
            printCommand(commands.leaveRoom);
            exitButton.click();
            break;
        case commands.audioOn:
            printCommand(commands.audioOn);
            startAudioButton.click();
            break;
        case commands.audioOff:
            printCommand(commands.audioOff);
            stopAudioButton.click();
            break;
        case commands.videoOn:
            printCommand(commands.videoOn);
            startVideoButton.click();
            break;
        case commands.videoOff:
            printCommand(commands.videoOff);
            stopVideoButton.click();
            break;
        case commands.screenOn:
            printCommand(commands.screenOn);
            startScreenButton.click();
            break;
        case commands.screenOff:
            printCommand(commands.screenOff);
            stopScreenButton.click();
            break;
        case commands.chatOn:
            printCommand(commands.chatOn);
            chatButton.click();
            break;
        case commands.chatSend:
            printCommand(commands.chatSend);
            chatSendButton.click();
            break;
        case commands.chatOff:
            printCommand(commands.chatOff);
            chatCloseButton.click();
            break;
        case commands.whiteboardOn:
            printCommand(commands.whiteboardOn);
            whiteboardButton.click();
            break;
        case commands.whiteboardOff:
            printCommand(commands.whiteboardOff);
            whiteboardCloseBtn.click();
            break;
        case commands.recordingOn:
            printCommand(commands.recordingOn);
            startRecButton.click();
            break;
        case commands.recordingPause:
            printCommand(commands.recordingPause);
            pauseRecButton.click();
            break;
        case commands.recordingResume:
            printCommand(commands.recordingResume);
            recordingResume.click();
            break;
        case commands.recordingOff:
            printCommand(commands.recordingOff);
            stopRecButton.click();
            break;
        case commands.settingsOn:
            printCommand(commands.settingsOn);
            settingsButton.click();
            break;
        case commands.settingsOff:
            printCommand(commands.settingsOff);
            mySettingsCloseBtn.click();
            break;
        case commands.participantsOn:
            printCommand(commands.participantsOn);
            participantsButton.click();
            break;
        case commands.participantsOff:
            printCommand(commands.participantsOff);
            participantsCloseBtn.click();
            break;
        case commands.participantsVideoOff:
            printCommand(commands.participantsVideoOff);
            rc.peerAction('me', rc.peer_id, 'hide', true, true);
            break;
        case commands.participantsAudioOff:
            printCommand(commands.participantsAudioOff);
            rc.peerAction('me', rc.peer_id, 'mute', true, true);
            break;
        case commands.participantsKickOut:
            printCommand(commands.participantsKickOut);
            rc.peerAction('me', rc.peer_id, 'eject', true, true);
            break;
        case commands.fileShareOn:
            printCommand(commands.fileShareOn);
            fileShareButton.click();
            break;
        case commands.fileShareOff:
            printCommand(commands.fileShareOff);
            sendAbortBtn.click();
            break;
        case commands.videoShareOn:
            printCommand(commands.videoShareOn);
            videoShareButton.click();
            break;
        case commands.videoShareOff:
            printCommand(commands.videoShareOff);
            videoCloseBtn.click();
            break;
        case commands.swapCamera:
            printCommand(commands.swapCamera);
            swapCameraButton.click();
            break;
        case commands.raiseHand:
            printCommand(commands.raiseHand);
            raiseHandButton.click();
            break;
        case commands.lowerHand:
            printCommand(commands.lowerHand);
            lowerHandButton.click();
            break;
        case commands.roomLock:
            printCommand(commands.roomLock);
            lockRoomButton.click();
            break;
        case commands.roomUnlock:
            printCommand(commands.roomUnlock);
            unlockRoomButton.click();
            break;
        case commands.about:
            printCommand(commands.about);
            aboutButton.click();
            break;
        case commands.email:
            printCommand(commands.email);
            openURL(browser.email, true);
            sound('open');
            break;
        case commands.google:
            printCommand(commands.google);
            openURL(browser.google, true);
            sound('open');
            break;
        case commands.googleTr:
            printCommand(commands.googleTr);
            openURL(browser.googleTr, true);
            sound('open');
            break;
        case commands.youtube:
            printCommand(commands.youtube);
            openURL(browser.youtube, true);
            sound('open');
            break;
        case commands.facebook:
            printCommand(commands.facebook);
            openURL(browser.facebook, true);
            sound('open');
            break;
        case commands.linkedin:
            printCommand(commands.linkedin);
            openURL(browser.linkedin, true);
            sound('open');
            break;
        case commands.twitter:
            printCommand(commands.twitter);
            openURL(browser.twitter, true);
            sound('open');
            break;
        case commands.tiktok:
            printCommand(commands.tiktok);
            openURL(browser.tiktok, true);
            sound('open');
            break;
        case commands.github:
            printCommand(commands.github);
            openURL(browser.github, true);
            sound('open');
            break;
        case commands.survey:
            printCommand(commands.survey);
            openURL(url.survey, true);
            sound('open');
            break;
        case commands.stopRecognition:
            printCommand(commands.stopRecognition);
            chatSpeechStopButton.click();
            break;
        // ...
    }
}

function printCommand(command) {
    console.log('Detected', { command: command });
}
