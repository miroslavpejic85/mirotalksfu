'use strict';

require('should');

const Peer = require('../app/src/Peer');

describe('test-Peer', () => {
    const createPeer = () =>
        new Peer('peer-id', {
            peer_info: {
                peer_uuid: 'peer-uuid',
                peer_name: 'Peer',
            },
        });

    const createConsumer = (id, producerId, appData) => ({
        id,
        producerId,
        kind: 'audio',
        type: 'simple',
        rtpParameters: {},
        producerPaused: false,
        closed: false,
        appData,
        once: () => {},
    });

    it('classifies a missing consumer transport as a transient lifecycle race', async () => {
        const peer = createPeer();

        let consumeError;
        try {
            await peer.createConsumer('stale-transport-id', 'producer-id', {});
        } catch (error) {
            consumeError = error;
        }

        consumeError.should.have.property('code', 'CONSUMER_TRANSPORT_NOT_FOUND');
        consumeError.should.have.property('transient', true);
        consumeError.should.have.property('retryable', false);
    });

    it('reuses a consumer on the same transport when an acknowledgement is retried', async () => {
        const peer = createPeer();
        let consumeCalls = 0;
        peer.transports.set('transport-id', {
            consume: async (options) => {
                consumeCalls++;
                return createConsumer('consumer-id', options.producerId, options.appData);
            },
        });

        const first = await peer.createConsumer('transport-id', 'producer-id', {});
        const retry = await peer.createConsumer('transport-id', 'producer-id', {});

        consumeCalls.should.equal(1);
        first.reused.should.equal(false);
        retry.reused.should.equal(true);
        retry.consumer.should.equal(first.consumer);
    });

    it('does not reuse a consumer from a different transport', async () => {
        const peer = createPeer();
        let consumeCalls = 0;
        for (const transportId of ['transport-1', 'transport-2']) {
            peer.transports.set(transportId, {
                consume: async (options) => {
                    consumeCalls++;
                    return createConsumer(`consumer-${consumeCalls}`, options.producerId, options.appData);
                },
            });
        }

        const first = await peer.createConsumer('transport-1', 'producer-id', {});
        const second = await peer.createConsumer('transport-2', 'producer-id', {});

        consumeCalls.should.equal(2);
        second.reused.should.equal(false);
        second.consumer.should.not.equal(first.consumer);
    });

    it('deduplicates concurrent consumer creation on the same transport', async () => {
        const peer = createPeer();
        let consumeCalls = 0;
        let releaseConsume;
        const consumeGate = new Promise((resolve) => {
            releaseConsume = resolve;
        });
        peer.transports.set('transport-id', {
            consume: async (options) => {
                consumeCalls++;
                await consumeGate;
                return createConsumer('consumer-id', options.producerId, options.appData);
            },
        });

        const firstPromise = peer.createConsumer('transport-id', 'producer-id', {});
        const secondPromise = peer.createConsumer('transport-id', 'producer-id', {});
        releaseConsume();
        const [first, second] = await Promise.all([firstPromise, secondPromise]);

        consumeCalls.should.equal(1);
        first.reused.should.equal(false);
        second.reused.should.equal(true);
        second.consumer.should.equal(first.consumer);
    });

    it('allows retry after consumer creation fails', async () => {
        const peer = createPeer();
        let consumeCalls = 0;
        peer.transports.set('transport-id', {
            consume: async (options) => {
                consumeCalls++;
                if (consumeCalls === 1) throw new Error('temporary failure');
                return createConsumer('consumer-id', options.producerId, options.appData);
            },
        });

        await peer.createConsumer('transport-id', 'producer-id', {}).should.be.rejected();
        const retry = await peer.createConsumer('transport-id', 'producer-id', {});

        consumeCalls.should.equal(2);
        retry.reused.should.equal(false);
    });

    it('uses zero-based preferred indexes for scalable consumers', async () => {
        const peer = createPeer();
        let preferredLayers;
        peer.transports.set('transport-id', {
            consume: async (options) => ({
                ...createConsumer('consumer-id', options.producerId, options.appData),
                type: 'svc',
                kind: 'video',
                rtpParameters: { encodings: [{ scalabilityMode: 'L3T3_KEY' }] },
                setPreferredLayers: async (layers) => {
                    preferredLayers = layers;
                },
            }),
        });

        await peer.createConsumer('transport-id', 'producer-id', {});

        preferredLayers.should.deepEqual({ spatialLayer: 2, temporalLayer: 2 });
    });

    it('closes a consumer that resolves after the peer has closed', async () => {
        const peer = createPeer();
        let releaseConsume;
        let lateConsumer;
        const consumeGate = new Promise((resolve) => {
            releaseConsume = resolve;
        });
        const transport = {
            closed: false,
            close() {
                this.closed = true;
            },
            consume: async (options) => {
                await consumeGate;
                lateConsumer = {
                    ...createConsumer('consumer-id', options.producerId, options.appData),
                    close() {
                        this.closed = true;
                    },
                };
                return lateConsumer;
            },
        };
        peer.transports.set('transport-id', transport);

        const creation = peer.createConsumer('transport-id', 'producer-id', {});
        peer.close();
        releaseConsume();

        await creation.should.be.rejected();
        lateConsumer.closed.should.equal(true);
        peer.consumers.size.should.equal(0);
        peer.consumerCreatePromises.size.should.equal(0);
    });
});
