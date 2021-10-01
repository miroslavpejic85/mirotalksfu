'use strict';

const config = require('./config');
const Logger = require('./Logger');
const log = new Logger('Room');

module.exports = class Room {
    constructor(room_id, worker, io) {
        this.id = room_id;
        this.worker = worker;
        this.router = null;
        this.io = io;
        this._isLocked = false;
        this.peers = new Map();
        this.createTheRouter();
    }

    // ####################################################
    // ROUTER
    // ####################################################

    createTheRouter() {
        const mediaCodecs = config.mediasoup.router.mediaCodecs;
        this.worker
            .createRouter({
                mediaCodecs,
            })
            .then(
                function (router) {
                    this.router = router;
                }.bind(this),
            );
    }

    getRtpCapabilities() {
        return this.router.rtpCapabilities;
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

    toJson() {
        return {
            id: this.id,
            peers: JSON.stringify([...this.peers]),
        };
    }

    getProducerListForPeer() {
        let producerList = [];
        this.peers.forEach((peer) => {
            peer.producers.forEach((producer) => {
                producerList.push({
                    producer_id: producer.id,
                    peer_name: peer.peer_name,
                    peer_info: peer.peer_info,
                });
            });
        });
        return producerList;
    }

    async connectPeerTransport(socket_id, transport_id, dtlsParameters) {
        if (!this.peers.has(socket_id)) return;
        await this.peers.get(socket_id).connectTransport(transport_id, dtlsParameters);
    }

    async removePeer(socket_id) {
        this.peers.get(socket_id).close();
        this.peers.delete(socket_id);
    }

    // ####################################################
    // WEBRTC TRANSPORT
    // ####################################################

    async createWebRtcTransport(socket_id) {
        const { maxIncomingBitrate, initialAvailableOutgoingBitrate } = config.mediasoup.webRtcTransport;

        const transport = await this.router.createWebRtcTransport({
            listenIps: config.mediasoup.webRtcTransport.listenIps,
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate,
        });

        if (maxIncomingBitrate) {
            try {
                await transport.setMaxIncomingBitrate(maxIncomingBitrate);
            } catch (error) {}
        }

        transport.on(
            'dtlsstatechange',
            function (dtlsState) {
                if (dtlsState === 'closed') {
                    log.debug('Transport close', { peer_name: this.peers.get(socket_id).peer_name });
                    transport.close();
                }
            }.bind(this),
        );

        transport.on('close', () => {
            log.debug('Transport close', { peer_name: this.peers.get(socket_id).peer_name });
        });

        log.debug('Adding transport', { transportId: transport.id });
        this.peers.get(socket_id).addTransport(transport);
        return {
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            },
        };
    }

    // ####################################################
    // PRODUCE
    // ####################################################

    async produce(socket_id, producerTransportId, rtpParameters, kind) {
        return new Promise(
            async function (resolve, reject) {
                let producer = await this.peers.get(socket_id).createProducer(producerTransportId, rtpParameters, kind);
                resolve(producer.id);
                this.broadCast(socket_id, 'newProducers', [
                    {
                        producer_id: producer.id,
                        producer_socket_id: socket_id,
                        peer_name: this.peers.get(socket_id).peer_name,
                        peer_info: this.peers.get(socket_id).peer_info,
                    },
                ]);
            }.bind(this),
        );
    }

    // ####################################################
    // CONSUME
    // ####################################################

    async consume(socket_id, consumer_transport_id, producer_id, rtpCapabilities) {
        if (
            !this.router.canConsume({
                producerId: producer_id,
                rtpCapabilities,
            })
        ) {
            log.error('can not consume');
            return;
        }

        let { consumer, params } = await this.peers
            .get(socket_id)
            .createConsumer(consumer_transport_id, producer_id, rtpCapabilities);

        consumer.on(
            'producerclose',
            function () {
                log.debug('Consumer closed due to producerclose event', {
                    peer_name: this.peers.get(socket_id).peer_name,
                    consumer_id: consumer.id,
                });
                this.peers.get(socket_id).removeConsumer(consumer.id);

                // tell client consumer is dead
                this.io.to(socket_id).emit('consumerClosed', {
                    consumer_id: consumer.id,
                });
            }.bind(this),
        );

        return params;
    }

    closeProducer(socket_id, producer_id) {
        this.peers.get(socket_id).closeProducer(producer_id);
    }

    // ####################################################
    // ROOM STATUS
    // ####################################################

    isLocked() {
        return this._isLocked;
    }
    setLocked(status) {
        this._isLocked = status;
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
