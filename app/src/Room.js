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
            video_start_privacy: false,
            audio_start_muted: false,
            video_start_hidden: false,
            audio_cant_unmute: false,
            video_cant_unhide: false,
            screen_cant_share: false,
            chat_cant_privately: false,
            chat_cant_chatgpt: false,
            media_cant_sharing: false,
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

        // Polls
        this.polls = [];

        this.isHostProtected = config.host.protected;

        // Share Media
        this.shareMediaData = {};
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
            hostProtected: this.isHostProtected,
            moderator: this._moderator,
            survey: this.survey,
            redirect: this.redirect,
            videoAIEnabled: this.videoAIEnabled,
            thereIsPolls: this.thereIsPolls(),
            shareMediaData: this.shareMediaData,
            peers: JSON.stringify([...this.peers]),
        };
    }

    // ##############################################
    // SHARE MEDIA
    // ##############################################

    updateShareMedia(data) {
        this.shareMediaData = data;
    }

    // ##############################################
    // POLLS
    // ##############################################

    thereIsPolls() {
        return this.polls.length > 0;
    }

    getPolls() {
        return this.polls;
    }

    convertPolls(polls) {
        return polls.map((poll) => {
            const voters = poll.voters ? Object.fromEntries(poll.voters.entries()) : {};
            return { ...poll, voters };
        });
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
            case 'video_start_privacy':
                this._moderator.video_start_privacy = data.status;
                break;
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
            case 'media_cant_sharing':
                this._moderator.media_cant_sharing = data.status;
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

    delPeer(peer) {
        this.peers.delete(peer.id);
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

    removePeer(socket_id) {
        if (!this.peers.has(socket_id)) return;

        const peer = this.getPeer(socket_id);

        peer.close();

        this.delPeer(peer);

        if (this.getPeersCount() === 0) {
            this.closeRouter();
        }
    }

    // ####################################################
    // WebRTC TRANSPORT
    // ####################################################

    async createWebRtcTransport(socket_id) {
        if (!this.peers.has(socket_id)) {
            throw new Error(`Peer with socket ID ${socket_id} not found in the room`);
        }

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
            throw new Error('Failed to create WebRtc Transport');
        }

        const { id, type, iceParameters, iceCandidates, dtlsParameters } = transport;

        if (maxIncomingBitrate) {
            try {
                await transport.setMaxIncomingBitrate(maxIncomingBitrate);
            } catch (error) {
                log.error('Failed to set max incoming bitrate', error);
                throw new Error(`Failed to set max incoming bitrate for transport ${id}`);
            }
        }

        const peer = this.getPeer(socket_id);

        try {
            peer.addTransport(transport);
        } catch (error) {
            log.error('Failed to add peer transport', error);
            throw new Error(`Failed to add peer transport ${id}`);
        }

        log.debug('Transport created', { transportId: id, transportType: type });

        const { peer_name } = peer;

        transport.observer.on('newproducer', (producer) => {
            log.debug('---> new producer created [id:%s]', producer.id);
        });

        transport.observer.on('newconsumer', (consumer) => {
            log.debug('---> new consumer created [id:%s]', consumer.id);
        });

        transport.observer.on('close', () => {
            log.debug('---> transport close [id:%s]', transport.id);
        });

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
        if (!this.peers.has(socket_id)) {
            throw new Error(`Peer with socket ID ${socket_id} not found in the room`);
        }

        const peer = this.getPeer(socket_id);

        try {
            await peer.connectTransport(transport_id, dtlsParameters);
        } catch (error) {
            log.error(`Failed to connect peer transport for socket ID ${socket_id}`, error);
            throw new Error(`Failed to connect transport for peer with socket ID ${socket_id}`);
        }

        return '[Room|connectPeerTransport] done';
    }

    // ####################################################
    // PRODUCE
    // ####################################################

    async produce(socket_id, producerTransportId, rtpParameters, kind, type) {
        if (!this.peers.has(socket_id)) {
            throw new Error(`Peer with socket ID ${socket_id} not found in the room`);
        }

        const peer = this.getPeer(socket_id);

        let peerProducer;
        try {
            peerProducer = await peer.createProducer(producerTransportId, rtpParameters, kind, type);
        } catch (error) {
            log.error(`Error creating producer for peer with socket ID ${socket_id}`, error);
            throw new Error(
                `Error creating producer with transport ID ${producerTransportId} type ${type} for peer ${socket_id}`,
            );
        }

        if (!peerProducer) {
            throw new Error(`Failed to create producer with ID ${producerTransportId} for peer ${socket_id}`);
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
        if (!this.peers.has(socket_id)) {
            throw new Error(`Peer with socket ID ${socket_id} not found in the room`);
        }

        const peer = this.getPeer(socket_id);

        try {
            peer.closeProducer(producer_id);
        } catch (error) {
            log.error(`Error closing producer for peer ${socket_id}`, error);
            throw new Error(`Error closing producer with ID ${producer_id} for peer ${socket_id}`);
        }
    }

    // ####################################################
    // CONSUME
    // ####################################################

    async consume(socket_id, consumer_transport_id, producerId, rtpCapabilities, type) {
        if (!this.peers.has(socket_id)) {
            throw new Error(`Peer with socket ID ${socket_id} not found in the room`);
        }

        if (!this.router.canConsume({ producerId, rtpCapabilities })) {
            throw new Error(`Cannot consume producer with ID ${producerId} type ${type}, router validation failed`);
        }

        const peer = this.getPeer(socket_id);

        let peerConsumer;
        try {
            peerConsumer = await peer.createConsumer(consumer_transport_id, producerId, rtpCapabilities);
        } catch (error) {
            log.error(`Error creating consumer for peer with socket ID ${socket_id}`, error);
            throw new Error(
                `Failed to create consumer with transport ID ${consumer_transport_id} and producer ID ${producerId} type ${type} for peer ${socket_id}`,
            );
        }

        if (!peerConsumer) {
            throw new Error(
                `Consumer creation failed for transport ID ${consumer_transport_id} and producer ID ${producerId}`,
            );
        }

        const { consumer, params } = peerConsumer;

        const { id, kind } = consumer;

        consumer.on('producerclose', () => {
            log.debug('Consumer closed due to "producerclose" event');

            peer.removeConsumer(id);

            // Notify the client that the consumer is closed
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
