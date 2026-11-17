'use strict';

// RTCStats WebRTC observability (https://github.com/rtcstats/rtcstats).
// Issues per-participant tokens and, unless an external rtcstats-server URL is configured,
// runs a built-in collector that writes RTCStatsDump (file format v3) files to disk.

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const sanitizeFilename = require('sanitize-filename');
const { decompressMethod } = require('@rtcstats/rtcstats-shared');
const { obfuscateAddress, obfuscateIpOrAddress } = require('@rtcstats/rtcstats-shared/address-obfuscator.js');
const Logger = require('./Logger');

const log = new Logger('RtcStats');

const BUILTIN_PATH = '/rtcstats';
// .txt keeps the dumps selectable in the rtcstats dump-importer file picker (.json/.txt/.gz/.jsonl)
const DUMP_EXTENSION = '.rtcstats.txt';
// rtcstats-server (external mode) names its finished dumps by uuid, without extension
const EXTERNAL_DUMP_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Custom rtcstats event the browser records with the room/participant identity (stored by both collectors)
const IDENTITY_EVENT = ':mirotalk';
const FILE_FORMAT = 3;
const TOKEN_SCOPE = 'rtcstats';
const TOKEN_EXPIRES_IN = 600; // seconds, only checked when the WebSocket connects
const TOKEN_MIN_INTERVAL_MS = 5000;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_CONNECTIONS = 2000;
const MAX_USED_TOKENS = 1000;
const RETENTION_SWEEP_MS = 60 * 60 * 1000;
const MAX_LISTED_DUMPS = 1000;
const HEADER_READ_BYTES = 16 * 1024;
const IDENTITY_SCAN_BYTES = 256 * 1024;

function isDumpFileName(name) {
    return typeof name === 'string' && (name.endsWith(DUMP_EXTENSION) || EXTERNAL_DUMP_NAME.test(name));
}

// Downloads always get the extension so they open directly in the viewer and the dump-importer.
function dumpDownloadName(name) {
    return name.endsWith(DUMP_EXTENSION) ? name : `${name}${DUMP_EXTENSION}`;
}
const TAG_PATTERN = /^[a-zA-Z0-9_.:-]{1,32}$/;
const MAX_TAGS = 16;
const JWT_VERIFY_OPTIONS = { algorithms: ['HS256'] };

// Same rules as rtcstats-server, which silently drops invalid tags.
function normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    return [...new Set(tags.filter((tag) => typeof tag === 'string' && TAG_PATTERN.test(tag)))].slice(0, MAX_TAGS);
}

