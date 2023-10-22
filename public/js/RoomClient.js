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
 * @version 1.1.3
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
    kickOut: 'fas fa-times',
    ghost: 'fas fa-ghost',
    undo: 'fas fa-undo',
    bg: 'fas fa-circle-half-stroke',
    pin: 'fas fa-map-pin',
    videoPrivacy: 'far fa-circle',
};

const icons = {
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
        this.isVideoFullScreenSupported = peer_info.is_mobile_device && peer_info.os_name === 'iOS' ? false : true;
        this.isVideoPictureInPictureSupported = !DetectRTC.isMobileDevice && document.pictureInPictureEnabled;
        this.isZoomCenterMode = false;
        this.isChatOpen = false;
        this.isChatEmojiOpen = false;
        this.isSpeechSynthesisSupported = isSpeechSynthesisSupported;
        this.speechInMessages = false;
        this.showChatOnMessage = true;
        this.isChatBgTransparent = false;
        this.isVideoPinned = false;
        this.isChatPinned = false;
        this.pinnedVideoPlayerId = null;
        this.camVideo = false;
        this.camera = 'user';
        this.videoQualitySelectedIndex = 0;

        this.chatMessages = [];
        this.leftMsgAvatar = null;
        this.rightMsgAvatar = null;

        this.localVideoStream = null;
        this.localAudioStream = null;
        this.localScreenStream = null;
        this.mediaRecorder = null;
        this.recScreenStream = null;
        this._isRecording = false;

        this.RoomPassword = false;

        this.transcription = transcription;

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

        this.audioRecorder = null;

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

        Object.keys(_EVENTS).forEach(
            function (evt) {
                this.eventListeners.set(evt, []);
            }.bind(this),
        );

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

        this.createRoom(this.room_id).then(
            async function () {
                let data = {
                    room_id: this.room_id,
                    peer_info: this.peer_info,
                };
                await this.join(data);
                this.initSockets();
                this._isConnected = true;
                successCallback();
            }.bind(this),
        );
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
            .then(
                async function (room) {
                    console.log('##### JOIN ROOM #####', room);
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
                    const peers = new Map(JSON.parse(room.peers));
                    for (let peer of Array.from(peers.keys()).filter((id) => id !== this.peer_id)) {
                        let peer_info = peers.get(peer).peer_info;
                        if (peer_info.peer_name == this.peer_name) {
                            console.log('00-WARNING ----> Username already in use');
                            return this.userNameAlreadyInRoom();
                        }
                    }
                    await this.joinAllowed(room);
                }.bind(this),
            )
            .catch((err) => {
                console.log('Join error:', err);
            });
    }

    async joinAllowed(room) {
        console.log('07 ----> Join Room allowed');
        await this.handleRoomInfo(room);
        const data = await this.socket.request('getRouterRtpCapabilities');
        this.device = await this.loadDevice(data);
        console.log('07.3 ----> Get Router Rtp Capabilities codecs: ', this.device.rtpCapabilities.codecs);
        await this.initTransports(this.device);
        await this.startLocalMedia();
        this.socket.emit('getProducers');
    }

    async handleRoomInfo(room) {
        console.log('07.0 ----> Room Survey', room.survey);
        survey = room.survey;
        let peers = new Map(JSON.parse(room.peers));
        participantsCount = peers.size;
        for (let peer of Array.from(peers.keys()).filter((id) => id == this.peer_id)) {
            let my_peer_info = peers.get(peer).peer_info;
            console.log('07.1 ----> My Peer info', my_peer_info);
            isPresenter = window.localStorage.isReconnected === 'true' ? isPresenter : my_peer_info.peer_presenter;
            this.getId('isUserPresenter').innerText = isPresenter;
            window.localStorage.isReconnected = false;
            handleRules(isPresenter);
            room.config.hostOnlyRecording
                ? (console.log('07.1 ----> WARNING Room Host only recording enabled'),
                  this.event(_EVENTS.hostOnlyRecordingOn))
                : this.event(_EVENTS.hostOnlyRecordingOff);
        }
        adaptAspectRatio(participantsCount);
        for (let peer of Array.from(peers.keys()).filter((id) => id !== this.peer_id)) {
            let peer_info = peers.get(peer).peer_info;
            // console.log('07.1 ----> Remote Peer info', peer_info);
            if (!peer_info.peer_video) {
                await this.setVideoOff(peer_info, true);
            }
            if (peer_info.peer_recording) {
                this.handleRecordingAction({
                    peer_id: peer_info.id,
                    peer_name: peer_info.peer_name,
                    action: 'Started recording',
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
            }
            console.error('Browser not supported: ', error);
            this.userLog('error', 'Browser not supported: ' + error, 'center', 6000);
        }
        await device.load({
            routerRtpCapabilities,
        });
        return device;
    }

    // ####################################################
    // PRODUCER TRANSPORT
    // ####################################################

    async initTransports(device) {
        {
            const data = await this.socket.request('createWebRtcTransport', {
                forceTcp: false,
                rtpCapabilities: device.rtpCapabilities,
            });

            if (data.error) {
                return console.error('Create WebRtc Transport for Producer err: ', data.error);
            }

            this.producerTransport = device.createSendTransport(data);
            this.producerTransport.on(
                'connect',
                async function ({ dtlsParameters }, callback, errback) {
                    this.socket
                        .request('connectTransport', {
                            dtlsParameters,
                            transport_id: data.id,
                        })
                        .then(callback)
                        .catch(errback);
                }.bind(this),
            );

            this.producerTransport.on(
                'produce',
                async function ({ kind, appData, rtpParameters }, callback, errback) {
                    console.log('Going to produce', {
                        kind: kind,
                        appData: appData,
                        rtpParameters: rtpParameters,
                    });
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
                }.bind(this),
            );

            this.producerTransport.on(
                'connectionstatechange',
                function (state) {
                    switch (state) {
                        case 'connecting':
                            console.log('Producer Transport connecting...');
                            break;

                        case 'connected':
                            console.log('Producer Transport connected');
                            break;

                        case 'failed':
                            console.warn('Producer Transport failed');
                            this.producerTransport.close();
                            break;

                        default:
                            break;
                    }
                }.bind(this),
            );

            this.producerTransport.on(
                'icegatheringstatechange',
                function (state) {
                    console.log('Producer icegatheringstatechange', state);
                }.bind(this),
            );
        }

        // ####################################################
        // CONSUMER TRANSPORT
        // ####################################################

        {
            const data = await this.socket.request('createWebRtcTransport', {
                forceTcp: false,
            });

            if (data.error) {
                return console.error('Create WebRtc Transport for Consumer err: ', data.error);
            }

            this.consumerTransport = device.createRecvTransport(data);
            this.consumerTransport.on(
                'connect',
                function ({ dtlsParameters }, callback, errback) {
                    this.socket
                        .request('connectTransport', {
                            transport_id: this.consumerTransport.id,
                            dtlsParameters,
                        })
                        .then(callback)
                        .catch(errback);
                }.bind(this),
            );

            this.consumerTransport.on(
                'connectionstatechange',
                async function (state) {
                    switch (state) {
                        case 'connecting':
                            console.log('Consumer Transport connecting...');
                            break;

                        case 'connected':
                            console.log('Consumer Transport connected');
                            break;

                        case 'failed':
                            console.warn('Consumer Transport failed');
                            this.consumerTransport.close();
                            break;

                        default:
                            break;
                    }
                }.bind(this),
            );

            this.consumerTransport.on(
                'icegatheringstatechange',
                function (state) {
                    console.log('Consumer icegatheringstatechange', state);
                }.bind(this),
            );
        }
    }

    // ####################################################
    // TODO DATACHANNEL TRANSPORT
    // ####################################################

    // ####################################################
    // SOCKET ON
    // ####################################################

    initSockets() {
        this.socket.on(
            'consumerClosed',
            function ({ consumer_id, consumer_kind }) {
                console.log('Closing consumer', { consumer_id: consumer_id, consumer_kind: consumer_kind });
                this.removeConsumer(consumer_id, consumer_kind);
            }.bind(this),
        );

        this.socket.on(
            'setVideoOff',
            function (data) {
                console.log('Video off:', data);
                this.setVideoOff(data, true);
            }.bind(this),
        );

        this.socket.on(
            'removeMe',
            function (data) {
                console.log('Remove me:', data);
                this.removeVideoOff(data.peer_id);
                this.lobbyRemoveMe(data.peer_id);
                participantsCount = data.peer_counts;
                adaptAspectRatio(participantsCount);
                if (isParticipantsListOpen) getRoomParticipants(true);
            }.bind(this),
        );

        this.socket.on(
            'refreshParticipantsCount',
            function (data) {
                console.log('Participants Count:', data);
                participantsCount = data.peer_counts;
                adaptAspectRatio(participantsCount);
            }.bind(this),
        );

        this.socket.on(
            'newProducers',
            async function (data) {
                if (data.length > 0) {
                    console.log('New producers', data);
                    for (let { producer_id, peer_name, peer_info, type } of data) {
                        await this.consume(producer_id, peer_name, peer_info, type);
                    }
                }
            }.bind(this),
        );

        this.socket.on(
            'message',
            function (data) {
                console.log('New message:', data);
                this.showMessage(data);
            }.bind(this),
        );

        this.socket.on(
            'roomAction',
            function (data) {
                console.log('Room action:', data);
                this.roomAction(data, false);
            }.bind(this),
        );

        this.socket.on(
            'roomPassword',
            function (data) {
                console.log('Room password:', data.password);
                this.roomPassword(data);
            }.bind(this),
        );

        this.socket.on(
            'roomLobby',
            function (data) {
                console.log('Room lobby:', data);
                this.roomLobby(data);
            }.bind(this),
        );

        this.socket.on(
            'cmd',
            function (data) {
                console.log('Peer cmd:', data);
                this.handleCmd(data);
            }.bind(this),
        );

        this.socket.on(
            'peerAction',
            function (data) {
                console.log('Peer action:', data);
                this.peerAction(data.from_peer_name, data.peer_id, data.action, false, data.broadcast);
            }.bind(this),
        );

        this.socket.on(
            'updatePeerInfo',
            function (data) {
                console.log('Peer info update:', data);
                this.updatePeerInfo(data.peer_name, data.peer_id, data.type, data.status, false);
            }.bind(this),
        );

        this.socket.on(
            'fileInfo',
            function (data) {
                console.log('File info:', data);
                this.handleFileInfo(data);
            }.bind(this),
        );

        this.socket.on(
            'file',
            function (data) {
                this.handleFile(data);
            }.bind(this),
        );

        this.socket.on(
            'shareVideoAction',
            function (data) {
                this.shareVideoAction(data);
            }.bind(this),
        );

        this.socket.on(
            'fileAbort',
            function (data) {
                this.handleFileAbort(data);
            }.bind(this),
        );

        this.socket.on(
            'wbCanvasToJson',
            function (data) {
                console.log('Received whiteboard canvas JSON');
                JsonToWbCanvas(data);
            }.bind(this),
        );

        this.socket.on(
            'whiteboardAction',
            function (data) {
                console.log('Whiteboard action', data);
                whiteboardAction(data, false);
            }.bind(this),
        );

        this.socket.on(
            'audioVolume',
            function (data) {
                this.handleAudioVolume(data);
            }.bind(this),
        );

        this.socket.on(
            'recordingAction',
            function (data) {
                console.log('Recording action:', data);
                this.handleRecordingAction(data);
            }.bind(this),
        );

        this.socket.on(
            'connect',
            function () {
                console.log('Connected to signaling server!');
                this._isConnected = true;
                // location.reload();
                getPeerName() ? location.reload() : openURL(this.getReconnectDirectJoinURL());
            }.bind(this),
        );

        this.socket.on(
            'disconnect',
            function () {
                this.exit(true);
                this.ServerAway();
            }.bind(this),
        );
    }

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

    getReconnectDirectJoinURL() {
        return `${window.location.origin}/join?room=${this.room_id}&password=${this.RoomPassword}&name=${this.peer_name}&audio=${this.peer_info.peer_audio}&video=${this.peer_info.peer_video}&screen=${this.peer_info.peer_screen}&notify=0&isPresenter=${isPresenter}`;
    }

    // ####################################################
    // CHECK USER
    // ####################################################

    async userNameAlreadyInRoom() {
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
    // START LOCAL AUDIO VIDEO MEDIA
    // ####################################################

    async startLocalMedia() {
        console.log('08 ----> Start local media');
        if (this.isAudioAllowed) {
            console.log('09 ----> Start audio media');
            this.produce(mediaType.audio, microphoneSelect.value);
        } else {
            setColor(startAudioButton, 'red');
            console.log('09 ----> Audio is off');
        }
        if (this.isVideoAllowed) {
            console.log('10 ----> Start video media');
            this.produce(mediaType.video, videoSelect.value);
        } else {
            setColor(startVideoButton, 'red');
            console.log('10 ----> Video is off');
            this.setVideoOff(this.peer_info, false);
            this.sendVideoOff();
        }
        if (this.joinRoomWithScreen) {
            console.log('08 ----> Start Screen media');
            this.produce(mediaType.screen, null, false, true);
        }
        // if (this.isScreenAllowed) {
        //     this.shareScreen();
        // }
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
                if (swapCamera) {
                    mediaConstraints = this.getCameraConstraints();
                } else {
                    mediaConstraints = this.getVideoConstraints(deviceId);
                }
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
            return console.log('Producer already exists for this type ' + type);
        }

        let videoPrivacyBtn = this.getId(this.peer_id + '__vp');
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

            console.log('PRODUCER PARAMS', params);

            producer = await this.producerTransport.produce(params);

            console.log('PRODUCER', producer);

            this.producers.set(producer.id, producer);

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

            producer.on('trackended', () => {
                this.closeProducer(type);
            });

            producer.on('transportclose', () => {
                console.log('Producer transport close');
                if (!audio) {
                    elem.srcObject.getTracks().forEach(function (track) {
                        track.stop();
                    });
                    elem.parentNode.removeChild(elem);

                    handleAspectRatio();
                    console.log('[transportClose] Video-element-count', this.videoMediaContainer.childElementCount);
                } else {
                    au.srcObject.getTracks().forEach(function (track) {
                        track.stop();
                    });
                    au.parentNode.removeChild(au);
                    console.log('[transportClose] audio-element-count', this.localAudioEl.childElementCount);
                }
                this.producers.delete(producer.id);
            });

            producer.on('close', () => {
                console.log('Closing producer');
                if (!audio) {
                    elem.srcObject.getTracks().forEach(function (track) {
                        track.stop();
                    });
                    elem.parentNode.removeChild(elem);

                    handleAspectRatio();
                    console.log('[closingProducer] Video-element-count', this.videoMediaContainer.childElementCount);
                } else {
                    au.srcObject.getTracks().forEach(function (track) {
                        track.stop();
                    });
                    au.parentNode.removeChild(au);
                    console.log('[closingProducer] audio-element-count', this.localAudioEl.childElementCount);
                }
                this.producers.delete(producer.id);
            });

            this.producerLabel.set(type, producer.id);

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
                    return;
            }
            this.sound('joined');
        } catch (err) {
            console.error('Produce error:', err);

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
                        frameRate: frameRate,
                    },
                };
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
        isHideMeActive = !isHideMeActive;
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
        setTimeout(function () {
            rc.produce(type, deviceId, swapCamera);
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
                elem.style.objectFit = isScreen ? 'contain' : 'var(--videoObjFit)';
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
                p = document.createElement('p');
                p.id = this.peer_id + '__name';
                p.className = html.userName;
                p.innerText = this.peer_name + ' (me)';
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
                if (this.isAudioAllowed && !speakerSelect.disabled) {
                    this.attachSinkId(elem, speakerSelect.value);
                }
                console.log('[addProducer] audio-element-count', this.localAudioEl.childElementCount);
                break;
            default:
                break;
        }
        return elem;
    }

    pauseProducer(type) {
        if (!this.producerLabel.has(type)) {
            return console.log('There is no producer for this type ' + type);
        }

        let producer_id = this.producerLabel.get(type);
        this.producers.get(producer_id).pause();

        switch (type) {
            case mediaType.audio:
                this.event(_EVENTS.pauseAudio);
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

    resumeProducer(type) {
        if (!this.producerLabel.has(type)) {
            return console.log('There is no producer for this type ' + type);
        }

        let producer_id = this.producerLabel.get(type);
        this.producers.get(producer_id).resume();

        switch (type) {
            case mediaType.audio:
                this.event(_EVENTS.resumeAudio);
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
            return console.log('There is no producer for this type ' + type);
        }

        let producer_id = this.producerLabel.get(type);

        let data = {
            peer_name: this.peer_name,
            producer_id: producer_id,
            type: type,
            status: false,
        };
        console.log('Close producer', data);

        this.socket.emit('producerClosed', data);

        this.producers.get(producer_id).close();
        this.producers.delete(producer_id);
        this.producerLabel.delete(type);

        if (type !== mediaType.audio) {
            let elem = this.getId(producer_id);
            let d = this.getId(producer_id + '__video');
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
            let au = this.getId(producer_id + '__localAudio');
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
                return;
        }

        this.sound('left');
    }

    async produceScreenAudio(stream) {
        try {
            //this.stopMyAudio();

            if (this.producerLabel.has(mediaType.audioTab)) {
                return console.log('Producer already exists for this type ' + mediaType.audioTab);
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

            const sa = await this.handleProducer(producerSa.id, mediaType.audio, stream);

            producerSa.on('trackended', () => {
                this.closeProducer(mediaType.audioTab);
                // this.startMyAudio();
            });

            producerSa.on('transportclose', () => {
                console.log('Producer Screen audio transport close');
                sa.srcObject.getTracks().forEach(function (track) {
                    track.stop();
                });
                sa.parentNode.removeChild(sa);
                console.log('[transportClose] audio-element-count', this.localAudioEl.childElementCount);
                this.producers.delete(producerSa.id);
            });

            producerSa.on('close', () => {
                console.log('Closing Screen audio producer');
                sa.srcObject.getTracks().forEach(function (track) {
                    track.stop();
                });
                sa.parentNode.removeChild(sa);
                console.log('[closingProducer] audio-element-count', this.localAudioEl.childElementCount);
                this.producers.delete(producerSa.id);
            });

            this.producerLabel.set(mediaType.audioTab, producerSa.id);
        } catch (err) {
            console.error('Produce error:', err);
        }
    }

    startMyAudio() {
        startAudioButton.click();
        this.setIsAudio(this.peer_id, true);
        this.event(_EVENTS.startAudio);
        setAudioButtonsDisabled(false);
    }

    stopMyAudio() {
        stopAudioButton.click();
        this.setIsAudio(this.peer_id, false);
        this.event(_EVENTS.stopAudio);
        setAudioButtonsDisabled(true);
    }

    // ####################################################
    // CONSUMER
    // ####################################################

    async consume(producer_id, peer_name, peer_info, type) {
        //
        wbUpdate();

        this.getConsumeStream(producer_id, peer_info.peer_id, type).then(
            function ({ consumer, stream, kind }) {
                console.log('CONSUMER MEDIA TYPE ----> ' + type);
                console.log('CONSUMER', consumer);

                this.consumers.set(consumer.id, consumer);

                if (kind === 'video') {
                    if (isParticipantsListOpen) getRoomParticipants(true);
                }

                this.handleConsumer(consumer.id, type, stream, peer_name, peer_info);

                consumer.on(
                    'trackended',
                    function () {
                        this.removeConsumer(consumer.id, consumer.kind);
                    }.bind(this),
                );

                consumer.on(
                    'transportclose',
                    function () {
                        this.removeConsumer(consumer.id, consumer.kind);
                    }.bind(this),
                );
            }.bind(this),
        );
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
        let elem, vb, d, p, i, cm, au, pip, fs, ts, sf, sm, sv, ko, pb, pm, pv, pn;

        console.log('PEER-INFO', peer_info);

        let remotePeerId = peer_info.peer_id;
        let remoteIsScreen = type == mediaType.screen;
        let remotePrivacyOn = peer_info.peer_video_privacy;

        switch (type) {
            case mediaType.video:
            case mediaType.screen:
                let remotePeerAudio = peer_info.peer_audio;
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
                elem.style.objectFit = remoteIsScreen ? 'contain' : 'var(--videoObjFit)';
                vb = document.createElement('div');
                vb.setAttribute('id', remotePeerId + '__vb');
                vb.className = 'videoMenuBar fadein';
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
                ko = document.createElement('button');
                ko.id = id + '___' + remotePeerId + '___kickOut';
                ko.className = html.kickOut;
                i = document.createElement('i');
                i.id = remotePeerId + '__hand';
                i.className = html.userHand;
                p = document.createElement('p');
                p.id = remotePeerId + '__name';
                p.className = html.userName;
                p.innerText = peer_name;
                pm = document.createElement('div');
                pb = document.createElement('div');
                pm.setAttribute('id', remotePeerId + '__pitchMeter');
                pb.setAttribute('id', remotePeerId + '__pitchBar');
                pm.className = 'speechbar';
                pb.className = 'bar';
                pb.style.height = '1%';
                pm.appendChild(pb);
                BUTTONS.consumerVideo.ejectButton && vb.appendChild(ko);
                BUTTONS.consumerVideo.audioVolumeInput && vb.appendChild(pv);
                vb.appendChild(au);
                vb.appendChild(cm);
                BUTTONS.consumerVideo.sendVideoButton && vb.appendChild(sv);
                BUTTONS.consumerVideo.sendFileButton && vb.appendChild(sf);
                BUTTONS.consumerVideo.sendMessageButton && vb.appendChild(sm);
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
                    this.setTippy(ko.id, 'Eject', 'bottom');
                }
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
                }
                console.log('[Add audioConsumers]', this.audioConsumers);
                break;
            default:
                break;
        }
        return elem;
    }

    removeConsumer(consumer_id, consumer_kind) {
        console.log('Remove consumer', { consumer_id: consumer_id, consumer_kind: consumer_kind });

        let elem = this.getId(consumer_id);
        if (elem) {
            elem.srcObject.getTracks().forEach(function (track) {
                track.stop();
            });
            elem.parentNode.removeChild(elem);
        }

        if (consumer_kind === 'video') {
            let d = this.getId(consumer_id + '__video');
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
            let audioConsumerPlayerId = this.getMapKeyByValue(this.audioConsumers, consumer_id);
            if (audioConsumerPlayerId) {
                let inputPv = this.getId(audioConsumerPlayerId);
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

    async setVideoOff(peer_info, remotePeer = false) {
        let d, vb, i, h, au, sf, sm, sv, ko, p, pm, pb, pv;
        let peer_id = peer_info.peer_id;
        let peer_name = peer_info.peer_name;
        let peer_audio = peer_info.peer_audio;
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
        p.innerText = peer_name + (remotePeer ? '' : ' (me) ');
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
            BUTTONS.videoOff.sendVideoButton && vb.appendChild(sv);
            BUTTONS.videoOff.sendFileButton && vb.appendChild(sf);
            BUTTONS.videoOff.sendMessageButton && vb.appendChild(sm);
            BUTTONS.videoOff.audioVolumeInput && vb.appendChild(pv);
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
            this.handleKO(ko.id);
        }
        this.handleDD(d.id, peer_id, !remotePeer);
        this.popupPeerInfo(p.id, peer_info);
        this.setVideoAvatarImgName(i.id, peer_name);
        this.getId(i.id).style.display = 'block';
        handleAspectRatio();
        if (isParticipantsListOpen) getRoomParticipants(true);
        if (!this.isMobileDevice && remotePeer) {
            this.setTippy(sm.id, 'Send message', 'bottom');
            this.setTippy(sf.id, 'Send file', 'bottom');
            this.setTippy(sv.id, 'Send video', 'bottom');
            this.setTippy(au.id, 'Mute', 'bottom');
            this.setTippy(pv.id, '🔊 Volume', 'bottom');
            this.setTippy(ko.id, 'Eject', 'bottom');
        }
        console.log('[setVideoOff] Video-element-count', this.videoMediaContainer.childElementCount);
        //
        wbUpdate();
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
        let clean = function () {
            this._isConnected = false;
            if (this.consumerTransport) this.consumerTransport.close();
            if (this.producerTransport) this.producerTransport.close();
            this.socket.off('disconnect');
            this.socket.off('newProducers');
            this.socket.off('consumerClosed');
        }.bind(this);

        if (!offline) {
            this.socket
                .request('exitRoom')
                .then((e) => console.log('Exit Room', e))
                .catch((e) => console.warn('Exit Room ', e))
                .finally(
                    function () {
                        clean();
                        this.event(_EVENTS.exitRoom);
                    }.bind(this),
                );
        } else {
            clean();
        }
    }

    exitRoom() {
        //...
        this.exit();
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
                    lS.setLocalStorageDevices(lS.MEDIA_TYPE.speaker, 0, speakerSelect.value);
                });
        } else {
            let error = `Browser seems doesn't support output device selection.`;
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
            tippy(element, {
                content: content,
                placement: placement,
                allowHTML: allowHTML,
            });
        } else {
            console.warn('setTippy element not found with content', content);
        }
    }

    setVideoAvatarImgName(elemId, peer_name) {
        let elem = this.getId(elemId);
        if (cfg.useAvatarSvg) {
            elem.setAttribute('src', this.genAvatarSvg(peer_name, 250));
        } else {
            elem.setAttribute('src', image.avatar);
        }
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

    setIsAudio(peer_id, status) {
        this.peer_info.peer_audio = status;
        let b = this.getPeerAudioBtn(peer_id);
        if (b) b.className = this.peer_info.peer_audio ? html.audioOn : html.audioOff;
    }

    setIsVideo(status) {
        this.peer_info.peer_video = status;
        if (!this.peer_info.peer_video) {
            this.setVideoOff(this.peer_info, false);
            this.sendVideoOff();
        }
    }

    setIsScreen(status) {
        this.peer_info.peer_screen = status;
        if (!this.peer_info.peer_screen && !this.peer_info.peer_video) {
            this.setVideoOff(this.peer_info, false);
            this.sendVideoOff();
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

    static get DEVICES_COUNT() {
        return DEVICES_COUNT;
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
        Toast.fire({
            icon: icon,
            title: message,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        });
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

    msgHTML(icon, imageUrl, title, html, position = 'center') {
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
                    });
                }
            });
        }
    }

    // ####################################################
    // FULL SCREEN
    // ####################################################

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
                    return userLog('info', 'Full Screen not allowed if video on privacy mode', 'top-end');
                }
                videoPlayer.style.pointerEvents = this.isVideoOnFullScreen ? 'auto' : 'none';
                this.toggleFullScreen(videoPlayer);
                this.isVideoOnFullScreen = this.isVideoOnFullScreen ? false : true;
            });
        }
        if (videoPlayer) {
            videoPlayer.addEventListener('click', () => {
                if (videoPlayer.classList.contains('videoCircle')) {
                    return userLog('info', 'Full Screen not allowed if video on privacy mode', 'top-end');
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

    handlePN(elemId, pnId, camId, isScreen = false) {
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
                    if (!isScreen) videoPlayer.style.objectFit = 'var(--videoObjFit)';
                    this.videoPinMediaContainer.removeChild(cam);
                    cam.className = 'Camera';
                    this.videoMediaContainer.appendChild(cam);
                    this.removeVideoPinMediaContainer();
                    setColor(btnPn, 'white');
                }
                handleAspectRatio();
            });
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

    toggleChat() {
        let chatRoom = this.getId('chatRoom');
        if (this.isChatOpen == false) {
            chatRoom.style.display = 'block';
            hide(chatMinButton);
            show(chatMaxButton);
            this.chatCenter();
            this.sound('open');
            this.isChatOpen = true;
        } else {
            chatRoom.style.display = 'none';
            this.isChatOpen = false;
        }
        if (this.isChatPinned) this.chatUnpin();
    }

    toggleChatPin() {
        if (transcription.isPin()) {
            return userLog('info', 'Please unpin the transcription that appears to be currently pinned', 'top-end');
        }
        this.isChatPinned ? this.chatUnpin() : this.chatPin();
        this.sound('click');
    }

    chatMaximize() {
        hide(chatMaxButton);
        show(chatMinButton);
        this.chatCenter();
        document.documentElement.style.setProperty('--msger-width', '100%');
        document.documentElement.style.setProperty('--msger-height', '100%');
    }

    chatMinimize() {
        hide(chatMinButton);
        show(chatMaxButton);
        if (this.isChatPinned) {
            this.chatPin();
        } else {
            this.chatCenter();
            document.documentElement.style.setProperty('--msger-width', '420px');
            document.documentElement.style.setProperty('--msger-height', '680px');
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
    }

    chatUnpin() {
        if (!this.isVideoPinned) {
            this.videoMediaContainer.style.top = 0;
            this.videoMediaContainer.style.right = null;
            this.videoMediaContainer.style.width = '100%';
            this.videoMediaContainer.style.height = '100%';
        }
        document.documentElement.style.setProperty('--msger-width', '420px');
        document.documentElement.style.setProperty('--msger-height', '680px');
        hide(chatMinButton);
        show(chatMaxButton);
        this.chatCenter();
        this.isChatPinned = false;
        setColor(chatTogglePin, 'white');
        resizeVideoMedia();
        chatRoom.style.resize = 'both';
        if (!this.isMobileDevice) this.makeDraggable(chatRoom, chatHeader);
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
        chatMessage.style.height = '43px';
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
        chatMessage.value = filterXSS(chatMessage.value.trim());
        let peer_msg = this.formatMsg(chatMessage.value);
        if (!peer_msg) {
            return this.cleanMessage();
        }
        this.peer_name = filterXSS(this.peer_name);
        if (isChatGPTOn) {
            this.socket
                .request('getChatGPT', {
                    time: getDataTimeString(),
                    room: this.room_id,
                    name: this.peer_name,
                    prompt: peer_msg,
                })
                .then(
                    function (completion) {
                        if (!completion) return;
                        console.log('Receive message:', completion);
                        this.setMsgAvatar('left', 'ChatGPT');
                        this.appendMessage(
                            'left',
                            this.leftMsgAvatar,
                            'ChatGPT',
                            this.peer_id,
                            completion,
                            this.peer_id,
                            this.peer_name,
                        );
                        this.cleanMessage();
                        this.speechInMessages ? this.speechMessage(true, 'ChatGPT', completion) : this.sound('message');
                    }.bind(this),
                )
                .catch((err) => {
                    console.log('ChatGPT error:', err);
                });
        } else {
            let data = {
                peer_name: this.peer_name,
                peer_id: this.peer_id,
                to_peer_id: 'all',
                peer_msg: peer_msg,
            };
            console.log('Send message:', data);
            this.socket.emit('message', data);
        }
        this.setMsgAvatar('right', this.peer_name);
        this.appendMessage('right', this.rightMsgAvatar, this.peer_name, this.peer_id, peer_msg, 'all', 'all');
        this.cleanMessage();
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
                this.setMsgAvatar('right', this.peer_name);
                this.appendMessage(
                    'right',
                    this.rightMsgAvatar,
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

    showMessage(data) {
        if (!this.isChatOpen && this.showChatOnMessage) this.toggleChat();
        this.setMsgAvatar('left', data.peer_name);
        this.appendMessage(
            'left',
            this.leftMsgAvatar,
            data.peer_name,
            data.peer_id,
            data.peer_msg,
            data.to_peer_id,
            data.to_peer_name,
        );
        if (!this.showChatOnMessage) {
            this.userLog('info', `💬 New message from: ${data.peer_name}`, 'top-end');
        }
        this.speechInMessages ? this.speechMessage(true, data.peer_name, data.peer_msg) : this.sound('message');
    }

    setMsgAvatar(avatar, peerName) {
        let avatarImg = this.genAvatarSvg(peerName, 32);
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

        const msgBubble = getToId == 'all' ? 'msg-bubble' : 'msg-bubble-private';
        const replyMsg = getFromId === this.peer_id ? `<hr/>Private message to ${getToName}` : '';
        const message = getToId == 'all' ? getMsg : getMsg + replyMsg;

        let msgHTML = `
        <div id="msg-${chatMessagesId}" class="msg ${getSide}-msg">
            <img class="msg-img" src="${getImg}" />
            <div class=${msgBubble}>
                <div class="msg-info">
                    <div class="msg-info-name">${getFromName}</div>
                    <div class="msg-info-time">${time}</div>
                </div>
                <div id="${chatMessagesId}" class="msg-text">${message}
                    <hr/>`;
        // add btn direct reply to private message
        if (getFromId != this.peer_id) {
            msgHTML += `
                    <button 
                        class="fas fa-paper-plane"
                        id="msg-private-reply-${chatMessagesId}"
                        onclick="rc.sendMessageTo('${getFromId}','${getFromName}')"
                    ></button>`;
        }
        msgHTML += `                    
                    <button
                        id="msg-delete-${chatMessagesId}"
                        class="fas fa-trash" 
                        onclick="rc.deleteMessage('msg-${chatMessagesId}')"
                    ></button>
                    <button
                        id="msg-copy-${chatMessagesId}"
                        class="fas fa-copy" 
                        onclick="rc.copyToClipboard('${chatMessagesId}')"
                    ></button>`;
        if (this.isSpeechSynthesisSupported) {
            msgHTML += `
                <button
                    id="msg-speech-${chatMessagesId}"
                    class="fas fa-volume-high" 
                    onclick="rc.speechMessage(false, '${getFromName}', '${this.formatMsg(getMsg)}')"
                ></button>
            `;
        }
        msgHTML += ` 
                </div>
            </div>
        </div>
        `;
        this.collectMessages(time, getFromName, getMsg);
        chatMsger.insertAdjacentHTML('beforeend', msgHTML);
        chatMsger.scrollTop += 500;
        this.setTippy('msg-delete-' + chatMessagesId, 'Delete', 'top');
        this.setTippy('msg-copy-' + chatMessagesId, 'Copy', 'top');
        this.setTippy('msg-speech-' + chatMessagesId, 'Speech', 'top');
        this.setTippy('msg-private-reply-' + chatMessagesId, 'Reply', 'top');
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
            chatMessage.style.height = '200px';
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
            title: 'Clean up chat Messages?',
            imageUrl: image.delete,
            showDenyButton: true,
            confirmButtonText: `Yes`,
            denyButtonText: `No`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                let msgs = chatMsger.firstChild;
                while (msgs) {
                    chatMsger.removeChild(msgs);
                    msgs = chatMsger.firstChild;
                }
                this.chatMessages = [];
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
        const possibleTypes = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=h264,opus',
            'video/mp4;codecs=h264,aac',
            'video/mp4',
        ];
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
        this.recordingAction('Start recording');
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
            const audioTrack = audio.srcObject.getAudioTracks()[0];
            if (audioTrack) {
                audioTracks.push(audioTrack);
            }
        });
        return audioTracks;
    }

    getAudioStreamFromAudioElements() {
        const audioElements = document.querySelectorAll('audio');
        const audioStream = new MediaStream();
        audioElements.forEach((audio) => {
            const audioTrack = audio.srcObject.getAudioTracks()[0];
            if (audioTrack) {
                audioStream.addTrack(audioTrack);
            }
        });
        return audioStream;
    }

    handleMediaRecorder() {
        if (this.mediaRecorder) {
            this.mediaRecorder.start();
            this.mediaRecorder.addEventListener('start', this.handleMediaRecorderStart);
            this.mediaRecorder.addEventListener('dataavailable', this.handleMediaRecorderData);
            this.mediaRecorder.addEventListener('stop', this.handleMediaRecorderStop);
        }
    }

    handleMediaRecorderStart(evt) {
        console.log('MediaRecorder started: ', evt);
    }

    handleMediaRecorderData(evt) {
        console.log('MediaRecorder data: ', evt);
        if (evt.data && evt.data.size > 0) recordedBlobs.push(evt.data);
    }

    handleMediaRecorderStop(evt) {
        try {
            console.log('MediaRecorder stopped: ', evt);
            console.log('MediaRecorder Blobs: ', recordedBlobs);

            const dateTime = getDataTimeString();
            const type = recordedBlobs[0].type.includes('mp4') ? 'mp4' : 'webm';
            const blob = new Blob(recordedBlobs, { type: 'video/' + type });
            const recFileName = `${dateTime}-REC.${type}`;
            const currentDevice = DetectRTC.isMobileDevice ? 'MOBILE' : 'PC';
            const blobFileSize = bytesToSize(blob.size);
            const recTime = document.getElementById('recordingStatus');

            const recordingInfo = `
                🔴 Recording Info: <br/><br/>
                <ul>
                    <li>Time: ${recTime.innerText}</li>
                    <li>File: ${recFileName}</li>
                    <li>Size: ${blobFileSize}</li>
                </ul>
                <br/>
                Please wait to be processed, then will be downloaded to your ${currentDevice} device.
            `;

            Swal.fire({
                background: swalBackground,
                position: 'center',
                icon: 'success',
                title: 'Recording',
                html: `<div style="text-align: left;">${recordingInfo}</div>`,
                showClass: { popup: 'animate__animated animate__fadeInDown' },
                hideClass: { popup: 'animate__animated animate__fadeOutUp' },
            });

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
        } catch (err) {
            console.error('Recording save failed', err);
        }
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
            this.recordingAction('Stop recording');
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
        const recAction = {
            side: 'left',
            img: this.leftMsgAvatar,
            peer_name: data.peer_name,
            peer_id: data.peer_id,
            peer_msg: `🔴 ${data.action}`,
            to_peer_id: 'all',
            to_peer_name: 'all',
        };
        this.showMessage(recAction);
        if (!this.showChatOnMessage) {
            this.msgHTML(null, image.recording, null, `${icons.user} ${data.peer_name}: <h1>${data.action}</h1>`);
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
            inputAttributes: {
                accept: this.fileSharingInput,
                'aria-label': 'Select file',
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
    }

    sendFileInformations(file, peer_id, broadcast = false) {
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
            this.setMsgAvatar('right', this.peer_name);
            this.appendMessage(
                'right',
                this.rightMsgAvatar,
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
        this.setMsgAvatar('left', this.incomingFileInfo.peer_name);
        this.appendMessage(
            'left',
            this.leftMsgAvatar,
            this.incomingFileInfo.peer_name,
            this.incomingFileInfo.peer_id,
            `${icons.fileReceive} File receive: 
            <br/> 
            <ul>
                <li>From: ${this.incomingFileInfo.peer_name}</li>
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
        if (this.fileReader && this.fileReader.readyState === 1) {
            this.fileReader.abort();
            sendFileDiv.style.display = 'none';
            this.sendInProgress = false;
            this.socket.emit('fileAbort', {
                peer_name: this.peer_name,
            });
        }
    }

    hideFileTransfer() {
        receiveFileDiv.style.display = 'none';
    }

    handleFileAbort(data) {
        this.receiveBuffer = [];
        this.incomingFileData = [];
        this.receivedSize = 0;
        this.receiveInProgress = false;
        receiveFileDiv.style.display = 'none';
        console.log(data.peer_name + ' aborted the file transfer');
        userLog('info', data.peer_name + ' ⚠️ aborted the file transfer', 'top-end');
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
        let data = {
            room_id: this.room_id,
            peer_id: this.peer_id,
            peer_name: this.peer_name,
            peer_uuid: this.peer_uuid,
            action: action,
            password: null,
        };
        if (emit) {
            switch (action) {
                case 'lock':
                    if (room_password) {
                        this.socket
                            .request('getPeerCounts')
                            .then(
                                async function (res) {
                                    // Only the presenter can lock the room
                                    if (isPresenter || res.peerCounts == 1) {
                                        isPresenter = true;
                                        this.getId('isUserPresenter').innerText = isPresenter;
                                        data.password = room_password;
                                        this.socket.emit('roomAction', data);
                                        this.roomStatus(action);
                                    }
                                }.bind(this),
                            )
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
                    this.roomStatus(action);
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
                default:
                    break;
            }
        } else {
            this.roomStatus(action);
        }
    }

    roomStatus(action) {
        switch (action) {
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
                    ? userLog('info', `${icons.chat} Chat will be shown, when you receive a message`, 'top-end')
                    : userLog('info', `${icons.chat} Chat not will be shown, when you receive a message`, 'top-end');
                break;
            case 'speechMessages':
                this.userLog('info', `${icons.speech} Speech incoming messages ${status}`, 'top-end');
                break;
            case 'showTranscript':
                active
                    ? userLog(
                          'info',
                          `${icons.transcript} Transcript will be shown, when you receive a message`,
                          'top-end',
                      )
                    : userLog(
                          'info',
                          `${icons.transcript} Transcript not will be shown, when you receive a message`,
                          'top-end',
                      );
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

    roomLobby(data) {
        console.log('LOBBY--->', data);
        switch (data.lobby_status) {
            case 'waiting':
                if (!isRulesActive || isPresenter) {
                    let lobbyTr = '';
                    let peer_id = data.peer_id;
                    let peer_name = data.peer_name;
                    let avatarImg = this.genAvatarSvg(peer_name, 32);
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
                this.joinAllowed(data.room);
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
            inputPv.addEventListener('input', () => {
                audioConsumerPlayer.volume = inputPv.value / 100;
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
                this.peerAction('me', peer_id, 'eject');
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
            btnCm.addEventListener('click', () => {
                this.peerAction('me', peer_id, 'hide');
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
                    this.peerAction('me', peer_id, 'mute');
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

    peerAction(from_peer_name, id, action, emit = true, broadcast = false, info = true) {
        const words = id.split('___');
        let peer_id = words[0];

        if (emit) {
            let data = {
                from_peer_name: this.peer_name,
                from_peer_id: this.peer_id,
                from_peer_uuid: this.peer_uuid,
                peer_id: peer_id,
                action: action,
                broadcast: broadcast,
            };

            if (!this.thereAreParticipants()) {
                if (info) return this.userLog('info', 'No participants detected', 'top-end');
            }
            switch (action) {
                case 'mute':
                    const peerAudioStatus = this.getId(data.peer_id + '__audio');
                    if (!peerAudioStatus || peerAudioStatus.className == html.audioOff) {
                        return this.userLog(
                            'info',
                            'The participant has been muted, and only they have the ability to unmute themselves',
                            'top-end',
                        );
                    }
                    break;
                case 'hide':
                    const peerVideoOff = this.getId(data.peer_id + '__videoOff');
                    if (peerVideoOff) {
                        return this.userLog(
                            'info',
                            'The participant is currently hidden, and only they have the option to unhide themselves',
                            'top-end',
                        );
                    }
                case 'stop':
                    const peerScreenButton = this.getId(id);
                    if (peerScreenButton) {
                        const peerScreenStatus = peerScreenButton.querySelector('i');
                        if (peerScreenStatus && peerScreenStatus.style.color == 'red') {
                            return this.userLog(
                                'info',
                                'The participant screen is not shared, only the participant can initiate sharing',
                                'top-end',
                            );
                        }
                    }
                    break;
                default:
                    break;
            }
            this.confirmPeerAction(action, data);
        } else {
            switch (action) {
                case 'eject':
                    if (peer_id === this.peer_id || broadcast) {
                        this.exit(true);
                        this.sound(action);
                        this.peerActionProgress(from_peer_name, 'Will eject you from the room', 5000, action);
                    }
                    break;
                case 'mute':
                    if (peer_id === this.peer_id || broadcast) {
                        this.closeProducer(mediaType.audio);
                        this.updatePeerInfo(this.peer_name, this.peer_id, 'audio', false);
                        this.userLog(
                            'warning',
                            from_peer_name + '  ' + _PEER.audioOff + ' has closed yours audio',
                            'top-end',
                            10000,
                        );
                    }
                    break;
                case 'hide':
                    if (peer_id === this.peer_id || broadcast) {
                        this.closeProducer(mediaType.video);
                        this.userLog(
                            'warning',
                            from_peer_name + '  ' + _PEER.videoOff + ' has closed yours video',
                            'top-end',
                            10000,
                        );
                    }
                    break;
                case 'stop':
                    if (this.isScreenShareSupported) {
                        if (peer_id === this.peer_id || broadcast) {
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
                default:
                    break;
                //...
            }
        }
    }

    peerActionProgress(tt, msg, time, action = 'na') {
        Swal.fire({
            allowOutsideClick: false,
            background: swalBackground,
            icon: action == 'eject' ? 'warning' : 'success',
            title: tt,
            text: msg,
            timer: time,
            timerProgressBar: true,
            didOpen: () => {
                Swal.showLoading();
            },
        }).then(() => {
            switch (action) {
                case 'refresh':
                    getRoomParticipants(true);
                    break;
                case 'eject':
                    this.exit();
                    break;
                default:
                    break;
            }
        });
    }

    confirmPeerAction(action, data) {
        switch (action) {
            case 'eject':
                let ejectConfirmed = false;
                let whoEject = data.broadcast ? 'All participants except yourself?' : 'current participant?';
                Swal.fire({
                    background: swalBackground,
                    position: 'center',
                    imageUrl: data.broadcast ? image.users : image.user,
                    title: 'Eject ' + whoEject,
                    showDenyButton: true,
                    confirmButtonText: `Yes`,
                    denyButtonText: `No`,
                    showClass: { popup: 'animate__animated animate__fadeInDown' },
                    hideClass: { popup: 'animate__animated animate__fadeOutUp' },
                })
                    .then((result) => {
                        if (result.isConfirmed) {
                            ejectConfirmed = true;
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
            case 'hide':
            case 'stop':
                let muteHideStopConfirmed = false;
                let whoMuteHideStop = data.broadcast ? 'everyone except yourself?' : 'current participant?';
                let imageUrl, title, text;
                switch (action) {
                    case 'mute':
                        imageUrl = image.mute;
                        title = 'Mute ' + whoMuteHideStop;
                        text =
                            "Once muted, you won't be able to unmute them, but they can unmute themselves at any time.";
                        break;
                    case 'hide':
                        title = 'Hide ' + whoMuteHideStop;
                        imageUrl = image.hide;
                        text =
                            "Once hided, you won't be able to unhide them, but they can unhide themselves at any time.";
                        break;
                    case 'stop':
                        imageUrl = image.stop;
                        title = 'Stop screen share to the ' + whoMuteHideStop;
                        text = "Once stop, you won't be able to start them, but they can start themselves at any time.";
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
                                    case 'stop':
                                        let peerScreenButton = this.getId(data.peer_id + '___pScreen');
                                        if (peerScreenButton) peerScreenButton.innerHTML = _PEER.screenOff;
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

    // ####################################################
    // SEARCH PEER FILTER
    // ####################################################

    searchPeer() {
        let input, filter, table, tr, td, i, txtValue;
        input = this.getId('searchParticipants');
        filter = input.value.toUpperCase();
        table = this.getId('myTable');
        tr = table.getElementsByTagName('tr');
        for (i = 0; i < tr.length; i++) {
            td = tr[i].getElementsByTagName('td')[1];
            if (td) {
                txtValue = td.textContent || td.innerText;
                if (txtValue.toUpperCase().indexOf(filter) > -1) {
                    tr[i].style.display = '';
                } else {
                    tr[i].style.display = 'none';
                }
            }
        }
    }

    // ####################################################
    // UPDATE PEER INFO
    // ####################################################

    updatePeerInfo(peer_name, peer_id, type, status, emit = true) {
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
            let data = {
                peer_name: peer_name,
                peer_id: peer_id,
                type: type,
                status: status,
            };
            this.socket.emit('updatePeerInfo', data);
        } else {
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
        if (isParticipantsListOpen) getRoomParticipants(true);
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
}
