'use strict';

/**
 * Server-side enforcement of presenter eject/ban actions.
 *
 * The 'peerAction' / 'cmd' notification only asks the target client to leave: a modified client can ignore it
 * and keep its socket, media objects and chat access. After a grace period (letting a regular client show its
 * notice and leave on its own) the server drops the target socket, which runs the regular disconnect cleanup.
 */

const FORCED_EXIT_GRACE_MS = 8000;

/**
 * Socket ids a presenter eject/ban/ejectAll notification applies to (never the sender).
 * Broadcast notifications reach every peer except data.peer_id, mirroring Room.broadCast.
 */
function getForcedExitTargets(room, senderId, data) {
    if (!room || !data) return [];
    const ids = data.broadcast ? [...room.getPeers().keys()].filter((id) => id !== data.peer_id) : [data.peer_id];
    return ids.filter((id) => typeof id === 'string' && id !== senderId && room.getPeer(id));
}

/**
 * Disconnect each target socket after the grace period unless it already left.
 * socket.disconnect(true) is intended here: a removed peer must not auto-reconnect.
 */
function scheduleForcedDisconnect(io, room, peerIds, reason, log, delayMs = FORCED_EXIT_GRACE_MS) {
    for (const peerId of peerIds) {
        const timer = setTimeout(() => {
            const peer = room.getPeer(peerId);
            const socket = io.sockets.sockets.get(peerId);
            if (!peer || !socket || socket.room_id !== room.id) return;
            log?.debug('Peer did not exit after eject/ban, closing its socket', { peer_id: peerId, reason });
            socket.disconnect(true);
        }, delayMs);
        timer.unref?.();
    }
}

module.exports = { FORCED_EXIT_GRACE_MS, getForcedExitTargets, scheduleForcedDisconnect };