function toPositiveInt(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolveConfig(cfg = {}) {
    const url = typeof cfg.url === 'string' ? cfg.url.trim() : '';
    const retentionDays = parseInt(cfg.retentionDays, 10);
    return {
        enabled: cfg.enabled === true,
        mode: url ? 'external' : 'builtin',
        url,
        jwtSecret: typeof cfg.jwtSecret === 'string' ? cfg.jwtSecret : '',
        getStatsInterval: Math.min(Math.max(toPositiveInt(cfg.getStatsInterval, 1000), 250), 60000),
        excludeDeviceLabels: cfg.excludeDeviceLabels !== false,
        tags: normalizeTags(cfg.tags),
        dir: typeof cfg.dir === 'string' && cfg.dir.trim() ? cfg.dir.trim() : '../rtcstats',
        maxDumpBytes: toPositiveInt(cfg.maxDumpSizeMB, 50) * 1024 * 1024,
        retentionDays: Number.isFinite(retentionDays) && retentionDays >= 0 ? retentionDays : 7,
        obfuscateIpAddresses: cfg.obfuscateIpAddresses !== false,
    };
}

function rejectUpgrade(socket, status, message) {
    if (socket.writable) {
        socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
    socket.destroy();
}

function fileTimestamp(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, '-');
}

class RtcStats {
    constructor(cfg, { secret, baseDir = __dirname, trustProxy = false } = {}) {
        this.config = resolveConfig(cfg || {});
        this.secret = secret;
        this.trustProxy = trustProxy;
        this.dir = path.resolve(baseDir, this.config.dir);
        this.wss = null;
        this.sweepTimer = null;
        this.connections = new Map(); // rtcStats session -> ws
        this.finishers = new Map(); // ws -> finish(code) for open dumps
        this.activeFiles = new Set();
        this.usedTokens = new Map(); // jti -> expiry (ms)
        this.metadataCache = new Map(); // dump name -> { key: size:mtime, metadata }
    }

    get enabled() {
        return this.config.enabled;
    }

    get builtinEnabled() {
        return this.config.enabled && this.config.mode === 'builtin';
    }

    // Public, non-sensitive settings the browser needs before wrapping RTCPeerConnection.
    getClientConfig() {
        return {
            enabled: this.config.enabled,
            getStatsInterval: this.config.getStatsInterval,
            excludeDeviceLabels: this.config.excludeDeviceLabels,
        };
    }

    describe() {
        return {
            mode: this.config.mode,
            url: this.config.mode === 'external' ? this.config.url : BUILTIN_PATH,
            dir: this.dir,
            getStatsInterval: this.config.getStatsInterval,
            excludeDeviceLabels: this.config.excludeDeviceLabels,
            tags: this.config.tags,
        };
    }

    // Rate-limits token requests per signaling socket.
    canIssueToken(lastIssuedAt, now = Date.now()) {
        return !lastIssuedAt || now - lastIssuedAt >= TOKEN_MIN_INTERVAL_MS;
    }

    // Returns { url, token, identity }. url is null for the built-in collector (same origin, BUILTIN_PATH).
    // identity is recorded by the browser into the dump, so dumps of both collectors are self-describing.
    createToken({ roomId, roomSessionId, peerUuid, sessionId, presenter = false }) {
        const rtcStats = {
            user: peerUuid ? String(peerUuid) : undefined,
            conference: String(roomId),
            session: String(sessionId),
            tags: normalizeTags([...this.config.tags, presenter ? 'role:presenter' : 'role:guest']),
        };
        const identity = { ...rtcStats, roomSessionId: roomSessionId || undefined };

        if (this.config.mode === 'external') {
            const token = this.config.jwtSecret
                ? jwt.sign({ rtcStats }, this.config.jwtSecret, { expiresIn: TOKEN_EXPIRES_IN })
                : null;
            return { url: this.config.url, token, identity };
        }

        const token = jwt.sign(
            { scope: TOKEN_SCOPE, rtcStats, roomSessionId: roomSessionId || undefined },
            this.secret,
            { expiresIn: TOKEN_EXPIRES_IN, jwtid: uuidv4() }
        );
        return { url: null, token, identity };
    }

    // Verifies a built-in collector token. Tokens are single-use to prevent replays.
    verifyToken(token) {
        if (!token || typeof token !== 'string' || !this.secret) return null;
        let decoded;
        try {
            decoded = jwt.verify(token, this.secret, JWT_VERIFY_OPTIONS);
        } catch (err) {
            log.debug('Invalid token', err.message);
            return null;
        }
        if (
            !decoded ||
            decoded.scope !== TOKEN_SCOPE ||
            !decoded.jti ||
            !decoded.rtcStats ||
            typeof decoded.rtcStats.conference !== 'string' ||
            typeof decoded.rtcStats.session !== 'string'
        ) {
            return null;
        }
        if (this.usedTokens.has(decoded.jti)) {
            log.debug('Token already used', { jti: decoded.jti });
            return null;
        }
        if (this.usedTokens.size >= MAX_USED_TOKENS) this.pruneUsedTokens();
        this.usedTokens.set(decoded.jti, decoded.exp * 1000);
        return decoded;
    }

    pruneUsedTokens(now = Date.now()) {
        for (const [jti, expiresAt] of this.usedTokens) {
            if (expiresAt <= now) this.usedTokens.delete(jti);
        }
    }

    attach(server) {
        if (!this.enabled) return;
        if (this.builtinEnabled && !this.secret)
            throw new Error('RtcStats built-in collector requires a signing secret');

        // Both modes share the dump dir: the external rtcstats-server can write its dumps here (see
        // docker-compose-rtcstats.yml) so the viewer, retention and Delete all work the same way.
        try {
            fs.mkdirSync(this.dir, { recursive: true });
        } catch (err) {
            log.warn('Unable to create the dump directory', { dir: this.dir, error: err.message });
        }

        if (this.config.retentionDays > 0) {
            this.sweepRetention();
            this.sweepTimer = setInterval(() => this.sweepRetention(), RETENTION_SWEEP_MS);
            this.sweepTimer.unref();
        }

        if (!this.builtinEnabled) {
            log.info('External collector enabled', { url: this.config.url, dir: this.dir });
            return;
        }

        this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
        server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));

        log.info('Built-in collector enabled', { path: BUILTIN_PATH, dir: this.dir });
    }

    // Returns true when the upgrade request was for the collector (handled or rejected here).
    handleUpgrade(req, socket, head) {
        let url;
        try {
            url = new URL(req.url, 'http://localhost');
        } catch (err) {
            return false;
        }
        if (url.pathname !== BUILTIN_PATH) return false;

        const claims = this.verifyToken(url.searchParams.get('rtcstats-token'));
        if (!claims) {
            rejectUpgrade(socket, 401, 'Unauthorized');
            return true;
        }
        if (this.connections.size >= MAX_CONNECTIONS) {
            log.warn('Max connections reached', { max: MAX_CONNECTIONS });
            rejectUpgrade(socket, 503, 'Service Unavailable');
            return true;
        }

        this.wss.handleUpgrade(req, socket, head, (ws) => this.handleConnection(ws, req, claims));
        return true;
    }

    getRemoteAddresses(req) {
        const forwardedFor = req.headers['x-forwarded-for'];
        const addresses =
            this.trustProxy && typeof forwardedFor === 'string' && forwardedFor.trim()
                ? forwardedFor.split(',').map((ip) => ip.trim())
                : [req.socket?.remoteAddress || ''];
        return addresses
            .filter(Boolean)
            .map((ip) => ip.replace(/^::ffff:/, ''))
            .map((ip) => (this.config.obfuscateIpAddresses ? obfuscateIpOrAddress(ip) : ip));
    }

    buildMetadata(req, claims, clientId, startTime) {
        const requestUrl = new URL(req.url, 'http://localhost');
        requestUrl.searchParams.set('rtcstats-token', 'obfuscated');
        return {
            fileFormat: FILE_FORMAT,
            clientId,
            url: requestUrl.pathname + requestUrl.search,
            origin: req.headers.origin,
            userAgent: req.headers['user-agent'],
            startTime,
            remoteAddresses: this.getRemoteAddresses(req),
            clientProtocol: req.headers['sec-websocket-protocol'],
            rtcStats: claims.rtcStats,
            roomSessionId: claims.roomSessionId,
        };
    }

    // Serializes one client event, or returns null if it is malformed.
    formatEvent(data, isBinary) {
        if (isBinary) return null;
        try {
            const event = JSON.parse(data.toString('utf8'));
            if (!Array.isArray(event) || event.length < 2) return null;
            if (this.config.obfuscateIpAddresses) {
                obfuscateAddress(decompressMethod(event[0]), event);
            }
            return JSON.stringify(event) + '\n';
        } catch (err) {
            return null;
        }
    }

    handleConnection(ws, req, claims) {
        const startTime = Date.now();
        const clientId = uuidv4();
        const { session, conference } = claims.rtcStats;
        const roomPart = sanitizeFilename(conference).replace(/\s+/g, '_').slice(0, 64) || 'room';
        const filePath = path.join(
            this.dir,
            `${fileTimestamp(new Date(startTime))}_${roomPart}_${clientId}${DUMP_EXTENSION}`
        );

        // One active dump per participant session: a newer connection replaces the old one.
        const previous = this.connections.get(session);
        if (previous) previous.close(1000, 'Replaced');
        this.connections.set(session, ws);
        this.activeFiles.add(filePath);

        const stream = fs.createWriteStream(filePath, { flags: 'wx', mode: 0o640 });
        let bytes = 0;
        let messages = 0;
        let lastMessage = startTime;
        let closed = false;

        stream.on('error', (err) => {
            log.error('Dump write error', { file: filePath, error: err.message });
            ws.close(1011, 'Storage error');
        });

        stream.on('close', () => {
            this.activeFiles.delete(filePath);
            if (messages === 0) {
                fs.promises.unlink(filePath).catch(() => {});
                return;
            }
            log.debug('Dump finished', {
                clientId,
                conference,
                messages,
                bytes,
                durationMs: Date.now() - startTime,
                file: path.basename(filePath),
            });
        });

        const metadata = this.buildMetadata(req, claims, clientId, startTime);
        const header = 'RTCStatsDump\n' + JSON.stringify(metadata) + '\n';
        bytes += Buffer.byteLength(header);
        stream.write(header);

        log.debug('Dump started', { clientId, conference, session, file: path.basename(filePath) });

        ws.on('message', (data, isBinary) => {
            if (closed) return;
            const line = this.formatEvent(data, isBinary);
            if (!line) return;
            const size = Buffer.byteLength(line);
            if (bytes + size > this.config.maxDumpBytes) {
                log.warn('Dump size limit reached', { clientId, conference, maxBytes: this.config.maxDumpBytes });
                closed = true;
                ws.close(1009, 'Dump size limit reached');
                return;
            }
            bytes += size;
            messages++;
            lastMessage = Date.now();
            stream.write(line);
        });

        ws.on('error', (err) => log.debug('WebSocket error', { clientId, error: err.message }));

        // Appends the final close event and ends the file; resolves once the dump is flushed.
        const flushed = new Promise((resolve) => stream.once('close', resolve));
        const finish = (code) => {
            closed = true;
            if (this.connections.get(session) === ws) this.connections.delete(session);
            if (!stream.destroyed && !stream.writableEnded) {
                stream.end(JSON.stringify(['close', null, code, Date.now() - lastMessage]) + '\n');
            }
            return flushed;
        };
        this.finishers.set(ws, finish);

        ws.on('close', (code) => {
            this.finishers.delete(ws);
            finish(code);
        });
    }

    // Dumps of both collectors, newest first, with their metadata (cached: finished dumps never change).
    async listDumps({ limit = MAX_LISTED_DUMPS } = {}) {
        let names;
        try {
            names = await fs.promises.readdir(this.dir);
        } catch (err) {
            return [];
        }
        const dumps = [];
        for (const name of names) {
            if (!isDumpFileName(name)) continue;
            const filePath = path.join(this.dir, name);
            try {
                const stat = await fs.promises.lstat(filePath);
                if (!stat.isFile()) continue;
                dumps.push({ name, size: stat.size, modified: stat.mtimeMs, active: this.activeFiles.has(filePath) });
            } catch (err) {
                // Removed meanwhile (retention sweep or delete)
            }
        }
        dumps.sort((a, b) => b.modified - a.modified);
        const listed = dumps.slice(0, limit);
        const cache = new Map();
        await Promise.all(
            listed.map(async (dump) => {
                const key = `${dump.size}:${dump.modified}`;
                const cached = this.metadataCache.get(dump.name);
                const metadata =
                    cached?.key === key ? cached.metadata : await this.readDumpMetadata(path.join(this.dir, dump.name));
                if (!dump.active) cache.set(dump.name, { key, metadata });
                Object.assign(dump, metadata);
            })
        );
        this.metadataCache = cache;
        return listed;
    }

    async readDumpMetadata(filePath) {
        let handle;
        try {
            handle = await fs.promises.open(filePath, 'r');
            const { buffer, bytesRead } = await handle.read(Buffer.alloc(HEADER_READ_BYTES), 0, HEADER_READ_BYTES, 0);
            const [magic, metadataLine] = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
            if (magic !== 'RTCStatsDump') return {};
            const metadata = JSON.parse(metadataLine);
            // Built-in dumps carry the identity in the header, rtcstats-server dumps in the identity event
            const identity = metadata.rtcStats || (await this.readIdentityEvent(handle)) || {};
            return {
                startTime: metadata.startTime,
                conference: identity.conference,
                user: identity.user,
                session: identity.session,
                tags: Array.isArray(identity.tags) ? identity.tags : [],
                userAgent: metadata.userAgent,
            };
        } catch (err) {
            return {};
        } finally {
            if (handle) await handle.close();
        }
    }

    // The identity event is recorded right after the browser connects, near the start of the dump.
    async readIdentityEvent(handle) {
        const { buffer, bytesRead } = await handle.read(Buffer.alloc(IDENTITY_SCAN_BYTES), 0, IDENTITY_SCAN_BYTES, 0);
        const prefix = `["${IDENTITY_EVENT}",`;
        for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
            if (!line.startsWith(prefix)) continue;
            try {
                const value = JSON.parse(line)[2];
                return value && typeof value === 'object' ? value : null;
            } catch (err) {
                return null;
            }
        }
        return null;
    }

    // Returns the absolute path of an existing dump file, or null. Never resolves outside the dump dir.
    async resolveDumpPath(name) {
        if (
            typeof name !== 'string' ||
            name.length > 255 ||
            name.includes('\0') ||
            !isDumpFileName(name) ||
            name !== path.basename(name)
        ) {
            return null;
        }
        const filePath = path.join(this.dir, name);
        if (path.dirname(filePath) !== this.dir) return null;
        try {
            const stat = await fs.promises.lstat(filePath);
            return stat.isFile() ? filePath : null;
        } catch (err) {
            return null;
        }
    }

    // Returns 'deleted', 'not_found' or 'active' (still being written).
    async deleteDump(name) {
        const filePath = await this.resolveDumpPath(name);
        if (!filePath) return 'not_found';
        if (this.activeFiles.has(filePath)) return 'active';
        try {
            await fs.promises.unlink(filePath);
            return 'deleted';
        } catch (err) {
            return 'not_found';
        }
    }

    // Deletes every finished dump; dumps still being recorded are kept. Returns { deleted, skipped }.
    async deleteAllDumps() {
        let names;
        try {
            names = await fs.promises.readdir(this.dir);
        } catch (err) {
            return { deleted: 0, skipped: 0 };
        }
        let deleted = 0;
        let skipped = 0;
        for (const name of names) {
            if (!isDumpFileName(name)) continue;
            const filePath = path.join(this.dir, name);
            if (this.activeFiles.has(filePath)) {
                skipped++;
                continue;
            }
            try {
                const stat = await fs.promises.lstat(filePath);
                if (!stat.isFile()) continue;
                await fs.promises.unlink(filePath);
                deleted++;
            } catch (err) {
                // Removed meanwhile (retention sweep or single delete)
            }
        }
        return { deleted, skipped };
    }

    async sweepRetention(now = Date.now()) {
        this.pruneUsedTokens(now);
        if (!(this.config.retentionDays > 0)) return;
        const maxAgeMs = this.config.retentionDays * 24 * 60 * 60 * 1000;
        let files;
        try {
            files = await fs.promises.readdir(this.dir);
        } catch (err) {
            log.warn('Retention sweep failed', err.message);
            return;
        }
        for (const file of files) {
            if (!isDumpFileName(file)) continue;
            const filePath = path.join(this.dir, file);
            if (this.activeFiles.has(filePath)) continue;
            try {
                const { mtimeMs } = await fs.promises.stat(filePath);
                if (now - mtimeMs > maxAgeMs) {
                    await fs.promises.unlink(filePath);
                    log.debug('Expired dump removed', { file });
                }
            } catch (err) {
                log.debug('Retention check failed', { file, error: err.message });
            }
        }
    }

    // Finalizes all open dumps, then drops the sockets so server.close() is not held open by them.
    async close(timeoutMs = 2000) {
        if (this.sweepTimer) clearInterval(this.sweepTimer);
        this.sweepTimer = null;
        const sockets = [...this.finishers.keys()];
        const pending = [];
        for (const [ws, finish] of this.finishers) {
            pending.push(finish(1001));
            ws.close(1001, 'Server shutdown');
        }
        this.finishers.clear();
        this.connections.clear();
        let timer;
        await Promise.race([
            Promise.all(pending),
            new Promise((resolve) => {
                timer = setTimeout(resolve, timeoutMs);
            }),
        ]);
        clearTimeout(timer);
        // Give the close frames a moment to flush before cutting the remaining sockets.
        await new Promise((resolve) => setImmediate(resolve));
        sockets.forEach((ws) => ws.terminate());
        if (this.wss) this.wss.close();
    }
}

module.exports = RtcStats;
module.exports.resolveConfig = resolveConfig;
module.exports.normalizeTags = normalizeTags;
module.exports.BUILTIN_PATH = BUILTIN_PATH;
module.exports.DUMP_EXTENSION = DUMP_EXTENSION;
module.exports.IDENTITY_EVENT = IDENTITY_EVENT;
module.exports.isDumpFileName = isDumpFileName;
module.exports.dumpDownloadName = dumpDownloadName;
