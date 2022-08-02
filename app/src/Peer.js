'use strict';

const Logger = require('./Logger');
const log = new Logger('Peer');

module.exports = class Peer {
    constructor(socket_id, data) {
        this.id = socket_id;
        this.peer_info = data.peer_info;
        this.peer_name = data.peer_info.peer_name;
        this.peer_audio = data.peer_info.peer_audio;
        this.peer_video = data.peer_info.peer_video;
        this.peer_hand = data.peer_info.peer_hand;
        this.transports = new Map();
        this.consumers = new Map();
        this.producers = new Map();
    }

    // ####################################################
    // UPDATE PEER INFO
    // ####################################################

    updatePeerInfo(data) {
        switch (data.type) {
            case 'audio':
            case 'audioType':
                this.peer_info.peer_audio = data.status;
                this.peer_audio = data.status;
                break;
            case 'video':
            case 'videoType':
                this.peer_info.peer_video = data.status;
                this.peer_video = data.status;
                break;
            case 'hand':
                this.peer_info.peer_hand = data.status;
                this.peer_hand = data.status;
                break;
        }
    }

    // ####################################################
    // TRANSPORT
    // ####################################################

    addTransport(transport) {
        this.transports.set(transport.id, transport);
    }

    async connectTransport(transport_id, dtlsParameters) {
        if (!this.transports.has(transport_id)) return;

        await this.transports.get(transport_id).connect({
            dtlsParameters: dtlsParameters,
        });
    }

    close() {
        this.transports.forEach((transport) => transport.close());
    }

    // ####################################################
    // PRODUCER
    // ####################################################

    getProducer(producer_id) {
        return this.producers.get(producer_id);
    }

    async createProducer(producerTransportId, rtpParameters, kind) {
        let producer = await this.transports.get(producerTransportId).produce({
            kind,
            rtpParameters,
        });

        this.producers.set(producer.id, producer);

        producer.on(
            'transportclose',
            function () {
                log.debug('Producer transport close', {
                    peer_name: this.peer_info.peer_name,
                    consumer_id: producer.id,
                });
                producer.close();
                this.producers.delete(producer.id);
            }.bind(this),
        );

        return producer;
    }

    closeProducer(producer_id) {
        try {
            this.producers.get(producer_id).close();
        } catch (ex) {
            log.warn('Close Producer', ex);
        }
        this.producers.delete(producer_id);
    }

    // ####################################################
    // CONSUMER
    // ####################################################

    async createConsumer(consumer_transport_id, producer_id, rtpCapabilities) {
        let consumerTransport = this.transports.get(consumer_transport_id);
        let consumer = null;

        try {
            consumer = await consumerTransport.consume({
                producerId: producer_id,
                rtpCapabilities,
                paused: false,
            });
        } catch (error) {
            console.error('Consume failed', error);
            return;
        }

        if (consumer.type === 'simulcast') {
            await consumer.setPreferredLayers({
                spatialLayer: 2,
                temporalLayer: 2,
            });
        }

        this.consumers.set(consumer.id, consumer);

        consumer.on(
            'transportclose',
            function () {
                log.debug('Consumer transport close', {
                    peer_name: this.peer_info.peer_name,
                    consumer_id: consumer.id,
                });
                this.consumers.delete(consumer.id);
            }.bind(this),
        );

        return {
            consumer,
            params: {
                producerId: producer_id,
                id: consumer.id,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
                type: consumer.type,
                producerPaused: consumer.producerPaused,
            },
        };
    }

    removeConsumer(consumer_id) {
        this.consumers.delete(consumer_id);
    }
};
