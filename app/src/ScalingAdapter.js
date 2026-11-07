'use strict';

/**
 * MiroTalk SFU specifics for the generic scaling module (./scaling).
 * The module itself knows nothing about MiroTalk: routes, room naming and host
 * protection are plugged in from here by Server.js.
 */

const BREAKOUT_SEPARATOR = '_breakout_';

function safeDecode(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
}

// Room id of the HTTP entry points that must be served by the node hosting the room
function getRoutedRoomId(req) {
    const path = req.path || '';
    if (req.method === 'GET') {
        if (path === '/join' || path === '/join/') {
            return typeof req.query?.room === 'string' ? req.query.room : null;
        }
        const match = path.match(/^\/join\/([^/]+)\/?$/) || path.match(/^\/whoAreYou\/([^/]+)\/?$/);
        return match ? safeDecode(match[1]) : null;
    }
    if (req.method === 'POST') {
        const match = path.match(/^\/whip\/([^/]+)\/?$/);
        return match ? safeDecode(match[1]) : null;
    }
    return null;
}

// Breakout rooms share in-memory state with their main room, so they must live on the same node
function getPlacementRoomId(roomId) {
    const index = roomId.indexOf(BREAKOUT_SEPARATOR);
    return index > 0 ? roomId.slice(0, index) : roomId;
}

// Room info published in the node snapshot (cluster-wide /activeRooms, /stats)
function describeRoom(room) {
    return {
        peers: room?.getPeersCount?.() ?? 0,
        broadcasting: Boolean(room?.isBroadcasting?.()),
    };
}

// Host protection: a host login (authorized IP) on any node unlocks the rooms on every node
async function shareHostLogins(scaling, authHost, hostCfg) {
    const setLocal = authHost.setAuthorizedIP.bind(authHost);
    const deleteLocal = authHost.deleteIP.bind(authHost);

    const shared = await scaling.createSharedSet('hostauth', {
        onAdd: (ip) => {
            setLocal(ip, true);
            if (hostCfg.protected) hostCfg.authenticated = true;
        },
        onRemove: (ip) => {
            deleteLocal(ip);
            if (hostCfg.protected) hostCfg.authenticated = false;
        },
    });
    if (!shared) return false;

    authHost.setAuthorizedIP = (ip, authorized) => {
        setLocal(ip, authorized);
        shared.add(ip);
    };
    authHost.deleteIP = (ip) => {
        const deleted = deleteLocal(ip);
        shared.remove(ip);
        return deleted;
    };
    return true;
}

module.exports = { getRoutedRoomId, getPlacementRoomId, describeRoom, shareHostLogins };
