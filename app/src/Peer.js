'use strict';

const Logger = require('./Logger');
const log = new Logger('Peer');

module.exports = class Peer {
    constructor(socket_id, data) {
        const { peer_info } = data;

        const {
            peer_uuid,
            peer_name,
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
        if (!this.transports.has(transport_id)) {
            throw new Error(`Transport with ID ${transport_id} not found`);
        }

        try {
            await this.transports.get(transport_id).connect({
                dtlsParameters: dtlsParameters,
            });
        } catch (error) {
            log.error(`Failed to connect transport with ID ${transport_id}`, error);
            throw new Error(`Failed to connect transport with ID ${transport_id}`);
        }

        return true;
    }

    close() {
        this.transports.forEach((transport, transport_id) => {
            try {
                transport.close();
                this.delTransport(transport_id);
                log.debug('Closed and deleted peer transport', {
                    transportInternal: transport.internal,
                    transport_closed: transport.closed,
                });
            } catch (error) {
                log.warn(`Error closing transport with ID ${transport_id}`, error.message);
            }
        });

        const peerTransports = this.getTransports();
        const peerProducers = this.getProducers();
        const peerConsumers = this.getConsumers();

        log.debug('CLOSE PEER - CHECK TRANSPORTS | PRODUCERS | CONSUMERS', {
            peer_id: this.id,
            peer_name: this.peer_name,
            peerTransports: peerTransports,
            peerProducers: peerProducers,
            peerConsumers: peerConsumers,
        });
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
        if (!this.transports.has(producerTransportId)) {
            throw new Error(`Producer transport with ID ${producerTransportId} not found`);
        }

        const producerTransport = this.transports.get(producerTransportId);

        let producer;
        try {
            producer = await producerTransport.produce({
                kind: producer_kind,
                rtpParameters: producer_rtpParameters,
            });
        } catch (error) {
            log.error(`Error creating producer for transport ID ${producerTransportId}:`, error);
            throw new Error(`Failed to create producer for transport ID ${producerTransportId}`);
        }

        const { id, appData, type, kind, rtpParameters } = producer;

        appData.mediaType = producer_type;

        this.addProducer(id, producer);

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
            log.debug('Producer ----->', { type, kind });
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
        const { id, kind, type, appData } = producer;

        try {
            producer.close();
        } catch (error) {
            log.warn('Close Producer', error.message);
        }

        this.delProducer(producer_id);

        log.debug('Producer closed and deleted', {
            peer_name: this.peer_name,
            kind: kind,
            type: type,
            appData: appData,
            producer_id: id,
            producer_closed: producer.closed,
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
        if (!this.transports.has(consumer_transport_id)) {
            throw new Error(`Consumer transport with ID ${consumer_transport_id} not found`);
        }

        const consumerTransport = this.transports.get(consumer_transport_id);

        let consumer;
        try {
            consumer = await consumerTransport.consume({
                producerId,
                rtpCapabilities,
                enableRtx: true, // Enable NACK for OPUS.
                paused: true,
                ignoreDtx: true,
            });
        } catch (error) {
            log.error(`Error creating consumer for transport ID ${consumer_transport_id}`, error);
            throw new Error(`Failed to create consumer for transport ID ${consumer_transport_id}`);
        }

        const { id, type, kind, rtpParameters, producerPaused } = consumer;

        this.addConsumer(id, consumer);

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
            log.debug('Consumer ----->', { type, kind });
        }

        consumer.on('transportclose', () => {
            log.debug('Consumer "transportclose" event', { consumerId: id });
            this.removeConsumer(id);
        });

        return {
            consumer: consumer,
            params: {
                producerId,
                id: id,
                kind: kind,
                rtpParameters: rtpParameters,
                type: type,
                producerPaused: producerPaused,
            },
        };
    }

    removeConsumer(consumer_id) {
        if (!this.consumers.has(consumer_id)) return;

        const consumer = this.getConsumer(consumer_id);
        const { id, kind, type } = consumer;

        try {
            consumer.close();
        } catch (error) {
            log.warn('Close Consumer', error.message);
        }

        this.delConsumer(consumer_id);

        log.debug('Consumer closed and deleted', {
            peer_name: this.peer_name,
            kind: kind,
            type: type,
            consumer_id: id,
            consumer_closed: consumer.closed,
        });
    }
};
