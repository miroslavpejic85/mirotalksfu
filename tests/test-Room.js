'use strict';

require('should');
const sinon = require('sinon');
const { EventEmitter } = require('events');

const Room = require('../app/src/Room');

describe('test-Room', () => {
    describe('room time limit', () => {
        const makeRoom = () => {
            const room = Object.create(Room.prototype);
            room.id = 'room-id';
            room.peers = new Map([
                ['peer-1', {}],
                ['peer-2', {}],
            ]);
            room._timeLimit = null;
            room.sent = [];
            room.disconnected = [];
            room.send = (peer_id, action, data) => room.sent.push({ peer_id, action, data });
            room.io = { in: (peer_id) => ({ disconnectSockets: () => room.disconnected.push(peer_id) }) };
            return room;
        };

        let clock;
        beforeEach(() => {
            clock = sinon.useFakeTimers({ now: 1000000 });
        });
        afterEach(() => clock.restore());

        it('parses only valid HH:MM:SS durations', () => {
            Room.parseDuration('00:00:30').should.equal(30000);
            Room.parseDuration('01:02:03').should.equal(3723000);
            Room.parseDuration('99:59:59').should.equal(359999000);
            Room.parseDuration('00:00:00').should.equal(0);
            Room.parseDuration('00:60:00').should.equal(0);
            Room.parseDuration('00:00:60').should.equal(0);
            Room.parseDuration('1:00:00').should.equal(0);
            Room.parseDuration('unlimited').should.equal(0);
            Room.parseDuration(undefined).should.equal(0);
            Room.parseDuration(3600).should.equal(0);
        });

        it('starts once, reports the remaining time and ignores later requests', () => {
            const room = makeRoom();
            (room.getTimeLimit() === null).should.equal(true);

            room.startTimeLimit('00:10:00').should.equal(true);
            clock.tick(60000);
            room.getTimeLimit().should.eql({ durationMs: 600000, remainingMs: 540000, reached: false });

            // A later presenter cannot shorten or extend it
            room.startTimeLimit('00:00:05').should.equal(false);
            room.getTimeLimit().remainingMs.should.equal(540000);
        });

        it('notifies everyone when the time is up and disconnects remaining peers after the grace period', () => {
            const room = makeRoom();
            room.startTimeLimit('00:00:30');

            clock.tick(29999);
            room.isTimeLimitReached().should.equal(false);
            room.sent.length.should.equal(0);

            clock.tick(1);
            room.isTimeLimitReached().should.equal(true);
            room.getTimeLimit().remainingMs.should.equal(0);
            room.sent.should.eql([
                { peer_id: 'peer-1', action: 'roomTimeLimit', data: { action: 'end' } },
                { peer_id: 'peer-2', action: 'roomTimeLimit', data: { action: 'end' } },
            ]);

            room.peers.delete('peer-1'); // left on its own
            clock.tick(15000);
            room.disconnected.should.eql(['peer-2']);
        });

        it('clears the timers when the room closes', () => {
            const room = makeRoom();
            room.startTimeLimit('00:00:30');
            room.clearTimeLimit();
            clock.tick(60000);
            (room.getTimeLimit() === null).should.equal(true);
            room.sent.length.should.equal(0);
            room.disconnected.length.should.equal(0);
        });
    });
    it('clears screen annotations when a producer closes because its transport closed', async () => {
        const room = Object.create(Room.prototype);
        room.videoTextAnnotations = new Map([['producer-id', new Map([['a', {}]])]]);
        room.videoDrawingAnnotations = new Map([['producer-id', new Map([['d', {}]])]]);
        room.videoDrawingPermissions = new Map([['producer-id', false]]);
        room.peers = new Map();
        room.broadCast = () => {};

        const observer = new EventEmitter();
        const producer = { id: 'producer-id', paused: false, appData: {}, observer };
        const peer = {
            peer_name: 'Peer',
            peer_info: {},
            hasTransport: () => true,
            getTransport: () => ({ iceState: 'connected', dtlsState: 'connected' }),
            createProducer: async () => producer,
        };
        room.peers.set('socket-id', peer);

        (await room.produce('socket-id', 'transport-id', { codecs: [] }, 'video', 'screenType')).should.equal(
            'producer-id'
        );

        observer.emit('close');

        room.videoTextAnnotations.has('producer-id').should.equal(false);
        room.videoDrawingAnnotations.has('producer-id').should.equal(false);
        room.videoDrawingPermissions.has('producer-id').should.equal(false);
    });

    it('persists presenter-only screen annotation moderation', () => {
        const room = Object.create(Room.prototype);
        room._moderator = { screen_annotations_cant_draw: false };

        room.updateRoomModerator({ type: 'screen_annotations_cant_draw', status: true });

        room._moderator.screen_annotations_cant_draw.should.equal(true);
    });

    it('persists the start-without-noise-suppression moderation for late joiners', () => {
        const room = Object.create(Room.prototype);
        room._moderator = { noise_suppression_start_off: false };

        room.updateRoomModerator({ type: 'noise_suppression_start_off', status: true });

        room._moderator.noise_suppression_start_off.should.equal(true);
    });

    it('includes persistent annotations with an existing screen producer', () => {
        const room = Object.create(Room.prototype);
        const textAnnotation = {
            type: 'text',
            action: 'create',
            producerId: 'screen-producer-id',
            annotationId: 'annotation-id',
            text: 'Review this\nmultiline note',
            x: 0.25,
            y: 0.5,
            color: '#ffeb3b',
            fontSize: 24,
            bold: true,
            italic: true,
            boxWidth: 0.5,
            underline: true,
            strikethrough: true,
            textAlign: 'center',
            backgroundColor: '#1a237e',
            rotation: 15,
        };
        const drawingAnnotation = {
            type: 'annotation',
            action: 'create',
            producerId: 'screen-producer-id',
            annotationId: 'drawing-id',
            drawerId: 'drawer-id',
            tool: 'circle',
            color: '#ff0000',
            width: 0.004,
            points: [
                { x: 0.25, y: 0.5 },
                { x: 0.4, y: 0.5 },
            ],
        };
        room.videoTextAnnotations = new Map([
            ['screen-producer-id', new Map([[textAnnotation.annotationId, textAnnotation]])],
        ]);
        room.videoDrawingAnnotations = new Map([
            ['screen-producer-id', new Map([[drawingAnnotation.annotationId, drawingAnnotation]])],
        ]);
        room.videoDrawingPermissions = new Map([['screen-producer-id', false]]);
        room.peers = new Map([
            [
                'screen-owner-id',
                {
                    peer_name: 'Owner',
                    peer_info: { peer_id: 'screen-owner-id' },
                    producers: new Map([
                        ['screen-producer-id', { id: 'screen-producer-id', appData: { mediaType: 'screenType' } }],
                    ]),
                },
            ],
            ['joining-peer-id', { producers: new Map() }],
        ]);

        const producers = room.getProducerListForPeer('joining-peer-id');

        producers.should.have.length(1);
        producers[0].text_annotations.should.deepEqual([textAnnotation]);
        producers[0].drawing_annotations.should.deepEqual([drawingAnnotation]);
        producers[0].annotations_allowed.should.equal(false);
        room.clearVideoDrawingAnnotations('screen-producer-id');
        room.videoDrawingPermissions.size.should.equal(0);
        room.getProducerListForPeer('joining-peer-id')[0].annotations_allowed.should.equal(true);
    });

    it('recognizes only active screenType producers as screen shares', () => {
        const room = Object.create(Room.prototype);
        const producer = { appData: { mediaType: 'screenType' } };

        room.getProducerById = () => producer;
        room.isScreenProducer('screen-producer-id').should.equal(true);

        producer.appData.mediaType = 'videoType';
        room.isScreenProducer('video-producer-id').should.equal(false);

        room.getProducerById = () => null;
        room.isScreenProducer('missing-producer-id').should.equal(false);
    });

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

    it('preserves the transient classification for a stale consumer transport', async () => {
        const room = Object.create(Room.prototype);
        const transportError = new Error('Consumer transport with ID stale-transport-id not found');
        transportError.code = 'CONSUMER_TRANSPORT_NOT_FOUND';
        transportError.transient = true;
        transportError.retryable = false;
        const peer = {
            peer_name: 'Consumer',
            getProducer: () => ({ id: 'producer-id' }),
            createConsumer: async () => {
                throw transportError;
            },
        };

        room.peers = new Map([['consumer-peer-id', peer]]);
        room.router = { canConsume: () => true };

        let consumeError;
        try {
            await room.consume('consumer-peer-id', 'stale-transport-id', 'producer-id', {}, 'audioType');
        } catch (error) {
            consumeError = error;
        }

        consumeError.should.have.property('code', 'CONSUMER_TRANSPORT_NOT_FOUND');
        consumeError.should.have.property('transient', true);
        consumeError.should.have.property('retryable', false);
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
