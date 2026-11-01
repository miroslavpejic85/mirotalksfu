'use strict';

require('should');

const { FORCED_EXIT_GRACE_MS, getForcedExitTargets, scheduleForcedDisconnect } = require('../app/src/ForcedExit');

describe('test-ForcedExit', () => {
    function createRoom(ids, roomId = 'room1') {
        const peers = new Map(ids.map((id) => [id, { id }]));
        return { id: roomId, peers, getPeers: () => peers, getPeer: (id) => peers.get(id) };
    }

    function createIo(room, ids) {
        const sockets = new Map(
            ids.map((id) => [
                id,
                {
                    room_id: room.id,
                    disconnected: 0,
                    disconnect() {
                        this.disconnected++;
                    },
                },
            ])
        );
        return { sockets: { sockets }, getSocket: (id) => sockets.get(id) };
    }

    describe('getForcedExitTargets', () => {
        it('targets the single peer of a direct eject/ban', () => {
            const room = createRoom(['alice', 'bob', 'carol']);
            getForcedExitTargets(room, 'alice', { peer_id: 'bob' }).should.deepEqual(['bob']);
        });

        it('targets everyone except the excluded peer and the sender on broadcast', () => {
            const room = createRoom(['alice', 'bob', 'carol']);
            getForcedExitTargets(room, 'alice', { broadcast: true, peer_id: 'alice' }).should.deepEqual([
                'bob',
                'carol',
            ]);
        });

        it('never targets the sender nor unknown or invalid peers', () => {
            const room = createRoom(['alice', 'bob']);
            getForcedExitTargets(room, 'alice', { peer_id: 'alice' }).should.deepEqual([]);
            getForcedExitTargets(room, 'alice', { peer_id: 'ghost' }).should.deepEqual([]);
            getForcedExitTargets(room, 'alice', { peer_id: { $ne: 1 } }).should.deepEqual([]);
            getForcedExitTargets(room, 'alice', undefined).should.deepEqual([]);
        });
    });

    describe('scheduleForcedDisconnect', () => {
        it('uses a grace period long enough for a regular client to show its notice and leave', () => {
            FORCED_EXIT_GRACE_MS.should.be.greaterThan(5000);
        });

        it('disconnects a target that ignored the notification', async () => {
            const room = createRoom(['alice', 'bob']);
            const io = createIo(room, ['alice', 'bob']);
            scheduleForcedDisconnect(io, room, ['bob'], 'eject', null, 10);
            await new Promise((r) => setTimeout(r, 40));
            io.getSocket('bob').disconnected.should.equal(1);
            io.getSocket('alice').disconnected.should.equal(0);
        });

        it('does nothing when the target already left the room', async () => {
            const room = createRoom(['alice', 'bob']);
            const io = createIo(room, ['alice', 'bob']);
            scheduleForcedDisconnect(io, room, ['bob'], 'ban', null, 10);
            room.peers.delete('bob');
            await new Promise((r) => setTimeout(r, 40));
            io.getSocket('bob').disconnected.should.equal(0);
        });

        it('does nothing when the socket now belongs to another room', async () => {
            const room = createRoom(['alice', 'bob']);
            const io = createIo(room, ['alice', 'bob']);
            io.getSocket('bob').room_id = 'other';
            scheduleForcedDisconnect(io, room, ['bob'], 'eject', null, 10);
            await new Promise((r) => setTimeout(r, 40));
            io.getSocket('bob').disconnected.should.equal(0);
        });
    });
});
