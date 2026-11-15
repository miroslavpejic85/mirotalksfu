'use strict';

/**
 * Pure server-side recording (no browser involved).
 *
 * Every audio producer of the room is consumed through a mediasoup PlainTransport bound to 127.0.0.1
 * and received by a local UDP socket, which writes the Opus payloads unchanged (no transcoding) into
 * one Ogg Opus file per producer. Gaps (mute, DTX, packet loss) are filled with Opus silence, so each
 * file is a continuous timeline starting at its first packet. Participants joining later, re-created
 * producers (mic change, reconnect) and screen audio are all recorded.
 *
 * On stop, FFmpeg aligns the segments on the recording timeline into one file per participant plus
 * an optional mixed file (ogg, mp3, m4a or wav), all described by manifest.json.
 */

const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const crypto = require('crypto');
const { spawn: spawnProcess } = require('child_process');
const Logger = require('./Logger');

const log = new Logger('ServerRecording');

const LOCAL_IP = '127.0.0.1';
const SAMPLES_PER_MS = 48; // Opus always runs at 48 kHz
const SILENCE_FRAME_SAMPLES = 960; // 20 ms
// 20 ms CELT silence frame (TOC config 31, mono, one frame)
const OPUS_SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);
const STDERR_TAIL_BYTES = 4096;
const MIX_TIMEOUT_MS = 30 * 60 * 1000;

// ####################################################
// HELPERS
// ####################################################

function sanitizeName(value, fallback = 'track') {
    const safe = String(value ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w.-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^[_.]+|[_.]+$/g, '')
        .slice(0, 48);
    return safe || fallback;
}

function formatTimestamp(ms) {
    return new Date(ms).toISOString().replace(/[:.]/g, '-');
}

// Samples (48 kHz) carried by an Opus packet, from its TOC byte (RFC 6716 section 3.1)
function opusPacketSamples(packet) {
    if (!packet || packet.length < 1) return 0;
    const toc = packet[0];
    const config = toc >> 3;
    let frameSamples;
    if (config < 12) frameSamples = [480, 960, 1920, 2880][config & 3];
    else if (config < 16) frameSamples = [480, 960][config & 1];
    else frameSamples = [120, 240, 480, 960][config & 3];
    const code = toc & 3;
    let frames;
    if (code === 0) frames = 1;
    else if (code === 1 || code === 2) frames = 2;
    else {
        if (packet.length < 2) return 0;
        frames = packet[1] & 0x3f;
    }
    const samples = frameSamples * frames;
    return samples > 5760 ? 0 : samples; // more than 120 ms is invalid
}

function parseRtp(buf) {
    if (!buf || buf.length < 12 || buf[0] >> 6 !== 2) return null;
    // rtcp-mux: RTCP packet types 192-223 share the port (RFC 5761)
    if (buf[1] >= 192 && buf[1] <= 223) return null;
    let offset = 12 + (buf[0] & 0x0f) * 4;
    if (buf[0] & 0x10) {
        if (buf.length < offset + 4) return null;
        offset += 4 + buf.readUInt16BE(offset + 2) * 4;
    }
    let end = buf.length;
    if (buf[0] & 0x20) end -= buf[buf.length - 1];
    if (offset >= end) return null;
    return {
        payloadType: buf[1] & 0x7f,
        sequenceNumber: buf.readUInt16BE(2),
        timestamp: buf.readUInt32BE(4),
        ssrc: buf.readUInt32BE(8),
        payload: buf.subarray(offset, end),
    };
}

// ####################################################
// OGG OPUS WRITER (RFC 3533 + RFC 7845)
// ####################################################

const OGG_CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let r = i << 24;
        for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
        table[i] = r >>> 0;
    }
    return table;
})();

function oggCrc(buf) {
    let crc = 0;
    for (let i = 0; i < buf.length; i++) {
        crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0;
    }
    return crc;
}

