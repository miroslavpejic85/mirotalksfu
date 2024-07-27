'use strict';

let isPresenter = false;

// ####################################################
// SHOW HIDE DESIRED BUTTONS BY RULES
// ####################################################

const isRulesActive = true;

/**
 * WARNING!
 * This will be replaced by the ui.buttons specified in the server configuration file located at app/src/config.js.
 * Ensure that any changes made here are also reflected in the configuration file to maintain synchronization.
 */
let BUTTONS = {
    main: {
        shareButton: true, // for quest, presenter default true
        hideMeButton: true,
        startAudioButton: true,
        startVideoButton: true,
        startScreenButton: true,
        swapCameraButton: true,
        chatButton: true,
        pollButton: true,
        raiseHandButton: true,
        transcriptionButton: true,
        whiteboardButton: true,
        emojiRoomButton: true,
        settingsButton: true,
        aboutButton: true, // Please keep me always visible, thank you!
        exitButton: true,
    },
    settings: {
        fileSharing: true,
        lockRoomButton: true, // presenter
        unlockRoomButton: true, // presenter
        broadcastingButton: true, // presenter
        lobbyButton: true, // presenter
        sendEmailInvitation: true, // presenter
        micOptionsButton: true, // presenter
        tabRTMPStreamingBtn: true, // presenter
        tabModerator: true, // presenter
        tabRecording: true,
        host_only_recording: true, // presenter
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
        audioVolumeInput: true, // Disabled for mobile
        geolocationButton: true, // Presenter
        banButton: true, // presenter
        ejectButton: true, // presenter
    },
    videoOff: {
        sendMessageButton: true,
        sendFileButton: true,
        sendVideoButton: true,
        muteAudioButton: true,
        audioVolumeInput: true, // Disabled for mobile
        geolocationButton: true, // Presenter
        banButton: true, // presenter
        ejectButton: true, // presenter
    },
    chat: {
        chatPinButton: true,
        chatMaxButton: true,
        chatSaveButton: true,
        chatEmojiButton: true,
        chatMarkdownButton: true,
        chatSpeechStartButton: true,
        chatGPT: true,
    },
    poll: {
        pollPinButton: true,
        pollMaxButton: true,
        pollSaveButton: true,
    },
    participantsList: {
        saveInfoButton: true, // presenter
        sendFileAllButton: true, // presenter
        ejectAllButton: true, // presenter
        sendFileButton: false, // presenter & guests
        geoLocationButton: true, // presenter
        banButton: true, // presenter
        ejectButton: true, // presenter
    },
    whiteboard: {
        whiteboardLockButton: true, // presenter
    },
    //...
};

function handleRules(isPresenter) {
    console.log('07.1 ----> IsPresenter: ' + isPresenter);
    if (!isRulesActive) return;
    if (!isPresenter) {
        // ##################################
        // GUEST
        // ##################################
        //BUTTONS.main.shareButton = false;
        BUTTONS.participantsList.saveInfoButton = false;
        BUTTONS.settings.lockRoomButton = false;
        BUTTONS.settings.unlockRoomButton = false;
        BUTTONS.settings.broadcastingButton = false;
        BUTTONS.settings.lobbyButton = false;
        BUTTONS.settings.sendEmailInvitation = false;
        BUTTONS.settings.micOptionsButton = false;
        BUTTONS.settings.tabRTMPStreamingBtn = false;
        BUTTONS.settings.tabModerator = false;
        BUTTONS.videoOff.muteAudioButton = false;
        BUTTONS.videoOff.geolocationButton = false;
        BUTTONS.videoOff.banButton = false;
        BUTTONS.videoOff.ejectButton = false;
        BUTTONS.consumerVideo.geolocationButton = false;
        BUTTONS.consumerVideo.banButton = false;
        BUTTONS.consumerVideo.ejectButton = false;
        //BUTTONS.consumerVideo.muteAudioButton = false;
        //BUTTONS.consumerVideo.muteVideoButton = false;
        BUTTONS.whiteboard.whiteboardLockButton = false;
        //...
    } else {
        // ##################################
        // PRESENTER
        // ##################################
        BUTTONS.main.shareButton = true;
        BUTTONS.settings.tabRTMPStreamingBtn = true;
        BUTTONS.settings.lockRoomButton = BUTTONS.settings.lockRoomButton && !isRoomLocked;
        BUTTONS.settings.unlockRoomButton = BUTTONS.settings.lockRoomButton && isRoomLocked;
        BUTTONS.settings.sendEmailInvitation = true;
        //...

        // ##################################
        // Auto detected rules for presenter
        // ##################################

        // Room broadcasting
        isBroadcastingEnabled = localStorageSettings.broadcasting;
        switchBroadcasting.checked = isBroadcastingEnabled;
        rc.roomAction('broadcasting', true, false);
        if (isBroadcastingEnabled) rc.toggleRoomBroadcasting();
        // Room lobby
        isLobbyEnabled = localStorageSettings.lobby;
        switchLobby.checked = isLobbyEnabled;
        rc.roomAction(isLobbyEnabled ? 'lobbyOn' : 'lobbyOff', true, false);
        // Room host-only-recording
        hostOnlyRecording = localStorageSettings.host_only_recording;
        switchHostOnlyRecording.checked = hostOnlyRecording;
        rc.roomAction(hostOnlyRecording ? 'hostOnlyRecordingOn' : 'hostOnlyRecordingOff', true, false);
        // Room moderator
        switchEveryonePrivacy.checked = localStorageSettings.moderator_video_start_privacy;
        switchEveryoneMute.checked = localStorageSettings.moderator_audio_start_muted;
        switchEveryoneHidden.checked = localStorageSettings.moderator_video_start_hidden;
        switchEveryoneCantUnmute.checked = localStorageSettings.moderator_audio_cant_unmute;
        switchEveryoneCantUnhide.checked = localStorageSettings.moderator_video_cant_unhide;
        switchEveryoneCantShareScreen.checked = localStorageSettings.moderator_screen_cant_share;
        switchEveryoneCantChatPrivately.checked = localStorageSettings.moderator_chat_cant_privately;
        switchEveryoneCantChatChatGPT.checked = localStorageSettings.moderator_chat_cant_chatgpt;
        switchDisconnectAllOnLeave.checked = localStorageSettings.moderator_disconnect_all_on_leave;

        // Update moderator settings...
        const moderatorData = {
            video_start_privacy: switchEveryonePrivacy.checked,
            audio_start_muted: switchEveryoneMute.checked,
            video_start_hidden: switchEveryoneHidden.checked,
            audio_cant_unmute: switchEveryoneCantUnmute.checked,
            video_cant_unhide: switchEveryoneCantUnhide.checked,
            screen_cant_share: switchEveryoneCantShareScreen.checked,
            chat_cant_privately: switchEveryoneCantChatPrivately.checked,
            chat_cant_chatgpt: switchEveryoneCantChatChatGPT.checked,
        };
        console.log('Rules moderator data ---->', moderatorData);
        rc.updateRoomModeratorALL(moderatorData);
    }
    // main. settings...
    BUTTONS.main.shareButton ? show(shareButton) : hide(shareButton);
    if (BUTTONS.settings.tabRTMPStreamingBtn) {
        show(tabRTMPStreamingBtn);
        show(startRtmpButton);
        show(startRtmpURLButton);
        show(streamerRtmpButton);
    } else {
        hide(tabRTMPStreamingBtn);
    }
    BUTTONS.settings.lockRoomButton ? show(lockRoomButton) : hide(lockRoomButton);
    BUTTONS.settings.unlockRoomButton ? show(unlockRoomButton) : hide(unlockRoomButton);
    BUTTONS.settings.broadcastingButton ? show(broadcastingButton) : hide(broadcastingButton);
    BUTTONS.settings.lobbyButton ? show(lobbyButton) : hide(lobbyButton);
    BUTTONS.settings.sendEmailInvitation ? show(sendEmailInvitation) : hide(sendEmailInvitation);
    !BUTTONS.settings.micOptionsButton && hide(micOptionsButton);
    !BUTTONS.settings.tabModerator && hide(tabModeratorBtn);
    if (BUTTONS.settings.host_only_recording) {
        show(recordingImage);
        show(roomRecordingOptions);
        show(roomHostOnlyRecording);
    } else {
        show(recordingImage);
        show(roomRecordingOptions);
        hide(roomHostOnlyRecording);
    }
    BUTTONS.participantsList.saveInfoButton ? show(participantsSaveBtn) : hide(participantsSaveBtn);
    BUTTONS.whiteboard.whiteboardLockButton ? show(whiteboardUnlockBtn) : hide(whiteboardUnlockBtn);
    //...
}

