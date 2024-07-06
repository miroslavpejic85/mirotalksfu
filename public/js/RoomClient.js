'use strict';

/**
 * MiroTalk SFU - Client component
 *
 * @link    GitHub: https://github.com/miroslavpejic85/mirotalksfu
 * @link    Official Live demo: https://sfu.mirotalk.com
 * @license For open source use: AGPLv3
 * @license For commercial or closed source, contact us at license.mirotalk@gmail.com or purchase directly via CodeCanyon
 * @license CodeCanyon: https://codecanyon.net/item/mirotalk-sfu-webrtc-realtime-video-conferences/40769970
 * @author  Miroslav Pejic - miroslav.pejic.85@gmail.com
 * @version 1.4.87
 *
 */

const cfg = {
    useAvatarSvg: true,
};

const html = {
    newline: '\n', //'<br />',
    hideMeOn: 'fas fa-user-slash',
    hideMeOff: 'fas fa-user',
    audioOn: 'fas fa-microphone',
    audioOff: 'fas fa-microphone-slash',
    videoOn: 'fas fa-video',
    videoOff: 'fas fa-video-slash',
    userName: 'username',
    userHand: 'fas fa-hand-paper pulsate',
    pip: 'fas fa-images',
    fullScreen: 'fas fa-expand',
    snapshot: 'fas fa-camera-retro',
    sendFile: 'fas fa-upload',
    sendMsg: 'fas fa-paper-plane',
    sendVideo: 'fab fa-youtube',
    geolocation: 'fas fa-location-dot',
    ban: 'fas fa-ban',
    kickOut: 'fas fa-times',
    ghost: 'fas fa-ghost',
    undo: 'fas fa-undo',
    bg: 'fas fa-circle-half-stroke',
    pin: 'fas fa-map-pin',
    videoPrivacy: 'far fa-circle',
    expand: 'fas fa-ellipsis-vertical',
};

const icons = {
    room: '<i class="fas fa-home"></i>',
    chat: '<i class="fas fa-comments"></i>',
    user: '<i class="fas fa-user"></i>',
    transcript: '<i class="fas fa-closed-captioning"></i>',
    speech: '<i class="fas fa-volume-high"></i>',
    share: '<i class="fas fa-share-alt"></i>',
    ptt: '<i class="fa-solid fa-hand-pointer"></i>',
    lobby: '<i class="fas fa-shield-halved"></i>',
    lock: '<i class="fa-solid fa-lock"></i>',
    unlock: '<i class="fa-solid fa-lock-open"></i>',
    pitchBar: '<i class="fas fa-microphone-lines"></i>',
    sounds: '<i class="fas fa-music"></i>',
    fileSend: '<i class="fa-solid fa-file-export"></i>',
    fileReceive: '<i class="fa-solid fa-file-import"></i>',
    recording: '<i class="fas fa-record-vinyl"></i>',
    moderator: '<i class="fas fa-m"></i>',
    broadcaster: '<i class="fa-solid fa-wifi"></i>',
    codecs: '<i class="fa-solid fa-film"></i>',
    theme: '<i class="fas fa-fill-drip"></i>',
    recSync: '<i class="fa-solid fa-cloud-arrow-up"></i>',
    refresh: '<i class="fas fa-rotate"></i>',
};

const image = {
    about: '../images/mirotalk-logo.gif',
    avatar: '../images/mirotalksfu-logo.png',
    audio: '../images/audio.gif',
    poster: '../images/loader.gif',
    rec: '../images/rec.png',
    recording: '../images/recording.png',
    delete: '../images/delete.png',
    locked: '../images/locked.png',
    mute: '../images/mute.png',
    hide: '../images/hide.png',
    stop: '../images/stop.png',
    unmute: '../images/unmute.png',
    unhide: '../images/unhide.png',
    start: '../images/start.png',
    users: '../images/participants.png',
    user: '../images/participant.png',
    username: '../images/user.png',
    videoShare: '../images/video-share.png',
    message: '../images/message.png',
    share: '../images/share.png',
    exit: '../images/exit.png',
    feedback: '../images/feedback.png',
    lobby: '../images/lobby.png',
    email: '../images/email.png',
    chatgpt: '../images/chatgpt.png',
    all: '../images/all.png',
    forbidden: '../images/forbidden.png',
    broadcasting: '../images/broadcasting.png',
    geolocation: '../images/geolocation.png',
    network: '../images/network.gif',
    rtmp: '../images/rtmp.png',
};

const mediaType = {
    audio: 'audioType',
    audioTab: 'audioTab',
    video: 'videoType',
    camera: 'cameraType',
    screen: 'screenType',
    speaker: 'speakerType',
};

const _EVENTS = {
    openRoom: 'openRoom',
    exitRoom: 'exitRoom',
    startRec: 'startRec',
    pauseRec: 'pauseRec',
    resumeRec: 'resumeRec',
    stopRec: 'stopRec',
    raiseHand: 'raiseHand',
    lowerHand: 'lowerHand',
    startVideo: 'startVideo',
    pauseVideo: 'pauseVideo',
    resumeVideo: 'resumeVideo',
    stopVideo: 'stopVideo',
    startAudio: 'startAudio',
    pauseAudio: 'pauseAudio',
    resumeAudio: 'resumeAudio',
    stopAudio: 'stopAudio',
    startScreen: 'startScreen',
    pauseScreen: 'pauseScreen',
    resumeScreen: 'resumeScreen',
    stopScreen: 'stopScreen',
    roomLock: 'roomLock',
    lobbyOn: 'lobbyOn',
    lobbyOff: 'lobbyOff',
    roomUnlock: 'roomUnlock',
    hostOnlyRecordingOn: 'hostOnlyRecordingOn',
    hostOnlyRecordingOff: 'hostOnlyRecordingOff',
    startRTMP: 'startRTMP',
    stopRTMP: 'stopRTMP',
    endRTMP: 'endRTMP',
    startRTMPfromURL: 'startRTMPfromURL',
    stopRTMPfromURL: 'stopRTMPfromURL',
    endRTMPfromURL: 'endRTMPfromURL',
};

// Enums
const enums = {
    recording: {
        started: 'Started conference recording',
        start: 'Start conference recording',
        stop: 'Stop conference recording',
    },
    //...
};

// HeyGen config
const VideoAI = {
    enabled: true,
    active: false,
    info: {},
    avatar: null,
    avatarName: 'Monica',
    avatarVoice: '',
    quality: 'medium',
    virtualBackground: true,
    background: '../images/virtual/1.jpg',
};

// Recording
let recordedBlobs = [];

class RoomClient {
    constructor(
        localAudioEl,
        remoteAudioEl,
        videoMediaContainer,
        videoPinMediaContainer,
        mediasoupClient,
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
        successCallback,
    ) {
        this.localAudioEl = localAudioEl;
        this.remoteAudioEl = remoteAudioEl;
        this.videoMediaContainer = videoMediaContainer;
        this.videoPinMediaContainer = videoPinMediaContainer;
        this.mediasoupClient = mediasoupClient;

        this.socket = socket;
        this.room_id = room_id;
        this.peer_id = socket.id;
        this.peer_name = peer_name;
        this.peer_uuid = peer_uuid;
        this.peer_info = peer_info;

        // RTMP selected file name
        this.selectedRtmpFilename = '';

        // Moderator
        this._moderator = {
            audio_start_muted: false,
            video_start_hidden: false,
            audio_cant_unmute: false,
            video_cant_unhide: false,
            screen_cant_share: false,
            chat_cant_privately: false,
            chat_cant_chatgpt: false,
        };

        // Chat messages
        this.chatMessageLengthCheck = false;
        this.chatMessageLength = 4000; // chars
        this.chatMessageTimeLast = 0;
        this.chatMessageTimeBetween = 1000; // ms
        this.chatMessageNotifyDelay = 10000; // ms
        this.chatMessageSpamCount = 0;
        this.chatMessageSpamCountToBan = 10;

        // HeyGen Video AI
        this.videoAIContainer = null;
        this.videoAIElement = null;
        this.canvasAIElement = null;
        this.renderAIToken = null;
        this.peerConnection = null;

        this.isAudioAllowed = isAudioAllowed;
        this.isVideoAllowed = isVideoAllowed;
        this.isScreenAllowed = isScreenAllowed;
        this.joinRoomWithScreen = joinRoomWithScreen;
        this.producerTransport = null;
        this.consumerTransport = null;
        this.device = null;

        this.isMobileDevice = DetectRTC.isMobileDevice;
        this.isScreenShareSupported =
            navigator.getDisplayMedia || navigator.mediaDevices.getDisplayMedia ? true : false;

        this.isMySettingsOpen = false;

        this._isConnected = false;
        this.isVideoOnFullScreen = false;
        this.isVideoFullScreenSupported = this.isFullScreenSupported();
        this.isVideoPictureInPictureSupported = document.pictureInPictureEnabled;
        this.isZoomCenterMode = false;
        this.isChatOpen = false;
        this.isChatEmojiOpen = false;
        this.isSpeechSynthesisSupported = isSpeechSynthesisSupported;
        this.speechInMessages = false;
        this.showChatOnMessage = true;
        this.isChatBgTransparent = false;
        this.isVideoPinned = false;
        this.isChatPinned = false;
        this.isChatMaximized = false;
        this.isToggleUnreadMsg = false;
        this.isToggleRaiseHand = false;
        this.pinnedVideoPlayerId = null;
        this.camVideo = false;
        this.camera = 'user';
        this.videoQualitySelectedIndex = 0;

        this.chatGPTContext = [];
        this.chatMessages = [];
        this.leftMsgAvatar = null;
        this.rightMsgAvatar = null;

        this.localVideoStream = null;
        this.localAudioStream = null;
        this.localScreenStream = null;

        this.RoomPassword = false;

        this.transcription = transcription;

        // RTMP Streamer
        this.rtmpFileStreamer = false;
        this.rtmpUrltSreamer = false;

        // File transfer settings
        this.fileToSend = null;
        this.fileReader = null;
        this.receiveBuffer = [];
        this.receivedSize = 0;
        this.incomingFileInfo = null;
        this.incomingFileData = null;
        this.sendInProgress = false;
        this.receiveInProgress = false;
        this.fileSharingInput = '*';
        this.chunkSize = 1024 * 16; // 16kb/s

        // Recording
        this._isRecording = false;
        this.mediaRecorder = null;
        this.audioRecorder = null;
        this.recScreenStream = null;
        this.recording = {
            recSyncServerRecording: false,
            recSyncServerEndpoint: '',
        };
        this.recSyncTime = 4000; // 4 sec
        this.recSyncChunkSize = 1000000; // 1MB

        // Encodings
        this.forceVP8 = false; // Force VP8 codec for webcam and screen sharing
        this.forceVP9 = false; // Force VP9 codec for webcam and screen sharing
        this.forceH264 = false; // Force H264 codec for webcam and screen sharing
        this.enableWebcamLayers = true; // Enable simulcast or SVC for webcam
        this.enableSharingLayers = true; // Enable simulcast or SVC for screen sharing
        this.numSimulcastStreamsWebcam = 3; // Number of streams for simulcast in webcam
        this.numSimulcastStreamsSharing = 1; // Number of streams for simulcast in screen sharing
        this.webcamScalabilityMode = 'L3T3'; // Scalability Mode for webcam | 'L1T3' for VP8/H264 (in each simulcast encoding), 'L3T3_KEY' for VP9
        this.sharingScalabilityMode = 'L1T3'; // Scalability Mode for screen sharing | 'L1T3' for VP8/H264 (in each simulcast encoding), 'L3T3' for VP9

        this.myVideoEl = null;
        this.myAudioEl = null;
        this.showPeerInfo = false; // on peerName mouse hover

        this.videoProducerId = null;
        this.screenProducerId = null;
        this.audioProducerId = null;
        this.audioConsumers = new Map();

        this.consumers = new Map();
        this.producers = new Map();
        this.producerLabel = new Map();
        this.eventListeners = new Map();

        this.debug = false;
        this.debug ? window.localStorage.setItem('debug', 'mediasoup*') : window.localStorage.removeItem('debug');

        console.log('06 ----> Load MediaSoup Client v', mediasoupClient.version);
        console.log('06.1 ----> PEER_ID', this.peer_id);

        Object.keys(_EVENTS).forEach((evt) => {
            this.eventListeners.set(evt, []);
        });

        this.socket.request = function request(type, data = {}) {
            return new Promise((resolve, reject) => {
                socket.emit(type, data, (data) => {
                    if (data.error) {
                        reject(data.error);
                    } else {
                        resolve(data);
                    }
                });
            });
        };

        // ####################################################
        // CREATE ROOM AND JOIN
        // ####################################################

        this.createRoom(this.room_id).then(async () => {
            const data = {
                room_id: this.room_id,
                peer_info: this.peer_info,
            };
            await this.join(data);
            this.initSockets();
            this._isConnected = true;
            successCallback();
        });
    }

    // ####################################################
    // GET STARTED
    // ####################################################

    async createRoom(room_id) {
        await this.socket
            .request('createRoom', {
                room_id,
            })
            .catch((err) => {
                console.log('Create room:', err);
            });
    }

    async join(data) {
        this.socket
            .request('join', data)
            .then(async (room) => {
                console.log('##### JOIN ROOM #####', room);
                if (room === 'notAllowed') {
                    console.log(
                        '00-WARNING ----> Room is Unauthorized for current user, please provide a valid room name for this user',
                    );
                    return this.userRoomNotAllowed();
                }
                if (room === 'unauthorized') {
                    console.log(
                        '00-WARNING ----> Room is Unauthorized for current user, please provide a valid username and password',
                    );
                    return this.userUnauthorized();
                }
                if (room === 'isLocked') {
                    this.event(_EVENTS.roomLock);
                    console.log('00-WARNING ----> Room is Locked, Try to unlock by the password');
                    return this.unlockTheRoom();
                }
                if (room === 'isLobby') {
                    this.event(_EVENTS.lobbyOn);
                    console.log('00-WARNING ----> Room Lobby Enabled, Wait to confirm my join');
                    return this.waitJoinConfirm();
                }
                if (room === 'isBanned') {
                    console.log('00-WARNING ----> You are Banned from the Room!');
                    return this.isBanned();
                }
                const peers = new Map(JSON.parse(room.peers));
                if (!peer_info.peer_token) {
                    // hack...
                    for (let peer of Array.from(peers.keys()).filter((id) => id !== this.peer_id)) {
                        let peer_info = peers.get(peer).peer_info;
                        if (peer_info.peer_name == this.peer_name) {
                            console.log('00-WARNING ----> Username already in use');
                            return this.userNameAlreadyInRoom();
                        }
                    }
                }
                await this.joinAllowed(room);
            })
            .catch((error) => {
                console.error('Join error:', error);
            });
    }

    async joinAllowed(room) {
        console.log('07 ----> Join Room allowed');
        await this.handleRoomInfo(room);
        const routerRtpCapabilities = await this.socket.request('getRouterRtpCapabilities');
        routerRtpCapabilities.headerExtensions = routerRtpCapabilities.headerExtensions.filter(
            (ext) => ext.uri !== 'urn:3gpp:video-orientation',
        );
        this.device = await this.loadDevice(routerRtpCapabilities);
        console.log('07.3 ----> Get Router Rtp Capabilities codecs: ', this.device.rtpCapabilities.codecs);
        await this.initTransports(this.device);
        // ###################################
        this.socket.emit('getProducers');
        // ###################################
        if (isBroadcastingEnabled) {
            isPresenter ? await this.startLocalMedia() : this.handleRoomBroadcasting();
        } else {
            await this.startLocalMedia();
        }
    }

    async handleRoomInfo(room) {
        console.log('07.0 ----> Room Survey', room.survey);
        survey = room.survey;
        console.log('07.0 ----> Room Leave Redirect', room.redirect);
        redirect = room.redirect;
        let peers = new Map(JSON.parse(room.peers));
        participantsCount = peers.size;
        // ME
        for (let peer of Array.from(peers.keys()).filter((id) => id == this.peer_id)) {
            let my_peer_info = peers.get(peer).peer_info;
            console.log('07.1 ----> My Peer info', my_peer_info);
            isPresenter = window.localStorage.isReconnected === 'true' ? isPresenter : my_peer_info.peer_presenter;
            this.peer_info.peer_presenter = isPresenter;
            this.getId('isUserPresenter').innerText = isPresenter;
            window.localStorage.isReconnected = false;
            handleRules(isPresenter);

            // ###################################################################################################
            isBroadcastingEnabled = isPresenter && !room.broadcasting ? isBroadcastingEnabled : room.broadcasting;
            console.log('07.1 ----> ROOM BROADCASTING', isBroadcastingEnabled);
            // ###################################################################################################

            if (BUTTONS.settings.tabRecording) {
                room.config.hostOnlyRecording
                    ? (console.log('07.1 ----> WARNING Room Host only recording enabled'),
                      this.event(_EVENTS.hostOnlyRecordingOn))
                    : this.event(_EVENTS.hostOnlyRecordingOff);
            }

            // ###################################################################################################
            if (room.recording) this.recording = room.recording;
            if (room.recording && room.recording.recSyncServerRecording) {
                console.log('07.1 WARNING ----> SERVER SYNC RECORDING ENABLED!');
                this.recording.recSyncServerRecording = localStorageSettings.rec_server;
                if (BUTTONS.settings.tabRecording && !room.config.hostOnlyRecording) {
                    show(roomRecordingServer);
                }
                switchServerRecording.checked = this.recording.recSyncServerRecording;
            }
            console.log('07.1 ----> SERVER SYNC RECORDING', this.recording);
            // ###################################################################################################

            // Handle Room moderator rules
            if (room.moderator && (!isRulesActive || !isPresenter)) {
                console.log('07.2 ----> ROOM MODERATOR', room.moderator);
                const {
                    audio_start_muted,
                    video_start_hidden,
                    audio_cant_unmute,
                    video_cant_unhide,
                    screen_cant_share,
                    chat_cant_privately,
                    chat_cant_chatgpt,
                } = room.moderator;

                this._moderator.audio_start_muted = audio_start_muted;
                this._moderator.video_start_hidden = video_start_hidden;
                this._moderator.audio_cant_unmute = audio_cant_unmute;
                this._moderator.video_cant_unhide = video_cant_unhide;
                this._moderator.screen_cant_share = screen_cant_share;
                this._moderator.chat_cant_privately = chat_cant_privately;
                this._moderator.chat_cant_chatgpt = chat_cant_chatgpt;
                //
                if (this._moderator.audio_start_muted && this._moderator.video_start_hidden) {
                    this.userLog('warning', 'The Moderator disabled your audio and video', 'top-end');
                } else {
                    if (this._moderator.audio_start_muted && !this._moderator.video_start_hidden) {
                        this.userLog('warning', 'The Moderator disabled your audio', 'top-end');
                    }
                    if (!this._moderator.audio_start_muted && this._moderator.video_start_hidden) {
                        this.userLog('warning', 'The Moderator disabled your video', 'top-end');
                    }
                }
                //
                this._moderator.audio_cant_unmute ? hide(tabAudioDevicesBtn) : show(tabAudioDevicesBtn);
                this._moderator.video_cant_unhide ? hide(tabVideoDevicesBtn) : show(tabVideoDevicesBtn);
            }
            // Check if VideoAI is enabled
            if (!room.videoAIEnabled) {
                VideoAI.enabled = false;
                elemDisplay('tabVideoAIBtn', false);
            }
            // Check che RTMP config
            if (room.rtmp) {
                console.log('RTMP config', room.rtmp);
                const { enabled, fromFile, fromUrl, fromStream } = room.rtmp;
                elemDisplay('tabRTMPStreamingBtn', enabled);
                elemDisplay('rtmpFromFile', fromFile);
                elemDisplay('rtmpFromUrl', fromUrl);
                elemDisplay('rtmpFromStream', fromStream);
                if (!fromFile && !fromUrl && !fromStream) {
                    elemDisplay('tabRTMPStreamingBtn', false);
                }
            }
        }

        // PARTICIPANTS
        for (let peer of Array.from(peers.keys()).filter((id) => id !== this.peer_id)) {
            let peer_info = peers.get(peer).peer_info;
            // console.log('07.1 ----> Remote Peer info', peer_info);
            const canSetVideoOff = !isBroadcastingEnabled || (isBroadcastingEnabled && peer_info.peer_presenter);

            if (!peer_info.peer_video && canSetVideoOff) {
                console.log('Detected peer video off ' + peer_info.peer_name);
                this.setVideoOff(peer_info, true);
            }

            if (peer_info.peer_recording) {
                this.handleRecordingAction({
                    peer_id: peer_info.id,
                    peer_name: peer_info.peer_name,
                    action: enums.recording.started,
                });
            }
        }

        this.refreshParticipantsCount();

        console.log('07.2 Participants Count ---->', participantsCount);

        // notify && participantsCount == 1 ? shareRoom() : sound('joined');
        if (notify && participantsCount == 1) {
            shareRoom();
        } else {
            if (this.isScreenAllowed) {
                this.shareScreen();
            }
            sound('joined');
        }
    }

    async loadDevice(routerRtpCapabilities) {
        let device;
        try {
            device = new this.mediasoupClient.Device();
        } catch (error) {
            if (error.name === 'UnsupportedError') {
                console.error('Browser not supported');
                this.userLog('error', 'Browser not supported', 'center', 6000);
            } else {
                console.error('Browser not supported: ', error);
                this.userLog('error', 'Browser not supported: ' + error, 'center', 6000);
            }
        }
        await device.load({
            routerRtpCapabilities,
        });
        return device;
    }

    // ####################################################
    // TRANSPORTS
    // ####################################################

