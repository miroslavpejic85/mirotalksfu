'use strict';

let isWebkitSpeechRecognitionSupported = false;
let recognition;
let isVoiceCommandsEnabled = true;
let browserLanguage = navigator.language || navigator.userLanguage;
let isVoiceCommandSupported = browserLanguage.includes('en-') || browserLanguage.includes('bn-');
let currentLanguage = 'en';
let currentLangCode = 'en-US';

const speechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

/**
 * Enable real-time voice recognition in the chat, allowing you to execute commands using your voice.
 * Note: Currently, it supports only the English and Bangla language.
 * TODO add more languages...
 */
const languageHandlers = {
    en: {
        langCode: 'en-US',
        commands: {
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
            pollOn: 'open the poll',
            pollOff: 'close the poll',
            editorOn: 'open the editor',
            editorOff: 'close the editor',
            toggleTr: 'toggle transcription',
            whiteboardOn: 'open the whiteboard',
            whiteboardOff: 'close the whiteboard',
            snapshotRoom: 'Snapshot room',
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
            recognizeBangla: 'recognise bangla',
            stopRecognition: 'stop the voice recognition',
        },
    },
    bn: {
        langCode: 'bn-BD',
        commands: {
            shareRoom: 'রুম শেয়ার করো',
            hideMe: 'আমাকে লুকাও',
            showMe: 'আমাকে দেখাও',
            newRoom: 'নতুন রুম',
            leaveRoom: 'রুম থেকে বের হও',
            audioOn: 'অডিও চালু করো',
            audioOff: 'অডিও বন্ধ করো',
            videoOn: 'ভিডিও চালু করো',
            videoOff: 'ভিডিও বন্ধ করো',
            screenOn: 'স্ক্রিন চালু করো',
            screenOff: 'স্ক্রিন বন্ধ করো',
            chatOn: 'চ্যাট খুলো',
            chatSend: 'পাঠাও',
            chatOff: 'চ্যাট বন্ধ করো',
            pollOn: 'পোল খুলো',
            pollOff: 'পোল বন্ধ করো',
            editorOn: 'এডিটর খুলো',
            editorOff: 'এডিটর বন্ধ করো',
            toggleTr: 'ট্রান্সক্রিপশন চালু/বন্ধ করো',
            whiteboardOn: 'হোয়াইটবোর্ড খুলো',
            whiteboardOff: 'হোয়াইটবোর্ড বন্ধ করো',
            snapshotRoom: 'রুমের ছবি তুলো',
            recordingOn: 'রেকর্ডিং শুরু করো',
            recordingPause: 'রেকর্ডিং বিরতি দাও',
            recordingResume: 'রেকর্ডিং আবার শুরু করো',
            recordingOff: 'রেকর্ডিং বন্ধ করো',
            settingsOn: 'সেটিংস খুলো',
            settingsOff: 'সেটিংস বন্ধ করো',
            participantsOn: 'অংশগ্রহণকারীদের দেখাও',
            participantsOff: 'অংশগ্রহণকারীদের লুকাও',
            participantsVideoOff: 'অংশগ্রহণকারীদের ভিডিও বন্ধ করো',
            participantsAudioOff: 'অংশগ্রহণকারীদের অডিও বন্ধ করো',
            participantsKickOut: 'অংশগ্রহণকারীদের বের করে দাও',
            fileShareOn: 'ফাইল খুলো',
            fileShareOff: 'ফাইল বন্ধ করো',
            videoShareOn: 'ভিডিও শেয়ার করো',
            videoShareOff: 'ভিডিও বন্ধ করো',
            swapCamera: 'ক্যামেরা পরিবর্তন করো',
            raiseHand: 'হাত তুলো',
            lowerHand: 'হাত নামাও',
            roomLock: 'রুম লক করো',
            roomUnlock: 'রুম আনলক করো',
            about: 'সম্পর্কিত দেখাও',
            email: 'ইমেইল খুলো',
            google: 'গুগল খুলো',
            googleTr: 'গুগল অনুবাদ খুলো',
            youtube: 'ইউটিউব খুলো',
            facebook: 'ফেসবুক খুলো',
            linkedin: 'লিঙ্কডইন খুলো',
            twitter: 'টুইটার খুলো',
            tiktok: 'টিকটক খুলো',
            github: 'গিটহাব খুলো',
            survey: 'সার্ভে খুলো',
            recognizeEnglish: 'ইংরেজিতে করো',
            stopRecognition: 'ভয়েস রিকগনিশন বন্ধ করো',
        },
    }
}

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
    setRecognitionLanguage(recognition, currentLangCode);

    console.log('Speech recognition', recognition);

    recognition.onstart = function () {
        console.log('Speech recognition started');
        hide(chatSpeechStartButton);
        show(chatSpeechStopButton);
        setColor(chatSpeechStopButton, 'lime');
        userLog('info', 'Speech recognition started', 'top-end');
    };

    recognition.onresult = (e) => {
        let current = e.resultIndex;
        let transcript = e.results[current][0].transcript;
        if (transcript) {
            if (transcript.trim().toLowerCase() != languageHandlers[currentLanguage].commands.chatSend) {
                chatMessage.value = transcript;
            }
            if (isVoiceCommandsEnabled && isVoiceCommandSupported) {
                execVoiceCommands(transcript);
            }
        }
    };

    recognition.onerror = function (event) {
        console.error('Speech recognition error', event.error);
        userLog('error', `Speech recognition error ${event.error}`, 'top-end', 6000);
    };

    recognition.onend = function () {
        console.log('Speech recognition stopped');
        show(chatSpeechStartButton);
        hide(chatSpeechStopButton);
        setColor(chatSpeechStopButton, 'white');
        userLog('info', 'Speech recognition stopped', 'top-end');
    };

    isWebkitSpeechRecognitionSupported = true;
    console.info('Browser supports webkitSpeechRecognition');
} else {
    console.warn('This browser not supports webkitSpeechRecognition');
}

