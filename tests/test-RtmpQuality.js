'use strict';

require('should');

const { resolveRtmpVideoSettings, buildLiveStreamArgs, buildFileStreamArgs } = require('../app/src/RtmpQuality');

describe('test-RtmpQuality', () => {
    it('keeps the previous 720p / 3000k / 128k defaults', () => {
        const s = resolveRtmpVideoSettings({});
        s.should.containEql({ quality: '720p', width: 1280, height: 720, videoBitrate: 3000, audioBitrate: 128 });
    });

    it('applies the env overrides to the default quality only', () => {
        const cfg = { videoQuality: '1080p', videoBitrate: 6000, videoFps: 60, videoPreset: 'fast' };
        resolveRtmpVideoSettings(cfg).should.containEql({
            quality: '1080p',
            videoBitrate: 6000,
            fps: 60,
            preset: 'fast',
        });
        resolveRtmpVideoSettings(cfg, '720p').should.containEql({ quality: '720p', videoBitrate: 3000 });
    });

    it('honours a client quality only up to the configured maximum', () => {
        resolveRtmpVideoSettings({ maxVideoQuality: '1080p' }, '1080p').quality.should.equal('1080p');
        resolveRtmpVideoSettings({ maxVideoQuality: '1080p' }, '1440p').quality.should.equal('720p');
        resolveRtmpVideoSettings({ allowQualitySelection: false }, '1080p').quality.should.equal('720p');
        resolveRtmpVideoSettings({}, 'bogus').quality.should.equal('720p');
        resolveRtmpVideoSettings({ videoPreset: 'bogus' }).preset.should.equal('veryfast');
    });

    it('builds live args with constant fps and no silent track when audio exists', () => {
        const args = buildLiveStreamArgs(resolveRtmpVideoSettings({}), 'rtmp://x/live/key');
        args.should.containEql('-b:v').and.containEql('3000k');
        args.join(' ').should.containEql('fps=30,scale=1280:720');
        args.join(' ').should.not.containEql('anullsrc');
        args[args.length - 1].should.equal('rtmp://x/live/key');
    });

    it('adds a silent audio track when the capture has no audio', () => {
        const args = buildLiveStreamArgs(resolveRtmpVideoSettings({}), 'rtmp://x/live/key', { hasAudio: false });
        args.join(' ').should.containEql('anullsrc').and.containEql('-shortest');
    });

    it('builds file args from the same settings', () => {
        const args = buildFileStreamArgs(resolveRtmpVideoSettings({ videoQuality: '1080p' }), 'pipe:0', 'rtmp://x');
        args.join(' ').should.containEql('-b:v 4500k').and.containEql('scale=1920:1080');
    });
});
