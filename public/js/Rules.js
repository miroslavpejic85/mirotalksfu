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
    popup: {
        shareRoomPopup: true,
        shareRoomQrOnHover: true,
    },
    main: {
        shareButton: true, // for quest, presenter default true
        hideMeButton: true,
        fullScreenButton: true,
        startAudioButton: true,
        startVideoButton: true,
        startScreenButton: true,
        swapCameraButton: true,
        chatButton: true,
        participantsButton: true,
        pollButton: true,
        speechRecButton: true,
        breakoutRoomButton: true, // if presenter and if true
        editorButton: true,
        raiseHandButton: true,
        transcriptionButton: true,
        whiteboardButton: true,
        documentPiPButton: true,
        snapshotRoomButton: true,
        emojiRoomButton: true,
        settingsButton: true,
        aboutButton: true, // Please keep me always visible, thank you!
        exitButton: true,
        extraButton: true,
    },
    settings: {
        activeRooms: true,
        fileSharing: true,
        lockRoomButton: true, // presenter
        unlockRoomButton: true, // presenter
        broadcastingButton: true, // presenter
        lobbyButton: true, // presenter
        joinLockButton: true, // presenter
        sendEmailInvitation: true, // presenter
        micOptionsButton: true,
        tabRTMPStreamingBtn: true, // presenter
        tabNotificationsBtn: true, // presenter
        tabModerator: true, // presenter
        tabRecording: true,
        host_only_recording: true, // presenter
        pushToTalk: true,
        keyboardShortcuts: true,
        virtualBackground: true,
        customNoiseSuppression: true, // use RNNoise else WebRTC built-in
    },
    producerVideo: {
        videoPictureInPicture: true,
        videoMirrorButton: true,
        fullScreenButton: true,
        snapShotButton: true,
        focusVideoButton: true,
        muteAudioButton: true,
        videoPrivacyButton: true,
        audioVolumeInput: true,
        drawingButton: true,
    },
    consumerVideo: {
        videoPictureInPicture: true,
        videoMirrorButton: true,
        fullScreenButton: true,
        snapShotButton: true,
        focusVideoButton: true,
        sendMessageButton: true,
        sendFileButton: true,
        sendVideoButton: true,
        muteVideoButton: true,
        muteAudioButton: true,
        audioVolumeInput: true,
        geolocationButton: true, // Presenter
        banButton: true, // presenter
        ejectButton: true, // presenter
        presenterRoleButton: true, // presenter
        drawingButton: true, // presenter
    },
    videoOff: {
        sendMessageButton: true,
        sendFileButton: true,
        sendVideoButton: true,
        muteAudioButton: true,
        audioVolumeInput: true,
        geolocationButton: true, // Presenter
        banButton: true, // presenter
        ejectButton: true, // presenter
        presenterRoleButton: true, // presenter
    },
    chat: {
        chatPinButton: true,
        chatMaxButton: true,
        chatSaveButton: true,
        chatEmojiButton: true,
        chatMarkdownButton: true,
        chatSpeechStartButton: true,
        chatGPT: true,
        deepSeek: true,
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
        sendFileButton: true, // presenter & guests
        geoLocationButton: true, // presenter
        banButton: true, // presenter
        ejectButton: true, // presenter
        presenterRoleButton: true, // presenter
    },
    whiteboard: {
        whiteboardLockButton: true, // presenter
    },
    //...
};

// Baseline snapshot of the server-merged BUTTONS config, used to restore state on role changes
let buttonsBaseline = null;