function buildOggPage({ headerType, granule, serial, sequence, packets }) {
    const lacing = [];
    packets.forEach((packet) => {
        let len = packet.length;
        while (len >= 255) {
            lacing.push(255);
            len -= 255;
        }
        lacing.push(len);
    });
    const header = Buffer.alloc(27 + lacing.length);
    header.write('OggS', 0, 'ascii');
    header[4] = 0;
    header[5] = headerType;
    header.writeBigUInt64LE(BigInt(granule), 6);
    header.writeUInt32LE(serial >>> 0, 14);
    header.writeUInt32LE(sequence >>> 0, 18);
    header.writeUInt32LE(0, 22);
    header[26] = lacing.length;
    Buffer.from(lacing).copy(header, 27);
    const page = Buffer.concat([header, ...packets]);
    page.writeUInt32LE(oggCrc(page), 22);
    return page;
}

class OggOpusWriter {
    constructor(file, { channels = 2, serial = crypto.randomInt(0, 0xffffffff), pageSamples = 48000 } = {}) {
        this.fd = fs.openSync(file, 'w');
        this.serial = serial;
        this.sequence = 0;
        this.granule = 0;
        this.pageStartGranule = 0;
        this.pageSamples = pageSamples;
        this.packets = [];
        this.segments = 0;
        this.bytes = 0;
        this.closed = false;

        const head = Buffer.alloc(19);
        head.write('OpusHead', 0, 'ascii');
        head[8] = 1; // version
        head[9] = Math.min(Math.max(channels, 1), 2);
        head.writeUInt16LE(0, 10); // pre-skip: the stream is joined mid-way, nothing to skip
        head.writeUInt32LE(48000, 12);
        head.writeInt16LE(0, 16);
        head[18] = 0; // mapping family
        this._writePage(0x02, 0, [head]);

        const vendor = Buffer.from('MiroTalk SFU', 'utf8');
        const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
        tags.write('OpusTags', 0, 'ascii');
        tags.writeUInt32LE(vendor.length, 8);
        vendor.copy(tags, 12);
        tags.writeUInt32LE(0, 12 + vendor.length);
        this._writePage(0x00, 0, [tags]);
    }

    _writePage(headerType, granule, packets) {
        const page = buildOggPage({ headerType, granule, serial: this.serial, sequence: this.sequence++, packets });
        fs.writeSync(this.fd, page);
        this.bytes += page.length;
    }

    writePacket(packet, samples) {
        if (this.closed || !samples) return;
        const segments = Math.floor(packet.length / 255) + 1;
        if (this.segments + segments > 255) this._flush();
        this.packets.push(Buffer.from(packet));
        this.segments += segments;
        this.granule += samples;
        if (this.granule - this.pageStartGranule >= this.pageSamples) this._flush();
    }

    writeSilence(samples) {
        const frames = Math.floor(samples / SILENCE_FRAME_SAMPLES);
        for (let i = 0; i < frames; i++) this.writePacket(OPUS_SILENCE_FRAME, SILENCE_FRAME_SAMPLES);
        return frames * SILENCE_FRAME_SAMPLES;
    }

    _flush(eos = false) {
        if (!this.packets.length && !eos) return;
        this._writePage(eos ? 0x04 : 0x00, this.granule, this.packets);
        this.packets = [];
        this.segments = 0;
        this.pageStartGranule = this.granule;
    }

    close() {
        if (this.closed) return;
        try {
            this._flush(true);
        } finally {
            this.closed = true;
            fs.closeSync(this.fd);
        }
    }
}

// Keeps an Opus RTP stream on a continuous timeline: gaps visible in the RTP timestamps (DTX, loss) and
// gaps only visible on the wall clock (paused producer, timestamps rewritten) become silence.
class OpusRtpTimeline {
    constructor(writer, { payloadType, wallGapThresholdMs = 1000, maxRtpGapMs = 10 * 60 * 1000 } = {}) {
        this.writer = writer;
        this.payloadType = payloadType;
        this.wallGapThresholdMs = wallGapThresholdMs;
        this.maxRtpGapMs = maxRtpGapMs;
        this.firstWallMs = null;
        this.last = null;
    }

