'use strict';

require('should');

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
});
