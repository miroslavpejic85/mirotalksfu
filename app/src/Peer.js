'use strict';

const Logger = require('./Logger');
const log = new Logger('Peer');

module.exports = class Peer {
    constructor(socket_id, data) {
        const { peer_info } = data;

        this.id = socket_id;
        this.peer_info = peer_info;
        this.peer_name = peer_info.peer_name;
        this.peer_presenter = peer_info.peer_presenter;
        this.peer_audio = peer_info.peer_audio;
        this.peer_video = peer_info.peer_video;
        this.peer_video_privacy = peer_info.peer_video_privacy;
        this.peer_recording = peer_info.peer_recording;
        this.peer_hand = peer_info.peer_hand;

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
            case 'recording':
                this.peer_info.peer_recording = data.status;
                this.peer_recording = data.status;
                break;
            default:
                break;
        }
    }

    // ####################################################
    // TRANSPORT
    // ####################################################

    getTransports() {
        return JSON.parse(JSON.stringify([...this.transports]));
    }

    addTransport(transport) {
        this.transports.set(transport.id, transport);
    }

    async connectTransport(transport_id, dtlsParameters) {
        if (!this.transports.has(transport_id)) {
            return false;
        }

        await this.transports.get(transport_id).connect({
            dtlsParameters: dtlsParameters,
        });

        return true;
    }

    close() {
        this.transports.forEach((transport) => transport.close());
    }

    // ####################################################
    // PRODUCER
    // ####################################################

    getProducers() {
        return JSON.parse(JSON.stringify([...this.producers]));
    }

    getProducer(producer_id) {
        return this.producers.get(producer_id);
    }

    async createProducer(producerTransportId, producer_rtpParameters, producer_kind, producer_type) {
        try {
            if (!producerTransportId) {
                return 'Invalid producer transport ID';
            }

            const producerTransport = this.transports.get(producerTransportId);

            if (!producerTransport) {
                return `Producer transport with ID ${producerTransportId} not found`;
            }

            const producer = await producerTransport.produce({
                kind: producer_kind,
                rtpParameters: producer_rtpParameters,
            });

            if (!producer) {
                return `Producer type: ${producer_type} kind: ${producer_kind} not found`;
            }

            const { id, appData, type, kind, rtpParameters } = producer;

            appData.mediaType = producer_type;

            this.producers.set(id, producer);

            if (['simulcast', 'svc'].includes(type)) {
                const { scalabilityMode } = rtpParameters.encodings[0];
                const spatialLayer = parseInt(scalabilityMode.substring(1, 2)); // 1/2/3
                const temporalLayer = parseInt(scalabilityMode.substring(3, 4)); // 1/2/3
                log.debug(`Producer [${type}-${kind}] ----->`, {
                    scalabilityMode,
                    spatialLayer,
                    temporalLayer,
                });
            } else {
                log.debug('Producer ----->', { type: type, kind: kind });
            }

            producer.on('transportclose', () => {
                log.debug('Producer transport closed', {
                    peer_name: this.peer_info?.peer_name,
                    producer_id: id,
                });
                this.closeProducer(id);
            });

            return producer;
        } catch (error) {
            log.error('Error creating producer', error.message);
            return error.message;
        }
    }

    closeProducer(producer_id) {
        if (!this.producers.has(producer_id)) return;
        try {
            this.producers.get(producer_id).close();
        } catch (error) {
            log.warn('Close Producer', error.message);
        }
        this.producers.delete(producer_id);
        log.debug('Producer closed and deleted', { producer_id });
    }

    // ####################################################
    // CONSUMER
    // ####################################################

    getConsumers() {
        return JSON.parse(JSON.stringify([...this.consumers]));
    }

    getConsumer(consumer_id) {
        return this.consumers.get(consumer_id);
    }

    async createConsumer(consumer_transport_id, producer_id, rtpCapabilities) {
        try {
            const consumerTransport = this.transports.get(consumer_transport_id);

            if (!consumerTransport) {
                return `Consumer transport with id ${consumer_transport_id} not found`;
            }

            const consumer = await consumerTransport.consume({
                producerId: producer_id,
                rtpCapabilities,
                enableRtx: true, // Enable NACK for OPUS.
                paused: false,
            });

            if (!consumer) {
                return `Consumer for producer ID ${producer_id} not found`;
            }

            const { id, type, kind, rtpParameters, producerPaused } = consumer;

            if (['simulcast', 'svc'].includes(type)) {
                const { scalabilityMode } = rtpParameters.encodings[0];
                const spatialLayer = parseInt(scalabilityMode.substring(1, 2)); // 1/2/3
                const temporalLayer = parseInt(scalabilityMode.substring(3, 4)); // 1/2/3
                try {
                    await consumer.setPreferredLayers({
                        spatialLayer: spatialLayer,
                        temporalLayer: temporalLayer,
                    });
                    log.debug(`Consumer [${type}-${kind}] ----->`, {
                        scalabilityMode,
                        spatialLayer,
                        temporalLayer,
                    });
                } catch (error) {
                    return `Error to set Consumer preferred layers: ${error.message}`;
                }
            } else {
                log.debug('Consumer ----->', { type: type, kind: kind });
            }

            this.consumers.set(id, consumer);

            consumer.on('transportclose', () => {
                log.debug('Consumer transport close', {
                    peer_name: this.peer_info?.peer_name,
                    consumer_id: id,
                });
                this.removeConsumer(id);
            });

            return {
                consumer,
                params: {
                    producerId: producer_id,
                    id: id,
                    kind: kind,
                    rtpParameters: rtpParameters,
                    type: type,
                    producerPaused: producerPaused,
                },
            };
        } catch (error) {
            log.error('Error creating consumer', error.message);
            return error.message;
        }
    }

    removeConsumer(consumer_id) {
        if (this.consumers.has(consumer_id)) {
            try {
                this.consumers.get(consumer_id).close();
            } catch (error) {
                log.warn('Close Consumer', error.message);
            }
            this.consumers.delete(consumer_id);
            log.debug('Consumer closed and deleted', { consumer_id });
        }
    }
};
