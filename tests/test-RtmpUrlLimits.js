'use strict';

require('should');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const proxyquire = require('proxyquire').noCallThru();

const Logger = class {
    debug() {}
    info() {}
    warn() {}
    error() {}
};

const publicValidator = { isPublicHttpUrl: async () => true, safeDnsLookup: () => {} };

function loadRtmpStreaming(rtmp, calls) {
    class FakeRtmpUrl {
        async start(url) {
            calls.url.push(url);
            return true;
        }
        stop() {}
    }
    class FakeRtmpFile {
        async start() {
            calls.file.push(true);
            return true;
        }
        stop() {}
    }
    return proxyquire('../app/src/RtmpStreaming', {
        './config': { media: { rtmp } },
        './RtmpUrl': FakeRtmpUrl,
        './RtmpFile': FakeRtmpFile,
        './Validator': publicValidator,
        './Logger': Logger,
    });
}

function loadRtmpUrl() {
    return proxyquire('../app/src/RtmpUrl', {
        './config': { media: { rtmp: {} } },
        './Validator': publicValidator,
        './Logger': Logger,
        './FfmpegProcess': { spawnFfmpeg: () => ({}) },
    });
}

function infiniteStream(headers = {}) {
    const chunk = Buffer.alloc(64 * 1024, 1);
    const stream = new Readable({
        read() {
            this.push(chunk);
        },
    });
    stream.headers = headers;
    return stream;
}

describe('test-RtmpUrlLimits', () => {
    const baseRtmp = { enabled: true, fromFile: true, fromUrl: true, server: 'rtmp://localhost:1935' };
    const room = { send() {} };

    it('rejects URL streaming when rtmp.fromUrl is false', async () => {
        const calls = { url: [], file: [] };
        const RtmpStreaming = loadRtmpStreaming({ ...baseRtmp, fromUrl: false }, calls);
        const result = await new RtmpStreaming(room).startRTMPfromURL('sid', room, 'localhost', 1935, 'https://a.b/v');
        result.should.be.false();
        calls.url.length.should.equal(0);
    });

    it('still allows URL streaming when rtmp.fromUrl is true', async () => {
        const calls = { url: [], file: [] };
        const RtmpStreaming = loadRtmpStreaming(baseRtmp, calls);
        const result = await new RtmpStreaming(room).startRTMPfromURL('sid', room, 'localhost', 1935, 'https://a.b/v');
        result.should.be.a.String();
        calls.url.length.should.equal(1);
    });

    it('rejects file streaming when rtmp.fromFile is false', async () => {
        const calls = { url: [], file: [] };
        const RtmpStreaming = loadRtmpStreaming({ ...baseRtmp, fromFile: false }, calls);
        const result = await new RtmpStreaming(room).startRTMP('sid', room);
        result.should.be.false();
        calls.file.length.should.equal(0);
    });

    describe('URL download limits', () => {
        let tmpBefore;
        const listTemp = () => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('mirotalk-rtmp-'));

        beforeEach(() => {
            tmpBefore = new Set(listTemp());
        });

        afterEach(() => {
            listTemp()
                .filter((f) => !tmpBefore.has(f))
                .should.be.empty('partial download temp dir was not removed');
        });

        it('aborts a continuously streaming source once the byte cap is exceeded', async () => {
            const RtmpUrl = loadRtmpUrl();
            const streamer = new RtmpUrl('sid', room);
            streamer.maxDownloadBytes = 1024 * 1024;
            streamer.openValidatedStream = async () => infiniteStream();
            await streamer.downloadValidatedFile('https://a.b/v').should.be.rejectedWith(/maximum size/);
        });

        it('rejects an advertised Content-Length above the cap before writing', async () => {
            const RtmpUrl = loadRtmpUrl();
            const streamer = new RtmpUrl('sid', room);
            streamer.maxDownloadBytes = 1024;
            streamer.openValidatedStream = async () => infiniteStream({ 'content-length': '999999999' });
            await streamer.downloadValidatedFile('https://a.b/v').should.be.rejectedWith(/too large/);
        });

        it('aborts when the total download deadline elapses', async () => {
            const RtmpUrl = loadRtmpUrl();
            const streamer = new RtmpUrl('sid', room);
            streamer.downloadTimeoutMs = 100;
            streamer.openValidatedStream = async () => {
                const stream = new Readable({ read() {} });
                stream.headers = {};
                const timer = setInterval(() => stream.push(Buffer.alloc(16)), 10);
                stream.on('close', () => clearInterval(timer));
                return stream;
            };
            await streamer.downloadValidatedFile('https://a.b/v').should.be.rejectedWith(/exceeded 100 ms/);
        });

        it('downloads a source within the limits', async () => {
            const RtmpUrl = loadRtmpUrl();
            const streamer = new RtmpUrl('sid', room);
            streamer.openValidatedStream = async () => {
                const stream = Readable.from([Buffer.alloc(4096, 2)]);
                stream.headers = { 'content-length': '4096' };
                return stream;
            };
            const file = await streamer.downloadValidatedFile('https://a.b/v');
            fs.statSync(file).size.should.equal(4096);
            path.basename(file).should.equal('input-media');
            streamer.closeInput();
        });
    });
});
