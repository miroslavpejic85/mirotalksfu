'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const roomClientSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'RoomClient.js'), 'utf8');

describe('test-DataChannelChatIdentity', () => {
    let RoomClientProto;

    before(() => {
        const context = vm.createContext({
            window: { location: { origin: 'https://localhost:3010' } },
            setTimeout,
            console: { log() {}, info() {}, warn() {}, error() {} },
        });
        vm.runInContext(`${roomClientSource}; globalThis.RoomClientForTest = RoomClient;`, context);
        RoomClientProto = context.RoomClientForTest.prototype;
    });

    function createClient() {
        const shown = [];
        const consumers = [];
        const client = Object.create(RoomClientProto);
        client.peer_id = 'bob-id';
        client.chatDataConsumers = new Map();
        client.chatDataConsumersPending = new Set();
        client._moderator = {};
        client.consumerTransport = {
            id: 'transport-1',
            consumeData: async (params) => {
                const handlers = {};
                const consumer = {
                    id: params.id,
                    on: (event, fn) => (handlers[event] = fn),
                    emit: (event, payload) => handlers[event](payload),
                };
                consumers.push(consumer);
                return consumer;
            },
        };
        client.socket = {
            request: async (event, data) => ({
                id: 'consumer-1',
                dataProducerId: data.dataProducerId,
                label: 'chat',
            }),
        };
        client.showMessage = (msg) => shown.push(msg);
        return { client, shown, consumers };
    }

    it('overrides forged sender identity with the DataProducer owner', async () => {
        const { client, shown, consumers } = createClient();
        await client.consumeData('dp-1', { peer_id: 'bob-id-real', peer_name: 'Bob', peer_avatar: 'bob.png' });

        consumers[0].emit(
            'message',
            JSON.stringify({
                type: 'chat',
                peer_id: 'alice-id',
                peer_name: 'Alice',
                peer_avatar: 'alice.png',
                to_peer_id: 'all',
                to_peer_name: 'all',
                peer_msg: 'hello',
            })
        );

        assert.equal(shown.length, 1);
        assert.equal(shown[0].peer_id, 'bob-id-real');
        assert.equal(shown[0].peer_name, 'Bob');
        assert.equal(shown[0].peer_avatar, 'bob.png');
        assert.equal(shown[0].peer_msg, 'hello');
    });

    it('does not create a DataConsumer without a known producer owner', async () => {
        const { client, consumers } = createClient();
        await client.consumeData('dp-2');
        await client.consumeData('dp-3', { peer_id: 'x' });

        assert.equal(consumers.length, 0);
        assert.equal(client.chatDataConsumers.size, 0);
    });
});
