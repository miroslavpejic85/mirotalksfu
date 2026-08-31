'use strict';

const { spawn } = require('node:child_process');

function formatCommand(command, args) {
    return [command, ...args].map((value) => JSON.stringify(value)).join(' ');
}

function spawnFfmpeg(ffmpegPath, args, inputStream, handlers = {}) {
    const ffmpegProcess = spawn(ffmpegPath, args, {
        stdio: [inputStream ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let processError = null;

    ffmpegProcess.stdout.on('data', (data) => stdout.push(data));
    ffmpegProcess.stderr.on('data', (data) => stderr.push(data));

    ffmpegProcess.on('spawn', () => handlers.onStart?.(formatCommand(ffmpegPath, args)));
    ffmpegProcess.on('error', (error) => {
        processError = error;
    });
    ffmpegProcess.on('close', (code, signal) => {
        const stdoutText = Buffer.concat(stdout).toString();
        const stderrText = Buffer.concat(stderr).toString();

        if (processError || code !== 0) {
            const error = processError || new Error(`FFmpeg exited with code ${code}${signal ? ` (${signal})` : ''}`);
            handlers.onError?.(error, stdoutText, stderrText);
            return;
        }

        handlers.onEnd?.();
    });

    if (inputStream) {
        inputStream.pipe(ffmpegProcess.stdin);
        ffmpegProcess.stdin.on('error', (error) => {
            if (error.code !== 'EPIPE') processError = error;
        });
    }

    return ffmpegProcess;
}

module.exports = { spawnFfmpeg };