    handle(buf, nowMs) {
        const rtp = parseRtp(buf);
        if (!rtp || (this.payloadType !== undefined && rtp.payloadType !== this.payloadType)) return false;
        const samples = opusPacketSamples(rtp.payload);
        if (!samples) return false;

        if (this.firstWallMs === null) {
            this.firstWallMs = nowMs;
        } else {
            const seqDelta = (rtp.sequenceNumber - this.last.sequenceNumber) & 0xffff;
            if (rtp.ssrc === this.last.ssrc && (seqDelta === 0 || seqDelta >= 0x8000)) return false; // duplicate/late
            if (rtp.ssrc === this.last.ssrc) {
                const tsDelta = (rtp.timestamp - this.last.timestamp) >>> 0;
                const gap = tsDelta - this.last.samples;
                if (gap >= SILENCE_FRAME_SAMPLES && tsDelta < this.maxRtpGapMs * SAMPLES_PER_MS) {
                    this.writer.writeSilence(gap);
                }
            }
            const drift = (nowMs - this.firstWallMs) * SAMPLES_PER_MS - this.writer.granule;
            if (drift > this.wallGapThresholdMs * SAMPLES_PER_MS) {
                // Keep two frames of margin for network jitter
                this.writer.writeSilence(drift - 2 * SILENCE_FRAME_SAMPLES);
            }
        }

        this.writer.writePacket(rtp.payload, samples);
        this.last = { sequenceNumber: rtp.sequenceNumber, timestamp: rtp.timestamp, ssrc: rtp.ssrc, samples };
        return true;
    }
}

// ####################################################
// FFMPEG POST PROCESSING
// ####################################################

// Output formats of the participant/mixed files (raw tracks are always Ogg Opus, written without transcoding).
// encoders are tried in order: FFmpeg builds without libopus fall back to the native Opus encoder.
const OUTPUT_FORMATS = {
    ogg: { ext: 'ogg', container: 'ogg', codec: 'opus', encoders: ['libopus', 'opus'], bitrate: true },
    mp3: { ext: 'mp3', container: 'mp3', codec: 'mp3', encoders: ['libmp3lame'], bitrate: true },
    m4a: {
        ext: 'm4a',
        container: 'mp4',
        codec: 'aac',
        encoders: ['aac'],
        bitrate: true,
        extraArgs: ['-movflags', '+faststart'],
    },
    wav: { ext: 'wav', container: 'wav', codec: 'pcm_s16le', encoders: ['pcm_s16le'], bitrate: false },
};
const DEFAULT_OUTPUT_FORMAT = 'ogg';

function resolveOutputFormat(format) {
    const key = String(format || DEFAULT_OUTPUT_FORMAT)
        .trim()
        .toLowerCase();
    if (OUTPUT_FORMATS[key]) return key;
    log.warn(`Unsupported server recording format "${format}", using ${DEFAULT_OUTPUT_FORMAT}`);
    return DEFAULT_OUTPUT_FORMAT;
}

