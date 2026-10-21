'use strict';

function isConfiguredPresenter(authenticatedUsername, presenterList) {
    return (
        typeof authenticatedUsername === 'string' &&
        authenticatedUsername.length > 0 &&
        Array.isArray(presenterList) &&
        presenterList.includes(authenticatedUsername)
    );
}

// OIDC identities usable in presenters.list: the verified email (case-insensitive) or the stable `sub`
function isOidcConfiguredPresenter(oidcUser, presenterList) {
    if (!oidcUser || !Array.isArray(presenterList) || presenterList.length === 0) return false;

    const { email, email_verified: emailVerified, sub } = oidcUser;
    const lowerList = presenterList.map((entry) => String(entry).toLowerCase());

    if (typeof sub === 'string' && sub.length > 0 && presenterList.includes(sub)) return true;

    return (
        typeof email === 'string' &&
        email.length > 0 &&
        emailVerified !== false &&
        emailVerified !== 'false' &&
        lowerList.includes(email.toLowerCase())
    );
}

function assignFallbackPresenter(roomId, room, presenters, joinFirst) {
    if (!joinFirst || !room || roomId.includes('_breakout_') || room.getPeersCount() === 0) return null;

    if (!(roomId in presenters)) presenters[roomId] = {};
    if (Object.keys(presenters[roomId]).length > 0) return null;

    const peer = [...room.getPeers().values()].find((candidate) => !candidate.peer_lobby);
    if (!peer) return null;

    presenters[roomId][peer.id] = {
        peer_ip: peer.peer_info?.peer_ip || '',
        peer_name: peer.peer_name,
        peer_uuid: peer.peer_uuid,
        is_presenter: true,
    };

    peer.updatePeerInfo({ type: 'presenter', status: true });
    room.sendToAll('setPresenterRole', {
        peer_id: peer.id,
        peer_name: peer.peer_name,
        is_presenter: true,
        from_peer_name: 'Room',
    });

    return peer;
}

module.exports = { assignFallbackPresenter, isConfiguredPresenter, isOidcConfiguredPresenter };
