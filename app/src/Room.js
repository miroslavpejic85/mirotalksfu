'use strict';

const config = require('./config');
const Logger = require('./Logger');
const log = new Logger('Room');

module.exports = class Room {
    constructor(room_id, worker, io) {
        this.id = room_id;
        this.worker = worker;
        this.webRtcServer = worker.appData.webRtcServer;
        this.webRtcServerActive = config.mediasoup.webRtcServerActive;
        this.io = io;
        this.audioLevelObserver = null;
        this.audioLevelObserverEnabled = true;
        this.audioLastUpdateTime = 0;
        // ##########################
        this._isBroadcasting = false;
        // ##########################
        this._isLocked = false;
        this._isLobbyEnabled = false;
        this._roomPassword = null;
        this._hostOnlyRecording = false;
        // ##########################
        this._recSyncServerRecording = config?.server?.recording?.enabled || false;
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
        this.peers = new Map();
        this.bannedPeers = [];
        this.webRtcTransport = config.mediasoup.webRtcTransport;
        this.router = null;
        this.routerSettings = config.mediasoup.router;
        this.createTheRouter();
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
                    this.startAudioLevelObservation(router);
                }
            });
    }

    // ####################################################
    // PRODUCER AUDIO LEVEL OBSERVER
    // ####################################################

    async startAudioLevelObservation(router) {
        log.debug('Start audioLevelObserver for signaling active speaker...');

        this.audioLevelObserver = await router.createAudioLevelObserver({
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

    getRtpCapabilities() {
        return this.router.rtpCapabilities;
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
            case 'audio_cant_unmute':
                this._moderator.audio_cant_unmute = data.status;
                break;
            case 'video_cant_unhide':
                this._moderator.video_cant_unhide = data.status;
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
    // ROOM INFO
    // ####################################################

    toJson() {
        return {
            id: this.id,
            broadcasting: this._isBroadcasting,
            recSyncServerRecording: this._recSyncServerRecording,
            config: {
                isLocked: this._isLocked,
                isLobbyEnabled: this._isLobbyEnabled,
                hostOnlyRecording: this._hostOnlyRecording,
            },
            moderator: this._moderator,
            survey: this.survey,
            redirect: this.redirect,
            peers: JSON.stringify([...this.peers]),
        };
    }

    // ####################################################
    // PEERS
    // ####################################################

    addPeer(peer) {
        this.peers.set(peer.id, peer);
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

        const peer = this.peers.get(socket_id);

        const { id, peer_name } = peer;

        const peerTransports = peer.getTransports();
        const peerProducers = peer.getProducers();
        const peerConsumers = peer.getConsumers();

        log.debug('REMOVE PEER', {
            peer_id: id,
            peer_name: peer_name,
            peerTransports: peerTransports,
            peerProducers: peerProducers,
            peerConsumers: peerConsumers,
        });

        peer.close();

        this.peers.delete(socket_id);
    }

    // ####################################################
    // WEBRTC TRANSPORT
    // ####################################################

    async createWebRtcTransport(socket_id) {
        if (!this.peers.has(socket_id)) {
            return this.callback(`[Room|createWebRtcTransport] Peer with socket ID ${socket_id} not found`);
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

        const transport = await this.router.createWebRtcTransport(webRtcTransportOptions);

        if (!transport) {
            return this.callback('[Room|createWebRtcTransport] Failed to create WebRTC transport');
        }

        const { id, iceParameters, iceCandidates, dtlsParameters } = transport;

        if (maxIncomingBitrate) {
            try {
                await transport.setMaxIncomingBitrate(maxIncomingBitrate);
            } catch (error) {
                log.debug('Transport setMaxIncomingBitrate error', error.message);
            }
        }

        const peer = this.peers.get(socket_id);

        const { peer_name = 'undefined' } = peer;

        transport.on('icestatechange', (iceState) => {
            if (iceState === 'disconnected' || iceState === 'closed') {
                log.debug('Transport closed "icestatechange" event', {
                    peer_name: peer_name,
                    iceState: iceState,
                });
                transport.close();
            }
        });

        transport.on('sctpstatechange', (sctpState) => {
            log.debug('Transport "sctpstatechange" event', {
                peer_name: peer_name,
                sctpState: sctpState,
            });
        });

        transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'failed' || dtlsState === 'closed') {
                log.debug('Transport closed "dtlsstatechange" event', {
                    peer_name: peer_name,
                    dtlsState: dtlsState,
                });
                transport.close();
            }
        });

        transport.observer.on('close', () => {
            log.debug('Transport closed', { peer_name: peer_name, transport_id: transport.id });
        });

        log.debug('Adding transport', { transportId: id });

        peer.addTransport(transport);

        return {
            id: id,
            iceParameters: iceParameters,
            iceCandidates: iceCandidates,
            dtlsParameters: dtlsParameters,
        };
    }

    async connectPeerTransport(socket_id, transport_id, dtlsParameters) {
        try {
            if (!socket_id || !transport_id || !dtlsParameters) {
                return this.callback('[Room|connectPeerTransport] Invalid input parameters');
            }

            if (!this.peers.has(socket_id)) {
                return this.callback(`[Room|connectPeerTransport] Peer with socket ID ${socket_id} not found`);
            }

            const peer = this.peers.get(socket_id);

            const connectTransport = await peer.connectTransport(transport_id, dtlsParameters);

            if (!connectTransport) {
                return this.callback(`[Room|connectPeerTransport] error: Transport with ID ${transport_id} not found`);
            }

            return '[Room|connectPeerTransport] done';
        } catch (error) {
            log.error('Error connecting peer transport', error.message);
            return this.callback(`[Room|connectPeerTransport] error: ${error.message}`);
        }
    }

    // ####################################################
    // PRODUCE
    // ####################################################

    async produce(socket_id, producerTransportId, rtpParameters, kind, type) {
        //
        if (!socket_id || !producerTransportId || !rtpParameters || !kind || !type) {
            return this.callback('[Room|produce] Invalid input parameters');
        }

        if (!this.peers.has(socket_id)) {
            return this.callback(`[Room|produce] Peer with ID: ${socket_id} not found`);
        }

        const peer = this.peers.get(socket_id);

        const peerProducer = await peer.createProducer(producerTransportId, rtpParameters, kind, type);

        if (!peerProducer || !peerProducer.id) {
            return this.callback(`[Room|produce] Peer producer error: '${peerProducer}'`);
        }

        const { id } = peerProducer;

        const { peer_name = 'undefined', peer_info = {} } = peer;

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

    // ####################################################
    // CONSUME
    // ####################################################

    async consume(socket_id, consumer_transport_id, producer_id, rtpCapabilities) {
        try {
            if (!socket_id || !consumer_transport_id || !producer_id || !rtpCapabilities) {
                return this.callback('[Room|consume] Invalid input parameters');
            }

            if (!this.router.canConsume({ producerId: producer_id, rtpCapabilities })) {
                log.warn('Cannot consume', {
                    socket_id,
                    consumer_transport_id,
                    producer_id,
                });
                return this.callback(`[Room|consume] Room router cannot consume producer_id: '${producer_id}'`);
            }

            if (!this.peers.has(socket_id)) {
                log.warn('Peer not found for socket ID', socket_id);
                return this.callback(`[Room|consume] Peer with ID: ${socket_id} not found`);
            }

            const peer = this.peers.get(socket_id);

            const { peer_name = 'undefined' } = peer;

            const peerConsumer = await peer.createConsumer(consumer_transport_id, producer_id, rtpCapabilities);

            if (!peerConsumer || !peerConsumer.consumer || !peerConsumer.params) {
                log.debug('peerConsumer or params are not defined');
                return this.callback(`[Room|consume] peerConsumer error: '${peerConsumer}'`);
            }

            const { consumer, params } = peerConsumer;

            const { id, kind } = consumer;

            consumer.on('producerclose', () => {
                log.debug('Consumer closed due to producerclose event', {
                    peer_name: peer_name,
                    consumer_id: id,
                });
                peer.removeConsumer(id);

                // Tell client consumer is dead
                this.io.to(socket_id).emit('consumerClosed', {
                    consumer_id: id,
                    consumer_kind: kind,
                });
            });

            return params;
        } catch (error) {
            log.error('Error occurred during consumption', error.message);
            return this.callback(`[Room|consume] ${error.message}`);
        }
    }

    closeProducer(socket_id, producer_id) {
        if (!socket_id || !producer_id || !this.peers.has(socket_id)) return;

        const peer = this.peers.get(socket_id);

        peer.closeProducer(producer_id);
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
    // ERRORS
    // ####################################################

    callback(message) {
        return { error: message };
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