// inputs: [{ file, offsetMs }] placed on the recording timeline and padded to totalMs
function buildMixArgs(
    inputs,
    outputPath,
    { format = DEFAULT_OUTPUT_FORMAT, encoder, bitrate = '64k', totalMs = 0 } = {}
) {
    const output = OUTPUT_FORMATS[format] || OUTPUT_FORMATS[DEFAULT_OUTPUT_FORMAT];
    const codec = encoder || output.encoders[0];
    const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y'];
    inputs.forEach(({ file }) => args.push('-i', file));
    const chains = inputs.map(
        ({ offsetMs }, i) =>
            `[${i}:a]aresample=async=1:first_pts=0,adelay=delays=${Math.max(0, Math.round(offsetMs || 0))}:all=1[a${i}]`
    );
    const pad = totalMs > 0 ? `,apad=whole_dur=${Math.round(totalMs)}ms` : '';
    const filter =
        inputs.length === 1
            ? `${chains[0].slice(0, -'[a0]'.length)}${pad}[out]`
            : `${chains.join(';')};${inputs.map((_, i) => `[a${i}]`).join('')}` +
              `amix=inputs=${inputs.length}:duration=longest:dropout_transition=0:normalize=0${pad}[out]`;
    args.push('-filter_complex', filter, '-map', '[out]', '-ac', '1', '-ar', '48000', '-c:a', codec);
    if (codec === 'opus') args.push('-strict', '-2');
    if (output.bitrate) args.push('-b:a', bitrate);
    args.push(...(output.extraArgs || []), '-f', output.container, outputPath);
    return args;
}

// ####################################################
// SERVER RECORDER (one per room recording)
// ####################################################

const ABORTED = Symbol('aborted');

class ServerRecorder {
    constructor({
        roomId,
        sessionId,
        baseDir,
        ffmpegPath = 'ffmpeg',
        portRange = { min: 52000, max: 52999 },
        mixed = true,
        keepRawTracks = false,
        format = DEFAULT_OUTPUT_FORMAT,
        bitrate = '64k',
        now = Date.now,
        spawn = spawnProcess,
        onComplete = null,
    }) {
        this.roomId = roomId;
        this.sessionId = sessionId;
        this.baseDir = baseDir;
        this.ffmpegPath = ffmpegPath;
        this.portRange = portRange;
        this.mixed = mixed;
        this.keepRawTracks = keepRawTracks;
        this.format = resolveOutputFormat(format);
        this.bitrate = bitrate;
        this.now = now;
        this.spawn = spawn;
        this.onComplete = onComplete;
        this.active = false;
        this.startedAt = null;
        this.stoppedAt = null;
        this.startedBy = null;
        this.segments = new Map(); // producerId -> segment
        this.segmentIndex = 0;
        this.completion = null;
        this.folder = null;
        this.dir = null;
        this.rawDir = null;
    }

    isActive() {
        return this.active;
    }

    getState() {
        return {
            active: this.active,
            startedAt: this.startedAt,
            startedBy: this.startedBy,
            folder: this.folder,
            tracks: [...this.segments.values()].filter((seg) => seg.state === 'recording').length,
        };
    }

    start({ startedBy = null } = {}) {
        if (this.active || this.completion) return this.getState();
        this.startedAt = this.now();
        this.startedBy = startedBy;
        this.folder = `ServerRec_${sanitizeName(this.roomId, 'room')}_${formatTimestamp(this.startedAt)}_${sanitizeName(this.sessionId, 'session')}`;
        this.dir = path.join(this.baseDir, this.folder);
        this.rawDir = path.join(this.dir, 'raw');
        fs.mkdirSync(this.rawDir, { recursive: true });
        this.active = true;
        log.info('Server recording started', { room_id: this.roomId, dir: this.dir, started_by: startedBy });
        return this.getState();
    }

