'use strict';

require('should');

const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

describe('test-FfmpegProcess', () => {
    function setup() {
        const child = new EventEmitter();
        child.stdin = new PassThrough();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = sinon.stub();

        const spawn = sinon.stub().returns(child);
        const { spawnFfmpeg } = proxyquire('../app/src/FfmpegProcess', {
            'node:child_process': { spawn },
        });

        return { child, spawn, spawnFfmpeg };
    }

    it('spawns FFmpeg with piped input and reports a successful exit', () => {
        const { child, spawn, spawnFfmpeg } = setup();
        const input = new PassThrough();
        const onStart = sinon.spy();
        const onEnd = sinon.spy();

        const process = spawnFfmpeg('/usr/bin/ffmpeg', ['-i', 'pipe:0', 'rtmp://example/live'], input, {
            onStart,
            onEnd,
        });
        child.emit('spawn');
        child.emit('close', 0, null);

        process.should.equal(child);
        spawn
            .calledOnceWithExactly('/usr/bin/ffmpeg', ['-i', 'pipe:0', 'rtmp://example/live'], {
                stdio: ['pipe', 'pipe', 'pipe'],
            })
            .should.be.true();
        onStart.calledOnce.should.be.true();
        onEnd.calledOnce.should.be.true();
    });

    it('reports stderr when FFmpeg exits unsuccessfully', () => {
        const { child, spawnFfmpeg } = setup();
        const onError = sinon.spy();
        const onEnd = sinon.spy();

        spawnFfmpeg('/usr/bin/ffmpeg', ['-version'], null, { onError, onEnd });
        child.stderr.write('invalid output');
        child.emit('close', 1, null);

        onError.calledOnce.should.be.true();
        onError.firstCall.args[0].message.should.equal('FFmpeg exited with code 1');
        onError.firstCall.args[2].should.equal('invalid output');
        onEnd.notCalled.should.be.true();
    });

    it('reports a spawn error once when the process closes', () => {
        const { child, spawnFfmpeg } = setup();
        const onError = sinon.spy();
        const error = new Error('spawn ENOENT');

        spawnFfmpeg('/missing/ffmpeg', [], null, { onError });
        child.emit('error', error);
        child.emit('close', -2, null);

        onError.calledOnceWithExactly(error, '', '').should.be.true();
    });
});
