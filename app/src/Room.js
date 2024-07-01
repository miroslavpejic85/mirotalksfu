'use strict';

const config = require('./config');
const crypto = require('crypto-js');
const RtmpFile = require('./RtmpFile');
const RtmpUrl = require('./RtmpUrl');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Logger = require('./Logger');
const log = new Logger('Room');

const { audioLevelObserverEnabled, activeSpeakerObserverEnabled } = config.mediasoup.router;

module.exports = class Room {
    constructor(room_id, worker, io) {
        this.id = room_id;
        this.worker = worker;
        this.webRtcServer = worker.appData.webRtcServer;
        this.webRtcServerActive = config.mediasoup.webRtcServerActive;
        this.io = io;
        this.audioLevelObserver = null;
        this.audioLevelObserverEnabled = audioLevelObserverEnabled !== undefined ? audioLevelObserverEnabled : true;
        this.audioLastUpdateTime = 0;
        this.activeSpeakerObserverEnabled =
            activeSpeakerObserverEnabled !== undefined ? activeSpeakerObserverEnabled : false;
        this.activeSpeakerObserver = null;
        // ##########################
        this._isBroadcasting = false;
        // ##########################
        this._isLocked = false;
        this._isLobbyEnabled = false;
        this._roomPassword = null;
        this._hostOnlyRecording = false;
        // ##########################
        this.recording = {
            recSyncServerRecording: config?.server?.recording?.enabled || false,
            recSyncServerEndpoint: config?.server?.recording?.endpoint || '',
        };
        // ##########################
        this._moderator = {
            audio_start_muted: false,
            video_start_hidden: false,
            audio_cant_unmute: false,
            video_cant_unhide: false,
            screen_cant_share: false,
            chat_cant_privately: false,
            chat_cant_chatgpt: false,
        };
        this.survey = config.survey;
        this.redirect = config.redirect;
        this.videoAIEnabled = config?.videoAI?.enabled || false;
        this.peers = new Map();
        this.bannedPeers = [];
        this.webRtcTransport = config.mediasoup.webRtcTransport;
        this.router = null;
        this.routerSettings = config.mediasoup.router;
        this.createTheRouter();

        // RTMP configuration
        this.rtmpFileStreamer = null;
        this.rtmpUrlStreamer = null;
        this.rtmp = config.server.rtmp || false;
    }

    // ####################################################
    // ROOM INFO
    // ####################################################

    toJson() {
        return {
            id: this.id,
            broadcasting: this._isBroadcasting,
            recording: this.recording,
            config: {
                isLocked: this._isLocked,
                isLobbyEnabled: this._isLobbyEnabled,
                hostOnlyRecording: this._hostOnlyRecording,
            },
            rtmp: {
                enabled: this.rtmp && this.rtmp.enabled,
                fromFile: this.rtmp && this.rtmp.fromFile,
                fromUrl: this.rtmp && this.rtmp.fromUrl,
                fromStream: this.rtmp && this.rtmp.fromStream,
            },
            moderator: this._moderator,
            survey: this.survey,
            redirect: this.redirect,
            videoAIEnabled: this.videoAIEnabled,
            peers: JSON.stringify([...this.peers]),
        };
    }

    // ##############################################
    // RTMP from FILE
    // ##############################################

    isRtmpFileStreamerActive() {
        return this.rtmpFileStreamer;
    }

    async getRTMP(dir = 'rtmp') {
        //
        const folderPath = path.join(__dirname, '../', dir);
        log.debug('[getRTMP] Files from dir', folderPath);

        try {
            // Create dir if not exists
            if (!fs.existsSync(folderPath)) {
                log.debug('[getRTMP] Dir not exists going to create', folderPath);
                fs.mkdirSync(folderPath, { recursive: true });
            }
            const files = fs.readdirSync(folderPath);
            log.info('[getRTMP] Files', files);
            return files;
        } catch (error) {
            log.error(`[getRTMP] Error reading directory: ${error.message}`);
            return [];
        }
    }

    async startRTMP(socket_id, room, host = 'localhost', port = 1935, file = '../rtmp/BigBuckBunny.mp4') {
        if (!this.rtmp || !this.rtmp.enabled) {
            log.debug('[startRTMP] Server is not enabled or missing the config');
            return false;
        }

        if (this.rtmpFileStreamer) {
            log.debug('[startRTMP] Already in progress');
            return false;
        }

        const inputFilePath = path.join(__dirname, file);

        if (!fs.existsSync(inputFilePath)) {
            log.error(`[startRTMP] File not found: ${inputFilePath}`);
            return false;
        }

        log.debug('[startRTMP] Read all stream from file', inputFilePath);

        this.rtmpFileStreamer = new RtmpFile(socket_id, room);

        const inputStream = fs.createReadStream(inputFilePath);

        const rtmpUrl = this.getRTMPUrl(host, port);

        const rtmpRun = await this.rtmpFileStreamer.start(inputStream, rtmpUrl);

        if (!rtmpRun) {
            this.rtmpFileStreamer = false;
            return this.rtmpFileStreamer;
        }
        return rtmpUrl;
    }

    stopRTMP() {
        if (!this.rtmp || !this.rtmp.enabled) {
            log.debug('[stopRTMP] Server is not enabled or missing the config');
            return false;
        }
        if (this.rtmpFileStreamer) {
            this.rtmpFileStreamer.stop();
            this.rtmpFileStreamer = null;
            log.debug('[stopRTMP] Streamer Stopped successfully!');
            return true;
        } else {
            log.debug('[stopRTMP] No process to stop');
            return false;
        }
    }

    // ####################################################
    // RTMP from URL
    // ####################################################

    isRtmpUrlStreamerActive() {
        return this.rtmpUrlStreamer;
    }

    async startRTMPfromURL(
        socket_id,
        room,
        host = 'localhost',
        port = 1935,
        inputVideoURL = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    ) {
        if (!this.rtmp || !this.rtmp.enabled) {
            log.debug('[startRTMPfromURL] Server is not enabled or missing the config');
            return false;
        }

        if (this.rtmpUrlStreamer) {
            log.debug('[startRTMPfromURL] Already in progress');
            return false;
        }

        log.debug('[startRTMPfromURL] Input video URL', inputVideoURL);

        this.rtmpUrlStreamer = new RtmpUrl(socket_id, room);

        const rtmpUrl = this.getRTMPUrl(host, port);

        const rtmpRun = await this.rtmpUrlStreamer.start(inputVideoURL, rtmpUrl);

        if (!rtmpRun) {
            this.rtmpUrlStreamer = false;
            return this.rtmpUrlStreamer;
        }
        return rtmpUrl;
    }

    stopRTMPfromURL() {
        if (!this.rtmp || !this.rtmp.enabled) {
            log.debug('[stopRTMPfromURL] Server is not enabled or missing the config');
            return false;
        }
        if (this.rtmpUrlStreamer) {
            this.rtmpUrlStreamer.stop();
            this.rtmpUrlStreamer = null;
            log.debug('[stopRTMPfromURL] Streamer Stopped successfully!');
            return true;
        } else {
            log.debug('[stopRTMPfromURL] No process to stop');
            return false;
        }
    }

    // ####################################################
    // RTMP COMMON
    // ####################################################

    getRTMPUrl(host, port) {
        const rtmpServer = this.rtmp.server != '' ? this.rtmp.server : false;
        const rtmpAppName = this.rtmp.appName != '' ? this.rtmp.appName : 'live';
        const rtmpStreamKey = this.rtmp.streamKey != '' ? this.rtmp.streamKey : uuidv4();
        const rtmpServerSecret = this.rtmp.secret != '' ? this.rtmp.secret : false;
        const expirationHours = this.rtmp.expirationHours || 4;
        const rtmpServerURL = rtmpServer ? rtmpServer : `rtmp://${host}:${port}`;
        const rtmpServerPath = '/' + rtmpAppName + '/' + rtmpStreamKey;

        const rtmpUrl = rtmpServerSecret
            ? this.generateRTMPUrl(rtmpServerURL, rtmpServerPath, rtmpServerSecret, expirationHours)
            : rtmpServerURL + rtmpServerPath;

        log.info('RTMP Url generated', rtmpUrl);
        return rtmpUrl;
    }

    generateRTMPUrl(baseURL, streamPath, secretKey, expirationHours = 8) {
        const currentTime = Math.floor(Date.now() / 1000);
        const expirationTime = currentTime + expirationHours * 3600;
        const hashValue = crypto.MD5(`${streamPath}-${expirationTime}-${secretKey}`).toString();
        const rtmpUrl = `${baseURL}${streamPath}?sign=${expirationTime}-${hashValue}`;
        return rtmpUrl;
    }

    // ####################################################
    // ROUTER
    // ####################################################

    createTheRouter() {
        const { mediaCodecs } = this.routerSettings;
        this.worker
            .createRouter({
                mediaCodecs,
            })
            .then((router) => {
                this.router = router;
                if (this.audioLevelObserverEnabled) {
                    this.startAudioLevelObservation();
                }
                if (this.activeSpeakerObserverEnabled) {
                    this.startActiveSpeakerObserver();
                }
                this.router.observer.on('close', () => {
                    log.info('---------------> Router is now closed as the last peer has left the room', {
                        room: this.id,
                    });
                });
            });
    }

    getRtpCapabilities() {
        return this.router.rtpCapabilities;
    }

    closeRouter() {
        this.router.close();
        log.debug('Close Room router', {
            router_id: this.router.id,
            router_closed: this.router.closed,
        });
    }

    // ####################################################
    // PRODUCER AUDIO LEVEL OBSERVER
    // ####################################################

    async startAudioLevelObservation() {
        log.debug('Start audioLevelObserver for signaling active speaker...');

        this.audioLevelObserver = await this.router.createAudioLevelObserver({
            maxEntries: 1,
            threshold: -70,
            interval: 100,
        });

        this.audioLevelObserver.on('volumes', (volumes) => {
            this.sendActiveSpeakerVolume(volumes);
        });
        this.audioLevelObserver.on('silence', () => {
            //log.debug('audioLevelObserver', { volume: 'silence' });
        });
    }

    sendActiveSpeakerVolume(volumes) {
        try {
            if (!Array.isArray(volumes) || volumes.length === 0) {
                throw new Error('Invalid volumes array');
            }

            if (Date.now() > this.audioLastUpdateTime + 100) {
                this.audioLastUpdateTime = Date.now();

                const { producer, volume } = volumes[0];
                const audioVolume = Math.round(Math.pow(10, volume / 70) * 10); // Scale volume to 1-10

                if (audioVolume > 1) {
                    this.peers.forEach((peer) => {
                        const { id, peer_audio, peer_name } = peer;
                        peer.producers.forEach((peerProducer) => {
                            if (peerProducer.id === producer.id && peerProducer.kind === 'audio' && peer_audio) {
                                const data = {
                                    peer_id: id,
                                    peer_name: peer_name,
                                    audioVolume: audioVolume,
                                };
                                // Uncomment the following line for debugging
                                // log.debug('Sending audio volume', data);
                                this.sendToAll('audioVolume', data);
                            }
                        });
                    });
                }
            }
        } catch (error) {
            log.error('Error sending active speaker volume', error.message);
        }
    }

    addProducerToAudioLevelObserver(producer) {
        if (this.audioLevelObserverEnabled) {
            this.audioLevelObserver.addProducer(producer);
        }
    }

    // ####################################################
    // PRODUCER DOMINANT ACTIVE SPEAKER
    // ####################################################

    async startActiveSpeakerObserver() {
        this.activeSpeakerObserver = await this.router.createActiveSpeakerObserver();
        this.activeSpeakerObserver.on('dominantspeaker', (dominantSpeaker) => {
            log.debug('activeSpeakerObserver "dominantspeaker" event', dominantSpeaker.producer.id);
            this.peers.forEach((peer) => {
                const { id, peer_audio, peer_name } = peer;
                peer.producers.forEach((peerProducer) => {
                    if (
                        peerProducer.id === dominantSpeaker.producer.id &&
                        peerProducer.kind === 'audio' &&
                        peer_audio
                    ) {
                        const data = {
                            peer_id: id,
                            peer_name: peer_name,
                        };
                        // log.debug('Sending dominant speaker', data);
                        this.sendToAll('dominantSpeaker', data);
                    }
                });
            });
        });
    }

    addProducerToActiveSpeakerObserver(producer) {
        if (this.activeSpeakerObserverEnabled) {
            this.activeSpeakerObserver.addProducer(producer);
        }
    }

    // ####################################################
    // ROOM MODERATOR
    // ####################################################

    updateRoomModeratorALL(data) {
        this._moderator = data;
        log.debug('Update room moderator all data', this._moderator);
    }

    updateRoomModerator(data) {
        log.debug('Update room moderator', data);
        switch (data.type) {
            case 'audio_start_muted':
                this._moderator.audio_start_muted = data.status;
                break;
            case 'video_start_hidden':
                this._moderator.video_start_hidden = data.status;
                break;
            case 'audio_cant_unmute':
                this._moderator.audio_cant_unmute = data.status;
                break;
            case 'video_cant_unhide':
                this._moderator.video_cant_unhide = data.status;
                break;
            case 'screen_cant_share':
                this._moderator.screen_cant_share = data.status;
                break;
            case 'chat_cant_privately':
                this._moderator.chat_cant_privately = data.status;
                break;
            case 'chat_cant_chatgpt':
                this._moderator.chat_cant_chatgpt = data.status;
                break;
            default:
                break;
        }
    }

    // ####################################################
    // PEERS
    // ####################################################

    addPeer(peer) {
        this.peers.set(peer.id, peer);
    }

    getPeer(socket_id) {
        if (!this.peers.has(socket_id)) return;

        const peer = this.peers.get(socket_id);

        return peer;
    }

    getPeers() {
        return this.peers;
    }

    getPeersCount() {
        return this.peers.size;
    }

    getProducerListForPeer() {
        const producerList = [];
        this.peers.forEach((peer) => {
            const { peer_name, peer_info } = peer;
            peer.producers.forEach((producer) => {
                producerList.push({
                    producer_id: producer.id,
                    peer_name: peer_name,
                    peer_info: peer_info,
                    type: producer.appData.mediaType,
                });
            });
        });
        return producerList;
    }

    async removePeer(socket_id) {
        if (!this.peers.has(socket_id)) return;

        const peer = this.getPeer(socket_id);

        peer.close();

        this.peers.delete(socket_id);

        if (this.getPeers().size === 0) {
            this.closeRouter();
        }
    }

    // ####################################################
    // WebRTC TRANSPORT
    // ####################################################

    async createWebRtcTransport(socket_id) {
        if (!this.peers.has(socket_id)) return;

        const { maxIncomingBitrate, initialAvailableOutgoingBitrate, listenInfos } = this.webRtcTransport;

        const webRtcTransportOptions = {
            ...(this.webRtcServerActive ? { webRtcServer: this.webRtcServer } : { listenInfos: listenInfos }),
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            iceConsentTimeout: 20,
            initialAvailableOutgoingBitrate,
        };

        log.debug('webRtcTransportOptions ----->', webRtcTransportOptions);

        const transport = await this.router.createWebRtcTransport(webRtcTransportOptions);

        if (!transport) {
            throw new Error('Create WebRtc Transport failed!');
        }

        const { id, iceParameters, iceCandidates, dtlsParameters } = transport;

        if (maxIncomingBitrate) {
            try {
                await transport.setMaxIncomingBitrate(maxIncomingBitrate);
            } catch (error) {}
        }

        const peer = this.getPeer(socket_id);

        peer.addTransport(transport);

        log.debug('Transport created', { transportId: id });

        const { peer_name } = peer;

        transport.on('icestatechange', (iceState) => {
            if (iceState === 'disconnected' || iceState === 'closed') {
                log.debug('Transport closed "icestatechange" event', {
                    peer_name: peer_name,
                    transport_id: id,
                    iceState: iceState,
                });
                transport.close();
            }
        });

        transport.on('sctpstatechange', (sctpState) => {
            log.debug('Transport "sctpstatechange" event', {
                peer_name: peer_name,
                transport_id: id,
                sctpState: sctpState,
            });
        });

        transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'failed' || dtlsState === 'closed') {
                log.debug('Transport closed "dtlsstatechange" event', {
                    peer_name: peer_name,
                    transport_id: id,
                    dtlsState: dtlsState,
                });
                transport.close();
            }
        });

        transport.on('close', () => {
            log.debug('Transport closed', {
                peer_name: peer_name,
                transport_id: transport.id,
            });
        });

        return {
            id: id,
            iceParameters: iceParameters,
            iceCandidates: iceCandidates,
            dtlsParameters: dtlsParameters,
        };
    }

    async connectPeerTransport(socket_id, transport_id, dtlsParameters) {
        if (!this.peers.has(socket_id)) return;

        const peer = this.getPeer(socket_id);

        await peer.connectTransport(transport_id, dtlsParameters);

        return '[Room|connectPeerTransport] done';
    }

    // ####################################################
    // PRODUCE
    // ####################################################

    async produce(socket_id, producerTransportId, rtpParameters, kind, type) {
        if (!this.peers.has(socket_id)) return;

        const peer = this.getPeer(socket_id);

        const peerProducer = await peer.createProducer(producerTransportId, rtpParameters, kind, type);

        if (!peerProducer) {
            throw new Error(`Peer producer kind ${kind} with id ${producerTransportId} not found`);
        }

        const { id } = peerProducer;

        const { peer_name, peer_info } = peer;

        this.broadCast(socket_id, 'newProducers', [
            {
                producer_id: id,
                producer_socket_id: socket_id,
                peer_name: peer_name,
                peer_info: peer_info,
                type: type,
            },
        ]);

        return id;
    }

    closeProducer(socket_id, producer_id) {
        if (!this.peers.has(socket_id)) return;

        const peer = this.getPeer(socket_id);

        peer.closeProducer(producer_id);
    }

    // ####################################################
    // CONSUME
    // ####################################################

    async consume(socket_id, consumer_transport_id, producer_id, rtpCapabilities) {
        if (!this.peers.has(socket_id)) return;

        if (
            !this.router.canConsume({
                producerId: producer_id,
                rtpCapabilities,
            })
        ) {
            log.warn('Cannot consume', {
                socket_id,
                consumer_transport_id,
                producer_id,
            });
            return;
        }

        const peer = this.getPeer(socket_id);

        const peerConsumer = await peer.createConsumer(consumer_transport_id, producer_id, rtpCapabilities);

        if (!peerConsumer) {
            throw new Error(`Peer consumer kind ${kind} with id ${consumer_transport_id} not found`);
        }

        const { consumer, params } = peerConsumer;

        const { id, kind } = consumer;

        consumer.on('producerclose', () => {
            log.debug('Consumer closed due to "producerclose" event');

            peer.removeConsumer(id);

            // Notify the client that consumer is closed
            this.send(socket_id, 'consumerClosed', {
                consumer_id: id,
                consumer_kind: kind,
            });
        });

        return params;
    }

    // ####################################################
    // HANDLE BANNED PEERS
    // ####################################################

    addBannedPeer(uuid) {
        if (!this.bannedPeers.includes(uuid)) {
            this.bannedPeers.push(uuid);
            log.debug('Added to the banned list', {
                uuid: uuid,
                banned: this.bannedPeers,
            });
        }
    }

    isBanned(uuid) {
        return this.bannedPeers.includes(uuid);
    }

    // ####################################################
    // ROOM STATUS
    // ####################################################

    // GET
    isBroadcasting() {
        return this._isBroadcasting;
    }
    getPassword() {
        return this._roomPassword;
    }

    // BOOL
    isLocked() {
        return this._isLocked;
    }
    isLobbyEnabled() {
        return this._isLobbyEnabled;
    }
    isHostOnlyRecording() {
        return this._hostOnlyRecording;
    }

    // SET
    setIsBroadcasting(status) {
        this._isBroadcasting = status;
    }
    setLocked(status, password) {
        this._isLocked = status;
        this._roomPassword = password;
    }
    setLobbyEnabled(status) {
        this._isLobbyEnabled = status;
    }
    setHostOnlyRecording(status) {
        this._hostOnlyRecording = status;
    }

    // ####################################################
    // SENDER
    // ####################################################

    broadCast(socket_id, action, data) {
        for (let otherID of Array.from(this.peers.keys()).filter((id) => id !== socket_id)) {
            this.send(otherID, action, data);
        }
    }

    sendTo(socket_id, action, data) {
        for (let peer_id of Array.from(this.peers.keys()).filter((id) => id === socket_id)) {
            this.send(peer_id, action, data);
        }
    }

    sendToAll(action, data) {
        for (let peer_id of Array.from(this.peers.keys())) {
            this.send(peer_id, action, data);
        }
    }

    send(socket_id, action, data) {
        this.io.to(socket_id).emit(action, data);
    }
};