    // peer: { id, name, uuid } of the producer owner, router: the router hosting the producer
    addProducer({ producer, router, peer = {} }) {
        if (!this.active || !producer || producer.closed || producer.kind !== 'audio' || !router) return null;
        if (this.segments.has(producer.id)) return this.segments.get(producer.id);

        const index = ++this.segmentIndex;
        const peerName = peer.name || 'participant';
        const fileName = `${String(index).padStart(3, '0')}_${sanitizeName(peerName)}_${producer.id.slice(0, 8)}.ogg`;
        const segment = {
            id: producer.id,
            index,
            peerId: peer.id || null,
            peerUuid: peer.uuid || null,
            peerName,
            // uuid + name: reconnects/mic changes stay in one file, while tabs of the same browser
            // (shared uuid, different names) remain separate participants
            participantKey: `${peer.uuid || peer.id || producer.id}:${peerName}`,
            fileName,
            file: path.join(this.rawDir, fileName),
            firstPacketAtMs: null,
            endedAtMs: null,
            state: 'starting',
            socket: null,
            transport: null,
            consumer: null,
            writer: null,
            error: null,
        };
        this.segments.set(producer.id, segment);

        segment.ready = this._startSegment(segment, producer, router).catch((error) => {
            if (error !== ABORTED) {
                segment.error = error.message;
                log.warn('Server recording track failed to start', {
                    room_id: this.roomId,
                    producer_id: producer.id,
                    error: error.message,
                });
            }
            this._cleanupSegment(segment);
            if (segment.state === 'starting') segment.state = 'failed';
        });
        return segment;
    }

    _bindSocket() {
        return new Promise((resolve, reject) => {
            const socket = dgram.createSocket('udp4');
            socket.once('error', reject);
            socket.bind({ port: 0, address: LOCAL_IP, exclusive: true }, () => {
                socket.off('error', reject);
                socket.on('error', (error) => log.debug('Server recording socket error', error.message));
                resolve(socket);
            });
        });
    }

    async _startSegment(segment, producer, router) {
        const checkAborted = () => {
            if (segment.state !== 'starting') throw ABORTED;
        };

        segment.socket = await this._bindSocket();
        checkAborted();

        segment.transport = await router.createPlainTransport({
            listenInfo: { protocol: 'udp', ip: LOCAL_IP, portRange: this.portRange },
            rtcpMux: true,
            comedia: false,
            appData: { serverRecording: true },
        });
        checkAborted();
        segment.transport.on('routerclose', () => this.removeProducer(segment.id, 'router closed'));

        await segment.transport.connect({ ip: LOCAL_IP, port: segment.socket.address().port });
        checkAborted();

        segment.consumer = await segment.transport.consume({
            producerId: producer.id,
            rtpCapabilities: router.rtpCapabilities,
            paused: true,
            appData: { serverRecording: true },
        });
        checkAborted();
        segment.consumer.on('producerclose', () => this.removeProducer(segment.id, 'producer closed'));

        const codec = segment.consumer.rtpParameters.codecs[0];
        if (String(codec?.mimeType).toLowerCase() !== 'audio/opus') {
            throw new Error(`Unsupported audio codec ${codec?.mimeType}`);
        }

        segment.writer = new OggOpusWriter(segment.file, { channels: codec.channels || 2 });
        const timeline = new OpusRtpTimeline(segment.writer, { payloadType: codec.payloadType });

        segment.socket.on('message', (msg) => {
            if (segment.writer.closed || segment.error) return;
            try {
                const nowMs = this.now();
                if (timeline.handle(msg, nowMs) && segment.firstPacketAtMs === null) {
                    segment.firstPacketAtMs = nowMs - this.startedAt;
                }
            } catch (error) {
                // e.g. disk full: keep what was written, stop this track
                segment.error = error.message;
                log.error('Server recording write failed', { room_id: this.roomId, producer_id: segment.id, error });
                this.removeProducer(segment.id, 'write failed');
            }
        });

        await segment.consumer.resume();
        checkAborted();

        segment.state = 'recording';
        log.debug('Server recording track started', {
            room_id: this.roomId,
            producer_id: producer.id,
            peer_name: segment.peerName,
            file: segment.file,
        });
    }

    removeProducer(producerId, reason = 'producer closed') {
        const segment = this.segments.get(producerId);
        if (!segment) return Promise.resolve();
        if (segment.stopping) return segment.stopping;

        segment.stopping = (async () => {
            const wasStarting = segment.state === 'starting';
            if (segment.endedAtMs === null) segment.endedAtMs = this.now() - this.startedAt;
            segment.state = 'stopping';
            if (wasStarting) await segment.ready;
            this._cleanupSegment(segment);
            segment.state = 'stopped';
            log.debug('Server recording track stopped', { room_id: this.roomId, producer_id: producerId, reason });
        })();
        return segment.stopping;
    }

