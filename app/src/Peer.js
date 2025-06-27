'use strict';

const Logger = require('./Logger');
const log = new Logger('Peer');

module.exports = class Peer {
    constructor(socket_id, data) {
        const { peer_info } = data;

        const {
            peer_uuid,
            peer_name,
            peer_avatar,
            peer_presenter,
            peer_audio,
            peer_audio_volume,
            peer_video,
            peer_video_privacy,
            peer_recording,
            peer_hand,
        } = peer_info;

        this.id = socket_id;
        this.peer_info = peer_info;
        this.peer_uuid = peer_uuid;
        this.peer_name = peer_name;
        this.peer_avatar = peer_avatar;
        this.peer_presenter = peer_presenter;
        this.peer_audio = peer_audio;
        this.peer_video = peer_video;
        this.peer_audio_volume = peer_audio_volume;
        this.peer_video_privacy = peer_video_privacy;
        this.peer_recording = peer_recording;
        this.peer_hand = peer_hand;

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
            case 'peerAudio':
                this.peer_info.peer_audio_volume = data.volume;
                this.peer_audio_volume = data.volume;
                break;
            default:
                break;
        }
    }

    // ####################################################
    // TRANSPORT
    // ####################################################

    hasTransport(transport_id) {
        return this.transports.has(transport_id);
    }

    getTransports() {
        return JSON.parse(JSON.stringify([...this.transports]));
    }

    getTransport(transport_id) {
        return this.transports.get(transport_id);
    }

    delTransport(transport_id) {
        this.transports.delete(transport_id);
    }

    addTransport(transport) {
        this.transports.set(transport.id, transport);
    }

    async connectTransport(transport_id, dtlsParameters) {
        if (!transport_id || !dtlsParameters) {
            throw new Error('Missing required parameters for connecting a transport');
        }

        if (!this.transports.has(transport_id)) {
            throw new Error(`Transport with ID ${transport_id} not found`);
        }

        const transport = this.transports.get(transport_id);

        try {
            // Connect the transport
            await transport.connect({ dtlsParameters });
            log.debug('Transport connected successfully', {
                transport_id,
                peer_name: this.peer_name,
            });
        } catch (error) {
            log.error(`Failed to connect transport with ID ${transport_id}`, {
                error: error.message,
                peer_name: this.peer_name,
            });
            throw new Error(`Failed to connect transport with ID ${transport_id}`);
        }

        return true;
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

    delProducer(producer_id) {
        this.producers.delete(producer_id);
    }

    addProducer(producer_id, producer) {
        this.producers.set(producer_id, producer);
    }

    async createProducer(producerTransportId, producer_rtpParameters, producer_kind, producer_type) {
        if (!producerTransportId || !producer_rtpParameters || !producer_kind || !producer_type) {
            throw new Error('Missing required parameters for creating a producer');
        }

        if (!this.transports.has(producerTransportId)) {
            throw new Error(`Producer transport with ID ${producerTransportId} not found`);
        }

        const producerTransport = this.getTransport(producerTransportId);

        if (!producerTransport) {
            throw new Error(`Consumer transport with ID ${producerTransportId} not found for peer ${this.peer_name}`);
        }

        let producer;
        try {
            producer = await producerTransport.produce({
                kind: producer_kind,
                rtpParameters: producer_rtpParameters,
            });

            this.addProducer(producer.id, producer);
        } catch (error) {
            log.error(`Error creating producer for transport ID ${producerTransportId}`, {
                error: error.message,
                producer_kind,
                producer_type,
            });
            throw new Error(`Failed to create producer for transport ID ${producerTransportId}`);
        }

        if (!producer) {
            throw new Error(`Producer creation failed for transport ID ${producerTransportId}`);
        }

        const { id, appData, type, kind, rtpParameters } = producer;

        appData.mediaType = producer_type;

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
            log.debug('Producer created ----->', { type, kind });
        }

        producer.on('transportclose', () => {
            log.debug('Producer "transportclose" event', { producerId: id });
            this.closeProducer(id);
        });

        return producer;
    }

    closeProducer(producer_id) {
        if (!this.producers.has(producer_id)) return;

        const producer = this.getProducer(producer_id);

        try {
            if (!producer.closed) {
                producer.close();
            }

            log.debug('Producer closed successfully', {
                producer_id: producer.id,
                peer_name: this.peer_name,
                kind: producer.kind,
                type: producer.type,
                appData: producer.appData,
            });
        } catch (error) {
            log.error(`Error closing producer with ID ${producer_id}`, {
                error: error.message,
                peer_name: this.peer_name,
            });
        }

        this.delProducer(producer_id);

        log.debug('Producer removed from peer', {
            producer_id: producer.id,
            producer_closed: producer.closed,
            peer_name: this.peer_name,
        });
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

    delConsumer(consumer_id) {
        this.consumers.delete(consumer_id);
    }

    addConsumer(consumer_id, consumer) {
        this.consumers.set(consumer_id, consumer);
    }

    async createConsumer(consumer_transport_id, producerId, rtpCapabilities) {
        if (!consumer_transport_id || !producerId || !rtpCapabilities) {
            throw new Error('Missing required parameters for creating a consumer');
        }

        if (!this.transports.has(consumer_transport_id)) {
            throw new Error(`Consumer transport with ID ${consumer_transport_id} not found`);
        }

        const consumerTransport = this.getTransport(consumer_transport_id);

        if (!consumerTransport) {
            throw new Error(`Consumer transport with ID ${consumer_transport_id} not found for peer ${this.peer_name}`);
        }

        let consumer;
        try {
            consumer = await consumerTransport.consume({
                producerId,
                rtpCapabilities,
                enableRtx: true, // Enable NACK for OPUS.
                paused: true, // Start the consumer in a paused state
                ignoreDtx: true, // Ignore DTX (Discontinuous Transmission)
            });

            this.addConsumer(consumer.id, consumer);
        } catch (error) {
            log.error(`Error creating consumer for transport ID ${consumer_transport_id}`, {
                error: error.message,
                producerId,
            });
            throw new Error(`Failed to create consumer for transport ID ${consumer_transport_id}`);
        }

        if (!consumer) {
            throw new Error(`Consumer creation failed for transport ID ${consumer_transport_id}`);
        }

        const { id, type, kind, rtpParameters, producerPaused } = consumer;

        if (['simulcast', 'svc'].includes(type)) {
            // simulcast - L1T3/L2T3/L3T3 | svc - L3T3
            const { scalabilityMode } = rtpParameters.encodings[0];
            const spatialLayer = parseInt(scalabilityMode.substring(1, 2)); // 1/2/3
            const temporalLayer = parseInt(scalabilityMode.substring(3, 4)); // 1/2/3

            try {
                await consumer.setPreferredLayers({
                    spatialLayer,
                    temporalLayer,
                });
                log.debug(`Consumer [${type}-${kind}] ----->`, {
                    scalabilityMode,
                    spatialLayer,
                    temporalLayer,
                });
            } catch (error) {
                log.error('Failed to set preferred layers', {
                    consumerId: id,
                    error,
                });
            }
        } else {
            log.debug('Consumer created ----->', { type, kind });
        }

        consumer.on('transportclose', () => {
            log.debug('Consumer "transportclose" event', { consumerId: id });
            this.removeConsumer(id);
        });

        return {
            consumer,
            params: {
                producerId,
                id,
                kind,
                rtpParameters,
                type,
                producerPaused,
            },
        };
    }

    removeConsumer(consumer_id) {
        if (!this.consumers.has(consumer_id)) return;

        const consumer = this.getConsumer(consumer_id);

        try {
            if (!consumer.closed) {
                consumer.close();
            }

            log.debug('Consumer closed successfully', {
                consumer_id: consumer.id,
                peer_name: this.peer_name,
                kind: consumer.kind,
                type: consumer.type,
            });
        } catch (error) {
            log.error(`Error closing consumer with ID ${consumer_id}`, {
                error: error.message,
                peer_name: this.peer_name,
            });
        }

        this.delConsumer(consumer_id);

        log.debug('Consumer removed from peer', {
            consumer_id: consumer.id,
            consumer_closed: consumer.closed,
            peer_name: this.peer_name,
        });
    }

    // ####################################################
    // CLOSE PEER
    // ####################################################

    close() {
        log.info('Starting peer cleanup', {
            peer_id: this.id,
            peer_name: this.peer_name,
            transports: this.transports.size,
            producers: this.producers.size,
            consumers: this.consumers.size,
        });

        // Close all consumers first
        for (const [consumer_id, consumer] of this.consumers.entries()) {
            try {
                if (!consumer.closed) {
                    consumer.close();
                }
            } catch (error) {
                log.warn('Error closing consumer during peer cleanup', {
                    consumer_id,
                    error: error.message,
                });
            }
        }
        this.consumers.clear();

        // Close all producers
        for (const [producer_id, producer] of this.producers.entries()) {
            try {
                if (!producer.closed) {
                    producer.close();
                }
            } catch (error) {
                log.warn('Error closing producer during peer cleanup', {
                    producer_id,
                    error: error.message,
                });
            }
        }
        this.producers.clear();

        // Close all transports
        for (const [transport_id, transport] of this.transports.entries()) {
            try {
                if (!transport.closed) {
                    transport.close();
                }
            } catch (error) {
                log.warn('Error closing transport during peer cleanup', {
                    transport_id,
                    error: error.message,
                });
            }
        }
        this.transports.clear();

        log.info('Peer cleanup completed successfully', {
            peer_id: this.id,
            peer_name: this.peer_name,
            transports: this.transports.size,
            producers: this.producers.size,
            consumers: this.consumers.size,
        });
    }
};
