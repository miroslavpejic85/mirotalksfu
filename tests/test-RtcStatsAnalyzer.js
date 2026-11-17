'use strict';

require('should');

const { analyzeDump, estimateMos, rateMetric, parseUserAgent } = require('../public/js/RtcStatsAnalyzer');

const T0 = 1_700_000_000_000;

// Builds a getStats trace: `build(i)` returns the stats object of sample i (1 s apart).
function statsTrace(samples, build, extra = []) {
    const trace = [{ type: 'create', value: { iceServers: [] }, timestamp: T0, extra: [] }];
    trace.push(...extra);
    for (let i = 0; i < samples; i++) {
        trace.push({
            type: 'getStats',
            value: build(i, T0 + 1000 + i * 1000),
            timestamp: T0 + 1000 + i * 1000,
            extra: [],
        });
    }
    return trace;
}

function iceReports(ts, { rtt = 0.02, protocol = 'udp', candidateType = 'host', relayProtocol } = {}) {
    return {
        T: { id: 'T', type: 'transport', timestamp: ts, selectedCandidatePairId: 'CP' },
        CP: {
            id: 'CP',
            type: 'candidate-pair',
            timestamp: ts,
            localCandidateId: 'L',
            remoteCandidateId: 'R',
            currentRoundTripTime: rtt,
            availableOutgoingBitrate: 2_000_000,
            nominated: true,
            state: 'succeeded',
        },
        L: {
            id: 'L',
            type: 'local-candidate',
            candidateType,
            protocol,
            relayProtocol,
            address: '192.168.1.x',
            port: 5000,
        },
        R: { id: 'R', type: 'remote-candidate', candidateType: 'host', protocol, address: '10.0.0.1', port: 40000 },
    };
}

const connected = (timestamp) => ({ type: 'onconnectionstatechange', value: 'connected', timestamp, extra: [] });

function sendTrace({ samples = 10, loss = 0, rtt = 0.02, cpuShare = 0, ice } = {}) {
    return statsTrace(
        samples,
        (i, ts) => ({
            ...iceReports(ts, { rtt, ...ice }),
            A: {
                id: 'A',
                type: 'outbound-rtp',
                kind: 'audio',
                ssrc: 1,
                timestamp: ts,
                bytesSent: i * 4000,
                codecId: 'C1',
            },
            V: {
                id: 'V',
                type: 'outbound-rtp',
                kind: 'video',
                ssrc: 2,
                timestamp: ts,
                bytesSent: i * 100_000,
                framesPerSecond: 30,
                frameWidth: 1280,
                frameHeight: 720,
                qualityLimitationReason: cpuShare ? 'cpu' : 'none',
                qualityLimitationDurations: { none: 10 * (1 - cpuShare), cpu: 10 * cpuShare, bandwidth: 0, other: 0 },
            },
            RA: {
                id: 'RA',
                type: 'remote-inbound-rtp',
                kind: 'audio',
                localId: 'A',
                timestamp: ts,
                fractionLost: loss / 100,
                roundTripTime: rtt,
                jitter: 0.005,
            },
            C1: { id: 'C1', type: 'codec', mimeType: 'audio/opus' },
        }),
        [connected(T0 + 500)]
    );
}

function recvTrace({ samples = 10, lossPerSample = 0, jitter = 0.01, freezes = 0, extra = [] } = {}) {
    return statsTrace(
        samples,
        (i, ts) => ({
            ...iceReports(ts),
            IA: {
                id: 'IA',
                type: 'inbound-rtp',
                kind: 'audio',
                ssrc: 10,
                timestamp: ts,
                bytesReceived: i * 4000,
                packetsReceived: i * 50,
                packetsLost: i * lossPerSample,
                jitter,
                concealedSamples: 0,
                totalSamplesReceived: i * 48000,
            },
            IV: {
                id: 'IV',
                type: 'inbound-rtp',
                kind: 'video',
                ssrc: 20,
                timestamp: ts,
                bytesReceived: i * 90_000,
                packetsReceived: i * 100,
                packetsLost: i * lossPerSample * 2,
                jitter,
                framesPerSecond: 30,
                frameWidth: 1280,
                frameHeight: 720,
                freezeCount: i === samples - 1 ? freezes : 0,
                totalFreezesDuration: i === samples - 1 ? freezes * 0.5 : 0,
            },
            // mediasoup bandwidth probation stream: must be ignored
            P: {
                id: 'P',
                type: 'inbound-rtp',
                kind: 'video',
                ssrc: 1234,
                mid: 'probator',
                timestamp: ts,
                bytesReceived: i * 10,
                packetsReceived: i,
                packetsLost: i * 50,
            },
        }),
        [connected(T0 + 500), ...extra]
    );
}

function dump(peerConnections, meta = {}) {
    return {
        fileFormat: 3,
        userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        rtcStats: { conference: 'room', user: 'u1', session: 's1', tags: ['role:guest'] },
        peerConnections: {
            null: [{ type: 'create', value: { hardwareConcurrency: 8 }, timestamp: T0, extra: [] }],
            ...peerConnections,
        },
        ...meta,
    };
}

