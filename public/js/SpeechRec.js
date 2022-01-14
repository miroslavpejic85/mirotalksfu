'use strict';

let isWebkitSpeechRecognitionSupported = false;
let isVoiceCommandsEnabled = true;
let recognition;

const commands = {
    shareRoom: 'room',
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
    participantsRefresh: 'refresh the participants',
    participantsOff: 'hide the participants',
    fileShareOn: 'open the file',
    fileShareOff: 'close the file',
    youtubeOn: 'open the YouTube',
    youtubeOff: 'close the YouTube',
    swapCamera: 'swap the camera',
    raiseHand: 'raise the hand',
    lowerHand: 'lower the hand',
    roomLock: 'lock the room',
    roomUnlock: 'unlock the room',
    about: 'show the about',
};

if ('webkitSpeechRecognition' in window) {
    recognition = new webkitSpeechRecognition();

    recognition.maxAlternatives = 1;
    recognition.continuous = true;

    console.log('Speech recognition', recognition);

    recognition.onstart = function () {
        console.log('Start speech recognition');
        hide(chatSpeechStartButton);
        show(chatSpeechStopButton);
    };

    recognition.onresult = (e) => {
        let current = e.resultIndex;
        let transcript = e.results[current][0].transcript;

        if (transcript != commands.chatSend) {
            chatMessage.value = transcript;
        }

        if (isVoiceCommandsEnabled) {
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
    };

    isWebkitSpeechRecognitionSupported = true;
    console.info('Browser supports webkitSpeechRecognition');
} else {
    console.warn('This browser not supports webkitSpeechRecognition');
}

function startSpeech(action) {
    if (action) {
        recognition.start();
    } else {
        recognition.stop();
    }
}

function execVoiceCommands(transcript) {
    switch (transcript.trim()) {
        case commands.shareRoom:
            console.log('Comand detected', commands.shareRoom);
            shareButton.click();
            break;
        case commands.leaveRoom:
            console.log('Comand detected', commands.leaveRoom);
            exitButton.click();
            break;
        case commands.audioOn:
            console.log('Comand detected', commands.audioOn);
            startAudioButton.click();
            break;
        case commands.audioOff:
            console.log('Comand detected', commands.audioOff);
            stopAudioButton.click();
            break;
        case commands.videoOn:
            console.log('Comand detected', commands.videoOn);
            startVideoButton.click();
            break;
        case commands.videoOff:
            console.log('Comand detected', commands.videoOff);
            stopVideoButton.click();
            break;
        case commands.screenOn:
            console.log('Comand detected', commands.screenOn);
            startScreenButton.click();
            break;
        case commands.screenOff:
            console.log('Comand detected', commands.screenOff);
            stopScreenButton.click();
            break;
        case commands.chatOn:
            console.log('Comand detected', commands.chatOn);
            chatButton.click();
            break;
        case commands.chatSend:
            console.log('Comand detected', commands.chatSend);
            chatSendButton.click();
            break;
        case commands.chatOff:
            console.log('Comand detected', commands.chatOff);
            chatCloseButton.click();
            break;
        case commands.whiteboardOn:
            console.log('Comand detected', commands.whiteboardOn);
            whiteboardButton.click();
            break;
        case commands.whiteboardOff:
            console.log('Comand detected', commands.whiteboardOff);
            whiteboardCloseBtn.click();
            break;
        case commands.recordingOn:
            console.log('Comand detected', commands.recordingOn);
            startRecButton.click();
            break;
        case commands.recordingPause:
            console.log('Comand detected', commands.recordingPause);
            pauseRecButton.click();
            break;
        case commands.recordingResume:
            console.log('Comand detected', commands.recordingResume);
            recordingResume.click();
            break;
        case commands.recordingOff:
            console.log('Comand detected', commands.recordingOff);
            stopRecButton.click();
            break;
        case commands.settingsOn:
            console.log('Comand detected', commands.settingsOn);
            settingsButton.click();
            break;
        case commands.settingsOff:
            console.log('Comand detected', commands.settingsOff);
            mySettingsCloseBtn.click();
            break;
        case commands.participantsOn:
            console.log('Comand detected', commands.participantsOn);
            participantsButton.click();
            break;
        case commands.participantsRefresh:
            console.log('Comand detected', commands.participantsRefresh);
            participantsRefreshBtn.click();
            break;
        case commands.participantsOff:
            console.log('Comand detected', commands.participantsOff);
            participantsCloseBtn.click();
            break;
        case commands.fileShareOn:
            console.log('Comand detected', commands.fileShareOn);
            fileShareButton.click();
            break;
        case commands.fileShareOff:
            console.log('Comand detected', commands.fileShareOff);
            sendAbortBtn.click();
            break;
        case commands.youtubeOn:
            console.log('Comand detected', commands.youtubeOn);
            youTubeShareButton.click();
            break;
        case commands.youtubeOff:
            console.log('Comand detected', commands.youtubeOff);
            youTubeCloseBtn.click();
            break;
        case commands.swapCamera:
            console.log('Comand detected', commands.swapCamera);
            swapCameraButton.click();
            break;
        case commands.raiseHand:
            console.log('Comand detected', commands.raiseHand);
            raiseHandButton.click();
            break;
        case commands.lowerHand:
            console.log('Comand detected', commands.lowerHand);
            lowerHandButton.click();
            break;
        case commands.roomLock:
            console.log('Comand detected', commands.roomLock);
            lockRoomButton.click();
            break;
        case commands.roomUnlock:
            console.log('Comand detected', commands.roomUnlock);
            unlockRoomButton.click();
            break;
        case commands.about:
            console.log('Comand detected', commands.about);
            aboutButton.click();
            break;
        // ...
    }
}
