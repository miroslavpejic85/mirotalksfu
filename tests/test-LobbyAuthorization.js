'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'Server.js'), 'utf8');

const gateStart = serverSource.indexOf('        socket.use((packet, next) => {');
const gateEnd = serverSource.indexOf("        socket.on('clientError',");
const gateSource = serverSource.slice(gateStart, gateEnd);

const lobbyStart = serverSource.indexOf("        socket.on('roomLobby',");
const lobbyEnd = serverSource.indexOf('        // BREAKOUT ROOMS');
const roomLobbySource = serverSource.slice(lobbyStart, lobbyEnd);

describe('test-LobbyAuthorization', () => {
    describe('socket event gate', () => {
        function setup(peer) {
            let gate;
            const log = { warn: sinon.spy(), debug: sinon.spy() };
            const context = vm.createContext({
                socket: { id: 'peer-1', room_id: 'room-1', use: (fn) => (gate = fn) },
                PRE_JOIN_EVENTS: new Set(['createRoom', 'checkPeerName', 'join', 'clientError', 'error']),
                LOBBY_ALLOWED_EVENTS: new Set(['exitRoom']),
                roomExists: () => true,
                getPeer: () => peer,
                isPeerInLobby: (p) => Boolean(p && p.peer_lobby === true),
                log,
            });
            vm.runInContext(gateSource, context);
            return gate;
        }

        it('blocks every room event from a lobby peer except exitRoom', () => {
            const gate = setup({ peer_lobby: true });

            for (const event of ['message', 'fileInfo', 'file', 'getRoomInfo', 'whiteboardObject', 'createPoll']) {
                const next = sinon.spy();
                const ack = sinon.spy();
                gate([event, {}, ack], next);
                assert.equal(next.called, false, `${event} must be blocked`);
                assert.equal(ack.firstCall.args[0].error, 'In lobby');
            }

            const next = sinon.spy();
            gate(['exitRoom', null, () => {}], next);
            assert.equal(next.calledOnce, true);
        });

        it('lets admitted peers use room events', () => {
            const gate = setup({ peer_lobby: false });
            const next = sinon.spy();
            gate(['message', {}], next);
            assert.equal(next.calledOnce, true);
        });
    });

    describe('roomLobby decline', () => {
        function setup(lobbyPeers) {
            let handler;
            const room = {
                id: 'room-1',
                peers: new Map(Object.entries(lobbyPeers)),
                getPeer(id) {
                    return this.peers.get(id);
                },
                removePeer: sinon.spy(function (id) {
                    this.peers.delete(id);
                }),
                getPresenterPeers: () => [],
                sendTo: sinon.spy(),
                toJson: () => ({}),
            };
            const context = vm.createContext({
                socket: {
                    id: 'host',
                    room_id: 'room-1',
                    on: (event, fn) => {
                        if (event === 'roomLobby') handler = fn;
                    },
                },
                roomExists: () => true,
                checkXSS: (d) => d,
                getRoom: () => room,
                isPeerPresenter: () => true,
                handleJoinWebHook: () => {},
                log: { debug: () => {}, warn: () => {} },
            });
            room.peers.set('host', { peer_lobby: false, peer_info: {} });
            vm.runInContext(roomLobbySource, context);
            return { handler, room };
        }

        it('removes a declined lobby peer from the room', () => {
            const { handler, room } = setup({ bob: { peer_lobby: true } });
            handler({ peer_id: 'bob', lobby_status: 'reject' });
            assert.equal(room.removePeer.calledOnceWithExactly('bob'), true);
        });

        it('never removes an already admitted peer on reject', () => {
            const { handler, room } = setup({ alice: { peer_lobby: false } });
            handler({ peer_id: 'alice', lobby_status: 'reject' });
            assert.equal(room.removePeer.called, false);
        });
    });
});
