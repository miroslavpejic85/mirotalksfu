'use strict';

require('should');

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const roomClientSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'RoomClient.js'), 'utf8');

describe('test-Lobby', () => {
    let lobbyAction;

    before(() => {
        const context = vm.createContext({});
        vm.runInContext(`${roomClientSource}; globalThis.RoomClientForTest = RoomClient;`, context);
        lobbyAction = context.RoomClientForTest.prototype.lobbyAction;
    });

    it('preserves a Socket.IO peer ID ending with an underscore', () => {
        const peerId = 'AbCdEf12345_';
        const client = {
            room_id: 'room-1',
            lobbyPears: {
                [peerId]: { peer_name: 'Participant' },
            },
            socket: { emit: sinon.spy() },
            lobbyRemovePear: sinon.spy(),
        };

        lobbyAction.call(client, { dataset: { peerId: peerId } }, 'accept');

        client.socket.emit
            .calledOnceWithExactly('roomLobby', {
                room_id: 'room-1',
                peer_id: peerId,
                peer_name: 'Participant',
                lobby_status: 'accept',
                broadcast: true,
            })
            .should.be.true();
        client.lobbyRemovePear.calledOnceWithExactly(peerId).should.be.true();
    });

    it('ignores an action for a stale lobby entry', () => {
        const client = {
            lobbyPears: {},
            socket: { emit: sinon.spy() },
            lobbyRemovePear: sinon.spy(),
        };

        lobbyAction.call(client, { dataset: { peerId: 'missing-peer' } }, 'accept');

        client.socket.emit.notCalled.should.be.true();
        client.lobbyRemovePear.notCalled.should.be.true();
    });
});
