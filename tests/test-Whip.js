'use strict';

require('should');
const express = require('express');
const jwt = require('jsonwebtoken');
const mediasoup = require('mediasoup');

const Room = require('../app/src/Room');
const Peer = require('../app/src/Peer');
const WhipServer = require('../app/src/WhipServer');
const { WhipError } = require('../app/src/WhipServer');
const { parseOffer, buildAnswer, WhipSdpError } = require('../app/src/WhipSdp');
const { assignFallbackPresenter } = require('../app/src/PresenterManager');

const API_SECRET = 'whip-test-secret-0123456789abcdef';
const JWT_KEY = 'k'.repeat(64);
const ROOM_ID = 'whip-room';

const FINGERPRINT = '2E:3D:4C:5B:6A:79:88:97:A6:B5:C4:D3:E2:F1:00:1F:2E:3D:4C:5B:6A:79:88:97:A6:B5:C4:D3:E2:F1:00:1F';

// Offer shaped like the one sent by OBS Studio (libdatachannel): Opus stereo + H264, BUNDLE, actpass
function obsOffer({ setup = 'actpass', video = 'H264/90000', audioDirection = 'sendonly', extra = [] } = {}) {
    return [
        'v=0',
        'o=rtc 3767197920 0 IN IP4 127.0.0.1',
        's=-',
        't=0 0',
        'a=group:BUNDLE 0 1',
        'a=msid-semantic:WMS *',
        `a=setup:${setup}`,
        'a=ice-ufrag:ZKuj',
        'a=ice-pwd:aXJ0Y2hyb21lc2VjcmV0aGVsbG8',
        `a=fingerprint:sha-256 ${FINGERPRINT}`,
        'm=audio 9 UDP/TLS/RTP/SAVPF 111',
        'c=IN IP4 0.0.0.0',
        'a=mid:0',
        `a=${audioDirection}`,
        'a=ssrc:3184534672 cname:obs',
        'a=rtcp-mux',
        'a=rtpmap:111 opus/48000/2',
        'a=fmtp:111 minptime=10;stereo=1;sprop-stereo=1;useinbandfec=1',
        'm=video 9 UDP/TLS/RTP/SAVPF 96',
        'c=IN IP4 0.0.0.0',
        'a=mid:1',
        'a=sendonly',
        'a=ssrc:3184534673 cname:obs',
        'a=rtcp-mux',
        `a=rtpmap:96 ${video}`,
        'a=rtcp-fb:96 nack',
        'a=rtcp-fb:96 nack pli',
        'a=fmtp:96 profile-level-id=42e01f;packetization-mode=1;level-asymmetry-allowed=1',
        ...extra,
        '',
    ].join('\r\n');
}

// Offer sent by the FFmpeg 8+ WHIP muxer: DTLS passive, media-level fingerprints, H264 plain Baseline + RTX
function ffmpegOffer() {
    const media = (kind, mid) => [
        'c=IN IP4 0.0.0.0',
        'a=ice-ufrag:796980c9',
        'a=ice-pwd:72b8c926c874058b921a3b4abc404b42',
        `a=fingerprint:sha-256 ${FINGERPRINT}`,
        'a=setup:passive',
        `a=mid:${mid}`,
        'a=sendonly',
        `a=msid:FFmpeg ${kind}`,
        'a=rtcp-mux',
    ];
    return [
        'v=0',
        'o=FFmpeg 4489045141692799359 2 IN IP4 127.0.0.1',
        's=FFmpegPublishSession',
        't=0 0',
        'a=group:BUNDLE 0 1',
        'a=extmap-allow-mixed',
        'a=msid-semantic: WMS',
        'm=audio 9 UDP/TLS/RTP/SAVPF 111',
        ...media('audio', 0),
        'a=rtpmap:111 opus/48000/2',
        'a=ssrc:2944752571 cname:FFmpeg',
        'm=video 9 UDP/TLS/RTP/SAVPF 106 105',
        ...media('video', 1),
        'a=rtcp-rsize',
        'a=rtpmap:106 H264/90000',
        'a=fmtp:106 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f',
        'a=rtcp-fb:106 nack',
        'a=rtpmap:105 rtx/90000',
        'a=fmtp:105 apt=106',
        'a=ssrc-group:FID 2944752572 2944752573',
        'a=ssrc:2944752572 cname:FFmpeg',
        'a=ssrc:2944752573 cname:FFmpeg',
        '',
    ].join('\r\n');
}

