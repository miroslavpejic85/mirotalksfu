'use strict';

/**
 * WHIP - WebRTC-HTTP Ingestion Protocol (RFC 9725) server.
 *
 * Lets any WHIP client (OBS Studio, FFmpeg, GStreamer, Larix, vMix, browser libraries...)
 * publish audio/video into an active room. Each WHIP session shows up in the room as a
 * receive-only "virtual peer", so participants consume it like any other camera.
 *
 *   POST   /whip/:roomId              SDP offer -> 201 + SDP answer + Location
 *   DELETE /whip/:roomId/:sessionId   Terminate the session
 *   PATCH  /whip/:roomId/:sessionId   405 (no trickle ICE / ICE restart, ICE-lite server)
 *
 * Authorization: "Bearer <token>" where token is either the server-wide WHIP apiSecret or a
 * per-room JWT minted by the REST API (POST /api/v1/whip).
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const nodeCrypto = require('node:crypto');
const { v4: uuidv4 } = require('uuid');
const Peer = require('./Peer');
const checkXSS = require('./XSS');
const Validator = require('./Validator');
const Logger = require('./Logger');
const { parseOffer, buildAnswer, WhipSdpError, MAX_SDP_LENGTH } = require('./WhipSdp');

const log = new Logger('Whip');

const WHIP_PATH = '/whip';
const TOKEN_SCOPE = 'whip';
const JWT_VERIFY_OPTIONS = { algorithms: ['HS256'] };
const MIN_API_SECRET_LENGTH = 16;
const DEFAULT_PEER_NAME = 'WHIP';
const MAX_PEER_NAME_LENGTH = 32;
const CONNECT_TIMEOUT_MS = 30000;
const EXPOSED_HEADERS = 'Location, Link, ETag';

class WhipError extends Error {
    constructor(status, message, headers = {}) {
        super(message);
        this.name = 'WhipError';
        this.status = status;
        this.headers = headers;
    }
}

function safeCompare(provided, expected) {
    const a = Buffer.from(String(provided));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length) return false;
    return nodeCrypto.timingSafeEqual(a, b);
}

function getBearerToken(req) {
    const header = req.headers?.authorization;
    if (typeof header !== 'string') return null;
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
}

function sanitizeName(name) {
    if (typeof name !== 'string') return '';
    const clean = checkXSS(name)
        .replace(/[\u0000-\u001F\u007F<>"'`]/g, '')
        .trim()
        .slice(0, MAX_PEER_NAME_LENGTH)
        .trim();
    return clean;
}

// "OBS-Studio/31.0.0 (linux)" -> { name: 'OBS-Studio', version: '31.0.0' }
function parseUserAgent(userAgent) {
    const ua = typeof userAgent === 'string' ? userAgent.slice(0, 256) : '';
    const match = ua.match(/^([A-Za-z0-9._-]+)(?:\/([A-Za-z0-9._-]+))?/);
    return {
        userAgent: checkXSS(ua),
        name: match ? match[1] : 'WHIP',
        version: match && match[2] ? match[2] : '',
    };
}

function normalizeConfig(cfg = {}) {
    const apiSecret = typeof cfg.apiSecret === 'string' ? cfg.apiSecret : '';
    return {
        enabled: cfg.enabled === true,
        apiSecret: apiSecret.length >= MIN_API_SECRET_LENGTH ? apiSecret : '',
        weakApiSecret: apiSecret.length > 0 && apiSecret.length < MIN_API_SECRET_LENGTH,
        tokenExpire: cfg.tokenExpire || '4h',
        maxSessions: Math.max(parseInt(cfg.maxSessions, 10) || 5, 1),
        maxSessionsPerRoom: Math.max(parseInt(cfg.maxSessionsPerRoom, 10) || 1, 1),
        maxIncomingBitrate: Math.max(parseInt(cfg.maxIncomingBitrate, 10) || 6000000, 100000),
    };
}

module.exports = class WhipServer {
    /**
     * @param {object} options
     * @param {Map} options.roomList - Active rooms (room_id -> Room)
     * @param {object} options.config - config.media.whip
     * @param {string} options.jwtKey - Key used to sign/verify per-room WHIP tokens
     */
    constructor({ roomList, config, jwtKey }) {
        this.roomList = roomList;
        this.cfg = normalizeConfig(config);
        this.jwtKey = jwtKey;
        this.sessions = new Map(); // sessionId -> session
        this.bans = new Map(); // `${roomId}:${credentialHash}` -> { room, expiresAt }

        if (this.cfg.enabled && this.cfg.weakApiSecret) {
            log.warn(`WHIP_API_SECRET ignored: it must be at least ${MIN_API_SECRET_LENGTH} characters long`);
        }
    }

    get enabled() {
        return this.cfg.enabled;
    }

    isWhipPath(path) {
        return this.enabled && typeof path === 'string' && path.startsWith(`${WHIP_PATH}/`);
    }

    // WHIP clients running in browsers need DELETE/PATCH preflights and to read the Location header.
    getCorsOptions(baseCorsOptions = {}) {
        return {
            origin: baseCorsOptions.origin || '*',
            methods: ['POST', 'DELETE', 'PATCH', 'OPTIONS'],
            allowedHeaders: ['Authorization', 'Content-Type', 'If-Match'],
            exposedHeaders: EXPOSED_HEADERS.split(', '),
        };
    }

    // ####################################################
    // AUTH
    // ####################################################

    createToken({ roomId, name, expire } = {}) {
        if (!Validator.isValidRoomName(roomId)) {
            throw new WhipError(400, 'Invalid room name');
        }
        const payload = { scope: TOKEN_SCOPE, roomId: String(roomId) };
        const peerName = sanitizeName(name);
        if (peerName) payload.name = peerName;
        return jwt.sign(payload, this.jwtKey, { expiresIn: expire || this.cfg.tokenExpire });
    }

    // Returns the token claims plus a credential fingerprint used for bans, or throws a 401.
    authorize(req, roomId) {
        const token = getBearerToken(req);
        const unauthorized = () => new WhipError(401, 'Unauthorized', { 'WWW-Authenticate': 'Bearer' });

        if (!token) throw unauthorized();

        const hash = nodeCrypto.createHash('sha256').update(token).digest('hex');

        if (this.cfg.apiSecret && safeCompare(token, this.cfg.apiSecret)) {
            return { credential: { hash, serverWide: true, expiresAt: Infinity } };
        }

        if (this.jwtKey) {
            try {
                const decoded = jwt.verify(token, this.jwtKey, JWT_VERIFY_OPTIONS);
                if (decoded?.scope === TOKEN_SCOPE && decoded.roomId === String(roomId)) {
                    const expiresAt = decoded.exp ? decoded.exp * 1000 : Infinity;
                    return { name: decoded.name, credential: { hash, serverWide: false, expiresAt } };
                }
            } catch (error) {
                log.debug('WHIP token rejected', { error: error.message });
            }
        }

        throw unauthorized();
    }

    // ####################################################
    // BANS
    // ####################################################

    // A per-room token stays banned until it expires. The server-wide secret is shared by every
    // room, so its ban only applies to the current room instance (lifted when the room ends).
    banCredential(room, credential) {
        if (!credential?.hash) return;
        this.pruneBans();
        this.bans.set(`${room.id}:${credential.hash}`, {
            room: credential.serverWide ? room : null,
            expiresAt: credential.expiresAt,
        });
    }

    isBanned(roomId, credential) {
        if (!credential?.hash) return false;
        this.pruneBans();
        return this.bans.has(`${roomId}:${credential.hash}`);
    }

    pruneBans() {
        const now = Date.now();
        for (const [key, ban] of this.bans) {
            const roomId = key.slice(0, key.lastIndexOf(':'));
            const roomEnded = ban.room && this.roomList.get(roomId) !== ban.room;
            if (ban.expiresAt <= now || roomEnded) this.bans.delete(key);
        }
    }

    // ####################################################
    // HTTP ROUTES
    // ####################################################

    register(app, { limiter } = {}) {
        if (!this.enabled) return;

        const rateLimit = limiter || ((req, res, next) => next());
        const sdpParser = express.text({ type: 'application/sdp', limit: MAX_SDP_LENGTH });

        app.post(`${WHIP_PATH}/:roomId`, rateLimit, sdpParser, (req, res) => this.handlePost(req, res));
        app.delete(`${WHIP_PATH}/:roomId/:sessionId`, rateLimit, (req, res) => this.handleDelete(req, res));
        app.patch(`${WHIP_PATH}/:roomId/:sessionId`, (req, res) => this.methodNotAllowed(res, 'DELETE'));
        app.all(`${WHIP_PATH}/:roomId/:sessionId`, (req, res) => this.methodNotAllowed(res, 'DELETE'));
        app.all(`${WHIP_PATH}/:roomId`, (req, res) => this.methodNotAllowed(res, 'POST'));

        log.info('WHIP ingestion enabled', {
            endpoint: `${WHIP_PATH}/:roomId`,
            maxSessions: this.cfg.maxSessions,
            maxSessionsPerRoom: this.cfg.maxSessionsPerRoom,
            maxIncomingBitrate: this.cfg.maxIncomingBitrate,
            apiSecret: Boolean(this.cfg.apiSecret),
        });
    }

    methodNotAllowed(res, allow) {
        res.set('Allow', allow).status(405).type('text/plain').send('Method Not Allowed');
    }

    sendError(res, error) {
        const isWhipError = error instanceof WhipError;
        const status = (isWhipError && error.status) || 500;
        if (!isWhipError) log.error('WHIP request failed', { error: error.message });
        res.set((isWhipError && error.headers) || {})
            .status(status)
            .type('text/plain')
            .send(isWhipError ? error.message : 'Internal Server Error');
    }

    async handlePost(req, res) {
        try {
            const { roomId } = req.params;
            if (!Validator.isValidRoomName(roomId)) throw new WhipError(400, 'Invalid room name');

            const claims = this.authorize(req, roomId);

            if (!req.is('application/sdp')) {
                throw new WhipError(415, 'Content-Type must be application/sdp', { 'Accept-Post': 'application/sdp' });
            }

            const name = sanitizeName(claims.name) || sanitizeName(req.query?.name) || DEFAULT_PEER_NAME;

            const { session, answer } = await this.createSession({
                roomId,
                sdp: typeof req.body === 'string' ? req.body : '',
                name,
                userAgent: req.headers['user-agent'],
                credential: claims.credential,
            });

            res.set({
                Location: `${WHIP_PATH}/${encodeURIComponent(roomId)}/${session.id}`,
                ETag: `"${session.id}"`,
            })
                .status(201)
                .type('application/sdp')
                .send(answer);
        } catch (error) {
            this.sendError(res, error);
        }
    }

    handleDelete(req, res) {
        try {
            const { roomId, sessionId } = req.params;
            if (!Validator.isValidRoomName(roomId)) throw new WhipError(400, 'Invalid room name');

            this.authorize(req, roomId);

            const session = this.sessions.get(sessionId);
            if (!session || session.roomId !== roomId) throw new WhipError(404, 'Session not found');

            this.closeSession(sessionId, 'client DELETE');
            res.status(200).type('text/plain').send('OK');
        } catch (error) {
            this.sendError(res, error);
        }
    }

    // ####################################################
    // SESSIONS
    // ####################################################

    getSessionsCount() {
        return this.sessions.size;
    }

    getRoomSessionsCount(roomId) {
        let count = 0;
        for (const session of this.sessions.values()) {
            if (session.roomId === roomId) count++;
        }
        return count;
    }

    isWhipPeer(peerId) {
        return typeof peerId === 'string' && this.getSessionByPeerId(peerId) !== null;
    }

    getSessionByPeerId(peerId) {
        for (const session of this.sessions.values()) {
            if (session.peerId === peerId) return session;
        }
        return null;
    }

    getUniquePeerName(room, name) {
        const names = new Set([...room.getPeers().values()].map((peer) => peer.peer_name));
        if (!names.has(name)) return name;
        for (let i = 2; i < 100; i++) {
            const candidate = `${name.slice(0, MAX_PEER_NAME_LENGTH - 5)} (${i})`;
            if (!names.has(candidate)) return candidate;
        }
        return `${name.slice(0, MAX_PEER_NAME_LENGTH - 9)}-${uuidv4().slice(0, 8)}`;
    }

    getTransportOptions(room) {
        const options = { ...room.getWebRtcTransportOptions() };
        delete options.maxSendMessageSize;
        delete options.maxReceiveMessageSize;
        const roomMax = options.maxIncomingBitrate;
        return {
            ...options,
            enableSctp: false,
            maxIncomingBitrate: roomMax ? Math.min(roomMax, this.cfg.maxIncomingBitrate) : this.cfg.maxIncomingBitrate,
        };
    }

    async createSession({ roomId, sdp, name, userAgent, credential = null }) {
        const room = this.roomList.get(roomId);

        // A WHIP client can only publish into a room someone is already in: it never creates rooms.
        if (!room || !room.hasNonWhipPeers()) {
            throw new WhipError(404, 'Room not found or not active');
        }
        if (this.isBanned(roomId, credential)) {
            throw new WhipError(403, 'Banned from this room');
        }
        if (room.isJoinLocked()) {
            throw new WhipError(403, 'Room is locked');
        }
        if (room.getPeersCount() >= room.maxParticipants) {
            throw new WhipError(403, 'Room is full');
        }
        if (this.sessions.size >= this.cfg.maxSessions) {
            throw new WhipError(503, 'Maximum number of WHIP sessions reached', { 'Retry-After': '30' });
        }
        if (this.getRoomSessionsCount(roomId) >= this.cfg.maxSessionsPerRoom) {
            throw new WhipError(503, 'Maximum number of WHIP sessions for this room reached', {
                'Retry-After': '30',
            });
        }

        await room.ready();

        let offer;
        try {
            offer = parseOffer(sdp, room.getRtpCapabilities());
        } catch (error) {
            if (error instanceof WhipSdpError) throw new WhipError(error.status, error.message);
            throw error;
        }

        const sessionId = uuidv4();
        const peerId = `whip-${sessionId}`;
        const ua = parseUserAgent(userAgent);
        const kinds = offer.sections.map((s) => s.kind);
        const peerName = this.getUniquePeerName(room, name);

        const peer = new Peer(peerId, {
            peer_info: {
                join_data_time: new Date().toISOString(),
                join_tz_offset: 0,
                peer_uuid: sessionId,
                peer_id: peerId,
                peer_name: peerName,
                peer_avatar: false,
                peer_token: false,
                peer_presenter: false,
                peer_audio: kinds.includes('audio'),
                peer_audio_volume: 100,
                peer_video: kinds.includes('video'),
                peer_screen: false,
                peer_recording: false,
                peer_video_privacy: false,
                peer_hand: false,
                peer_lobby: false,
                peer_whip: true,
                is_desktop_device: true,
                is_mobile_device: false,
                is_tablet_device: false,
                is_ipad_pro_device: false,
                os_name: 'WHIP',
                os_version: '',
                browser_name: ua.name,
                browser_version: ua.version,
                user_agent: ua.userAgent,
            },
        });
        peer.isWhip = true;

        // Reserve the slot right away so concurrent requests cannot exceed the limits.
        const session = {
            id: sessionId,
            roomId,
            room,
            peerId,
            peer,
            credential,
            transport: null,
            timers: new Set(),
            createdAt: Date.now(),
            closed: false,
        };
        this.sessions.set(sessionId, session);

        try {
            const transport = await room.router.createWebRtcTransport(this.getTransportOptions(room));
            session.transport = transport;
            peer.addTransport(transport);
            this.watchTransport(session);

            const answer = buildAnswer({
                offer,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            });

            await transport.connect({ dtlsParameters: offer.dtlsParameters });

            const producers = [];
            for (const section of offer.sections) {
                const mediaType = section.kind === 'audio' ? 'audioType' : 'videoType';
                const producer = await peer.createProducer(
                    transport.id,
                    section.rtpParameters,
                    section.kind,
                    mediaType
                );
                producers.push(producer);
            }

            // The room may have been closed (last participant left) while negotiating.
            if (session.closed || this.roomList.get(roomId) !== room || room.router.closed) {
                throw new WhipError(404, 'Room not found or not active');
            }

            room.addPeer(peer);
            await this.announce(session, producers);

            log.info('WHIP session created', {
                session_id: sessionId,
                room_id: roomId,
                peer_name: peerName,
                kinds,
                user_agent: ua.userAgent,
                sessions: this.sessions.size,
            });

            return { session, answer };
        } catch (error) {
            this.closeSession(sessionId, 'setup failed');
            if (error instanceof WhipError) throw error;
            log.error('WHIP session setup failed', { room_id: roomId, error: error.message });
            throw new WhipError(500, 'Failed to create WHIP session');
        }
    }

    watchTransport(session) {
        const { transport, room } = session;
        const iceConsentTimeout = (room.webRtcTransport?.iceConsentTimeout || 35) * 1000;
        let iceTimer = null;

        const clearIceTimer = () => {
            if (iceTimer) {
                clearTimeout(iceTimer);
                session.timers.delete(iceTimer);
                iceTimer = null;
            }
        };

        // The client must complete ICE + DTLS shortly after receiving the answer.
        const connectTimer = setTimeout(() => {
            session.timers.delete(connectTimer);
            if (transport.dtlsState !== 'connected') {
                log.warn('WHIP session never connected, closing', { session_id: session.id });
                this.closeSession(session.id, 'connect timeout');
            }
        }, CONNECT_TIMEOUT_MS);
        session.timers.add(connectTimer);

        transport.on('icestatechange', (iceState) => {
            if (iceState === 'disconnected') {
                clearIceTimer();
                iceTimer = setTimeout(() => {
                    session.timers.delete(iceTimer);
                    iceTimer = null;
                    if (transport.iceState === 'disconnected') {
                        this.closeSession(session.id, 'ICE disconnected');
                    }
                }, iceConsentTimeout);
                session.timers.add(iceTimer);
            } else {
                clearIceTimer();
                if (iceState === 'closed') this.closeSession(session.id, 'ICE closed');
            }
        });

        transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'connected') {
                log.debug('WHIP session connected', { session_id: session.id, peer_name: session.peer.peer_name });
            } else if (dtlsState === 'failed' || dtlsState === 'closed') {
                this.closeSession(session.id, `DTLS ${dtlsState}`);
            }
        });

        // Covers router close (room ended) and peer cleanup done by the Room itself.
        transport.observer.once('close', () => this.closeSession(session.id, 'transport closed'));
    }

    async announce(session, producers) {
        const { room, peer, peerId } = session;
        const { peer_name, peer_info } = peer;

        for (const producer of producers) {
            producer.observer.once('close', () => {
                room.clearVideoTextAnnotations(producer.id);
                room.clearVideoDrawingAnnotations(producer.id);
            });
            if (producer.kind === 'audio') {
                await Promise.all([
                    room.addProducerToAudioLevelObserver({ producerId: producer.id }),
                    room.addProducerToActiveSpeakerObserver({ producerId: producer.id }),
                ]);
            }
        }

        if (!peer_info.peer_video) {
            room.broadCast(peerId, 'setVideoOff', peer_info);
        }

        room.broadCast(
            peerId,
            'newProducers',
            producers.map((producer) => ({
                producer_id: producer.id,
                producer_socket_id: peerId,
                peer_name,
                peer_info,
                type: producer.appData.mediaType,
            }))
        );

        room.broadCast(peerId, 'refreshParticipantsCount', {
            room_id: room.id,
            peer_counts: room.getPeersCount(),
        });
    }

    closeSessionByPeerId(peerId, reason, options) {
        const session = this.getSessionByPeerId(peerId);
        return session ? this.closeSession(session.id, reason, options) : false;
    }

    // options.ban: also reject the session's credential for this room (see banCredential)
    closeSession(sessionId, reason = '', { ban = false } = {}) {
        const session = this.sessions.get(sessionId);
        if (!session || session.closed) return false;

        if (ban) this.banCredential(session.room, session.credential);

        session.closed = true;
        this.sessions.delete(sessionId);
        session.timers.forEach((timer) => clearTimeout(timer));
        session.timers.clear();

        const { room, roomId, peer, peerId } = session;

        // When the Room is already tearing the peer down (peer.closed) there is nobody left to notify.
        if (!peer.closed && room.getPeer(peerId) === peer) {
            room.removePeer(peerId);
            room.broadCast(peerId, 'removeMe', {
                room_id: roomId,
                peer_id: peerId,
                peer_name: peer.peer_name,
                peer_counts: room.getPeersCount(),
                isPresenter: false,
            });
            if (room.getPeersCount() === 0 && this.roomList.get(roomId) === room) {
                this.roomList.delete(roomId);
            }
        } else {
            peer.close();
        }

        log.info('WHIP session closed', {
            session_id: sessionId,
            room_id: roomId,
            peer_name: peer.peer_name,
            reason,
            banned: ban,
            duration_sec: Math.round((Date.now() - session.createdAt) / 1000),
            sessions: this.sessions.size,
        });
        return true;
    }

    closeAll(reason = 'shutdown') {
        for (const sessionId of [...this.sessions.keys()]) {
            this.closeSession(sessionId, reason);
        }
    }
};

module.exports.WhipError = WhipError;
module.exports.WHIP_PATH = WHIP_PATH;