function handleRules(isPresenter, roomSetup = true) {
    console.log('07.1 ----> IsPresenter: ' + isPresenter);
    if (!isRulesActive) return;

    // Capture the server-merged button config once, then restore it on every call so switching
    // a participant's role re-derives button visibility from the original config instead of the
    // previously mutated (guest/presenter) state.
    if (!buttonsBaseline) {
        buttonsBaseline = JSON.parse(JSON.stringify(BUTTONS));
    } else {
        BUTTONS = JSON.parse(JSON.stringify(buttonsBaseline));
    }

    if (!isPresenter) {
        // ##################################
        // GUEST
        // ##################################
        BUTTONS.main.breakoutRoomButton = false;
        BUTTONS.participantsList.saveInfoButton = false;
        BUTTONS.settings.lockRoomButton = false;
        BUTTONS.settings.unlockRoomButton = false;
        BUTTONS.settings.broadcastingButton = false;
        BUTTONS.settings.lobbyButton = false;
        BUTTONS.settings.joinLockButton = false;
        BUTTONS.settings.sendEmailInvitation = false;
        BUTTONS.settings.tabRTMPStreamingBtn = false;
        BUTTONS.settings.tabModerator = false;
        BUTTONS.settings.tabNotificationsBtn = false;
        BUTTONS.videoOff.muteAudioButton = false;
        BUTTONS.videoOff.geolocationButton = false;
        BUTTONS.videoOff.banButton = false;
        BUTTONS.videoOff.ejectButton = false;
        BUTTONS.videoOff.presenterRoleButton = false;
        BUTTONS.consumerVideo.geolocationButton = false;
        BUTTONS.consumerVideo.banButton = false;
        BUTTONS.consumerVideo.ejectButton = false;
        BUTTONS.consumerVideo.presenterRoleButton = false;
        BUTTONS.participantsList.presenterRoleButton = false;
        // BUTTONS.consumerVideo.drawingButton = false;
        // BUTTONS.producerVideo.drawingButton = false;
        BUTTONS.whiteboard.whiteboardLockButton = false;

        // Hide presenter-only elements (covers demotion from presenter to guest)
        hide(editorUnlockBtn);
        hide(transcriptionAllLi);
        hide(breakoutRoomButton);

        // VideoAI is presenter-only
        VideoAI.enabled = false;
        elemDisplay('tabVideoAIBtn', false);

        // If a presenter-only settings tab was open, reset to the default Room tab so its
        // content isn't left visible after the tab button is hidden.
        const openPresenterTab = ['tabModerator', 'tabRTMPStreaming', 'tabNotifications', 'tabVideoAI'].some((id) => {
            const el = rc.getId(id);
            return el && el.style.display === 'block';
        });
        if (openPresenterTab) {
            const roomTabBtn = rc.getId('tabRoomBtn');
            if (roomTabBtn) roomTabBtn.click();
        }

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

        show(editorUnlockBtn);
        show(transcriptionAllLi);

        BUTTONS.main.breakoutRoomButton && show(breakoutRoomButton);
        //...

        // ##################################
        // Auto detected rules for presenter
        // ##################################

        // Skipped when a participant is promoted mid-session, so the room state
        // (broadcasting, lobby, recording, moderator) set by the original presenter is preserved.
        if (roomSetup) {
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
            // Room moderator Sync moderator settings...
            syncModeratorData();
        } else {
            // Promoted mid-session: reflect the room's current state on the switches without
            // broadcasting, so the panel matches reality instead of showing this peer's defaults.
            switchBroadcasting.checked = isBroadcastingEnabled;
            switchLobby.checked = isLobbyEnabled;
            switchHostOnlyRecording.checked = hostOnlyRecording;
            loadModeratorDataFromRoom();
        }
        // VideoAI is presenter-only and shown only when the room has it enabled
        if (rc.videoAIEnabled) {
            VideoAI.enabled = true;
            elemDisplay('tabVideoAIBtn', true);
        } else {
            VideoAI.enabled = false;
            elemDisplay('tabVideoAIBtn', false);
        }
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
    updateJoinLockButtons();
    BUTTONS.settings.sendEmailInvitation ? show(sendEmailInvitation) : hide(sendEmailInvitation);
    BUTTONS.settings.micOptionsButton ? show(micOptionsButton) : hide(micOptionsButton);
    BUTTONS.settings.tabNotificationsBtn ? show(tabNotificationsBtn) : hide(tabNotificationsBtn);
    BUTTONS.settings.tabModerator ? show(tabModeratorBtn) : hide(tabModeratorBtn);
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
    refreshExitButtonTooltip();
    //...
}

function syncModeratorData() {
    loadModeratorData();
    const syncModeratorData = getModeratorData();
    console.log('Sync moderator data ---->', syncModeratorData);
    rc.updateRoomModeratorALL(syncModeratorData);
}

function loadModeratorData() {
    switchEveryonePrivacy.checked = localStorageSettings.moderator_video_start_privacy;
    switchEveryoneMute.checked = localStorageSettings.moderator_audio_start_muted;
    switchEveryoneHidden.checked = localStorageSettings.moderator_video_start_hidden;
    switchEveryoneCantUnmute.checked = localStorageSettings.moderator_audio_cant_unmute;
    switchEveryoneCantUnhide.checked = localStorageSettings.moderator_video_cant_unhide;
    switchEveryoneCantShareScreen.checked = localStorageSettings.moderator_screen_cant_share;
    switchEveryoneCantChatPrivately.checked = localStorageSettings.moderator_chat_cant_privately;
    switchEveryoneCantChatPublicly.checked = localStorageSettings.moderator_chat_cant_publicly;
    switchEveryoneCantChatChatGPT.checked = localStorageSettings.moderator_chat_cant_chatgpt;
    switchEveryoneCantChatDeepSeek.checked = localStorageSettings.moderator_chat_cant_deep_seek;
    switchEveryoneCantMediaSharing.checked = localStorageSettings.moderator_media_cant_sharing;
    switchEveryoneCantPolls.checked = localStorageSettings.moderator_polls_cant_create;
    switchDisconnectAllOnLeave.checked = localStorageSettings.moderator_disconnect_all_on_leave;
}

// Map the room's authoritative moderator state (rc._moderator) onto the switch UI.
// Used when a peer is promoted mid-session so the panel matches the live room rules
// (kept in sync across all peers via updateRoomModerator broadcasts) rather than this
// peer's own localStorage defaults, and without broadcasting/overwriting the room state.
function loadModeratorDataFromRoom() {
    if (!rc || typeof rc.getModerator !== 'function') return;
    const moderator = rc.getModerator();
    if (!moderator) return;
    switchEveryonePrivacy.checked = !!moderator.video_start_privacy;
    switchEveryoneMute.checked = !!moderator.audio_start_muted;
    switchEveryoneHidden.checked = !!moderator.video_start_hidden;
    switchEveryoneCantUnmute.checked = !!moderator.audio_cant_unmute;
    switchEveryoneCantUnhide.checked = !!moderator.video_cant_unhide;
    switchEveryoneCantShareScreen.checked = !!moderator.screen_cant_share;
    switchEveryoneCantChatPrivately.checked = !!moderator.chat_cant_privately;
    switchEveryoneCantChatPublicly.checked = !!moderator.chat_cant_publicly;
    switchEveryoneCantChatChatGPT.checked = !!moderator.chat_cant_chatgpt;
    switchEveryoneCantChatDeepSeek.checked = !!moderator.chat_cant_deep_seek;
    switchEveryoneCantMediaSharing.checked = !!moderator.media_cant_sharing;
    switchEveryoneCantPolls.checked = !!moderator.polls_cant_create;
}

// Reflect a single moderator rule change on its switch, keeping every presenter's panel
// in sync when another presenter toggles a rule. Programmatic .checked does not fire
// onchange, so this never re-broadcasts.
function updateModeratorSwitchUI(type, status) {
    const switchByType = {
        video_start_privacy: switchEveryonePrivacy,
        audio_start_muted: switchEveryoneMute,
        video_start_hidden: switchEveryoneHidden,
        audio_cant_unmute: switchEveryoneCantUnmute,
        video_cant_unhide: switchEveryoneCantUnhide,
        screen_cant_share: switchEveryoneCantShareScreen,
        chat_cant_privately: switchEveryoneCantChatPrivately,
        chat_cant_publicly: switchEveryoneCantChatPublicly,
        chat_cant_chatgpt: switchEveryoneCantChatChatGPT,
        chat_cant_deep_seek: switchEveryoneCantChatDeepSeek,
        media_cant_sharing: switchEveryoneCantMediaSharing,
        polls_cant_create: switchEveryoneCantPolls,
    };
    const switchEl = switchByType[type];
    if (switchEl) switchEl.checked = !!status;
}

function getModeratorData() {
    return {
        video_start_privacy: switchEveryonePrivacy.checked,
        audio_start_muted: switchEveryoneMute.checked,
        video_start_hidden: switchEveryoneHidden.checked,
        audio_cant_unmute: switchEveryoneCantUnmute.checked,
        video_cant_unhide: switchEveryoneCantUnhide.checked,
        screen_cant_share: switchEveryoneCantShareScreen.checked,
        chat_cant_privately: switchEveryoneCantChatPrivately.checked,
        chat_cant_publicly: switchEveryoneCantChatPublicly.checked,
        chat_cant_chatgpt: switchEveryoneCantChatChatGPT.checked,
        chat_cant_deep_seek: switchEveryoneCantChatDeepSeek.checked,
        media_cant_sharing: switchEveryoneCantMediaSharing.checked,
        polls_cant_create: switchEveryoneCantPolls.checked,
    };
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
    BUTTONS.main.documentPiPButton = false;
    //BUTTONS.main.snapshotRoomButton = false;
    //BUTTONS.main.emojiRoomButton = false,
    //BUTTONS.main.pollButton = false;
    BUTTONS.main.breakoutRoomButton = false;
    BUTTONS.main.transcriptionButton = false;
    BUTTONS.main.settingsButton = false;
    BUTTONS.participantsList.saveInfoButton = false;
    BUTTONS.settings.lockRoomButton = false;
    BUTTONS.settings.unlockRoomButton = false;
    BUTTONS.settings.lobbyButton = false;
    BUTTONS.settings.joinLockButton = false;
    BUTTONS.settings.tabRTMPStreamingBtn = false;
    BUTTONS.settings.tabNotificationsBtn = false;
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
    elemDisplay('documentPiPButton', false);
    //elemDisplay('snapshotRoomButton', false);
    //elemDisplay('emojiRoomButton', false);
    //elemDisplay('pollButton', false);
    //elemDisplay('breakoutRoomButton', false);
    //elemDisplay('editorButton', false);
    elemDisplay('transcriptionButton', false);
    elemDisplay('lockRoomButton', false);
    elemDisplay('unlockRoomButton', false);
    elemDisplay('lobbyButton', false);
    elemDisplay('joinLockButton', false);
    elemDisplay('joinUnlockButton', false);
    elemDisplay('settingsButton', false);
    elemDisplay('tabRTMPStreamingBtn', false);
    elemDisplay('tabNotificationsBtn', false);

    elemDisplay('startVideoDeviceDropdown', false);
    elemDisplay('startAudioDeviceDropdown', false);
    elemDisplay('settingsExtraDropdown', false);
}
