'use strict';

const Logger = require('./Logger');
const log = new Logger('Peer');

module.exports = class Peer {
    constructor(socket_id, data) {
        this.id = socket_id;
        this.peer_info = data.peer_info;
        this.peer_name = data.peer_info.peer_name;
        this.peer_presenter = data.peer_info.peer_presenter;
        this.peer_audio = data.peer_info.peer_audio;
        this.peer_video = data.peer_info.peer_video;
        this.peer_video_privacy = data.peer_video_privacy;
        this.peer_hand = data.peer_info.peer_hand;
        this.transports = new Map();
        this.consumers = new Map();
        this.producers = new Map();
    }

    // ####################################################
    // UPDATE PEER INFO
    // ####################################################

    updatePeerInfo(data) {
        log.debug('Update peer info', data);
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
                if (data.status == false) {
                    this.peer_info.peer_video_privacy = data.status;
                    this.peer_video_privacy = data.status;
                }
                break;
            case 'screen':
            case 'screenType':
                this.peer_info.peer_screen = data.status;
                break;
            case 'hand':
                this.peer_info.peer_hand = data.status;
                this.peer_hand = data.status;
                break;
            case 'privacy':
                this.peer_info.peer_video_privacy = data.status;
                this.peer_video_privacy = data.status;
                break;
            case 'presenter':
                this.peer_info.peer_presenter = data.status;
                this.peer_presenter = data.status;
                break;
            default:
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

    async createProducer(producerTransportId, rtpParameters, kind, type) {
        let producer = await this.transports.get(producerTransportId).produce({
            kind,
            rtpParameters,
        });

        producer.appData.mediaType = type;

        this.producers.set(producer.id, producer);

        const producerType = producer.type;

        if (['simulcast', 'svc'].includes(producerType)) {
            const scalabilityMode = producer.rtpParameters.encodings[0].scalabilityMode;
            const spatialLayer = parseInt(scalabilityMode.substring(1, 2)); // 1/2/3
            const temporalLayer = parseInt(scalabilityMode.substring(3, 4)); // 1/2/3
            log.debug(`Producer  [${producerType}] ----->`, {
                scalabilityMode: scalabilityMode,
                spatialLayer: spatialLayer,
                temporalLayer: temporalLayer,
            });
        } else {
            log.debug('Producer ----->', { producerType: producerType });
        }

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
        if (!this.producers.has(producer_id)) return;
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
                enableRtx: true, // Enable NACK for OPUS.
                paused: false,
            });
        } catch (error) {
            return console.error('Consume failed', error);
        }

        const consumerType = consumer.type;

        // https://www.w3.org/TR/webrtc-svc/#scalabilitymodes*

        if (['simulcast', 'svc'].includes(consumerType)) {
            // simulcast - L1T3/L2T3/L3T3 | svc - L3T3
            const scalabilityMode = consumer.rtpParameters.encodings[0].scalabilityMode;
            const spatialLayer = parseInt(scalabilityMode.substring(1, 2)); // 1/2/3
            const temporalLayer = parseInt(scalabilityMode.substring(3, 4)); // 1/2/3
            await consumer.setPreferredLayers({
                spatialLayer: spatialLayer,
                temporalLayer: temporalLayer,
            });
            log.debug(`Consumer [${consumerType}] ----->`, {
                scalabilityMode: scalabilityMode,
                spatialLayer: spatialLayer,
                temporalLayer: temporalLayer,
            });
        } else {
            log.debug('Consumer ----->', { consumerType: consumerType });
        }

        this.consumers.set(consumer.id, consumer);

        consumer.on(
            'transportclose',
            function () {
                log.debug('Consumer transport close', {
                    peer_name: this.peer_info.peer_name,
                    consumer_id: consumer.id,
                });
                this.removeConsumer(consumer.id);
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
        if (this.consumers.has(consumer_id)) {
            this.consumers.delete(consumer_id);
        }
    }
};