// Example offer from RFC 9725 section 4.2 (max-bundle, bundle-only video, rtcp-mux-only, single msid)
function rfc9725Offer() {
    const stream = 'd46fb922-d52a-4e9c-aa87-444eadc1521b';
    return [
        'v=0',
        'o=- 5228595038118931041 2 IN IP4 127.0.0.1',
        's=-',
        't=0 0',
        'a=group:BUNDLE 0 1',
        'a=extmap-allow-mixed',
        'a=ice-options:trickle ice2',
        'm=audio 9 UDP/TLS/RTP/SAVPF 111',
        'c=IN IP4 0.0.0.0',
        'a=rtcp:9 IN IP4 0.0.0.0',
        'a=ice-ufrag:EsAw',
        'a=ice-pwd:bP+XJMM09aR8AiX1jdukzR6Y',
        'a=fingerprint:sha-256 DA:7B:57:DC:28:CE:04:4F:31:79:85:C4:31:67:EB:27:58:29:ED:77:2A:0D:24:AE:ED:AD:30:BC:BD:F1:9C:02',
        'a=setup:actpass',
        'a=mid:0',
        'a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid',
        'a=sendonly',
        `a=msid:${stream} ce326ecf-a081-453a-8f9f-0605d5ef4128`,
        'a=rtcp-mux',
        'a=rtcp-mux-only',
        'a=rtpmap:111 opus/48000/2',
        'a=fmtp:111 minptime=10;useinbandfec=1',
        'm=video 0 UDP/TLS/RTP/SAVPF 96 97',
        'a=mid:1',
        'a=bundle-only',
        'a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid',
        'a=extmap:10 urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id',
        'a=extmap:11 urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id',
        'a=sendonly',
        `a=msid:${stream} 3956b460-40f4-4d05-acef-03abcdd8c6fd`,
        'a=rtpmap:96 VP8/90000',
        'a=rtcp-fb:96 ccm fir',
        'a=rtcp-fb:96 nack',
        'a=rtcp-fb:96 nack pli',
        'a=rtpmap:97 rtx/90000',
        'a=fmtp:97 apt=96',
        '',
    ].join('\r\n');
}

const routerMediaCodecs = [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
    {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 },
    },
];

function makeIo(emitted) {
    return { to: (id) => ({ emit: (action, data) => emitted.push({ id, action, data }) }) };
}

function makeBrowserPeer(id, name = 'Alice') {
    return new Peer(id, {
        peer_info: { peer_id: id, peer_uuid: `${id}-uuid`, peer_name: name, peer_audio: true, peer_video: true },
    });
}

