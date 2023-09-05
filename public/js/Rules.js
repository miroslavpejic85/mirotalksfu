'use-strict';

let isPresenter = false;

// ####################################################
// SHOW HIDE DESIRED BUTTONS BY RULES
// ####################################################

const isRulesActive = true;

const BUTTONS = {
    main: {
        shareButton: true,
        hideMeButton: true,
        startAudioButton: true,
        startVideoButton: true,
        startScreenButton: true,
        swapCameraButton: true,
        chatButton: true,
        participantsButton: true,
        whiteboardButton: true,
        settingsButton: true,
        aboutButton: true, // Please keep me always visible, thank you!
        exitButton: true,
    },
    settings: {
        lockRoomButton: true,
        unlockRoomButton: true,
        lobbyButton: true,
        tabRecording: true,
        pushToTalk: true,
    },
    producerVideo: {
        videoPictureInPicture: true,
        fullScreenButton: true,
        snapShotButton: true,
        muteAudioButton: true,
        videoPrivacyButton: true,
    },
    consumerVideo: {
        videoPictureInPicture: true,
        fullScreenButton: true,
        snapShotButton: true,
        sendMessageButton: true,
        sendFileButton: true,
        sendVideoButton: true,
        muteVideoButton: true,
        muteAudioButton: true,
        audioVolumeInput: true,
        ejectButton: true,
    },
    videoOff: {
        sendMessageButton: true,
        sendFileButton: true,
        sendVideoButton: true,
        muteAudioButton: true,
        audioVolumeInput: true,
        ejectButton: true,
    },
    chat: {
        chatMaxButton: true,
        chatSaveButton: true,
        chatEmojiButton: true,
        chatMarkdownButton: true,
        chatGPTButton: true,
        chatShareFileButton: true,
        chatSpeechStartButton: true,
    },
    participantsList: {
        saveInfoButton: true,
    },
    whiteboard: {
        whiteboardLockButton: false,
    },
    //...
};

function handleRules(isPresenter) {
    console.log('06.1 ----> IsPresenter: ' + isPresenter);
    if (!isRulesActive) return;
    if (!isPresenter) {
        BUTTONS.participantsList.saveInfoButton = false;
        BUTTONS.settings.lockRoomButton = false;
        BUTTONS.settings.unlockRoomButton = false;
        BUTTONS.settings.lobbyButton = false;
        BUTTONS.videoOff.muteAudioButton = false;
        BUTTONS.videoOff.ejectButton = false;
        BUTTONS.consumerVideo.ejectButton = false;
        BUTTONS.consumerVideo.muteAudioButton = false;
        BUTTONS.consumerVideo.muteVideoButton = false;
        BUTTONS.whiteboard.whiteboardLockButton = false;
        //...
    } else {
        BUTTONS.participantsList.saveInfoButton = true;
        BUTTONS.settings.lockRoomButton = !isRoomLocked;
        BUTTONS.settings.unlockRoomButton = isRoomLocked;
        BUTTONS.settings.lobbyButton = true;
        BUTTONS.videoOff.muteAudioButton = true;
        BUTTONS.videoOff.ejectButton = true;
        BUTTONS.consumerVideo.ejectButton = true;
        BUTTONS.consumerVideo.muteAudioButton = true;
        BUTTONS.consumerVideo.muteVideoButton = true;
        BUTTONS.whiteboard.whiteboardLockButton = true;
        //...
        isLobbyEnabled = lsSettings.lobby;
        switchLobby.checked = isLobbyEnabled;
        rc.roomAction(isLobbyEnabled ? 'lobbyOn' : 'lobbyOff', true, false);
        //...
    }
    // main. settings...
    BUTTONS.settings.lockRoomButton ? show(lockRoomButton) : hide(lockRoomButton);
    BUTTONS.settings.unlockRoomButton ? show(unlockRoomButton) : hide(unlockRoomButton);
    BUTTONS.settings.lobbyButton ? show(lobbyButton) : hide(lobbyButton);
    BUTTONS.participantsList.saveInfoButton ? show(participantsSaveBtn) : hide(participantsSaveBtn);
    BUTTONS.whiteboard.whiteboardLockButton
        ? elemDisplay(whiteboardLockButton, true)
        : elemDisplay(whiteboardLockButton, false, 'flex');
    //...
}
