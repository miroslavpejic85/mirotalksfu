'use strict';

const config = require('./config');
const Logger = require('./Logger');
const log = new Logger('Room');

module.exports = class Room {
    constructor(room_id, worker, io) {
        this.id = room_id;
        this.worker = worker;
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
                                this.broadCast(0, 'audioVolume', data);
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

    async connectPeerTransport(socket_id, transport_id, dtlsParameters) {
        try {
            if (!socket_id || !transport_id || !dtlsParameters) {
                throw new Error('Invalid input parameters');
            }

            if (!this.peers.has(socket_id)) {
                throw new Error(`Peer with socket ID ${socket_id} not found`);
            }

            await this.peers.get(socket_id).connectTransport(transport_id, dtlsParameters);
        } catch (error) {
            log.error('Error connecting peer transport', error.message);
        }
    }

    async removePeer(socket_id) {
        if (!this.peers.has(socket_id)) return;
        this.peers.get(socket_id).close();
        this.peers.delete(socket_id);
    }

    // ####################################################
    // WEBRTC TRANSPORT
    // ####################################################

    async createWebRtcTransport(socket_id) {
        try {
            if (!socket_id || !this.peers.has(socket_id)) {
                throw new Error(`Invalid socket ID: ${socket_id}`);
            }

            const { maxIncomingBitrate, initialAvailableOutgoingBitrate, listenInfos } = this.webRtcTransport;

            const transport = await this.router.createWebRtcTransport({
                listenInfos: listenInfos,
                enableUdp: true,
                enableTcp: true,
                preferUdp: true,
                initialAvailableOutgoingBitrate,
            });

            const { id, iceParameters, iceCandidates, dtlsParameters } = transport;

            if (maxIncomingBitrate) {
                try {
                    await transport.setMaxIncomingBitrate(maxIncomingBitrate);
                } catch (error) {
                    log.error('Transport setMaxIncomingBitrate error', error.message);
                }
            }

            const peer = this.peers.get(socket_id);

            const { peer_name } = peer;

            transport.on('icestatechange', (iceState) => {
                if (iceState === 'disconnected' || iceState === 'closed') {
                    log.warn('Transport closed "icestatechange" event', { iceState: iceState });
                    transport.close();
                    //this.router.close();
                    //peer.close();
                }
            });

            transport.on('sctpstatechange', (sctpState) => {
                log.debug('Transport "sctpstatechange" event', { sctpState: sctpState });
            });

            transport.on('dtlsstatechange', (dtlsState) => {
                if (dtlsState === 'failed' || dtlsState === 'closed') {
                    log.warn('Transport closed "dtlsstatechange" event', { dtlsState: dtlsState });
                    transport.close();
                    //this.router.close();
                    //peer.close();
                }
            });

            transport.on('close', () => {
                log.debug('Transport closed', { peer_name: peer_name });
            });

            log.debug('Adding transport', { transportId: id });

            peer.addTransport(transport);

            return {
                params: {
                    id: id,
                    iceParameters: iceParameters,
                    iceCandidates: iceCandidates,
                    dtlsParameters: dtlsParameters,
                },
            };
        } catch (error) {
            log.error('Error creating WebRTC transport', error.message);
            return null;
        }
    }

    // ####################################################
    // PRODUCE
    // ####################################################

    async produce(socket_id, producerTransportId, rtpParameters, kind, type) {
        try {
            if (!socket_id || !producerTransportId || !rtpParameters || !kind || !type) {
                throw new Error('Invalid input parameters');
            }

            if (!this.peers.has(socket_id)) {
                throw new Error(`Invalid socket ID: ${socket_id}`);
            }

            const peer = this.peers.get(socket_id);

            const producer = await peer.createProducer(producerTransportId, rtpParameters, kind, type);
            if (!producer) {
                throw new Error('Failed to create producer');
            }

            const { id } = producer;

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
        } catch (error) {
            console.error('Error producing', error.message);
            throw error.message;
        }
    }

    // ####################################################
    // CONSUME
    // ####################################################

    async consume(socket_id, consumer_transport_id, producer_id, rtpCapabilities) {
        try {
            if (!socket_id || !consumer_transport_id || !producer_id || !rtpCapabilities) {
                throw new Error('Invalid input parameters');
            }

            if (!this.router.canConsume({ producerId: producer_id, rtpCapabilities })) {
                log.warn('Cannot consume', {
                    socket_id,
                    consumer_transport_id,
                    producer_id,
                });
                return;
            }

            if (!this.peers.has(socket_id)) {
                log.warn('Peer not found for socket ID', socket_id);
                return;
            }

            const peer = this.peers.get(socket_id);

            const { peer_name } = peer;

            const result = await peer.createConsumer(consumer_transport_id, producer_id, rtpCapabilities);

            if (!result || !result.consumer || !result.params) {
                log.error('Consumer or params are not defined in createConsumer result');
                return;
            }

            const { consumer, params } = result;

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
            return;
        }
    }

    closeProducer(socket_id, producer_id) {
        try {
            if (!socket_id || !producer_id || !this.peers.has(socket_id)) {
                throw new Error('Invalid socket ID or producer ID');
            }
            this.peers.get(socket_id).closeProducer(producer_id);
        } catch (error) {
            log.error('Error closing producer', error.message);
        }
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

    send(socket_id, action, data) {
        this.io.to(socket_id).emit(action, data);
    }
};
