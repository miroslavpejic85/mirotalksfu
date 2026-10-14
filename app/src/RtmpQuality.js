'use strict';

// Output profiles for RTMP streaming (bitrates follow YouTube Live recommendations)
const RTMP_QUALITY_PROFILES = {
    '480p': { width: 854, height: 480, videoBitrate: 1500 },
    '720p': { width: 1280, height: 720, videoBitrate: 3000 },
    '1080p': { width: 1920, height: 1080, videoBitrate: 4500 },
    '1440p': { width: 2560, height: 1440, videoBitrate: 9000 },
};

const DEFAULT_QUALITY = '720p';
const DEFAULT_MAX_QUALITY = '1080p';
const DEFAULT_FPS = 30;
const DEFAULT_PRESET = 'veryfast';
const DEFAULT_AUDIO_BITRATE = 128;
const X264_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];

const qualityRank = (quality) => Object.keys(RTMP_QUALITY_PROFILES).indexOf(quality);

function positiveInt(value, fallback, max = Infinity) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

function pickQuality(value, fallback) {
    return RTMP_QUALITY_PROFILES[value] ? value : fallback;
}

/**
 * Resolve the output settings of an RTMP stream.
 * Server config (env) provides the defaults; an optional client-requested quality
 * is honoured only up to the configured maximum quality.
 */
function resolveRtmpVideoSettings(rtmpCfg = {}, requestedQuality = null) {
    const defaultQuality = pickQuality(rtmpCfg.videoQuality, DEFAULT_QUALITY);
    const maxQuality = pickQuality(rtmpCfg.maxVideoQuality, DEFAULT_MAX_QUALITY);
    const allowSelection = rtmpCfg.allowQualitySelection !== false;

    let quality = defaultQuality;
    let bitrateOverride = positiveInt(rtmpCfg.videoBitrate, 0, 50000);

    if (
        allowSelection &&
        RTMP_QUALITY_PROFILES[requestedQuality] &&
        qualityRank(requestedQuality) <= qualityRank(maxQuality)
    ) {
        if (requestedQuality !== defaultQuality) bitrateOverride = 0; // The override only applies to the default quality
        quality = requestedQuality;
    }

    const profile = RTMP_QUALITY_PROFILES[quality];
    const fps = positiveInt(rtmpCfg.videoFps, DEFAULT_FPS, 60);
    const videoBitrate = bitrateOverride || profile.videoBitrate;
    const preset = X264_PRESETS.includes(rtmpCfg.videoPreset) ? rtmpCfg.videoPreset : DEFAULT_PRESET;

    return {
        quality,
        width: profile.width,
        height: profile.height,
        fps,
        videoBitrate, // kbps
        audioBitrate: positiveInt(rtmpCfg.audioBitrate, DEFAULT_AUDIO_BITRATE, 512), // kbps
        preset,
    };
}

/**
 * Build the FFmpeg arguments for a live WebM stream (from the browser MediaRecorder) piped to RTMP.
 * - fps filter: screen capture produces a variable frame rate, force a constant one for the ingest.
 * - aresample async: keeps audio in sync when the browser delivers it with gaps.
 * - hasAudio=false: add a silent track, platforms like YouTube expect an audio stream.
 */
function buildLiveStreamArgs(settings, rtmpUrl, { hasAudio = true } = {}) {
    const { width, height, fps, videoBitrate, audioBitrate, preset } = settings;

    const args = ['-f', 'webm', '-re', '-i', 'pipe:0'];

    if (!hasAudio) {
        args.push('-re', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
        args.push('-map', '0:v:0', '-map', '1:a:0', '-shortest');
    }

    args.push(
        '-c:a',
        'aac',
        '-b:a',
        `${audioBitrate}k`,
        '-ar',
        '48000',
        '-ac',
        '2',
        '-af',
        'aresample=async=1:first_pts=0',
        '-c:v',
        'libx264',
        '-preset',
        preset,
        '-tune',
        'zerolatency',
        '-b:v',
        `${videoBitrate}k`,
        '-maxrate',
        `${videoBitrate}k`,
        '-bufsize',
        `${videoBitrate * 2}k`,
        '-g',
        String(fps * 2),
        '-keyint_min',
        String(fps * 2),
        '-sc_threshold',
        '0',
        '-pix_fmt',
        'yuv420p',
        '-filter:v',
        `fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        '-f',
        'flv',
        rtmpUrl
    );

    return args;
}

/**
 * Build the FFmpeg arguments for file/URL sources. `input` is 'pipe:0' or a local path.
 */
function buildFileStreamArgs(settings, input, rtmpUrl) {
    const { width, height, fps, videoBitrate, audioBitrate, preset } = settings;

    return [
        '-re',
        '-i',
        input,
        '-c:v',
        'libx264',
        '-preset',
        preset,
        '-b:v',
        `${videoBitrate}k`,
        '-maxrate',
        `${videoBitrate}k`,
        '-bufsize',
        `${videoBitrate * 2}k`,
        '-g',
        String(fps * 2),
        '-pix_fmt',
        'yuv420p',
        '-filter:v',
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        '-c:a',
        'aac',
        '-b:a',
        `${audioBitrate}k`,
        '-ar',
        '48000',
        '-f',
        'flv',
        rtmpUrl,
    ];
}

module.exports = {
    RTMP_QUALITY_PROFILES,
    resolveRtmpVideoSettings,
    buildLiveStreamArgs,
    buildFileStreamArgs,
};
