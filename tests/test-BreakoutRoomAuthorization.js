'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'Server.js'), 'utf8');
const handlersSource = serverSource.slice(
    serverSource.indexOf('        // Security: breakout operations are always bound'),
    serverSource.indexOf(
        '        // ####################################################\n        // BREAKOUT ROOMS END'
    )
);
const presenterSource = serverSource.slice(
    serverSource.indexOf('    function isPeerPresenter('),
    serverSource.indexOf('    async function isAuthPeer(')
);

describe('Socket.IO breakout room authorization', () => {
    function makeRoom(id, peerList = []) {
        const peers = new Map(peerList.map((p) => [p.id, p]));
        return {
            id,
            getPeers: () => peers,
            getPeersCount: () => peers.size,
            getPeer: (peerId) => peers.get(peerId),
            sendToAll: sinon.spy(),
            sendTo: sinon.spy(),
        };
    }

    function setup(socketRoomId, socketId = 'attacker-socket') {
        const rooms = {
            victimSecret: makeRoom('victimSecret', [{ id: 'victim-presenter', peer_name: 'VictimHost' }]),
            victimSecret_breakout_1: makeRoom('victimSecret_breakout_1', [
                { id: 'victim-participant', peer_name: 'VictimUser' },
            ]),
            attackerOwnRoom: makeRoom('attackerOwnRoom', [{ id: 'attacker-socket', peer_name: 'Attacker' }]),
            attackerOwnRoom_breakout_1: makeRoom('attackerOwnRoom_breakout_1', [
                { id: 'attacker-participant', peer_name: 'AttackerUser' },
            ]),
        };
        const roomList = new Map(Object.entries(rooms));
        const presenters = {
            victimSecret: {
                'victim-presenter': { peer_name: 'VictimHost', peer_uuid: 'victim-uuid', is_presenter: true },
            },
            attackerOwnRoom: {
                'attacker-socket': { peer_name: 'Attacker', peer_uuid: 'attacker-uuid', is_presenter: true },
            },
        };
        const handlers = {};
        const socket = { id: socketId, room_id: socketRoomId, on: (event, handler) => (handlers[event] = handler) };
        const context = vm.createContext({
            socket,
            roomList,
            presenters,
            log: { debug() {}, warn() {}, error() {} },
            checkXSS: (data) => data,
            roomExists: (s) => roomList.has(s.room_id),
            getRoom: (s) => roomList.get(s.room_id) || null,
            getPeer: (s) => roomList.get(s.room_id)?.getPeer(s.id) || null,
        });
        vm.runInContext(`${presenterSource}\n${handlersSource}`, context);
        return { handlers, rooms };
    }

    const attacker = { peer_name: 'Attacker', peer_uuid: 'attacker-uuid' };

    it('does not leak another meeting breakout participants', async () => {
        const { handlers } = setup('attackerOwnRoom');
        const result = await new Promise((resolve) =>
            handlers.getBreakoutRoomsInfo({ mainRoom: 'victimSecret' }, resolve)
        );
        assert.deepEqual(JSON.parse(JSON.stringify(result.map((r) => r.room))), ['attackerOwnRoom_breakout_1']);
        assert.ok(!JSON.stringify(result).includes('VictimUser'));
    });

    it('returns nothing to non-presenters', async () => {
        const { handlers } = setup('victimSecret', 'victim-participant');
        const result = await new Promise((resolve) =>
            handlers.getBreakoutRoomsInfo({ mainRoom: 'victimSecret' }, resolve)
        );
        assert.equal(result.length, 0);
    });

    it('ignores breakoutRoomEnd for a foreign mainRoom', async () => {
        const { handlers, rooms } = setup('attackerOwnRoom');
        await handlers.breakoutRoomEnd({ ...attacker, mainRoom: 'victimSecret' });
        assert.equal(rooms.victimSecret_breakout_1.sendToAll.called, false);
        assert.ok(
            rooms.attackerOwnRoom_breakout_1.sendToAll.calledWith('breakoutRoomEnd', { mainRoom: 'attackerOwnRoom' })
        );
    });

    it('ignores breakoutRoomCountdown for a foreign mainRoom', async () => {
        const { handlers, rooms } = setup('attackerOwnRoom');
        await handlers.breakoutRoomCountdown({ ...attacker, mainRoom: 'victimSecret', countdown: 10 });
        assert.equal(rooms.victimSecret_breakout_1.sendToAll.called, false);
    });

    it('ignores breakoutRoomBroadcast to a foreign targetRoom or mainRoom', async () => {
        const { handlers, rooms } = setup('attackerOwnRoom');
        await handlers.breakoutRoomBroadcast({
            ...attacker,
            mainRoom: 'victimSecret',
            targetRoom: 'victimSecret_breakout_1',
            message: 'forged',
        });
        await handlers.breakoutRoomBroadcast({ ...attacker, mainRoom: 'victimSecret', message: 'forged' });
        assert.equal(rooms.victimSecret_breakout_1.sendToAll.called, false);
        assert.ok(rooms.attackerOwnRoom_breakout_1.sendToAll.calledOnce);
    });

    it('still lets the presenter broadcast to its own breakout room', async () => {
        const { handlers, rooms } = setup('victimSecret', 'victim-presenter');
        await handlers.breakoutRoomBroadcast({
            peer_name: 'VictimHost',
            peer_uuid: 'victim-uuid',
            mainRoom: 'victimSecret',
            targetRoom: 'victimSecret_breakout_1',
            message: 'hello',
        });
        assert.ok(
            rooms.victimSecret_breakout_1.sendToAll.calledWith('breakoutRoomMessage', {
                peer_name: 'VictimHost',
                message: 'hello',
            })
        );
    });

    it('routes help requests only to the sender breakout main room', async () => {
        const { handlers, rooms } = setup('attackerOwnRoom');
        await handlers.breakoutRoomHelp({ mainRoom: 'victimSecret', peer_name: 'Spoof', breakoutRoom: 'evil' });
        assert.equal(rooms.victimSecret.sendToAll.called, false);

        const inBreakout = setup('victimSecret_breakout_1', 'victim-participant');
        await inBreakout.handlers.breakoutRoomHelp({ mainRoom: 'other', peer_name: 'Spoof', breakoutRoom: 'evil' });
        assert.ok(
            inBreakout.rooms.victimSecret.sendToAll.calledWith('breakoutRoomHelp', {
                peer_name: 'VictimUser',
                breakoutRoom: 'victimSecret_breakout_1',
            })
        );
    });

    it('drops breakout assignments that point outside the presenter room', async () => {
        const { handlers, rooms } = setup('attackerOwnRoom');
        await handlers.breakoutRoom({
            ...attacker,
            mainRoom: 'victimSecret',
            assignments: [
                { peerId: 'p1', breakoutRoom: 'victimSecret_breakout_1' },
                { peerId: 'p2', breakoutRoom: 'attackerOwnRoom_breakout_1' },
            ],
        });
        const room = rooms.attackerOwnRoom;
        assert.equal(room.sendTo.callCount, 1);
        assert.equal(room.sendTo.firstCall.args[0], 'p2');
        assert.equal(room.sendTo.firstCall.args[2].mainRoom, 'attackerOwnRoom');
    });
});
