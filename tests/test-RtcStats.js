'use strict';

require('should');

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const { Server: SocketIoServer } = require('socket.io');

const RtcStats = require('../app/src/RtcStats');
const { resolveConfig, normalizeTags } = RtcStats;

const SECRET = 'b'.repeat(64);
const PROTOCOL = 'rtcstats#5.0';

function tokenParams(overrides = {}) {
    return {
        roomId: 'my room/../x',
        roomSessionId: 'room-session-1',
        peerUuid: 'peer-uuid-1',
        sessionId: 'socket-1',
        presenter: false,
        ...overrides,
    };
}

function waitFor(predicate, timeoutMs = 3000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const check = () => {
            const value = predicate();
            if (value) return resolve(value);
            if (Date.now() - start > timeoutMs) return reject(new Error('Timed out'));
            setTimeout(check, 20);
        };
        check();
    });
}

function listDumps(dir) {
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(RtcStats.DUMP_EXTENSION)) : [];
}

describe('RtcStats', () => {
    describe('config', () => {
        it('is disabled with built-in mode and safe defaults', () => {
            const cfg = resolveConfig({});
            cfg.enabled.should.be.false();
            cfg.mode.should.equal('builtin');
            cfg.getStatsInterval.should.equal(1000);
            cfg.excludeDeviceLabels.should.be.true();
            cfg.obfuscateIpAddresses.should.be.true();
            cfg.retentionDays.should.equal(7);
            cfg.maxDumpBytes.should.equal(50 * 1024 * 1024);
        });

        it('switches to external mode when a URL is set', () => {
            resolveConfig({ enabled: true, url: ' wss://rtcstats.example.com ' }).should.containDeep({
                mode: 'external',
                url: 'wss://rtcstats.example.com',
            });
        });

        it('sanitizes numeric values', () => {
            const cfg = resolveConfig({ getStatsInterval: 1, retentionDays: NaN, maxDumpSizeMB: 'x' });
            cfg.getStatsInterval.should.equal(250);
            cfg.retentionDays.should.equal(7);
            cfg.maxDumpBytes.should.equal(50 * 1024 * 1024);
            resolveConfig({ retentionDays: 0 }).retentionDays.should.equal(0);
        });

        it('keeps only valid, unique tags (max 16)', () => {
            normalizeTags(['env:prod', 'env:prod', 'bad tag', 'x'.repeat(33), 42]).should.deepEqual(['env:prod']);
            normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length.should.equal(16);
            normalizeTags('env:prod').should.deepEqual([]);
        });

        it('exposes only non-sensitive client settings', () => {
            const rtcStats = new RtcStats(
                { enabled: true, url: 'wss://x', jwtSecret: 'top-secret' },
                { secret: SECRET }
            );
            rtcStats.getClientConfig().should.deepEqual({
                enabled: true,
                getStatsInterval: 1000,
                excludeDeviceLabels: true,
                analyzeUrl: RtcStats.DEFAULT_ANALYZE_URL,
            });
            JSON.stringify(rtcStats.describe()).should.not.containEql('top-secret');
        });

        it('resolves the viewer "Analyze on ..." link (default, hidden, custom, unsafe)', () => {
            const analyzeUrl = (value) => resolveConfig({ analyzeUrl: value }).analyzeUrl;
            RtcStats.DEFAULT_ANALYZE_URL.should.startWith('https://rtcstats.com/');
            analyzeUrl(undefined).should.equal(RtcStats.DEFAULT_ANALYZE_URL);
            analyzeUrl(null).should.equal(RtcStats.DEFAULT_ANALYZE_URL);
            analyzeUrl('').should.equal('');
            analyzeUrl('   ').should.equal('');
            analyzeUrl(' https://analysis.example.com/upload?src=sfu ').should.equal(
                'https://analysis.example.com/upload?src=sfu'
            );
            for (const unsafe of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.com', 'not a url', 42]) {
                analyzeUrl(unsafe).should.equal('', String(unsafe));
            }
        });
    });

    describe('tokens', () => {
        it('rate-limits token requests per socket', () => {
            const rtcStats = new RtcStats({ enabled: true }, { secret: SECRET });
            rtcStats.canIssueToken(undefined, 1000).should.be.true();
            rtcStats.canIssueToken(1000, 2000).should.be.false();
            rtcStats.canIssueToken(1000, 7000).should.be.true();
        });

        it('issues single-use built-in tokens', () => {
            const rtcStats = new RtcStats({ enabled: true, tags: ['env:test'] }, { secret: SECRET });
            const { url, token } = rtcStats.createToken(tokenParams({ presenter: true }));
            (url === null).should.be.true();

            const claims = rtcStats.verifyToken(token);
            claims.rtcStats.should.deepEqual({
                user: 'peer-uuid-1',
                conference: 'my room/../x',
                session: 'socket-1',
                tags: ['env:test', 'role:presenter'],
            });
            claims.roomSessionId.should.equal('room-session-1');

            (rtcStats.verifyToken(token) === null).should.be.true();
        });

        it('rejects tokens with a wrong secret, scope or expiry', () => {
            const rtcStats = new RtcStats({ enabled: true }, { secret: SECRET });
            const other = new RtcStats({ enabled: true }, { secret: 'c'.repeat(64) });
            (rtcStats.verifyToken(other.createToken(tokenParams()).token) === null).should.be.true();

            const rtcStatsClaims = { conference: 'r', session: 's' };
            const wrongScope = jwt.sign({ scope: 'rec-upload', rtcStats: rtcStatsClaims }, SECRET, { jwtid: 'a' });
            (rtcStats.verifyToken(wrongScope) === null).should.be.true();

            const expired = jwt.sign({ scope: 'rtcstats', rtcStats: rtcStatsClaims }, SECRET, {
                jwtid: 'b',
                expiresIn: -10,
            });
            (rtcStats.verifyToken(expired) === null).should.be.true();
            (rtcStats.verifyToken('') === null).should.be.true();
        });

        it('signs external tokens with the shared rtcstats-server secret', () => {
            const rtcStats = new RtcStats(
                { enabled: true, url: 'wss://rtcstats.example.com', jwtSecret: 'shared-secret' },
                { secret: SECRET }
            );
            const { url, token } = rtcStats.createToken(tokenParams());
            url.should.equal('wss://rtcstats.example.com');
            const decoded = jwt.verify(token, 'shared-secret', { algorithms: ['HS256'] });
            decoded.rtcStats.should.containDeep({
                user: 'peer-uuid-1',
                conference: 'my room/../x',
                tags: ['role:guest'],
            });
        });

        it('sends no token to an external server without a secret', () => {
            const rtcStats = new RtcStats({ enabled: true, url: 'wss://rtcstats.example.com' }, { secret: SECRET });
            rtcStats.createToken(tokenParams()).should.containDeep({ url: 'wss://rtcstats.example.com', token: null });
        });

        it('returns the identity the browser records into the dump', () => {
            for (const url of ['', 'wss://rtcstats.example.com']) {
                const rtcStats = new RtcStats({ enabled: true, url, tags: ['env:test'] }, { secret: SECRET });
                rtcStats.createToken(tokenParams({ presenter: true })).identity.should.deepEqual({
                    user: 'peer-uuid-1',
                    conference: 'my room/../x',
                    session: 'socket-1',
                    tags: ['env:test', 'role:presenter'],
                    roomSessionId: 'room-session-1',
                });
            }
        });
    });

    describe('built-in collector', () => {
        let dir;
        let server;
        let io;
        let rtcStats;
        let baseUrl;

        async function start(cfg = {}) {
            rtcStats = new RtcStats(
                { enabled: true, dir, ...cfg },
                { secret: SECRET, baseDir: os.tmpdir(), trustProxy: false }
            );
            server = http.createServer((req, res) => res.end('ok'));
            io = new SocketIoServer(server, { transports: ['websocket'] });
            rtcStats.attach(server);
            await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
            baseUrl = `ws://127.0.0.1:${server.address().port}`;
        }

        function connect(token) {
            return new WebSocket(`${baseUrl}/rtcstats?rtcstats-token=${encodeURIComponent(token)}`, PROTOCOL);
        }

        beforeEach(() => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtcstats-test-'));
        });

        afterEach(async () => {
            if (rtcStats) await rtcStats.close();
            if (io) io.close();
            if (server) await new Promise((resolve) => server.close(() => resolve()));
            fs.rmSync(dir, { recursive: true, force: true });
            rtcStats = server = io = null;
        });

        it('writes an RTCStatsDump v3 file with obfuscated addresses', async () => {
            await start();
            const { token } = rtcStats.createToken(tokenParams());
            const ws = connect(token);
            await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject));
            ws.protocol.should.equal(PROTOCOL);

            ws.send(JSON.stringify(['create', null, { hardwareConcurrency: 8 }, Date.now()]));
            ws.send(
                JSON.stringify([
                    'onicecandidate',
                    '1',
                    { candidate: 'candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host generation 0' },
                    5,
                ])
            );
            ws.send('not json');
            ws.send(JSON.stringify({ not: 'an array' }));
            ws.close(1000);

            const [file] = await waitFor(() => {
                const files = listDumps(dir);
                return files.length && !rtcStats.activeFiles.size ? files : null;
            });
            file.should.match(/_my_room\.\.x_[0-9a-f-]+\.rtcstats\.txt$/);

            const lines = fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n');
            lines[0].should.equal('RTCStatsDump');
            const metadata = JSON.parse(lines[1]);
            metadata.should.containDeep({
                fileFormat: 3,
                clientProtocol: PROTOCOL,
                rtcStats: { user: 'peer-uuid-1', conference: 'my room/../x', session: 'socket-1' },
                roomSessionId: 'room-session-1',
            });
            metadata.url.should.equal('/rtcstats?rtcstats-token=obfuscated');
            metadata.remoteAddresses.should.deepEqual(['127.0.0.1']);

            lines.length.should.equal(5);
            JSON.parse(lines[2])[0].should.equal('create');
            const candidate = JSON.parse(lines[3])[2].candidate;
            candidate.should.containEql('192.168.1.x');
            candidate.should.not.containEql('192.168.1.20');
            JSON.parse(lines[4]).slice(0, 3).should.deepEqual(['close', null, 1000]);
        });

        it('rejects missing, invalid and replayed tokens', async () => {
            await start();
            const statusOf = (token) =>
                new Promise((resolve) => {
                    const ws = connect(token);
                    ws.once('unexpected-response', (req, res) => resolve(res.statusCode));
                    ws.once('open', () => {
                        ws.close();
                        resolve(101);
                    });
                    ws.once('error', () => {});
                });

            (await statusOf('')).should.equal(401);
            (await statusOf('garbage')).should.equal(401);

            const { token } = rtcStats.createToken(tokenParams());
            (await statusOf(token)).should.equal(101);
            (await statusOf(token)).should.equal(401);
        });

        it('closes the connection when the dump size limit is reached', async () => {
            await start({ maxDumpSizeMB: 1 });
            const ws = connect(rtcStats.createToken(tokenParams()).token);
            await new Promise((resolve) => ws.once('open', resolve));
            const closed = new Promise((resolve) => ws.once('close', resolve));
            const chunk = JSON.stringify([
                'getStats',
                '1',
                { report: { type: 'x', data: 'x'.repeat(256 * 1024) } },
                1000,
            ]);
            for (let i = 0; i < 6; i++) ws.send(chunk);
            (await closed).should.equal(1009);

            const [file] = await waitFor(() => (!rtcStats.activeFiles.size ? listDumps(dir) : null));
            fs.statSync(path.join(dir, file)).size.should.be.belowOrEqual(1024 * 1024 + 100);
        });

        it('keeps one active dump per participant session', async () => {
            await start();
            const first = connect(rtcStats.createToken(tokenParams()).token);
            await new Promise((resolve) => first.once('open', resolve));
            const firstClosed = new Promise((resolve) => first.once('close', resolve));

            const second = connect(rtcStats.createToken(tokenParams()).token);
            await new Promise((resolve) => second.once('open', resolve));
            (await firstClosed).should.equal(1000);
            rtcStats.connections.size.should.equal(1);
            second.close();
        });

        it('leaves other upgrade requests (Socket.IO) untouched', async () => {
            await start();
            const ws = new WebSocket(`${baseUrl}/socket.io/?EIO=4&transport=websocket`);
            const message = await new Promise((resolve, reject) => {
                ws.once('message', (data) => resolve(data.toString()));
                ws.once('error', reject);
            });
            message.should.startWith('0{');
            ws.close();
        });

        it('finalizes open dumps on shutdown', async () => {
            await start();
            const ws = connect(rtcStats.createToken(tokenParams()).token);
            ws.on('error', () => {});
            await new Promise((resolve) => ws.once('open', resolve));
            ws.send(JSON.stringify(['create', null, {}, Date.now()]));
            await waitFor(() => rtcStats.finishers.size === 1);
            await new Promise((resolve) => setTimeout(resolve, 50));

            const clientClosed = new Promise((resolve) => ws.once('close', resolve));
            await rtcStats.close();
            rtcStats.finishers.size.should.equal(0);
            (await clientClosed).should.equal(1001);

            // Open collector sockets must not keep server.close() (used by io.close()) waiting
            io.close();
            io = null;
            await new Promise((resolve) => server.close(resolve));
            server = null;

            const [file] = listDumps(dir);
            const lines = fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n');
            JSON.parse(lines[lines.length - 1])
                .slice(0, 3)
                .should.deepEqual(['close', null, 1001]);
        });

        it('removes dumps older than the retention period', async () => {
            await start({ retentionDays: 1 });
            const oldFile = path.join(dir, `old${RtcStats.DUMP_EXTENSION}`);
            const newFile = path.join(dir, `new${RtcStats.DUMP_EXTENSION}`);
            const otherFile = path.join(dir, 'keep.txt');
            [oldFile, newFile, otherFile].forEach((f) => fs.writeFileSync(f, 'x'));
            const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
            fs.utimesSync(oldFile, twoDaysAgo, twoDaysAgo);
            fs.utimesSync(otherFile, twoDaysAgo, twoDaysAgo);

            await rtcStats.sweepRetention();
            fs.existsSync(oldFile).should.be.false();
            fs.existsSync(newFile).should.be.true();
            fs.existsSync(otherFile).should.be.true();
        });
    });

    describe('viewer dump store', () => {
        let dir;
        let rtcStats;
        const writeDump = (name, metadata, mtime) => {
            const file = path.join(dir, name);
            fs.writeFileSync(file, `RTCStatsDump\n${JSON.stringify(metadata)}\n["create",null,{},1]\n`);
            if (mtime) fs.utimesSync(file, mtime, mtime);
            return file;
        };

        beforeEach(() => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtcstats-store-'));
            rtcStats = new RtcStats({ enabled: true, dir }, { secret: SECRET });
        });

        afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

        it('lists dumps newest first with their header metadata', async () => {
            const ext = RtcStats.DUMP_EXTENSION;
            writeDump(
                `old${ext}`,
                { startTime: 1, rtcStats: { conference: 'room-a', user: 'u1', session: 's1', tags: ['role:guest'] } },
                new Date(Date.now() - 60000)
            );
            writeDump(
                `new${ext}`,
                { startTime: 2, rtcStats: { conference: 'room-b' }, userAgent: 'UA' },
                new Date(Date.now() - 30000)
            );
            fs.writeFileSync(path.join(dir, `broken${ext}`), 'not a dump');
            fs.writeFileSync(path.join(dir, 'other.txt'), 'ignored');
            fs.mkdirSync(path.join(dir, `folder${ext}`));

            const dumps = await rtcStats.listDumps();
            dumps.map((d) => d.name).should.deepEqual([`broken${ext}`, `new${ext}`, `old${ext}`]);
            dumps[1].should.containDeep({ conference: 'room-b', userAgent: 'UA', tags: [], active: false });
            dumps[2].should.containDeep({ conference: 'room-a', user: 'u1', session: 's1', tags: ['role:guest'] });
            (dumps[0].conference === undefined).should.be.true();
            (await rtcStats.listDumps({ limit: 1 })).length.should.equal(1);
        });

        it('resolves only existing dump files inside the dump directory', async () => {
            const ext = RtcStats.DUMP_EXTENSION;
            const file = writeDump(`a${ext}`, {});
            fs.writeFileSync(path.join(path.dirname(dir), `outside${ext}`), 'x');
            fs.symlinkSync(file, path.join(dir, `link${ext}`));

            (await rtcStats.resolveDumpPath(`a${ext}`)).should.equal(file);
            for (const name of [
                `../outside${ext}`,
                `..${path.sep}outside${ext}`,
                `link${ext}`,
                `missing${ext}`,
                'a.txt',
                `a${ext}\0`,
                '',
                null,
                `${'x'.repeat(300)}${ext}`,
            ]) {
                ((await rtcStats.resolveDumpPath(name)) === null).should.be.true(String(name));
            }
            fs.rmSync(path.join(path.dirname(dir), `outside${ext}`));
        });

        it('deletes finished dumps but never active ones', async () => {
            const ext = RtcStats.DUMP_EXTENSION;
            const done = writeDump(`done${ext}`, {});
            const live = writeDump(`live${ext}`, {});
            rtcStats.activeFiles.add(live);

            (await rtcStats.deleteDump(`live${ext}`)).should.equal('active');
            fs.existsSync(live).should.be.true();
            (await rtcStats.deleteDump(`done${ext}`)).should.equal('deleted');
            fs.existsSync(done).should.be.false();
            (await rtcStats.deleteDump(`done${ext}`)).should.equal('not_found');
            (await rtcStats.deleteDump(`../done${ext}`)).should.equal('not_found');
            (await rtcStats.listDumps()).find((d) => d.name === `live${ext}`).active.should.be.true();
        });

        it('deletes all finished dumps and keeps the ones still recording', async () => {
            const ext = RtcStats.DUMP_EXTENSION;
            writeDump(`a${ext}`, {});
            writeDump(`b${ext}`, {});
            const live = writeDump(`live${ext}`, {});
            rtcStats.activeFiles.add(live);
            fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep');
            fs.mkdirSync(path.join(dir, `folder${ext}`));

            (await rtcStats.deleteAllDumps()).should.deepEqual({ deleted: 2, skipped: 1 });
            fs.readdirSync(dir)
                .sort()
                .should.deepEqual([`folder${ext}`, `live${ext}`, 'notes.txt']);
            (await rtcStats.deleteAllDumps()).should.deepEqual({ deleted: 0, skipped: 1 });

            const missing = new RtcStats({ enabled: true, dir: path.join(dir, 'missing') }, { secret: SECRET });
            (await missing.deleteAllDumps()).should.deepEqual({ deleted: 0, skipped: 0 });
        });
    });

    describe('shared dump folder (external rtcstats-server)', () => {
        const UUID = '3f2b8c1e-9d4a-4b7e-8f21-6c5d0e9a1b23';
        let dir;
        let rtcStats;

        // rtcstats-server dump: uuid name, no identity in the header, identity event after the buffered events
        const writeExternalDump = (name, { identity = true, padding = 0 } = {}) => {
            const lines = [
                'RTCStatsDump',
                JSON.stringify({ fileFormat: 3, startTime: 5, userAgent: 'UA', url: '/' }),
                JSON.stringify(['navigator.mediaDevices.enumerateDevices', null, 'x'.repeat(padding), 1]),
                JSON.stringify(['create', null, {}, 1]),
            ];
            if (identity) {
                lines.push(
                    JSON.stringify([
                        RtcStats.IDENTITY_EVENT,
                        null,
                        { conference: 'ext-room', user: 'u9', session: 's9', tags: ['role:presenter'] },
                        1,
                    ])
                );
            }
            const file = path.join(dir, name);
            fs.writeFileSync(file, lines.join('\n') + '\n');
            return file;
        };

        beforeEach(() => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtcstats-shared-'));
            rtcStats = new RtcStats({ enabled: true, url: 'wss://rtcstats.example.com', dir }, { secret: SECRET });
        });

        afterEach(async () => {
            await rtcStats.close();
            fs.rmSync(dir, { recursive: true, force: true });
        });

        it('recognizes both dump file names', () => {
            RtcStats.isDumpFileName(`a${RtcStats.DUMP_EXTENSION}`).should.be.true();
            RtcStats.isDumpFileName(UUID).should.be.true();
            RtcStats.isDumpFileName(UUID.toUpperCase()).should.be.true();
            for (const name of [`${UUID}.json`, `x${UUID}`, 'notes.txt', '..', '', null]) {
                RtcStats.isDumpFileName(name).should.be.false(String(name));
            }
            RtcStats.dumpDownloadName(UUID).should.equal(`${UUID}${RtcStats.DUMP_EXTENSION}`);
            RtcStats.dumpDownloadName(`a${RtcStats.DUMP_EXTENSION}`).should.equal(`a${RtcStats.DUMP_EXTENSION}`);
        });

        it('lists rtcstats-server dumps with the identity recorded by the browser', async () => {
            writeExternalDump(UUID, { padding: 20000 });
            writeExternalDump('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', { identity: false });
            fs.writeFileSync(path.join(dir, 'work.tmp'), 'ignored');

            const dumps = await rtcStats.listDumps();
            dumps.length.should.equal(2);
            dumps
                .find((d) => d.name === UUID)
                .should.containDeep({
                    conference: 'ext-room',
                    user: 'u9',
                    session: 's9',
                    tags: ['role:presenter'],
                    startTime: 5,
                    userAgent: 'UA',
                });
            dumps.find((d) => d.name !== UUID).should.containDeep({ startTime: 5, tags: [] });

            // Cached: the file is not read again while unchanged
            const read = rtcStats.readDumpMetadata.bind(rtcStats);
            let reads = 0;
            rtcStats.readDumpMetadata = (file) => (reads++, read(file));
            await rtcStats.listDumps();
            reads.should.equal(0);
        });

        it('resolves, deletes, bulk deletes and expires rtcstats-server dumps', async () => {
            const file = writeExternalDump(UUID);
            (await rtcStats.resolveDumpPath(UUID)).should.equal(file);
            (await rtcStats.deleteDump(UUID)).should.equal('deleted');

            writeExternalDump(UUID);
            writeExternalDump('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
            (await rtcStats.deleteAllDumps()).should.deepEqual({ deleted: 2, skipped: 0 });

            const old = writeExternalDump(UUID);
            const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
            fs.utimesSync(old, twoWeeksAgo, twoWeeksAgo);
            await rtcStats.sweepRetention();
            fs.existsSync(old).should.be.false();
        });

        it('creates the folder in external mode without starting the built-in collector', async () => {
            const nested = path.join(dir, 'nested');
            const external = new RtcStats({ enabled: true, url: 'wss://x', dir: nested }, { secret: SECRET });
            const server = http.createServer();
            external.attach(server);
            fs.existsSync(nested).should.be.true();
            server.listenerCount('upgrade').should.equal(0);
            (external.wss === null).should.be.true();
            await external.close();
        });
    });
});
