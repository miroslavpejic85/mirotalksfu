'use strict';

require('should');

const sinon = require('sinon');
const { assignFallbackPresenter } = require('../app/src/PresenterManager');

describe('PresenterManager', () => {
    function createPeer(id, name, lobby = false) {
        return {
            id,
            peer_name: name,
            peer_uuid: `${id}-uuid`,
            peer_lobby: lobby,
            peer_info: { peer_ip: '127.0.0.1' },
            updatePeerInfo: sinon.spy(),
        };
    }

    function createRoom(peers) {
        return {
            getPeers: () => new Map(peers.map((peer) => [peer.id, peer])),
            getPeersCount: () => peers.length,
            sendToAll: sinon.spy(),
        };
    }

    it('promotes the first admitted peer when the room loses its last presenter', () => {
        const lobbyPeer = createPeer('lobby-peer', 'Waiting', true);
        const admittedPeer = createPeer('admitted-peer', 'Participant');
        const room = createRoom([lobbyPeer, admittedPeer]);
        const presenters = { room1: {} };

        const promotedPeer = assignFallbackPresenter('room1', room, presenters, true);

        promotedPeer.should.equal(admittedPeer);
        admittedPeer.updatePeerInfo.calledOnceWithExactly({ type: 'presenter', status: true }).should.be.true();
        lobbyPeer.updatePeerInfo.notCalled.should.be.true();
        presenters.room1['admitted-peer'].is_presenter.should.be.true();
        room.sendToAll.calledOnceWithExactly('setPresenterRole', {
            peer_id: 'admitted-peer',
            peer_name: 'Participant',
            is_presenter: true,
            from_peer_name: 'Room',
        }).should.be.true();
    });

    it('does not promote a peer when automatic first-presenter assignment is disabled', () => {
        const peer = createPeer('peer-id', 'Participant');
        const room = createRoom([peer]);

        const promotedPeer = assignFallbackPresenter('room1', room, { room1: {} }, false);

        (promotedPeer === null).should.be.true();
        peer.updatePeerInfo.notCalled.should.be.true();
        room.sendToAll.notCalled.should.be.true();
    });

    it('does not assign fallback presenters in breakout rooms', () => {
        const peer = createPeer('peer-id', 'Participant');
        const room = createRoom([peer]);

        const promotedPeer = assignFallbackPresenter('room1_breakout_1', room, { room1_breakout_1: {} }, true);

        (promotedPeer === null).should.be.true();
        peer.updatePeerInfo.notCalled.should.be.true();
        room.sendToAll.notCalled.should.be.true();
    });
});