const titles = (analysis) => analysis.observations.map((o) => `${o.severity}: ${o.title}`);

describe('RtcStatsAnalyzer', () => {
    it('estimates voice quality (MOS) and rates metrics', () => {
        estimateMos({ rtt: 20, jitter: 5, packetLoss: 0 }).should.be.aboveOrEqual(4.3);
        estimateMos({ rtt: 600, jitter: 80, packetLoss: 8 }).should.be.below(3.5);
        (estimateMos({}) === null).should.be.true();
        rateMetric('packetLoss', 0.5).should.equal('good');
        rateMetric('packetLoss', 3).should.equal('fair');
        rateMetric('packetLoss', 12).should.equal('poor');
        rateMetric('mos', 4.2).should.equal('good');
        rateMetric('fps', 8).should.equal('poor');
        (rateMetric('rtt', null) === null).should.be.true();
    });

    it('parses common user agents', () => {
        parseUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0'
        ).should.containDeep({ browser: 'Edge 131', os: 'Windows' });
        parseUserAgent(
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        ).should.containDeep({ browser: 'Safari 17.0', os: 'iOS', mobile: true });
        parseUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0').should.containDeep({
            browser: 'Firefox 133',
            os: 'Linux',
        });
    });

    it('reports a healthy call as good', () => {
        const analysis = analyzeDump(dump({ PC_1: sendTrace(), PC_2: recvTrace() }));
        analysis.verdict.should.equal('good');
        titles(analysis).should.deepEqual(['good: No issues detected']);
        analysis.groups.audioOut.status.should.equal('good');
        analysis.groups.audioOut.metrics.mos.should.be.aboveOrEqual(4);
        analysis.groups.videoOut.metrics.resolution.should.equal('1280x720');
        analysis.groups.videoOut.metrics.bitrate.should.be.approximately(800, 1);
        analysis.groups.videoIn.count.should.equal(1); // probator ignored
        analysis.network.connectivity.should.containDeep({ relayed: false, protocol: 'udp', ipVersion: 'IPv4' });
        analysis.client.browser.should.equal('Chrome 150');
        analysis.connections.map((c) => c.role).should.deepEqual(['send', 'recv']);
    });

    it('explains a degraded call: loss, freezes, interruptions and TCP relay', () => {
        const interruptions = [
            { type: 'onconnectionstatechange', value: 'disconnected', timestamp: T0 + 3000, extra: [] },
            { type: 'onconnectionstatechange', value: 'connected', timestamp: T0 + 4000, extra: [] },
        ];
        const analysis = analyzeDump(
            dump({
                PC_1: sendTrace({ loss: 3, ice: { candidateType: 'relay', protocol: 'udp', relayProtocol: 'tcp' } }),
                PC_2: recvTrace({ lossPerSample: 5, jitter: 0.06, freezes: 3, extra: interruptions }),
            })
        );
        analysis.verdict.should.equal('poor');
        const list = titles(analysis);
        const has = (prefix) => list.some((t) => t.startsWith(prefix)).should.be.true(prefix);
        list[0].should.startWith('critical: ');
        has('critical: Packet loss on video received');
        has('critical: Packet loss on audio received');
        list.should.containEql('warning: Connection interrupted 1 time');
        list.should.containEql('warning: Media sent over TCP instead of UDP');
        list.should.containEql('info: Media relayed through a TURN server');
        list.should.containEql('warning: Received video froze 3 times');
        list.should.containEql('warning: Packet loss on audio sent (3%)');
        list.some((t) => t.startsWith('warning: High jitter on audio received')).should.be.true();
        analysis.groups.videoIn.status.should.equal('poor');
        analysis.observations.every((o) => o.severity === 'good' || o.tip).should.be.true();
    });

    it('flags a failed connection and camera permission errors with a fix', () => {
        const failed = statsTrace(0, () => ({}), [
            { type: 'setRemoteDescription', value: {}, timestamp: T0 + 100, extra: [] },
            { type: 'oniceconnectionstatechange', value: 'failed', timestamp: T0 + 9000, extra: [] },
        ]);
        const data = dump({ PC_1: failed });
        data.peerConnections.null.push(
            {
                type: 'navigator.mediaDevices.getUserMedia',
                value: { audio: true, video: true },
                timestamp: T0 + 10,
                extra: ['g-0'],
            },
            {
                type: 'navigator.mediaDevices.getUserMediaOnFailure',
                value: 'NotAllowedError: Permission denied',
                timestamp: T0 + 900,
                extra: ['g-0'],
            }
        );
        const analysis = analyzeDump(data);
        analysis.verdict.should.equal('poor');
        const camera = analysis.observations.find((o) => o.title === 'Camera or microphone could not be started');
        camera.severity.should.equal('critical');
        camera.detail.should.equal('NotAllowedError: Permission denied');
        camera.tip.should.match(/Permission was denied/);
        analysis.observations.some((o) => o.title === 'Media connection failed').should.be.true();
        analysis.client.media[0].should.containDeep({ api: 'getUserMedia', result: 'failure', duration: 890 });
    });

    it('reports CPU-limited video with a MiroTalk specific tip', () => {
        const analysis = analyzeDump(dump({ PC_1: sendTrace({ cpuShare: 0.4 }) }));
        const cpu = analysis.observations.find((o) => o.title.startsWith('Sent video limited by CPU'));
        cpu.title.should.equal('Sent video limited by CPU (40% of the time)');
        cpu.tip.should.match(/video effects/);
        analysis.verdict.should.equal('fair');
    });

    it('reads the identity from the :mirotalk event for rtcstats-server dumps', () => {
        const data = dump({ PC_1: sendTrace() }, { rtcStats: undefined });
        data.peerConnections.null.push({
            type: ':mirotalk',
            value: { conference: 'ext-room', user: 'u9', session: 's9', tags: ['role:presenter'], roomSessionId: 'rs' },
            timestamp: T0 + 5,
            extra: [],
        });
        analyzeDump(data).session.should.containDeep({
            room: 'ext-room',
            user: 'u9',
            session: 's9',
            tags: ['role:presenter'],
            roomSessionId: 'rs',
        });
    });

    it('handles a dump without media', () => {
        const analysis = analyzeDump(dump({}, { rtcStats: undefined }));
        titles(analysis).should.containEql('info: No media was exchanged');
        analysis.verdict.should.equal('good');
        (analysis.groups.audioOut === null).should.be.true();
    });

    it('groups repeated device failures and lowers severity when a retry worked', () => {
        const data = dump({ PC_1: sendTrace() });
        for (let i = 0; i < 3; i++) {
            data.peerConnections.null.push(
                {
                    type: 'navigator.mediaDevices.getUserMedia',
                    value: { video: true },
                    timestamp: T0 + i * 10,
                    extra: [`g-${i}`],
                },
                {
                    type: 'navigator.mediaDevices.getUserMediaOnFailure',
                    value: 'NotSupportedError: Not supported',
                    timestamp: T0 + i * 10 + 5,
                    extra: [`g-${i}`],
                }
            );
        }
        const failedOnly = analyzeDump(data);
        const failure = failedOnly.observations.filter((o) => /Camera or microphone/.test(o.title));
        failure.length.should.equal(1);
        failure[0].should.containDeep({
            severity: 'critical',
            title: 'Camera or microphone could not be started (3 attempts)',
        });
        failure[0].tip.should.match(/HTTPS/);

        data.peerConnections.null.push(
            {
                type: 'navigator.mediaDevices.getUserMedia',
                value: { video: true },
                timestamp: T0 + 100,
                extra: ['g-3'],
            },
            { type: 'navigator.mediaDevices.getUserMediaOnSuccess', value: [], timestamp: T0 + 150, extra: ['g-3'] }
        );
        const recovered = analyzeDump(data).observations.find((o) => /Camera or microphone/.test(o.title));
        recovered.should.containDeep({
            severity: 'warning',
            title: 'Camera or microphone failed to start (3 attempts), then worked',
        });
    });

    it('ignores normal startup freezes and concealment while audio is silent or muted', () => {
        // 1 short freeze, and audio at 10 packets/s (DTX / muted) with lots of concealment
        const quiet = statsTrace(
            10,
            (i, ts) => ({
                ...iceReports(ts),
                IA: {
                    id: 'IA',
                    type: 'inbound-rtp',
                    kind: 'audio',
                    ssrc: 10,
                    timestamp: ts,
                    bytesReceived: i * 500,
                    packetsReceived: i * 10,
                    packetsLost: 0,
                    jitter: 0.005,
                    concealedSamples: i * 40000,
                    silentConcealedSamples: i * 30000,
                    totalSamplesReceived: i * 48000,
                },
                IV: {
                    id: 'IV',
                    type: 'inbound-rtp',
                    kind: 'video',
                    ssrc: 20,
                    timestamp: ts,
                    bytesReceived: i * 90_000,
                    packetsReceived: i * 100,
                    packetsLost: 0,
                    jitter: 0.005,
                    framesPerSecond: 30,
                    frameWidth: 640,
                    frameHeight: 360,
                    freezeCount: i ? 1 : 0,
                    totalFreezesDuration: i ? 0.22 : 0,
                },
            }),
            [connected(T0 + 500)]
        );
        titles(analyzeDump(dump({ PC_2: quiet }))).should.deepEqual(['good: No issues detected']);

        // 50 packets/s with 10% non-silent concealment is choppy audio
        const choppy = statsTrace(
            10,
            (i, ts) => ({
                ...iceReports(ts),
                IA: {
                    id: 'IA',
                    type: 'inbound-rtp',
                    kind: 'audio',
                    ssrc: 10,
                    timestamp: ts,
                    bytesReceived: i * 4000,
                    packetsReceived: i * 50,
                    packetsLost: 0,
                    jitter: 0.005,
                    concealedSamples: i * 4800,
                    silentConcealedSamples: 0,
                    totalSamplesReceived: i * 48000,
                },
            }),
            [connected(T0 + 500)]
        );
        titles(analyzeDump(dump({ PC_2: choppy }))).should.containEql(
            'critical: Received audio was choppy (10% concealed)'
        );
    });
});
