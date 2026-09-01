'use strict';

require('should');
const { EventEmitter } = require('events');

const Room = require('../app/src/Room');

describe('test-Room', () => {
    it('classifies a stale producer without asking the router to consume it', async () => {
        const room = Object.create(Room.prototype);
        let canConsumeCalled = false;

        room.peers = new Map([
            [
                'consumer-peer-id',
                {
                    peer_name: 'Consumer',
                    getProducer: () => undefined,
                },
            ],
        ]);
        room.router = {
            canConsume: () => {
                canConsumeCalled = true;
                return false;
            },
        };

        let consumeError;
        try {
            await room.consume('consumer-peer-id', 'transport-id', 'stale-producer-id', {}, 'audioType');
        } catch (error) {
            consumeError = error;
        }

        consumeError.should.have.property('code', 'PRODUCER_NOT_FOUND');
        consumeError.should.have.property('retryable', false);
        canConsumeCalled.should.equal(false);
    });

    it('removes and reports a data consumer when its data producer closes', async () => {
        const room = Object.create(Room.prototype);
        const dataConsumer = Object.assign(new EventEmitter(), {
            id: 'data-consumer-id',
            label: 'chat',
        });
        let removedConsumerId;
        let notification;
        const peer = {
            peer_name: 'Consumer',
            createDataConsumer: async () => ({
                dataConsumer,
                params: { id: dataConsumer.id },
            }),
            removeDataConsumer: (id) => {
                removedConsumerId = id;
            },
            getTransport: () => ({ iceState: 'connected', dtlsState: 'connected' }),
        };

        room.peers = new Map([['consumer-peer-id', peer]]);
        room.send = (socketId, action, data) => {
            notification = { socketId, action, data };
        };

        await room.consumeData('consumer-peer-id', 'transport-id', 'data-producer-id');
        dataConsumer.emit('dataproducerclose');

        removedConsumerId.should.equal(dataConsumer.id);
        notification.should.deepEqual({
            socketId: 'consumer-peer-id',
            action: 'dataConsumerClosed',
            data: { dataConsumer_id: dataConsumer.id },
        });
    });

    it('does not become ready until its router has been created', async () => {
        const room = Object.create(Room.prototype);
        let resolveRouter;
        const router = { observer: new EventEmitter() };
        room.worker = {
            createRouter: () =>
                new Promise((resolve) => {
                    resolveRouter = resolve;
                }),
        };
        room.routerSettings = { mediaCodecs: [] };
        room.audioLevelObserverEnabled = false;
        room.activeSpeakerObserverEnabled = false;
        room.id = 'room-id';
        room.routerReady = room.createTheRouter();

        let ready = false;
        const readiness = room.ready().then(() => {
            ready = true;
        });
        await Promise.resolve();
        ready.should.equal(false);

        resolveRouter(router);
        await readiness;
        ready.should.equal(true);
        room.router.should.equal(router);
    });

    it('applies minimum bitrate and cleans up a transport through its observer', async () => {
        const room = Object.create(Room.prototype);
        let minimumBitrate;
        let removedTransportId;
        let notification;
        const transport = Object.assign(new EventEmitter(), {
            id: 'transport-id',
            type: 'webrtc',
            closed: false,
            iceParameters: {},
            iceCandidates: [],
            dtlsParameters: {},
            sctpParameters: {},
            observer: new EventEmitter(),
            setMinOutgoingBitrate: async (bitrate) => {
                minimumBitrate = bitrate;
            },
        });
        const peer = {
            peer_name: 'Peer',
            addTransport: () => {},
            delTransport: (id) => {
                removedTransportId = id;
            },
        };
        room.router = { createWebRtcTransport: async () => transport };
        room.peers = new Map([['peer-id', peer]]);
        room.webRtcServerActive = false;
        room.webRtcTransport = {
            listenInfos: [{ protocol: 'udp', ip: '127.0.0.1' }],
            minimumAvailableOutgoingBitrate: 1000000,
        };
        room.send = (socketId, action, data) => {
            notification = { socketId, action, data };
        };

        await room.createWebRtcTransport('peer-id');
        minimumBitrate.should.equal(1000000);
        transport.closed = true;
        transport.observer.emit('close');

        removedTransportId.should.equal(transport.id);
        notification.should.deepEqual({
            socketId: 'peer-id',
            action: 'transportClosed',
            data: { transport_id: transport.id },
        });
    });
});