function setRecognitionLanguage(recognition, languageCode) {
    if (!recognition) {
        console.error('Recognition object is not defined.');
        return;
    }
    recognition.lang = languageCode;
    console.log(`Voice recognition language set to: ${languageCode}`);
}

function startSpeech() {
    if(currentLanguage === 'bn') recognition.lang = 'bn-BD';
    else recognition.lang = 'en-US';
    recognition.start();
}

function stopSpeech() {
    recognition.stop();
}

function execVoiceCommands(transcript) {
    switch (transcript.trim().toLowerCase()) {
        case languageHandlers[currentLanguage].commands.shareRoom:
            printCommand(languageHandlers[currentLanguage].commands.shareRoom);
            shareButton.click();
            break;
        case languageHandlers[currentLanguage].commands.hideMe:
            printCommand(languageHandlers[currentLanguage].commands.hideMe);
            hideMeButton.click();
            break;
        case languageHandlers[currentLanguage].commands.showMe:
            printCommand(languageHandlers[currentLanguage].commands.showMe);
            hideMeButton.click();
            break;
        case languageHandlers[currentLanguage].commands.newRoom:
            printCommand(languageHandlers[currentLanguage].commands.newRoom);
            openURL(browser.newroom);
            break;
        case languageHandlers[currentLanguage].commands.leaveRoom:
            printCommand(languageHandlers[currentLanguage].commands.leaveRoom);
            exitButton.click();
            break;
        case languageHandlers[currentLanguage].commands.audioOn:
            printCommand(languageHandlers[currentLanguage].commands.audioOn);
            startAudioButton.click();
            break;
        case languageHandlers[currentLanguage].commands.audioOff:
            printCommand(languageHandlers[currentLanguage].commands.audioOff);
            stopAudioButton.click();
            break;
        case languageHandlers[currentLanguage].commands.videoOn:
            printCommand(languageHandlers[currentLanguage].commands.videoOn);
            startVideoButton.click();
            break;
        case languageHandlers[currentLanguage].commands.videoOff:
            printCommand(languageHandlers[currentLanguage].commands.videoOff);
            stopVideoButton.click();
            break;
        case languageHandlers[currentLanguage].commands.screenOn:
            printCommand(languageHandlers[currentLanguage].commands.screenOn);
            startScreenButton.click();
            break;
        case languageHandlers[currentLanguage].commands.screenOff:
            printCommand(languageHandlers[currentLanguage].commands.screenOff);
            stopScreenButton.click();
            break;
        case languageHandlers[currentLanguage].commands.chatOn:
            printCommand(languageHandlers[currentLanguage].commands.chatOn);
            chatButton.click();
            break;
        case languageHandlers[currentLanguage].commands.pollOn:
            printCommand(languageHandlers[currentLanguage].commands.pollOn);
            pollButton.click();
            break;
        case languageHandlers[currentLanguage].commands.pollOff:
            printCommand(languageHandlers[currentLanguage].commands.pollOff);
            pollCloseBtn.click();
            break;
        case languageHandlers[currentLanguage].commands.editorOn:
            printCommand(languageHandlers[currentLanguage].commands.editorOn);
            editorButton.click();
            break;
        case languageHandlers[currentLanguage].commands.editorOff:
            printCommand(languageHandlers[currentLanguage].commands.editorOff);
            editorCloseBtn.click();
            break;
        case languageHandlers[currentLanguage].commands.chatSend:
            printCommand(languageHandlers[currentLanguage].commands.chatSend);
            chatSendButton.click();
            break;
        case languageHandlers[currentLanguage].commands.chatOff:
            printCommand(languageHandlers[currentLanguage].commands.chatOff);
            chatCloseButton.click();
            break;
        case languageHandlers[currentLanguage].commands.toggleTr:
            transcriptionButton.click();
            break;
        case languageHandlers[currentLanguage].commands.whiteboardOn:
            printCommand(languageHandlers[currentLanguage].commands.whiteboardOn);
            whiteboardButton.click();
            break;
        case languageHandlers[currentLanguage].commands.whiteboardOff:
            printCommand(languageHandlers[currentLanguage].commands.whiteboardOff);
            whiteboardCloseBtn.click();
            break;
        case languageHandlers[currentLanguage].commands.snapshotRoom:
            printCommand(languageHandlers[currentLanguage].commands.snapshotRoom);
            snapshotRoomButton.click();
            break;
        case languageHandlers[currentLanguage].commands.recordingOn:
            printCommand(languageHandlers[currentLanguage].commands.recordingOn);
            startRecButton.click();
            break;
        case languageHandlers[currentLanguage].commands.recordingPause:
            printCommand(languageHandlers[currentLanguage].commands.recordingPause);
            pauseRecButton.click();
            break;
        case languageHandlers[currentLanguage].commands.recordingResume:
            printCommand(languageHandlers[currentLanguage].commands.recordingResume);
            recordingResume.click();
            break;
        case languageHandlers[currentLanguage].commands.recordingOff:
            printCommand(languageHandlers[currentLanguage].commands.recordingOff);
            stopRecButton.click();
            break;
        case languageHandlers[currentLanguage].commands.settingsOn:
            printCommand(languageHandlers[currentLanguage].commands.settingsOn);
            settingsButton.click();
            break;
        case languageHandlers[currentLanguage].commands.settingsOff:
            printCommand(languageHandlers[currentLanguage].commands.settingsOff);
            mySettingsCloseBtn.click();
            break;
        case languageHandlers[currentLanguage].commands.participantsOn:
            printCommand(languageHandlers[currentLanguage].commands.participantsOn);
            chatButton.click();
            break;
        case languageHandlers[currentLanguage].commands.participantsOff:
            printCommand(languageHandlers[currentLanguage].commands.participantsOff);
            chatCloseButton.click();
            break;
        case languageHandlers[currentLanguage].commands.participantsVideoOff:
            printCommand(languageHandlers[currentLanguage].commands.participantsVideoOff);
            rc.peerAction('me', socket.id, 'hide', true, true);
            break;
        case languageHandlers[currentLanguage].commands.participantsAudioOff:
            printCommand(languageHandlers[currentLanguage].commands.participantsAudioOff);
            rc.peerAction('me', socket.id, 'mute', true, true);
            break;
        case languageHandlers[currentLanguage].commands.participantsKickOut:
            printCommand(languageHandlers[currentLanguage].commands.participantsKickOut);
            rc.peerAction('me', socket.id, 'eject', true, true);
            break;
        case languageHandlers[currentLanguage].commands.fileShareOn:
            printCommand(languageHandlers[currentLanguage].commands.fileShareOn);
            fileShareButton.click();
            break;
        case languageHandlers[currentLanguage].commands.fileShareOff:
            printCommand(languageHandlers[currentLanguage].commands.fileShareOff);
            sendAbortBtn.click();
            break;
        case languageHandlers[currentLanguage].commands.videoShareOn:
            printCommand(languageHandlers[currentLanguage].commands.videoShareOn);
            videoShareButton.click();
            break;
        case languageHandlers[currentLanguage].commands.videoShareOff:
            printCommand(languageHandlers[currentLanguage].commands.videoShareOff);
            videoCloseBtn.click();
            break;
        case languageHandlers[currentLanguage].commands.swapCamera:
            printCommand(languageHandlers[currentLanguage].commands.swapCamera);
            swapCameraButton.click();
            break;
        case languageHandlers[currentLanguage].commands.raiseHand:
            printCommand(languageHandlers[currentLanguage].commands.raiseHand);
            raiseHandButton.click();
            break;
        case languageHandlers[currentLanguage].commands.lowerHand:
            printCommand(languageHandlers[currentLanguage].commands.lowerHand);
            lowerHandButton.click();
            break;
        case languageHandlers[currentLanguage].commands.roomLock:
            printCommand(languageHandlers[currentLanguage].commands.roomLock);
            lockRoomButton.click();
            break;
        case languageHandlers[currentLanguage].commands.roomUnlock:
            printCommand(languageHandlers[currentLanguage].commands.roomUnlock);
            unlockRoomButton.click();
            break;
        case languageHandlers[currentLanguage].commands.about:
            printCommand(languageHandlers[currentLanguage].commands.about);
            aboutButton.click();
            break;
        case languageHandlers[currentLanguage].commands.email:
            printCommand(languageHandlers[currentLanguage].commands.email);
            openURL(browser.email, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.google:
            printCommand(languageHandlers[currentLanguage].commands.google);
            openURL(browser.google, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.googleTr:
            printCommand(languageHandlers[currentLanguage].commands.googleTr);
            openURL(browser.googleTr, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.youtube:
            printCommand(languageHandlers[currentLanguage].commands.youtube);
            openURL(browser.youtube, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.facebook:
            printCommand(languageHandlers[currentLanguage].commands.facebook);
            openURL(browser.facebook, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.linkedin:
            printCommand(languageHandlers[currentLanguage].commands.linkedin);
            openURL(browser.linkedin, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.twitter:
            printCommand(languageHandlers[currentLanguage].commands.twitter);
            openURL(browser.twitter, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.tiktok:
            printCommand(languageHandlers[currentLanguage].commands.tiktok);
            openURL(browser.tiktok, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.github:
            printCommand(languageHandlers[currentLanguage].commands.github);
            openURL(browser.github, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.survey:
            printCommand(languageHandlers[currentLanguage].commands.survey);
            survey.enabled && openURL(survey.url, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.recognizeBangla:
            printCommand(languageHandlers[currentLanguage].commands.recognizeBangla);
            currentLanguage = 'bn'; 
            setRecognitionLanguage(recognition, languageHandlers[currentLanguage].langCode);
            recognition.stop(); 
            setTimeout(() => recognition.start(), 300); 
            break;
        case languageHandlers[currentLanguage].commands.recognizeEnglish:
            printCommand(languageHandlers[currentLanguage].commands.recognizeBangla);
            currentLanguage = 'en'; 
            setRecognitionLanguage(recognition, languageHandlers[currentLanguage].langCode);
            recognition.stop(); 
            setTimeout(() => recognition.start(), 300); 
            break;
        case languageHandlers[currentLanguage].commands.stopRecognition:
            printCommand(languageHandlers[currentLanguage].commands.stopRecognition);
            chatSpeechStopButton.click();
            break;
        // ...
        default:
            break;
    }
}

function printCommand(command) {
    console.log('Detected', { command: command });
}