    _cleanupSegment(segment) {
        const steps = [
            () => segment.consumer && !segment.consumer.closed && segment.consumer.close(),
            () => segment.transport && !segment.transport.closed && segment.transport.close(),
            () => {
                if (!segment.socket) return;
                const socket = segment.socket;
                segment.socket = null;
                socket.close();
            },
            () => segment.writer?.close(),
        ];
        steps.forEach((step) => {
            try {
                step();
            } catch (error) {
                log.debug('Server recording cleanup step failed', { producer_id: segment.id, error: error.message });
            }
        });
    }

    // postProcess=false (e.g. server shutdown) only closes the raw tracks and writes the manifest
    stop({ reason = 'stopped', postProcess = true } = {}) {
        if (this.completion) return this.completion;
        if (!this.active) return Promise.resolve(null);
        this.active = false;
        this.stoppedAt = this.now();
        log.info('Server recording stopping', { room_id: this.roomId, reason });

        this.completion = (async () => {
            await Promise.all([...this.segments.keys()].map((id) => this.removeProducer(id, reason)));
            let result;
            try {
                result = await this._finalize({ reason, postProcess });
            } catch (error) {
                log.error('Server recording finalize failed', { room_id: this.roomId, error: error.message });
                result = { status: 'failed', error: error.message, dir: this.dir, folder: this.folder, files: [] };
            }
            try {
                await this.onComplete?.(result);
            } catch (error) {
                log.warn('Server recording completion handler failed', error.message);
            }
            return result;
        })();
        return this.completion;
    }

    _fileSize(file) {
        try {
            return fs.statSync(file).size;
        } catch {
            return 0;
        }
    }

    _removeFile(file) {
        try {
            fs.rmSync(file, { force: true });
        } catch (error) {
            log.debug('Server recording file removal failed', { file, error: error.message });
        }
    }

