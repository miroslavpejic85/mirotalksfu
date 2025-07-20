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
            recSyncServerToS3: (config?.integrations?.aws?.enabled && config?.media?.recording?.uploadToS3) || false,
            recSyncServerRecording: config?.media?.recording?.enabled || false,
            recSyncServerEndpoint: config?.media?.recording?.endpoint || '',
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
            chat_cant_deep_seek: false,
            media_cant_sharing: false,
        };
        this.survey = config?.features?.survey;
        this.redirect = config?.features?.redirect;
        this.videoAIEnabled = config?.integrations?.videoAI?.enabled || false;
        this.peers = new Map();
        this.bannedPeers = [];
        this.webRtcTransport = config.mediasoup.webRtcTransport;
        this.router = null;
        this.routerSettings = config.mediasoup.router;
        this.createTheRouter();

        // RTMP configuration
        this.rtmpFileStreamer = null;
        this.rtmpUrlStreamer = null;
        this.rtmp = config?.media?.rtmp || false;

        // Polls
        this.polls = [];

        this.isHostProtected = config?.security?.host?.protected || false;

        // Share Media
        this.shareMediaData = {};

        this.maxParticipants = config?.moderation?.room?.maxParticipants || 1000;
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
            dominantSpeaker: this.activeSpeakerObserverEnabled,
            peers: JSON.stringify([...this.peers]),
            maxParticipants: this.maxParticipants,
            maxParticipantsReached: this.peers.size > this.maxParticipants,
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
        inputVideoURL = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
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
        const rtmpUseNodeMediaServer = this.rtmp.useNodeMediaServer ?? true;
        const rtmpServer = this.rtmp.server != '' ? this.rtmp.server : false;
        const rtmpAppName = this.rtmp.appName != '' ? this.rtmp.appName : 'live';
        const rtmpStreamKey = this.rtmp.streamKey != '' ? this.rtmp.streamKey : uuidv4();
        const rtmpServerSecret = this.rtmp.secret != '' ? this.rtmp.secret : false;
        const expirationHours = this.rtmp.expirationHours || 4;
        const rtmpServerURL = rtmpServer ? rtmpServer : `rtmp://${host}:${port}`;
        const rtmpServerPath = '/' + rtmpAppName + '/' + rtmpStreamKey;

        const rtmpUrl = rtmpUseNodeMediaServer
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
                    log.info('Audio Level Observer enabled, starting observation...');
                    this.startAudioLevelObservation().catch((err) => {
                        log.error('Failed to start audio level observation', err);
                    });
                }
                if (this.activeSpeakerObserverEnabled) {
                    log.info('Active Speaker Observer enabled, starting observation...');
                    this.startActiveSpeakerObserver().catch((err) => {
                        log.error('Failed to start active speaker observer', err);
                    });
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
        if (this.router && !this.router.closed) {
            this.router.close();
            log.debug('Router closed', { router_id: this.router.id });
        }
    }

    close() {
        this.closeAudioLevelObserver();
        this.closeActiveSpeakerObserver();
        this.closeRouter();
        log.debug('Room closed', { room_id: this.id });
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
                                // log.debug('Sending audio volume', data);
                                this.sendToAll('audioVolume', data);
                                return;
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
            log.info('Producer added to audio level observer', { producer });
        }
    }

    closeAudioLevelObserver() {
        if (this.audioLevelObserver && !this.audioLevelObserver.closed) {
            this.audioLevelObserver.close();
            this.audioLevelObserver = null;
            log.debug('Audio Level Observer closed');
        }
    }

    // ####################################################
    // PRODUCER DOMINANT ACTIVE SPEAKER
    // ####################################################

    async startActiveSpeakerObserver() {
        log.debug('Start activeSpeakerObserver for signaling dominant speaker...');
        this.activeSpeakerObserver = await this.router.createActiveSpeakerObserver();
        this.activeSpeakerObserver.on('dominantspeaker', (dominantSpeaker) => {
            if (!dominantSpeaker.producer) {
                return;
            }
            log.debug('activeSpeakerObserver "dominantspeaker" event', dominantSpeaker.producer.id);
            this.peers.forEach((peer) => {
                const { id, peer_audio, peer_name } = peer;
                if (peer.producers instanceof Map) {
                    for (const peerProducer of peer.producers.values()) {
                        if (
                            peerProducer.id === dominantSpeaker.producer.id &&
                            peerProducer.kind === 'audio' &&
                            peer_audio
                        ) {
                            let videoProducerId = null;
                            for (const p of peer.producers.values()) {
                                if (p.kind === 'video') {
                                    videoProducerId = p.id;
                                    break;
                                }
                            }
                            const data = {
                                producer_id: videoProducerId,
                                peer_id: id,
                                peer_name: peer_name,
                            };
                            log.debug('Sending dominant speaker', data);
                            this.sendToAll('dominantSpeaker', data);
                            break;
                        }
                    }
                }
            });
        });
    }

    addProducerToActiveSpeakerObserver(producer) {
        if (this.activeSpeakerObserverEnabled) {
            this.activeSpeakerObserver.addProducer(producer);
            log.info('Producer added to active speaker observer', { producer });
        }
    }

    closeActiveSpeakerObserver() {
        if (this.activeSpeakerObserver && !this.activeSpeakerObserver.closed) {
            this.activeSpeakerObserver.close();
            this.activeSpeakerObserver = null;
            log.debug('Active Speaker Observer closed');
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
            case 'chat_cant_deep_seek':
                this._moderator.chat_cant_deep_seek = data.status;
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
            this.close();
        }
    }

    // ####################################################
    // WebRTC TRANSPORT
    // ####################################################

    getWebRtcTransportOptions() {
        const { iceConsentTimeout = 35, initialAvailableOutgoingBitrate, listenInfos } = this.webRtcTransport;
        return {
            ...(this.webRtcServerActive ? { webRtcServer: this.webRtcServer } : { listenInfos: listenInfos }),
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            iceConsentTimeout,
            initialAvailableOutgoingBitrate,
        };
    }

    async createWebRtcTransport(socket_id) {
        if (!this.peers.has(socket_id)) {
            throw new Error(`Peer with socket ID ${socket_id} not found in the room`);
        }

        const webRtcTransportOptions = this.getWebRtcTransportOptions();

        log.debug('webRtcTransportOptions ----->', webRtcTransportOptions);

        let transport;
        try {
            transport = await this.router.createWebRtcTransport(webRtcTransportOptions);
            if (!transport) {
                throw new Error('Failed to create WebRTC Transport');
            }
        } catch (error) {
            log.error('Error creating WebRTC Transport', { error: error.message, socket_id });
            throw new Error('Error creating WebRTC Transport');
        }

        if (!transport) {
            throw new Error(`Transport not found for socket ID ${socket_id}`);
        }

        if (transport.closed) {
            throw new Error('Transport is already closed');
        }

        const { id, type, iceParameters, iceCandidates, dtlsParameters } = transport;
        const { maxIncomingBitrate } = this.webRtcTransport;

        if (maxIncomingBitrate) {
            try {
                await transport.setMaxIncomingBitrate(maxIncomingBitrate);
            } catch (error) {
                log.warn('Failed to set max incoming bitrate', error);
            }
        }

        const peer = this.getPeer(socket_id);

        try {
            peer.addTransport(transport);
        } catch (error) {
            log.error('Failed to add peer transport', error);
            throw new Error(`Failed to add peer transport ${id}`);
        }

        log.debug('Transport created', {
            room_id: this.id,
            transport_id: transport.id,
            type: type,
            peer_name: peer.peer_name,
        });

        const { peer_name } = peer;
        const { iceConsentTimeout = 35 } = this.webRtcTransport;

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
            log.debug('ICE state changed', {
                peer_name: peer_name,
                transport_id: id,
                iceState: iceState,
            });

            if (iceState === 'disconnected') {
                log.warn(`ICE state disconnected for transport ${transport.id}, waiting before closing`);
                setTimeout(() => {
                    if (transport.iceState === 'disconnected') {
                        log.warn(`Closing transport ${transport.id} due to prolonged ICE disconnection`);
                        if (!transport.closed) {
                            transport.close();
                        }
                    }
                }, iceConsentTimeout * 1000); // Wait iceConsentTimeout seconds before closing
            } else if (iceState === 'closed') {
                log.warn(`ICE state closed for transport ${transport.id}`);
                if (!transport.closed) {
                    transport.close();
                }
            }
        });

        transport.on('sctpstatechange', (sctpState) => {
            log.debug('SCTP state changed', {
                peer_name: peer_name,
                transport_id: id,
                sctpState: sctpState,
            });
        });

        transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'failed' || dtlsState === 'closed') {
                log.warn('DTLS state changed, closing peer', {
                    peer_name: peer_name,
                    transport_id: id,
                    dtlsState: dtlsState,
                });
                if (!transport.closed) {
                    transport.close();
                }
            }
        });

        transport.on('close', () => {
            log.debug('Transport closed', {
                peer_name: peer_name,
                transport_id: transport.id,
                transport_closed: transport.closed,
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
        if (!socket_id || !transport_id || !dtlsParameters) {
            throw new Error('Missing required parameters for connecting peer transport');
        }

        if (!this.peers.has(socket_id)) {
            throw new Error(`Peer with socket ID ${socket_id} not found in the room`);
        }

        const peer = this.getPeer(socket_id);

        try {
            await peer.connectTransport(transport_id, dtlsParameters);
            log.debug('Peer transport connected successfully', {
                socket_id,
                transport_id,
                peer_name: peer.peer_name,
            });
        } catch (error) {
            log.error(`Failed to connect peer transport for socket ID ${socket_id}`, {
                transport_id,
                error: error.message,
                peer_name: peer.peer_name,
            });
            throw new Error(`Failed to connect transport for peer with socket ID ${socket_id}`);
        }

        return '[Room|connectPeerTransport] done';
    }

    // ####################################################
    // PRODUCE
    // ####################################################

    async produce(socket_id, producerTransportId, rtpParameters, kind, type) {
        if (!socket_id || !producerTransportId || !rtpParameters || !kind || !type) {
            throw new Error('Missing required parameters for producing media');
        }

        if (!this.peers.has(socket_id)) {
            throw new Error(`Peer with socket ID ${socket_id} not found in the room`);
        }

        const peer = this.getPeer(socket_id);
        const { peer_name, peer_info } = peer;

        if (!peer.hasTransport(producerTransportId)) {
            throw new Error(`Transport with ID ${producerTransportId} not found for peer ${socket_id}`);
        }

        let peerProducer;
        try {
            peerProducer = await peer.createProducer(producerTransportId, rtpParameters, kind, type);
        } catch (error) {
            log.error(`Error creating producer for peer ${peer.peer_name} with socket ID ${socket_id}`, {
                producerTransportId,
                kind,
                type,
                error: error.message,
            });
            throw new Error(
                `Failed to create producer for peer ${peer.peer_name} with transport ID ${producerTransportId}`
            );
        }

        if (!peerProducer) {
            throw new Error(
                `Failed to create producer for peer ${peer_name} with ID ${producerTransportId} for peer ${socket_id}`
            );
        }

        const { id } = peerProducer;

        const producerTransport = peer.getTransport(producerTransportId);

        if (!producerTransport) {
            throw new Error(`Producer transport with ID ${producerTransportId} not found for peer ${peer_name}`);
        }

        this.broadCast(socket_id, 'newProducers', [
            {
                producer_id: id,
                producer_socket_id: socket_id,
                peer_name: peer_name,
                peer_info: peer_info,
                type: type,
            },
        ]);

        log.debug('Producer created successfully', {
            producerTransportId,
            producer_id: id,
            peer_name: peer.peer_name,
            kind,
            type,
            paused: peerProducer.paused,
            appData: peerProducer.appData,
            transport_state: `ICE:${producerTransport.iceState}, DTLS:${producerTransport.dtlsState}`,
            codecs: rtpParameters.codecs?.map((c) => c.mimeType) || [],
        });

        return id;
    }

    closeProducer(socket_id, producer_id) {
        if (!this.peers.has(socket_id)) return;

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
        if (!socket_id || !consumer_transport_id || !producerId || !rtpCapabilities || !type) {
            throw new Error('Missing required parameters for consuming media');
        }

        if (!this.peers.has(socket_id)) {
            throw new Error(`Peer with socket ID ${socket_id} not found in the room`);
        }

        const peer = this.getPeer(socket_id);
        const { peer_name } = peer;

        if (!this.router.canConsume({ producerId, rtpCapabilities })) {
            throw new Error(
                `Cannot consume producer for peer ${peer_name} with ID ${producerId} type ${type}, router validation failed`
            );
        }

        let peerConsumer;
        try {
            peerConsumer = await peer.createConsumer(consumer_transport_id, producerId, rtpCapabilities);
        } catch (error) {
            log.error(`Error creating consumer for peer ${peer_name} with socket ID ${socket_id}`, {
                consumer_transport_id,
                producerId,
                type,
                error: error.message,
            });
            throw new Error(
                `Failed to create consumer for peer ${peer_name} with transport ID ${consumer_transport_id} and producer ID ${producerId} type ${type} for peer ${socket_id}`
            );
        }

        if (!peerConsumer) {
            throw new Error(
                `Consumer creation failed for peer ${peer_name} with transport ID ${consumer_transport_id} and producer ID ${producerId}`
            );
        }

        const consumerTransport = peer.getTransport(consumer_transport_id);

        if (!consumerTransport) {
            throw new Error(`Consumer transport with ID ${consumer_transport_id} not found for peer ${peer_name}`);
        }

        const { consumer, params } = peerConsumer;
        const { id, kind } = consumer;

        consumer.on('producerclose', () => {
            log.debug('Consumer closed due to "producerclose" event', {
                consumer_id: id,
                producer_id: producerId,
                peer_name,
            });

            peer.removeConsumer(id);

            // Notify the client that the consumer is closed
            this.send(socket_id, 'consumerClosed', {
                consumer_id: id,
                consumer_kind: kind,
            });
        });

        log.debug('Consumer created successfully', {
            consumer_transport_id,
            consumer_id: id,
            producer_id: producerId,
            peer_name,
            kind,
            type,
            paused: consumer.paused,
            producerPaused: consumer.producerPaused,
            transport_state: `ICE:${consumerTransport.iceState}, DTLS:${consumerTransport.dtlsState}`,
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
