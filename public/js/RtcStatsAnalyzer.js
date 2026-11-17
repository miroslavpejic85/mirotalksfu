'use strict';

// RTCStats dump analyzer: turns a parsed dump (rtcstats-shared readDump) into a health verdict,
// per-direction media quality and plain-language observations. Pure (no DOM): browser + Node tests.

(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.RtcStatsAnalyzer = api;
})(typeof self !== 'undefined' ? self : this, function () {
    // Lower is better unless higherIsBetter. good/fair are the zone limits, max the gauge scale.
    const METRICS = {
        packetLoss: { good: 1, fair: 5, max: 10, unit: '%' },
        rtt: { good: 150, fair: 300, max: 500, unit: 'ms' },
        jitter: { good: 30, fair: 50, max: 100, unit: 'ms' },
        mos: { good: 4, fair: 3.5, min: 1, max: 4.5, higherIsBetter: true, unit: '/ 4.5' },
        fps: { good: 15, fair: 10, max: 30, higherIsBetter: true, unit: 'fps' },
    };

    const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2, good: 3 };
    const STATUS_ORDER = { poor: 0, fair: 1, good: 2 };
    const LIMITATION_SHARE = 0.1; // 10% of the time
    const PROBATOR_MID = 'probator'; // mediasoup bandwidth probation stream, not real media
    const PROBATOR_SSRC = 1234;
    // Opus sends ~50 packets/s while audio flows continuously; below that the interval includes DTX
    // on/off transitions, where the browser conceals by design (not a network problem).
    const ACTIVE_AUDIO_PACKET_RATE = 45;
    const MIN_ACTIVE_AUDIO_SECONDS = 3;

    // ####################################################
    // HELPERS
    // ####################################################

    const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

    function rateMetric(metric, value) {
        const def = METRICS[metric];
        if (!def || !isNum(value)) return null;
        if (def.higherIsBetter) return value >= def.good ? 'good' : value >= def.fair ? 'fair' : 'poor';
        return value <= def.good ? 'good' : value <= def.fair ? 'fair' : 'poor';
    }

    function worstStatus(statuses) {
        const valid = statuses.filter(Boolean);
        if (!valid.length) return null;
        return valid.sort((a, b) => STATUS_ORDER[a] - STATUS_ORDER[b])[0];
    }

    function average(values) {
        const valid = values.filter(isNum);
        return valid.length ? valid.reduce((sum, v) => sum + v, 0) / valid.length : null;
    }

    function maxOf(values) {
        const valid = values.filter(isNum);
        return valid.length ? Math.max(...valid) : null;
    }

    function minOf(values) {
        const valid = values.filter(isNum);
        return valid.length ? Math.min(...valid) : null;
    }

    function sumOf(values) {
        const valid = values.filter(isNum);
        return valid.length ? valid.reduce((sum, v) => sum + v, 0) : null;
    }

    function round(value, digits = 1) {
        if (!isNum(value)) return value;
        const factor = 10 ** digits;
        return Math.round(value * factor) / factor;
    }

    // Simplified ITU-T G.107 E-model, the usual WebRTC estimation for voice quality (Opus).
    function estimateMos({ rtt, jitter, packetLoss }) {
        if (!isNum(rtt) && !isNum(jitter) && !isNum(packetLoss)) return null;
        const latency = (rtt || 0) / 2 + (jitter || 0) * 2 + 10;
        let r = 93.2 - (latency < 160 ? latency / 40 : (latency - 120) / 10);
        r -= (packetLoss || 0) * 2.5;
        r = Math.max(0, Math.min(100, r));
        const mos = 1 + 0.035 * r + 0.000007 * r * (r - 60) * (100 - r);
        return round(Math.max(1, Math.min(4.5, mos)), 1);
    }

    // ####################################################
    // STATS COLLECTION
    // ####################################################

    // id -> { id, type, samples: [{ t, report }] }
    function collectReports(trace) {
        const reports = new Map();
        for (const event of trace) {
            if (event.type !== 'getStats' || !event.value || typeof event.value !== 'object') continue;
            for (const [id, report] of Object.entries(event.value)) {
                if (!report || typeof report !== 'object') continue;
                let entry = reports.get(id);
                if (!entry) {
                    entry = { id, type: report.type, samples: [] };
                    reports.set(id, entry);
                }
                entry.samples.push({ t: event.timestamp, report });
            }
        }
        return reports;
    }

    const lastReport = (entry) => entry?.samples[entry.samples.length - 1]?.report;
    const sampleTime = (sample) => (isNum(sample.report.timestamp) ? sample.report.timestamp : sample.t);

    // Change of a cumulative counter between its first and last sample.
    function counterDelta(entry, property) {
        let first = null;
        let last = null;
        for (const sample of entry.samples) {
            const value = sample.report[property];
            if (!isNum(value)) continue;
            if (!first) first = { value, time: sampleTime(sample) };
            last = { value, time: sampleTime(sample) };
        }
        if (!first || !last || last.time <= first.time) return null;
        return { delta: last.value - first.value, seconds: (last.time - first.time) / 1000 };
    }

    function averageOf(entry, property, scale = 1) {
        return average(
            entry.samples.map((sample) => (isNum(sample.report[property]) ? sample.report[property] * scale : null))
        );
    }

    function bitrateKbps(entry, property) {
        const d = counterDelta(entry, property);
        return d && d.seconds > 0 && d.delta >= 0 ? (d.delta * 8) / d.seconds / 1000 : null;
    }

    function isProbator(report) {
        return (
            report?.mid === PROBATOR_MID || report?.trackIdentifier === PROBATOR_MID || report?.ssrc === PROBATOR_SSRC
        );
    }

    // % of non-silent concealed audio, only while audio was really flowing: with DTX or a muted
    // (paused) producer few packets arrive and the browser conceals the gaps, which is not a problem.
    function activeConcealment(entry) {
        let concealed = 0;
        let total = 0;
        let previous = null;
        for (const sample of entry.samples) {
            const r = sample.report;
            if (!isNum(r.concealedSamples) || !isNum(r.totalSamplesReceived) || !isNum(r.packetsReceived)) continue;
            const current = {
                time: sampleTime(sample),
                packets: r.packetsReceived,
                concealed: r.concealedSamples - (isNum(r.silentConcealedSamples) ? r.silentConcealedSamples : 0),
                total: r.totalSamplesReceived,
            };
            if (previous) {
                const seconds = (current.time - previous.time) / 1000;
                const packetRate = seconds > 0 ? (current.packets - previous.packets) / seconds : 0;
                const totalDelta = current.total - previous.total;
                if (packetRate >= ACTIVE_AUDIO_PACKET_RATE && totalDelta > 0) {
                    concealed += Math.max(0, current.concealed - previous.concealed);
                    total += totalDelta;
                }
            }
            previous = current;
        }
        // Need a few seconds of active audio (48 kHz) to be meaningful
        return total >= 48000 * MIN_ACTIVE_AUDIO_SECONDS ? (concealed / total) * 100 : null;
    }

    function selectedPair(stats) {
        const reports = Object.values(stats || {});
        const transport = reports.find((report) => report?.type === 'transport' && report.selectedCandidatePairId);
        if (transport && stats[transport.selectedCandidatePairId]) return stats[transport.selectedCandidatePairId];
        return reports.find(
            (report) => report?.type === 'candidate-pair' && report.nominated && report.state === 'succeeded'
        );
    }

    // ####################################################
    // PEER CONNECTIONS
    // ####################################################

    function analyzeConnection(id, trace) {
        const reports = collectReports(trace);
        const types = new Set([...reports.values()].map((entry) => entry.type));
        const role = types.has('outbound-rtp')
            ? types.has('inbound-rtp')
                ? 'sendrecv'
                : 'send'
            : types.has('inbound-rtp')
              ? 'recv'
              : types.has('data-channel')
                ? 'data'
                : 'idle';

        const states = { connection: [], ice: [] };
        for (const event of trace) {
            if (event.type === 'onconnectionstatechange') states.connection.push(event);
            if (event.type === 'oniceconnectionstatechange') states.ice.push(event);
        }
        const values = (list) => list.map((event) => event.value);
        const connected = [...values(states.connection), ...values(states.ice)].some((value) =>
            ['connected', 'completed'].includes(value)
        );
        const failed = [...values(states.connection), ...values(states.ice)].includes('failed');
        const disconnects = values(states.connection).filter((value) => value === 'disconnected').length;

        // RTT and available bandwidth from the selected ICE candidate pair over time
        const rtts = [];
        let lastStats = null;
        let pair = null;
        for (const event of trace) {
            if (event.type !== 'getStats' || !event.value) continue;
            lastStats = event.value;
            const current = selectedPair(event.value);
            if (current) {
                pair = current;
                if (isNum(current.currentRoundTripTime)) rtts.push(current.currentRoundTripTime * 1000);
            }
        }
        const local = pair && lastStats ? lastStats[pair.localCandidateId] : null;
        const remote = pair && lastStats ? lastStats[pair.remoteCandidateId] : null;
        const address = local?.address ?? local?.ip ?? '';
        const connectivity = local
            ? {
                  relayed: local.candidateType === 'relay' || remote?.candidateType === 'relay',
                  protocol: String(local.relayProtocol || local.protocol || '').toLowerCase(),
                  candidateProtocol: String(local.protocol || '').toLowerCase(),
                  localType: local.candidateType,
                  remoteType: remote?.candidateType,
                  ipVersion: address.includes(':') ? 'IPv6' : address ? 'IPv4' : null,
                  networkType: local.networkType,
                  local: `${local.candidateType || ''} ${local.protocol || ''}${local.relayProtocol ? `/${local.relayProtocol}` : ''} ${address}${local.port ? `:${local.port}` : ''}`.trim(),
                  remote: remote
                      ? `${remote.candidateType || ''} ${remote.protocol || ''} ${remote.address ?? remote.ip ?? ''}${remote.port ? `:${remote.port}` : ''}`.trim()
                      : null,
              }
            : null;

        const create = trace.find((event) => event.type === 'create');
        return {
            id,
            role,
            trace,
            reports,
            created: create?.timestamp ?? trace[0]?.timestamp,
            configuration: create?.value ?? null,
            states,
            connected,
            failed,
            disconnects,
            rtt: average(rtts),
            connectivity,
            lastStats,
            statsSamples: trace.filter((event) => event.type === 'getStats').length,
        };
    }

    // ####################################################
    // STREAMS
    // ####################################################

    function analyzeStreams(connection) {
        const streams = [];
        const { reports, lastStats } = connection;
        const remoteInbound = [...reports.values()].filter((entry) => entry.type === 'remote-inbound-rtp');

        for (const entry of reports.values()) {
            if (!['inbound-rtp', 'outbound-rtp'].includes(entry.type)) continue;
            const report = lastReport(entry) || {};
            if (entry.type === 'inbound-rtp' && isProbator(report)) continue;
            const kind = report.kind || report.mediaType;
            const codec = lastStats?.[report.codecId]?.mimeType?.replace(/^(audio|video)\//, '');
            const stream = {
                id: entry.id,
                connectionId: connection.id,
                direction: entry.type === 'outbound-rtp' ? 'out' : 'in',
                kind,
                ssrc: report.ssrc,
                rid: report.rid,
                codec,
                entry,
            };

            if (stream.direction === 'out') {
                stream.bitrate = bitrateKbps(entry, 'bytesSent');
                const remote = remoteInbound.find((candidate) => lastReport(candidate)?.localId === entry.id);
                if (remote) {
                    stream.packetLoss = averageOf(remote, 'fractionLost', 100);
                    stream.rtt = averageOf(remote, 'roundTripTime', 1000);
                    stream.jitter = averageOf(remote, 'jitter', 1000);
                }
                if (kind === 'video') {
                    stream.fps = averageOf(entry, 'framesPerSecond');
                    stream.height = report.frameHeight;
                    stream.width = report.frameWidth;
                    stream.limitation = report.qualityLimitationReason;
                    const durations = report.qualityLimitationDurations;
                    if (durations && typeof durations === 'object') {
                        const total = sumOf(Object.values(durations));
                        if (total > 0) {
                            stream.limitationShare = {
                                cpu: (durations.cpu || 0) / total,
                                bandwidth: (durations.bandwidth || 0) / total,
                            };
                        }
                    }
                }
            } else {
                stream.bitrate = bitrateKbps(entry, 'bytesReceived');
                const lost = counterDelta(entry, 'packetsLost');
                const received = counterDelta(entry, 'packetsReceived');
                if (lost && received && lost.delta + received.delta > 0) {
                    stream.packetLoss = (Math.max(lost.delta, 0) / (Math.max(lost.delta, 0) + received.delta)) * 100;
                }
                stream.jitter = averageOf(entry, 'jitter', 1000);
                stream.rtt = connection.rtt;
                const buffer = counterDelta(entry, 'jitterBufferDelay');
                const emitted = counterDelta(entry, 'jitterBufferEmittedCount');
                if (buffer && emitted && emitted.delta > 0)
                    stream.jitterBufferDelay = (buffer.delta / emitted.delta) * 1000;
                if (kind === 'video') {
                    stream.fps = averageOf(entry, 'framesPerSecond');
                    stream.height = report.frameHeight;
                    stream.width = report.frameWidth;
                    stream.freezes = counterDelta(entry, 'freezeCount')?.delta ?? report.freezeCount ?? 0;
                    stream.freezeSeconds =
                        counterDelta(entry, 'totalFreezesDuration')?.delta ?? report.totalFreezesDuration ?? 0;
                } else if (kind === 'audio') {
                    stream.concealment = activeConcealment(entry);
                }
            }
            if (kind === 'audio') stream.mos = estimateMos(stream);
            stream.status = worstStatus([
                rateMetric('packetLoss', stream.packetLoss),
                rateMetric('rtt', stream.rtt),
                rateMetric('jitter', stream.jitter),
                kind === 'audio' ? rateMetric('mos', stream.mos) : null,
                kind === 'video' && isNum(stream.fps) && stream.fps > 0 ? rateMetric('fps', stream.fps) : null,
            ]);
            streams.push(stream);
        }
        return streams;
    }

    // Aggregate of all streams for one direction + kind (worst value drives the status).
    function summarizeGroup(streams, direction, kind) {
        const group = streams.filter((stream) => stream.direction === direction && stream.kind === kind);
        if (!group.length) return null;
        const active = group.filter((stream) => isNum(stream.bitrate) && stream.bitrate > 0);
        const metrics = {
            bitrate: sumOf(group.map((s) => s.bitrate)),
            packetLoss: maxOf(group.map((s) => s.packetLoss)),
            rtt: maxOf(group.map((s) => s.rtt)),
            jitter: maxOf(group.map((s) => s.jitter)),
        };
        if (kind === 'audio') metrics.mos = minOf(group.map((s) => s.mos));
        if (kind === 'video') {
            if (direction === 'out') {
                // Simulcast: the highest active layer represents what the camera sends
                const top = [...active].sort((a, b) => (b.height || 0) - (a.height || 0))[0];
                metrics.fps = top?.fps ?? null;
                metrics.resolution = top?.height ? `${top.width}x${top.height}` : null;
            } else {
                metrics.fps = minOf(active.map((s) => (isNum(s.fps) && s.fps > 0 ? s.fps : null)));
                metrics.resolution = maxOf(active.map((s) => s.height))
                    ? `${maxOf(active.map((s) => s.height))}p`
                    : null;
            }
        }
        const status = worstStatus([
            rateMetric('packetLoss', metrics.packetLoss),
            rateMetric('rtt', metrics.rtt),
            rateMetric('jitter', metrics.jitter),
            kind === 'audio' ? rateMetric('mos', metrics.mos) : null,
            kind === 'video' && isNum(metrics.fps) && metrics.fps > 0 ? rateMetric('fps', metrics.fps) : null,
        ]);
        return {
            direction,
            kind,
            count: group.length,
            active: active.length,
            metrics,
            status: status || 'good',
            streams: group,
        };
    }

    // ####################################################
    // CLIENT
    // ####################################################

    function parseUserAgent(ua = '') {
        const pick = (re) => ua.match(re)?.[1];
        let browser = 'Unknown';
        let version = '';
        if ((version = pick(/Edg\/([\d]+)/))) browser = 'Edge';
        else if ((version = pick(/OPR\/([\d]+)/))) browser = 'Opera';
        else if ((version = pick(/Firefox\/([\d]+)/))) browser = 'Firefox';
        else if (/Electron\//.test(ua) && (version = pick(/Chrome\/([\d]+)/))) browser = 'Electron';
        else if ((version = pick(/(?:Chrome|CriOS)\/([\d]+)/)))
            browser = /Headless/.test(ua) ? 'Headless Chrome' : 'Chrome';
        else if ((version = pick(/Version\/([\d.]+).*Safari/))) browser = 'Safari';
        let os = 'Unknown';
        if (/Windows NT/.test(ua)) os = 'Windows';
        else if (/Android/.test(ua)) os = 'Android';
        else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
        else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
        else if (/CrOS/.test(ua)) os = 'ChromeOS';
        else if (/Linux/.test(ua)) os = 'Linux';
        return {
            browser: version ? `${browser} ${version}` : browser,
            os,
            mobile: /Mobi|Android|iPhone|iPad/.test(ua),
        };
    }

    function analyzeClient(data) {
        const trace = data.peerConnections?.null || [];
        const create = trace.find((event) => event.type === 'create')?.value || {};
        const media = [];
        const byTrackingId = new Map();
        let devices = null;
        for (const event of trace) {
            const match = /^navigator\.mediaDevices\.(getUserMedia|getDisplayMedia)(OnSuccess|OnFailure)?$/.exec(
                event.type
            );
            if (match) {
                const [, api, outcome] = match;
                const trackingId = event.extra?.[0];
                if (!outcome) {
                    const request = { api, time: event.timestamp, constraints: event.value, result: 'pending' };
                    media.push(request);
                    if (trackingId !== undefined) byTrackingId.set(trackingId, request);
                } else {
                    let request = byTrackingId.get(trackingId);
                    if (!request) {
                        request = { api, time: event.timestamp };
                        media.push(request);
                    }
                    request.result = outcome === 'OnSuccess' ? 'success' : 'failure';
                    request.response = event.value;
                    request.duration = event.timestamp - request.time;
                    if (outcome === 'OnFailure') {
                        // rtcstats-js records err.toString(): "NotAllowedError: Permission denied"
                        const text = typeof event.value === 'string' ? event.value : String(event.value?.name || '');
                        const [name, ...rest] = text.split(': ');
                        request.error = { name: name || 'Error', message: rest.join(': ') };
                    }
                }
            }
            if (event.type === 'navigator.mediaDevices.enumerateDevices' && Array.isArray(event.value)) {
                devices = { audioinput: 0, videoinput: 0, audiooutput: 0 };
                for (const device of event.value) {
                    if (device?.kind in devices) devices[device.kind]++;
                }
            }
        }
        const ua = data.userAgent || create.userAgent || '';
        return {
            ...parseUserAgent(ua),
            userAgent: ua,
            cores: create.hardwareConcurrency,
            memory: create.deviceMemory,
            screen: create.screen,
            window: create.window,
            reloads: create.reloadCount,
            media,
            devices,
            trace,
        };
    }

    // Compute pressure: rtcstats-js records nominal=4 ... critical=1
    function cpuPressureShare(connections) {
        let total = 0;
        let high = 0;
        for (const connection of connections) {
            for (const entry of connection.reports.values()) {
                if (entry.type !== 'compute-pressure') continue;
                for (const { report } of entry.samples) {
                    total++;
                    if ([1, 2, 'serious', 'critical'].includes(report.cpuState)) high++;
                }
            }
        }
        return total ? high / total : null;
    }

    // ####################################################
    // OBSERVATIONS
    // ####################################################

    const GUM_TIPS = {
        NotAllowedError:
            'Permission was denied. Ask the user to allow camera/microphone in the browser site settings (and the OS privacy settings on macOS/Windows).',
        NotFoundError: 'No matching camera or microphone was found. Check that a device is connected and enabled.',
        NotReadableError:
            'The device is busy or blocked: another application (Zoom, Teams...) may be using it, or the OS denied access.',
        OverconstrainedError:
            'The requested resolution or device is not supported. Choose another device or a lower video quality.',
        AbortError:
            'The browser aborted the device start. Reconnecting the device or restarting the browser usually helps.',
        NotSupportedError:
            'The browser refused the request: the page must be served over HTTPS and camera/microphone must not be blocked by a browser or company policy.',
    };

    const LABELS = { audio: 'audio', video: 'video', in: 'received', out: 'sent' };

    function buildObservations({ connections, client, groups, closeCode, cpuShare }) {
        const list = [];
        const add = (severity, title, detail, tip, tab) => list.push({ severity, title, detail, tip, tab });

        // Group identical failures (apps often retry with other constraints)
        const failures = new Map();
        for (const request of client.media.filter((item) => item.result === 'failure')) {
            const { name, message } = request.error || { name: 'Error', message: '' };
            const key = `${request.api}|${name}|${message}`;
            if (!failures.has(key))
                failures.set(key, { api: request.api, name, message, count: 0, last: request.time });
            const failure = failures.get(key);
            failure.count++;
            failure.last = Math.max(failure.last, request.time ?? 0);
        }
        for (const { api, name, message, count, last } of failures.values()) {
            const attempts = count > 1 ? ` (${count} attempts)` : '';
            const detail = `${name}${message ? `: ${message}` : ''}`;
            if (api === 'getDisplayMedia') {
                add(
                    'info',
                    `Screen sharing was cancelled or denied${attempts}`,
                    detail,
                    'Usually the user closed the screen picker. On macOS the browser also needs Screen Recording permission.',
                    'client'
                );
                continue;
            }
            const recovered = client.media.some(
                (item) => item.api === api && item.result === 'success' && (item.time ?? 0) > last
            );
            add(
                recovered ? 'warning' : 'critical',
                recovered
                    ? `Camera or microphone failed to start${attempts}, then worked`
                    : `Camera or microphone could not be started${attempts}`,
                detail,
                GUM_TIPS[name] || 'Check the device and the browser permissions.',
                'client'
            );
        }

        const media = connections.filter(
            (connection) => ['send', 'recv', 'sendrecv'].includes(connection.role) || connection.failed
        );
        const failed = media.filter((connection) => connection.failed);
        if (failed.length) {
            add(
                'critical',
                'Media connection failed',
                `${failed.length} connection(s) reached the "failed" state (${failed.map((c) => c.id).join(', ')}).`,
                'Usually a firewall or NAT blocks the media ports. Open the SFU WebRTC ports (UDP, e.g. 40000-40100) or configure a TURN server for restrictive networks.',
                'network'
            );
        }
        const disconnects = media.reduce((sum, connection) => sum + connection.disconnects, 0);
        if (disconnects) {
            add(
                disconnects > 2 ? 'critical' : 'warning',
                `Connection interrupted ${disconnects} time${disconnects > 1 ? 's' : ''}`,
                'The media connection dropped and had to recover. The participant may have seen frozen video or heard silence.',
                'Typical of unstable Wi-Fi or mobile networks. Prefer a wired connection or move closer to the router.',
                'network'
            );
        }

        const primary = media.find((connection) => connection.connectivity) || null;
        const connectivity = primary?.connectivity;
        if (connectivity?.protocol === 'tcp' || connectivity?.protocol === 'tls') {
            add(
                'warning',
                `Media sent over ${connectivity.protocol.toUpperCase()} instead of UDP`,
                'TCP adds latency and makes audio/video more sensitive to packet loss.',
                'UDP appears to be blocked between this participant and the server. Allow outbound UDP to the SFU WebRTC ports.',
                'network'
            );
        }
        if (connectivity?.relayed) {
            add(
                'info',
                'Media relayed through a TURN server',
                'A direct path to the SFU was not possible, so media goes through TURN.',
                'Normal on restrictive corporate networks. It adds a little latency and TURN bandwidth cost.',
                'network'
            );
        }

        for (const group of Object.values(groups).filter(Boolean)) {
            const name = `${LABELS[group.kind]} ${LABELS[group.direction]}`;
            const { packetLoss, rtt, jitter } = group.metrics;
            const lossStatus = rateMetric('packetLoss', packetLoss);
            if (lossStatus && lossStatus !== 'good') {
                add(
                    lossStatus === 'poor' ? 'critical' : 'warning',
                    `Packet loss on ${name} (${round(packetLoss)}%)`,
                    `Above ${METRICS.packetLoss.good}% packet loss causes ${group.kind === 'audio' ? 'robotic or choppy audio' : 'blurry, blocky or frozen video'}.`,
                    group.direction === 'out'
                        ? "The participant's upload is congested. Close other uploads (cloud sync, streaming) or use a better network."
                        : "The participant's download is congested or Wi-Fi is weak. Lower the received video quality or improve the network.",
                    'media'
                );
            }
            const jitterStatus = rateMetric('jitter', jitter);
            if (jitterStatus && jitterStatus !== 'good') {
                add(
                    'warning',
                    `High jitter on ${name} (${round(jitter, 0)} ms)`,
                    'Packets arrive at irregular intervals, which forces bigger buffers and can cause choppy playback.',
                    'Usually Wi-Fi interference or a congested network. A wired connection helps.',
                    'media'
                );
            }
            const rttStatus = rateMetric('rtt', rtt);
            if (rttStatus && rttStatus !== 'good') {
                add(
                    rttStatus === 'poor' ? 'critical' : 'warning',
                    `High latency on ${name} (${round(rtt, 0)} ms round trip)`,
                    'Above 300 ms conversations feel delayed and people talk over each other.',
                    'The participant is far from the server or on a slow network (satellite, mobile). Host the SFU closer to your users.',
                    'network'
                );
            }
        }

        const audioIn = groups.audioIn;
        const concealment = maxOf(audioIn?.streams.map((s) => s.concealment) || []);
        if (isNum(concealment) && concealment > 3) {
            add(
                concealment > 8 ? 'critical' : 'warning',
                `Received audio was choppy (${round(concealment)}% concealed)`,
                'The browser had to fill in missing audio, heard as gaps or robotic voice.',
                'Caused by packet loss or jitter on the receiving side.',
                'media'
            );
        }
        // A single short freeze (e.g. while the first frames arrive) is normal
        const freezes = sumOf(groups.videoIn?.streams.map((s) => s.freezes) || []) || 0;
        const freezeSeconds = sumOf(groups.videoIn?.streams.map((s) => s.freezeSeconds) || []) || 0;
        if (freezes >= 2 || freezeSeconds >= 1) {
            add(
                freezes > 5 || freezeSeconds >= 5 ? 'critical' : 'warning',
                `Received video froze ${freezes} time${freezes > 1 ? 's' : ''}`,
                `About ${round(freezeSeconds)} s of frozen video in total.`,
                'Freezes come from packet loss, low bandwidth or an overloaded device on either side.',
                'media'
            );
        }

        for (const stream of groups.videoOut?.streams || []) {
            const share = stream.limitationShare;
            if (!share) continue;
            if (share.cpu > LIMITATION_SHARE) {
                add(
                    'warning',
                    `Sent video limited by CPU (${Math.round(share.cpu * 100)}% of the time)`,
                    'The device was too busy to encode video at full quality, so resolution or frame rate was reduced.',
                    'Close other apps and tabs, lower the video quality, or turn off the virtual background / video effects (they are CPU heavy).',
                    'media'
                );
                break;
            }
        }
        for (const stream of groups.videoOut?.streams || []) {
            const share = stream.limitationShare;
            if (share && share.bandwidth > LIMITATION_SHARE) {
                add(
                    'warning',
                    `Sent video limited by bandwidth (${Math.round(share.bandwidth * 100)}% of the time)`,
                    'The available upload was too low for the requested video quality.',
                    'Improve the upload bandwidth or lower the video quality in the room settings.',
                    'media'
                );
                break;
            }
        }
        const fpsOut = groups.videoOut?.metrics.fps;
        if (isNum(fpsOut) && fpsOut > 0 && rateMetric('fps', fpsOut) === 'poor') {
            add(
                'warning',
                `Low camera frame rate (${round(fpsOut, 0)} fps)`,
                'Video looked choppy to the other participants.',
                'Poor lighting makes many cameras lower their frame rate. CPU load can also reduce it.',
                'media'
            );
        }

        if (isNum(cpuShare) && cpuShare > LIMITATION_SHARE) {
            add(
                'warning',
                `Device CPU under heavy load (${Math.round(cpuShare * 100)}% of the time)`,
                'The browser reported serious or critical CPU pressure.',
                'Close other apps and tabs, disable video effects, or use a more powerful device.',
                'client'
            );
        }

        if (isNum(client.reloads) && client.reloads > 0) {
            add(
                'info',
                `Page reloaded ${client.reloads} time${client.reloads > 1 ? 's' : ''} before this session`,
                'Users often reload the page when something goes wrong.',
                'Check the previous dumps of this participant for the original problem.',
                'client'
            );
        }
        if (closeCode === 1009)
            add(
                'info',
                'Dump truncated',
                'The dump reached the maximum size, later stats were not recorded.',
                'Increase RTCSTATS_MAX_DUMP_SIZE_MB or the getStats interval.',
                'logs'
            );
        if (closeCode === 1006)
            add(
                'info',
                'Recording ended abruptly',
                'The browser closed or lost the network without a clean disconnect.',
                'Fine if the user just closed the tab; otherwise look for network issues near the end.',
                'logs'
            );

        if (!media.length && !failed.length) {
            add(
                'info',
                'No media was exchanged',
                'No audio or video connection was established in this dump.',
                'The participant may have left before joining, or stayed in the lobby.',
                'network'
            );
        }
        if (!list.some((item) => ['critical', 'warning'].includes(item.severity))) {
            add(
                'good',
                'No issues detected',
                'Connection, audio and video stayed within healthy limits.',
                null,
                'media'
            );
        }
        return list.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    }

    // ####################################################
    // ENTRY POINT
    // ####################################################

    function analyzeDump(data) {
        const ids = Object.keys(data.peerConnections || {}).filter((id) => id !== 'null');
        const connections = ids.map((id) => analyzeConnection(id, data.peerConnections[id]));
        const streams = connections.flatMap(analyzeStreams);
        const client = analyzeClient(data);

        let first = Infinity;
        let last = -Infinity;
        for (const trace of Object.values(data.peerConnections || {})) {
            for (const event of trace) {
                if (!isNum(event.timestamp)) continue;
                first = Math.min(first, event.timestamp);
                last = Math.max(last, event.timestamp);
            }
        }

        const groups = {
            audioOut: summarizeGroup(streams, 'out', 'audio'),
            audioIn: summarizeGroup(streams, 'in', 'audio'),
            videoOut: summarizeGroup(streams, 'out', 'video'),
            videoIn: summarizeGroup(streams, 'in', 'video'),
        };
        const closeEvent = client.trace.find((event) => event.type === 'close');
        const closeCode = closeEvent?.value;
        const observations = buildObservations({
            connections,
            client,
            groups,
            closeCode,
            cpuShare: cpuPressureShare(connections),
        });

        const severities = observations.map((item) => item.severity);
        const verdict = severities.includes('critical') ? 'poor' : severities.includes('warning') ? 'fair' : 'good';
        const primary = connections.find((c) => c.connectivity && ['send', 'recv', 'sendrecv'].includes(c.role));
        // Built-in dumps carry the identity in the header, external rtcstats-server dumps in the identity event
        const meta = data.rtcStats || client.trace.find((event) => event.type === ':mirotalk')?.value || {};

        return {
            verdict,
            observations,
            groups,
            streams,
            connections,
            client,
            session: {
                room: meta.conference,
                user: meta.user,
                session: meta.session,
                tags: meta.tags || [],
                roomSessionId: data.roomSessionId ?? meta.roomSessionId,
                start: isNum(data.startTime) ? data.startTime : Number.isFinite(first) ? first : null,
                first: Number.isFinite(first) ? first : null,
                last: Number.isFinite(last) ? last : null,
                duration: Number.isFinite(first) && Number.isFinite(last) ? last - first : null,
                origin: data.origin,
                remoteAddresses: data.remoteAddresses || [],
                closeCode,
            },
            network: {
                connectivity: primary?.connectivity || null,
                rtt: average(connections.map((c) => c.rtt)),
                jitter: maxOf(streams.filter((s) => s.direction === 'in').map((s) => s.jitter)),
            },
        };
    }

    return { analyzeDump, estimateMos, rateMetric, parseUserAgent, collectReports, METRICS };
});