describe('test-Whip', function () {
    this.timeout(20000);

    let worker;

    before(async () => {
        worker = await mediasoup.createWorker({ logLevel: 'error' });
    });

    after(() => {
        if (worker && !worker.closed) worker.close();
    });

    describe('WhipSdp', () => {
        let router;

        before(async () => {
            router = await worker.createRouter({ mediaCodecs: routerMediaCodecs });
        });

        after(() => router.close());

        it('negotiates an OBS offer into producible rtpParameters and an ICE-lite answer', async () => {
            const offer = parseOffer(obsOffer(), router.rtpCapabilities);
            offer.dtlsParameters.role.should.equal('client');
            offer.sections.map((s) => s.kind).should.eql(['audio', 'video']);
            offer.sections[1].rtpParameters.codecs[0].mimeType.should.equal('video/H264');
            offer.sections[0].rtpParameters.encodings.should.eql([{ ssrc: 3184534672 }]);

            const transport = await router.createWebRtcTransport({
                listenInfos: [{ protocol: 'udp', ip: '127.0.0.1' }],
            });
            const answer = buildAnswer({
                offer,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            });

            answer.should.match(/a=ice-lite/);
            answer.should.match(/a=setup:passive/);
            answer.should.match(/a=recvonly/);
            answer.should.match(/a=group:BUNDLE 0 1/);
            answer.should.match(/a=fingerprint:sha-256 /);
            answer.should.not.match(/a=fingerprint:sha-(384|512) /);
            answer.should.match(/a=fmtp:111 .*stereo=1/);
            answer.should.match(/a=rtpmap:96 H264\/90000/);

            await transport.connect({ dtlsParameters: offer.dtlsParameters });
            for (const section of offer.sections) {
                const producer = await transport.produce({ kind: section.kind, rtpParameters: section.rtpParameters });
                producer.kind.should.equal(section.kind);
            }
            transport.close();
        });

        it('accepts the FFmpeg WHIP offer (passive DTLS, plain Baseline H264 with RTX)', async () => {
            const offer = parseOffer(ffmpegOffer(), router.rtpCapabilities);
            offer.dtlsParameters.role.should.equal('server');

            const video = offer.sections[1].rtpParameters;
            video.codecs
                .map((c) => [c.mimeType, c.payloadType])
                .should.eql([
                    ['video/H264', 106],
                    ['video/rtx', 105],
                ]);
            video.codecs[0].parameters['profile-level-id'].should.equal('42e01f');
            video.encodings.should.eql([{ ssrc: 2944752572, rtx: { ssrc: 2944752573 } }]);

            const transport = await router.createWebRtcTransport({
                listenInfos: [{ protocol: 'udp', ip: '127.0.0.1' }],
            });
            const answer = buildAnswer({
                offer,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            });
            answer.should.match(/a=setup:active/);
            answer.should.match(/a=extmap-allow-mixed/);

            await transport.connect({ dtlsParameters: offer.dtlsParameters });
            for (const section of offer.sections) {
                await transport.produce({ kind: section.kind, rtpParameters: section.rtpParameters });
            }
            transport.close();
        });

        it('answers as DTLS client when the offerer is passive', () => {
            const offer = parseOffer(obsOffer({ setup: 'passive' }), router.rtpCapabilities);
            offer.dtlsParameters.role.should.equal('server');
            const answer = buildAnswer({
                offer,
                iceParameters: { usernameFragment: 'u', password: 'p', iceLite: true },
                iceCandidates: [],
                dtlsParameters: { role: 'auto', fingerprints: [{ algorithm: 'sha-256', value: FINGERPRINT }] },
            });
            answer.should.match(/a=setup:active/);
        });

        it('falls back to MID based binding when the offer has no a=ssrc lines', () => {
            const sdp = obsOffer().replace(/a=ssrc:[^\r]+\r\n/g, '');
            const offer = parseOffer(sdp, router.rtpCapabilities);
            offer.sections[0].rtpParameters.encodings.should.eql([{}]);
            offer.sections[0].rtpParameters.mid.should.equal('0');
        });

        // RFC 9725 example offer shape: "max-bundle" policy, video section is port 0 + a=bundle-only
        const bundleOnlyOffer = () =>
            obsOffer().replace('m=video 9', 'm=video 0').replace('a=mid:1\r\n', 'a=mid:1\r\na=bundle-only\r\n');

        it('accepts bundle-only media sections (max-bundle policy)', async () => {
            const offer = parseOffer(bundleOnlyOffer(), router.rtpCapabilities);
            offer.sections.map((s) => s.kind).should.eql(['audio', 'video']);

            const transport = await router.createWebRtcTransport({
                listenInfos: [{ protocol: 'udp', ip: '127.0.0.1' }],
            });
            const answer = buildAnswer({
                offer,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            });
            answer.should.match(/a=group:BUNDLE 0 1/);
            answer.should.not.match(/m=video 0 /);

            await transport.connect({ dtlsParameters: offer.dtlsParameters });
            for (const section of offer.sections) {
                await transport.produce({ kind: section.kind, rtpParameters: section.rtpParameters });
            }
            transport.close();
        });

        it('rejects bundle-only sections outside the BUNDLE group or without a tagged section', () => {
            expectSdpError(obsOffer().replace('m=video 9', 'm=video 0'), 400, /port 0/);
            expectSdpError(
                bundleOnlyOffer().replace('a=group:BUNDLE 0 1', 'a=group:BUNDLE 0'),
                400,
                /must be in the BUNDLE group/
            );
            expectSdpError(
                bundleOnlyOffer()
                    .replace('m=audio 9', 'm=audio 0')
                    .replace('a=mid:0\r\n', 'a=mid:0\r\na=bundle-only\r\n'),
                400,
                /must not be bundle-only/
            );
        });

        it('requires every media section in a single BUNDLE group (max-bundle)', () => {
            const msg = /exactly one a=group:BUNDLE/;
            expectSdpError(obsOffer().replace('a=group:BUNDLE 0 1\r\n', ''), 400, msg);
            expectSdpError(obsOffer().replace('a=group:BUNDLE 0 1', 'a=group:BUNDLE 0\r\na=group:BUNDLE 1'), 400, msg);
            expectSdpError(
                obsOffer().replace('a=group:BUNDLE 0 1', 'a=group:BUNDLE 0'),
                400,
                /video media section \(mid 1\) must be in the BUNDLE group/
            );

            const audioOnly = obsOffer().split('m=video')[0];
            expectSdpError(audioOnly.replace('a=group:BUNDLE 0 1', 'a=group:BUNDLE 1'), 400, /must be in the BUNDLE/);
            parseOffer(
                audioOnly.replace('a=group:BUNDLE 0 1\r\n', ''),
                router.rtpCapabilities
            ).sections.length.should.equal(1);
        });

        it('requires a=rtcp-mux and a single MediaStream (msid)', () => {
            expectSdpError(obsOffer().replace(/a=rtcp-mux\r\n/g, ''), 400, /must use a=rtcp-mux/);
            expectSdpError(
                obsOffer()
                    .replace('a=mid:0\r\n', 'a=mid:0\r\na=msid:s1 a\r\n')
                    .replace('a=mid:1\r\n', 'a=mid:1\r\na=msid:s2 v\r\n'),
                400,
                /same MediaStream/
            );
            parseOffer(ffmpegOffer(), router.rtpCapabilities).sections.length.should.equal(2);
        });

        it('accepts the RFC 9725 example offer', async () => {
            const offer = parseOffer(rfc9725Offer(), router.rtpCapabilities);
            offer.sections
                .map((s) => [s.kind, s.mid])
                .should.eql([
                    ['audio', '0'],
                    ['video', '1'],
                ]);
            const transport = await router.createWebRtcTransport({
                listenInfos: [{ protocol: 'udp', ip: '127.0.0.1' }],
            });
            const answer = buildAnswer({
                offer,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            });
            answer.should.match(/a=group:BUNDLE 0 1/);
            answer.should.match(/a=recvonly/);
            answer.should.match(/a=rtcp-mux/);
            answer.should.not.match(/a=rtcp-mux-only/); // forbidden in answers (RFC 8858 4.3)
            await transport.connect({ dtlsParameters: offer.dtlsParameters });
            for (const section of offer.sections) {
                await transport.produce({ kind: section.kind, rtpParameters: section.rtpParameters });
            }
            transport.close();
        });

        const expectSdpError = (sdp, status, pattern) => {
            let error;
            try {
                parseOffer(sdp, router.rtpCapabilities);
            } catch (e) {
                error = e;
            }
            (error instanceof WhipSdpError).should.be.true();
            error.status.should.equal(status);
            if (pattern) error.message.should.match(pattern);
        };

        it('rejects invalid or unsupported offers', () => {
            expectSdpError('', 400, /Missing SDP/);
            expectSdpError('v=0\r\ns=-\r\nt=0 0\r\n', 400, /no media/);
            expectSdpError(obsOffer({ audioDirection: 'recvonly' }), 400, /sendonly/);
            expectSdpError(obsOffer().replace('a=mid:1', 'a=mid:0'), 400, /Duplicate a=mid/);
            expectSdpError(obsOffer().replace('m=video', 'm=audio'), 400, /Only one audio/);
            expectSdpError(
                obsOffer({ extra: ['m=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'a=mid:2'] }),
                400,
                /Unsupported media section "application"/
            );
            expectSdpError(obsOffer({ video: 'AV1/90000' }), 422, /No supported video codec/);
            expectSdpError('x'.repeat(70 * 1024), 413);
        });
    });

    describe('WhipServer', () => {
        let room;
        let roomList;
        let emitted;
        let whip;

        const createRoom = async () => {
            const r = await new Room(ROOM_ID, worker, makeIo(emitted)).ready();
            // Independent from the local config.js: plain per-transport UDP listening on loopback
            r.webRtcServerActive = false;
            r.webRtcTransport = { listenInfos: [{ protocol: 'udp', ip: '127.0.0.1' }], iceConsentTimeout: 35 };
            return r;
        };

        beforeEach(async () => {
            emitted = [];
            roomList = new Map();
            room = await createRoom();
            room.addPeer(makeBrowserPeer('socket-1'));
            roomList.set(ROOM_ID, room);
            whip = new WhipServer({
                roomList,
                config: { enabled: true, apiSecret: API_SECRET, maxSessions: 2, maxSessionsPerRoom: 1 },
                jwtKey: JWT_KEY,
            });
        });

        afterEach(async () => {
            whip.closeAll('test cleanup');
            room.close();
        });

        const create = (overrides = {}) =>
            whip.createSession({
                roomId: ROOM_ID,
                sdp: obsOffer(),
                name: 'OBS',
                userAgent: 'OBS-Studio/31.0.0 (linux)',
                ...overrides,
            });

        it('adds the WHIP client to the room as a peer and announces its producers', async () => {
            const { session, answer } = await create();

            answer.should.match(/a=setup:passive/);
            whip.getSessionsCount().should.equal(1);
            room.getPeersCount().should.equal(2);

            const peer = room.getPeer(session.peerId);
            peer.isWhip.should.be.true();
            peer.peer_info.peer_whip.should.be.true();
            peer.peer_info.browser_name.should.equal('OBS-Studio');
            peer.producers.size.should.equal(2);
            whip.isWhipPeer(session.peerId).should.be.true();
            whip.isWhipPeer('socket-1').should.be.false();

            const newProducers = emitted.find((e) => e.action === 'newProducers');
            newProducers.id.should.equal('socket-1');
            newProducers.data.map((p) => p.type).should.eql(['audioType', 'videoType']);
            newProducers.data[0].peer_info.peer_name.should.equal('OBS');
            emitted.some((e) => e.action === 'setVideoOff').should.be.false();
            emitted.find((e) => e.action === 'refreshParticipantsCount').data.peer_counts.should.equal(2);
        });

        it('shows an avatar tile for audio-only sessions and dedupes the display name', async () => {
            room.getPeer('socket-1').peer_name = 'OBS';
            const audioOnly = obsOffer().split('m=video')[0].replace('a=group:BUNDLE 0 1', 'a=group:BUNDLE 0');
            const { session } = await create({ sdp: audioOnly });
            const peer = room.getPeer(session.peerId);
            peer.peer_name.should.equal('OBS (2)');
            peer.peer_info.peer_video.should.be.false();
            emitted.find((e) => e.action === 'setVideoOff').data.peer_id.should.equal(session.peerId);
        });

        it('enforces room state and session limits', async () => {
            await create();
            await create().should.be.rejectedWith(WhipError, { status: 503 });

            room.setJoinLocked(true);
            await create().should.be.rejectedWith(WhipError, { status: 403 });
            room.setJoinLocked(false);

            await whip
                .createSession({ roomId: 'unknown', sdp: obsOffer(), name: 'OBS' })
                .should.be.rejectedWith(WhipError, { status: 404 });

            // A room with nobody in it (created but not joined) is not active
            const emptyRoom = await new Room('empty-room', worker, makeIo([])).ready();
            roomList.set('empty-room', emptyRoom);
            await whip
                .createSession({ roomId: 'empty-room', sdp: obsOffer(), name: 'OBS' })
                .should.be.rejectedWith(WhipError, { status: 404 });
            emptyRoom.close();

            // Failed negotiation releases the reserved slot
            whip.closeAll();
            await create({ sdp: obsOffer({ video: 'AV1/90000' }) }).should.be.rejectedWith(WhipError, {
                status: 422,
            });
            whip.getSessionsCount().should.equal(0);
            room.getPeersCount().should.equal(1);
        });

        it('removes the peer and notifies the room when the session is closed', async () => {
            const { session } = await create();
            emitted.length = 0;

            whip.closeSession(session.id, 'client DELETE').should.be.true();
            whip.closeSession(session.id).should.be.false();

            whip.getSessionsCount().should.equal(0);
            (room.getPeer(session.peerId) === undefined).should.be.true();
            const removeMe = emitted.find((e) => e.action === 'removeMe');
            removeMe.id.should.equal('socket-1');
            removeMe.data.should.containEql({ peer_id: session.peerId, peer_counts: 1 });
        });

        it('rejects a non max-bundle offer without leaving a partial session', async () => {
            await create({ sdp: obsOffer().replace('a=group:BUNDLE 0 1\r\n', '') }).should.be.rejectedWith(WhipError, {
                status: 400,
            });
            whip.getSessionsCount().should.equal(0);
            room.getPeersCount().should.equal(1);
            emitted.length.should.equal(0);
        });

        it('ends WHIP sessions and closes the room when the last participant leaves', async () => {
            const { session } = await create();

            room.removePeer('socket-1');

            whip.getSessionsCount().should.equal(0);
            room.getPeersCount().should.equal(0);
            room.router.closed.should.be.true();
            session.transport.closed.should.be.true();
        });

        describe('ban', () => {
            const credentialOf = (token) =>
                whip.authorize({ headers: { authorization: `Bearer ${token}` } }, ROOM_ID).credential;

            it('kick (eject) does not ban: the same token can publish again', async () => {
                const credential = credentialOf(API_SECRET);
                const { session } = await create({ credential });
                whip.closeSessionByPeerId(session.peerId, 'eject by presenter').should.be.true();
                await create({ credential });
            });

            it('a banned per-room token is rejected until it expires, other tokens still work', async () => {
                const tokenA = whip.createToken({ roomId: ROOM_ID, name: 'A' });
                const tokenB = whip.createToken({ roomId: ROOM_ID, name: 'B' });

                const { session } = await create({ credential: credentialOf(tokenA) });
                whip.closeSessionByPeerId(session.peerId, 'ban by presenter', { ban: true }).should.be.true();
                (room.getPeer(session.peerId) === undefined).should.be.true();

                await create({ credential: credentialOf(tokenA) }).should.be.rejectedWith(WhipError, {
                    status: 403,
                    message: 'Banned from this room',
                });
                whip.closeAll();
                await create({ credential: credentialOf(tokenB) });

                // The ban lasts as long as the token itself (JWT exp)
                [...whip.bans.values()][0].expiresAt.should.be.above(Date.now());
                [...whip.bans.values()][0].expiresAt = Date.now() - 1;
                whip.isBanned(ROOM_ID, credentialOf(tokenA)).should.be.false();
                whip.bans.size.should.equal(0);
            });

            it('a banned server-wide secret is rejected only in that room until the room ends', async () => {
                const credential = credentialOf(API_SECRET);
                const { session } = await create({ credential });
                whip.closeSessionByPeerId(session.peerId, 'ban by presenter', { ban: true });

                await create({ credential }).should.be.rejectedWith(WhipError, { status: 403 });
                whip.isBanned('another-room', credential).should.be.false();

                // Same room name, new meeting: the secret works again
                const nextRoom = await createRoom();
                nextRoom.addPeer(makeBrowserPeer('socket-9'));
                roomList.set(ROOM_ID, nextRoom);
                whip.isBanned(ROOM_ID, credential).should.be.false();
                whip.bans.size.should.equal(0);
                nextRoom.close();
            });

            it('rejects a banned token at the HTTP endpoint', async () => {
                const app = express();
                whip.register(app);
                const server = await new Promise((resolve) => {
                    const s = app.listen(0, '127.0.0.1', () => resolve(s));
                });
                const url = `http://127.0.0.1:${server.address().port}/whip/${ROOM_ID}`;
                const token = whip.createToken({ roomId: ROOM_ID });
                const post = () =>
                    fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${token}` },
                        body: obsOffer(),
                    });
                try {
                    (await post()).status.should.equal(201);
                    const [session] = [...whip.sessions.values()];
                    whip.closeSessionByPeerId(session.peerId, 'ban by presenter', { ban: true });
                    const banned = await post();
                    banned.status.should.equal(403);
                    (await banned.text()).should.equal('Banned from this room');
                } finally {
                    await new Promise((resolve) => server.close(resolve));
                }
            });
        });

        it('never picks a WHIP peer as fallback presenter', async () => {
            const { session } = await create();
            room.getPeer(session.peerId).isWhip.should.be.true();
            room.peers = new Map([[session.peerId, room.getPeer(session.peerId)], ...room.peers]);
            room.getPeer('socket-1').updatePeerInfo = () => {};
            room.sendToAll = () => {};
            assignFallbackPresenter(ROOM_ID, room, {}, true).id.should.equal('socket-1');
        });

        describe('authorization', () => {
            const req = (authorization) => ({ headers: { authorization } });

            it('accepts the server-wide secret and per-room tokens only', () => {
                whip.authorize(req(`Bearer ${API_SECRET}`), ROOM_ID).credential.serverWide.should.be.true();

                const token = whip.createToken({ roomId: ROOM_ID, name: '<b>OBS</b>' });
                whip.authorize(req(`Bearer ${token}`), ROOM_ID).name.should.not.match(/[<>]/);

                (() => whip.authorize(req(`Bearer ${token}`), 'other-room')).should.throw(WhipError, { status: 401 });
                (() => whip.authorize(req(undefined), ROOM_ID)).should.throw(WhipError, { status: 401 });
                (() => whip.authorize(req(API_SECRET), ROOM_ID)).should.throw(WhipError, { status: 401 });
                (() => whip.authorize(req('Bearer wrong'), ROOM_ID)).should.throw(WhipError, { status: 401 });

                const otherScope = jwt.sign({ scope: 'rtmp-stream', roomId: ROOM_ID }, JWT_KEY);
                (() => whip.authorize(req(`Bearer ${otherScope}`), ROOM_ID)).should.throw(WhipError, {
                    status: 401,
                });
                const expired = jwt.sign({ scope: 'whip', roomId: ROOM_ID }, JWT_KEY, { expiresIn: -10 });
                (() => whip.authorize(req(`Bearer ${expired}`), ROOM_ID)).should.throw(WhipError, { status: 401 });
            });

            it('ignores a weak server-wide secret', () => {
                const weak = new WhipServer({
                    roomList,
                    config: { enabled: true, apiSecret: 'short' },
                    jwtKey: JWT_KEY,
                });
                (() => weak.authorize(req('Bearer short'), ROOM_ID)).should.throw(WhipError, { status: 401 });
            });
        });

        describe('HTTP endpoint', () => {
            let server;
            let baseUrl;

            beforeEach((done) => {
                const app = express();
                whip.register(app);
                server = app.listen(0, '127.0.0.1', () => {
                    baseUrl = `http://127.0.0.1:${server.address().port}`;
                    done();
                });
            });

            afterEach((done) => server.close(done));

            const post = (body, headers = {}) =>
                fetch(`${baseUrl}/whip/${ROOM_ID}?name=Studio`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${API_SECRET}`, ...headers },
                    body,
                });

            it('implements the RFC 9725 session lifecycle', async () => {
                const created = await post(obsOffer());
                created.status.should.equal(201);
                created.headers.get('content-type').should.match(/^application\/sdp/);
                const location = created.headers.get('location');
                location.should.match(new RegExp(`^/whip/${ROOM_ID}/[0-9a-f-]{36}$`));
                (await created.text()).should.match(/^v=0/);
                [...room.getPeers().values()].some((p) => p.peer_name === 'Studio').should.be.true();

                (await fetch(`${baseUrl}${location}`, { method: 'PATCH' })).status.should.equal(405);
                (await fetch(`${baseUrl}${location}`, { method: 'DELETE' })).status.should.equal(401);

                const deleted = await fetch(`${baseUrl}${location}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${API_SECRET}` },
                });
                deleted.status.should.equal(200);
                whip.getSessionsCount().should.equal(0);

                const again = await fetch(`${baseUrl}${location}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${API_SECRET}` },
                });
                again.status.should.equal(404);
            });

            it('only lets the creator token or the server-wide secret terminate a session', async () => {
                const owner = whip.createToken({ roomId: ROOM_ID });
                const other = whip.createToken({ roomId: ROOM_ID, name: 'Other' });
                const del = (location, token) =>
                    fetch(`${baseUrl}${location}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });

                let created = await post(obsOffer(), { Authorization: 'Bearer ' + owner });
                created.status.should.equal(201);
                let location = created.headers.get('location');

                (await del(location, other)).status.should.equal(403);
                whip.getSessionsCount().should.equal(1);
                (await del(location, owner)).status.should.equal(200);
                whip.getSessionsCount().should.equal(0);

                created = await post(obsOffer(), { Authorization: 'Bearer ' + owner });
                location = created.headers.get('location');
                (await del(location, API_SECRET)).status.should.equal(200);
                whip.getSessionsCount().should.equal(0);
            });

            it('rejects unauthenticated, non-SDP and invalid requests', async () => {
                const noAuth = await post(obsOffer(), { Authorization: '' });
                noAuth.status.should.equal(401);
                noAuth.headers.get('www-authenticate').should.equal('Bearer');

                (await post(obsOffer(), { 'Content-Type': 'application/json' })).status.should.equal(415);
                (await post('not an sdp')).status.should.equal(400);
                (await fetch(`${baseUrl}/whip/${ROOM_ID}`, { method: 'PUT' })).status.should.equal(405);
                whip.getSessionsCount().should.equal(0);
            });

            it('answers GET with 204 No Content on the endpoint and session URLs', async () => {
                for (const path of [`/whip/${ROOM_ID}`, `/whip/${ROOM_ID}/unknown-session`]) {
                    const res = await fetch(`${baseUrl}${path}`);
                    res.status.should.equal(204);
                    (await res.text()).should.equal('');
                }
            });

            it('advertises Accept-Post on OPTIONS (CORS preflight)', async () => {
                const app = express();
                app.use(whip.getCorsMiddleware());
                whip.register(app);
                const s = await new Promise((resolve) => {
                    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
                });
                try {
                    const res = await fetch(`http://127.0.0.1:${s.address().port}/whip/${ROOM_ID}`, {
                        method: 'OPTIONS',
                        headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' },
                    });
                    res.status.should.be.within(200, 204);
                    res.headers.get('accept-post').should.equal('application/sdp');
                    res.headers.get('access-control-allow-methods').should.match(/POST/);
                } finally {
                    await new Promise((resolve) => s.close(resolve));
                }
            });
        });
    });
});
