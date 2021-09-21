'use strict';

const cfg = {
    msgAvatar: 'https://eu.ui-avatars.com/api',
};

const html = {
    newline: '<br />',
};

const image = {
    poster: '../images/loader.gif',
    delete: '../images/delete.png',
    locked: '../images/locked.png',
    mute: '../images/mute.png',
    hide: '../images/hide.png',
};

const mediaType = {
    audio: 'audioType',
    video: 'videoType',
    camera: 'cameraType',
    screen: 'screenType',
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
    roomUnlock: 'roomUnlock',
};

let recordedBlobs;

class RoomClient {
    constructor(
        remoteAudioEl,
        videoMediaContainer,
        mediasoupClient,
        socket,
        room_id,
        peer_name,
        peer_geo,
        peer_info,
        isAudioAllowed,
        isVideoAllowed,
        isAudioOn,
        isVideoOn,
        successCallback,
    ) {
        this.remoteAudioEl = remoteAudioEl;
        this.videoMediaContainer = videoMediaContainer;
        this.mediasoupClient = mediasoupClient;

        this.socket = socket;
        this.room_id = room_id;
        this.peer_id = socket.id;
        this.peer_name = peer_name;
        this.peer_geo = peer_geo;
        this.peer_info = peer_info;

        this.isAudioAllowed = isAudioAllowed;
        this.isVideoAllowed = isVideoAllowed;
        this.isAudioOn = isAudioOn;
        this.isVideoOn = isVideoOn;
        this.producerTransport = null;
        this.consumerTransport = null;
        this.device = null;

        this.isMobileDevice = DetectRTC.isMobileDevice;

        this._isConnected = false;
        this.isVideoOnFullScreen = false;
        this.isDocumentOnFullScreen = false;
        this.isChatOpen = false;
        this.camVideo = false;
        this.camera = 'user';

        this.chatMessages = [];
        this.leftMsgAvatar = null;
        this.rightMsgAvatar = null;

        this.localVideoStream = null;
        this.localScreenStream = null;
        this.localAudioStream = null;
        this.mediaRecorder = null;
        this.recScreenStream = null;
        this._isRecording = false;

        this.myVideoEl = null;
        this.connectedRoom = null;
        this.debug = false;

        this.consumers = new Map();
        this.producers = new Map();
        this.producerLabel = new Map();
        this.eventListeners = new Map();

        console.log('06 ----> Load Mediasoup Client v', mediasoupClient.version);

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
        socket
            .request('join', data)
            .then(
                async function (room) {
                    if (room === 'isLocked') {
                        this.roomIsLocked();
                        return;
                    }
                    this.connectedRoom = room;
                    console.log('07 ----> Joined to room', this.connectedRoom);
                    const data = await this.socket.request('getRouterRtpCapabilities');
                    this.device = await this.loadDevice(data);
                    console.log('08 ----> Get Router Rtp Capabilities codecs: ', this.device.rtpCapabilities.codecs);
                    await this.initTransports(this.device);
                    this.startLocalMedia();
                    this.socket.emit('getProducers');
                }.bind(this),
            )
            .catch((err) => {
                console.log('Join error:', err);
            });
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
                console.error('Create WebRtc Transport for Producer err: ', data.error);
                return;
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
                async function ({ kind, rtpParameters }, callback, errback) {
                    try {
                        const { producer_id } = await this.socket.request('produce', {
                            producerTransportId: this.producerTransport.id,
                            kind,
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
                console.error('Create WebRtc Transport for Consumer err: ', data.error);
                return;
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
            function ({ consumer_id }) {
                console.log('Closing consumer:', consumer_id);
                this.removeConsumer(consumer_id);
            }.bind(this),
        );

        this.socket.on(
            'newProducers',
            async function (data) {
                if (data.length > 0) {
                    console.log('New producers', data);
                    for (let { producer_id, peer_name, peer_info } of data) {
                        await this.consume(producer_id, peer_name, peer_info);
                    }
                }
            }.bind(this),
        );

        this.socket.on(
            'message',
            function (data) {
                console.log('Message', data);
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
        if (this.isAudioAllowed && this.isAudioOn) {
            console.log('09 ----> Start audio media');
            this.produce(mediaType.audio, microphoneSelect.value);
        }
        if (this.isVideoAllowed && this.isVideoOn) {
            console.log('10 ----> Start video media');
            this.produce(mediaType.video, videoSelect.value);
        }
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
                mediaConstraints = this.getAudioConstraints(deviceId);
                audio = true;
                break;
            case mediaType.video:
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
            console.error('Cannot produce video');
            return;
        }
        if (this.producerLabel.has(type)) {
            console.log('Producer already exists for this type ' + type);
            return;
        }
        console.log(`Media contraints ${type}:`, mediaConstraints);
        let stream;
        try {
            stream = screen
                ? await navigator.mediaDevices.getDisplayMedia()
                : await navigator.mediaDevices.getUserMedia(mediaConstraints);
            console.log('Supported Constraints', navigator.mediaDevices.getSupportedConstraints());

            const track = audio ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
            const params = {
                track,
            };

            if (!audio && !screen) {
                params.encodings = this.getEncoding();
                params.codecOptions = {
                    videoGoogleStartBitrate: 1000,
                };
            }
            producer = await this.producerTransport.produce(params);

            console.log('Producer', producer);

            this.producers.set(producer.id, producer);

            let elem;
            if (!audio) {
                this.localVideoStream = stream;
                elem = await this.handleProducer(producer.id, type, stream);
            } else {
                this.localAudioStream = stream;
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

                    resizeVideoMedia();
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

                    resizeVideoMedia();
                }
                this.producers.delete(producer.id);
            });

            this.producerLabel.set(type, producer.id);

            switch (type) {
                case mediaType.audio:
                    this.event(_EVENTS.startAudio);
                    break;
                case mediaType.video:
                    this.event(_EVENTS.startVideo);
                    break;
                case mediaType.screen:
                    this.event(_EVENTS.startScreen);
                    break;
                default:
                    return;
            }
        } catch (err) {
            console.log('Produce error:', err);
        }
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
        return {
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
                frameRate: 15, // 15fps
            },
        };
    }

    getScreenConstraints() {
        return {
            video: {
                frameRate: {
                    min: 5,
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
                scalabilityMode: 'S1T3',
            },
            {
                rid: 'r1',
                maxBitrate: 300000,
                scalabilityMode: 'S1T3',
            },
            {
                rid: 'r2',
                maxBitrate: 900000,
                scalabilityMode: 'S1T3',
            },
        ];
    }

    closeThenProduce(type, deviceId, swapCamera = false) {
        this.closeProducer(type);
        this.produce(type, deviceId, swapCamera);
    }

    async handleProducer(id, type, stream) {
        let elem, d, p, i;
        d = document.createElement('div');
        d.className = 'Camera';
        d.id = id + '__d';
        elem = document.createElement('video');
        elem.setAttribute('id', id);
        elem.setAttribute('playsinline', true);
        elem.autoplay = true;
        elem.poster = image.poster;
        this.isMobileDevice || type === mediaType.screen ? (elem.className = '') : (elem.className = 'mirror');
        p = document.createElement('p');
        p.id = this.peer_id + '__name';
        p.innerHTML = '👤 ' + this.peer_name + ' (me)';
        i = document.createElement('i');
        i.id = this.peer_id + '__peerHand';
        i.className = 'fas fa-hand-paper pulsate';
        d.appendChild(elem);
        d.appendChild(p);
        d.appendChild(i);
        this.videoMediaContainer.appendChild(d);
        this.attachMediaStream(elem, stream, type, 'Producer');
        this.myVideoEl = elem;
        this.handleFS(elem.id);
        this.setTippy(elem.id, 'Full Screen', 'top-end');
        this.popupPeerInfo(p.id, this.peer_info);
        this.checkPeerInfoStatus(this.peer_info);
        this.sound('joined');
        resizeVideoMedia();
        return elem;
    }

    pauseProducer(type) {
        if (!this.producerLabel.has(type)) {
            console.log('There is no producer for this type ' + type);
            return;
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
            console.log('There is no producer for this type ' + type);
            return;
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
            console.log('There is no producer for this type ' + type);
            return;
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
            let d = this.getId(producer_id + '__d');
            elem.srcObject.getTracks().forEach(function (track) {
                track.stop();
            });
            d.parentNode.removeChild(d);

            resizeVideoMedia();
        }

        switch (type) {
            case mediaType.audio:
                this.event(_EVENTS.stopAudio);
                break;
            case mediaType.video:
                this.event(_EVENTS.stopVideo);
                break;
            case mediaType.screen:
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

    async consume(producer_id, peer_name, peer_info) {
        this.getConsumeStream(producer_id).then(
            function ({ consumer, stream, kind }) {
                this.consumers.set(consumer.id, consumer);

                if (kind === 'video') {
                    this.handleConsumer(consumer.id, mediaType.video, stream, peer_name, peer_info);
                } else {
                    this.handleConsumer(consumer.id, mediaType.audio, stream, peer_name, peer_info);
                }

                consumer.on(
                    'trackended',
                    function () {
                        this.removeConsumer(consumer.id);
                    }.bind(this),
                );

                consumer.on(
                    'transportclose',
                    function () {
                        this.removeConsumer(consumer.id);
                    }.bind(this),
                );
            }.bind(this),
        );
    }

    async getConsumeStream(producerId) {
        const { rtpCapabilities } = this.device;
        const data = await this.socket.request('consume', {
            rtpCapabilities,
            consumerTransportId: this.consumerTransport.id,
            producerId,
        });
        const { id, kind, rtpParameters } = data;
        const codecOptions = {};
        const consumer = await this.consumerTransport.consume({
            id,
            producerId,
            kind,
            rtpParameters,
            codecOptions,
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
        let elem, d, p, i;
        switch (type) {
            case mediaType.video:
                d = document.createElement('div');
                d.className = 'Camera';
                d.id = id + '__d';
                elem = document.createElement('video');
                elem.setAttribute('id', id);
                elem.setAttribute('playsinline', true);
                elem.autoplay = true;
                elem.className = '';
                elem.poster = image.poster;
                p = document.createElement('p');
                p.id = peer_info.peer_id + '__name';
                p.innerHTML = '👤 ' + peer_name;
                i = document.createElement('i');
                i.id = peer_info.peer_id + '__peerHand';
                i.className = 'fas fa-hand-paper pulsate';
                d.appendChild(elem);
                d.appendChild(p);
                d.appendChild(i);
                this.videoMediaContainer.appendChild(d);
                this.attachMediaStream(elem, stream, type, 'Consumer');
                this.handleFS(elem.id);
                this.setTippy(elem.id, 'Full Screen', 'top-end');
                this.popupPeerInfo(p.id, peer_info);
                this.checkPeerInfoStatus(peer_info);
                this.sound('joined');
                resizeVideoMedia();
                break;
            case mediaType.audio:
                elem = document.createElement('audio');
                elem.id = id;
                elem.autoplay = true;
                this.remoteAudioEl.appendChild(elem);
                this.attachMediaStream(elem, stream, type, 'Consumer');
                break;
        }
        return elem;
    }

    removeConsumer(consumer_id) {
        let elem = this.getId(consumer_id);
        let d = this.getId(consumer_id + '__d');

        elem.srcObject.getTracks().forEach(function (track) {
            track.stop();
        });

        if (elem) elem.parentNode.removeChild(elem);
        if (d) d.parentNode.removeChild(d);

        resizeVideoMedia();

        this.consumers.delete(consumer_id);
        this.sound('left');
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
        const newStream = new MediaStream();
        newStream.addTrack(track);
        elem.srcObject = newStream;
        console.log(who + ' Success attached media ' + type);
    }

    attachSinkId(elem, sinkId) {
        if (typeof elem.sinkId !== 'undefined') {
            elem.setSinkId(sinkId)
                .then(() => {
                    console.log(`Success, audio output device attached: ${sinkId}`);
                })
                .catch((err) => {
                    let errorMessage = err;
                    if (err.name === 'SecurityError')
                        errorMessage = `You need to use HTTPS for selecting audio output device: ${err}`;
                    console.error('Attach SinkId error: ', errorMessage);
                    this.userLog('error', errorMessage, 'top-end');
                    this.getId('speakerSelect').selectedIndex = 0;
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

    setTippy(elem, content, placement) {
        if (DetectRTC.isMobileDevice) return;
        tippy(this.getId(elem), {
            content: content,
            placement: placement,
        });
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

    async getRoomInfo() {
        let room_info = await this.socket.request('getRoomInfo');
        return room_info;
    }

    // ####################################################
    // UTILITY
    // ####################################################

    toggleDevices() {
        this.getId('settings').classList.toggle('show');
    }

    async sound(name) {
        let sound = '../sounds/' + name + '.wav';
        let audio = new Audio(sound);
        try {
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
        });
        Toast.fire({
            icon: icon,
            title: message,
        });
    }

    thereIsConsumers() {
        if (this.consumers.size > 0) {
            return true;
        }
        this.userLog('info', 'No participants in the room', 'top-end');
        return false;
    }

    // ####################################################
    // FULL SCREEN
    // ####################################################

    toggleFullScreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
            this.isDocumentOnFullScreen = true;
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
                this.isDocumentOnFullScreen = false;
            }
        }
    }

    handleFS(id) {
        let videoPlayer = this.getId(id);
        videoPlayer.addEventListener('fullscreenchange', (e) => {
            if (videoPlayer.controls || this.isDocumentOnFullScreen) return;
            let fullscreenElement = document.fullscreenElement;
            if (!fullscreenElement) {
                videoPlayer.style.pointerEvents = 'auto';
                this.isVideoOnFullScreen = false;
            }
        });
        videoPlayer.addEventListener('webkitfullscreenchange', (e) => {
            if (videoPlayer.controls || this.isDocumentOnFullScreen) return;
            let webkitIsFullScreen = document.webkitIsFullScreen;
            if (!webkitIsFullScreen) {
                videoPlayer.style.pointerEvents = 'auto';
                this.isVideoOnFullScreen = false;
            }
        });
        videoPlayer.addEventListener('click', () => {
            if (videoPlayer.controls || this.isDocumentOnFullScreen) return;
            if (!this.isVideoOnFullScreen) {
                if (videoPlayer.requestFullscreen) {
                    videoPlayer.requestFullscreen();
                } else if (videoPlayer.webkitRequestFullscreen) {
                    videoPlayer.webkitRequestFullscreen();
                } else if (videoPlayer.msRequestFullscreen) {
                    videoPlayer.msRequestFullscreen();
                }
                this.isVideoOnFullScreen = true;
                videoPlayer.style.pointerEvents = 'none';
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.webkitCancelFullScreen) {
                    document.webkitCancelFullScreen();
                } else if (document.msExitFullscreen) {
                    document.msExitFullscreen();
                }
                this.isVideoOnFullScreen = false;
                videoPlayer.style.pointerEvents = 'auto';
            }
        });
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
    }

    sendMessage() {
        if (!this.thereIsConsumers()) {
            chatMessage.value = '';
            return;
        }
        let peer_msg = this.formatMsg(chatMessage.value);
        if (!peer_msg) return;
        let data = {
            peer_name: this.peer_name,
            peer_msg: peer_msg,
        };
        this.socket.emit('message', data);
        this.setMsgAvatar('right', this.peer_name);
        this.appendMessage('right', this.rightMsgAvatar, this.peer_name, peer_msg);
        chatMessage.value = '';
    }

    showMessage(data) {
        if (!this.isChatOpen) this.toggleChat();
        this.setMsgAvatar('left', data.peer_name);
        this.appendMessage('left', this.leftMsgAvatar, data.peer_name, data.peer_msg);
        this.sound('message');
    }

    setMsgAvatar(avatar, peerName) {
        let avatarImg = cfg.msgAvatar + '?name=' + peerName + '&size=32' + '&background=random&rounded=true';
        avatar === 'left' ? (this.leftMsgAvatar = avatarImg) : (this.rightMsgAvatar = avatarImg);
    }

    appendMessage(side, img, from, msg) {
        let time = this.getTimeNow();
        let msgHTML = `
        <div class="msg ${side}-msg">
            <div class="msg-img" style="background-image: url('${img}')"></div>
            <div class="msg-bubble">
                <div class="msg-info">
                    <div class="msg-info-name">${from}</div>
                    <div class="msg-info-time">${time}</div>
                </div>
                <div class="msg-text">${msg}</div>
            </div>
        </div>
        `;
        this.collectMessages(time, from, msg);
        chatMsger.insertAdjacentHTML('beforeend', msgHTML);
        chatMsger.scrollTop += 500;
    }

    formatMsg(message) {
        let urlRegex = /(https?:\/\/[^\s]+)/g;
        return message.replace(urlRegex, (url) => {
            if (message.match(/\.(jpeg|jpg|gif|png|tiff|bmp)$/))
                return '<img src="' + url + '" alt="img" width="300" height="auto"/>';
            return '<a href="' + url + '" target="_blank">' + url + '</a>';
        });
    }

    collectMessages(time, from, msg) {
        this.chatMessages.push({
            time: time,
            from: from,
            msg: msg,
        });
    }

    chatClean() {
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
            }
        });
    }

    chatSave() {
        if (this.chatMessages.length === 0) {
            userLog('info', 'No chat messages to save', 'top-end');
            return;
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
    }

    // ####################################################
    // RECORDING
    // ####################################################

    toggleRecording() {
        this.getId('recording').classList.toggle('show');
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
            this.userLog('error', "Can't start stream recording reason: " + err, 'top-end');
            return;
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
    // ROOM ACTION
    // ####################################################

    roomAction(action, emit = true) {
        if (emit) this.socket.emit('roomAction', action);
        switch (action) {
            case 'lock':
                this.sound('locked');
                this.event(_EVENTS.roomLock);
                this.userLog('info', '🔒 LOCKED the room, no one can access!', 'top-end');
                break;
            case 'unlock':
                this.event(_EVENTS.roomUnlock);
                this.userLog('info', '🔓 UNLOCKED the room', 'top-end');
                break;
        }
    }

    // ####################################################
    // HANDLE ROOM ACTION
    // ####################################################

    roomIsLocked() {
        this.sound('locked');
        this.event(_EVENTS.roomLock);
        console.log('Room is Locked, try with another one');
        Swal.fire({
            allowOutsideClick: false,
            background: swalBackground,
            position: 'center',
            imageUrl: image.locked,
            title: 'Oops, Room Locked',
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

    // ####################################################
    // PEER ACTION
    // ####################################################

    peerAction(from_peer_name, id, action, emit = true, broadcast = false) {
        let peer_id = id;

        if (emit) {
            if (!broadcast) {
                const words = peer_id.split('__');
                peer_id = words[0];

                switch (action) {
                    case 'eject':
                        let peer = this.getId(peer_id);
                        if (peer) peer.parentNode.removeChild(peer);
                        break;
                    case 'mute':
                        let peerAudioButton = this.getId(peer_id + '__audio');
                        if (peerAudioButton) peerAudioButton.innerHTML = _PEER.audioOff;
                        break;
                    case 'hide':
                        let peerVideoButton = this.getId(peer_id + '__video');
                        if (peerVideoButton) peerVideoButton.innerHTML = _PEER.videoOff;
                }
            } else {
                let actionButton = this.getId(action + 'AllButton');
                if (actionButton) actionButton.style.display = 'none';

                switch (action) {
                    case 'eject':
                        setTimeout(() => {
                            getRoomParticipants();
                        }, 6000);
                        break;
                    case 'mute':
                    case 'hide':
                        setTimeout(() => {
                            getRoomParticipants();
                        }, 2000);
                        break;
                }
            }

            let data = {
                from_peer_name: this.peer_name,
                peer_id: peer_id,
                action: action,
                broadcast: broadcast,
            };
            this.socket.emit('peerAction', data);
        } else {
            switch (action) {
                case 'eject':
                    if (peer_id === this.peer_id || broadcast) {
                        this.sound(action);
                        let timerInterval;
                        Swal.fire({
                            allowOutsideClick: false,
                            background: swalBackground,
                            title: from_peer_name,
                            html: 'Will eject you from the room after <b style="color: red;"></b> milliseconds.',
                            timer: 5000,
                            timerProgressBar: true,
                            didOpen: () => {
                                Swal.showLoading();
                                const b = Swal.getHtmlContainer().querySelector('b');
                                timerInterval = setInterval(() => {
                                    b.textContent = Swal.getTimerLeft();
                                }, 100);
                            },
                            willClose: () => {
                                clearInterval(timerInterval);
                            },
                        }).then(() => {
                            this.exit();
                        });
                    }
                    break;
                case 'mute':
                    if (peer_id === this.peer_id || broadcast) {
                        this.closeProducer(mediaType.audio);
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
                // ...
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
                    this.peer_info.peer_audio = status;
                    break;
                case 'video':
                    this.peer_info.peer_video = status;
                    break;
                case 'hand':
                    this.peer_info.peer_hand = status;
                    let peer_hand = this.getId(peer_id + '__peerHand');
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
                    break;
                case 'video':
                    break;
                case 'hand':
                    let peer_hand = this.getId(peer_id + '__peerHand');
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
    }

    checkPeerInfoStatus(peer_info) {
        let peer_id = peer_info.peer_id;
        let peer_hand_status = peer_info.peer_hand;
        if (peer_hand_status) {
            let peer_hand = this.getId(peer_id + '__peerHand');
            if (peer_hand) peer_hand.style.display = 'flex';
        }
        //...
    }

    popupPeerInfo(id, peer_info) {
        if (this.debug) {
            this.setTippy(
                id,
                JSON.stringify(
                    peer_info,
                    [
                        'peer_name',
                        'peer_audio',
                        'peer_video',
                        'peer_hand',
                        'is_mobile_device',
                        'os_name',
                        'os_version',
                        'browser_name',
                        'browser_version',
                    ],
                    2,
                ),
                'top-start',
            );
        }
    }
}
