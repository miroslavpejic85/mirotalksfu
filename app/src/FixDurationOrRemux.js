'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { fixWebmDurationBuffer } = require('./FixWebmDurationBuffer');

const Logger = require('./Logger');
const log = new Logger('DurationOrRemux');

function hasFfmpeg() {
    const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return r.status === 0;
}

function remuxWithFfmpeg(inputPath, format = 'webm') {
    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const out = path.join(dir, `${base}.fixed.${format}`);

    const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        inputPath,
        '-c',
        'copy',
        ...(format === 'mp4' ? ['-movflags', '+faststart'] : []),
        out,
    ];
    const r = spawnSync('ffmpeg', args);
    if (r.status !== 0 || !fs.existsSync(out)) return null;

    fs.renameSync(out, inputPath);
    return inputPath;
}

function fixDurationOrRemux(inputPath, durationMs) {
    const ext = path.extname(inputPath).toLowerCase();
    const isWebm = ext === '.webm';
    const isMp4 = ext === '.mp4';

    if (hasFfmpeg() && (isWebm || isMp4)) {
        const ok = remuxWithFfmpeg(inputPath, isMp4 ? 'mp4' : 'webm');
        log.debug('ffmpeg detected remuxWithFfmpeg:', ok);
        if (ok) return true;
    }

    if (isWebm && Number.isFinite(durationMs)) {
        const inBuf = fs.readFileSync(inputPath);
        const outBuf = fixWebmDurationBuffer(inBuf, Number(durationMs));
        if (outBuf && outBuf.length) {
            fs.writeFileSync(inputPath, outBuf);
            log.debug('No ffmpeg detected fixWebmDurationBuffer - true');
            return true;
        }
    }
    log.debug('No ffmpeg detected fixWebmDurationBuffer - false');
    return false;
}

module.exports = { fixDurationOrRemux };