function handleRulesBroadcasting() {
    console.log('07.2 ----> handleRulesBroadcasting');
    BUTTONS.main.shareButton = false;
    BUTTONS.main.hideMeButton = false;
    BUTTONS.main.startAudioButton = false;
    BUTTONS.main.startVideoButton = false;
    BUTTONS.main.startScreenButton = false;
    BUTTONS.main.swapCameraButton = false;
    //BUTTONS.main.raiseHandButton = false;
    BUTTONS.main.whiteboardButton = false;
    //BUTTONS.main.emojiRoomButton = false,
    //BUTTONS.main.pollButton = false;
    BUTTONS.main.transcriptionButton = false;
    BUTTONS.main.settingsButton = false;
    BUTTONS.participantsList.saveInfoButton = false;
    BUTTONS.settings.lockRoomButton = false;
    BUTTONS.settings.unlockRoomButton = false;
    BUTTONS.settings.lobbyButton = false;
    BUTTONS.settings.tabRTMPStreamingBtn = false;
    BUTTONS.videoOff.muteAudioButton = false;
    BUTTONS.videoOff.geolocationButton = false;
    BUTTONS.videoOff.banButton = false;
    BUTTONS.videoOff.ejectButton = false;
    BUTTONS.consumerVideo.sendMessageButton = false;
    BUTTONS.consumerVideo.sendFileButton = false;
    BUTTONS.consumerVideo.sendVideoButton = false;
    BUTTONS.consumerVideo.geolocationButton = false;
    BUTTONS.consumerVideo.banButton = false;
    BUTTONS.consumerVideo.ejectButton = false;
    BUTTONS.consumerVideo.muteAudioButton = false;
    BUTTONS.consumerVideo.muteVideoButton = false;
    BUTTONS.whiteboard.whiteboardLockButton = false;
    //...
    elemDisplay('shareButton', false);
    elemDisplay('hideMeButton', false);
    elemDisplay('startAudioButton', false);
    elemDisplay('stopAudioButton', false);
    elemDisplay('startVideoButton', false);
    elemDisplay('stopVideoButton', false);
    elemDisplay('startScreenButton', false);
    elemDisplay('stopScreenButton', false);
    elemDisplay('swapCameraButton', false);
    //elemDisplay('raiseHandButton', false);
    elemDisplay('whiteboardButton', false);
    //elemDisplay('emojiRoomButton', false);
    //elemDisplay('pollButton', false);
    elemDisplay('transcriptionButton', false);
    elemDisplay('lockRoomButton', false);
    elemDisplay('unlockRoomButton', false);
    elemDisplay('lobbyButton', false);
    elemDisplay('settingsButton', false);
    elemDisplay('tabRTMPStreamingBtn', false);
    //...
}