    runFfmpeg(args) {
        return new Promise((resolve) => {
            let stderr = '';
            let settled = false;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(result);
            };
            const child = this.spawn(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                finish({ code: -1, stderr: 'FFmpeg timeout' });
            }, MIX_TIMEOUT_MS);
            child.stderr?.on('data', (data) => {
                stderr = (stderr + data.toString()).slice(-STDERR_TAIL_BYTES);
            });
            child.once('error', (error) => finish({ code: -1, stderr: error.message }));
            child.once('close', (code) => finish({ code, stderr }));
        });
    }

    async _mix(inputs, outputPath, totalMs) {
        for (const encoder of OUTPUT_FORMATS[this.format].encoders) {
            const { code, stderr } = await this.runFfmpeg(
                buildMixArgs(inputs, outputPath, { format: this.format, encoder, bitrate: this.bitrate, totalMs })
            );
            if (code === 0 && this._fileSize(outputPath) > 0) return true;
            log.warn('Server recording mix failed', { output: outputPath, encoder, code, stderr });
        }
        this._removeFile(outputPath);
        return false;
    }

    async _finalize({ reason, postProcess }) {
        const durationMs = this.stoppedAt - this.startedAt;
        const segments = [...this.segments.values()].sort((a, b) => a.index - b.index);

        const tracks = segments.map((seg) => {
            const hasAudio = seg.firstPacketAtMs !== null && this._fileSize(seg.file) > 0;
            if (!hasAudio) this._removeFile(seg.file);
            return {
                producer_id: seg.id,
                peer_id: seg.peerId,
                peer_uuid: seg.peerUuid,
                peer_name: seg.peerName,
                file: hasAudio ? `raw/${seg.fileName}` : null,
                start_ms: seg.firstPacketAtMs,
                end_ms: seg.endedAtMs,
                error: seg.error,
                _seg: seg,
                _hasAudio: hasAudio,
            };
        });
        const usable = tracks.filter((track) => track._hasAudio);

        const groups = new Map();
        usable.forEach((track) => {
            const key = track._seg.participantKey;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(track);
        });

        const { ext, codec } = OUTPUT_FORMATS[this.format];
        const participants = [];
        let mixedFile = null;
        let allMixed = true;

        if (postProcess) {
            const usedNames = new Set(['mixed']); // reserved for the room mix
            for (const group of groups.values()) {
                const first = group[0]._seg;
                const base = sanitizeName(first.peerName, 'participant');
                let name = base;
                for (let n = 2; usedNames.has(name); n++) name = `${base}_${n}`;
                usedNames.add(name);
                const fileName = `${name}.${ext}`;
                const ok = await this._mix(
                    group.map((track) => ({ file: track._seg.file, offsetMs: track.start_ms })),
                    path.join(this.dir, fileName),
                    durationMs
                );
                allMixed = allMixed && ok;
                participants.push({
                    peer_uuid: first.peerUuid,
                    peer_name: first.peerName,
                    file: ok ? fileName : null,
                    tracks: group.map((track) => track.producer_id),
                });
            }

            if (this.mixed && usable.length) {
                const ok = await this._mix(
                    usable.map((track) => ({ file: track._seg.file, offsetMs: track.start_ms })),
                    path.join(this.dir, `mixed.${ext}`),
                    durationMs
                );
                allMixed = allMixed && ok;
                if (ok) mixedFile = `mixed.${ext}`;
            }
        }

        const keepRaw = this.keepRawTracks || !postProcess || !allMixed;
        if (!keepRaw) {
            try {
                fs.rmSync(this.rawDir, { recursive: true, force: true });
            } catch (error) {
                log.debug('Server recording raw dir removal failed', error.message);
            }
        }

        const status = !usable.length ? 'empty' : !postProcess ? 'raw' : allMixed ? 'completed' : 'partial';
        const manifest = {
            version: 1,
            status,
            reason,
            room_id: this.roomId,
            session_id: this.sessionId,
            started_by: this.startedBy,
            started_at: new Date(this.startedAt).toISOString(),
            stopped_at: new Date(this.stoppedAt).toISOString(),
            duration_ms: durationMs,
            // Participant/mixed files: chosen format, mono 48 kHz. Raw tracks: Ogg Opus as received
            format: { output: this.format, codec, sample_rate: 48000, channels: 1, raw_tracks: 'ogg/opus' },
            // Participant and mixed files start at started_at and last duration_ms (shared timeline).
            // Raw tracks start at their start_ms offset.
            participants,
            mixed: mixedFile,
            raw_tracks_kept: keepRaw,
            tracks: tracks.map(({ _seg, _hasAudio, ...track }) => (keepRaw ? track : { ...track, file: null })),
        };
        const manifestPath = path.join(this.dir, 'manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

        const files = [
            ...participants.filter((p) => p.file).map((p) => path.join(this.dir, p.file)),
            ...(mixedFile ? [path.join(this.dir, mixedFile)] : []),
            ...(keepRaw ? usable.map((track) => track._seg.file) : []),
            manifestPath,
        ];

        log.info('Server recording completed', {
            room_id: this.roomId,
            status,
            dir: this.dir,
            participants: participants.length,
            duration_ms: durationMs,
        });

        return { status, dir: this.dir, folder: this.folder, manifest, files };
    }
}

module.exports = {
    ServerRecorder,
    OggOpusWriter,
    OpusRtpTimeline,
    buildMixArgs,
    OUTPUT_FORMATS,
    buildOggPage,
    oggCrc,
    opusPacketSamples,
    parseRtp,
    sanitizeName,
};