    async initTransports(device) {
        // ####################################################
        // PRODUCER TRANSPORT
        // ####################################################

        const producerTransportData = await this.socket.request('createWebRtcTransport', {
            forceTcp: false,
            rtpCapabilities: device.rtpCapabilities,
        });

        if (producerTransportData.error) {
            console.error(producerTransportData.error);
            return;
        }

        this.producerTransport = device.createSendTransport(producerTransportData);

        console.info('07.4 producerTransportData ---->', {
            producerTransportId: this.producerTransport.id,
            producerTransportData: producerTransportData,
        });

        this.producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                await this.socket.request('connectTransport', {
                    transport_id: this.producerTransport.id,
                    dtlsParameters,
                });
                callback();
            } catch (err) {
                errback(err);
            }
        });

        this.producerTransport.on('produce', async ({ kind, appData, rtpParameters }, callback, errback) => {
            console.log('Going to produce', { kind, appData, rtpParameters });
            try {
                const { producer_id } = await this.socket.request('produce', {
                    producerTransportId: this.producerTransport.id,
                    kind,
                    appData,
                    rtpParameters,
                });
                callback({
                    id: producer_id,
                });
            } catch (err) {
                errback(err);
            }
        });

        this.producerTransport.on('connectionstatechange', (state) => {
            switch (state) {
                case 'connecting':
                    console.log('Producer Transport connecting...');
                    break;
                case 'connected':
                    console.log('Producer Transport connected', { id: this.producerTransport.id });
                    break;
                case 'disconnected':
                    console.log('Producer Transport disconnected', { id: this.producerTransport.id });
                    /*
                    this.restartIce();

                    popupHtmlMessage(
                        null,
                        image.network,
                        'Producer Transport disconnected',
                        'Check Your Network Connectivity (Restarted ICE)',
                        'center',
                    );
                    */
                    break;
                case 'failed':
                    console.warn('Producer Transport failed', { id: this.producerTransport.id });

                    this.producerTransport.close();

                    popupHtmlMessage(
                        null,
                        image.network,
                        'Producer Transport failed',
                        'Check Your Network Connectivity',
                        'center',
                    );
                    break;
                default:
                    console.log('Producer transport connection state changes', {
                        state: state,
                        id: this.producerTransport.id,
                    });
                    break;
            }
        });

        this.producerTransport.on('icegatheringstatechange', (state) => {
            console.log('Producer icegatheringstatechange', {
                state: state,
                id: this.producerTransport.id,
            });
        });

        // ####################################################
        // CONSUMER TRANSPORT
        // ####################################################

        const consumerTransportData = await this.socket.request('createWebRtcTransport', {
            forceTcp: false,
        });

        if (consumerTransportData.error) {
            console.error(consumerTransportData.error);
            return;
        }

        this.consumerTransport = device.createRecvTransport(consumerTransportData);

        console.info('07.5 consumerTransportData ---->', {
            consumerTransportId: this.consumerTransport.id,
            consumerTransportData: consumerTransportData,
        });

        this.consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                await this.socket.request('connectTransport', {
                    transport_id: this.consumerTransport.id,
                    dtlsParameters,
                });
                callback();
            } catch (err) {
                errback(err);
            }
        });

        this.consumerTransport.on('connectionstatechange', (state) => {
            switch (state) {
                case 'connecting':
                    console.log('Consumer Transport connecting...');
                    break;
                case 'connected':
                    console.log('Consumer Transport connected', { id: this.consumerTransport.id });
                    break;
                case 'disconnected':
                    console.log('Consumer Transport disconnected', { id: this.consumerTransport.id });
                /*
                    this.restartIce();

                    popupHtmlMessage(
                        null,
                        image.network,
                        'Consumer Transport disconnected',
                        'Check Your Network Connectivity (Restarted ICE)',
                        'center',
                    );
                    */
                case 'failed':
                    console.warn('Consumer Transport failed', { id: this.consumerTransport.id });

                    this.consumerTransport.close();

                    popupHtmlMessage(
                        null,
                        image.network,
                        'Consumer Transport failed',
                        'Check Your Network Connectivity',
                        'center',
                    );
                    break;
                default:
                    console.log('Consumer transport connection state changes', {
                        state: state,
                        id: this.consumerTransport.id,
                    });
                    break;
            }
        });

        this.consumerTransport.on('icegatheringstatechange', (state) => {
            console.log('Consumer icegatheringstatechange', {
                state: state,
                id: this.consumerTransport.id,
            });
        });

        // ####################################################
        // TODO: DATA TRANSPORT
        // ####################################################

        //
    }

    // ####################################################
    // RESTART ICE
    // ####################################################

    async restartIce() {
        console.log('Restart ICE...');
        try {
            if (this.producerTransport) {
                const iceParameters = await this.socket.request('restartIce', {
                    transport_id: this.producerTransport.id,
                });

                console.log('Restarting producer transport ICE', iceParameters);

                await this.producerTransport.restartIce({ iceParameters });
            }

            if (this.consumerTransport) {
                const iceParameters = await this.socket.request('restartIce', {
                    transport_id: this.consumerTransport.id,
                });

                console.log('Restarting consumer transport ICE', iceParameters);

                await this.consumerTransport.restartIce({ iceParameters });
            }
            console.log('Restart ICE done');
        } catch (error) {
            console.error('Restart ICE error', error);
        }
    }

    // ####################################################
    // SOCKET ON
    // ####################################################

    initSockets() {
        this.socket.on('consumerClosed', this.handleConsumerClosed);
        this.socket.on('setVideoOff', this.handleSetVideoOff);
        this.socket.on('removeMe', this.handleRemoveMe);
        this.socket.on('refreshParticipantsCount', this.handleRefreshParticipantsCount);
        this.socket.on('newProducers', this.handleNewProducers);
        this.socket.on('message', this.handleMessage);
        this.socket.on('roomAction', this.handleRoomAction);
        this.socket.on('roomPassword', this.handleRoomPassword);
        this.socket.on('roomLobby', this.handleRoomLobby);
        this.socket.on('cmd', this.handleCmdData);
        this.socket.on('peerAction', this.handlePeerAction);
        this.socket.on('updatePeerInfo', this.handleUpdatePeerInfo);
        this.socket.on('fileInfo', this.handleFileInfoData);
        this.socket.on('file', this.handleFileData);
        this.socket.on('shareVideoAction', this.handleShareVideoAction);
        this.socket.on('fileAbort', this.handleFileAbortData);
        this.socket.on('receiveFileAbort', this.handleReceiveFileAbortData);
        this.socket.on('wbCanvasToJson', this.handleWbCanvasToJson);
        this.socket.on('whiteboardAction', this.handleWhiteboardAction);
        this.socket.on('audioVolume', this.handleAudioVolumeData);
        this.socket.on('dominantSpeaker', this.handleDominantSpeakerData);
        this.socket.on('updateRoomModerator', this.handleUpdateRoomModeratorData);
        this.socket.on('updateRoomModeratorALL', this.handleUpdateRoomModeratorALLData);
        this.socket.on('recordingAction', this.handleRecordingActionData);
        this.socket.on('connect', this.handleSocketConnect);
        this.socket.on('disconnect', this.handleSocketDisconnect);
        this.socket.on('endRTMP', this.handleEndRTMP);
        this.socket.on('errorRTMP', this.handleErrorRTMP);
        this.socket.on('endRTMPfromURL', this.handleEndRTMPfromURL);
        this.socket.on('errorRTMPfromURL', this.handleErrorRTMPfromURL);
    }

    // ####################################################
    // HANDLE SOCKET DATA
    // ####################################################

    handleConsumerClosed = ({ consumer_id, consumer_kind }) => {
        console.log('SocketOn Closing consumer', { consumer_id, consumer_kind });
        this.removeConsumer(consumer_id, consumer_kind);
    };

    handleSetVideoOff = (data) => {
        if (!isBroadcastingEnabled || (isBroadcastingEnabled && data.peer_presenter)) {
            console.log('SocketOn setVideoOff', {
                peer_name: data.peer_name,
                peer_presenter: data.peer_presenter,
            });
            this.setVideoOff(data, true);
        }
    };

    handleRemoveMe = (data) => {
        console.log('SocketOn Remove me:', data);
        this.removeVideoOff(data.peer_id);
        this.lobbyRemoveMe(data.peer_id);
        participantsCount = data.peer_counts;
        if (!isBroadcastingEnabled) adaptAspectRatio(participantsCount);
        if (isParticipantsListOpen) getRoomParticipants();
        if (isBroadcastingEnabled && data.isPresenter) {
            this.userLog('info', `${icons.broadcaster} ${data.peer_name} disconnected`, 'top-end', 6000);
        }
    };

    handleRefreshParticipantsCount = (data) => {
        console.log('SocketOn Participants Count:', data);
        participantsCount = data.peer_counts;
        if (isBroadcastingEnabled) {
            if (isParticipantsListOpen) getRoomParticipants();
            wbUpdate();
        } else {
            adaptAspectRatio(participantsCount);
        }
    };

    handleNewProducers = async (data) => {
        if (data.length > 0) {
            console.log('SocketOn New producers', data);
            for (let { producer_id, peer_name, peer_info, type } of data) {
                await this.consume(producer_id, peer_name, peer_info, type);
            }
        }
    };

    handleMessage = (data) => {
        console.log('SocketOn New message:', data);
        this.showMessage(data);
    };

    handleRoomAction = (data) => {
        console.log('SocketOn Room action:', data);
        this.roomAction(data, false);
    };

    handleRoomPassword = (data) => {
        console.log('SocketOn Room password:', data.password);
        this.roomPassword(data);
    };

    handleRoomLobby = (data) => {
        console.log('SocketOn Room lobby:', data);
        this.roomLobby(data);
    };

    handleCmdData = (data) => {
        console.log('SocketOn Peer cmd:', data);
        this.handleCmd(data);
    };

    handlePeerAction = (data) => {
        console.log('SocketOn Peer action:', data);
        this.peerAction(data.from_peer_name, data.peer_id, data.action, false, data.broadcast, true, data.message);
    };

    handleUpdatePeerInfo = (data) => {
        console.log('SocketOn Peer info update:', data);
        this.updatePeerInfo(data.peer_name, data.peer_id, data.type, data.status, false, data.peer_presenter);
    };

    handleFileInfoData = (data) => {
        console.log('SocketOn File info:', data);
        this.handleFileInfo(data);
    };

    handleFileData = (data) => {
        this.handleFile(data);
    };

    handleShareVideoAction = (data) => {
        this.shareVideoAction(data);
    };

    handleFileAbortData = (data) => {
        this.handleFileAbort(data);
    };

    handleReceiveFileAbortData = (data) => {
        this.handleReceiveFileAbort(data);
    };

    handleWbCanvasToJson = (data) => {
        console.log('SocketOn Received whiteboard canvas JSON');
        JsonToWbCanvas(data);
    };

    handleWhiteboardAction = (data) => {
        console.log('Whiteboard action', data);
        whiteboardAction(data, false);
    };

    handleAudioVolumeData = (data) => {
        this.handleAudioVolume(data);
    };

    handleDominantSpeakerData = (data) => {
        this.handleDominantSpeaker(data);
    };

    handleUpdateRoomModeratorData = (data) => {
        console.log('SocketOn Update room moderator', data);
        this.handleUpdateRoomModerator(data);
    };

    handleUpdateRoomModeratorALLData = (data) => {
        console.log('SocketOn Update room moderator ALL', data);
        this.handleUpdateRoomModeratorALL(data);
    };

    handleRecordingActionData = (data) => {
        console.log('SocketOn Recording action:', data);
        this.handleRecordingAction(data);
    };

    handleSocketConnect = () => {
        console.log('SocketOn Connected to signaling server!');
        this._isConnected = true;
        this.refreshBrowser();
    };

    handleSocketDisconnect = () => {
        this.exit(true);
        this.ServerAway();
        this.saveRecording('Socket disconnected');
    };

    handleEndRTMP = (data) => {
        this.endRTMP(data);
    };

    handleErrorRTMP = (data) => {
        this.errorRTMP(data);
    };

    handleEndRTMPfromURL = (data) => {
        this.endRTMPfromURL(data);
    };

    handleErrorRTMPfromURL = (data) => {
        this.errorRTMPfromURL(data);
    };

    // ####################################################
    // SERVER AWAY/MAINTENANCE
    // ####################################################

    ServerAway() {
        this.sound('alert');
        window.localStorage.isReconnected = true;
        Swal.fire({
            allowOutsideClick: false,
            allowEscapeKey: false,
            showDenyButton: true,
            showConfirmButton: false,
            background: swalBackground,
            imageUrl: image.poster,
            title: 'Server away',
            text: 'The server seems away or in maintenance, please wait until it come back up.',
            denyButtonText: `Leave room`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (!result.isConfirmed) {
                this.event(_EVENTS.exitRoom);
            }
        });
    }

    refreshBrowser() {
        this.exit(true);
        getPeerName() ? location.reload() : openURL(this.getReconnectDirectJoinURL());
    }

    getReconnectDirectJoinURL() {
        const { peer_audio, peer_video, peer_screen, peer_token } = this.peer_info;
        const baseUrl = `${window.location.origin}/join`;
        const queryParams = {
            room: this.room_id,
            roomPassword: this.RoomPassword,
            name: this.peer_name,
            audio: peer_audio,
            video: peer_video,
            screen: peer_screen,
            notify: 0,
            isPresenter: isPresenter,
        };
        if (peer_token) queryParams.token = peer_token;
        const url = `${baseUrl}?${Object.entries(queryParams)
            .map(([key, value]) => `${key}=${value}`)
            .join('&')}`;
        return url;
    }

    // ####################################################
    // CHECK USER
    // ####################################################

    userNameAlreadyInRoom() {
        this.sound('alert');
        Swal.fire({
            allowOutsideClick: false,
            allowEscapeKey: false,
            background: swalBackground,
            imageUrl: image.user,
            position: 'center',
            title: 'Username',
            html: `The Username is already in use. <br/> Please try with another one`,
            showDenyButton: false,
            confirmButtonText: `OK`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                openURL((window.location.href = '/join/' + this.room_id));
            }
        });
    }

    // ####################################################
    // HANDLE ROOM BROADCASTING
    // ####################################################

    handleRoomBroadcasting() {
        console.log('07.4 ----> Room Broadcasting is currently active, and you are not the designated presenter');

        this.peer_info.peer_audio = false;
        this.peer_info.peer_video = false;
        this.peer_info.peer_screen = false;

        const mediaTypes = ['audio', 'video', 'screen'];

        mediaTypes.forEach((type) => {
            const data = {
                room_id: this.room_id,
                peer_name: this.peer_name,
                peer_id: this.peer_id,
                peer_presenter: isPresenter,
                type: type,
                status: false,
                broadcast: true,
            };
            this.socket.emit('updatePeerInfo', data);
        });

        handleRulesBroadcasting();
    }

    toggleRoomBroadcasting() {
        Swal.fire({
            background: swalBackground,
            position: 'center',
            imageUrl: image.broadcasting,
            title: 'Room broadcasting Enabled',
            text: 'Would you like to continue the room broadcast?',
            showDenyButton: true,
            confirmButtonColor: '#18392B',
            confirmButtonText: `Yes`,
            denyButtonText: `No`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isDenied) {
                switchBroadcasting.click();
            }
        });
    }

    // ####################################################
    // START LOCAL AUDIO VIDEO MEDIA
    // ####################################################

    async startLocalMedia() {
        console.log('08 ----> START LOCAL MEDIA...');
        const audioProducerExist = this.producerExist(mediaType.audio);
        if (this.isAudioAllowed) {
            if (!audioProducerExist) {
                await this.produce(mediaType.audio, microphoneSelect.value);
                console.log('09 ----> START AUDIO MEDIA');
            }
            if (this._moderator.audio_start_muted) {
                await this.pauseAudioProducer();
            }
        } else {
            if (isEnumerateAudioDevices && !audioProducerExist) {
                await this.produce(mediaType.audio, microphoneSelect.value);
                console.log('09 ----> START AUDIO MEDIA');
                await this.pauseAudioProducer();
            }
        }

        if (this.isVideoAllowed && !this._moderator.video_start_hidden) {
            await this.produce(mediaType.video, videoSelect.value);
            console.log('10 ----> START VIDEO MEDIA');
        } else {
            setColor(startVideoButton, 'red');
            this.setVideoOff(this.peer_info, false);
            this.sendVideoOff();
            if (BUTTONS.main.startVideoButton) this.event(_EVENTS.stopVideo);
            this.updatePeerInfo(this.peer_name, this.peer_id, 'video', false);
            console.log('10 ----> VIDEO IS OFF');
        }

        if (this.joinRoomWithScreen && !this._moderator.screen_cant_share) {
            await this.produce(mediaType.screen, null, false, true);
            console.log('11 ----> START SCREEN MEDIA');
        }
        // if (this.isScreenAllowed) {
        //     this.shareScreen();
        // }
        console.log('[startLocalMedia] - PRODUCER LABEL', this.producerLabel);
    }

    async pauseAudioProducer() {
        setColor(startAudioButton, 'red');
        this.setIsAudio(this.peer_id, false);
        if (BUTTONS.main.startAudioButton) this.event(_EVENTS.stopAudio);
        await this.pauseProducer(mediaType.audio);
        console.log('09 ----> PAUSE AUDIO MEDIA');
        this.updatePeerInfo(this.peer_name, this.peer_id, 'audio', false);
    }

    // ####################################################
    // PRODUCER
    // ####################################################

    async produce(type, deviceId = null, swapCamera = false, init = false) {
        let mediaConstraints = {};
        let audio = false;
        let screen = false;
        switch (type) {
            case mediaType.audio:
                this.isAudioAllowed = true;
                mediaConstraints = this.getAudioConstraints(deviceId);
                audio = true;
                break;
            case mediaType.video:
                this.isVideoAllowed = true;
                swapCamera
                    ? (mediaConstraints = this.getCameraConstraints())
                    : (mediaConstraints = this.getVideoConstraints(deviceId));
                break;
            case mediaType.screen:
                mediaConstraints = this.getScreenConstraints();
                screen = true;
                break;
            default:
                return;
        }
        if (!this.device.canProduce('video') && !audio) {
            return console.error('Cannot produce video');
        }
        if (this.producerLabel.has(type)) {
            return console.warn('Producer already exists for this type ' + type);
        }

        const videoPrivacyBtn = this.getId(this.peer_id + '__vp');
        if (videoPrivacyBtn) videoPrivacyBtn.style.display = screen ? 'none' : 'inline';

        console.log(`Media constraints ${type}:`, mediaConstraints);

        let stream;
        try {
            if (init) {
                stream = initStream;
            } else {
                stream = screen
                    ? await navigator.mediaDevices.getDisplayMedia(mediaConstraints)
                    : await navigator.mediaDevices.getUserMedia(mediaConstraints);
            }

            console.log('Supported Constraints', navigator.mediaDevices.getSupportedConstraints());

            const track = audio ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];

            console.log(`${type} settings ->`, track.getSettings());

            const params = {
                track,
                appData: {
                    mediaType: type,
                },
            };

            if (audio) {
                console.log('AUDIO ENABLE OPUS');
                params.codecOptions = {
                    opusStereo: true,
                    opusDtx: true,
                    opusFec: true,
                    opusNack: true,
                };
            }

            if (!audio && !screen) {
                const { encodings, codec } = this.getWebCamEncoding();
                console.log('GET WEBCAM ENCODING', {
                    encodings: encodings,
                    codecs: codec,
                });
                params.encodings = encodings;
                params.codecs = codec;
                params.codecOptions = {
                    videoGoogleStartBitrate: 1000,
                };
            }

            if (!audio && screen) {
                const { encodings, codec } = this.getScreenEncoding();
                console.log('GET SCREEN ENCODING', {
                    encodings: encodings,
                    codecs: codec,
                });
                params.encodings = encodings;
                params.codecs = codec;
                params.codecOptions = {
                    videoGoogleStartBitrate: 1000,
                };
            }

            console.log('PRODUCER TYPE AND PARAMS', {
                type: type,
                params: params,
            });

            const producer = await this.producerTransport.produce(params);

            if (!producer) {
                throw new Error('Producer not found!');
            }

            this.producers.set(producer.id, producer);
            this.producerLabel.set(type, producer.id);

            // if screen sharing produce the tab audio + microphone
            if (screen && stream.getAudioTracks()[0]) {
                this.produceScreenAudio(stream);
            }

            let elem, au;
            if (!audio) {
                this.localVideoStream = stream;
                if (type == mediaType.video) this.videoProducerId = producer.id;
                if (type == mediaType.screen) this.screenProducerId = producer.id;
                elem = await this.handleProducer(producer.id, type, stream);
                //if (!screen && !isEnumerateDevices) enumerateVideoDevices(stream);
            } else {
                this.localAudioStream = stream;
                this.audioProducerId = producer.id;
                au = await this.handleProducer(producer.id, type, stream);
                //if (!isEnumerateDevices) enumerateAudioDevices(stream);
                getMicrophoneVolumeIndicator(stream);
            }

            if (type == mediaType.video) {
                this.handleHideMe();
            }

            producer.on('trackended', () => {
                console.log('Producer track ended', { id: producer.id });
                this.closeProducer(type);
            });

            producer.on('transportclose', () => {
                console.log('Producer transport close', { id: producer.id });
                if (!audio) {
                    const d = this.getId(producer.id + '__video');
                    elem.srcObject.getTracks().forEach(function (track) {
                        track.stop();
                    });
                    elem.parentNode.removeChild(elem);
                    d.parentNode.removeChild(d);

                    handleAspectRatio();
                    console.log('[transportClose] Video-element-count', this.videoMediaContainer.childElementCount);
                } else {
                    au.srcObject.getTracks().forEach(function (track) {
                        track.stop();
                    });
                    au.parentNode.removeChild(au);
                    console.log('[transportClose] audio-element-count', this.localAudioEl.childElementCount);
                }
                this.closeProducer(type);
            });

            producer.on('close', () => {
                console.log('Closing producer', { id: producer.id });
                if (!audio) {
                    const d = this.getId(producer.id + '__video');
                    elem.srcObject.getTracks().forEach(function (track) {
                        track.stop();
                    });
                    elem.parentNode.removeChild(elem);
                    d.parentNode.removeChild(d);

                    handleAspectRatio();
                    console.log('[closingProducer] Video-element-count', this.videoMediaContainer.childElementCount);
                } else {
                    au.srcObject.getTracks().forEach(function (track) {
                        track.stop();
                    });
                    au.parentNode.removeChild(au);
                    console.log('[closingProducer] audio-element-count', this.localAudioEl.childElementCount);
                }
                this.closeProducer(type);
            });

            switch (type) {
                case mediaType.audio:
                    this.setIsAudio(this.peer_id, true);
                    this.event(_EVENTS.startAudio);
                    break;
                case mediaType.video:
                    this.setIsVideo(true);
                    this.event(_EVENTS.startVideo);
                    break;
                case mediaType.screen:
                    this.setIsScreen(true);
                    this.event(_EVENTS.startScreen);
                    break;
                default:
                    break;
            }

            this.sound('joined');
            return producer;
        } catch (err) {
            console.error('Produce error:', err);

            handleMediaError(type, err);

            if (!audio && !screen && videoQuality.selectedIndex != 0) {
                videoQuality.selectedIndex = this.videoQualitySelectedIndex;
                this.sound('alert');
                this.userLog(
                    'error',
                    `Your device doesn't support the selected video quality (${videoQuality.value}), please select the another one.`,
                    'top-end',
                );
            }
        }
    }

    // ####################################################
    // AUDIO/VIDEO CONSTRAINTS
    // ####################################################

    getAudioConstraints(deviceId) {
        let constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                deviceId: deviceId,
            },
            video: false,
        };
        if (isRulesActive && isPresenter) {
            constraints = {
                audio: {
                    autoGainControl: switchAutoGainControl.checked,
                    echoCancellation: switchNoiseSuppression.checked,
                    noiseSuppression: switchEchoCancellation.checked,
                    sampleRate: parseInt(sampleRateSelect.value),
                    sampleSize: parseInt(sampleSizeSelect.value),
                    channelCount: parseInt(channelCountSelect.value),
                    latency: parseInt(micLatencyRange.value),
                    volume: parseInt(micVolumeRange.value / 100),
                    deviceId: deviceId,
                },
                video: false,
            };
        }
        return constraints;
    }

    getCameraConstraints() {
        this.camera = this.camera == 'user' ? 'environment' : 'user';
        if (this.camera != 'user') this.camVideo = { facingMode: { exact: this.camera } };
        else this.camVideo = true;
        return {
            audio: false,
            video: this.camVideo,
        };
    }

    getVideoConstraints(deviceId) {
        const defaultFrameRate = {
            min: 5,
            ideal: 15,
            max: 30,
        };
        const selectedValue = this.getSelectedIndexValue(videoFps);
        const customFrameRate = parseInt(selectedValue, 10);
        const frameRate = selectedValue == 'max' ? defaultFrameRate : customFrameRate;
        let videoConstraints = {
            audio: false,
            video: {
                width: {
                    min: 640,
                    ideal: 1920,
                    max: 3840,
                },
                height: {
                    min: 480,
                    ideal: 1080,
                    max: 2160,
                },
                deviceId: deviceId,
                aspectRatio: 1.777, // 16:9
                frameRate: frameRate,
            },
        }; // Init auto detect max cam resolution and fps

        videoFps.disabled = false;

        switch (videoQuality.value) {
            case 'default':
                // This will make the browser use HD Video and 30fps as default.
                videoConstraints = {
                    audio: false,
                    video: {
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                        deviceId: deviceId,
                        aspectRatio: 1.777,
                    },
                };
                videoFps.selectedIndex = 0;
                videoFps.disabled = true;
                break;
            case 'qvga':
                videoConstraints = {
                    audio: false,
                    video: {
                        width: { exact: 320 },
                        height: { exact: 240 },
                        deviceId: deviceId,
                        aspectRatio: 1.777,
                        frameRate: frameRate,
                    },
                }; // video cam constraints low bandwidth
                break;
            case 'vga':
                videoConstraints = {
                    audio: false,
                    video: {
                        width: { exact: 640 },
                        height: { exact: 480 },
                        deviceId: deviceId,
                        aspectRatio: 1.777,
                        frameRate: frameRate,
                    },
                }; // video cam constraints medium bandwidth
                break;
            case 'hd':
                videoConstraints = {
                    audio: false,
                    video: {
                        width: { exact: 1280 },
                        height: { exact: 720 },
                        deviceId: deviceId,
                        aspectRatio: 1.777,
                        frameRate: frameRate,
                    },
                }; // video cam constraints high bandwidth
                break;
            case 'fhd':
                videoConstraints = {
                    audio: false,
                    video: {
                        width: { exact: 1920 },
                        height: { exact: 1080 },
                        deviceId: deviceId,
                        aspectRatio: 1.777,
                        frameRate: frameRate,
                    },
                }; // video cam constraints very high bandwidth
                break;
            case '2k':
                videoConstraints = {
                    audio: false,
                    video: {
                        width: { exact: 2560 },
                        height: { exact: 1440 },
                        deviceId: deviceId,
                        aspectRatio: 1.777,
                        frameRate: frameRate,
                    },
                }; // video cam constraints ultra high bandwidth
                break;
            case '4k':
                videoConstraints = {
                    audio: false,
                    video: {
                        width: { exact: 3840 },
                        height: { exact: 2160 },
                        deviceId: deviceId,
                        aspectRatio: 1.777,
                        frameRate: frameRate,
                    },
                }; // video cam constraints ultra high bandwidth
                break;
            default:
                break;
        }
        this.videoQualitySelectedIndex = videoQuality.selectedIndex;
        return videoConstraints;
    }

    getScreenConstraints() {
        const selectedValue = this.getSelectedIndexValue(screenFps);
        const frameRate = selectedValue == 'max' ? 30 : parseInt(selectedValue, 10);
        return {
            audio: true,
            video: {
                width: { max: 1920 },
                height: { max: 1080 },
                frameRate: frameRate,
            },
        };
    }

    // ####################################################
    // WEBCAM ENCODING
    // ####################################################

    getWebCamEncoding() {
        let encodings;
        let codec;

        console.log('WEBCAM ENCODING', {
            forceVP8: this.forceVP8,
            forceVP9: this.forceVP9,
            forceH264: this.forceH264,
            numSimulcastStreamsWebcam: this.numSimulcastStreamsWebcam,
            enableWebcamLayers: this.enableWebcamLayers,
            webcamScalabilityMode: this.webcamScalabilityMode,
        });

        if (this.forceVP8) {
            codec = this.device.rtpCapabilities.codecs.find((c) => c.mimeType.toLowerCase() === 'video/vp8');
            if (!codec) throw new Error('Desired VP8 codec+configuration is not supported');
        } else if (this.forceH264) {
            codec = this.device.rtpCapabilities.codecs.find((c) => c.mimeType.toLowerCase() === 'video/h264');
            if (!codec) throw new Error('Desired H264 codec+configuration is not supported');
        } else if (this.forceVP9) {
            codec = this.device.rtpCapabilities.codecs.find((c) => c.mimeType.toLowerCase() === 'video/vp9');
            if (!codec) throw new Error('Desired VP9 codec+configuration is not supported');
        }

        if (this.enableWebcamLayers) {
            console.log('WEBCAM SIMULCAST/SVC ENABLED');

            const firstVideoCodec = this.device.rtpCapabilities.codecs.find((c) => c.kind === 'video');
            console.log('WEBCAM ENCODING: first codec available', { firstVideoCodec: firstVideoCodec });

            // If VP9 is the only available video codec then use SVC.
            if ((this.forceVP9 && codec) || firstVideoCodec.mimeType.toLowerCase() === 'video/vp9') {
                console.log('WEBCAM ENCODING: VP9 with SVC');
                encodings = [
                    {
                        maxBitrate: 5000000,
                        scalabilityMode: this.webcamScalabilityMode || 'L3T3_KEY',
                    },
                ];
            } else {
                console.log('WEBCAM ENCODING: VP8 or H264 with simulcast');
                encodings = [
                    {
                        scaleResolutionDownBy: 1,
                        maxBitrate: 5000000,
                        scalabilityMode: this.webcamScalabilityMode || 'L1T3',
                    },
                ];
                if (this.numSimulcastStreamsWebcam > 1) {
                    encodings.unshift({
                        scaleResolutionDownBy: 2,
                        maxBitrate: 1000000,
                        scalabilityMode: this.webcamScalabilityMode || 'L1T3',
                    });
                }
                if (this.numSimulcastStreamsWebcam > 2) {
                    encodings.unshift({
                        scaleResolutionDownBy: 4,
                        maxBitrate: 500000,
                        scalabilityMode: this.webcamScalabilityMode || 'L1T3',
                    });
                }
            }
        }
        return { encodings, codec };
    }

    // ####################################################
    // SCREEN ENCODING
    // ####################################################

    getScreenEncoding() {
        let encodings;
        let codec;

        console.log('SCREEN ENCODING', {
            forceVP8: this.forceVP8,
            forceVP9: this.forceVP9,
            forceH264: this.forceH264,
            numSimulcastStreamsSharing: this.numSimulcastStreamsSharing,
            enableSharingLayers: this.enableSharingLayers,
            sharingScalabilityMode: this.sharingScalabilityMode,
        });

        if (this.forceVP8) {
            codec = this.device.rtpCapabilities.codecs.find((c) => c.mimeType.toLowerCase() === 'video/vp8');
            if (!codec) throw new Error('Desired VP8 codec+configuration is not supported');
        } else if (this.forceH264) {
            codec = this.device.rtpCapabilities.codecs.find((c) => c.mimeType.toLowerCase() === 'video/h264');
            if (!codec) throw new Error('Desired H264 codec+configuration is not supported');
        } else if (this.forceVP9) {
            codec = this.device.rtpCapabilities.codecs.find((c) => c.mimeType.toLowerCase() === 'video/vp9');
            if (!codec) throw new Error('Desired VP9 codec+configuration is not supported');
        }

        if (this.enableSharingLayers) {
            console.log('SCREEN SIMULCAST/SVC ENABLED');

            const firstVideoCodec = this.device.rtpCapabilities.codecs.find((c) => c.kind === 'video');
            console.log('SCREEN ENCODING: first codec available', { firstVideoCodec: firstVideoCodec });

            // If VP9 is the only available video codec then use SVC.
            if ((this.forceVP9 && codec) || firstVideoCodec.mimeType.toLowerCase() === 'video/vp9') {
                console.log('SCREEN ENCODING: VP9 with SVC');
                encodings = [
                    {
                        maxBitrate: 5000000,
                        scalabilityMode: this.sharingScalabilityMode || 'L3T3',
                        dtx: true,
                    },
                ];
            } else {
                console.log('SCREEN ENCODING: VP8 or H264 with simulcast.');
                encodings = [
                    {
                        scaleResolutionDownBy: 1,
                        maxBitrate: 5000000,
                        scalabilityMode: this.sharingScalabilityMode || 'L1T3',
                        dtx: true,
                    },
                ];
                if (this.numSimulcastStreamsSharing > 1) {
                    encodings.unshift({
                        scaleResolutionDownBy: 2,
                        maxBitrate: 1000000,
                        scalabilityMode: this.sharingScalabilityMode || 'L1T3',
                        dtx: true,
                    });
                }
                if (this.numSimulcastStreamsSharing > 2) {
                    encodings.unshift({
                        scaleResolutionDownBy: 4,
                        maxBitrate: 500000,
                        scalabilityMode: this.sharingScalabilityMode || 'L1T3',
                        dtx: true,
                    });
                }
            }
        }
        return { encodings, codec };
    }

    // ####################################################
    // PRODUCER
    // ####################################################

    handleHideMe() {
        //const myScreenWrap = this.getId(this.screenProducerId + '__video');
        const myVideoWrap = this.getId(this.videoProducerId + '__video');
        const myVideoWrapOff = this.getId(this.peer_id + '__videoOff');
        const myVideoPinBtn = this.getId(this.videoProducerId + '__pin');
        const myScreenPinBtn = this.getId(this.screenProducerId + '__pin');
        console.log('handleHideMe', {
            isHideMeActive: isHideMeActive,
            //myScreenWrap: myScreenWrap ? myScreenWrap.id : null,
            myVideoWrap: myVideoWrap ? myVideoWrap.id : null,
            myVideoWrapOff: myVideoWrapOff ? myVideoWrapOff.id : null,
            myVideoPinBtn: myVideoPinBtn ? myVideoPinBtn.id : null,
            myScreenPinBtn: myScreenPinBtn ? myScreenPinBtn.id : null,
        });
        //if (myScreenWrap) myScreenWrap.style.display = isHideMeActive ? 'none' : 'block';
        if (isHideMeActive && this.isVideoPinned && myVideoPinBtn) myVideoPinBtn.click();
        if (isHideMeActive && this.isVideoPinned && myScreenPinBtn) myScreenPinBtn.click();
        if (myVideoWrap) myVideoWrap.style.display = isHideMeActive ? 'none' : 'block';
        if (myVideoWrapOff) myVideoWrapOff.style.display = isHideMeActive ? 'none' : 'block';
        hideMeIcon.className = isHideMeActive ? html.hideMeOn : html.hideMeOff;
        hideMeIcon.style.color = isHideMeActive ? 'red' : 'white';
        isHideMeActive ? this.sound('left') : this.sound('joined');
        resizeVideoMedia();
    }

    producerExist(type) {
        return this.producerLabel.has(type);
    }

    closeThenProduce(type, deviceId = null, swapCamera = false) {
        this.closeProducer(type);
        setTimeout(async function () {
            await rc.produce(type, deviceId, swapCamera);
        }, 1000);
    }

    async handleProducer(id, type, stream) {
        let elem, vb, vp, ts, d, p, i, au, pip, fs, pm, pb, pn;
        switch (type) {
            case mediaType.video:
            case mediaType.screen:
                let isScreen = type === mediaType.screen;
                this.removeVideoOff(this.peer_id);
                d = document.createElement('div');
                d.className = 'Camera';
                d.id = id + '__video';
                elem = document.createElement('video');
                elem.setAttribute('id', id);
                !isScreen && elem.setAttribute('name', this.peer_id);
                elem.setAttribute('playsinline', true);
                elem.controls = isVideoControlsOn;
                elem.autoplay = true;
                elem.muted = true;
                elem.volume = 0;
                elem.poster = image.poster;
                elem.style.objectFit = isScreen || isBroadcastingEnabled ? 'contain' : 'var(--videoObjFit)';
                elem.className = this.isMobileDevice || isScreen ? '' : 'mirror';
                vb = document.createElement('div');
                vb.setAttribute('id', this.peer_id + '__vb');
                vb.className = 'videoMenuBar fadein';
                pip = document.createElement('button');
                pip.id = id + '__pictureInPicture';
                pip.className = html.pip;
                fs = document.createElement('button');
                fs.id = id + '__fullScreen';
                fs.className = html.fullScreen;
                ts = document.createElement('button');
                ts.id = id + '__snapshot';
                ts.className = html.snapshot;
                pn = document.createElement('button');
                pn.id = id + '__pin';
                pn.className = html.pin;
                vp = document.createElement('button');
                vp.id = this.peer_id + +'__vp';
                vp.className = html.videoPrivacy;
                au = document.createElement('button');
                au.id = this.peer_id + '__audio';
                au.className = this.peer_info.peer_audio ? html.audioOn : html.audioOff;
                au.style.cursor = 'default';
                p = document.createElement('p');
                p.id = this.peer_id + '__name';
                p.className = html.userName;
                p.innerText = (isPresenter ? '⭐️ ' : '') + this.peer_name + ' (me)';
                i = document.createElement('i');
                i.id = this.peer_id + '__hand';
                i.className = html.userHand;
                pm = document.createElement('div');
                pb = document.createElement('div');
                pm.setAttribute('id', this.peer_id + '_pitchMeter');
                pb.setAttribute('id', this.peer_id + '_pitchBar');
                pm.className = 'speechbar';
                pb.className = 'bar';
                pb.style.height = '1%';
                pm.appendChild(pb);
                BUTTONS.producerVideo.muteAudioButton && vb.appendChild(au);
                BUTTONS.producerVideo.videoPrivacyButton && !isScreen && vb.appendChild(vp);
                BUTTONS.producerVideo.snapShotButton && vb.appendChild(ts);
                BUTTONS.producerVideo.videoPictureInPicture &&
                    this.isVideoPictureInPictureSupported &&
                    vb.appendChild(pip);
                BUTTONS.producerVideo.fullScreenButton && this.isVideoFullScreenSupported && vb.appendChild(fs);
                if (!this.isMobileDevice) vb.appendChild(pn);
                d.appendChild(elem);
                d.appendChild(pm);
                d.appendChild(i);
                d.appendChild(p);
                d.appendChild(vb);
                this.videoMediaContainer.appendChild(d);
                this.attachMediaStream(elem, stream, type, 'Producer');
                this.myVideoEl = elem;
                this.isVideoPictureInPictureSupported && this.handlePIP(elem.id, pip.id);
                this.isVideoFullScreenSupported && this.handleFS(elem.id, fs.id);
                this.handleDD(elem.id, this.peer_id, true);
                this.handleTS(elem.id, ts.id);
                this.handlePN(elem.id, pn.id, d.id, isScreen);
                this.handleZV(elem.id, d.id, this.peer_id);
                if (!isScreen) this.handleVP(elem.id, vp.id);
                this.popupPeerInfo(p.id, this.peer_info);
                this.checkPeerInfoStatus(this.peer_info);
                if (isScreen) pn.click();
                handleAspectRatio();
                if (!this.isMobileDevice) {
                    this.setTippy(pn.id, 'Toggle Pin', 'bottom');
                    this.setTippy(pip.id, 'Toggle picture in picture', 'bottom');
                    this.setTippy(ts.id, 'Snapshot', 'bottom');
                    this.setTippy(vp.id, 'Toggle video privacy', 'bottom');
                    this.setTippy(au.id, 'Audio status', 'bottom');
                }
                console.log('[addProducer] Video-element-count', this.videoMediaContainer.childElementCount);
                break;
            case mediaType.audio:
                elem = document.createElement('audio');
                elem.id = id + '__localAudio';
                elem.controls = false;
                elem.autoplay = true;
                elem.muted = true;
                elem.volume = 0;
                this.myAudioEl = elem;
                this.localAudioEl.appendChild(elem);
                this.attachMediaStream(elem, stream, type, 'Producer');
                console.log('[addProducer] audio-element-count', this.localAudioEl.childElementCount);
                break;
            default:
                break;
        }
        return elem;
    }

    async pauseProducer(type) {
        if (!this.producerLabel.has(type)) {
            return console.warn('There is no producer for this type ' + type);
        }

        const producer_id = this.producerLabel.get(type);
        this.producers.get(producer_id).pause();

        try {
            const response = await this.socket.request('pauseProducer', { producer_id: producer_id });
            console.log('Producer paused', response);
        } catch (error) {
            console.error('Error pausing producer', error);
        }

        switch (type) {
            case mediaType.audio:
                this.event(_EVENTS.pauseAudio);
                this.setIsAudio(this.peer_id, false);
                break;
            case mediaType.video:
                this.event(_EVENTS.pauseVideo);
                break;
            case mediaType.screen:
                this.event(_EVENTS.pauseScreen);
                break;
            default:
                return;
        }
    }

    async resumeProducer(type) {
        if (!this.producerLabel.has(type)) {
            return console.warn('There is no producer for this type ' + type);
        }

        const producer_id = this.producerLabel.get(type);
        this.producers.get(producer_id).resume();

        try {
            const response = await this.socket.request('resumeProducer', { producer_id: producer_id });
            console.log('Producer resumed', response);
        } catch (error) {
            console.error('Error resuming producer', error);
        }

        switch (type) {
            case mediaType.audio:
                this.event(_EVENTS.resumeAudio);
                this.setIsAudio(this.peer_id, true);
                break;
            case mediaType.video:
                this.event(_EVENTS.resumeVideo);
                break;
            case mediaType.screen:
                this.event(_EVENTS.resumeScreen);
                break;
            default:
                return;
        }
    }

    closeProducer(type) {
        if (!this.producerLabel.has(type)) {
            return console.warn('There is no producer for this type ' + type);
        }

        const producer_id = this.producerLabel.get(type);

        const data = {
            peer_name: this.peer_name,
            producer_id: producer_id,
            type: type,
            status: false,
        };
        console.log(`Close producer ${type}`, data);

        this.socket.emit('producerClosed', data);

        this.producers.get(producer_id).close();
        this.producers.delete(producer_id);
        this.producerLabel.delete(type);

        console.log('[closeProducer] - PRODUCER LABEL', this.producerLabel);

        if (type !== mediaType.audio) {
            const elem = this.getId(producer_id);
            const d = this.getId(producer_id + '__video');
            elem.srcObject.getTracks().forEach(function (track) {
                track.stop();
            });
            d.parentNode.removeChild(d);

            //alert(this.pinnedVideoPlayerId + '==' + producer_id);
            if (this.isVideoPinned && this.pinnedVideoPlayerId == producer_id) {
                this.removeVideoPinMediaContainer();
                console.log('Remove pin container due the Producer close', {
                    producer_id: producer_id,
                    producer_type: type,
                });
            }

            handleAspectRatio();

            console.log('[producerClose] Video-element-count', this.videoMediaContainer.childElementCount);
        }

        if (type === mediaType.audio) {
            const au = this.getId(producer_id + '__localAudio');
            au.srcObject.getTracks().forEach(function (track) {
                track.stop();
            });
            this.localAudioEl.removeChild(au);
            console.log('[producerClose] Audio-element-count', this.localAudioEl.childElementCount);
        }

        switch (type) {
            case mediaType.audio:
                this.setIsAudio(this.peer_id, false);
                this.event(_EVENTS.stopAudio);
                break;
            case mediaType.video:
                this.setIsVideo(false);
                this.event(_EVENTS.stopVideo);
                break;
            case mediaType.screen:
                this.setIsScreen(false);
                this.event(_EVENTS.stopScreen);
                break;
            default:
                break;
        }

        this.sound('left');
    }

    async produceScreenAudio(stream) {
        try {
            if (this.producerLabel.has(mediaType.audioTab)) {
                return console.warn('Producer already exists for this type ' + mediaType.audioTab);
            }

            const track = stream.getAudioTracks()[0];
            const params = {
                track,
                appData: {
                    mediaType: mediaType.audio,
                },
            };

            const producerSa = await this.producerTransport.produce(params);

            console.log('PRODUCER SCREEN AUDIO', producerSa);

            this.producers.set(producerSa.id, producerSa);
            this.producerLabel.set(mediaType.audioTab, producerSa.id);

            console.log('[produceScreenAudio] - PRODUCER LABEL', this.producerLabel);

            const sa = await this.handleProducer(producerSa.id, mediaType.audio, stream);

            producerSa.on('trackended', () => {
                console.log('Producer Screen audio track ended', { id: producerSa.id });
                this.closeProducer(mediaType.audioTab);
            });

            producerSa.on('transportclose', () => {
                console.log('Producer Screen audio transport close', { id: producerSa.id });
                sa.srcObject.getTracks().forEach(function (track) {
                    track.stop();
                });
                sa.parentNode.removeChild(sa);
                console.log('[transportClose] audio-element-count', this.localAudioEl.childElementCount);
                this.closeProducer(mediaType.audioTab);
            });

            producerSa.on('close', () => {
                console.log('Closing Screen audio producer', { id: producerSa.id });
                sa.srcObject.getTracks().forEach(function (track) {
                    track.stop();
                });
                sa.parentNode.removeChild(sa);
                console.log('[closingProducer] audio-element-count', this.localAudioEl.childElementCount);
                this.closeProducer(mediaType.audioTab);
            });
        } catch (err) {
            console.error('Produce error:', err);
        }
    }

    // ####################################################
    // CONSUMER
    // ####################################################

    async consume(producer_id, peer_name, peer_info, type) {
        try {
            wbUpdate();

            const { consumer, stream, kind } = await this.getConsumeStream(producer_id, peer_info.peer_id, type);

            console.log('CONSUMER MEDIA TYPE ----> ' + type);
            console.log('CONSUMER', consumer);

            this.consumers.set(consumer.id, consumer);

            // https://mediasoup.discourse.group/t/create-server-side-consumers-with-paused-true/244
            try {
                const response = await this.socket.request('resumeConsumer', { consumer_id: consumer.id });
                console.log('Consumer resumed', response);
            } catch (error) {
                console.error('Error resuming consumer', error);
            }

            consumer.on('trackended', () => {
                console.log('Consumer track end', { id: consumer.id });
                this.removeConsumer(consumer.id, consumer.kind);
            });

            consumer.on('transportclose', () => {
                console.log('Consumer transport close', { id: consumer.id });
                this.removeConsumer(consumer.id, consumer.kind);
            });

            this.handleConsumer(consumer.id, type, stream, peer_name, peer_info);

            if (kind === 'video' && isParticipantsListOpen) {
                await getRoomParticipants();
            }
        } catch (error) {
            console.error('Error in consume', error);
        }
    }

    async getConsumeStream(producerId, peer_id, type) {
        const { rtpCapabilities } = this.device;

        const data = await this.socket.request('consume', {
            rtpCapabilities,
            consumerTransportId: this.consumerTransport.id,
            producerId,
        });

        console.log('DATA', data);

        const { id, kind, rtpParameters } = data;
        const codecOptions = {};
        const streamId = peer_id + (type == mediaType.screen ? '-screen-sharing' : '-mic-webcam');
        const consumer = await this.consumerTransport.consume({
            id,
            producerId,
            kind,
            rtpParameters,
            codecOptions,
            streamId,
        });

        const stream = new MediaStream();
        stream.addTrack(consumer.track);

        return {
            consumer,
            stream,
            kind,
        };
    }

    handleConsumer(id, type, stream, peer_name, peer_info) {
        let elem, vb, d, p, i, cm, au, pip, fs, ts, sf, sm, sv, gl, ban, ko, pb, pm, pv, pn;

        let eDiv, eBtn, eVc; // expand buttons

        console.log('PEER-INFO', peer_info);

        const remotePeerId = peer_info.peer_id;
        const remoteIsScreen = type == mediaType.screen;
        const remotePeerAudio = peer_info.peer_audio;
        const remotePrivacyOn = peer_info.peer_video_privacy;
        const remotePeerPresenter = peer_info.peer_presenter;

        switch (type) {
            case mediaType.video:
            case mediaType.screen:
                this.removeVideoOff(remotePeerId);
                d = document.createElement('div');
                d.className = 'Camera';
                d.id = id + '__video';
                elem = document.createElement('video');
                elem.setAttribute('id', id);
                !remoteIsScreen && elem.setAttribute('name', remotePeerId);
                elem.setAttribute('playsinline', true);
                elem.controls = isVideoControlsOn;
                elem.autoplay = true;
                elem.className = '';
                elem.poster = image.poster;
                elem.style.objectFit = remoteIsScreen || isBroadcastingEnabled ? 'contain' : 'var(--videoObjFit)';
                vb = document.createElement('div');
                vb.setAttribute('id', remotePeerId + '__vb');
                vb.className = 'videoMenuBar fadein';

                eDiv = document.createElement('div');
                eDiv.className = 'expand-video';
                eBtn = document.createElement('button');
                eBtn.id = remotePeerId + '_videoExpandBtn';
                eBtn.className = html.expand;
                eVc = document.createElement('div');
                eVc.className = 'expand-video-content';

                pv = document.createElement('input');
                pv.id = remotePeerId + '___pVolume';
                pv.type = 'range';
                pv.min = 0;
                pv.max = 100;
                pv.value = 100;
                pip = document.createElement('button');
                pip.id = id + '__pictureInPicture';
                pip.className = html.pip;
                fs = document.createElement('button');
                fs.id = id + '__fullScreen';
                fs.className = html.fullScreen;
                ts = document.createElement('button');
                ts.id = id + '__snapshot';
                ts.className = html.snapshot;
                pn = document.createElement('button');
                pn.id = id + '__pin';
                pn.className = html.pin;
                sf = document.createElement('button');
                sf.id = id + '___' + remotePeerId + '___sendFile';
                sf.className = html.sendFile;
                sm = document.createElement('button');
                sm.id = id + '___' + remotePeerId + '___sendMsg';
                sm.className = html.sendMsg;
                sv = document.createElement('button');
                sv.id = id + '___' + remotePeerId + '___sendVideo';
                sv.className = html.sendVideo;
                cm = document.createElement('button');
                cm.id = id + '___' + remotePeerId + '___video';
                cm.className = html.videoOn;
                au = document.createElement('button');
                au.id = remotePeerId + '__audio';
                au.className = remotePeerAudio ? html.audioOn : html.audioOff;
                gl = document.createElement('button');
                gl.id = id + '___' + remotePeerId + '___geoLocation';
                gl.className = html.geolocation;
                ban = document.createElement('button');
                ban.id = id + '___' + remotePeerId + '___ban';
                ban.className = html.ban;
                ko = document.createElement('button');
                ko.id = id + '___' + remotePeerId + '___kickOut';
                ko.className = html.kickOut;
                i = document.createElement('i');
                i.id = remotePeerId + '__hand';
                i.className = html.userHand;
                p = document.createElement('p');
                p.id = remotePeerId + '__name';
                p.className = html.userName;
                p.innerText = (remotePeerPresenter ? '⭐️ ' : '') + peer_name;
                pm = document.createElement('div');
                pb = document.createElement('div');
                pm.setAttribute('id', remotePeerId + '__pitchMeter');
                pb.setAttribute('id', remotePeerId + '__pitchBar');
                pm.className = 'speechbar';
                pb.className = 'bar';
                pb.style.height = '1%';
                pm.appendChild(pb);

                BUTTONS.consumerVideo.sendMessageButton && eVc.appendChild(sm);
                BUTTONS.consumerVideo.sendFileButton && eVc.appendChild(sf);
                BUTTONS.consumerVideo.sendVideoButton && eVc.appendChild(sv);
                BUTTONS.consumerVideo.geolocationButton && eVc.appendChild(gl);
                BUTTONS.consumerVideo.banButton && eVc.appendChild(ban);
                BUTTONS.consumerVideo.ejectButton && eVc.appendChild(ko);
                eDiv.appendChild(eBtn);
                eDiv.appendChild(eVc);

                vb.appendChild(eDiv);
                BUTTONS.consumerVideo.audioVolumeInput && !this.isMobileDevice && vb.appendChild(pv);
                vb.appendChild(au);
                vb.appendChild(cm);
                BUTTONS.consumerVideo.snapShotButton && vb.appendChild(ts);
                BUTTONS.consumerVideo.videoPictureInPicture &&
                    this.isVideoPictureInPictureSupported &&
                    vb.appendChild(pip);
                BUTTONS.consumerVideo.fullScreenButton && this.isVideoFullScreenSupported && vb.appendChild(fs);
                if (!this.isMobileDevice) vb.appendChild(pn);
                d.appendChild(elem);
                d.appendChild(i);
                d.appendChild(p);
                d.appendChild(pm);
                d.appendChild(vb);
                this.videoMediaContainer.appendChild(d);
                this.attachMediaStream(elem, stream, type, 'Consumer');
                this.isVideoPictureInPictureSupported && this.handlePIP(elem.id, pip.id);
                this.isVideoFullScreenSupported && this.handleFS(elem.id, fs.id);
                this.handleDD(elem.id, remotePeerId);
                this.handleTS(elem.id, ts.id);
                this.handleSF(sf.id);
                this.handleSM(sm.id, peer_name);
                this.handleSV(sv.id);
                BUTTONS.consumerVideo.muteVideoButton && this.handleCM(cm.id);
                BUTTONS.consumerVideo.muteAudioButton && this.handleAU(au.id);
                this.handlePV(id + '___' + pv.id);
                this.handleGL(gl.id);
                this.handleBAN(ban.id);
                this.handleKO(ko.id);
                this.handlePN(elem.id, pn.id, d.id, remoteIsScreen);
                this.handleZV(elem.id, d.id, remotePeerId);
                this.popupPeerInfo(p.id, peer_info);
                this.checkPeerInfoStatus(peer_info);
                if (!remoteIsScreen && remotePrivacyOn) this.setVideoPrivacyStatus(remotePeerId, remotePrivacyOn);
                if (remoteIsScreen) pn.click();
                this.sound('joined');
                handleAspectRatio();
                console.log('[addConsumer] Video-element-count', this.videoMediaContainer.childElementCount);
                if (!this.isMobileDevice) {
                    this.setTippy(pn.id, 'Toggle Pin', 'bottom');
                    this.setTippy(pip.id, 'Toggle picture in picture', 'bottom');
                    this.setTippy(ts.id, 'Snapshot', 'bottom');
                    this.setTippy(sf.id, 'Send file', 'bottom');
                    this.setTippy(sm.id, 'Send message', 'bottom');
                    this.setTippy(sv.id, 'Send video', 'bottom');
                    this.setTippy(cm.id, 'Hide', 'bottom');
                    this.setTippy(au.id, 'Mute', 'bottom');
                    this.setTippy(pv.id, '🔊 Volume', 'bottom');
                    this.setTippy(gl.id, 'Geolocation', 'bottom');
                    this.setTippy(ban.id, 'Ban', 'bottom');
                    this.setTippy(ko.id, 'Eject', 'bottom');
                }
                this.setPeerAudio(remotePeerId, remotePeerAudio);
                break;
            case mediaType.audio:
                elem = document.createElement('audio');
                elem.id = id;
                elem.autoplay = true;
                elem.audio = 1.0;
                this.remoteAudioEl.appendChild(elem);
                this.attachMediaStream(elem, stream, type, 'Consumer');
                let audioConsumerId = remotePeerId + '___pVolume';
                this.audioConsumers.set(audioConsumerId, id);
                let inputPv = this.getId(audioConsumerId);
                if (inputPv) {
                    this.handlePV(id + '___' + audioConsumerId);
                    this.setPeerAudio(remotePeerId, remotePeerAudio);
                }
                if (sinkId && speakerSelect.value) {
                    this.changeAudioDestination(elem);
                }
                //elem.addEventListener('play', () => { elem.volume = 0.1 });
                console.log('[Add audioConsumers]', this.audioConsumers);
                break;
            default:
                break;
        }
        return elem;
    }

    removeConsumer(consumer_id, consumer_kind) {
        console.log('Remove consumer', { consumer_id: consumer_id, consumer_kind: consumer_kind });

        const elem = this.getId(consumer_id);
        if (elem) {
            elem.srcObject.getTracks().forEach(function (track) {
                track.stop();
            });
            elem.parentNode.removeChild(elem);
        }

        if (consumer_kind === 'video') {
            const d = this.getId(consumer_id + '__video');
            if (d) {
                d.parentNode.removeChild(d);
                //alert(this.pinnedVideoPlayerId + '==' + consumer_id);
                if (this.isVideoPinned && this.pinnedVideoPlayerId == consumer_id) {
                    this.removeVideoPinMediaContainer();
                    console.log('Remove pin container due the Consumer close', {
                        consumer_id: consumer_id,
                        consumer_kind: consumer_kind,
                    });
                }
            }

            handleAspectRatio();
            console.log(
                '[removeConsumer - ' + consumer_kind + '] Video-element-count',
                this.videoMediaContainer.childElementCount,
            );
        }

        if (consumer_kind === 'audio') {
            const audioConsumerPlayerId = this.getMapKeyByValue(this.audioConsumers, consumer_id);
            if (audioConsumerPlayerId) {
                const inputPv = this.getId(audioConsumerPlayerId);
                if (inputPv) inputPv.style.display = 'none';
                this.audioConsumers.delete(audioConsumerPlayerId);
                console.log('Remove audio Consumer', {
                    consumer_id: consumer_id,
                    audioConsumerPlayerId: audioConsumerPlayerId,
                    audioConsumers: this.audioConsumers,
                });
            }
        }

        this.consumers.delete(consumer_id);
        this.sound('left');
    }

    // ####################################################
    // HANDLE VIDEO OFF
    // ####################################################

    setVideoOff(peer_info, remotePeer = false) {
        //console.log('setVideoOff', peer_info);
        let d, vb, i, h, au, sf, sm, sv, gl, ban, ko, p, pm, pb, pv;

        const { peer_id, peer_name, peer_audio, peer_presenter } = peer_info;

        this.removeVideoOff(peer_id);
        d = document.createElement('div');
        d.className = 'Camera';
        d.id = peer_id + '__videoOff';
        vb = document.createElement('div');
        vb.setAttribute('id', peer_id + 'vb');
        vb.className = 'videoMenuBar fadein';
        au = document.createElement('button');
        au.id = peer_id + '__audio';
        au.className = peer_audio ? html.audioOn : html.audioOff;
        if (remotePeer) {
            pv = document.createElement('input');
            pv.id = peer_id + '___pVolume';
            pv.type = 'range';
            pv.min = 0;
            pv.max = 100;
            pv.value = 100;
            sf = document.createElement('button');
            sf.id = 'remotePeer___' + peer_id + '___sendFile';
            sf.className = html.sendFile;
            sm = document.createElement('button');
            sm.id = 'remotePeer___' + peer_id + '___sendMsg';
            sm.className = html.sendMsg;
            sv = document.createElement('button');
            sv.id = 'remotePeer___' + peer_id + '___sendVideo';
            sv.className = html.sendVideo;
            gl = document.createElement('button');
            gl.id = 'remotePeer___' + peer_id + '___geoLocation';
            gl.className = html.geolocation;
            ban = document.createElement('button');
            ban.id = 'remotePeer___' + peer_id + '___ban';
            ban.className = html.ban;
            ko = document.createElement('button');
            ko.id = 'remotePeer___' + peer_id + '___kickOut';
            ko.className = html.kickOut;
        }
        i = document.createElement('img');
        i.className = 'videoAvatarImage center'; // pulsate
        i.id = peer_id + '__img';
        p = document.createElement('p');
        p.id = peer_id + '__name';
        p.className = html.userName;
        p.innerText = (peer_presenter ? '⭐️ ' : '') + peer_name + (remotePeer ? '' : ' (me) ');
        h = document.createElement('i');
        h.id = peer_id + '__hand';
        h.className = html.userHand;
        pm = document.createElement('div');
        pb = document.createElement('div');
        pm.setAttribute('id', peer_id + '__pitchMeter');
        pb.setAttribute('id', peer_id + '__pitchBar');
        pm.className = 'speechbar';
        pb.className = 'bar';
        pb.style.height = '1%';
        pm.appendChild(pb);
        if (remotePeer) {
            BUTTONS.videoOff.ejectButton && vb.appendChild(ko);
            BUTTONS.videoOff.banButton && vb.appendChild(ban);
            BUTTONS.videoOff.geolocationButton && vb.appendChild(gl);
            BUTTONS.videoOff.sendVideoButton && vb.appendChild(sv);
            BUTTONS.videoOff.sendFileButton && vb.appendChild(sf);
            BUTTONS.videoOff.sendMessageButton && vb.appendChild(sm);
            BUTTONS.videoOff.audioVolumeInput && !this.isMobileDevice && vb.appendChild(pv);
        }
        vb.appendChild(au);
        d.appendChild(i);
        d.appendChild(p);
        d.appendChild(h);
        d.appendChild(pm);
        d.appendChild(vb);
        this.videoMediaContainer.appendChild(d);
        BUTTONS.videoOff.muteAudioButton && this.handleAU(au.id);
        if (remotePeer) {
            this.handlePV('remotePeer___' + pv.id);
            this.handleSM(sm.id);
            this.handleSF(sf.id);
            this.handleSV(sv.id);
            this.handleGL(gl.id);
            this.handleBAN(ban.id);
            this.handleKO(ko.id);
        }
        this.handleDD(d.id, peer_id, !remotePeer);
        this.popupPeerInfo(p.id, peer_info);
        this.setVideoAvatarImgName(i.id, peer_name);
        this.getId(i.id).style.display = 'block';
        handleAspectRatio();
        if (isParticipantsListOpen) getRoomParticipants();
        if (!this.isMobileDevice && remotePeer) {
            this.setTippy(sm.id, 'Send message', 'bottom');
            this.setTippy(sf.id, 'Send file', 'bottom');
            this.setTippy(sv.id, 'Send video', 'bottom');
            this.setTippy(au.id, 'Mute', 'bottom');
            this.setTippy(pv.id, '🔊 Volume', 'bottom');
            this.setTippy(gl.id, 'Geolocation', 'bottom');
            this.setTippy(ban.id, 'Ban', 'bottom');
            this.setTippy(ko.id, 'Eject', 'bottom');
        }
        remotePeer ? this.setPeerAudio(peer_id, peer_audio) : this.setIsAudio(peer_id, peer_audio);

        console.log('[setVideoOff] Video-element-count', this.videoMediaContainer.childElementCount);
        //
        wbUpdate();

        this.handleHideMe();
    }

    removeVideoOff(peer_id) {
        let pvOff = this.getId(peer_id + '__videoOff');
        if (pvOff) {
            pvOff.parentNode.removeChild(pvOff);
            handleAspectRatio();
            console.log('[removeVideoOff] Video-element-count', this.videoMediaContainer.childElementCount);
            if (peer_id != this.peer_id) this.sound('left');
        }
    }

    // ####################################################
    // SHARE SCREEN ON JOIN
    // ####################################################

    shareScreen() {
        if (!this.isMobileDevice && (navigator.getDisplayMedia || navigator.mediaDevices.getDisplayMedia)) {
            this.sound('open');
            // startScreenButton.click(); // Chrome - Opera - Edge - Brave
            // handle error: getDisplayMedia requires transient activation from a user gesture on Safari - FireFox
            Swal.fire({
                background: swalBackground,
                position: 'center',
                icon: 'question',
                text: 'Do you want to share your screen?',
                showDenyButton: true,
                confirmButtonText: `Yes`,
                denyButtonText: `No`,
                showClass: { popup: 'animate__animated animate__fadeInDown' },
                hideClass: { popup: 'animate__animated animate__fadeOutUp' },
            }).then((result) => {
                if (result.isConfirmed) {
                    startScreenButton.click();
                    console.log('11 ----> Screen is on');
                } else {
                    console.log('11 ----> Screen is on');
                }
            });
        } else {
            console.log('11 ----> Screen is off');
        }
    }

    // ####################################################
    // EXIT ROOM
    // ####################################################

    exit(offline = false) {
        if (VideoAI.active) this.stopSession();
        if (this.rtmpFilestreamer) this.stopRTMP();
        if (this.rtmpUrlstreamer) this.stopRTMPfromURL();

        const clean = () => {
            this._isConnected = false;
            if (this.consumerTransport) this.consumerTransport.close();
            if (this.producerTransport) this.producerTransport.close();
            this.socket.off('disconnect');
            this.socket.off('newProducers');
            this.socket.off('consumerClosed');
        };

        if (!offline) {
            this.socket
                .request('exitRoom')
                .then((e) => console.log('Exit Room', e))
                .catch((e) => console.warn('Exit Room ', e))
                .finally(() => {
                    clean();
                    this.event(_EVENTS.exitRoom);
                });
        } else {
            clean();
        }
    }

    exitRoom() {
        //...
        if (isPresenter && switchDisconnectAllOnLeave.checked) {
            this.ejectAllOnLeave();
        }
        this.exit();
    }

    // ####################################################
    // EJECT ALL ON LEAVE ROOM
    // ####################################################

    ejectAllOnLeave() {
        const cmd = {
            type: 'ejectAll',
            peer_name: this.peer_name,
            peer_uuid: this.peer_uuid,
            broadcast: true,
        };
        this.emitCmd(cmd);
    }

    // ####################################################
    // HELPERS
    // ####################################################

    attachMediaStream(elem, stream, type, who) {
        let track;
        switch (type) {
            case mediaType.audio:
                track = stream.getAudioTracks()[0];
                break;
            case mediaType.video:
            case mediaType.screen:
                track = stream.getVideoTracks()[0];
                break;
            default:
                break;
        }
        const consumerStream = new MediaStream();
        consumerStream.addTrack(track);
        elem.srcObject = consumerStream;
        console.log(who + ' Success attached media ' + type);
    }

    async changeAudioDestination(audioElement = false) {
        const audioDestination = speakerSelect.value;
        if (audioElement) {
            await this.attachSinkId(audioElement, audioDestination);
        } else {
            const audioElements = this.remoteAudioEl.querySelectorAll('audio');
            audioElements.forEach(async (audioElement) => {
                await this.attachSinkId(audioElement, audioDestination);
            });
        }
    }

    async attachSinkId(elem, sinkId) {
        if (typeof elem.sinkId !== 'undefined') {
            elem.setSinkId(sinkId)
                .then(() => {
                    console.log(`Success, audio output device attached: ${sinkId}`);
                })
                .catch((err) => {
                    let errorMessage = err;
                    let speakerSelect = this.getId('speakerSelect');
                    if (err.name === 'SecurityError')
                        errorMessage = `You need to use HTTPS for selecting audio output device: ${err}`;
                    console.error('Attach SinkId error: ', errorMessage);
                    this.userLog('error', errorMessage, 'top-end', 6000);
                    speakerSelect.selectedIndex = 0;
                    refreshLsDevices();
                });
        } else {
            const error = `Browser seems doesn't support output device selection.`;
            console.warn(error);
            this.userLog('error', error, 'top-end', 6000);
        }
    }

    event(evt) {
        if (this.eventListeners.has(evt)) {
            this.eventListeners.get(evt).forEach((callback) => callback());
        }
    }

    on(evt, callback) {
        this.eventListeners.get(evt).push(callback);
    }

    // ####################################################
    // SET
    // ####################################################

    setTippy(elem, content, placement, allowHTML = false) {
        if (DetectRTC.isMobileDevice) return;
        const element = this.getId(elem);
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

    setVideoAvatarImgName(elemId, peer_name) {
        let elem = this.getId(elemId);
        if (cfg.useAvatarSvg) {
            rc.isValidEmail(peer_name)
                ? elem.setAttribute('src', this.genGravatar(peer_name))
                : elem.setAttribute('src', this.genAvatarSvg(peer_name, 250));
        } else {
            elem.setAttribute('src', image.avatar);
        }
    }

    genGravatar(email, size = false) {
        const hash = md5(email.toLowerCase().trim());
        const gravatarURL = `https://www.gravatar.com/avatar/${hash}` + (size ? `?s=${size}` : '?s=250') + '?d=404';
        return gravatarURL;
        function md5(input) {
            return CryptoJS.MD5(input).toString();
        }
    }

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    genAvatarSvg(peerName, avatarImgSize) {
        const charCodeRed = peerName.charCodeAt(0);
        const charCodeGreen = peerName.charCodeAt(1) || charCodeRed;
        const red = Math.pow(charCodeRed, 7) % 200;
        const green = Math.pow(charCodeGreen, 7) % 200;
        const blue = (red + green) % 200;
        const bgColor = `rgb(${red}, ${green}, ${blue})`;
        const textColor = '#ffffff';
        const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" 
        xmlns:xlink="http://www.w3.org/1999/xlink" 
        width="${avatarImgSize}px" 
        height="${avatarImgSize}px" 
        viewBox="0 0 ${avatarImgSize} ${avatarImgSize}" 
        version="1.1">
            <circle 
                fill="${bgColor}" 
                width="${avatarImgSize}" 
                height="${avatarImgSize}" 
                cx="${avatarImgSize / 2}" 
                cy="${avatarImgSize / 2}" 
                r="${avatarImgSize / 2}"
            />
            <text 
                x="50%" 
                y="50%" 
                style="color:${textColor}; 
                line-height:1; 
                font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Fira Sans, Droid Sans, Helvetica Neue, sans-serif"
                alignment-baseline="middle" 
                text-anchor="middle" 
                font-size="${Math.round(avatarImgSize * 0.4)}" 
                font-weight="normal" 
                dy=".1em" 
                dominant-baseline="middle" 
                fill="${textColor}">${peerName.substring(0, 2).toUpperCase()}
            </text>
        </svg>`;
        return 'data:image/svg+xml,' + svg.replace(/#/g, '%23').replace(/"/g, "'").replace(/&/g, '&amp;');
    }

    setPeerAudio(peer_id, status) {
        console.log('Set peer audio enabled: ' + status);
        const audioStatus = this.getPeerAudioBtn(peer_id); // producer, consumers
        const audioVolume = this.getPeerAudioVolumeBtn(peer_id); // consumers
        if (audioStatus) audioStatus.className = status ? html.audioOn : html.audioOff;
        if (audioVolume) status ? show(audioVolume) : hide(audioVolume);
    }

    setIsAudio(peer_id, status) {
        if (!isBroadcastingEnabled || (isBroadcastingEnabled && isPresenter)) {
            console.log('Set audio enabled: ' + status);
            this.peer_info.peer_audio = status;
            const audioStatus = this.getPeerAudioBtn(peer_id); // producer, consumers
            if (audioStatus) audioStatus.className = status ? html.audioOn : html.audioOff;
        }
    }

    setIsVideo(status) {
        if (!isBroadcastingEnabled || (isBroadcastingEnabled && isPresenter)) {
            this.peer_info.peer_video = status;
            if (!this.peer_info.peer_video) {
                console.log('Set video enabled: ' + status);
                this.setVideoOff(this.peer_info, false);
                this.sendVideoOff();
            }
        }
    }

    setIsScreen(status) {
        if (!isBroadcastingEnabled || (isBroadcastingEnabled && isPresenter)) {
            this.peer_info.peer_screen = status;
            if (!this.peer_info.peer_screen && !this.peer_info.peer_video) {
                console.log('Set screen enabled: ' + status);
                this.setVideoOff(this.peer_info, false);
                this.sendVideoOff();
            }
        }
    }

    sendVideoOff() {
        this.socket.emit('setVideoOff', this.peer_info);
    }

    // ####################################################
    // GET
    // ####################################################

    isConnected() {
        return this._isConnected;
    }

    isRecording() {
        return this._isRecording;
    }

    static get mediaType() {
        return mediaType;
    }

    static get EVENTS() {
        return _EVENTS;
    }

    getTimeNow() {
        return new Date().toTimeString().split(' ')[0];
    }

    getId(id) {
        return document.getElementById(id);
    }

    getName(name) {
        return document.getElementsByName(name);
    }

    getEcN(cn) {
        return document.getElementsByClassName(cn);
    }

    async getRoomInfo() {
        let room_info = await this.socket.request('getRoomInfo');
        return room_info;
    }

    refreshParticipantsCount() {
        this.socket.emit('refreshParticipantsCount');
    }

    getPeerAudioBtn(peer_id) {
        return this.getId(peer_id + '__audio');
    }

    getPeerAudioVolumeBtn(peer_id) {
        return this.getId(peer_id + '___pVolume');
    }

    getPeerHandBtn(peer_id) {
        return this.getId(peer_id + '__hand');
    }

    getMapKeyByValue(map, searchValue) {
        for (let [key, value] of map.entries()) {
            if (value === searchValue) return key;
        }
    }

    getSelectedIndexValue(elem) {
        return elem.options[elem.selectedIndex].value;
    }

    // ####################################################
    // UTILITY
    // ####################################################

    async sound(name, force = false) {
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

    userLog(icon, message, position, timer = 5000) {
        const Toast = Swal.mixin({
            background: swalBackground,
            toast: true,
            position: position,
            showConfirmButton: false,
            timer: timer,
            timerProgressBar: true,
        });
        switch (icon) {
            case 'html':
                Toast.fire({
                    icon: icon,
                    html: message,
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                });
                break;
            default:
                Toast.fire({
                    icon: icon,
                    title: message,
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                });
        }
    }

    msgPopup(type, message) {
        switch (type) {
            case 'warning':
            case 'error':
                Swal.fire({
                    background: swalBackground,
                    position: 'center',
                    icon: type,
                    title: type,
                    text: message,
                    showClass: { popup: 'animate__animated animate__rubberBand' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                });
                this.sound('alert');
                break;
            case 'info':
            case 'success':
                Swal.fire({
                    background: swalBackground,
                    position: 'center',
                    icon: type,
                    title: type,
                    text: message,
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                });
                break;
            case 'html':
                Swal.fire({
                    background: swalBackground,
                    position: 'center',
                    icon: type,
                    html: message,
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                });
                break;
            case 'toast':
                const Toast = Swal.mixin({
                    background: swalBackground,
                    position: 'top-end',
                    icon: 'info',
                    showConfirmButton: false,
                    timerProgressBar: true,
                    toast: true,
                    timer: 3000,
                });
                Toast.fire({
                    icon: 'info',
                    title: message,
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                });
                break;
            // ......
            default:
                alert(message);
        }
    }

    msgHTML(data, icon, imageUrl, title, html, position = 'center') {
        switch (data.type) {
            case 'recording':
                switch (data.action) {
                    case enums.recording.started:
                    case enums.recording.start:
                        html = html + '<br/> Your presence implies you agree to being recorded';
                        toastMessage(6000);
                        break;
                    case enums.recording.stop:
                        toastMessage(3000);
                        break;
                    //...
                    default:
                        break;
                }
                if (!this.speechInMessages) this.speechText(`${data.peer_name} ${data.action}`);
                break;
            //...
            default:
                defaultMessage();
                break;
        }
        // TOAST less invasive
        function toastMessage(duration = 3000) {
            const Toast = Swal.mixin({
                background: swalBackground,
                position: 'top-end',
                icon: icon,
                showConfirmButton: false,
                timerProgressBar: true,
                toast: true,
                timer: duration,
            });
            Toast.fire({
                title: title,
                html: html,
                showClass: { popup: 'animate__animated animate__fadeInDown' },
                hideClass: { popup: 'animate__animated animate__fadeOutUp' },
            });
        }
        // DEFAULT
        function defaultMessage() {
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
            });
        }
        //...
    }

    thereAreParticipants() {
        // console.log('participantsCount ---->', participantsCount);
        if (this.consumers.size > 0 || participantsCount > 1) {
            return true;
        }
        return false;
    }

    // ####################################################
    // MY SETTINGS
    // ####################################################

    toggleMySettings() {
        let mySettings = this.getId('mySettings');
        mySettings.style.top = '50%';
        mySettings.style.left = '50%';
        if (this.isMobileDevice) {
            mySettings.style.width = '100%';
            mySettings.style.height = '100%';
        }
        mySettings.classList.toggle('show');
        this.isMySettingsOpen = this.isMySettingsOpen ? false : true;
    }

    openTab(evt, tabName) {
        let i, tabcontent, tablinks;
        tabcontent = this.getEcN('tabcontent');
        for (i = 0; i < tabcontent.length; i++) {
            tabcontent[i].style.display = 'none';
        }
        tablinks = this.getEcN('tablinks');
        for (i = 0; i < tablinks.length; i++) {
            tablinks[i].className = tablinks[i].className.replace(' active', '');
        }
        this.getId(tabName).style.display = 'block';
        evt.currentTarget.className += ' active';
    }

    changeBtnsBarPosition(position) {
        switch (position) {
            case 'vertical':
                document.documentElement.style.setProperty('--btns-top', '50%');
                document.documentElement.style.setProperty('--btns-right', '0%');
                document.documentElement.style.setProperty('--btns-left', '10px');
                document.documentElement.style.setProperty('--btns-margin-left', '0px');
                document.documentElement.style.setProperty('--btns-width', '60px');
                document.documentElement.style.setProperty('--btns-flex-direction', 'column');
                break;
            case 'horizontal':
                document.documentElement.style.setProperty('--btns-top', '95%');
                document.documentElement.style.setProperty('--btns-right', '25%');
                document.documentElement.style.setProperty('--btns-left', '50%');
                document.documentElement.style.setProperty('--btns-margin-left', '-160px');
                document.documentElement.style.setProperty('--btns-width', '320px');
                document.documentElement.style.setProperty('--btns-flex-direction', 'row');
                break;
            default:
                break;
        }
    }

    // ####################################################
    // PICTURE IN PICTURE
    // ####################################################

    handlePIP(elemId, pipId) {
        let videoPlayer = this.getId(elemId);
        let btnPIP = this.getId(pipId);
        if (btnPIP) {
            btnPIP.addEventListener('click', () => {
                if (videoPlayer.pictureInPictureElement) {
                    videoPlayer.exitPictureInPicture();
                } else if (document.pictureInPictureEnabled) {
                    videoPlayer.requestPictureInPicture().catch((error) => {
                        console.error('Failed to enter Picture-in-Picture mode:', error);
                        this.userLog('warning', error.message, 'top-end', 6000);
                        elemDisplay(btnPIP.id, false);
                    });
                }
            });
        }
    }

    // ####################################################
    // FULL SCREEN
    // ####################################################

    isFullScreenSupported() {
        return (
            document.fullscreenEnabled ||
            document.webkitFullscreenEnabled ||
            document.mozFullScreenEnabled ||
            document.msFullscreenEnabled
        );
    }

    toggleFullScreen(elem = null) {
        let el = elem ? elem : document.documentElement;
        document.fullscreenEnabled =
            document.fullscreenEnabled ||
            document.webkitFullscreenEnabled ||
            document.mozFullScreenEnabled ||
            document.msFullscreenEnabled;
        document.exitFullscreen =
            document.exitFullscreen ||
            document.webkitExitFullscreen ||
            document.mozCancelFullScreen ||
            document.msExitFullscreen;
        el.requestFullscreen =
            el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullScreen;
        if (document.fullscreenEnabled) {
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement
                ? document.exitFullscreen()
                : el.requestFullscreen();
        }
        if (elem == null) this.isVideoOnFullScreen = document.fullscreenEnabled;
    }

    handleFS(elemId, fsId) {
        let videoPlayer = this.getId(elemId);
        let btnFs = this.getId(fsId);
        if (btnFs) {
            this.setTippy(fsId, 'Full screen', 'bottom');
            btnFs.addEventListener('click', () => {
                if (videoPlayer.classList.contains('videoCircle')) {
                    return this.userLog('info', 'Full Screen not allowed if video on privacy mode', 'top-end');
                }
                videoPlayer.style.pointerEvents = this.isVideoOnFullScreen ? 'auto' : 'none';
                this.toggleFullScreen(videoPlayer);
                this.isVideoOnFullScreen = this.isVideoOnFullScreen ? false : true;
            });
        }
        if (videoPlayer) {
            videoPlayer.addEventListener('click', () => {
                if (videoPlayer.classList.contains('videoCircle')) {
                    return this.userLog('info', 'Full Screen not allowed if video on privacy mode', 'top-end');
                }
                if (!videoPlayer.hasAttribute('controls')) {
                    if ((this.isMobileDevice && this.isVideoOnFullScreen) || !this.isMobileDevice) {
                        videoPlayer.style.pointerEvents = this.isVideoOnFullScreen ? 'auto' : 'none';
                        this.toggleFullScreen(videoPlayer);
                        this.isVideoOnFullScreen = this.isVideoOnFullScreen ? false : true;
                    }
                }
            });
            videoPlayer.addEventListener('fullscreenchange', (e) => {
                if (!document.fullscreenElement) {
                    videoPlayer.style.pointerEvents = 'auto';
                    this.isVideoOnFullScreen = false;
                }
            });
            videoPlayer.addEventListener('webkitfullscreenchange', (e) => {
                if (!document.webkitIsFullScreen) {
                    videoPlayer.style.pointerEvents = 'auto';
                    this.isVideoOnFullScreen = false;
                }
            });
        }
    }

    // ####################################################
    // HANDLE VIDEO | OBJ FIT | CONTROLS | PIN-UNPIN
    // ####################################################

    handleVideoObjectFit(value) {
        document.documentElement.style.setProperty('--videoObjFit', value);
    }

    handleVideoControls(value) {
        isVideoControlsOn = value == 'on' ? true : false;
        let cameras = this.getEcN('Camera');
        for (let i = 0; i < cameras.length; i++) {
            let cameraId = cameras[i].id.replace('__video', '');
            let videoPlayer = this.getId(cameraId);
            videoPlayer.hasAttribute('controls')
                ? videoPlayer.removeAttribute('controls')
                : videoPlayer.setAttribute('controls', isVideoControlsOn);
        }
    }

    handlePN(elemId, pnId, camId, isScreen = false, isAvatar = false) {
        let videoPlayer = this.getId(elemId);
        let btnPn = this.getId(pnId);
        let cam = this.getId(camId);
        if (btnPn && videoPlayer && cam) {
            btnPn.addEventListener('click', () => {
                if (this.isMobileDevice) return;
                this.sound('click');
                this.isVideoPinned = !this.isVideoPinned;
                if (this.isVideoPinned) {
                    if (!videoPlayer.classList.contains('videoCircle')) {
                        videoPlayer.style.objectFit = 'contain';
                    }
                    cam.className = '';
                    cam.style.width = '100%';
                    cam.style.height = '100%';
                    this.toggleVideoPin(pinVideoPosition.value);
                    this.videoPinMediaContainer.appendChild(cam);
                    this.videoPinMediaContainer.style.display = 'block';
                    this.pinnedVideoPlayerId = elemId;
                    setColor(btnPn, 'lime');
                } else {
                    if (this.pinnedVideoPlayerId != videoPlayer.id) {
                        this.isVideoPinned = true;
                        if (this.isScreenAllowed) return;
                        return this.msgPopup('toast', 'Another video seems pinned, unpin it before to pin this one');
                    }
                    if (!isScreen && !isBroadcastingEnabled) videoPlayer.style.objectFit = 'var(--videoObjFit)';
                    this.videoPinMediaContainer.removeChild(cam);
                    cam.className = 'Camera';
                    this.videoMediaContainer.appendChild(cam);
                    this.removeVideoPinMediaContainer();
                    setColor(btnPn, 'white');
                }
                handleAspectRatio();
            });

            if (isAvatar && !this.isMobileDevice) btnPn.click();
        }
    }

    toggleVideoPin(position) {
        if (!this.isVideoPinned) return;
        switch (position) {
            case 'top':
                this.videoPinMediaContainer.style.top = '25%';
                this.videoPinMediaContainer.style.width = '100%';
                this.videoPinMediaContainer.style.height = '75%';
                this.videoMediaContainer.style.top = '0%';
                this.videoMediaContainer.style.right = null;
                this.videoMediaContainer.style.width = null;
                this.videoMediaContainer.style.width = '100% !important';
                this.videoMediaContainer.style.height = '25%';
                break;
            case 'vertical':
                this.videoPinMediaContainer.style.top = 0;
                this.videoPinMediaContainer.style.width = '75%';
                this.videoPinMediaContainer.style.height = '100%';
                this.videoMediaContainer.style.top = 0;
                this.videoMediaContainer.style.width = '25%';
                this.videoMediaContainer.style.height = '100%';
                this.videoMediaContainer.style.right = 0;
                break;
            case 'horizontal':
                this.videoPinMediaContainer.style.top = 0;
                this.videoPinMediaContainer.style.width = '100%';
                this.videoPinMediaContainer.style.height = '75%';
                this.videoMediaContainer.style.top = '75%';
                this.videoMediaContainer.style.right = null;
                this.videoMediaContainer.style.width = null;
                this.videoMediaContainer.style.width = '100% !important';
                this.videoMediaContainer.style.height = '25%';
                break;
            default:
                break;
        }
        resizeVideoMedia();
    }

    // ####################################################
    // HANDLE VIDEO ZOOM-IN/OUT
    // ####################################################

    handleZV(elemId, divId, peerId) {
        let videoPlayer = this.getId(elemId);
        let videoWrap = this.getId(divId);
        let videoPeerId = peerId;
        let zoom = 1;

        const ZOOM_IN_FACTOR = 1.1;
        const ZOOM_OUT_FACTOR = 0.9;
        const MAX_ZOOM = 15;
        const MIN_ZOOM = 1;

        if (this.isZoomCenterMode) {
            if (videoPlayer) {
                videoPlayer.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    let delta = e.wheelDelta ? e.wheelDelta : -e.deltaY;
                    delta > 0 ? (zoom *= 1.2) : (zoom /= 1.2);
                    if (zoom < 1) zoom = 1;
                    videoPlayer.style.scale = zoom;
                });
            }
        } else {
            if (videoPlayer && videoWrap) {
                videoPlayer.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    if (isVideoPrivacyActive) return;
                    const rect = videoWrap.getBoundingClientRect();
                    const cursorX = e.clientX - rect.left;
                    const cursorY = e.clientY - rect.top;
                    const zoomDirection = e.deltaY > 0 ? 'zoom-out' : 'zoom-in';
                    const scaleFactor = zoomDirection === 'zoom-out' ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR;
                    zoom *= scaleFactor;
                    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
                    videoPlayer.style.transformOrigin = `${cursorX}px ${cursorY}px`;
                    videoPlayer.style.transform = `scale(${zoom})`;
                    videoPlayer.style.cursor = zoom === 1 ? 'pointer' : zoomDirection;
                });

                videoWrap.addEventListener('mouseleave', () => {
                    videoPlayer.style.cursor = 'pointer';
                    if (videoPeerId === this.peer_id) {
                        zoom = 1;
                        videoPlayer.style.transform = '';
                        videoPlayer.style.transformOrigin = 'center';
                    }
                });
                videoPlayer.addEventListener('mouseleave', () => {
                    videoPlayer.style.cursor = 'pointer';
                });
            }
        }
    }

    // ####################################################
    // REMOVE VIDEO PIN MEDIA CONTAINER
    // ####################################################

    removeVideoPinMediaContainer() {
        this.videoPinMediaContainer.style.display = 'none';
        this.videoMediaContainer.style.top = 0;
        this.videoMediaContainer.style.right = null;
        this.videoMediaContainer.style.width = '100%';
        this.videoMediaContainer.style.height = '100%';
        this.pinnedVideoPlayerId = null;
        this.isVideoPinned = false;
        if (this.isChatPinned) {
            this.chatPin();
        }
        if (this.transcription.isPin()) {
            this.transcription.pinned();
        }
    }

    adaptVideoObjectFit(index) {
        // 1 (cover) 2 (contain)
        BtnVideoObjectFit.selectedIndex = index;
        BtnVideoObjectFit.onchange();
    }

    // ####################################################
    // TAKE SNAPSHOT
    // ####################################################

    handleTS(elemId, tsId) {
        let videoPlayer = this.getId(elemId);
        let btnTs = this.getId(tsId);
        if (btnTs && videoPlayer) {
            btnTs.addEventListener('click', () => {
                if (videoPlayer.classList.contains('videoCircle')) {
                    return this.userLog('info', 'SnapShoot not allowed if video on privacy mode', 'top-end');
                }
                this.sound('snapshot');
                let context, canvas, width, height, dataURL;
                width = videoPlayer.videoWidth;
                height = videoPlayer.videoHeight;
                canvas = canvas || document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                context = canvas.getContext('2d');
                context.drawImage(videoPlayer, 0, 0, width, height);
                dataURL = canvas.toDataURL('image/png');
                // console.log(dataURL);
                saveDataToFile(dataURL, getDataTimeString() + '-SNAPSHOT.png');
            });
        }
    }

    // ####################################################
    // VIDEO CIRCLE - PRIVACY MODE
    // ####################################################

    handleVP(elemId, vpId) {
        let videoPlayer = this.getId(elemId);
        let btnVp = this.getId(vpId);
        if (btnVp && videoPlayer) {
            btnVp.addEventListener('click', () => {
                this.sound('click');
                isVideoPrivacyActive = !isVideoPrivacyActive;
                this.setVideoPrivacyStatus(this.peer_id, isVideoPrivacyActive);
                this.emitCmd({
                    type: 'privacy',
                    peer_id: this.peer_id,
                    active: isVideoPrivacyActive,
                    broadcast: true,
                });
            });
        }
    }

    setVideoPrivacyStatus(elemName, privacy) {
        let videoPlayer = this.getName(elemName)[0];
        if (privacy) {
            videoPlayer.classList.remove('videoDefault');
            videoPlayer.classList.add('videoCircle');
            videoPlayer.style.objectFit = 'cover';
        } else {
            videoPlayer.classList.remove('videoCircle');
            videoPlayer.classList.add('videoDefault');
            videoPlayer.style.objectFit = 'var(--videoObjFit)';
        }
    }

    // ####################################################
    // DRAGGABLE
    // ####################################################

    makeDraggable(elmnt, dragObj) {
        let pos1 = 0,
            pos2 = 0,
            pos3 = 0,
            pos4 = 0;
        if (dragObj) {
            dragObj.onmousedown = dragMouseDown;
        } else {
            elmnt.onmousedown = dragMouseDown;
        }
        function dragMouseDown(e) {
            e = e || window.event;
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }
        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            elmnt.style.top = elmnt.offsetTop - pos2 + 'px';
            elmnt.style.left = elmnt.offsetLeft - pos1 + 'px';
        }
        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    makeUnDraggable(elmnt, dragObj) {
        if (dragObj) {
            dragObj.onmousedown = null;
        } else {
            elmnt.onmousedown = null;
        }
        elmnt.style.top = '';
        elmnt.style.left = '';
    }

    // ####################################################
    // CHAT
    // ####################################################

    handleSM(uid, name) {
        const words = uid.split('___');
        let peer_id = words[1];
        let peer_name = name;
        let btnSm = this.getId(uid);
        if (btnSm) {
            btnSm.addEventListener('click', () => {
                this.sendMessageTo(peer_id, peer_name);
            });
        }
    }

    isPlistOpen() {
        const plist = this.getId('plist');
        return !plist.classList.contains('hidden');
    }

    async toggleChat() {
        const chatRoom = this.getId('chatRoom');
        chatRoom.classList.toggle('show');
        if (!this.isChatOpen) {
            await getRoomParticipants();
            hide(chatMinButton);
            if (!this.isMobileDevice) {
                BUTTONS.chat.chatMaxButton && show(chatMaxButton);
            }
            this.chatCenter();
            this.sound('open');
            this.showPeerAboutAndMessages('all', 'all');
        }
        isParticipantsListOpen = !isParticipantsListOpen;
        this.isChatOpen = !this.isChatOpen;
        if (this.isChatPinned) this.chatUnpin();
        resizeChatRoom();
    }

    toggleShowParticipants() {
        const plist = this.getId('plist');
        const chat = this.getId('chat');
        plist.classList.toggle('hidden');
        const isParticipantsListHidden = !this.isPlistOpen();
        chat.style.marginLeft = isParticipantsListHidden ? 0 : '300px';
        chat.style.borderLeft = isParticipantsListHidden ? 'none' : '1px solid rgb(255 255 255 / 32%)';
        if (this.isChatPinned) elemDisplay(chat.id, isParticipantsListHidden);
        if (!this.isChatPinned) elemDisplay(chat.id, true);
        this.toggleChatHistorySize(isParticipantsListHidden && (this.isChatPinned || this.isChatMaximized));
        plist.style.width = this.isChatPinned || this.isMobileDevice ? '100%' : '300px';
        plist.style.position = this.isMobileDevice ? 'fixed' : 'absolute';
    }

    toggleChatHistorySize(max = true) {
        const chatHistory = this.getId('chatHistory');
        chatHistory.style.minHeight = max ? 'calc(100vh - 210px)' : '490px';
        chatHistory.style.maxHeight = max ? 'calc(100vh - 210px)' : '490px';
    }

    toggleChatPin() {
        if (transcription.isPin()) {
            return userLog('info', 'Please unpin the transcription that appears to be currently pinned', 'top-end');
        }
        this.isChatPinned ? this.chatUnpin() : this.chatPin();
        this.sound('click');
    }

    chatMaximize() {
        this.isChatMaximized = true;
        hide(chatMaxButton);
        BUTTONS.chat.chatMaxButton && show(chatMinButton);
        this.chatCenter();
        document.documentElement.style.setProperty('--msger-width', '100%');
        document.documentElement.style.setProperty('--msger-height', '100%');
        this.toggleChatHistorySize(true);
    }

    chatMinimize() {
        this.isChatMaximized = false;
        hide(chatMinButton);
        BUTTONS.chat.chatMaxButton && show(chatMaxButton);
        if (this.isChatPinned) {
            this.chatPin();
        } else {
            this.chatCenter();
            document.documentElement.style.setProperty('--msger-width', '800px');
            document.documentElement.style.setProperty('--msger-height', '700px');
            this.toggleChatHistorySize(false);
        }
    }

    chatPin() {
        if (!this.isVideoPinned) {
            this.videoMediaContainer.style.top = 0;
            this.videoMediaContainer.style.width = '75%';
            this.videoMediaContainer.style.height = '100%';
        }
        this.chatPinned();
        this.isChatPinned = true;
        setColor(chatTogglePin, 'lime');
        resizeVideoMedia();
        chatRoom.style.resize = 'none';
        if (!this.isMobileDevice) this.makeUnDraggable(chatRoom, chatHeader);
        if (this.isPlistOpen()) this.toggleShowParticipants();
        if (chatRoom.classList.contains('container')) chatRoom.classList.remove('container');
    }

    chatUnpin() {
        if (!this.isVideoPinned) {
            this.videoMediaContainer.style.top = 0;
            this.videoMediaContainer.style.right = null;
            this.videoMediaContainer.style.width = '100%';
            this.videoMediaContainer.style.height = '100%';
        }
        document.documentElement.style.setProperty('--msger-width', '800px');
        document.documentElement.style.setProperty('--msger-height', '700px');
        hide(chatMinButton);
        BUTTONS.chat.chatMaxButton && show(chatMaxButton);
        this.chatCenter();
        this.isChatPinned = false;
        setColor(chatTogglePin, 'white');
        resizeVideoMedia();
        if (!this.isMobileDevice) this.makeDraggable(chatRoom, chatHeader);
        if (!this.isPlistOpen()) this.toggleShowParticipants();
        if (!chatRoom.classList.contains('container')) chatRoom.classList.add('container');
        resizeChatRoom();
    }

    chatCenter() {
        chatRoom.style.position = 'fixed';
        chatRoom.style.transform = 'translate(-50%, -50%)';
        chatRoom.style.top = '50%';
        chatRoom.style.left = '50%';
    }

    chatPinned() {
        chatRoom.style.position = 'absolute';
        chatRoom.style.top = 0;
        chatRoom.style.right = 0;
        chatRoom.style.left = null;
        chatRoom.style.transform = null;
        document.documentElement.style.setProperty('--msger-width', '25%');
        document.documentElement.style.setProperty('--msger-height', '100%');
    }

    toggleChatEmoji() {
        this.getId('chatEmoji').classList.toggle('show');
        this.isChatEmojiOpen = this.isChatEmojiOpen ? false : true;
        this.getId('chatEmojiButton').style.color = this.isChatEmojiOpen ? '#FFFF00' : '#FFFFFF';
    }

    addEmojiToMsg(data) {
        msgerInput.value += data.native;
        toggleChatEmoji();
    }

    cleanMessage() {
        chatMessage.value = '';
        chatMessage.setAttribute('rows', '1');
    }

    pasteMessage() {
        navigator.clipboard
            .readText()
            .then((text) => {
                chatMessage.value += text;
                isChatPasteTxt = true;
                this.checkLineBreaks();
            })
            .catch((err) => {
                console.error('Failed to read clipboard contents: ', err);
            });
    }

    sendMessage() {
        if (!this.thereAreParticipants() && !isChatGPTOn) {
            this.cleanMessage();
            isChatPasteTxt = false;
            return this.userLog('info', 'No participants in the room', 'top-end');
        }

        // Prevent long messages
        if (this.chatMessageLengthCheck && chatMessage.value.length > this.chatMessageLength) {
            return this.userLog(
                'warning',
                `The message seems too long, with a maximum of ${this.chatMessageLength} characters allowed`,
                'top-end',
            );
        }

        // Spamming detected ban the user from the room
        if (this.chatMessageSpamCount == this.chatMessageSpamCountToBan) {
            return this.roomAction('isBanned', true);
        }

        // Prevent Spam messages
        const currentTime = Date.now();
        if (chatMessage.value && currentTime - this.chatMessageTimeLast <= this.chatMessageTimeBetween) {
            this.cleanMessage();
            chatMessage.readOnly = true;
            chatSendButton.disabled = true;
            setTimeout(function () {
                chatMessage.readOnly = false;
                chatSendButton.disabled = false;
            }, this.chatMessageNotifyDelay);
            this.chatMessageSpamCount++;
            return this.userLog(
                'warning',
                `Kindly refrain from spamming. Please wait ${this.chatMessageNotifyDelay / 1000} seconds before sending another message`,
                'top-end',
                this.chatMessageNotifyDelay,
            );
        }
        this.chatMessageTimeLast = currentTime;

        chatMessage.value = filterXSS(chatMessage.value.trim());
        const peer_msg = this.formatMsg(chatMessage.value);
        if (!peer_msg) {
            return this.cleanMessage();
        }
        this.peer_name = filterXSS(this.peer_name);

        const data = {
            room_id: this.room_id,
            peer_name: this.peer_name,
            peer_id: this.peer_id,
            to_peer_id: 'ChatGPT',
            to_peer_name: 'ChatGPT',
            peer_msg: peer_msg,
        };

        if (isChatGPTOn) {
            console.log('Send message:', data);
            this.socket.emit('message', data);
            this.setMsgAvatar('left', this.peer_name);
            this.appendMessage(
                'left',
                this.leftMsgAvatar,
                this.peer_name,
                this.peer_id,
                peer_msg,
                data.to_peer_id,
                data.to_peer_name,
            );
            this.cleanMessage();

            this.socket
                .request('getChatGPT', {
                    time: getDataTimeString(),
                    room: this.room_id,
                    name: this.peer_name,
                    prompt: peer_msg,
                    context: this.chatGPTContext,
                })
                .then((completion) => {
                    if (!completion) return;
                    const { message, context } = completion;
                    this.chatGPTContext = context ? context : [];
                    console.log('Receive message:', message);
                    this.setMsgAvatar('right', 'ChatGPT');
                    this.appendMessage('right', image.chatgpt, 'ChatGPT', this.peer_id, message, 'ChatGPT', 'ChatGPT');
                    this.cleanMessage();
                    this.streamingTask(message); // Video AI avatar speak
                    this.speechInMessages && !VideoAI.active
                        ? this.speechMessage(true, 'ChatGPT', message)
                        : this.sound('message');
                })
                .catch((err) => {
                    console.log('ChatGPT error:', err);
                });
        } else {
            const participantsList = this.getId('participantsList');
            const participantsListItems = participantsList.getElementsByTagName('li');
            for (let i = 0; i < participantsListItems.length; i++) {
                const li = participantsListItems[i];
                if (li.classList.contains('active')) {
                    data.to_peer_id = li.getAttribute('data-to-id');
                    data.to_peer_name = li.getAttribute('data-to-name');
                    console.log('Send message:', data);
                    this.socket.emit('message', data);
                    this.setMsgAvatar('left', this.peer_name);
                    this.appendMessage(
                        'left',
                        this.leftMsgAvatar,
                        this.peer_name,
                        this.peer_id,
                        peer_msg,
                        data.to_peer_id,
                        data.to_peer_name,
                    );
                    this.cleanMessage();
                }
            }
        }
    }

    sendMessageTo(to_peer_id, to_peer_name) {
        if (!this.thereAreParticipants()) {
            isChatPasteTxt = false;
            this.cleanMessage();
            return this.userLog('info', 'No participants in the room except you', 'top-end');
        }
        Swal.fire({
            background: swalBackground,
            position: 'center',
            imageUrl: image.message,
            input: 'text',
            inputPlaceholder: '💬 Enter your message...',
            showCancelButton: true,
            confirmButtonText: `Send`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.value) {
                result.value = filterXSS(result.value.trim());
                let peer_msg = this.formatMsg(result.value);
                if (!peer_msg) {
                    return this.cleanMessage();
                }
                this.peer_name = filterXSS(this.peer_name);
                const toPeerName = filterXSS(to_peer_name);
                let data = {
                    peer_name: this.peer_name,
                    peer_id: this.peer_id,
                    to_peer_id: to_peer_id,
                    to_peer_name: toPeerName,
                    peer_msg: peer_msg,
                };
                console.log('Send message:', data);
                this.socket.emit('message', data);
                this.setMsgAvatar('left', this.peer_name);
                this.appendMessage(
                    'left',
                    this.leftMsgAvatar,
                    this.peer_name,
                    this.peer_id,
                    peer_msg,
                    to_peer_id,
                    toPeerName,
                );
                if (!this.isChatOpen) this.toggleChat();
            }
        });
    }

    async showMessage(data) {
        if (!this.isChatOpen && this.showChatOnMessage) await this.toggleChat();
        this.setMsgAvatar('right', data.peer_name);
        this.appendMessage(
            'right',
            this.rightMsgAvatar,
            data.peer_name,
            data.peer_id,
            data.peer_msg,
            data.to_peer_id,
            data.to_peer_name,
        );
        if (!this.showChatOnMessage) {
            this.userLog('info', `💬 New message from: ${data.peer_name}`, 'top-end');
        }

        if (this.speechInMessages) {
            VideoAI.active
                ? this.streamingTask(`New message from: ${data.peer_name}, the message is: ${data.peer_msg}`)
                : this.speechMessage(true, data.peer_name, data.peer_msg);
        } else {
            this.sound('message');
        }

        const participantsList = this.getId('participantsList');
        const participantsListItems = participantsList.getElementsByTagName('li');
        for (let i = 0; i < participantsListItems.length; i++) {
            const li = participantsListItems[i];
            // INCOMING PRIVATE MESSAGE
            if (li.id === data.peer_id && data.to_peer_id != 'all') {
                li.classList.add('pulsate');
                if (!['all', 'ChatGPT'].includes(data.to_peer_id)) {
                    this.getId(`${data.peer_id}-unread-msg`).classList.remove('hidden');
                }
            }
        }
    }

    setMsgAvatar(avatar, peerName) {
        let avatarImg = rc.isValidEmail(peerName) ? this.genGravatar(peerName) : this.genAvatarSvg(peerName, 32);
        avatar === 'left' ? (this.leftMsgAvatar = avatarImg) : (this.rightMsgAvatar = avatarImg);
    }

    appendMessage(side, img, fromName, fromId, msg, toId, toName) {
        //
        const getSide = filterXSS(side);
        const getImg = filterXSS(img);
        const getFromName = filterXSS(fromName);
        const getFromId = filterXSS(fromId);
        const getMsg = filterXSS(msg);
        const getToId = filterXSS(toId);
        const getToName = filterXSS(toName);
        const time = this.getTimeNow();

        const myMessage = getSide === 'left';
        const messageClass = myMessage ? 'my-message' : 'other-message float-right';
        const messageData = myMessage ? 'text-start' : 'text-end';
        const timeAndName = myMessage
            ? `<span class="message-data-time">${time}, ${getFromName} ( me ) </span>`
            : `<span class="message-data-time">${time}, ${getFromName} </span>`;

        const formatMessage = this.formatMsg(getMsg);
        console.log('FormatMessage', formatMessage);
        const speechButton = this.isSpeechSynthesisSupported
            ? `<button 
                    id="msg-speech-${chatMessagesId}" 
                    class="mr5" 
                    onclick="rc.speechText('${formatMessage}')">
                    <i class="fas fa-volume-high"></i>
                </button>`
            : '';

        const positionFirst = myMessage
            ? `<img src="${getImg}" alt="avatar" />${timeAndName}`
            : `${timeAndName}<img src="${getImg}" alt="avatar" />`;

        const message = getFromName === 'ChatGPT' ? `<pre>${getMsg}</pre>` : getMsg;

        const newMessageHTML = `
            <li id="msg-${chatMessagesId}"  
                data-from-id="${getFromId}" 
                data-from-name="${getFromName}"
                data-to-id="${getToId}" 
                data-to-name="${getToName}"
                class="clearfix"
            >
                <div class="message-data ${messageData}">
                    ${positionFirst}
                </div>
                <div class="message ${messageClass}">
                    <span class="text-start " id="${chatMessagesId}">${message}</span>
                    <hr/>
                    <div class="about-buttons mt5">
                        <button 
                            id="msg-copy-${chatMessagesId}" 
                            class="mr5" 
                            onclick="rc.copyToClipboard('${chatMessagesId}')">
                            <i class="fas fa-paste"></i>
                        </button>
                        ${speechButton}
                        <button 
                            id="msg-delete-${chatMessagesId}"   
                            class="mr5" 
                            onclick="rc.deleteMessage('msg-${chatMessagesId}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </li>
        `;

        this.collectMessages(time, getFromName, getMsg);

        console.log('Append message to:', { to_id: getToId, to_name: getToName });

        switch (getToId) {
            case 'ChatGPT':
                chatGPTMessages.insertAdjacentHTML('beforeend', newMessageHTML);
                break;
            case 'all':
                chatPublicMessages.insertAdjacentHTML('beforeend', newMessageHTML);
                break;
            default:
                chatPrivateMessages.insertAdjacentHTML('beforeend', newMessageHTML);
                break;
        }

        chatHistory.scrollTop += 500;

        if (!this.isMobileDevice) {
            this.setTippy('msg-delete-' + chatMessagesId, 'Delete', 'top');
            this.setTippy('msg-copy-' + chatMessagesId, 'Copy', 'top');
            this.setTippy('msg-speech-' + chatMessagesId, 'Speech', 'top');
        }

        chatMessagesId++;
    }

    deleteMessage(id) {
        Swal.fire({
            background: swalBackground,
            position: 'center',
            title: 'Delete this Message?',
            imageUrl: image.delete,
            showDenyButton: true,
            confirmButtonText: `Yes`,
            denyButtonText: `No`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                this.getId(id).remove();
                this.sound('delete');
            }
        });
    }

    copyToClipboard(id) {
        const text = this.getId(id).innerText;
        navigator.clipboard
            .writeText(text)
            .then(() => {
                this.userLog('success', 'Message copied!', 'top-end', 1000);
            })
            .catch((err) => {
                this.userLog('error', err, 'top-end', 6000);
            });
    }

    formatMsg(msg) {
        const message = filterXSS(msg);
        if (message.trim().length == 0) return;
        if (this.isHtml(message)) return this.sanitizeHtml(message);
        if (this.isValidHttpURL(message)) {
            if (this.isImageURL(message)) return this.getImage(message);
            //if (this.isVideoTypeSupported(message)) return this.getIframe(message);
            return this.getLink(message);
        }
        if (isChatMarkdownOn) return marked.parse(message);
        if (isChatPasteTxt && this.getLineBreaks(message) > 1) {
            isChatPasteTxt = false;
            return this.getPre(message);
        }
        if (this.getLineBreaks(message) > 1) return this.getPre(message);
        console.log('FormatMsg', message);
        return message;
    }

    sanitizeHtml(input) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;',
            '/': '&#x2F;',
        };
        return input.replace(/[&<>"'/]/g, (m) => map[m]);
    }

    isHtml(str) {
        var a = document.createElement('div');
        a.innerHTML = str;
        for (var c = a.childNodes, i = c.length; i--; ) {
            if (c[i].nodeType == 1) return true;
        }
        return false;
    }

    isValidHttpURL(input) {
        const pattern = new RegExp(
            '^(https?:\\/\\/)?' + // protocol
                '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
                '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
                '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
                '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
                '(\\#[-a-z\\d_]*)?$',
            'i',
        ); // fragment locator
        return pattern.test(input);
    }

    isImageURL(input) {
        return input.match(/\.(jpeg|jpg|gif|png|tiff|bmp)$/) != null;
    }

    getImage(input) {
        const url = filterXSS(input);
        const div = document.createElement('div');
        const img = document.createElement('img');
        img.setAttribute('src', url);
        img.setAttribute('width', '200px');
        img.setAttribute('height', 'auto');
        div.appendChild(img);
        console.log('GetImg', div.firstChild.outerHTML);
        return div.firstChild.outerHTML;
    }

    getLink(input) {
        const url = filterXSS(input);
        const a = document.createElement('a');
        const div = document.createElement('div');
        const linkText = document.createTextNode(url);
        a.setAttribute('href', url);
        a.setAttribute('target', '_blank');
        a.appendChild(linkText);
        div.appendChild(a);
        console.log('GetLink', div.firstChild.outerHTML);
        return div.firstChild.outerHTML;
    }

    getPre(input) {
        const text = filterXSS(input);
        const pre = document.createElement('pre');
        const div = document.createElement('div');
        pre.textContent = text;
        div.appendChild(pre);
        console.log('GetPre', div.firstChild.outerHTML);
        return div.firstChild.outerHTML;
    }

    getIframe(input) {
        const url = filterXSS(input);
        const iframe = document.createElement('iframe');
        const div = document.createElement('div');
        const is_youtube = this.getVideoType(url) == 'na' ? true : false;
        const video_audio_url = is_youtube ? this.getYoutubeEmbed(url) : url;
        iframe.setAttribute('title', 'Chat-IFrame');
        iframe.setAttribute('src', video_audio_url);
        iframe.setAttribute('width', 'auto');
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute(
            'allow',
            'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
        );
        iframe.setAttribute('allowfullscreen', 'allowfullscreen');
        div.appendChild(iframe);
        console.log('GetIFrame', div.firstChild.outerHTML);
        return div.firstChild.outerHTML;
    }

    getLineBreaks(message) {
        return (message.match(/\n/g) || []).length;
    }

    checkLineBreaks() {
        chatMessage.style.height = '';
        if (this.getLineBreaks(chatMessage.value) > 0 || chatMessage.value.length > 50) {
            chatMessage.setAttribute('rows', '2');
        }
    }

    collectMessages(time, from, msg) {
        this.chatMessages.push({
            time: time,
            from: from,
            msg: msg,
        });
    }

    speechMessage(newMsg = true, from, msg) {
        const speech = new SpeechSynthesisUtterance();
        speech.text = (newMsg ? 'New' : '') + ' message from:' + from + '. The message is:' + msg;
        speech.rate = 0.9;
        window.speechSynthesis.speak(speech);
    }

    speechText(msg) {
        if (VideoAI.active) {
            this.streamingTask(msg);
        } else {
            const speech = new SpeechSynthesisUtterance();
            speech.text = msg;
            speech.rate = 0.9;
            window.speechSynthesis.speak(speech);
        }
    }

    chatToggleBg() {
        this.isChatBgTransparent = !this.isChatBgTransparent;
        this.isChatBgTransparent
            ? document.documentElement.style.setProperty('--msger-bg', 'rgba(0, 0, 0, 0.100)')
            : setTheme();
    }

    chatClean() {
        if (this.chatMessages.length === 0) {
            return userLog('info', 'No chat messages to clean', 'top-end');
        }
        Swal.fire({
            background: swalBackground,
            position: 'center',
            title: 'Clean up all chat Messages?',
            imageUrl: image.delete,
            showDenyButton: true,
            confirmButtonText: `Yes`,
            denyButtonText: `No`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                function removeAllChildNodes(parentNode) {
                    while (parentNode.firstChild) {
                        parentNode.removeChild(parentNode.firstChild);
                    }
                }
                // Remove child nodes from different message containers
                removeAllChildNodes(chatGPTMessages);
                removeAllChildNodes(chatPublicMessages);
                removeAllChildNodes(chatPrivateMessages);
                this.chatMessages = [];
                this.chatGPTContext = [];
                this.sound('delete');
            }
        });
    }

    chatSave() {
        if (this.chatMessages.length === 0) {
            return userLog('info', 'No chat messages to save', 'top-end');
        }
        saveObjToJsonFile(this.chatMessages, 'CHAT');
    }

    // ####################################################
    // RECORDING
    // ####################################################

    handleRecordingError(error, popupLog = true) {
        console.error('Recording error', error);
        if (popupLog) this.userLog('error', error, 'top-end', 6000);
    }

    getSupportedMimeTypes() {
        const possibleTypes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4'];
        possibleTypes.splice(recPrioritizeH264 ? 0 : 2, 0, 'video/mp4;codecs=h264,aac', 'video/webm;codecs=h264,opus');
        console.log('POSSIBLE CODECS', possibleTypes);
        return possibleTypes.filter((mimeType) => {
            return MediaRecorder.isTypeSupported(mimeType);
        });
    }

    startRecording() {
        recordedBlobs = [];

        // Get supported MIME types and set options
        const supportedMimeTypes = this.getSupportedMimeTypes();
        console.log('MediaRecorder supported options', supportedMimeTypes);
        const options = { mimeType: supportedMimeTypes[0] };

        recCodecs = supportedMimeTypes[0];

        try {
            this.audioRecorder = new MixedAudioRecorder();
            const audioStreams = this.getAudioStreamFromAudioElements();
            console.log('Audio streams tracks --->', audioStreams.getTracks());

            const audioMixerStreams = this.audioRecorder.getMixedAudioStream(
                audioStreams
                    .getTracks()
                    .filter((track) => track.kind === 'audio')
                    .map((track) => new MediaStream([track])),
            );

            const audioMixerTracks = audioMixerStreams.getTracks();
            console.log('Audio mixer tracks --->', audioMixerTracks);

            this.isMobileDevice
                ? this.startMobileRecording(options, audioMixerTracks)
                : this.recordingOptions(options, audioMixerTracks);
        } catch (err) {
            this.handleRecordingError('Exception while creating MediaRecorder: ' + err);
        }
    }

    recordingOptions(options, audioMixerTracks) {
        Swal.fire({
            background: swalBackground,
            position: 'top',
            imageUrl: image.recording,
            title: 'Recording options',
            showDenyButton: true,
            showCancelButton: true,
            cancelButtonColor: 'red',
            denyButtonColor: 'green',
            confirmButtonText: `Camera`,
            denyButtonText: `Screen/Window`,
            cancelButtonText: `Cancel`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                this.startMobileRecording(options, audioMixerTracks);
            } else if (result.isDenied) {
                this.startDesktopRecording(options, audioMixerTracks);
            }
        });
    }

    startMobileRecording(options, audioMixerTracks) {
        try {
            // Combine audioMixerTracks and videoTracks into a single array
            const combinedTracks = [];

            if (Array.isArray(audioMixerTracks)) {
                combinedTracks.push(...audioMixerTracks);
            }

            if (this.localVideoStream !== null) {
                const videoTracks = this.localVideoStream.getVideoTracks();
                console.log('Cam video tracks --->', videoTracks);

                if (Array.isArray(videoTracks)) {
                    combinedTracks.push(...videoTracks);
                }
            }

            const recCamStream = new MediaStream(combinedTracks);
            console.log('New Cam Media Stream tracks  --->', recCamStream.getTracks());

            this.mediaRecorder = new MediaRecorder(recCamStream, options);
            console.log('Created MediaRecorder', this.mediaRecorder, 'with options', options);

            this.getId('swapCameraButton').className = 'hidden';

            this.initRecording();
        } catch (err) {
            this.handleRecordingError('Unable to record the camera + audio: ' + err, false);
        }
    }

    startDesktopRecording(options, audioMixerTracks) {
        // On desktop devices, record camera or screen/window... + all audio tracks
        const constraints = { video: true };
        navigator.mediaDevices
            .getDisplayMedia(constraints)
            .then((screenStream) => {
                const screenTracks = screenStream.getVideoTracks();
                console.log('Screen video tracks --->', screenTracks);

                const combinedTracks = [];

                if (Array.isArray(screenTracks)) {
                    combinedTracks.push(...screenTracks);
                }
                if (Array.isArray(audioMixerTracks)) {
                    combinedTracks.push(...audioMixerTracks);
                }

                const recScreenStream = new MediaStream(combinedTracks);
                console.log('New Screen/Window Media Stream tracks  --->', recScreenStream.getTracks());

                this.recScreenStream = recScreenStream;
                this.mediaRecorder = new MediaRecorder(recScreenStream, options);
                console.log('Created MediaRecorder', this.mediaRecorder, 'with options', options);

                this.initRecording();
            })
            .catch((err) => {
                this.handleRecordingError('Unable to record the screen + audio: ' + err, false);
            });
    }

    initRecording() {
        this._isRecording = true;
        this.handleMediaRecorder();
        this.event(_EVENTS.startRec);
        this.recordingAction(enums.recording.start);
        this.sound('recStart');
    }

    hasAudioTrack(mediaStream) {
        if (!mediaStream) return false;
        const audioTracks = mediaStream.getAudioTracks();
        return audioTracks.length > 0;
    }

    hasVideoTrack(mediaStream) {
        if (!mediaStream) return false;
        const videoTracks = mediaStream.getVideoTracks();
        return videoTracks.length > 0;
    }

    getAudioTracksFromAudioElements() {
        const audioElements = document.querySelectorAll('audio');
        const audioTracks = [];
        audioElements.forEach((audio) => {
            // Exclude avatar Preview Audio
            if (audio.id !== 'avatarPreviewAudio') {
                const audioTrack = audio.srcObject.getAudioTracks()[0];
                if (audioTrack) {
                    audioTracks.push(audioTrack);
                }
            }
        });
        return audioTracks;
    }

    getAudioStreamFromAudioElements() {
        const audioElements = document.querySelectorAll('audio');
        const audioStream = new MediaStream();
        audioElements.forEach((audio) => {
            // Exclude avatar Preview Audio
            if (audio.id !== 'avatarPreviewAudio') {
                const audioTrack = audio.srcObject.getAudioTracks()[0];
                if (audioTrack) {
                    audioStream.addTrack(audioTrack);
                }
            }
        });
        return audioStream;
    }

    handleMediaRecorder() {
        if (this.mediaRecorder) {
            this.recServerFileName = this.getServerRecFileName();
            rc.recording.recSyncServerRecording
                ? this.mediaRecorder.start(this.recSyncTime)
                : this.mediaRecorder.start();
            this.mediaRecorder.addEventListener('start', this.handleMediaRecorderStart);
            this.mediaRecorder.addEventListener('dataavailable', this.handleMediaRecorderData);
            this.mediaRecorder.addEventListener('stop', this.handleMediaRecorderStop);
        }
    }

    getServerRecFileName() {
        const dateTime = getDataTimeStringFormat();
        const roomName = this.room_id.trim();
        return `Rec_${roomName}_${dateTime}.webm`;
    }

    handleMediaRecorderStart(evt) {
        console.log('MediaRecorder started: ', evt);
        rc.cleanLastRecordingInfo();
        rc.disableRecordingOptions();
    }

    handleMediaRecorderData(evt) {
        // console.log('MediaRecorder data: ', evt);
        if (evt.data && evt.data.size > 0) {
            rc.recording.recSyncServerRecording ? rc.syncRecordingInCloud(evt.data) : recordedBlobs.push(evt.data);
        }
    }

    async syncRecordingInCloud(data) {
        const arrayBuffer = await data.arrayBuffer();
        const chunkSize = rc.recSyncChunkSize;
        const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const chunk = arrayBuffer.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize);
            try {
                await axios.post(
                    `${this.recording.recSyncServerEndpoint}/recSync?fileName=` + rc.recServerFileName,
                    chunk,
                    {
                        headers: {
                            'Content-Type': 'application/octet-stream',
                        },
                    },
                );
            } catch (error) {
                console.error('Error syncing chunk:', error.message);
            }
        }
    }

    handleMediaRecorderStop(evt) {
        try {
            console.log('MediaRecorder stopped: ', evt);
            rc.recording.recSyncServerRecording ? rc.handleServerRecordingStop() : rc.handleLocalRecordingStop();
            rc.disableRecordingOptions(false);
        } catch (err) {
            console.error('Recording save failed', err);
        }
    }

    disableRecordingOptions(disabled = true) {
        switchH264Recording.disabled = disabled;
        switchServerRecording.disabled = disabled;
        switchHostOnlyRecording.disabled = disabled;
    }

    handleLocalRecordingStop() {
        console.log('MediaRecorder Blobs: ', recordedBlobs);

        const dateTime = getDataTimeString();
        const type = recordedBlobs[0].type.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(recordedBlobs, { type: 'video/' + type });
        const recFileName = `Rec_${dateTime}.${type}`;
        const currentDevice = DetectRTC.isMobileDevice ? 'MOBILE' : 'PC';
        const blobFileSize = bytesToSize(blob.size);
        const recTime = document.getElementById('recordingStatus');
        const recType = 'Locally';
        const recordingInfo = `
        <br/><br/>
        <ul>
            <li>Stored: ${recType}</li>
            <li>Time: ${recTime.innerText}</li>
            <li>File: ${recFileName}</li>
            <li>Codecs: ${recCodecs}</li>
            <li>Size: ${blobFileSize}</li>
        </ul>
        <br/>
        `;
        const recordingMsg = `Please wait to be processed, then will be downloaded to your ${currentDevice} device.`;

        this.saveLastRecordingInfo(recordingInfo);
        this.showRecordingInfo(recType, recordingInfo, recordingMsg);
        this.saveRecordingInLocalDevice(blob, recFileName, recTime);
    }

    handleServerRecordingStop() {
        console.log('MediaRecorder Stop');
        const recTime = document.getElementById('recordingStatus');
        const recType = 'Server';
        const recordingInfo = `
        <br/><br/>
        <ul>
            <li>Stored: ${recType}</li>
            <li>Time: ${recTime.innerText}</li>
            <li>File: ${this.recServerFileName}</li>
            <li>Codecs: ${recCodecs}</li>
        </ul>
        <br/>
        `;
        this.saveLastRecordingInfo(recordingInfo);
        this.showRecordingInfo(recType, recordingInfo);
    }

    saveLastRecordingInfo(recordingInfo) {
        const lastRecordingInfo = document.getElementById('lastRecordingInfo');
        lastRecordingInfo.style.color = '#FFFFFF';
        lastRecordingInfo.innerHTML = `Last Recording Info: ${recordingInfo}`;
        show(lastRecordingInfo);
    }

    cleanLastRecordingInfo() {
        const lastRecordingInfo = document.getElementById('lastRecordingInfo');
        lastRecordingInfo.innerHTML = '';
        hide(lastRecordingInfo);
    }

    showRecordingInfo(recType, recordingInfo, recordingMsg = '') {
        if (window.localStorage.isReconnected === 'false') {
            Swal.fire({
                background: swalBackground,
                position: 'center',
                icon: 'success',
                title: 'Recording',
                html: `<div style="text-align: left;">
                🔴 ${recType} Recording Info: 
                ${recordingInfo}
                ${recordingMsg}
                </div>`,
                showClass: { popup: 'animate__animated animate__fadeInDown' },
                hideClass: { popup: 'animate__animated animate__fadeOutUp' },
            });
        }
    }

    saveRecordingInLocalDevice(blob, recFileName, recTime) {
        console.log('MediaRecorder Download Blobs');
        const url = window.URL.createObjectURL(blob);

        const downloadLink = document.createElement('a');
        downloadLink.style.display = 'none';
        downloadLink.href = url;
        downloadLink.download = recFileName;
        document.body.appendChild(downloadLink);
        downloadLink.click();

        setTimeout(() => {
            document.body.removeChild(downloadLink);
            window.URL.revokeObjectURL(url);
            console.log(`🔴 Recording FILE: ${recFileName} done 👍`);
            recordedBlobs = [];
            recTime.innerText = '0s';
        }, 100);
    }

    pauseRecording() {
        if (this.mediaRecorder) {
            this._isRecording = false;
            this.mediaRecorder.pause();
            this.event(_EVENTS.pauseRec);
            this.recordingAction('Pause recording');
        }
    }

    resumeRecording() {
        if (this.mediaRecorder) {
            this._isRecording = true;
            this.mediaRecorder.resume();
            this.event(_EVENTS.resumeRec);
            this.recordingAction('Resume recording');
        }
    }

    stopRecording() {
        if (this.mediaRecorder) {
            this._isRecording = false;
            this.mediaRecorder.stop();
            this.mediaRecorder = null;
            if (this.recScreenStream) {
                this.recScreenStream.getTracks().forEach((track) => {
                    if (track.kind === 'video') track.stop();
                });
            }
            if (this.isMobileDevice) this.getId('swapCameraButton').className = '';
            this.event(_EVENTS.stopRec);
            this.audioRecorder.stopMixedAudioStream();
            this.recordingAction(enums.recording.stop);
            this.sound('recStop');
        }
    }

    recordingAction(action) {
        if (!this.thereAreParticipants()) return;
        this.socket.emit('recordingAction', {
            peer_name: this.peer_name,
            peer_id: this.peer_id,
            action: action,
        });
    }

    handleRecordingAction(data) {
        console.log('Handle recording action', data);

        const { peer_name, peer_id, action } = data;

        const recAction = {
            side: 'left',
            img: this.leftMsgAvatar,
            peer_name: peer_name,
            peer_id: peer_id,
            peer_msg: `🔴 ${action}`,
            to_peer_id: 'all',
            to_peer_name: 'all',
        };
        this.showMessage(recAction);

        const recData = {
            type: 'recording',
            action: action,
            peer_name: peer_name,
        };

        this.msgHTML(
            recData,
            null,
            image.recording,
            null,
            `${icons.user} ${peer_name} 
            <br /><br /> 
            <span>🔴 ${action}</span>
            <br />`,
        );
    }

    saveRecording(reason) {
        if (this._isRecording || recordingStatus.innerText != '0s') {
            console.log(`Save recording: ${reason}`);
            this.stopRecording();
        }
    }

    // ####################################################
    // FILE SHARING
    // ####################################################

    handleSF(uid) {
        const words = uid.split('___');
        let peer_id = words[1];
        let btnSf = this.getId(uid);
        if (btnSf) {
            btnSf.addEventListener('click', () => {
                this.selectFileToShare(peer_id);
            });
        }
    }

    handleDD(uid, peer_id, itsMe = false) {
        let videoPlayer = this.getId(uid);
        if (videoPlayer) {
            videoPlayer.addEventListener('dragover', function (e) {
                e.preventDefault();
            });
            videoPlayer.addEventListener('drop', function (e) {
                e.preventDefault();
                if (itsMe) {
                    return userLog('warning', 'You cannot send files to yourself.', 'top-end');
                }
                if (this.sendInProgress) {
                    return userLog('warning', 'Please wait for the previous file to be sent.', 'top-end');
                }
                if (e.dataTransfer.items && e.dataTransfer.items.length > 1) {
                    return userLog('warning', 'Please drag and drop a single file.', 'top-end');
                }
                if (e.dataTransfer.items) {
                    let item = e.dataTransfer.items[0].webkitGetAsEntry();
                    console.log('Drag and drop', item);
                    if (item.isDirectory) {
                        return userLog('warning', 'Please drag and drop a single file not a folder.', 'top-end');
                    }
                    var file = e.dataTransfer.items[0].getAsFile();
                    rc.sendFileInformations(file, peer_id);
                } else {
                    rc.sendFileInformations(e.dataTransfer.files[0], peer_id);
                }
            });
        }
    }

    selectFileToShare(peer_id, broadcast = false) {
        this.sound('open');

        Swal.fire({
            allowOutsideClick: false,
            background: swalBackground,
            imageAlt: 'mirotalksfu-file-sharing',
            imageUrl: image.share,
            position: 'center',
            title: 'Share file',
            input: 'file',
            html: `
            <div id="dropArea">
                <p>Drag and drop your file here</p>
            </div>
            `,
            inputAttributes: {
                accept: this.fileSharingInput,
                'aria-label': 'Select file',
            },
            didOpen: () => {
                const dropArea = document.getElementById('dropArea');
                dropArea.addEventListener('dragenter', handleDragEnter);
                dropArea.addEventListener('dragover', handleDragOver);
                dropArea.addEventListener('dragleave', handleDragLeave);
                dropArea.addEventListener('drop', handleDrop);
            },
            showDenyButton: true,
            confirmButtonText: `Send`,
            denyButtonText: `Cancel`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                this.sendFileInformations(result.value, peer_id, broadcast);
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
                rc.sendFileInformations(file, peer_id, broadcast);
            }
        }
    }

    sendFileInformations(file, peer_id, broadcast = false) {
        if (this.isFileReaderRunning()) {
            return this.userLog('warning', 'File transfer in progress. Please wait until it completes', 'top-end');
        }
        this.fileToSend = file;
        //
        if (this.fileToSend && this.fileToSend.size > 0) {
            if (!this.thereAreParticipants()) {
                return userLog('info', 'No participants detected', 'top-end');
            }
            // prevent XSS injection
            if (this.isHtml(this.fileToSend.name) || !this.isValidFileName(this.fileToSend.name))
                return userLog('warning', 'Invalid file name!', 'top-end', 5000);

            const fileInfo = {
                peer_id: peer_id,
                broadcast: broadcast,
                peer_name: this.peer_name,
                fileName: this.fileToSend.name,
                fileSize: this.fileToSend.size,
                fileType: this.fileToSend.type,
            };
            this.setMsgAvatar('left', this.peer_name);
            this.appendMessage(
                'left',
                this.leftMsgAvatar,
                this.peer_name,
                this.peer_id,
                `${icons.fileSend} File send: 
                <br/> 
                <ul>
                    <li>Name: ${this.fileToSend.name}</li>
                    <li>Size: ${this.bytesToSize(this.fileToSend.size)}</li>
                </ul>`,
                'all',
                'all',
            );
            // send some metadata about our file to peers in the room
            this.socket.emit('fileInfo', fileInfo);
            setTimeout(() => {
                this.sendFileData(peer_id, broadcast);
            }, 1000);
        } else {
            userLog('error', 'File not selected or empty.', 'top-end');
        }
    }

    handleFileInfo(data) {
        this.incomingFileInfo = data;
        this.incomingFileData = [];
        this.receiveBuffer = [];
        this.receivedSize = 0;
        let fileToReceiveInfo =
            ' From: ' +
            this.incomingFileInfo.peer_name +
            html.newline +
            ' Incoming file: ' +
            this.incomingFileInfo.fileName +
            html.newline +
            ' File type: ' +
            this.incomingFileInfo.fileType +
            html.newline +
            ' File size: ' +
            this.bytesToSize(this.incomingFileInfo.fileSize);
        this.setMsgAvatar('right', this.incomingFileInfo.peer_name);
        this.appendMessage(
            'right',
            this.rightMsgAvatar,
            this.incomingFileInfo.peer_name,
            this.incomingFileInfo.peer_id,
            `${icons.fileReceive} File receive: 
            <br/> 
            <ul>
                <li>From: ${this.incomingFileInfo.peer_name}</li>
                <li>Id: ${this.incomingFileInfo.peer_id}</li>
                <li>Name: ${this.incomingFileInfo.fileName}</li>
                <li>Size: ${this.bytesToSize(this.incomingFileInfo.fileSize)}</li>
            </ul>`,
            'all',
            'all',
        );
        receiveFileInfo.innerText = fileToReceiveInfo;
        receiveFileDiv.style.display = 'inline';
        receiveProgress.max = this.incomingFileInfo.fileSize;
        this.userLog('info', fileToReceiveInfo, 'top-end');
        this.receiveInProgress = true;
    }

    sendFileData(peer_id, broadcast) {
        console.log('Send file ', {
            name: this.fileToSend.name,
            size: this.bytesToSize(this.fileToSend.size),
            type: this.fileToSend.type,
        });

        this.sendInProgress = true;

        sendFileInfo.innerText =
            'File name: ' +
            this.fileToSend.name +
            html.newline +
            'File type: ' +
            this.fileToSend.type +
            html.newline +
            'File size: ' +
            this.bytesToSize(this.fileToSend.size) +
            html.newline;

        sendFileDiv.style.display = 'inline';
        sendProgress.max = this.fileToSend.size;

        this.fileReader = new FileReader();
        let offset = 0;

        this.fileReader.addEventListener('error', (err) => console.error('fileReader error', err));
        this.fileReader.addEventListener('abort', (e) => console.log('fileReader aborted', e));
        this.fileReader.addEventListener('load', (e) => {
            if (!this.sendInProgress) return;

            let data = {
                peer_id: peer_id,
                broadcast: broadcast,
                fileData: e.target.result,
            };
            this.sendFSData(data);
            offset += data.fileData.byteLength;

            sendProgress.value = offset;
            sendFilePercentage.innerText = 'Send progress: ' + ((offset / this.fileToSend.size) * 100).toFixed(2) + '%';

            // send file completed
            if (offset === this.fileToSend.size) {
                this.sendInProgress = false;
                sendFileDiv.style.display = 'none';
                userLog('success', 'The file ' + this.fileToSend.name + ' was sent successfully.', 'top-end');
            }

            if (offset < this.fileToSend.size) readSlice(offset);
        });
        const readSlice = (o) => {
            const slice = this.fileToSend.slice(offset, o + this.chunkSize);
            this.fileReader.readAsArrayBuffer(slice);
        };
        readSlice(0);
    }

    sendFSData(data) {
        if (data) this.socket.emit('file', data);
    }

    abortFileTransfer() {
        if (this.isFileReaderRunning()) {
            this.fileReader.abort();
            sendFileDiv.style.display = 'none';
            this.sendInProgress = false;
            this.socket.emit('fileAbort', {
                peer_name: this.peer_name,
            });
        }
    }

    abortReceiveFileTransfer() {
        const data = { peer_name: this.peer_name };
        this.socket.emit('receiveFileAbort', data);
        setTimeout(() => {
            this.handleFileAbort(data);
        }, 1000);
    }

    hideFileTransfer() {
        receiveFileDiv.style.display = 'none';
    }

    isFileReaderRunning() {
        return this.fileReader && this.fileReader.readyState === 1;
    }

    handleReceiveFileAbort(data) {
        if (this.isFileReaderRunning()) {
            this.userLog('info', data.peer_name + ' ⚠️ aborted file transfer', 'top-end');
            this.fileReader.abort();
            sendFileDiv.style.display = 'none';
            this.sendInProgress = false;
        } else {
            this.handleFileAbort(data);
        }
    }

    handleFileAbort(data) {
        this.receiveBuffer = [];
        this.incomingFileData = [];
        this.receivedSize = 0;
        this.receiveInProgress = false;
        receiveFileDiv.style.display = 'none';
        console.log(data.peer_name + ' aborted the file transfer');
        this.userLog('info', data.peer_name + ' ⚠️ aborted the file transfer', 'top-end');
    }

    handleFile(data) {
        if (!this.receiveInProgress) return;
        this.receiveBuffer.push(data.fileData);
        this.receivedSize += data.fileData.byteLength;
        receiveProgress.value = this.receivedSize;
        receiveFilePercentage.innerText =
            'Receive progress: ' + ((this.receivedSize / this.incomingFileInfo.fileSize) * 100).toFixed(2) + '%';
        if (this.receivedSize === this.incomingFileInfo.fileSize) {
            receiveFileDiv.style.display = 'none';
            this.incomingFileData = this.receiveBuffer;
            this.receiveBuffer = [];
            this.endFileDownload();
        }
    }

    endFileDownload() {
        this.sound('download');

        // save received file into Blob
        const blob = new Blob(this.incomingFileData);
        const file = this.incomingFileInfo.fileName;

        this.incomingFileData = [];

        // if file is image, show the preview
        if (isImageURL(this.incomingFileInfo.fileName)) {
            const reader = new FileReader();
            reader.onload = (e) => {
                Swal.fire({
                    allowOutsideClick: false,
                    background: swalBackground,
                    position: 'center',
                    title: 'Received file',
                    text: this.incomingFileInfo.fileName + ' size ' + this.bytesToSize(this.incomingFileInfo.fileSize),
                    imageUrl: e.target.result,
                    imageAlt: 'mirotalksfu-file-img-download',
                    showDenyButton: true,
                    confirmButtonText: `Save`,
                    denyButtonText: `Cancel`,
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                }).then((result) => {
                    if (result.isConfirmed) this.saveBlobToFile(blob, file);
                });
            };
            // blob where is stored downloaded file
            reader.readAsDataURL(blob);
        } else {
            // not img file
            Swal.fire({
                allowOutsideClick: false,
                background: swalBackground,
                position: 'center',
                title: 'Received file',
                text: this.incomingFileInfo.fileName + ' size ' + this.bytesToSize(this.incomingFileInfo.fileSize),
                showDenyButton: true,
                confirmButtonText: `Save`,
                denyButtonText: `Cancel`,
                showClass: { popup: 'animate__animated animate__fadeInDown' },
                hideClass: { popup: 'animate__animated animate__fadeOutUp' },
            }).then((result) => {
                if (result.isConfirmed) this.saveBlobToFile(blob, file);
            });
        }
    }

    saveBlobToFile(blob, file) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = file;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);
    }

    bytesToSize(bytes) {
        let sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes == 0) return '0 Byte';
        let i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
        return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
    }

    toHtmlJson(obj) {
        return '<pre>' + JSON.stringify(obj, null, 4) + '</pre>';
    }

    isValidFileName(fileName) {
        const invalidChars = /[\\\/\?\*\|:"<>]/;
        return !invalidChars.test(fileName);
    }

    // ####################################################
    // SHARE VIDEO YOUTUBE - MP4 - WEBM - OGG or AUDIO mp3
    // ####################################################

    handleSV(uid) {
        const words = uid.split('___');
        let peer_id = words[1];
        let btnSv = this.getId(uid);
        if (btnSv) {
            btnSv.addEventListener('click', () => {
                this.shareVideo(peer_id);
            });
        }
    }

    shareVideo(peer_id = 'all') {
        this.sound('open');

        Swal.fire({
            background: swalBackground,
            position: 'center',
            imageUrl: image.videoShare,
            title: 'Share a Video or Audio',
            text: 'Paste a Video or Audio URL',
            input: 'text',
            showCancelButton: true,
            confirmButtonText: `Share`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.value) {
                result.value = filterXSS(result.value);
                if (!this.thereAreParticipants()) {
                    return userLog('info', 'No participants detected', 'top-end');
                }
                if (!this.isVideoTypeSupported(result.value)) {
                    return userLog('warning', 'Something wrong, try with another Video or audio URL');
                }
                /*
                    https://www.youtube.com/watch?v=RT6_Id5-7-s
                    https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4
                    https://www.learningcontainer.com/wp-content/uploads/2020/02/Kalimba.mp3
                */
                let is_youtube = this.getVideoType(result.value) == 'na' ? true : false;
                let video_url = is_youtube ? this.getYoutubeEmbed(result.value) : result.value;
                if (video_url) {
                    let data = {
                        peer_id: peer_id,
                        peer_name: this.peer_name,
                        video_url: video_url,
                        is_youtube: is_youtube,
                        action: 'open',
                    };
                    console.log('Video URL: ', video_url);
                    this.socket.emit('shareVideoAction', data);
                    this.openVideo(data);
                } else {
                    this.userLog('error', 'Not valid video URL', 'top-end', 6000);
                }
            }
        });
    }

    getVideoType(url) {
        if (url.endsWith('.mp4')) return 'video/mp4';
        if (url.endsWith('.mp3')) return 'video/mp3';
        if (url.endsWith('.webm')) return 'video/webm';
        if (url.endsWith('.ogg')) return 'video/ogg';
        return 'na';
    }

    isVideoTypeSupported(url) {
        if (
            url.endsWith('.mp4') ||
            url.endsWith('.mp3') ||
            url.endsWith('.webm') ||
            url.endsWith('.ogg') ||
            url.includes('youtube.com')
        )
            return true;
        return false;
    }

    getYoutubeEmbed(url) {
        let regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        let match = url.match(regExp);
        return match && match[7].length == 11 ? 'https://www.youtube.com/embed/' + match[7] + '?autoplay=1' : false;
    }

    shareVideoAction(data) {
        let peer_name = data.peer_name;
        let action = data.action;
        switch (action) {
            case 'open':
                this.userLog('info', `${peer_name} <i class="fab fa-youtube"></i> opened the video`, 'top-end');
                this.openVideo(data);
                break;
            case 'close':
                this.userLog('info', `${peer_name} <i class="fab fa-youtube"></i> closed the video`, 'top-end');
                this.closeVideo();
                break;
            default:
                break;
        }
    }

    openVideo(data) {
        let d, vb, e, video, pn;
        let peer_name = data.peer_name;
        let video_url = data.video_url;
        let is_youtube = data.is_youtube;
        let video_type = this.getVideoType(video_url);
        this.closeVideo();
        show(videoCloseBtn);
        d = document.createElement('div');
        d.className = 'Camera';
        d.id = '__shareVideo';
        vb = document.createElement('div');
        vb.setAttribute('id', '__videoBar');
        vb.className = 'videoMenuBar fadein';
        e = document.createElement('button');
        e.className = 'fas fa-times';
        e.id = '__videoExit';
        pn = document.createElement('button');
        pn.id = '__pinUnpin';
        pn.className = html.pin;
        if (is_youtube) {
            video = document.createElement('iframe');
            video.setAttribute('title', peer_name);
            video.setAttribute(
                'allow',
                'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
            );
            video.setAttribute('frameborder', '0');
            video.setAttribute('allowfullscreen', true);
        } else {
            video = document.createElement('video');
            video.type = video_type;
            video.autoplay = true;
            video.controls = true;
            if (video_type == 'video/mp3') {
                video.poster = image.audio;
            }
        }
        video.setAttribute('id', '__videoShare');
        video.setAttribute('src', video_url);
        video.setAttribute('width', '100%');
        video.setAttribute('height', '100%');
        vb.appendChild(e);
        if (!this.isMobileDevice) vb.appendChild(pn);
        d.appendChild(video);
        d.appendChild(vb);
        this.videoMediaContainer.appendChild(d);
        handleAspectRatio();
        let exitVideoBtn = this.getId(e.id);
        exitVideoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.closeVideo(true);
        });
        this.handlePN(video.id, pn.id, d.id);
        if (!this.isMobileDevice) {
            this.setTippy(pn.id, 'Toggle Pin video player', 'bottom');
            this.setTippy(e.id, 'Close video player', 'bottom');
        }
        console.log('[openVideo] Video-element-count', this.videoMediaContainer.childElementCount);
        this.sound('joined');
    }

    closeVideo(emit = false, peer_id = 'all') {
        if (emit) {
            let data = {
                peer_id: peer_id,
                peer_name: this.peer_name,
                action: 'close',
            };
            this.socket.emit('shareVideoAction', data);
        }
        let shareVideoDiv = this.getId('__shareVideo');
        if (shareVideoDiv) {
            hide(videoCloseBtn);
            shareVideoDiv.parentNode.removeChild(shareVideoDiv);
            //alert(this.isVideoPinned + ' - ' + this.pinnedVideoPlayerId);
            if (this.isVideoPinned && this.pinnedVideoPlayerId == '__videoShare') {
                this.removeVideoPinMediaContainer();
                console.log('Remove pin container due the Video player close');
            }
            handleAspectRatio();
            console.log('[closeVideo] Video-element-count', this.videoMediaContainer.childElementCount);
            this.sound('left');
        }
    }

    // ####################################################
    // ROOM ACTION
    // ####################################################

    roomAction(action, emit = true, popup = true) {
        const data = {
            room_broadcasting: isBroadcastingEnabled,
            room_id: this.room_id,
            peer_id: this.peer_id,
            peer_name: this.peer_name,
            peer_uuid: this.peer_uuid,
            action: action,
            password: null,
        };
        if (emit) {
            switch (action) {
                case 'broadcasting':
                    this.socket.emit('roomAction', data);
                    if (popup) this.roomStatus(action);
                    break;
                case 'lock':
                    if (room_password) {
                        this.socket
                            .request('getPeerCounts')
                            .then(async (res) => {
                                // Only the presenter can lock the room
                                if (isPresenter || res.peerCounts == 1) {
                                    isPresenter = true;
                                    this.peer_info.peer_presenter = isPresenter;
                                    this.getId('isUserPresenter').innerText = isPresenter;
                                    data.password = room_password;
                                    this.socket.emit('roomAction', data);
                                    if (popup) this.roomStatus(action);
                                }
                            })
                            .catch((err) => {
                                console.log('Get peer counts:', err);
                            });
                    } else {
                        Swal.fire({
                            allowOutsideClick: false,
                            allowEscapeKey: false,
                            showDenyButton: true,
                            background: swalBackground,
                            imageUrl: image.locked,
                            input: 'text',
                            inputPlaceholder: 'Set Room password',
                            confirmButtonText: `OK`,
                            denyButtonText: `Cancel`,
                            showClass: { popup: 'animate__animated animate__fadeInDown' },
                            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                            inputValidator: (pwd) => {
                                if (!pwd) return 'Please enter the Room password';
                                this.RoomPassword = pwd;
                            },
                        }).then((result) => {
                            if (result.isConfirmed) {
                                data.password = this.RoomPassword;
                                this.socket.emit('roomAction', data);
                                this.roomStatus(action);
                            }
                        });
                    }
                    break;
                case 'unlock':
                    this.socket.emit('roomAction', data);
                    if (popup) this.roomStatus(action);
                    break;
                case 'lobbyOn':
                    this.socket.emit('roomAction', data);
                    if (popup) this.roomStatus(action);
                    break;
                case 'lobbyOff':
                    this.socket.emit('roomAction', data);
                    if (popup) this.roomStatus(action);
                    break;
                case 'hostOnlyRecordingOn':
                    this.socket.emit('roomAction', data);
                    if (popup) this.roomStatus(action);
                    break;
                case 'hostOnlyRecordingOff':
                    this.socket.emit('roomAction', data);
                    if (popup) this.roomStatus(action);
                    break;
                case 'isBanned':
                    this.socket.emit('roomAction', data);
                    this.isBanned();
                    break;
                default:
                    break;
            }
        } else {
            this.roomStatus(action);
        }
    }

    roomStatus(action) {
        switch (action) {
            case 'broadcasting':
                this.userLog('info', `${icons.room} BROADCASTING ${isBroadcastingEnabled ? 'On' : 'Off'}`, 'top-end');
                break;
            case 'lock':
                this.sound('locked');
                this.event(_EVENTS.roomLock);
                this.userLog('info', `${icons.lock} LOCKED the room by the password`, 'top-end');
                break;
            case 'unlock':
                this.event(_EVENTS.roomUnlock);
                this.userLog('info', `${icons.unlock} UNLOCKED the room`, 'top-end');
                break;
            case 'lobbyOn':
                this.event(_EVENTS.lobbyOn);
                this.userLog('info', `${icons.lobby} Lobby is enabled`, 'top-end');
                break;
            case 'lobbyOff':
                this.event(_EVENTS.lobbyOff);
                this.userLog('info', `${icons.lobby} Lobby is disabled`, 'top-end');
                break;
            case 'hostOnlyRecordingOn':
                this.event(_EVENTS.hostOnlyRecordingOn);
                this.userLog('info', `${icons.recording} Host only recording is enabled`, 'top-end');
                break;
            case 'hostOnlyRecordingOff':
                this.event(_EVENTS.hostOnlyRecordingOff);
                this.userLog('info', `${icons.recording} Host only recording is disabled`, 'top-end');
                break;
            default:
                break;
        }
    }

    roomMessage(action, active = false) {
        const status = active ? 'ON' : 'OFF';
        this.sound('switch');
        switch (action) {
            case 'pitchBar':
                this.userLog('info', `${icons.pitchBar} Audio pitch bar ${status}`, 'top-end');
                break;
            case 'sounds':
                this.userLog('info', `${icons.sounds} Sounds notification ${status}`, 'top-end');
                break;
            case 'ptt':
                this.userLog('info', `${icons.ptt} Push to talk ${status}`, 'top-end');
                break;
            case 'notify':
                this.userLog('info', `${icons.share} Share room on join ${status}`, 'top-end');
                break;
            case 'hostOnlyRecording':
                this.userLog('info', `${icons.recording} Only host recording ${status}`, 'top-end');
                break;
            case 'showChat':
                active
                    ? this.userLog('info', `${icons.chat} Chat will be shown, when you receive a message`, 'top-end')
                    : this.userLog(
                          'info',
                          `${icons.chat} Chat not will be shown, when you receive a message`,
                          'top-end',
                      );
                break;
            case 'speechMessages':
                this.userLog('info', `${icons.speech} Speech incoming messages ${status}`, 'top-end');
                break;
            case 'transcriptShowOnMsg':
                active
                    ? this.userLog(
                          'info',
                          `${icons.transcript} Transcript will be shown, when you receive a message`,
                          'top-end',
                      )
                    : this.userLog(
                          'info',
                          `${icons.transcript} Transcript not will be shown, when you receive a message`,
                          'top-end',
                      );
                break;
            case 'audio_start_muted':
                this.userLog('info', `${icons.moderator} Moderator: everyone starts muted ${status}`, 'top-end');
                break;
            case 'video_start_hidden':
                this.userLog('info', `${icons.moderator} Moderator: everyone starts hidden ${status}`, 'top-end');
                break;
            case 'audio_cant_unmute':
                this.userLog(
                    'info',
                    `${icons.moderator} Moderator: everyone can't unmute themselves ${status}`,
                    'top-end',
                );
                break;
            case 'video_cant_unhide':
                this.userLog(
                    'info',
                    `${icons.moderator} Moderator: everyone can't unhide themselves ${status}`,
                    'top-end',
                );
                break;
            case 'screen_cant_share':
                this.userLog(
                    'info',
                    `${icons.moderator} Moderator: everyone can't share the screen ${status}`,
                    'top-end',
                );
                break;
            case 'chat_cant_privately':
                this.userLog(
                    'info',
                    `${icons.moderator} Moderator: everyone can't chat privately ${status}`,
                    'top-end',
                );
                break;
            case 'chat_cant_chatgpt':
                this.userLog(
                    'info',
                    `${icons.moderator} Moderator: everyone can't chat with ChatGPT ${status}`,
                    'top-end',
                );
                break;
            case 'disconnect_all_on_leave':
                this.userLog('info', `${icons.moderator} Moderator: disconnect all on leave room ${status}`, 'top-end');
                break;
            case 'recPrioritizeH264':
                this.userLog('info', `${icons.codecs} Recording prioritize h.264  ${status}`, 'top-end');
                break;
            case 'recSyncServer':
                this.userLog('info', `${icons.recSync} Server Sync Recording ${status}`, 'top-end');
                break;
            case 'customThemeKeep':
                this.userLog('info', `${icons.theme} Custom theme keep ${status}`, 'top-end');
                break;
            default:
                break;
        }
    }

    roomPassword(data) {
        switch (data.password) {
            case 'OK':
                this.joinAllowed(data.room);
                break;
            case 'KO':
                this.roomIsLocked();
                break;
            default:
                break;
        }
    }

    // ####################################################
    // ROOM LOBBY
    // ####################################################

    async roomLobby(data) {
        console.log('LOBBY--->', data);
        switch (data.lobby_status) {
            case 'waiting':
                if (!isRulesActive || isPresenter) {
                    let lobbyTr = '';
                    let peer_id = data.peer_id;
                    let peer_name = data.peer_name;
                    let avatarImg = rc.isValidEmail(peer_name)
                        ? this.genGravatar(peer_name)
                        : this.genAvatarSvg(peer_name, 32);
                    let lobbyTb = this.getId('lobbyTb');
                    let lobbyAccept = _PEER.acceptPeer;
                    let lobbyReject = _PEER.ejectPeer;
                    let lobbyAcceptId = `${peer_name}___${peer_id}___lobbyAccept`;
                    let lobbyRejectId = `${peer_name}___${peer_id}___lobbyReject`;

                    lobbyTr += `
                    <tr id='${peer_id}'>
                        <td><img src="${avatarImg}" /></td>
                        <td>${peer_name}</td>
                        <td><button id='${lobbyAcceptId}' onclick="rc.lobbyAction(this.id, 'accept')">${lobbyAccept}</button></td>
                        <td><button id='${lobbyRejectId}' onclick="rc.lobbyAction(this.id, 'reject')">${lobbyReject}</button></td>
                    </tr>
                    `;

                    lobbyTb.innerHTML += lobbyTr;
                    lobbyParticipantsCount++;
                    lobbyHeaderTitle.innerText = 'Lobby users (' + lobbyParticipantsCount + ')';
                    if (!isLobbyOpen) this.lobbyToggle();
                    if (!this.isMobileDevice) {
                        setTippy(lobbyAcceptId, 'Accept', 'top');
                        setTippy(lobbyRejectId, 'Reject', 'top');
                    }
                    this.userLog('info', peer_name + ' wants to join the meeting', 'top-end');
                }
                break;
            case 'accept':
                await this.joinAllowed(data.room);
                control.style.display = 'flex';
                this.msgPopup('info', 'Your join meeting was be accepted by moderator');
                break;
            case 'reject':
                this.sound('eject');
                Swal.fire({
                    icon: 'warning',
                    allowOutsideClick: false,
                    allowEscapeKey: true,
                    showDenyButton: false,
                    showConfirmButton: true,
                    background: swalBackground,
                    title: 'Rejected',
                    text: 'Your join meeting was be rejected by moderator',
                    confirmButtonText: `Ok`,
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                }).then((result) => {
                    if (result.isConfirmed) {
                        this.exit();
                    }
                });
                break;
            default:
                break;
        }
    }

    lobbyAction(id, lobby_status) {
        const words = id.split('___');
        const peer_name = words[0];
        const peer_id = words[1];
        const data = {
            room_id: this.room_id,
            peer_id: peer_id,
            peer_name: peer_name,
            lobby_status: lobby_status,
            broadcast: false,
        };
        this.socket.emit('roomLobby', data);
        const trElem = this.getId(peer_id);
        trElem.parentNode.removeChild(trElem);
        lobbyParticipantsCount--;
        lobbyHeaderTitle.innerText = 'Lobby users (' + lobbyParticipantsCount + ')';
        if (lobbyParticipantsCount == 0) this.lobbyToggle();
    }

    lobbyAcceptAll() {
        if (lobbyParticipantsCount > 0) {
            const data = this.lobbyGetData('accept', this.lobbyGetPeerIds());
            this.socket.emit('roomLobby', data);
            this.lobbyRemoveAll();
        } else {
            this.userLog('info', 'No participants in lobby detected', 'top-end');
        }
    }

    lobbyRejectAll() {
        if (lobbyParticipantsCount > 0) {
            const data = this.lobbyGetData('reject', this.lobbyGetPeerIds());
            this.socket.emit('roomLobby', data);
            this.lobbyRemoveAll();
        } else {
            this.userLog('info', 'No participants in lobby detected', 'top-end');
        }
    }

    lobbyRemoveAll() {
        let tr = lobbyTb.getElementsByTagName('tr');
        for (let i = tr.length - 1; i >= 0; i--) {
            if (tr[i].id && tr[i].id != 'lobbyAll') {
                console.log('REMOVE LOBBY PEER ID ' + tr[i].id);
                if (tr[i] && tr[i].parentElement) {
                    tr[i].parentElement.removeChild(tr[i]);
                }
                lobbyParticipantsCount--;
            }
        }
        lobbyHeaderTitle.innerText = 'Lobby users (' + lobbyParticipantsCount + ')';
        if (lobbyParticipantsCount == 0) this.lobbyToggle();
    }

    lobbyRemoveMe(peer_id) {
        let tr = lobbyTb.getElementsByTagName('tr');
        for (let i = tr.length - 1; i >= 0; i--) {
            if (tr[i].id && tr[i].id == peer_id) {
                console.log('REMOVE LOBBY PEER ID ' + tr[i].id);
                if (tr[i] && tr[i].parentElement) {
                    tr[i].parentElement.removeChild(tr[i]);
                }
                lobbyParticipantsCount--;
            }
        }
        lobbyHeaderTitle.innerText = 'Lobby users (' + lobbyParticipantsCount + ')';
        if (lobbyParticipantsCount == 0) this.lobbyToggle();
    }

    lobbyGetPeerIds() {
        let peers_id = [];
        let tr = lobbyTb.getElementsByTagName('tr');
        for (let i = tr.length - 1; i >= 0; i--) {
            if (tr[i].id && tr[i].id != 'lobbyAll') {
                peers_id.push(tr[i].id);
            }
        }
        return peers_id;
    }

    lobbyGetData(status, peers_id = []) {
        return {
            room_id: this.room_id,
            peer_id: this.peer_id,
            peer_name: this.peer_name,
            peers_id: peers_id,
            lobby_status: status,
            broadcast: true,
        };
    }

    lobbyToggle() {
        if (lobbyParticipantsCount > 0 && !isLobbyOpen) {
            lobby.style.display = 'block';
            lobby.style.top = '50%';
            lobby.style.left = '50%';
            if (this.isMobileDevice) {
                lobby.style.width = '100%';
                lobby.style.height = '100%';
            }
            isLobbyOpen = true;
            this.sound('lobby');
        } else {
            lobby.style.display = 'none';
            isLobbyOpen = false;
        }
    }

    // ####################################################
    // HANDLE ROOM ACTION
    // ####################################################

    userRoomNotAllowed() {
        this.sound('alert');
        Swal.fire({
            allowOutsideClick: false,
            allowEscapeKey: false,
            background: swalBackground,
            imageUrl: image.forbidden,
            title: 'Oops, Room not allowed',
            text: 'This room is not allowed for this user',
            confirmButtonText: `OK`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then(() => {
            openURL(`/`); // Select the new allowed room name for this user and login to join
        });
    }

    userUnauthorized() {
        this.sound('alert');
        Swal.fire({
            allowOutsideClick: false,
            allowEscapeKey: false,
            background: swalBackground,
            imageUrl: image.forbidden,
            title: 'Oops, Unauthorized',
            text: 'The host has user authentication enabled',
            confirmButtonText: `Login`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then(() => {
            // Login required to join room
            openURL(`/login/?room=${this.room_id}`);
        });
    }

    unlockTheRoom() {
        if (room_password) {
            this.RoomPassword = room_password;
            let data = {
                action: 'checkPassword',
                password: this.RoomPassword,
            };
            this.socket.emit('roomAction', data);
        } else {
            Swal.fire({
                allowOutsideClick: false,
                allowEscapeKey: false,
                background: swalBackground,
                imageUrl: image.locked,
                title: 'Oops, Room is Locked',
                input: 'text',
                inputPlaceholder: 'Enter the Room password',
                confirmButtonText: `OK`,
                showClass: { popup: 'animate__animated animate__fadeInDown' },
                hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                inputValidator: (pwd) => {
                    if (!pwd) return 'Please enter the Room password';
                    this.RoomPassword = pwd;
                },
            }).then(() => {
                let data = {
                    action: 'checkPassword',
                    password: this.RoomPassword,
                };
                this.socket.emit('roomAction', data);
            });
        }
    }

    roomIsLocked() {
        this.sound('eject');
        this.event(_EVENTS.roomLock);
        console.log('Room is Locked, try with another one');
        Swal.fire({
            allowOutsideClick: false,
            background: swalBackground,
            position: 'center',
            imageUrl: image.locked,
            title: 'Oops, Wrong Room Password',
            text: 'The room is locked, try with another one.',
            showDenyButton: false,
            confirmButtonText: `Ok`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) this.exit();
        });
    }

    waitJoinConfirm() {
        this.sound('lobby');
        Swal.fire({
            allowOutsideClick: false,
            allowEscapeKey: false,
            showDenyButton: true,
            showConfirmButton: false,
            background: swalBackground,
            imageUrl: image.poster,
            title: 'Room has lobby enabled',
            text: 'Asking to join meeting...',
            confirmButtonText: `Ok`,
            denyButtonText: `Leave room`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                control.style.display = 'none';
            } else {
                this.exit();
            }
        });
    }

    isBanned() {
        this.sound('alert');
        Swal.fire({
            allowOutsideClick: false,
            allowEscapeKey: false,
            showDenyButton: false,
            showConfirmButton: true,
            background: swalBackground,
            imageUrl: image.forbidden,
            title: 'Banned',
            text: 'You are banned from this room!',
            confirmButtonText: `Ok`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then(() => {
            this.exit();
        });
    }

    // ####################################################
    // HANDLE AUDIO VOLUME
    // ####################################################

    handleAudioVolume(data) {
        if (!isPitchBarEnabled) return;
        let peerId = data.peer_id;
        let peerName = data.peer_name;
        let producerAudioBtn = this.getId(peerId + '_audio');
        let consumerAudioBtn = this.getId(peerId + '__audio');
        let pbProducer = this.getId(peerId + '_pitchBar');
        let pbConsumer = this.getId(peerId + '__pitchBar');
        let audioVolume = data.audioVolume * 10; //10-100
        let audioColor = 'lime';
        //console.log('Active speaker', { peer_name: peerName, peer_id: peerId, audioVolume: audioVolume });
        if ([50, 60, 70].includes(audioVolume)) audioColor = 'orange';
        if ([80, 90, 100].includes(audioVolume)) audioColor = 'red';
        if (producerAudioBtn) producerAudioBtn.style.color = audioColor;
        if (consumerAudioBtn) consumerAudioBtn.style.color = audioColor;
        if (pbProducer) pbProducer.style.backgroundColor = audioColor;
        if (pbConsumer) pbConsumer.style.backgroundColor = audioColor;
        if (pbProducer) pbProducer.style.height = audioVolume + '%';
        if (pbConsumer) pbConsumer.style.height = audioVolume + '%';
        setTimeout(function () {
            audioColor = 'white';
            if (producerAudioBtn) producerAudioBtn.style.color = audioColor;
            if (consumerAudioBtn) consumerAudioBtn.style.color = audioColor;
            if (pbProducer) pbProducer.style.height = '0%';
            if (pbConsumer) pbConsumer.style.height = '0%';
        }, 200);
    }

    // ####################################################
    // HANDLE PEER VOLUME
    // ###################################################

    handlePV(uid) {
        const words = uid.split('___');
        let peer_id = words[1] + '___pVolume';
        let audioConsumerId = this.audioConsumers.get(peer_id);
        let audioConsumerPlayer = this.getId(audioConsumerId);
        let inputPv = this.getId(peer_id);
        if (inputPv && audioConsumerPlayer) {
            inputPv.style.display = 'inline';
            inputPv.value = 100;
            // Not work on Mobile?
            inputPv.addEventListener('input', () => {
                audioConsumerPlayer.volume = inputPv.value / 100;
            });
        }
    }

    // ####################################################
    // HANDLE DOMINANT SPEAKER
    // ###################################################

    handleDominantSpeaker(data) {
        console.log('Dominant Speaker', data);
        const { peer_id } = data;
        const peerNameElement = this.getId(peer_id + '__name');
        if (peerNameElement) {
            peerNameElement.style.color = 'lime';
            setTimeout(function () {
                peerNameElement.style.color = '#FFFFFF';
            }, 5000);
        }
        //...
    }

    // ####################################################
    // HANDLE BAN
    // ###################################################

    handleGL(uid) {
        const words = uid.split('___');
        let peer_id = words[1] + '___pGeoLocation';
        let btnGl = this.getId(uid);
        if (btnGl) {
            btnGl.addEventListener('click', () => {
                isPresenter
                    ? this.askPeerGeoLocation(peer_id)
                    : this.userLog('warning', 'Only the presenter can ask geolocation to the participants', 'top-end');
            });
        }
    }

    // ####################################################
    // HANDLE BAN
    // ###################################################

    handleBAN(uid) {
        const words = uid.split('___');
        let peer_id = words[1] + '___pBan';
        let btnBan = this.getId(uid);
        if (btnBan) {
            btnBan.addEventListener('click', () => {
                isPresenter
                    ? this.peerAction('me', peer_id, 'ban')
                    : this.userLog('warning', 'Only the presenter can ban the participants', 'top-end');
            });
        }
    }

    // ####################################################
    // HANDLE KICK-OUT
    // ###################################################

    handleKO(uid) {
        const words = uid.split('___');
        let peer_id = words[1] + '___pEject';
        let btnKo = this.getId(uid);
        if (btnKo) {
            btnKo.addEventListener('click', () => {
                isPresenter
                    ? this.peerAction('me', peer_id, 'eject')
                    : this.userLog('warning', 'Only the presenter can eject the participants', 'top-end');
            });
        }
    }

    // ####################################################
    // HANDLE VIDEO
    // ###################################################

    handleCM(uid) {
        const words = uid.split('___');
        let peer_id = words[1] + '___pVideo';
        let btnCm = this.getId(uid);
        if (btnCm) {
            btnCm.addEventListener('click', (e) => {
                if (e.target.className === html.videoOn) {
                    isPresenter
                        ? this.peerAction('me', peer_id, 'hide')
                        : this.userLog('warning', 'Only the presenter can hide the participants', 'top-end');
                } else {
                    isPresenter
                        ? this.peerAction('me', peer_id, 'unhide')
                        : this.userLog('warning', 'Only the presenter can unhide the participants', 'top-end');
                }
            });
        }
    }

    // ####################################################
    // HANDLE AUDIO
    // ###################################################

    handleAU(uid) {
        const words = uid.split('__');
        let peer_id = words[0] + '___pAudio';
        let btnAU = this.getId(uid);
        if (btnAU) {
            btnAU.addEventListener('click', (e) => {
                if (e.target.className === html.audioOn) {
                    isPresenter
                        ? this.peerAction('me', peer_id, 'mute')
                        : this.userLog('warning', 'Only the presenter can mute the participants', 'top-end');
                } else {
                    isPresenter
                        ? this.peerAction('me', peer_id, 'unmute')
                        : this.userLog('warning', 'Only the presenter can unmute the participants', 'top-end');
                }
            });
        }
    }

    // ####################################################
    // HANDLE COMMANDS
    // ####################################################

    emitCmd(cmd) {
        this.socket.emit('cmd', cmd);
    }

    handleCmd(cmd) {
        switch (cmd.type) {
            case 'privacy':
                this.setVideoPrivacyStatus(cmd.peer_id, cmd.active);
                break;
            case 'roomEmoji':
                this.handleRoomEmoji(cmd);
                break;
            case 'transcript':
                this.transcription.handleTranscript(cmd);
                break;
            case 'geoLocation':
                this.confirmPeerGeoLocation(cmd);
                break;
            case 'geoLocationOK':
                this.handleGeoPeerLocation(cmd);
                break;
            case 'geoLocationKO':
                this.sound('alert');
                this.userLog('warning', cmd.data, 'top-end', 5000);
                break;
            case 'ejectAll':
                this.exit();
                break;
            default:
                break;
            //...
        }
    }

    handleRoomEmoji(cmd, duration = 5000) {
        const userEmoji = document.getElementById(`userEmoji`);
        if (userEmoji) {
            const emojiDisplay = document.createElement('div');
            emojiDisplay.className = 'animate__animated animate__backInUp';
            emojiDisplay.style.padding = '10px';
            emojiDisplay.style.fontSize = '3vh';
            emojiDisplay.style.color = '#FFF';
            emojiDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
            emojiDisplay.style.borderRadius = '10px';
            emojiDisplay.innerText = `${cmd.emoji} ${cmd.peer_name}`;
            userEmoji.appendChild(emojiDisplay);
            setTimeout(() => {
                emojiDisplay.remove();
            }, duration);
        }
    }

    // ####################################################
    // PEER ACTION
    // ####################################################

    async peerAction(from_peer_name, id, action, emit = true, broadcast = false, info = true, msg = '') {
        const words = id.split('___');
        const peer_id = words[0];

        if (emit) {
            // send...
            const data = {
                from_peer_name: this.peer_name,
                from_peer_id: this.peer_id,
                from_peer_uuid: this.peer_uuid,
                to_peer_uuid: '',
                peer_id: peer_id,
                action: action,
                message: '',
                broadcast: broadcast,
            };
            console.log('peerAction', data);

            if (!this.thereAreParticipants()) {
                if (info) return this.userLog('info', 'No participants detected', 'top-end');
            }
            if (!broadcast) {
                switch (action) {
                    case 'mute':
                        const audioMessage =
                            'The participant has been muted, and only they have the ability to unmute themselves';
                        if (isBroadcastingEnabled) {
                            const peerAudioButton = this.getId(data.peer_id + '___pAudio');
                            if (peerAudioButton) {
                                const peerAudioIcon = peerAudioButton.querySelector('i');
                                if (peerAudioIcon && peerAudioIcon.style.color == 'red') {
                                    if (isRulesActive && isPresenter) {
                                        data.action = 'unmute';
                                        return this.confirmPeerAction(data.action, data);
                                    }
                                    return this.userLog('info', audioMessage, 'top-end');
                                }
                            }
                        } else {
                            const peerAudioStatus = this.getId(data.peer_id + '__audio');
                            if (!peerAudioStatus || peerAudioStatus.className == html.audioOff) {
                                if (isRulesActive && isPresenter) {
                                    data.action = 'unmute';
                                    return this.confirmPeerAction(data.action, data);
                                }
                                return this.userLog('info', audioMessage, 'top-end');
                            }
                        }
                        break;
                    case 'hide':
                        const videoMessage =
                            'The participant is currently hidden, and only they have the option to unhide themselves';
                        if (isBroadcastingEnabled) {
                            const peerVideoButton = this.getId(data.peer_id + '___pVideo');
                            if (peerVideoButton) {
                                const peerVideoIcon = peerVideoButton.querySelector('i');
                                if (peerVideoIcon && peerVideoIcon.style.color == 'red') {
                                    if (isRulesActive && isPresenter) {
                                        data.action = 'unhide';
                                        return this.confirmPeerAction(data.action, data);
                                    }
                                    return this.userLog('info', videoMessage, 'top-end');
                                }
                            }
                        } else {
                            const peerVideoOff = this.getId(data.peer_id + '__videoOff');
                            if (peerVideoOff) {
                                if (isRulesActive && isPresenter) {
                                    data.action = 'unhide';
                                    return this.confirmPeerAction(data.action, data);
                                }
                                return this.userLog('info', videoMessage, 'top-end');
                            }
                        }
                    case 'stop':
                        const screenMessage =
                            'The participant screen is not shared, only the participant can initiate sharing';
                        const peerScreenButton = this.getId(id);
                        if (peerScreenButton) {
                            const peerScreenStatus = peerScreenButton.querySelector('i');
                            if (peerScreenStatus && peerScreenStatus.style.color == 'red') {
                                if (isRulesActive && isPresenter) {
                                    data.action = 'start';
                                    return this.confirmPeerAction(data.action, data);
                                }
                                return this.userLog('info', screenMessage, 'top-end');
                            }
                        }
                        break;
                    case 'ban':
                        if (!isRulesActive || isPresenter) {
                            const peer_info = await getRemotePeerInfo(peer_id);
                            console.log('BAN PEER', peer_info);
                            if (peer_info) {
                                data.to_peer_uuid = peer_info.peer_uuid;
                                return this.confirmPeerAction(data.action, data);
                            }
                        }
                        break;
                    default:
                        break;
                }
            }
            this.confirmPeerAction(data.action, data);
        } else {
            // receive...
            const peerActionAllowed = peer_id === this.peer_id || broadcast;
            switch (action) {
                case 'ban':
                    if (peerActionAllowed) {
                        const message = `Will ban you from the room${
                            msg ? `<br><br><span class="red">Reason: ${msg}</span>` : ''
                        }`;
                        this.exit(true);
                        this.sound(action);
                        this.peerActionProgress(from_peer_name, message, 5000, action);
                    }
                    break;
                case 'eject':
                    if (peerActionAllowed) {
                        const message = `Will eject you from the room${
                            msg ? `<br><br><span class="red">Reason: ${msg}</span>` : ''
                        }`;
                        this.exit(true);
                        this.sound(action);
                        this.peerActionProgress(from_peer_name, message, 5000, action);
                    }
                    break;
                case 'mute':
                    if (peerActionAllowed) {
                        if (this.producerExist(mediaType.audio)) {
                            await this.pauseProducer(mediaType.audio);
                            this.updatePeerInfo(this.peer_name, this.peer_id, 'audio', false);
                            this.userLog(
                                'warning',
                                from_peer_name + '  ' + _PEER.audioOff + ' has closed yours audio',
                                'top-end',
                                10000,
                            );
                        }
                    }
                    break;
                case 'unmute':
                    if (peerActionAllowed) {
                        this.peerMediaStartConfirm(
                            mediaType.audio,
                            image.unmute,
                            'Enable Microphone',
                            'Allow the presenter to enable your microphone?',
                        );
                    }
                    break;
                case 'hide':
                    if (peerActionAllowed) {
                        this.closeProducer(mediaType.video);
                        this.userLog(
                            'warning',
                            from_peer_name + '  ' + _PEER.videoOff + ' has closed yours video',
                            'top-end',
                            10000,
                        );
                    }
                    break;
                case 'unhide':
                    if (peerActionAllowed) {
                        this.peerMediaStartConfirm(
                            mediaType.video,
                            image.unhide,
                            'Enable Camera',
                            'Allow the presenter to enable your camera?',
                        );
                    }
                    break;
                case 'stop':
                    if (this.isScreenShareSupported) {
                        if (peerActionAllowed) {
                            this.closeProducer(mediaType.screen);
                            this.userLog(
                                'warning',
                                from_peer_name + '  ' + _PEER.screenOff + ' has closed yours screen share',
                                'top-end',
                                10000,
                            );
                        }
                    }
                    break;
                case 'start':
                    if (peerActionAllowed) {
                        this.peerMediaStartConfirm(
                            mediaType.screen,
                            image.start,
                            'Start Screen share',
                            'Allow the presenter to start your screen share?',
                        );
                    }
                    break;
                default:
                    break;
                //...
            }
        }
    }

    peerMediaStartConfirm(type, imageUrl, title, text) {
        sound('notify');
        Swal.fire({
            background: swalBackground,
            position: 'center',
            imageUrl: imageUrl,
            title: title,
            text: text,
            showDenyButton: true,
            confirmButtonText: `Yes`,
            denyButtonText: `No`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then(async (result) => {
            if (result.isConfirmed) {
                switch (type) {
                    case mediaType.audio:
                        this.producerExist(mediaType.audio)
                            ? await this.resumeProducer(mediaType.audio)
                            : await this.produce(mediaType.audio, microphoneSelect.value);
                        this.updatePeerInfo(this.peer_name, this.peer_id, 'audio', true);
                        break;
                    case mediaType.video:
                        await this.produce(mediaType.video, videoSelect.value);
                        break;
                    case mediaType.screen:
                        await this.produce(mediaType.screen);
                        break;
                    default:
                        break;
                }
            }
        });
    }

    peerActionProgress(tt, msg, time, action = 'na') {
        Swal.fire({
            allowOutsideClick: false,
            background: swalBackground,
            icon: action == 'eject' ? 'warning' : 'success',
            title: tt,
            html: msg,
            timer: time,
            timerProgressBar: true,
            didOpen: () => {
                Swal.showLoading();
            },
        }).then(() => {
            switch (action) {
                case 'refresh':
                    getRoomParticipants();
                    break;
                case 'ban':
                case 'eject':
                    this.exit();
                    break;
                default:
                    break;
            }
        });
    }

    confirmPeerAction(action, data) {
        console.log('Confirm peer action', action);
        switch (action) {
            case 'ban':
                let banConfirmed = false;
                Swal.fire({
                    background: swalBackground,
                    position: 'center',
                    imageUrl: image.forbidden,
                    title: 'Ban current participant',
                    input: 'text',
                    inputPlaceholder: 'Ban reason',
                    showDenyButton: true,
                    confirmButtonText: `Yes`,
                    denyButtonText: `No`,
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                })
                    .then((result) => {
                        if (result.isConfirmed) {
                            banConfirmed = true;
                            const message = result.value;
                            if (message) data.message = message;
                            this.socket.emit('peerAction', data);
                            let peer = this.getId(data.peer_id);
                            if (peer) {
                                peer.parentNode.removeChild(peer);
                                participantsCount--;
                                refreshParticipantsCount(participantsCount);
                            }
                        }
                    })
                    .then(() => {
                        if (banConfirmed) this.peerActionProgress(action, 'In progress, wait...', 6000, 'refresh');
                    });
                break;
            case 'eject':
                let ejectConfirmed = false;
                let whoEject = data.broadcast ? 'All participants except yourself?' : 'current participant?';
                Swal.fire({
                    background: swalBackground,
                    position: 'center',
                    imageUrl: data.broadcast ? image.users : image.user,
                    title: 'Eject ' + whoEject,
                    input: 'text',
                    inputPlaceholder: 'Eject reason',
                    showDenyButton: true,
                    confirmButtonText: `Yes`,
                    denyButtonText: `No`,
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                })
                    .then((result) => {
                        if (result.isConfirmed) {
                            ejectConfirmed = true;
                            const message = result.value;
                            if (message) data.message = message;
                            if (!data.broadcast) {
                                this.socket.emit('peerAction', data);
                                let peer = this.getId(data.peer_id);
                                if (peer) {
                                    peer.parentNode.removeChild(peer);
                                    participantsCount--;
                                    refreshParticipantsCount(participantsCount);
                                }
                            } else {
                                this.socket.emit('peerAction', data);
                                let actionButton = this.getId(action + 'AllButton');
                                if (actionButton) actionButton.style.display = 'none';
                                participantsCount = 1;
                                refreshParticipantsCount(participantsCount);
                            }
                        }
                    })
                    .then(() => {
                        if (ejectConfirmed) this.peerActionProgress(action, 'In progress, wait...', 6000, 'refresh');
                    });
                break;
            case 'mute':
            case 'unmute':
            case 'hide':
            case 'unhide':
            case 'stop':
            case 'start':
                let muteHideStopConfirmed = false;
                let who = data.broadcast ? 'everyone except yourself?' : 'current participant?';
                let imageUrl, title, text;
                switch (action) {
                    case 'mute':
                        imageUrl = image.mute;
                        title = 'Mute ' + who;
                        text =
                            'Once muted, only the presenter will be able to unmute participants, but participants can unmute themselves at any time';
                        break;
                    case 'unmute':
                        imageUrl = image.unmute;
                        title = 'Unmute ' + who;
                        text = 'A pop-up message will appear to prompt and allow this action.';
                        break;
                    case 'hide':
                        title = 'Hide ' + who;
                        imageUrl = image.hide;
                        text =
                            'Once hidden, only the presenter will be able to unhide participants, but participants can unhide themselves at any time';
                        break;
                    case 'unhide':
                        title = 'Unhide ' + who;
                        imageUrl = image.unhide;
                        text = 'A pop-up message will appear to prompt and allow this action.';
                        break;
                    case 'stop':
                        imageUrl = image.stop;
                        title = 'Stop screen share to the ' + who;
                        text =
                            "Once stopped, only the presenter will be able to start the participants' screens, but participants can start their screens themselves at any time";
                        break;
                    case 'start':
                        imageUrl = image.start;
                        title = 'Start screen share to the ' + who;
                        text = 'A pop-up message will appear to prompt and allow this action.';
                        break;
                    default:
                        break;
                }
                Swal.fire({
                    background: swalBackground,
                    position: 'center',
                    imageUrl: imageUrl,
                    title: title,
                    text: text,
                    showDenyButton: true,
                    confirmButtonText: `Yes`,
                    denyButtonText: `No`,
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                })
                    .then((result) => {
                        if (result.isConfirmed) {
                            muteHideStopConfirmed = true;
                            if (!data.broadcast) {
                                switch (action) {
                                    case 'mute':
                                        let peerAudioButton = this.getId(data.peer_id + '___pAudio');
                                        if (peerAudioButton) peerAudioButton.innerHTML = _PEER.audioOff;
                                        break;
                                    case 'hide':
                                        let peerVideoButton = this.getId(data.peer_id + '___pVideo');
                                        if (peerVideoButton) peerVideoButton.innerHTML = _PEER.videoOff;
                                        break;
                                    case 'stop':
                                        let peerScreenButton = this.getId(data.peer_id + '___pScreen');
                                        if (peerScreenButton) peerScreenButton.innerHTML = _PEER.screenOff;
                                        break;
                                    default:
                                        break;
                                }
                                this.socket.emit('peerAction', data);
                            } else {
                                this.socket.emit('peerAction', data);
                                let actionButton = this.getId(action + 'AllButton');
                                if (actionButton) actionButton.style.display = 'none';
                            }
                        }
                    })
                    .then(() => {
                        if (muteHideStopConfirmed)
                            this.peerActionProgress(action, 'In progress, wait...', 2000, 'refresh');
                    });
                break;
            default:
                break;
            //...
        }
    }

    peerGuestNotAllowed(action) {
        console.log('peerGuestNotAllowed', action);
        switch (action) {
            case 'audio':
                this.userLog('warning', 'Only the presenter can mute/unmute participants', 'top-end');
                break;
            case 'video':
                this.userLog('warning', 'Only the presenter can hide/show participants', 'top-end');
                break;
            case 'screen':
                this.userLog('warning', 'Only the presenter can start/stop the screen of participants', 'top-end');
                break;
            default:
                break;
        }
    }

    // ####################################################
    // SEARCH PEER FILTER
    // ####################################################

    searchPeer() {
        const searchParticipantsFromList = this.getId('searchParticipantsFromList');
        const searchFilter = searchParticipantsFromList.value.toUpperCase();
        const participantsList = this.getId('participantsList');
        const participantsListItems = participantsList.getElementsByTagName('li');

        for (let i = 0; i < participantsListItems.length; i++) {
            const li = participantsListItems[i];
            const participantName = li.getAttribute('data-to-name').toUpperCase();
            const shouldDisplay = participantName.includes(searchFilter);
            li.style.display = shouldDisplay ? '' : 'none';
        }
    }

    // ####################################################
    // FILTER PEER WITH RAISE HAND
    // ####################################################

    toggleRaiseHands() {
        const participantsList = this.getId('participantsList');
        const participantsListItems = participantsList.getElementsByTagName('li');

        for (let i = 0; i < participantsListItems.length; i++) {
            const li = participantsListItems[i];
            const hasPulsateClass = li.querySelector('i.pulsate') !== null;
            const shouldDisplay = (hasPulsateClass && !this.isToggleRaiseHand) || this.isToggleRaiseHand;
            li.style.display = shouldDisplay ? '' : 'none';
        }
        this.isToggleRaiseHand = !this.isToggleRaiseHand;
        setColor(participantsRaiseHandBtn, this.isToggleRaiseHand ? 'lime' : 'white');
    }

    // ####################################################
    // FILTER PEER WITH UNREAD MESSAGES
    // ####################################################

    toggleUnreadMsg() {
        const participantsList = this.getId('participantsList');
        const participantsListItems = participantsList.getElementsByTagName('li');

        for (let i = 0; i < participantsListItems.length; i++) {
            const li = participantsListItems[i];
            const shouldDisplay =
                (li.classList.contains('pulsate') && !this.isToggleUnreadMsg) || this.isToggleUnreadMsg;
            li.style.display = shouldDisplay ? '' : 'none';
        }
        this.isToggleUnreadMsg = !this.isToggleUnreadMsg;
        setColor(participantsUnreadMessagesBtn, this.isToggleUnreadMsg ? 'lime' : 'white');
    }

    // ####################################################
    // SHOW PEER ABOUT AND MESSAGES
    // ####################################################

    showPeerAboutAndMessages(peer_id, peer_name, event = null) {
        this.hidePeerMessages();

        const chatAbout = this.getId('chatAbout');
        const participant = this.getId(peer_id);
        const participantsList = this.getId('participantsList');
        const chatPrivateMessages = this.getId('chatPrivateMessages');
        const messagePrivateListItems = chatPrivateMessages.getElementsByTagName('li');
        const participantsListItems = participantsList.getElementsByTagName('li');
        const avatarImg = getParticipantAvatar(peer_name);

        const generateChatAboutHTML = (imgSrc, title, status = 'online', participants = '') => {
            const isSensitiveChat = !['all', 'ChatGPT'].includes(peer_id) && title.length > 15;
            const truncatedTitle = isSensitiveChat ? `${title.substring(0, 10)}*****` : title;
            return `
                <img class="all-participants-img" 
                    style="border: var(--border); width: 43px; margin-right: 5px; cursor: pointer;"
                    id="chatShowParticipantsList" 
                    src="${image.users}"
                    alt="participants"
                    onclick="rc.toggleShowParticipants()" 
                />
                <a data-toggle="modal" data-target="#view_info">
                    <img src="${imgSrc}" alt="avatar" />
                </a>
                <div class="chat-about">
                    <h6 class="mb-0">${truncatedTitle}</h6>
                    <span class="status">
                        <i class="fa fa-circle ${status}"></i> ${status} ${participants}
                    </span>
                </div>
            `;
        };

        // CURRENT SELECTED PEER
        for (let i = 0; i < participantsListItems.length; i++) {
            participantsListItems[i].classList.remove('active');
            participantsListItems[i].classList.remove('pulsate'); // private new message to read
            if (!['all', 'ChatGPT'].includes(peer_id)) {
                // icon private new message to read
                this.getId(`${peer_id}-unread-msg`).classList.add('hidden');
            }
        }
        participant.classList.add('active');

        isChatGPTOn = false;
        console.log('Display messages', peer_id);

        switch (peer_id) {
            case 'ChatGPT':
                if (this._moderator.chat_cant_chatgpt) {
                    return userLog('warning', 'The moderator does not allow you to chat with ChatGPT', 'top-end', 6000);
                }
                isChatGPTOn = true;
                chatAbout.innerHTML = generateChatAboutHTML(image.chatgpt, 'ChatGPT');
                this.getId('chatGPTMessages').style.display = 'block';
                break;
            case 'all':
                chatAbout.innerHTML = generateChatAboutHTML(image.all, 'Public chat', 'online', participantsCount);
                this.getId('chatPublicMessages').style.display = 'block';
                break;
            default:
                if (this._moderator.chat_cant_privately) {
                    return userLog('warning', 'The moderator does not allow you to chat privately', 'top-end', 6000);
                }
                chatAbout.innerHTML = generateChatAboutHTML(avatarImg, peer_name);
                chatPrivateMessages.style.display = 'block';
                for (let i = 0; i < messagePrivateListItems.length; i++) {
                    const li = messagePrivateListItems[i];
                    const itemFromId = li.getAttribute('data-from-id');
                    const itemToId = li.getAttribute('data-to-id');
                    const shouldDisplay = itemFromId.includes(peer_id) || itemToId.includes(peer_id);
                    li.style.display = shouldDisplay ? '' : 'none';
                }
                break;
        }

        if (!this.isMobileDevice) setTippy('chatShowParticipantsList', 'Toggle participants list', 'bottom');

        const clickedElement = event ? event.target : null;
        if (!event || (clickedElement.tagName != 'BUTTON' && clickedElement.tagName != 'I')) {
            if ((this.isMobileDevice || this.isChatPinned) && (!plist || !plist.classList.contains('hidden'))) {
                this.toggleShowParticipants();
            }
        }
    }

    hidePeerMessages() {
        elemDisplay('chatGPTMessages', false);
        elemDisplay('chatPublicMessages', false);
        elemDisplay('chatPrivateMessages', false);
    }

    // ####################################################
    // UPDATE ROOM MODERATOR
    // ####################################################

    updateRoomModerator(data) {
        if (!isRulesActive || isPresenter) {
            const moderator = this.getModeratorData(data);
            this.socket.emit('updateRoomModerator', moderator);
        }
    }

    updateRoomModeratorALL(data) {
        if (!isRulesActive || isPresenter) {
            const moderator = this.getModeratorData(data);
            this.socket.emit('updateRoomModeratorALL', moderator);
        }
    }

    getModeratorData(data) {
        return {
            peer_name: this.peer_name,
            peer_uuid: this.peer_uuid,
            moderator: data,
        };
    }

    handleUpdateRoomModerator(data) {
        switch (data.type) {
            case 'audio_cant_unmute':
                this._moderator.audio_cant_unmute = data.status;
                this._moderator.audio_cant_unmute ? hide(tabAudioDevicesBtn) : show(tabAudioDevicesBtn);
                rc.roomMessage('audio_cant_unmute', data.status);
                break;
            case 'video_cant_unhide':
                this._moderator.video_cant_unhide = data.status;
                this._moderator.video_cant_unhide ? hide(tabVideoDevicesBtn) : show(tabVideoDevicesBtn);
                rc.roomMessage('video_cant_unhide', data.status);
                break;
            case 'screen_cant_share':
                this._moderator.screen_cant_share = data.status;
                rc.roomMessage('screen_cant_share', data.status);
                break;
            case 'chat_cant_privately':
                this._moderator.chat_cant_privately = data.status;
                rc.roomMessage('chat_cant_privately', data.status);
                break;
            case 'chat_cant_chatgpt':
                this._moderator.chat_cant_chatgpt = data.status;
                rc.roomMessage('chat_cant_chatgpt', data.status);
                break;
            default:
                break;
        }
    }

    handleUpdateRoomModeratorALL(data) {
        this._moderator = data;
        console.log('Update Room Moderator data all', this._moderator);
    }

    getModerator() {
        console.log('Get Moderator', this._moderator);
        return this._moderator;
    }

    // ####################################################
    // UPDATE PEER INFO
    // ####################################################

    updatePeerInfo(peer_name, peer_id, type, status, emit = true, presenter = false) {
        if (emit) {
            switch (type) {
                case 'audio':
                    this.setIsAudio(peer_id, status);
                    break;
                case 'video':
                    this.setIsVideo(status);
                    break;
                case 'screen':
                    this.setIsScreen(status);
                    break;
                case 'hand':
                    this.peer_info.peer_hand = status;
                    let peer_hand = this.getPeerHandBtn(peer_id);
                    if (status) {
                        if (peer_hand) peer_hand.style.display = 'flex';
                        this.event(_EVENTS.raiseHand);
                        this.sound('raiseHand');
                    } else {
                        if (peer_hand) peer_hand.style.display = 'none';
                        this.event(_EVENTS.lowerHand);
                    }
                    break;
                default:
                    break;
            }
            const data = {
                room_id: this.room_id,
                peer_name: peer_name,
                peer_id: peer_id,
                type: type,
                status: status,
                broadcast: true,
            };
            this.socket.emit('updatePeerInfo', data);
        } else {
            const canUpdateMediaStatus = !isBroadcastingEnabled || (isBroadcastingEnabled && presenter);
            switch (type) {
                case 'audio':
                    if (canUpdateMediaStatus) this.setPeerAudio(peer_id, status);
                    break;
                case 'video':
                    break;
                case 'screen':
                    break;
                case 'hand':
                    let peer_hand = this.getPeerHandBtn(peer_id);
                    if (status) {
                        if (peer_hand) peer_hand.style.display = 'flex';
                        this.userLog(
                            'warning',
                            peer_name + '  ' + _PEER.raiseHand + ' has raised the hand',
                            'top-end',
                            10000,
                        );
                        this.sound('raiseHand');
                    } else {
                        if (peer_hand) peer_hand.style.display = 'none';
                    }
                    break;
                default:
                    break;
            }
        }
        if (isParticipantsListOpen) getRoomParticipants();
    }

    checkPeerInfoStatus(peer_info) {
        let peer_id = peer_info.peer_id;
        let peer_hand_status = peer_info.peer_hand;
        if (peer_hand_status) {
            let peer_hand = this.getPeerHandBtn(peer_id);
            if (peer_hand) peer_hand.style.display = 'flex';
        }
        //...
    }

    popupPeerInfo(id, peer_info) {
        if (this.showPeerInfo && !this.isMobileDevice) {
            this.setTippy(
                id,
                '<pre>' +
                    JSON.stringify(
                        peer_info,
                        [
                            'join_data_time',
                            'peer_id',
                            'peer_name',
                            'peer_audio',
                            'peer_video',
                            'peer_video_privacy',
                            'peer_screen',
                            'peer_hand',
                            'is_desktop_device',
                            'is_mobile_device',
                            'is_tablet_device',
                            'is_ipad_pro_device',
                            'os_name',
                            'os_version',
                            'browser_name',
                            'browser_version',
                            //'user_agent',
                        ],
                        2,
                    ) +
                    '<pre/>',
                'top-start',
                true,
            );
        }
    }

    // ####################################################
    // HANDLE PEER GEOLOCATION
    // ####################################################

    askPeerGeoLocation(id) {
        const words = id.split('___');
        const peer_id = words[0];
        const cmd = {
            type: 'geoLocation',
            from_peer_name: this.peer_name,
            from_peer_id: this.peer_id,
            peer_id: peer_id,
            broadcast: false,
        };
        this.emitCmd(cmd);
        this.peerActionProgress(
            'Geolocation',
            'Geolocation requested. Please wait for confirmation...',
            6000,
            'geolocation',
        );
    }

    sendPeerGeoLocation(peer_id, type, data) {
        const cmd = {
            type: type,
            from_peer_name: this.peer_name,
            from_peer_id: this.peer_id,
            peer_id: peer_id,
            data: data,
            broadcast: false,
        };
        this.emitCmd(cmd);
    }

    confirmPeerGeoLocation(cmd) {
        this.sound('notify');
        Swal.fire({
            allowOutsideClick: false,
            allowEscapeKey: false,
            background: swalBackground,
            imageUrl: image.geolocation,
            position: 'center',
            title: 'Geo Location',
            html: `Would you like to share your location to ${cmd.from_peer_name}?`,
            showDenyButton: true,
            confirmButtonText: `Yes`,
            denyButtonText: `No`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            result.isConfirmed ? this.getPeerGeoLocation(cmd.from_peer_id) : this.denyPeerGeoLocation(cmd.from_peer_id);
        });
    }

    getPeerGeoLocation(peer_id) {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                function (position) {
                    const geoLocation = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                    };
                    console.log('GeoLocation --->', geoLocation);

                    rc.sendPeerGeoLocation(peer_id, 'geoLocationOK', geoLocation);
                    // openURL(`https://www.openstreetmap.org/?mlat=${geoLocation.latitude}&mlon=${geoLocation.longitude}`, true);
                    // openURL(`http://maps.apple.com/?ll=${geoLocation.latitude},${geoLocation.longitude}`, true);
                    // openURL(`https://www.google.com/maps/search/?api=1&query=${geoLocation.latitude},${geoLocation.longitude}`, true);
                },
                function (error) {
                    let geoError = error;
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            geoError = 'User denied the request for Geolocation';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            geoError = 'Location information is unavailable';
                            break;
                        case error.TIMEOUT:
                            geoError = 'The request to get user location timed out';
                            break;
                        case error.UNKNOWN_ERROR:
                            geoError = 'An unknown error occurred';
                            break;
                        default:
                            break;
                    }
                    rc.sendPeerGeoLocation(peer_id, 'geoLocationKO', `${rc.peer_name}: ${geoError}`);
                    rc.userLog('warning', geoError, 'top-end', 5000);
                },
            );
        } else {
            rc.sendPeerGeoLocation(
                peer_id,
                'geoLocationKO',
                `${rc.peer_name}: Geolocation is not supported by this browser`,
            );
            rc.userLog('warning', 'Geolocation is not supported by this browser', 'top-end', 5000);
        }
    }

    denyPeerGeoLocation(peer_id) {
        rc.sendPeerGeoLocation(peer_id, 'geoLocationKO', `${rc.peer_name}: Has declined permission for geolocation`);
    }

    handleGeoPeerLocation(cmd) {
        const geoLocation = cmd.data;
        this.sound('notify');
        Swal.fire({
            allowOutsideClick: false,
            allowEscapeKey: false,
            background: swalBackground,
            imageUrl: image.geolocation,
            position: 'center',
            title: 'Geo Location',
            html: `Would you like to open ${cmd.from_peer_name} geolocation?`,
            showDenyButton: true,
            confirmButtonText: `Yes`,
            denyButtonText: `No`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                // openURL(`https://www.openstreetmap.org/?mlat=${geoLocation.latitude}&mlon=${geoLocation.longitude}`, true);
                // openURL(`http://maps.apple.com/?ll=${geoLocation.latitude},${geoLocation.longitude}`, true);
                openURL(
                    `https://www.google.com/maps/search/?api=1&query=${geoLocation.latitude},${geoLocation.longitude}`,
                    true,
                );
            }
        });
    }

    // ##############################################
    // HeyGen Video AI
    // ##############################################

    getAvatarList() {
        this.socket
            .request('getAvatarList')
            .then(function (completion) {
                const avatarVideoAIPreview = document.getElementById('avatarVideoAIPreview');
                const avatarVideoAIcontainer = document.getElementById('avatarVideoAIcontainer');
                avatarVideoAIcontainer.innerHTML = ''; // cleanup the avatar container

                const excludedIds = [
                    'josh_lite3_20230714',
                    'josh_lite_20230714',
                    'Lily_public_lite1_20230601',
                    'Brian_public_lite1_20230601',
                    'Brian_public_lite2_20230601',
                    'Eric_public_lite1_20230601',
                    'Mido-lite-20221128',
                ];

                const freeAvatars = [
                    'Kristin in Black Suit',
                    'Angela in Black Dress',
                    'Kayla in Casual Suit',
                    'Anna in Brown T-shirt',
                    'Briana in Brown suit',
                    'Justin in White Shirt',
                    'Leah in Black Suit',
                    'Wade in Black Jacket',
                    'Tyler in Casual Suit',
                    'Tyler in Shirt',
                    'Tyler in Suit',
                    'default',
                ];

                completion.response.avatars.forEach((avatar) => {
                    avatar.avatar_states.forEach((avatarUi) => {
                        if (
                            !excludedIds.includes(avatarUi.id) &&
                            (showFreeAvatars ? freeAvatars.includes(avatarUi.pose_name) : true)
                        ) {
                            const div = document.createElement('div');
                            div.style.float = 'left';
                            div.style.padding = '5px';
                            div.style.width = '100px';
                            div.style.height = '200px';
                            const img = document.createElement('img');
                            const hr = document.createElement('hr');
                            const label = document.createElement('label');
                            const textContent = document.createTextNode(avatarUi.pose_name);
                            label.appendChild(textContent);
                            //label.style.fontSize = '12px';
                            img.setAttribute('id', avatarUi.id);
                            img.setAttribute('class', 'avatarImg');
                            img.setAttribute('src', avatarUi.normal_thumbnail_medium);
                            img.setAttribute('width', '100%');
                            img.setAttribute('height', 'auto');
                            img.setAttribute('alt', avatarUi.pose_name);
                            img.setAttribute('style', 'cursor:pointer; padding: 2px; border-radius: 5px;');
                            img.setAttribute(
                                'avatarData',
                                avatarUi.id +
                                    '|' +
                                    avatar.name +
                                    '|' +
                                    avatarUi.default_voice.free.voice_id +
                                    '|' +
                                    avatarUi.video_url.grey,
                            );
                            img.onclick = () => {
                                const avatarImages = document.querySelectorAll('.avatarImg');
                                avatarImages.forEach((image) => {
                                    image.style.border = 'none';
                                });
                                img.style.border = 'var(--border)';
                                const avatarData = img.getAttribute('avatarData');
                                const avatarDataArr = avatarData.split('|');
                                VideoAI.avatar = avatarDataArr[0];
                                VideoAI.avatarName = avatarDataArr[1];
                                VideoAI.avatarVoice = avatarDataArr[2] ? avatarDataArr[2] : '';

                                avatarVideoAIPreview.setAttribute('src', avatarUi.video_url.grey);
                                avatarVideoAIPreview.play();

                                console.log('Avatar image click event', {
                                    avatar,
                                    avatarUi,
                                    avatarDataArr,
                                });
                            };
                            div.append(img);
                            div.append(hr);
                            div.append(label);
                            avatarVideoAIcontainer.append(div);

                            // Show the first available free avatar
                            if (showFreeAvatars && avatarUi.pose_name === 'Kristin in Black Suit') {
                                avatarVideoAIPreview.setAttribute('src', avatarUi.video_url.grey);
                                avatarVideoAIPreview.playsInline = true;
                                avatarVideoAIPreview.autoplay = true;
                                avatarVideoAIPreview.controls = true;
                                avatarVideoAIPreview.volume = 0.5;
                            }
                        }
                    });
                });
            })
            .catch((err) => {
                console.error('Video AI getAvatarList error:', err);
            });
    }

    getVoiceList() {
        this.socket
            .request('getVoiceList')
            .then(function (completion) {
                const selectElement = document.getElementById('avatarVoiceIDs');
                selectElement.innerHTML = '<option value="">Select Avatar Voice</option>'; // Reset options with default

                // Sort the list alphabetically by language
                const sortedList = completion.response.list.sort((a, b) => a.language.localeCompare(b.language));

                sortedList.forEach((flag) => {
                    // console.log('flag', flag);
                    const { is_paid, voice_id, language, display_name, gender } = flag;
                    if (showFreeAvatars ? is_paid == false : true) {
                        const option = document.createElement('option');
                        option.value = voice_id;
                        option.text = `${language}, ${display_name} (${gender})`; // You can customize the display text
                        selectElement.appendChild(option);
                    }
                });

                // Event listener for changes on select element
                selectElement.addEventListener('change', (event) => {
                    const selectedVoiceID = event.target.value;
                    const selectedPreviewURL = completion.response.list.find(
                        (flag) => flag.voice_id === selectedVoiceID,
                    )?.preview?.movio;
                    VideoAI.avatarVoice = selectedVoiceID;
                    if (selectedPreviewURL) {
                        const avatarPreviewAudio = document.getElementById('avatarPreviewAudio');
                        avatarPreviewAudio.src = selectedPreviewURL;
                        avatarPreviewAudio.play();
                    }
                });
            })
            .catch((err) => {
                console.error('Video AI getVoiceList error:', err);
            });
    }

    async handleVideoAI() {
        const vb = document.createElement('div');
        vb.setAttribute('id', 'avatar__vb');
        vb.className = 'videoMenuBar fadein';

        const fs = document.createElement('button');
        fs.id = 'avatar__fs';
        fs.className = html.fullScreen;

        const pin = document.createElement('button');
        pin.id = 'avatar__pin';
        pin.className = html.pin;

        const ss = document.createElement('button');
        ss.id = 'avatar__stopSession';
        ss.className = html.kickOut;

        const avatarName = document.createElement('div');
        const an = document.createElement('span');
        an.id = 'avatar__name';
        an.className = html.userName;
        an.innerText = VideoAI.avatarName;

        // Create video container element
        this.videoAIContainer = document.createElement('div');
        this.videoAIContainer.className = 'Camera';
        this.videoAIContainer.id = 'videoAIContainer';

        // Create canvas element for video rendering
        this.canvasAIElement = document.createElement('canvas');
        this.canvasAIElement.className = '';
        this.canvasAIElement.id = 'canvasAIElement';
        this.canvasAIElement.style.objectFit = this.isMobileDevice ? 'cover' : 'contain';

        // Create video element for avatar
        this.videoAIElement = document.createElement('video');
        this.videoAIElement.id = 'videoAIElement';
        this.videoAIElement.setAttribute('playsinline', true);
        this.videoAIElement.autoplay = true;
        this.videoAIElement.className = '';
        this.videoAIElement.poster = image.poster;
        this.videoAIElement.style.objectFit = this.isMobileDevice ? 'cover' : 'contain';

        // Append elements to video container
        vb.appendChild(ss);
        this.isVideoFullScreenSupported && vb.appendChild(fs);
        !this.isMobileDevice && vb.appendChild(pin);
        avatarName.appendChild(an);

        this.videoAIContainer.appendChild(this.videoAIElement);
        VideoAI.virtualBackground && this.videoAIContainer.appendChild(this.canvasAIElement);
        this.videoAIContainer.appendChild(vb);
        this.videoAIContainer.appendChild(avatarName);
        this.videoMediaContainer.appendChild(this.videoAIContainer);

        // Hide canvas initially
        this.canvasAIElement.hidden = true;

        // Use video avatar virtual background
        if (VideoAI.virtualBackground) {
            this.isVideoFullScreenSupported && this.handleFS(this.canvasAIElement.id, fs.id);
            this.handlePN(this.canvasAIElement.id, pin.id, this.videoAIContainer.id, true, true);
        } else {
            this.isVideoFullScreenSupported && this.handleFS(this.videoAIElement.id, fs.id);
            this.handlePN(this.videoAIElement.id, pin.id, this.videoAIContainer.id, true, true);
        }

        ss.onclick = () => {
            this.stopSession();
        };

        if (!this.isMobileDevice) {
            this.setTippy(pin.id, 'Toggle Pin', 'bottom');
            this.setTippy(fs.id, 'Toggle full screen', 'bottom');
            this.setTippy(ss.id, 'Stop VideoAI session', 'bottom');
        }

        handleAspectRatio();

        await this.streamingNew();
    }

    async streamingNew() {
        try {
            const { quality, avatar, avatarVoice } = VideoAI;

            const response = await this.socket.request('streamingNew', {
                quality: quality,
                avatar_name: avatar,
                voice_id: avatarVoice,
            });

            if (!response || Object.keys(response).length === 0 || response.error) {
                this.userLog('error', 'Error to creating the avatar', 'top-end');
                this.stopSession();
                return;
            }

            if (response.response.code !== 100) {
                this.userLog('warning', response.response.message, 'top-end');
                this.stopSession();
                return;
            }

            VideoAI.info = response.response.data;

            console.log('Video AI streamingNew', VideoAI);

            const { sdp, ice_servers2 } = VideoAI.info;

            await this.setupPeerConnection(sdp, ice_servers2);

            await this.startSession();
        } catch (error) {
            this.userLog('error', error, 'top-end');
            console.error('Video AI streamingNew error:', error);
            this.stopSession();
        }
    }

    async setupPeerConnection(sdp, iceServers) {
        this.peerConnection = new RTCPeerConnection({ iceServers: iceServers });

        this.peerConnection.ontrack = (event) => {
            if (event.track.kind === 'audio' || event.track.kind === 'video') {
                this.videoAIElement.srcObject = event.streams[0];
            }
        };

        this.peerConnection.ondatachannel = (event) => {
            event.channel.onmessage = this.handleVideoAIMessage;
        };

        const remoteDescription = new RTCSessionDescription(sdp);
        this.peerConnection.setRemoteDescription(remoteDescription);
    }

    handleVideoAIMessage(event) {
        console.log('handleVideoAIMessage', event.data);
    }

    async startSession() {
        if (!VideoAI.info) {
            this.userLog('warning', 'Please create a connection first', 'top-end');
            return;
        }
        this.userLog('info', 'Starting session... please wait', 'top-end');
        try {
            const answer = await this.peerConnection.createAnswer();

            await this.peerConnection.setLocalDescription(answer);

            await this.streamingStart(VideoAI.info.session_id, answer);

            this.peerConnection.onicecandidate = async ({ candidate }) => {
                if (candidate) {
                    await this.streamingICE(candidate);
                }
            };
        } catch (error) {
            this.userLog('error', error, 'top-end');
            console.error('Video AI startSession error:', error);
        }
    }

    async streamingICE(candidate) {
        try {
            const response = await this.socket.request('streamingICE', {
                session_id: VideoAI.info.session_id,
                candidate: candidate.toJSON(),
            });

            if (response && !response.error) {
                return response.response;
            }
        } catch (error) {
            console.error('Video AI streamingICE error:', error);
        }
    }

    async streamingStart(sessionId, sdp) {
        try {
            const response = await this.socket.request('streamingStart', {
                session_id: sessionId,
                sdp: sdp,
            });

            if (!response || response.error) return;

            this.startRendering();

            this.isMobileDevice ? this.handleMobileVideoAiChat() : this.handleDesktopVideoAiChat();

            VideoAI.active = true;

            this.userLog('info', 'Video AI streaming started', 'top-end');
        } catch (error) {
            console.error('Video AI streamingStart error:', error);
        }
    }

    handleDesktopVideoAiChat() {
        if (!this.isChatOpen) {
            this.toggleChat();
        }
        this.sendMessageToVideoAi();
    }

    handleMobileVideoAiChat() {
        if (this.videoMediaContainer.childElementCount <= 2) {
            isHideMeActive = !isHideMeActive;
            this.handleHideMe();
        }
        setTimeout(() => {
            this.streamingTask(
                `Welcome to ${BRAND.app.name}! Please Open the Chat and navigate to the ChatGPT section. Feel free to ask me any questions you have.`,
            );
        }, 2000);
    }

    sendMessageToVideoAi() {
        const tasks = [
            { delay: 1000, action: () => this.chatPin() },
            { delay: 1200, action: () => this.toggleShowParticipants() },
            { delay: 1400, action: () => this.showPeerAboutAndMessages('ChatGPT', 'ChatGPT') },
            { delay: 1600, action: () => this.streamingTask(`Welcome to ${BRAND.app.name}!`) },
            {
                delay: 2000,
                action: () => {
                    chatMessage.value = 'Hello!';
                    this.sendMessage();
                },
            },
        ];
        this.executeTasksSequentially(tasks);
    }

    executeTasksSequentially(tasks) {
        tasks.reduce((promise, task) => {
            return promise.then(
                () =>
                    new Promise((resolve) => {
                        setTimeout(() => {
                            task.action();
                            resolve();
                        }, task.delay);
                    }),
            );
        }, Promise.resolve());
    }

    streamingTask(message) {
        if (VideoAI.enabled && VideoAI.active && message) {
            const response = this.socket.request('streamingTask', {
                session_id: VideoAI.info.session_id,
                text: message,
            });
            console.log('Video AI streamingTask', response);
        }
    }

    startRendering() {
        if (!VideoAI.virtualBackground) return;

        let frameCounter = 0;

        this.renderAIToken = Math.trunc(1e9 * Math.random());
        frameCounter = this.renderAIToken;

        this.videoAIElement.hidden = true;
        this.canvasAIElement.hidden = false;

        const context = this.canvasAIElement.getContext('2d', { willReadFrequently: true });

        const renderFrame = () => {
            if (this.renderAIToken !== frameCounter) return;

            if (this.videoAIElement.videoWidth === 0 || this.videoAIElement.videoHeight === 0) {
                requestAnimationFrame(renderFrame);
                return;
            }

            this.canvasAIElement.width = this.videoAIElement.videoWidth;
            this.canvasAIElement.height = this.videoAIElement.videoHeight;

            context.drawImage(this.videoAIElement, 0, 0, this.canvasAIElement.width, this.canvasAIElement.height);

            const imageData = context.getImageData(0, 0, this.canvasAIElement.width, this.canvasAIElement.height);
            const pixels = imageData.data;

            for (let i = 0; i < pixels.length; i += 4) {
                if (shouldHidePixel([pixels[i], pixels[i + 1], pixels[i + 2]])) {
                    pixels[i + 3] = 0; // Make pixel transparent
                }
            }

            function shouldHidePixel([r, g, b]) {
                const greenThreshold = 90;
                const redThreshold = 90;
                const blueThreshold = 90;
                return g > greenThreshold && r < redThreshold && b < blueThreshold;
            }

            context.putImageData(imageData, 0, 0);
            requestAnimationFrame(renderFrame);
        };

        // Ensure the video element is ready before starting rendering
        const startRenderingWhenReady = () => {
            if (this.videoAIElement.readyState >= 2) {
                // HAVE_CURRENT_DATA
                renderFrame();
            } else {
                this.videoAIElement.addEventListener('loadeddata', renderFrame, { once: true });
            }
        };

        // Set the background of the canvas' parent element to an image or color of your choice
        this.canvasAIElement.parentElement.style.background = `url("${VideoAI.background}") center / cover no-repeat`;

        setTimeout(startRenderingWhenReady, 1000);
    }

    stopRendering() {
        this.renderAIToken = null;
    }

    stopSession() {
        const videoAIElement = this.getId('videoAIElement');
        if (videoAIElement) {
            videoAIElement.parentNode.removeChild(videoAIElement);
        }
        const videoAIContainer = this.getId('videoAIContainer');
        if (videoAIContainer) {
            videoAIContainer.parentNode.removeChild(videoAIContainer);
            const removeVideoAI = ['videoAIElement', 'canvasAIElement'];
            if (this.isVideoPinned && removeVideoAI.includes(this.pinnedVideoPlayerId)) {
                this.removeVideoPinMediaContainer();
            }
        }

        handleAspectRatio();

        this.streamingStop();
    }

    streamingStop() {
        if (this.peerConnection) {
            console.info('Video AI streamingStop peerConnection close done!');
            this.peerConnection.close();
            this.peerConnection = null;
        }
        if (VideoAI.info && VideoAI.info.session_id) {
            const sessionId = VideoAI.info.session_id;
            this.socket
                .request('streamingStop', { session_id: sessionId })
                .then(() => {
                    console.info('Video AI streamingStop done!');
                })
                .catch((error) => {
                    console.error('Video AI streamingStop error:', error);
                });
        }

        this.stopRendering();

        VideoAI.active = false;
    }

    // ##############################################
    // RTMP from FILE
    // ##############################################

    getRTMP() {
        this.socket.request('getRTMP').then(function (filenames) {
            console.log('RTMP files', filenames);
            if (filenames.length === 0) {
                const fileNameDiv = rc.getId('file-name');
                fileNameDiv.textContent = 'No file found to stream';
                //elemDisplay('startRtmpButton', false);
            }

            //const f = Array.from({ length: 20 }, (_, index) => `My-file-video-to-stream-to-rtmp-server ${index + 1}`);

            const fileListTbody = rc.getId('file-list');
            fileListTbody.innerHTML = '';

            filenames.forEach((filename) => {
                const fileRow = document.createElement('tr');
                const fileCell = document.createElement('td');
                fileCell.textContent = filename;
                fileCell.className = 'file-item';
                fileCell.onclick = () => showFilename(fileCell, filename);
                fileRow.appendChild(fileCell);
                fileListTbody.appendChild(fileRow);
            });

            function showFilename(clickedItem, filename) {
                const fileNameDiv = rc.getId('file-name');
                fileNameDiv.textContent = `Selected file: ${filename}`;
                rc.selectedRtmpFilename = filename;
                const fileItems = document.querySelectorAll('.file-item');
                fileItems.forEach((item) => item.classList.remove('selected'));

                if (clickedItem) {
                    clickedItem.classList.add('selected');
                }
            }
        });
    }

    async startRTMP() {
        if (!this.isRTMPVideoSupported(filterXSS(this.selectedRtmpFilename))) {
            this.getId('file-name').textContent = '';
            return this.userLog(
                'warning',
                "The provided File is not valid. Please ensure it's .mp4, webm or ogg video file",
                'top-end',
            );
        }

        this.socket
            .request('startRTMP', {
                file: filterXSS(this.selectedRtmpFilename),
                peer_name: filterXSS(this.peer_name),
                peer_uuid: filterXSS(this.peer_uuid),
            })
            .then(function (rtmp) {
                rc.event(_EVENTS.startRTMP);
                rc.showRTMP(rtmp, 'file');
                rc.rtmpFileStreamer = true;
            });
    }

    stopRTMP() {
        if (this.rtmpFileStreamer) {
            this.socket.request('stopRTMP');
            this.rtmpFileStreamer = false;
            this.cleanRTMPUrl();
            console.log('RTMP STOP');
            this.event(_EVENTS.stopRTMP);
        }
    }

    endRTMP(data) {
        const rtmpMessage = `${data.rtmpUrl} processing finished!`;
        this.rtmpFileStreamer = false;
        this.userLog('info', rtmpMessage, 'top-end');
        console.log(rtmpMessage);
        this.cleanRTMPUrl();
        this.socket.request('endOrErrorRTMP');
        this.event(_EVENTS.endRTMP);
    }

    errorRTMP(data) {
        const rtmpError = `${data.message}`;
        this.rtmpFileStreamer = false;
        this.userLog('error', rtmpError, 'top-end');
        console.error(rtmpError);
        this.cleanRTMPUrl();
        this.socket.request('endOrErrorRTMP');
        this.event(_EVENTS.endRTMP);
    }

    // ##############################################
    // RTMP from URL
    // ##############################################

    startRTMPfromURL(inputVideoURL) {
        if (!this.isRTMPVideoSupported(filterXSS(inputVideoURL))) {
            this.getId('rtmpStreamURL').value = '';
            return this.userLog(
                'warning',
                'The provided URL is not valid. Please ensure it links to an .mp4 video file',
                'top-end',
            );
        }

        this.socket
            .request('startRTMPfromURL', {
                inputVideoURL: filterXSS(inputVideoURL),
                peer_name: filterXSS(this.peer_name),
                peer_uuid: filterXSS(this.peer_uuid),
            })
            .then(function (rtmp) {
                rc.event(_EVENTS.startRTMPfromURL);
                rc.showRTMP(rtmp, 'url');
                rc.rtmpUrlStreamer = true;
            });
    }

    stopRTMPfromURL() {
        if (this.rtmpUrlStreamer) {
            this.socket.request('stopRTMPfromURL');
            this.rtmpUrlStreamer = false;
            this.cleanRTMPUrl();
            console.log('RTMP from URL STOP');
            this.event(_EVENTS.stopRTMPfromURL);
        }
    }

    endRTMPfromURL(data) {
        const rtmpMessage = `${data.rtmpUrl} processing finished!`;
        this.rtmpUrlStreamer = false;
        this.userLog('info', rtmpMessage, 'top-end');
        console.log(rtmpMessage);
        this.cleanRTMPUrl();
        this.socket.request('endOrErrorRTMPfromURL');
        this.event(_EVENTS.endRTMPfromURL);
    }

    errorRTMPfromURL(data) {
        const rtmpError = `${data.message}`;
        this.rtmpUrlStreamer = false;
        this.userLog('error', rtmpError, 'top-end');
        console.error(rtmpError);
        this.cleanRTMPUrl();
        this.socket.request('endOrErrorRTMPfromURL');
        this.event(_EVENTS.endRTMPfromURL);
    }

    // ##############################################
    // RTMP common
    // ##############################################

    isRTMPVideoSupported(video) {
        if (video.endsWith('.mp4') || video.endsWith('.webm')) return true;
        return false;
    }

    copyRTMPUrl(url) {
        if (!url) return this.userLog('info', 'No RTMP URL detected', 'top-end');
        copyToClipboard(url);
    }

    cleanRTMPUrl() {
        const rtmpUrl = rc.getId('rtmpLiveUrl');
        rtmpUrl.value = '';
    }

    showRTMP(rtmp, type = 'file') {
        console.log('rtmp', rtmp);

        if (!rtmp) {
            switch (type) {
                case 'file':
                    this.event(_EVENTS.endRTMP);
                    break;
                case 'url':
                    this.event(_EVENTS.endRTMPfromURL);
                    break;
                default:
                    break;
            }
            return this.userLog(
                'warning',
                'Unable to start the RTMP stream. Please ensure the RTMP server is running. If the problem persists, contact the administrator',
                'top-end',
                6000,
            );
        }

        const rtmpUrl = rc.getId('rtmpLiveUrl');
        rtmpUrl.value = filterXSS(rtmp);

        Swal.fire({
            background: swalBackground,
            imageUrl: image.rtmp,
            position: 'center',
            title: 'LIVE',
            html: `
                <p style="background:transparent; color:rgb(8, 189, 89);">${rtmp}</p>
                `,
            showDenyButton: false,
            showCancelButton: false,
            confirmButtonText: `Copy URL`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                copyToClipboard(rtmp);
            }
        });
    }

    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
} // End
