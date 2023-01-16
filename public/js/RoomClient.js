'use strict';

/**
 * MiroTalk SFU - Client component
 *
 * @link    GitHub: https://github.com/miroslavpejic85/mirotalksfu
 * @link    Live demo: https://sfu.mirotalk.com
 * @license For open source use: AGPLv3
 * @license For commercial or closed source, contact us at license.mirotalk@gmail.com or buy directly via CodeCanyon
 * @license CodeCanyon: https://codecanyon.net/item/mirotalk-sfu-webrtc-realtime-video-conferences/40769970
 * @author  Miroslav Pejic - miroslav.pejic.85@gmail.com
 * @version 1.0.0
 *
 */

const cfg = {
    useAvatarApi: true,
    msgAvatar: 'https://eu.ui-avatars.com/api',
};

const html = {
    newline: '<br />',
    audioOn: 'fas fa-microphone',
    audioOff: 'fas fa-microphone-slash',
    videoOn: 'fas fa-video',
    videoOff: 'fas fa-video-slash',
    userName: 'username',
    userHand: 'fas fa-hand-paper pulsate',
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

const image = {
    avatar: '../images/mirotalksfu-logo.png',
    audio: '../images/audio.gif',
    poster: '../images/loader.gif',
    delete: '../images/delete.png',
    locked: '../images/locked.png',
    mute: '../images/mute.png',
    hide: '../images/hide.png',
    users: '../images/participants.png',
    user: '../images/participant.png',
    username: '../images/user.png',
    videoShare: '../images/video-share.png',
    message: '../images/message.png',
    share: '../images/share.png',
    exit: '../images/exit.png',
    feedback: '../images/feedback.png',
    lobby: '../images/lobby.png',
};

const mediaType = {
    audio: 'audioType',
    video: 'videoType',
    camera: 'cameraType',
    screen: 'screenType',
    speaker: 'speakerType',
};

const LOCAL_STORAGE_DEVICES = {
    audio: {
        count: 0,
        index: 0,
        select: null,
    },
    speaker: {
        count: 0,
        index: 0,
        select: null,
    },
    video: {
        count: 0,
        index: 0,
        select: null,
    },
};

const DEVICES_COUNT = {
    audio: 0,
    speaker: 0,
    video: 0,
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
};

let recordedBlobs;
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
        peer_geo,
        peer_info,
        isAudioAllowed,
        isVideoAllowed,
        isScreenAllowed,
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
        this.peer_geo = peer_geo;
        this.peer_info = peer_info;

        this.isAudioAllowed = isAudioAllowed;
        this.isVideoAllowed = isVideoAllowed;
        this.isScreenAllowed = isScreenAllowed;
        this.producerTransport = null;
        this.consumerTransport = null;
        this.device = null;

        this.isMobileDevice = DetectRTC.isMobileDevice;

        this.isMySettingsOpen = false;

        this._isConnected = false;
        this.isVideoOnFullScreen = false;
        this.isVideoFullScreenSupported = peer_info.is_mobile_device && peer_info.os_name === 'iOS' ? false : true;
        this.isChatOpen = false;
        this.isChatEmojiOpen = false;
        this.showChatOnMessage = true;
        this.isChatBgTransparent = false;
        this.isVideoPinned = false;
        this.pinnedVideoPlayerId = null;
        this.camVideo = false;
        this.camera = 'user';
        this.videoQualitySelectedIndex = 0;

        this.chatMessages = [];
        this.leftMsgAvatar = null;
        this.rightMsgAvatar = null;

        this.localVideoStream = null;
        this.localScreenStream = null;
        this.localAudioStream = null;
        this.mediaRecorder = null;
        this.recScreenStream = null;
        this._isRecording = false;

        this.RoomPassword = null;

        // file transfer settings
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

        this.myVideoEl = null;
        this.myAudioEl = null;
        this.showPeerInfo = false;

        this.videoProducerId = null;
        this.audioProducerId = null;
        this.audioConsumers = new Map();

        this.consumers = new Map();
        this.producers = new Map();
        this.producerLabel = new Map();
        this.eventListeners = new Map();

        console.log('06 ----> Load Mediasoup Client v', mediasoupClient.version);
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
                    peer_geo: this.peer_geo,
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
                console.log('Create room error:', err);
            });
    }

    async join(data) {
        this.socket
            .request('join', data)
            .then(
                async function (room) {
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
        console.log('07.1 ----> Get Router Rtp Capabilities codecs: ', this.device.rtpCapabilities.codecs);
        await this.initTransports(this.device);
        this.startLocalMedia();
        this.socket.emit('getProducers');
    }

    async handleRoomInfo(room) {
        let peers = new Map(JSON.parse(room.peers));
        participantsCount = peers.size;
        isPresenter = participantsCount > 1 ? false : true;
        handleRules(isPresenter);
        adaptAspectRatio(participantsCount);
        for (let peer of Array.from(peers.keys()).filter((id) => id !== this.peer_id)) {
            let peer_info = peers.get(peer).peer_info;
            // console.log('07 ----> Remote Peer info', peer_info);
            if (!peer_info.peer_video) {
                await this.setVideoOff(peer_info, true);
            }
        }
        this.refreshParticipantsCount();
        console.log('06.2 Participants Count ---->', participantsCount);
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
                this.userLog('error', 'Browser not supported', 'center');
            }
            console.error('Browser not supported: ', error);
            this.userLog('error', 'Browser not supported: ' + error, 'center');
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
                if (participantsCount == 1) {
                    isPresenter = true;
                    handleRules(isPresenter);
                    console.log('I am alone in the room, got Presenter Rules');
                }
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
            'disconnect',
            function () {
                this.exit(true);
            }.bind(this),
        );
    }

    // ####################################################
    // START LOCAL AUDIO VIDEO MEDIA
    // ####################################################

    startLocalMedia() {
        let localStorageDevices = this.getLocalStorageDevices();
        console.log('08 ----> Get Local Storage Devices before', localStorageDevices);
        if (localStorageDevices) {
            microphoneSelect.selectedIndex = localStorageDevices.audio.index;
            speakerSelect.selectedIndex = localStorageDevices.speaker.index;
            videoSelect.selectedIndex = localStorageDevices.video.index;
            //
            if (DEVICES_COUNT.audio != localStorageDevices.audio.count) {
                console.log('08.1 ----> Audio devices seems changed, use default index 0');
                microphoneSelect.selectedIndex = 0;
                this.setLocalStorageDevices(mediaType.audio, microphoneSelect.selectedIndex, microphoneSelect.value);
            }
            if (DEVICES_COUNT.speaker != localStorageDevices.speaker.count) {
                console.log('08.2 ----> Speaker devices seems changed, use default index 0');
                speakerSelect.selectedIndex = 0;
                this.setLocalStorageDevices(mediaType.speaker, speakerSelect.selectedIndex, speakerSelect.value);
            }
            if (DEVICES_COUNT.video != localStorageDevices.video.count) {
                console.log('08.3 ----> Video devices seems changed, use default index 0');
                videoSelect.selectedIndex = 0;
                this.setLocalStorageDevices(mediaType.video, videoSelect.selectedIndex, videoSelect.value);
            }
            console.log('08.4 ----> Get Local Storage Devices after', this.getLocalStorageDevices());
        }
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
        // if (this.isScreenAllowed) {
        //     this.shareScreen();
        // }
    }

    // ####################################################
    // PRODUCER
    // ####################################################

    async produce(type, deviceId = null, swapCamera = false) {
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

        console.log(`Media contraints ${type}:`, mediaConstraints);
        let stream;
        try {
            stream = screen
                ? await navigator.mediaDevices.getDisplayMedia(mediaConstraints)
                : await navigator.mediaDevices.getUserMedia(mediaConstraints);

            console.log('Supported Constraints', navigator.mediaDevices.getSupportedConstraints());

            const track = audio ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];

            console.log(`${type} settings ->`, track.getSettings());

            const params = {
                track,
                appData: {
                    mediaType: type,
                },
            };

            if (!audio && !screen) {
                params.encodings = this.getEncoding();
                params.codecOptions = {
                    videoGoogleStartBitrate: 1000,
                };
            }

            producer = await this.producerTransport.produce(params);

            console.log('PRODUCER', producer);

            this.producers.set(producer.id, producer);

            let elem, au;
            if (!audio) {
                this.localVideoStream = stream;
                this.videoProducerId = producer.id;
                elem = await this.handleProducer(producer.id, type, stream);
                //if (!screen && !isEnumerateDevices) enumerateVideoDevices(stream);
            } else {
                this.localAudioStream = stream;
                this.audioProducerId = producer.id;
                au = await this.handleProducer(producer.id, type, stream);
                //if (!isEnumerateDevices) enumerateAudioDevices(stream);
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

            // if present produce the tab audio on screen share
            if (screen && stream.getAudioTracks()[0]) {
                this.produceScreenAudio(stream);
            }
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

    async produceScreenAudio(stream) {
        try {
            this.stopMyAudio();

            if (this.producerLabel.has(mediaType.audio)) {
                return console.log('Producer already exists for this type ' + mediaType.audio);
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
                this.closeProducer(mediaType.audio);
                this.startMyAudio();
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

            this.producerLabel.set(mediaType.audio, producerSa.id);
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

    getAudioConstraints(deviceId) {
        return {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100,
                deviceId: deviceId,
            },
            video: false,
        };
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
        const frameRate = {
            min: 5,
            ideal: 15,
            max: 30,
        };
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
                videoConstraints = {
                    audio: false,
                    video: {
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
        }
        this.videoQualitySelectedIndex = videoQuality.selectedIndex;
        return videoConstraints;
    }

    getScreenConstraints() {
        return {
            audio: true,
            video: {
                frameRate: {
                    ideal: 15,
                    max: 30,
                },
            },
        };
    }

    getEncoding() {
        return [
            {
                rid: 'r0',
                maxBitrate: 100000,
                scalabilityMode: 'S3T3',
            },
            {
                rid: 'r1',
                maxBitrate: 300000,
                scalabilityMode: 'S3T3',
            },
            {
                rid: 'r2',
                maxBitrate: 900000,
                scalabilityMode: 'S3T3',
            },
        ];
    }

    closeThenProduce(type, deviceId, swapCamera = false) {
        this.closeProducer(type);
        setTimeout(function () {
            rc.produce(type, deviceId, swapCamera);
        }, 1000);
    }

    async handleProducer(id, type, stream) {
        let elem, vb, vp, ts, d, p, i, au, fs, pm, pb, pn;
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
                p.innerHTML = this.peer_name + ' (me)';
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
                this.isVideoFullScreenSupported && this.handleFS(elem.id, fs.id);
                this.handleDD(elem.id, this.peer_id, true);
                this.handleTS(elem.id, ts.id);
                this.handlePN(elem.id, pn.id, d.id, isScreen);
                if (!isScreen) this.handleVP(elem.id, vp.id);
                this.popupPeerInfo(p.id, this.peer_info);
                this.checkPeerInfoStatus(this.peer_info);
                if (isScreen) pn.click();
                handleAspectRatio();
                if (!this.isMobileDevice) {
                    this.setTippy(pn.id, 'Toggle Pin', 'top-end');
                    this.setTippy(ts.id, 'Snapshot', 'top-end');
                    this.setTippy(vp.id, 'Toggle video privacy', 'top-end');
                    this.setTippy(au.id, 'Audio status', 'top-end');
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

    // ####################################################
    // CONSUMER
    // ####################################################

    async consume(producer_id, peer_name, peer_info, type) {
        //
        if (wbIsOpen && (!isRulesActive || isPresenter)) {
            console.log('Update whiteboard canvas to the participants in the room');
            wbCanvasToJson();
        }
        this.getConsumeStream(producer_id, peer_info.peer_id, type).then(
            function ({ consumer, stream, kind }) {
                console.log('CONSUMER', consumer);

                this.consumers.set(consumer.id, consumer);

                if (kind === 'video') {
                    if (isParticipantsListOpen) getRoomParticipants(true);
                }

                console.log('CONSUMER MEDIA TYPE ----> ' + type);

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
        const streamId = peer_id + (type == mediaType.screen ? '-screensharing' : '-mic-webcam');
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
        let elem, vb, d, p, i, cm, au, fs, ts, sf, sm, sv, ko, pb, pm, pv, pn;

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
                p.innerHTML = peer_name;
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
                BUTTONS.consumerVideo.fullScreenButton && this.isVideoFullScreenSupported && vb.appendChild(fs);
                if (!this.isMobileDevice) vb.appendChild(pn);
                d.appendChild(elem);
                d.appendChild(i);
                d.appendChild(p);
                d.appendChild(pm);
                d.appendChild(vb);
                this.videoMediaContainer.appendChild(d);
                this.attachMediaStream(elem, stream, type, 'Consumer');
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
                this.popupPeerInfo(p.id, peer_info);
                this.checkPeerInfoStatus(peer_info);
                if (!remoteIsScreen && remotePrivacyOn) this.setVideoPrivacyStatus(remotePeerId, remotePrivacyOn);
                if (remoteIsScreen) pn.click();
                this.sound('joined');
                handleAspectRatio();
                console.log('[addConsumer] Video-element-count', this.videoMediaContainer.childElementCount);
                if (!this.isMobileDevice) {
                    this.setTippy(pn.id, 'Toggle Pin', 'top-end');
                    this.setTippy(ts.id, 'Snapshot', 'top-end');
                    this.setTippy(sf.id, 'Send file', 'top-end');
                    this.setTippy(sm.id, 'Send message', 'top-end');
                    this.setTippy(sv.id, 'Send video', 'top-end');
                    this.setTippy(cm.id, 'Hide', 'top-end');
                    this.setTippy(au.id, 'Mute', 'top-end');
                    this.setTippy(pv.id, '🔊 Volume', 'top-end');
                    this.setTippy(ko.id, 'Eject', 'top-end');
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
        i.className = 'center pulsate';
        i.id = peer_id + '__img';
        p = document.createElement('p');
        p.id = peer_id + '__name';
        p.className = html.userName;
        p.innerHTML = peer_name + (remotePeer ? '' : ' (me) ');
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
            this.setTippy(sm.id, 'Send message', 'top-end');
            this.setTippy(sf.id, 'Send file', 'top-end');
            this.setTippy(sv.id, 'Send video', 'top-end');
            this.setTippy(au.id, 'Mute', 'top-end');
            this.setTippy(pv.id, '🔊 Volume', 'top-end');
            this.setTippy(ko.id, 'Eject', 'top-end');
        }
        console.log('[setVideoOff] Video-element-count', this.videoMediaContainer.childElementCount);
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
                showClass: {
                    popup: 'animate__animated animate__fadeInDown',
                },
                hideClass: {
                    popup: 'animate__animated animate__fadeOutUp',
                },
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
            this.consumerTransport.close();
            this.producerTransport.close();
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
                    }.bind(this),
                );
        } else {
            clean();
        }
        this.event(_EVENTS.exitRoom);
    }

    exitRoom() {
        this.sound('eject');
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
                    this.userLog('error', errorMessage, 'top-end');
                    speakerSelect.selectedIndex = 0;
                    this.setLocalStorageDevices(mediaType.speaker, 0, speakerSelect.value);
                });
        } else {
            let error = `Browser seems doesn't support output device selection.`;
            console.warn(error);
            this.userLog('error', error, 'top-end');
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
        tippy(this.getId(elem), {
            content: content,
            placement: placement,
            allowHTML: allowHTML,
        });
    }

    setVideoAvatarImgName(elemId, peer_name) {
        let elem = this.getId(elemId);
        if (cfg.useAvatarApi) {
            let avatarImgSize = 250;
            elem.setAttribute(
                'src',
                cfg.msgAvatar + '?name=' + peer_name + '&size=' + avatarImgSize + '&background=random&rounded=true',
            );
        } else {
            elem.setAttribute('src', image.avatar);
        }
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

    // ####################################################
    // UTILITY
    // ####################################################

    async sound(name) {
        if (!isSoundEnabled) return;
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
                    showClass: {
                        popup: 'animate__animated animate__fadeInDown',
                    },
                    hideClass: {
                        popup: 'animate__animated animate__fadeOutUp',
                    },
                });
                break;
            // ......
            default:
                alert(message);
        }
    }

    thereIsParticipants() {
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
            this.setTippy(fsId, 'Full screen', 'top');
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
        isVideoControlsOn = value == 'On' ? true : false;
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
                this.sound('click');
                this.isVideoPinned = !this.isVideoPinned;
                if (this.isVideoPinned) {
                    if (!videoPlayer.classList.contains('videoCircle')) {
                        videoPlayer.style.objectFit = 'contain';
                    }
                    cam.className = '';
                    cam.style.width = '100%';
                    cam.style.height = '100%';
                    this.togglePin(pinVideoPosition.value);
                    this.videoPinMediaContainer.appendChild(cam);
                    this.videoPinMediaContainer.style.display = 'block';
                    this.pinnedVideoPlayerId = elemId;
                    setColor(btnPn, 'lime');
                } else {
                    if (this.pinnedVideoPlayerId != videoPlayer.id) {
                        this.isVideoPinned = true;
                        return this.msgPopup('info', 'Another video seems pinned, unpin it before to pin this one');
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

    togglePin(position) {
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
        }
        resizeVideoMedia();
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
                this.emitCmd(`privacy|${this.peer_id}|${isVideoPrivacyActive}`);
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
            chatRoom.style.top = '50%';
            chatRoom.style.left = '50%';
            this.sound('open');
            this.isChatOpen = true;
        } else {
            chatRoom.style.display = 'none';
            this.isChatOpen = false;
        }
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
        if (!this.thereIsParticipants()) {
            this.cleanMessage();
            isChatPasteTxt = false;
            return this.userLog('info', 'No participants in the room', 'top-end');
        }
        let peer_msg = this.formatMsg(chatMessage.value.trim());
        if (!peer_msg) {
            return this.cleanMessage();
        }
        let data = {
            peer_name: this.peer_name,
            peer_id: this.peer_id,
            to_peer_id: 'all',
            peer_msg: peer_msg,
        };
        console.log('Send message:', data);
        this.socket.emit('message', data);
        this.setMsgAvatar('right', this.peer_name);
        this.appendMessage('right', this.rightMsgAvatar, this.peer_name, this.peer_id, peer_msg, 'all', 'all');
        this.cleanMessage();
    }

    sendMessageTo(to_peer_id, to_peer_name) {
        if (!this.thereIsParticipants()) {
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
            showClass: {
                popup: 'animate__animated animate__fadeInDown',
            },
            hideClass: {
                popup: 'animate__animated animate__fadeOutUp',
            },
        }).then((result) => {
            if (result.value) {
                let peer_msg = this.formatMsg(result.value.trim());
                if (!peer_msg) {
                    return this.cleanMessage();
                }
                let data = {
                    peer_name: this.peer_name,
                    peer_id: this.peer_id,
                    to_peer_id: to_peer_id,
                    to_peer_name: to_peer_name,
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
                    to_peer_name,
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
        this.sound('message');
    }

    setMsgAvatar(avatar, peerName) {
        let avatarImg = cfg.msgAvatar + '?name=' + peerName + '&size=32' + '&background=random&rounded=true';
        avatar === 'left' ? (this.leftMsgAvatar = avatarImg) : (this.rightMsgAvatar = avatarImg);
    }

    appendMessage(side, img, fromName, fromId, msg, toId, toName) {
        let time = this.getTimeNow();
        let msgBubble = toId == 'all' ? 'msg-bubble' : 'msg-bubble-private';
        let replyMsg = fromId === this.peer_id ? `<hr/>Private message to ${toName}` : '';
        let message = toId == 'all' ? msg : msg + replyMsg;
        let msgHTML = `
        <div id="msg-${chatMessagesId}" class="msg ${side}-msg">
            <div class="msg-img" style="background-image: url('${img}')"></div>
            <div class=${msgBubble}>
                <div class="msg-info">
                    <div class="msg-info-name">${fromName}</div>
                    <div class="msg-info-time">${time}</div>
                </div>
                <div id="${chatMessagesId}" class="msg-text">${message}
                    <hr/>`;
        // add btn direct reply to private message
        if (fromId != this.peer_id) {
            msgHTML += `
                    <button 
                        class="fas fa-paper-plane"
                        id="msg-private-reply-${chatMessagesId}"
                        onclick="rc.sendMessageTo('${fromId}','${fromName}')"
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
                    ></button>
                </div>
            </div>
        </div>
        `;
        this.collectMessages(time, fromName, msg);
        chatMsger.insertAdjacentHTML('beforeend', msgHTML);
        chatMsger.scrollTop += 500;
        this.setTippy('msg-delete-' + chatMessagesId, 'Delete', 'top');
        this.setTippy('msg-copy-' + chatMessagesId, 'Copy', 'top');
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
            showClass: {
                popup: 'animate__animated animate__fadeInDown',
            },
            hideClass: {
                popup: 'animate__animated animate__fadeOutUp',
            },
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
                this.userLog('error', err, 'top-end', 2000);
            });
    }

    formatMsg(message) {
        if (message.trim().length == 0) return;
        if (this.isHtml(message)) return this.sanitizeHtml(message);
        if (this.isValidHttpURL(message)) {
            if (isImageURL(message)) return '<img src="' + message + '" alt="img" width="180" height="auto"/>';
            if (this.isVideoTypeSupported(message)) return this.getIframe(message);
            return '<a href="' + message + '" target="_blank" class="msg-a">' + message + '</a>';
        }
        if (isChatMarkdownOn) return marked.parse(message);
        let pre = '<pre>' + message + '</pre>';
        if (isChatPasteTxt) {
            isChatPasteTxt = false;
            return pre;
        }
        if (this.getLineBreaks(message) > 1) {
            return pre;
        }
        return message;
    }

    sanitizeHtml(str) {
        const tagsToReplace = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
        const replaceTag = (tag) => tagsToReplace[tag] || tag;
        const safe_tags_replace = (str) => str.replace(/[&<>]/g, replaceTag);
        return safe_tags_replace(str);
    }

    isHtml(str) {
        var a = document.createElement('div');
        a.innerHTML = str;
        for (var c = a.childNodes, i = c.length; i--; ) {
            if (c[i].nodeType == 1) return true;
        }
        return false;
    }

    isValidHttpURL(str) {
        let url;
        try {
            url = new URL(str);
        } catch (_) {
            return false;
        }
        return url.protocol === 'http:' || url.protocol === 'https:';
    }

    getIframe(url) {
        let is_youtube = this.getVideoType(url) == 'na' ? true : false;
        let video_audio_url = is_youtube ? this.getYoutubeEmbed(url) : url;
        return `
        <iframe
            title="Chat-IFrame"
            src="${video_audio_url}"
            width="auto"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
        ></iframe>`;
    }

    getLineBreaks(message) {
        return (message.match(/\n/g) || []).length;
    }

    checkLineBreaks() {
        chatMessage.style.height = '';
        if (this.getLineBreaks(chatMessage.value) > 0) {
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

    chatToggleBg() {
        this.isChatBgTransparent = !this.isChatBgTransparent;
        if (this.isChatBgTransparent) {
            document.documentElement.style.setProperty('--msger-bg', 'rgba(0, 0, 0, 0.100)');
        } else {
            setTheme(currentTheme);
        }
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
            showClass: {
                popup: 'animate__animated animate__fadeInDown',
            },
            hideClass: {
                popup: 'animate__animated animate__fadeOutUp',
            },
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

        const newDate = new Date();
        const date = newDate.toISOString().split('T')[0];
        const time = newDate.toTimeString().split(' ')[0];

        let a = document.createElement('a');
        a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.chatMessages, null, 1));
        a.download = `${date}-${time}` + '-CHAT.txt';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);

        this.sound('download');
    }

    // ####################################################
    // RECORDING
    // ####################################################

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
        let options = this.getSupportedMimeTypes();
        console.log('MediaRecorder supported options', options);
        options = { mimeType: options[0] };
        try {
            if (this.isMobileDevice) {
                // on mobile devices recording camera + audio
                let newStream = this.getNewStream(this.localVideoStream, this.localAudioStream);
                this.mediaRecorder = new MediaRecorder(newStream, options);
                console.log('Created MediaRecorder', this.mediaRecorder, 'with options', options);
                this.getId('swapCameraButton').className = 'hidden';
                this._isRecording = true;
                this.handleMediaRecorder();
                this.event(_EVENTS.startRec);
                this.sound('recStart');
            } else {
                // on desktop devices recording screen/window... + audio
                const constraints = { video: true };
                navigator.mediaDevices
                    .getDisplayMedia(constraints)
                    .then((screenStream) => {
                        this.recScreenStream = this.getNewStream(screenStream, this.localAudioStream);
                        this.mediaRecorder = new MediaRecorder(this.recScreenStream, options);
                        console.log('Created MediaRecorder', this.mediaRecorder, 'with options', options);
                        this._isRecording = true;
                        this.handleMediaRecorder();
                        this.event(_EVENTS.startRec);
                        this.sound('recStart');
                    })
                    .catch((err) => {
                        console.error('Error Unable to recording the screen + audio', err);
                        this.userLog('error', 'Unable to recording the screen + audio reason: ' + err, 'top-end');
                    });
            }
        } catch (err) {
            console.error('Exception while creating MediaRecorder: ', err);
            return this.userLog('error', "Can't start stream recording reason: " + err, 'top-end');
        }
    }

    getNewStream(videoStream, audioStream) {
        let newStream = null;
        let videoStreamTrack = videoStream ? videoStream.getVideoTracks()[0] : undefined;
        let audioStreamTrack = audioStream ? audioStream.getAudioTracks()[0] : undefined;
        if (videoStreamTrack && audioStreamTrack) {
            newStream = new MediaStream([videoStreamTrack, audioStreamTrack]);
        } else if (videoStreamTrack) {
            newStream = new MediaStream([videoStreamTrack]);
        } else if (audioStreamTrack) {
            newStream = new MediaStream([audioStreamTrack]);
        }
        return newStream;
    }

    handleMediaRecorder() {
        this.mediaRecorder.start();
        this.mediaRecorder.addEventListener('start', this.handleMediaRecorderStart);
        this.mediaRecorder.addEventListener('dataavailable', this.handleMediaRecorderData);
        this.mediaRecorder.addEventListener('stop', this.handleMediaRecorderStop);
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

            const newDate = new Date();
            const date = newDate.toISOString().split('T')[0];
            const time = newDate.toTimeString().split(' ')[0];

            const type = recordedBlobs[0].type.includes('mp4') ? 'mp4' : 'webm';
            const blob = new Blob(recordedBlobs, { type: 'video/' + type });
            const recFileName = `${date}-${time}` + '-REC.' + type;

            console.log('MediaRecorder Download Blobs');
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = recFileName;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }, 100);
            console.log(`🔴 Recording FILE: ${recFileName} done 👍`);
        } catch (ex) {
            console.warn('Recording save failed', ex);
        }
    }

    pauseRecording() {
        this._isRecording = false;
        this.mediaRecorder.pause();
        this.event(_EVENTS.pauseRec);
    }

    resumeRecording() {
        this._isRecording = true;
        this.mediaRecorder.resume();
        this.event(_EVENTS.resumeRec);
    }

    stopRecording() {
        this._isRecording = false;
        this.mediaRecorder.stop();
        if (this.recScreenStream) {
            this.recScreenStream.getTracks().forEach((track) => {
                if (track.kind === 'video') track.stop();
            });
        }
        if (this.isMobileDevice) this.getId('swapCameraButton').className = '';
        this.getId('recordingStatus').innerHTML = '🔴 REC 0s';
        this.event(_EVENTS.stopRec);
        this.sound('recStop');
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
            showClass: {
                popup: 'animate__animated animate__fadeInDown',
            },
            hideClass: {
                popup: 'animate__animated animate__fadeOutUp',
            },
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
            if (!this.thereIsParticipants()) {
                return userLog('info', 'No participants detected', 'top-end');
            }
            let fileInfo = {
                peer_id: peer_id,
                broadcast: broadcast,
                peer_name: this.peer_name,
                fileName: this.fileToSend.name,
                fileSize: this.fileToSend.size,
                fileType: this.fileToSend.type,
            };
            this.appendMessage(
                'right',
                this.rightMsgAvatar,
                this.peer_name,
                this.peer_id,
                'Send File: \n' + this.toHtmlJson(fileInfo),
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
        this.appendMessage(
            'left',
            this.leftMsgAvatar,
            this.incomingFileInfo.peer_name,
            this.incomingFileInfo.peer_id,
            'Receive File: \n' + this.toHtmlJson(this.incomingFileInfo),
            'all',
            'all',
        );
        receiveFileInfo.innerHTML = fileToReceiveInfo;
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

        sendFileInfo.innerHTML =
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
            sendFilePercentage.innerHTML = 'Send progress: ' + ((offset / this.fileToSend.size) * 100).toFixed(2) + '%';

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
        receiveFilePercentage.innerHTML =
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
                    showClass: {
                        popup: 'animate__animated animate__fadeInDown',
                    },
                    hideClass: {
                        popup: 'animate__animated animate__fadeOutUp',
                    },
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
                showClass: {
                    popup: 'animate__animated animate__fadeInDown',
                },
                hideClass: {
                    popup: 'animate__animated animate__fadeOutUp',
                },
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
            showClass: {
                popup: 'animate__animated animate__fadeInDown',
            },
            hideClass: {
                popup: 'animate__animated animate__fadeOutUp',
            },
        }).then((result) => {
            if (result.value) {
                if (!this.thereIsParticipants()) {
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
                    this.userLog('error', 'Not valid video URL', 'top-end');
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
            this.setTippy(pn.id, 'Toggle Pin video player', 'top-end');
            this.setTippy(e.id, 'Close video player', 'top-end');
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

    roomAction(action, emit = true) {
        let data = {
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
                                async function (data) {
                                    // Only the presenter can lock the room
                                    if (isPresenter || data.peerCounts == 1) {
                                        isPresenter = true;
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
                            showClass: {
                                popup: 'animate__animated animate__fadeInDown',
                            },
                            hideClass: {
                                popup: 'animate__animated animate__fadeOutUp',
                            },
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
                    this.roomStatus(action);
                    break;
                case 'lobbyOff':
                    this.socket.emit('roomAction', data);
                    this.roomStatus(action);
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
                this.userLog('info', '🔒 LOCKED the room by the password', 'top-end');
                break;
            case 'unlock':
                this.event(_EVENTS.roomUnlock);
                this.userLog('info', '🔓 UNLOCKED the room', 'top-end');
                break;
            case 'lobbyOn':
                this.event(_EVENTS.lobbyOn);
                this.userLog('info', '⌛ Lobby is enabled', 'top-end');
                break;
            case 'lobbyOff':
                this.event(_EVENTS.lobbyOff);
                this.userLog('info', '⌛ Lobby is disabled', 'top-end');
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
        }
    }

    // ####################################################
    // ROOM LOBBY
    // ####################################################

    roomLobby(data) {
        switch (data.lobby_status) {
            case 'waiting':
                if (!isRulesActive || isPresenter) {
                    let lobbyTr = '';
                    let peer_id = data.peer_id;
                    let peer_name = data.peer_name;
                    let avatarImg = getParticipantAvatar(peer_name);
                    let lobbyTb = this.getId('lobbyTb');
                    let lobbyAccept = _PEER.acceptPeer;
                    let lobbyReject = _PEER.ejectPeer;
                    let lobbyAcceptId = `${peer_name}___${peer_id}___lobbyAccept`;
                    let lobbyRejectId = `${peer_name}___${peer_id}___lobbyReject`;

                    lobbyTr += `
                    <tr id='${peer_id}'>
                        <td><img src='${avatarImg}'></td>
                        <td>${peer_name}</td>
                        <td><button id=${lobbyAcceptId} onclick="rc.lobbyAction(this.id, 'accept')">${lobbyAccept}</button></td>
                        <td><button id=${lobbyRejectId} onclick="rc.lobbyAction(this.id, 'reject')">${lobbyReject}</button></td>
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
                    showClass: {
                        popup: 'animate__animated animate__fadeInDown',
                    },
                    hideClass: {
                        popup: 'animate__animated animate__fadeOutUp',
                    },
                }).then((result) => {
                    if (result.isConfirmed) {
                        this.exit();
                    }
                });
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
                showClass: {
                    popup: 'animate__animated animate__fadeInDown',
                },
                hideClass: {
                    popup: 'animate__animated animate__fadeOutUp',
                },
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
            showClass: {
                popup: 'animate__animated animate__fadeInDown',
            },
            hideClass: {
                popup: 'animate__animated animate__fadeOutUp',
            },
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
            showClass: {
                popup: 'animate__animated animate__fadeInDown',
            },
            hideClass: {
                popup: 'animate__animated animate__fadeOutUp',
            },
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
        }, 2000);
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

    emitCmd(data) {
        this.socket.emit('cmd', data);
    }

    handleCmd(data) {
        // cmd|foo|bar|....
        const words = data.split('|');
        let cmd = words[0];
        switch (cmd) {
            case 'privacy':
                this.setVideoPrivacyStatus(words[1], words[2] == 'true');
                break;
            //...
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
                peer_id: peer_id,
                action: action,
                broadcast: broadcast,
            };

            if (!this.thereIsParticipants()) {
                if (info) return this.userLog('info', 'No participants detected', 'top-end');
            }
            this.confirmPeerAction(action, data);
        } else {
            switch (action) {
                case 'eject':
                    if (peer_id === this.peer_id || broadcast) {
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
                    showClass: {
                        popup: 'animate__animated animate__fadeInDown',
                    },
                    hideClass: {
                        popup: 'animate__animated animate__fadeOutUp',
                    },
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
                let muteHideConfirmed = false;
                let whoMuteHide = data.broadcast ? 'everyone except yourself?' : 'current participant?';
                Swal.fire({
                    background: swalBackground,
                    position: 'center',
                    imageUrl: action == 'mute' ? image.mute : image.hide,
                    title: action == 'mute' ? 'Mute ' + whoMuteHide : 'Hide ' + whoMuteHide,
                    text:
                        action == 'mute'
                            ? "Once muted, you won't be able to unmute them, but they can unmute themselves at any time."
                            : "Once hided, you won't be able to unhide them, but they can unhide themselves at any time.",
                    showDenyButton: true,
                    confirmButtonText: `Yes`,
                    denyButtonText: `No`,
                    showClass: {
                        popup: 'animate__animated animate__fadeInDown',
                    },
                    hideClass: {
                        popup: 'animate__animated animate__fadeOutUp',
                    },
                })
                    .then((result) => {
                        if (result.isConfirmed) {
                            muteHideConfirmed = true;
                            if (!data.broadcast) {
                                this.socket.emit('peerAction', data);
                                switch (action) {
                                    case 'mute':
                                        let peerAudioButton = this.getId(data.peer_id + '___pAudio');
                                        if (peerAudioButton) peerAudioButton.innerHTML = _PEER.audioOff;
                                        break;
                                    case 'hide':
                                        let peerVideoButton = this.getId(data.peer_id + '___pVideo');
                                        if (peerVideoButton) peerVideoButton.innerHTML = _PEER.videoOff;
                                }
                            } else {
                                this.socket.emit('peerAction', data);
                                let actionButton = this.getId(action + 'AllButton');
                                if (actionButton) actionButton.style.display = 'none';
                            }
                        }
                    })
                    .then(() => {
                        if (muteHideConfirmed) this.peerActionProgress(action, 'In progress, wait...', 2000, 'refresh');
                    });
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
                            'peer_id',
                            'peer_name',
                            'peer_audio',
                            'peer_video',
                            'peer_screen',
                            'peer_hand',
                            'is_desktop_device',
                            'is_mobile_device',
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
    // LOCAL STORAGE DEVICES
    // ####################################################

    setLocalStorageDevices(type, index, select) {
        switch (type) {
            case RoomClient.mediaType.audio:
                LOCAL_STORAGE_DEVICES.audio.count = DEVICES_COUNT.audio;
                LOCAL_STORAGE_DEVICES.audio.index = index;
                LOCAL_STORAGE_DEVICES.audio.select = select;
                break;
            case RoomClient.mediaType.video:
                LOCAL_STORAGE_DEVICES.video.count = DEVICES_COUNT.video;
                LOCAL_STORAGE_DEVICES.video.index = index;
                LOCAL_STORAGE_DEVICES.video.select = select;
                break;
            case RoomClient.mediaType.speaker:
                LOCAL_STORAGE_DEVICES.speaker.count = DEVICES_COUNT.speaker;
                LOCAL_STORAGE_DEVICES.speaker.index = index;
                LOCAL_STORAGE_DEVICES.speaker.select = select;
                break;
        }
        localStorage.setItem('LOCAL_STORAGE_DEVICES', JSON.stringify(LOCAL_STORAGE_DEVICES));
    }

    getLocalStorageDevices() {
        return JSON.parse(localStorage.getItem('LOCAL_STORAGE_DEVICES'));
    }
}
