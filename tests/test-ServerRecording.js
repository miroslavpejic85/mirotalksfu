'use strict';

const assert = require('assert/strict');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const {
    ServerRecorder,
    OggOpusWriter,
    OpusRtpTimeline,
    buildMixArgs,
    oggCrc,
    opusPacketSamples,
    parseRtp,
    sanitizeName,
} = require('../app/src/ServerRecording');
const Room = require('../app/src/Room');

const PT = 100;
// TOC 0xFC: CELT fullband 20 ms, stereo, one frame
const OPUS_20MS = Buffer.from([0xfc, 0x01, 0x02, 0x03]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function rtpPacket({ seq, ts, ssrc = 1234, pt = PT, payload = OPUS_20MS }) {
    const header = Buffer.alloc(12);
    header[0] = 0x80;
    header[1] = pt;
    header.writeUInt16BE(seq & 0xffff, 2);
    header.writeUInt32BE(ts >>> 0, 4);
    header.writeUInt32BE(ssrc, 8);
    return Buffer.concat([header, payload]);
}

function readOggPages(file) {
    const data = fs.readFileSync(file);
    const pages = [];
    let offset = 0;
    while (offset < data.length) {
        assert.equal(data.toString('ascii', offset, offset + 4), 'OggS');
        const segments = data[offset + 26];
        const lacing = [...data.subarray(offset + 27, offset + 27 + segments)];
        const bodySize = lacing.reduce((sum, value) => sum + value, 0);
        const size = 27 + segments + bodySize;
        const page = Buffer.from(data.subarray(offset, offset + size));
        const crc = page.readUInt32LE(22);
        page.writeUInt32LE(0, 22);
        pages.push({
            headerType: page[5],
            granule: Number(page.readBigUInt64LE(6)),
            sequence: page.readUInt32LE(18),
            crcValid: crc === oggCrc(page),
            body: page.subarray(27 + segments),
            packets: lacing.filter((value) => value < 255).length,
        });
        offset += size;
    }
    return pages;
}

class FakeConsumer extends EventEmitter {
    constructor() {
        super();
        this.closed = false;
        this.paused = true;
        this.rtpParameters = { codecs: [{ mimeType: 'audio/opus', payloadType: PT, clockRate: 48000, channels: 2 }] };
    }
    async resume() {
        this.paused = false;
    }
    close() {
        this.closed = true;
    }
}

class FakeTransport extends EventEmitter {
    constructor(options) {
        super();
        this.options = options;
        this.closed = false;
        this.remote = null;
        this.consumer = null;
    }
    async connect(remote) {
        this.remote = remote;
    }
    async consume({ producerId, paused }) {
        this.consumer = new FakeConsumer();
        this.consumer.producerId = producerId;
        this.consumer.paused = paused;
        return this.consumer;
    }
    close() {
        this.closed = true;
    }
}

function createRouter() {
    return {
        rtpCapabilities: { codecs: [] },
        transports: [],
        async createPlainTransport(options) {
            const transport = new FakeTransport(options);
            this.transports.push(transport);
            return transport;
        },
    };
}

// Simulates FFmpeg for the post-processing step: writes the output file and exits
function createFakeSpawn({ exitCode = 0 } = {}) {
    const calls = [];
    const spawn = (command, args) => {
        calls.push(args);
        const child = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        setImmediate(() => {
            if (exitCode === 0) fs.writeFileSync(args[args.length - 1], 'audio');
            else child.stderr.emit('data', Buffer.from('mix error'));
            child.emit('close', exitCode);
        });
        return child;
    };
    return { spawn, calls };
}

describe('test-ServerRecording', () => {
    let baseDir;
    let sender;

    beforeEach(() => {
        baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirotalk-srvrec-'));
        sender = dgram.createSocket('udp4');
    });

    afterEach(() => {
        sender.close();
        fs.rmSync(baseDir, { recursive: true, force: true });
    });

    const sendTo = (port, packet) =>
        new Promise((resolve, reject) =>
            sender.send(packet, port, '127.0.0.1', (error) => (error ? reject(error) : resolve()))
        );

    describe('RTP and Opus parsing', () => {
        it('computes Opus packet durations from the TOC byte', () => {
            assert.equal(opusPacketSamples(Buffer.from([0xfc])), 960); // CELT 20 ms
            assert.equal(opusPacketSamples(Buffer.from([0x08])), 960); // SILK 20 ms
            assert.equal(opusPacketSamples(Buffer.from([0x18])), 2880); // SILK 60 ms
            assert.equal(opusPacketSamples(Buffer.from([0x78])), 960); // hybrid 20 ms
            assert.equal(opusPacketSamples(Buffer.from([0xfd])), 1920); // two frames
            assert.equal(opusPacketSamples(Buffer.from([0xff, 0x03])), 2880); // code 3, three frames
            assert.equal(opusPacketSamples(Buffer.from([0xff, 0x3f])), 0); // over 120 ms: invalid
            assert.equal(opusPacketSamples(Buffer.alloc(0)), 0);
        });

        it('extracts the payload and skips CSRCs, header extensions, padding and RTCP', () => {
            const plain = parseRtp(rtpPacket({ seq: 7, ts: 960, ssrc: 99 }));
            assert.deepEqual(
                { pt: plain.payloadType, seq: plain.sequenceNumber, ts: plain.timestamp, ssrc: plain.ssrc },
                { pt: PT, seq: 7, ts: 960, ssrc: 99 }
            );
            assert.deepEqual([...plain.payload], [...OPUS_20MS]);

            const withExtras = rtpPacket({ seq: 1, ts: 0 });
            withExtras[0] = 0x80 | 0x20 | 0x10 | 0x01; // padding, extension, 1 CSRC
            const extension = Buffer.from([0xbe, 0xde, 0x00, 0x01, 0x10, 0xaa, 0x00, 0x00]);
            const packet = Buffer.concat([
                withExtras.subarray(0, 12),
                Buffer.alloc(4),
                extension,
                OPUS_20MS,
                Buffer.from([0, 0, 3]),
            ]);
            assert.deepEqual([...parseRtp(packet).payload], [...OPUS_20MS]);

            const rtcp = Buffer.alloc(12);
            rtcp[0] = 0x80;
            rtcp[1] = 200;
            assert.equal(parseRtp(rtcp), null);
            assert.equal(parseRtp(Buffer.from([0x00, 0x00])), null);
        });

        it('sanitizes names for file paths', () => {
            assert.equal(sanitizeName('Luca Rossì / ../x'), 'Luca_Rossi_.._x');
            assert.equal(sanitizeName('   '), 'track');
        });
    });

    describe('OggOpusWriter', () => {
        it('writes valid Ogg Opus pages with headers, granule positions and EOS', () => {
            const file = path.join(baseDir, 'a.ogg');
            const writer = new OggOpusWriter(file, { channels: 2, serial: 42, pageSamples: 960 * 3 });
            for (let i = 0; i < 5; i++) writer.writePacket(OPUS_20MS, 960);
            assert.equal(writer.writeSilence(960 * 2 + 100), 960 * 2);
            writer.close();
            writer.close();

            const pages = readOggPages(file);
            assert.ok(pages.every((page) => page.crcValid));
            assert.deepEqual(
                pages.map((page) => page.sequence),
                pages.map((_, i) => i)
            );
            assert.equal(pages[0].headerType, 0x02);
            assert.equal(pages[0].body.toString('ascii', 0, 8), 'OpusHead');
            assert.equal(pages[0].body[9], 2);
            assert.equal(pages[0].body.readUInt32LE(12), 48000);
            assert.equal(pages[1].body.toString('ascii', 0, 8), 'OpusTags');
            const last = pages[pages.length - 1];
            assert.equal(last.headerType, 0x04);
            assert.equal(last.granule, 960 * 7);
            assert.equal(
                pages.slice(2).reduce((sum, page) => sum + page.packets, 0),
                7
            );
        });
    });

    describe('OpusRtpTimeline', () => {
        const createTimeline = () => {
            const written = [];
            const writer = {
                granule: 0,
                writePacket(packet, samples) {
                    written.push(packet.length === 3 ? 'silence' : 'audio');
                    this.granule += samples;
                },
                writeSilence(samples) {
                    const frames = Math.floor(samples / 960);
                    for (let i = 0; i < frames; i++) this.writePacket(Buffer.alloc(3), 960);
                    return frames * 960;
                },
            };
            return { timeline: new OpusRtpTimeline(writer, { payloadType: PT }), writer, written };
        };

        it('fills RTP timestamp gaps (DTX, loss) with silence', () => {
            const { timeline, written } = createTimeline();
            assert.ok(timeline.handle(rtpPacket({ seq: 1, ts: 0 }), 0));
            assert.ok(timeline.handle(rtpPacket({ seq: 2, ts: 960 }), 20));
            assert.ok(timeline.handle(rtpPacket({ seq: 3, ts: 960 * 5 }), 100)); // 3 frames missing
            assert.deepEqual(written, ['audio', 'audio', 'silence', 'silence', 'silence', 'audio']);
        });

        it('fills wall-clock gaps when timestamps do not show the pause', () => {
            const { timeline, writer } = createTimeline();
            timeline.handle(rtpPacket({ seq: 1, ts: 0 }), 0);
            timeline.handle(rtpPacket({ seq: 2, ts: 960 }), 3000); // paused producer, timestamps continuous
            // 3 s on the timeline, minus the 40 ms jitter margin and the packet itself
            assert.equal(writer.granule, 960 + (3000 * 48 - 960 - 2 * 960) + 960);
        });

        it('drops duplicates, late packets, other payload types and invalid payloads', () => {
            const { timeline, written } = createTimeline();
            timeline.handle(rtpPacket({ seq: 10, ts: 0 }), 0);
            assert.equal(timeline.handle(rtpPacket({ seq: 10, ts: 0 }), 20), false);
            assert.equal(timeline.handle(rtpPacket({ seq: 9, ts: 0 }), 20), false);
            assert.equal(timeline.handle(rtpPacket({ seq: 11, ts: 960, pt: 101 }), 20), false);
            assert.equal(timeline.handle(rtpPacket({ seq: 11, ts: 960, payload: Buffer.alloc(0) }), 20), false);
            assert.ok(timeline.handle(rtpPacket({ seq: 11, ts: 960 }), 20));
            assert.deepEqual(written, ['audio', 'audio']);
        });
    });

    describe('buildMixArgs', () => {
        it('aligns a single input on the recording timeline', () => {
            const args = buildMixArgs([{ file: 'a.ogg', offsetMs: 1500.4 }], 'out.ogg', { totalMs: 9000 });
            const filter = args[args.indexOf('-filter_complex') + 1];
            assert.equal(
                filter,
                '[0:a]aresample=async=1:first_pts=0,adelay=delays=1500:all=1,apad=whole_dur=9000ms[out]'
            );
            assert.equal(args[args.length - 1], 'out.ogg');
            assert.ok(args.includes('libopus'));
        });

        it('mixes several inputs and supports the native Opus encoder', () => {
            const args = buildMixArgs(
                [
                    { file: 'a.ogg', offsetMs: 0 },
                    { file: 'b.ogg', offsetMs: 2000 },
                ],
                'out.ogg',
                { encoder: 'opus' }
            );
            const filter = args[args.indexOf('-filter_complex') + 1];
            assert.match(filter, /\[a0\]\[a1\]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0\[out\]$/);
            assert.match(filter, /\[1:a\]aresample=async=1:first_pts=0,adelay=delays=2000:all=1\[a1\]/);
            assert.ok(args.includes('-strict'));
        });

        it('builds the encoder and container arguments of every output format', () => {
            const tail = (format) => {
                const args = buildMixArgs([{ file: 'a.ogg', offsetMs: 0 }], `out.${format}`, {
                    format,
                    bitrate: '96k',
                });
                return args.slice(args.indexOf('-c:a'));
            };
            assert.deepEqual(tail('ogg'), ['-c:a', 'libopus', '-b:a', '96k', '-f', 'ogg', 'out.ogg']);
            assert.deepEqual(tail('mp3'), ['-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3', 'out.mp3']);
            assert.deepEqual(tail('m4a'), [
                '-c:a',
                'aac',
                '-b:a',
                '96k',
                '-movflags',
                '+faststart',
                '-f',
                'mp4',
                'out.m4a',
            ]);
            assert.deepEqual(tail('wav'), ['-c:a', 'pcm_s16le', '-f', 'wav', 'out.wav']);
        });
    });

    describe('ServerRecorder', () => {
        const createRecorder = (options = {}) => {
            let time = 10000;
            const fake = createFakeSpawn(options);
            const recorder = new ServerRecorder({
                roomId: 'room 1',
                sessionId: 'session-1',
                baseDir,
                now: () => time,
                spawn: fake.spawn,
                ...options,
            });
            return {
                recorder,
                calls: fake.calls,
                setTime: (value) => {
                    time = value;
                },
            };
        };

        const addTrack = async (recorder, router, producerId, peer) => {
            const segment = recorder.addProducer({ producer: { id: producerId, kind: 'audio' }, router, peer });
            await segment.ready;
            return { segment, transport: router.transports[router.transports.length - 1] };
        };

        const sendPackets = async (transport, count, { startSeq = 1, ssrc = 1 } = {}) => {
            for (let i = 0; i < count; i++) {
                await sendTo(transport.remote.port, rtpPacket({ seq: startSeq + i, ts: (startSeq + i) * 960, ssrc }));
            }
            await sleep(30);
        };

        it('records late joiners and re-created producers into aligned participant files', async () => {
            const { recorder, calls, setTime } = createRecorder();
            const router = createRouter();
            const completed = [];
            recorder.onComplete = (result) => completed.push(result);

            recorder.start({ startedBy: 'Alice' });
            assert.equal(recorder.getState().active, true);

            const alice = { id: 'sock-a', uuid: 'uuid-alice', name: 'Alice' };
            const a1 = await addTrack(recorder, router, 'producer-a1', alice);
            assert.equal(a1.transport.options.rtcpMux, true);
            assert.equal(a1.transport.options.listenInfo.ip, '127.0.0.1');
            assert.deepEqual(a1.transport.options.listenInfo.portRange, { min: 52000, max: 52999 });
            assert.equal(a1.transport.consumer.paused, false);
            await sendPackets(a1.transport, 3);

            // Bob joins two seconds later
            setTime(12000);
            const b1 = await addTrack(recorder, router, 'producer-b1', { id: 'sock-b', uuid: 'uuid-bob', name: 'Bob' });
            await sendPackets(b1.transport, 2, { ssrc: 2 });

            // Alice changes microphone: the old producer closes, a new one appears
            setTime(13000);
            a1.transport.consumer.emit('producerclose');
            await sleep(10);
            assert.equal(a1.transport.closed, true);
            setTime(14000);
            const a2 = await addTrack(recorder, router, 'producer-a2', alice);
            await sendPackets(a2.transport, 2, { ssrc: 3 });

            // Carol never unmutes: no packets
            await addTrack(recorder, router, 'producer-c1', { id: 'sock-c', uuid: 'uuid-carol', name: 'Carol' });

            setTime(16000);
            const result = await recorder.stop({ reason: 'test' });
            assert.equal(completed[0], result);
            assert.equal(recorder.isActive(), false);
            assert.equal(await recorder.stop(), result);

            assert.equal(result.status, 'completed');
            assert.match(result.folder, /^ServerRec_room_1_.*_session-1$/);
            const { manifest } = result;
            assert.equal(manifest.duration_ms, 6000);
            assert.equal(manifest.started_by, 'Alice');
            assert.equal(manifest.mixed, 'mixed.ogg');
            assert.equal(manifest.raw_tracks_kept, false);
            assert.deepEqual(
                manifest.participants.map((p) => [p.peer_name, p.file, p.tracks]),
                [
                    ['Alice', 'Alice.ogg', ['producer-a1', 'producer-a2']],
                    ['Bob', 'Bob.ogg', ['producer-b1']],
                ]
            );
            assert.deepEqual(
                manifest.tracks.map((t) => [t.producer_id, t.start_ms, t.end_ms, t.file]),
                [
                    ['producer-a1', 0, 3000, null],
                    ['producer-b1', 2000, 6000, null],
                    ['producer-a2', 4000, 6000, null],
                    ['producer-c1', null, 6000, null],
                ]
            );

            // Alice, Bob, mixed: every output padded to the recording duration
            assert.equal(calls.length, 3);
            const filters = calls.map((args) => args[args.indexOf('-filter_complex') + 1]);
            assert.match(filters[0], /adelay=delays=0:all=1.*adelay=delays=4000:all=1.*apad=whole_dur=6000ms/);
            assert.match(filters[1], /adelay=delays=2000:all=1,apad=whole_dur=6000ms\[out\]/);
            assert.match(filters[2], /amix=inputs=3/);

            assert.ok(fs.existsSync(path.join(result.dir, 'Alice.ogg')));
            assert.ok(fs.existsSync(path.join(result.dir, 'mixed.ogg')));
            assert.ok(!fs.existsSync(path.join(result.dir, 'raw')));
            assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.dir, 'manifest.json'), 'utf8')), manifest);
            assert.ok(router.transports.every((transport) => transport.closed && transport.consumer.closed));
        });

        it('keeps tabs of the same browser (shared uuid) as separate participants without file name clashes', async () => {
            const { recorder, calls, setTime } = createRecorder();
            const router = createRouter();
            recorder.start();
            const peers = [
                ['p-miro', { id: 's1', uuid: 'same-uuid', name: 'miro' }],
                ['p-ciro', { id: 's2', uuid: 'same-uuid', name: 'ciro' }],
                ['p-jose1', { id: 's3', uuid: 'same-uuid', name: 'José' }],
                ['p-jose2', { id: 's4', uuid: 'same-uuid', name: 'Jose' }],
                ['p-mixed', { id: 's5', uuid: 'other', name: 'mixed' }],
            ];
            for (const [producerId, peer] of peers) {
                const { transport } = await addTrack(recorder, router, producerId, peer);
                await sendPackets(transport, 1);
            }
            setTime(12000);

            const result = await recorder.stop();
            assert.deepEqual(
                result.manifest.participants.map((p) => [p.peer_name, p.file]),
                [
                    ['miro', 'miro.ogg'],
                    ['ciro', 'ciro.ogg'],
                    ['José', 'Jose.ogg'],
                    ['Jose', 'Jose_2.ogg'],
                    ['mixed', 'mixed_2.ogg'],
                ]
            );
            assert.equal(result.manifest.mixed, 'mixed.ogg');
            // 5 participant files + the room mix, each written once
            const outputs = calls.map((args) => path.basename(args[args.length - 1]));
            assert.equal(new Set(outputs).size, 6);
        });

        it('writes the participant and mixed files in the configured format', async () => {
            for (const [format, ext, codec] of [
                ['mp3', 'mp3', 'mp3'],
                [' WAV ', 'wav', 'pcm_s16le'],
                ['flac', 'ogg', 'opus'], // unsupported: falls back to ogg
            ]) {
                const { recorder, calls, setTime } = createRecorder({ format });
                const router = createRouter();
                recorder.start();
                const { transport } = await addTrack(recorder, router, `p-${ext}`, { id: 's1', name: 'Miro' });
                await sendPackets(transport, 1);
                setTime(11000);

                const result = await recorder.stop();
                assert.equal(result.manifest.participants[0].file, `Miro.${ext}`);
                assert.equal(result.manifest.mixed, `mixed.${ext}`);
                assert.equal(result.manifest.format.output, ext);
                assert.equal(result.manifest.format.codec, codec);
                assert.equal(result.manifest.format.raw_tracks, 'ogg/opus');
                assert.ok(fs.existsSync(path.join(result.dir, `Miro.${ext}`)));
                assert.deepEqual(
                    calls.map((args) => path.extname(args[args.length - 1])),
                    [`.${ext}`, `.${ext}`]
                );
            }
        });

        it('keeps raw tracks and reports a partial result when FFmpeg fails', async () => {
            const { recorder, calls, setTime } = createRecorder({ exitCode: 1 });
            const router = createRouter();
            recorder.start();
            const track = await addTrack(recorder, router, 'producer-1', { id: 's1', name: 'Solo' });
            await sendPackets(track.transport, 3);
            setTime(11000);

            const result = await recorder.stop();
            assert.equal(result.status, 'partial');
            assert.equal(calls.length, 4); // participant + mixed, each with libopus then native opus
            assert.equal(result.manifest.participants[0].file, null);
            assert.equal(result.manifest.mixed, null);
            assert.equal(result.manifest.raw_tracks_kept, true);
            const rawFile = path.join(result.dir, result.manifest.tracks[0].file);
            assert.ok(readOggPages(rawFile).every((page) => page.crcValid));
            assert.ok(result.files.includes(rawFile));
        });

        it('only closes raw tracks without post-processing (server shutdown)', async () => {
            const { recorder, calls } = createRecorder();
            const router = createRouter();
            recorder.start();
            const track = await addTrack(recorder, router, 'producer-1', { id: 's1', name: 'Solo' });
            await sendPackets(track.transport, 2);

            const result = await recorder.stop({ reason: 'server shutdown', postProcess: false });
            assert.equal(result.status, 'raw');
            assert.equal(calls.length, 0);
            assert.equal(result.manifest.raw_tracks_kept, true);
            assert.equal(readOggPages(path.join(result.dir, result.manifest.tracks[0].file)).at(-1).granule, 960 * 2);
        });

        it('ignores video producers, duplicates and producers added when not recording', async () => {
            const { recorder } = createRecorder();
            const router = createRouter();
            const producer = { id: 'p1', kind: 'audio' };
            assert.equal(recorder.addProducer({ producer, router }), null);

            recorder.start();
            assert.equal(recorder.addProducer({ producer: { id: 'v1', kind: 'video' }, router }), null);
            assert.equal(recorder.addProducer({ producer: { id: 'p2', kind: 'audio', closed: true }, router }), null);
            const segment = recorder.addProducer({ producer, router });
            assert.equal(recorder.addProducer({ producer, router }), segment);
            await segment.ready;

            const result = await recorder.stop();
            assert.equal(result.status, 'empty');
            assert.equal(router.transports.length, 1);
            assert.equal(recorder.addProducer({ producer: { id: 'p3', kind: 'audio' }, router }), null);
        });

        it('cleans up a track that stops while it is still starting', async () => {
            const { recorder } = createRecorder();
            const router = createRouter();
            let releaseConsume;
            router.createPlainTransport = async (options) => {
                const transport = new FakeTransport(options);
                const consume = transport.consume.bind(transport);
                transport.consume = async (args) => {
                    await new Promise((resolve) => {
                        releaseConsume = resolve;
                    });
                    return consume(args);
                };
                router.transports.push(transport);
                return transport;
            };
            recorder.start();
            const segment = recorder.addProducer({ producer: { id: 'p1', kind: 'audio' }, router });
            await sleep(10);
            const stopping = recorder.removeProducer('p1');
            releaseConsume();
            await stopping;
            assert.equal(segment.state, 'stopped');
            assert.equal(router.transports[0].closed, true);
            assert.equal(router.transports[0].consumer.closed, true);
            assert.equal(segment.error, null);
            await recorder.stop();
        });
    });

    describe('Room integration', () => {
        const createRoom = () => {
            const router = createRouter();
            const room = Object.create(Room.prototype);
            room.id = 'room-1';
            room.sessionId = 'session-1';
            room.recording = { recServerSide: true };
            room.serverRecorder = null;
            room.getPeerRouter = () => router;
            room.peers = new Map([
                [
                    'sock-a',
                    {
                        peer_uuid: 'uuid-a',
                        peer_name: 'Alice',
                        producers: new Map([
                            ['audio-a', { id: 'audio-a', kind: 'audio' }],
                            ['video-a', { id: 'video-a', kind: 'video' }],
                        ]),
                    },
                ],
            ]);
            return { room, router };
        };

        it('records the producers already in the room and the ones created later', async () => {
            const { room, router } = createRoom();
            assert.deepEqual(room.getServerRecordingState(), { active: false });

            const state = room.startServerRecording({ baseDir, startedBy: 'Alice' });
            assert.equal(state.active, true);
            assert.equal(state.startedBy, 'Alice');
            assert.equal(typeof state.elapsedMs, 'number');
            assert.deepEqual([...room.serverRecorder.segments.keys()], ['audio-a']);
            assert.equal(room.startServerRecording({ baseDir }).active, true);

            room.peers.set('sock-b', { peer_uuid: 'uuid-b', peer_name: 'Bob', producers: new Map() });
            room.addProducerToServerRecording('sock-b', { id: 'audio-b', kind: 'audio' });
            room.addProducerToServerRecording('sock-b', { id: 'video-b', kind: 'video' });
            room.addProducerToServerRecording('unknown', { id: 'audio-x', kind: 'audio' });
            assert.deepEqual([...room.serverRecorder.segments.keys()], ['audio-a', 'audio-b']);
            assert.equal(room.serverRecorder.segments.get('audio-b').peerName, 'Bob');

            await Promise.all([...room.serverRecorder.segments.values()].map((segment) => segment.ready));
            const result = await room.stopServerRecording({ postProcess: false });
            assert.equal(result.status, 'empty');
            assert.equal(room.serverRecorder, null);
            assert.deepEqual(room.getServerRecordingState(), { active: false });
            assert.equal(await room.stopServerRecording(), null);
            assert.ok(router.transports.every((transport) => transport.closed));
        });

        it('refuses to start when server-side recording is disabled', () => {
            const { room } = createRoom();
            room.recording.recServerSide = false;
            assert.throws(() => room.startServerRecording({ baseDir }), /disabled/);
            room.addProducerToServerRecording('sock-a', { id: 'audio-a', kind: 'audio' });
            assert.equal(room.serverRecorder, null);
        });
    });
});
