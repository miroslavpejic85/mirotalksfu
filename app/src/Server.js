'use strict';

/*
███████ ███████ ██████  ██    ██ ███████ ██████  
██      ██      ██   ██ ██    ██ ██      ██   ██ 
███████ █████   ██████  ██    ██ █████   ██████  
     ██ ██      ██   ██  ██  ██  ██      ██   ██ 
███████ ███████ ██   ██   ████   ███████ ██   ██                                           

dependencies: {
    @sentry/node            : https://www.npmjs.com/package/@sentry/node
    @sentry/integrations    : https://www.npmjs.com/package/@sentry/integrations
    axios                   : https://www.npmjs.com/package/axios
    body-parser             : https://www.npmjs.com/package/body-parser
    compression             : https://www.npmjs.com/package/compression
    colors                  : https://www.npmjs.com/package/colors
    cors                    : https://www.npmjs.com/package/cors
    crypto-js               : https://www.npmjs.com/package/crypto-js
    express                 : https://www.npmjs.com/package/express
    httpolyglot             : https://www.npmjs.com/package/httpolyglot
    mediasoup               : https://www.npmjs.com/package/mediasoup
    mediasoup-client        : https://www.npmjs.com/package/mediasoup-client
    ngrok                   : https://www.npmjs.com/package/ngrok
    openai                  : https://www.npmjs.com/package/openai
    qs                      : https://www.npmjs.com/package/qs
    socket.io               : https://www.npmjs.com/package/socket.io
    swagger-ui-express      : https://www.npmjs.com/package/swagger-ui-express
    uuid                    : https://www.npmjs.com/package/uuid
    xss                     : https://www.npmjs.com/package/xss
    yamljs                  : https://www.npmjs.com/package/yamljs
}
*/

/**
 * MiroTalk SFU - Server component
 *
 * @link    GitHub: https://github.com/miroslavpejic85/mirotalksfu
 * @link    Official Live demo: https://sfu.mirotalk.com
 * @license For open source use: AGPLv3
 * @license For commercial or closed source, contact us at license.mirotalk@gmail.com or purchase directly via CodeCanyon
 * @license CodeCanyon: https://codecanyon.net/item/mirotalk-sfu-webrtc-realtime-video-conferences/40769970
 * @author  Miroslav Pejic - miroslav.pejic.85@gmail.com
 * @version 1.3.4
 *
 */

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const https = require('httpolyglot');
const mediasoup = require('mediasoup');
const mediasoupClient = require('mediasoup-client');
const http = require('http');
const path = require('path');
const axios = require('axios');
const ngrok = require('ngrok');
const fs = require('fs');
const config = require('./config');
const checkXSS = require('./XSS.js');
const Host = require('./Host');
const Room = require('./Room');
const Peer = require('./Peer');
const ServerApi = require('./ServerApi');
const Logger = require('./Logger');
const log = new Logger('Server');
const yamlJS = require('yamljs');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = yamlJS.load(path.join(__dirname + '/../api/swagger.yaml'));
const Sentry = require('@sentry/node');
const { CaptureConsole } = require('@sentry/integrations');

// Slack API
const CryptoJS = require('crypto-js');
const qS = require('qs');
const slackEnabled = config.slack.enabled;
const slackSigningSecret = config.slack.signingSecret;
const bodyParser = require('body-parser');

const app = express();

const options = {
    cert: fs.readFileSync(path.join(__dirname, config.server.ssl.cert), 'utf-8'),
    key: fs.readFileSync(path.join(__dirname, config.server.ssl.key), 'utf-8'),
};

const httpsServer = https.createServer(options, app);
const io = require('socket.io')(httpsServer, {
    maxHttpBufferSize: 1e7,
    transports: ['websocket'],
});
const host = 'https://' + 'localhost' + ':' + config.server.listen.port; // config.server.listen.ip

const hostCfg = {
    protected: config.host.protected,
    user_auth: config.host.user_auth,
    users: config.host.users,
    authenticated: !config.host.protected,
};

const apiBasePath = '/api/v1'; // api endpoint path
const api_docs = host + apiBasePath + '/docs'; // api docs

// Sentry monitoring
const sentryEnabled = config.sentry.enabled;
const sentryDSN = config.sentry.DSN;
const sentryTracesSampleRate = config.sentry.tracesSampleRate;
if (sentryEnabled) {
    Sentry.init({
        dsn: sentryDSN,
        integrations: [
            new CaptureConsole({
                // ['log', 'info', 'warn', 'error', 'debug', 'assert']
                levels: ['error'],
            }),
        ],
        tracesSampleRate: sentryTracesSampleRate,
    });
    /*
    log.log('test-log');
    log.info('test-info');
    log.warn('test-warning');
    log.error('test-error');
    log.debug('test-debug');
    */
}

// Stats
const defaultStats = {
    enabled: true,
    src: 'https://stats.mirotalk.com/script.js',
    id: '41d26670-f275-45bb-af82-3ce91fe57756',
};

// OpenAI/ChatGPT
let chatGPT;
if (config.chatGPT.enabled) {
    if (config.chatGPT.apiKey) {
        const { OpenAI } = require('openai');
        const configuration = {
            basePath: config.chatGPT.basePath,
            apiKey: config.chatGPT.apiKey,
        };
        chatGPT = new OpenAI(configuration);
    } else {
        log.warning('ChatGPT seems enabled, but you missing the apiKey!');
    }
}

// directory
const dir = {
    public: path.join(__dirname, '../../', 'public'),
};

// html views
const views = {
    about: path.join(__dirname, '../../', 'public/views/about.html'),
    landing: path.join(__dirname, '../../', 'public/views/landing.html'),
    login: path.join(__dirname, '../../', 'public/views/login.html'),
    newRoom: path.join(__dirname, '../../', 'public/views/newroom.html'),
    notFound: path.join(__dirname, '../../', 'public/views/404.html'),
    permission: path.join(__dirname, '../../', 'public/views/permission.html'),
    privacy: path.join(__dirname, '../../', 'public/views/privacy.html'),
    room: path.join(__dirname, '../../', 'public/views/Room.html'),
};

const authHost = new Host(); // Authenticated IP by Login

let roomList = new Map(); // All Rooms

let presenters = {}; // collect presenters grp by roomId

let announcedIP = config.mediasoup.webRtcTransport.listenIps[0].announcedIp; // AnnouncedIP (server public IPv4)

// All mediasoup workers
let workers = [];
let nextMediasoupWorkerIdx = 0;

// Autodetect announcedIP (https://www.ipify.org)
if (!announcedIP) {
    http.get(
        {
            host: 'api.ipify.org',
            port: 80,
            path: '/',
        },
        (resp) => {
            resp.on('data', (ip) => {
                announcedIP = ip.toString();
                config.mediasoup.webRtcTransport.listenIps[0].announcedIp = announcedIP;
                startServer();
            });
        },
    );
} else {
    startServer();
}

function startServer() {
    // Start the app
    app.use(cors());
    app.use(compression());
    app.use(express.json());
    app.use(express.static(dir.public));
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(apiBasePath + '/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument)); // api docs

    // Logs requests
    app.use((req, res, next) => {
        log.debug('New request:', {
            // headers: req.headers,
            body: req.body,
            method: req.method,
            path: req.originalUrl,
        });
        next();
    });

    // POST start from here...
    app.post('*', function (next) {
        next();
    });

    // GET start from here...
    app.get('*', function (next) {
        next();
    });

    // Remove trailing slashes in url handle bad requests
    app.use((err, req, res, next) => {
        if (err instanceof SyntaxError || err.status === 400 || 'body' in err) {
            log.error('Request Error', {
                header: req.headers,
                body: req.body,
                error: err.message,
            });
            return res.status(400).send({ status: 404, message: err.message }); // Bad request
        }
        if (req.path.substr(-1) === '/' && req.path.length > 1) {
            let query = req.url.slice(req.path.length);
            res.redirect(301, req.path.slice(0, -1) + query);
        } else {
            next();
        }
    });

    // main page
    app.get(['/'], (req, res) => {
        if (hostCfg.protected) {
            hostCfg.authenticated = false;
            res.sendFile(views.login);
        } else {
            res.sendFile(views.landing);
        }
    });

    // set new room name and join
    app.get(['/newroom'], (req, res) => {
        if (hostCfg.protected) {
            let ip = getIP(req);
            if (allowedIP(ip)) {
                res.sendFile(views.newRoom);
            } else {
                hostCfg.authenticated = false;
                res.sendFile(views.login);
            }
        } else {
            res.sendFile(views.newRoom);
        }
    });

    // no room name specified to join || direct join
    app.get('/join/', (req, res) => {
        if (Object.keys(req.query).length > 0) {
            log.debug('Direct Join', req.query);

            // http://localhost:3010/join?room=test&roomPassword=0&name=mirotalksfu&audio=1&video=1&screen=0&hide=0&notify=1
            // http://localhost:3010/join?room=test&roomPassword=0&name=mirotalksfu&audio=1&video=1&screen=0&hide=0&notify=0&username=username&password=password

            const { room, roomPassword, name, audio, video, screen, hide, notify, username, password, isPresenter } =
                checkXSS(req.query);

            const isPeerValid = isAuthPeer(username, password);

            if (hostCfg.protected && isPeerValid && !hostCfg.authenticated) {
                const ip = getIP(req);
                hostCfg.authenticated = true;
                authHost.setAuthorizedIP(ip, true);
                log.debug('Direct Join user auth as host done', {
                    ip: ip,
                    username: username,
                    password: password,
                });
            }

            if (room && (hostCfg.authenticated || isPeerValid)) {
                return res.sendFile(views.room);
            } else {
                return res.sendFile(views.login);
            }
        }
        if (hostCfg.protected) {
            return res.sendFile(views.login);
        }
        res.redirect('/');
    });

    // join room by id
    app.get('/join/:roomId', (req, res) => {
        if (hostCfg.authenticated) {
            res.sendFile(views.room);
        } else {
            if (hostCfg.protected) {
                return res.sendFile(views.login);
            }
            res.redirect('/');
        }
    });

    // not specified correctly the room id
    app.get('/join/*', (req, res) => {
        res.redirect('/');
    });

    // if not allow video/audio
    app.get(['/permission'], (req, res) => {
        res.sendFile(views.permission);
    });

    // privacy policy
    app.get(['/privacy'], (req, res) => {
        res.sendFile(views.privacy);
    });

    // mirotalk about
    app.get(['/about'], (req, res) => {
        res.sendFile(views.about);
    });

    // Get stats endpoint
    app.get(['/stats'], (req, res) => {
        const stats = config.stats ? config.stats : defaultStats;
        // log.debug('Send stats', stats);
        res.send(stats);
    });

    // handle login if user_auth enabled
    app.get(['/login'], (req, res) => {
        res.sendFile(views.login);
    });

    // handle logged on host protected
    app.get(['/logged'], (req, res) => {
        const ip = getIP(req);
        if (allowedIP(ip)) {
            res.sendFile(views.landing);
        } else {
            hostCfg.authenticated = false;
            res.sendFile(views.login);
        }
    });

    // ####################################################
    // AXIOS
    // ####################################################

    // handle login on host protected
    app.post(['/login'], (req, res) => {
        const ip = getIP(req);
        log.debug(`Request login to host from: ${ip}`, req.body);

        const { username, password } = checkXSS(req.body);

        const isPeerValid = isAuthPeer(username, password);

        if (hostCfg.protected && isPeerValid && !hostCfg.authenticated) {
            const ip = getIP(req);
            hostCfg.authenticated = true;
            authHost.setAuthorizedIP(ip, true);
            log.debug('HOST LOGIN OK', {
                ip: ip,
                authorized: authHost.isAuthorizedIP(ip),
                authorizedIps: authHost.getAuthorizedIPs(),
            });
            return res.status(200).json({ message: 'authorized' });
        }

        if (isPeerValid) {
            log.debug('PEER LOGIN OK', { ip: ip, authorized: true });
            return res.status(200).json({ message: 'authorized' });
        } else {
            return res.status(401).json({ message: 'unauthorized' });
        }
    });

    // ####################################################
    // API
    // ####################################################

    // request meeting room endpoint
    app.post(['/api/v1/meeting'], (req, res) => {
        // check if user was authorized for the api call
        let host = req.headers.host;
        let authorization = req.headers.authorization;
        let api = new ServerApi(host, authorization);
        if (!api.isAuthorized()) {
            log.debug('MiroTalk get meeting - Unauthorized', {
                header: req.headers,
                body: req.body,
            });
            return res.status(403).json({ error: 'Unauthorized!' });
        }
        // setup meeting URL
        let meetingURL = api.getMeetingURL();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ meeting: meetingURL }));
        // log.debug the output if all done
        log.debug('MiroTalk get meeting - Authorized', {
            header: req.headers,
            body: req.body,
            meeting: meetingURL,
        });
    });

    // request join room endpoint
    app.post(['/api/v1/join'], (req, res) => {
        // check if user was authorized for the api call
        let host = req.headers.host;
        let authorization = req.headers.authorization;
        let api = new ServerApi(host, authorization);
        if (!api.isAuthorized()) {
            log.debug('MiroTalk get join - Unauthorized', {
                header: req.headers,
                body: req.body,
            });
            return res.status(403).json({ error: 'Unauthorized!' });
        }
        // setup Join URL
        let joinURL = api.getJoinURL(req.body);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ join: joinURL }));
        // log.debug the output if all done
        log.debug('MiroTalk get join - Authorized', {
            header: req.headers,
            body: req.body,
            join: joinURL,
        });
    });

    // ####################################################
    // SLACK API
    // ####################################################

    app.post('/slack', (req, res) => {
        if (!slackEnabled) return res.end('`Under maintenance` - Please check back soon.');

        log.debug('Slack', req.headers);

        if (!slackSigningSecret) return res.end('`Slack Signing Secret is empty!`');

        let slackSignature = req.headers['x-slack-signature'];
        let requestBody = qS.stringify(req.body, { format: 'RFC1738' });
        let timeStamp = req.headers['x-slack-request-timestamp'];
        let time = Math.floor(new Date().getTime() / 1000);

        if (Math.abs(time - timeStamp) > 300) return res.end('`Wrong timestamp` - Ignore this request.');

        let sigBaseString = 'v0:' + timeStamp + ':' + requestBody;
        let mySignature = 'v0=' + CryptoJS.HmacSHA256(sigBaseString, slackSigningSecret);

        if (mySignature == slackSignature) {
            let host = req.headers.host;
            let api = new ServerApi(host);
            let meetingURL = api.getMeetingURL();
            log.debug('Slack', { meeting: meetingURL });
            return res.end(meetingURL);
        }
        return res.end('`Wrong signature` - Verification failed!');
    });

    // not match any of page before, so 404 not found
    app.get('*', function (req, res) {
        res.sendFile(views.notFound);
    });

    // ####################################################
    // NGROK
    // ####################################################

    async function ngrokStart() {
        try {
            await ngrok.authtoken(config.ngrok.authToken);
            await ngrok.connect(config.server.listen.port);
            const api = ngrok.getApi();
            // const data = JSON.parse(await api.get('api/tunnels')); // v3
            const data = await api.listTunnels(); // v4
            const pu0 = data.tunnels[0].public_url;
            const pu1 = data.tunnels[1].public_url;
            const tunnel = pu0.startsWith('https') ? pu0 : pu1;
            log.info('Listening on', {
                node_version: process.versions.node,
                hostConfig: hostCfg,
                presenters: config.presenters,
                announced_ip: announcedIP,
                server: host,
                server_tunnel: tunnel,
                api_docs: api_docs,
                mediasoup_worker_bin: mediasoup.workerBin,
                mediasoup_server_version: mediasoup.version,
                mediasoup_client_version: mediasoupClient.version,
                ip_lookup_enabled: config.IPLookup.enabled,
                sentry_enabled: sentryEnabled,
                redirect_enabled: config.redirect.enabled,
                slack_enabled: slackEnabled,
                stats_enabled: config.stats.enabled,
                chatGPT_enabled: config.chatGPT.enabled,
            });
        } catch (err) {
            log.error('Ngrok Start error: ', err.body);
            process.exit(1);
        }
    }

    // ####################################################
    // START SERVER
    // ####################################################

    httpsServer.listen(config.server.listen.port, () => {
        log.log(
            `%c
    
        ███████╗██╗ ██████╗ ███╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗ 
        ██╔════╝██║██╔════╝ ████╗  ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
        ███████╗██║██║  ███╗██╔██╗ ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
        ╚════██║██║██║   ██║██║╚██╗██║╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
        ███████║██║╚██████╔╝██║ ╚████║      ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
        ╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝ started...
    
        `,
            'font-family:monospace',
        );

        if (config.ngrok.authToken !== '') {
            return ngrokStart();
        }
        log.info('Settings', {
            node_version: process.versions.node,
            hostConfig: hostCfg,
            presenters: config.presenters,
            announced_ip: announcedIP,
            server: host,
            api_docs: api_docs,
            mediasoup_worker_bin: mediasoup.workerBin,
            mediasoup_server_version: mediasoup.version,
            mediasoup_client_version: mediasoupClient.version,
            ip_lookup_enabled: config.IPLookup.enabled,
            sentry_enabled: sentryEnabled,
            redirect_enabled: config.redirect.enabled,
            slack_enabled: slackEnabled,
            stats_enabled: config.stats.enabled,
            chatGPT_enabled: config.chatGPT.enabled,
        });
    });

    // ####################################################
    // WORKERS
    // ####################################################

    (async () => {
        try {
            await createWorkers();
        } catch (err) {
            log.error('Create Worker ERR --->', err);
            process.exit(1);
        }
    })();

    async function createWorkers() {
        const { numWorkers } = config.mediasoup;

        const { logLevel, logTags, rtcMinPort, rtcMaxPort } = config.mediasoup.worker;

        log.debug('WORKERS:', numWorkers);

        for (let i = 0; i < numWorkers; i++) {
            let worker = await mediasoup.createWorker({
                logLevel: logLevel,
                logTags: logTags,
                rtcMinPort: rtcMinPort,
                rtcMaxPort: rtcMaxPort,
            });
            worker.on('died', () => {
                log.error('Mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
                setTimeout(() => process.exit(1), 2000);
            });
            workers.push(worker);
        }
    }

    async function getMediasoupWorker() {
        const worker = workers[nextMediasoupWorkerIdx];
        if (++nextMediasoupWorkerIdx === workers.length) nextMediasoupWorkerIdx = 0;
        return worker;
    }

    // ####################################################
    // SOCKET IO
    // ####################################################

    io.on('connection', (socket) => {
        socket.on('clientError', (error) => {
            log.error('Client error', error);
            socket.destroy();
        });
        socket.on('error', (err) => {
            log.error('Socket error:', err);
            socket.destroy();
        });

        socket.on('createRoom', async ({ room_id }, callback) => {
            socket.room_id = room_id;

            if (roomList.has(socket.room_id)) {
                callback({ error: 'already exists' });
            } else {
                log.debug('Created room', { room_id: socket.room_id });
                let worker = await getMediasoupWorker();
                roomList.set(socket.room_id, new Room(socket.room_id, worker, io));
                callback({ room_id: socket.room_id });
            }
        });

        socket.on('getPeerCounts', async ({}, callback) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peerCounts = room.getPeersCount();

            log.debug('Peer counts', { peerCounts: peerCounts });

            callback({ peerCounts: peerCounts });
        });

        socket.on('cmd', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            log.debug('cmd', data);

            const room = roomList.get(socket.room_id);

            switch (data.type) {
                case 'privacy':
                    room.getPeers().get(socket.id).updatePeerInfo({ type: data.type, status: data.active });
                    break;
                default:
                    break;
                //...
            }

            room.broadCast(socket.id, 'cmd', data);
        });

        socket.on('roomAction', async (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, data.peer_name, data.peer_uuid);

            const room = roomList.get(socket.room_id);

            log.debug('Room action:', data);

            switch (data.action) {
                case 'broadcasting':
                    if (!isPresenter) return;
                    room.setIsBroadcasting(data.room_broadcasting);
                    room.broadCast(socket.id, 'roomAction', data.action);
                    break;
                case 'lock':
                    if (!isPresenter) return;
                    if (!room.isLocked()) {
                        room.setLocked(true, data.password);
                        room.broadCast(socket.id, 'roomAction', data.action);
                    }
                    break;
                case 'checkPassword':
                    let roomData = {
                        room: null,
                        password: 'KO',
                    };
                    if (data.password == room.getPassword()) {
                        roomData.room = room.toJson();
                        roomData.password = 'OK';
                    }
                    room.sendTo(socket.id, 'roomPassword', roomData);
                    break;
                case 'unlock':
                    if (!isPresenter) return;
                    room.setLocked(false);
                    room.broadCast(socket.id, 'roomAction', data.action);
                    break;
                case 'lobbyOn':
                    if (!isPresenter) return;
                    room.setLobbyEnabled(true);
                    room.broadCast(socket.id, 'roomAction', data.action);
                    break;
                case 'lobbyOff':
                    if (!isPresenter) return;
                    room.setLobbyEnabled(false);
                    room.broadCast(socket.id, 'roomAction', data.action);
                    break;
                case 'hostOnlyRecordingOn':
                    if (!isPresenter) return;
                    room.setHostOnlyRecording(true);
                    room.broadCast(socket.id, 'roomAction', data.action);
                    break;
                case 'hostOnlyRecordingOff':
                    if (!isPresenter) return;
                    room.setHostOnlyRecording(false);
                    room.broadCast(socket.id, 'roomAction', data.action);
                    break;
                default:
                    break;
            }
            log.debug('Room status', {
                broadcasting: room.isBroadcasting(),
                locked: room.isLocked(),
                lobby: room.isLobbyEnabled(),
                hostOnlyRecording: room.isHostOnlyRecording(),
            });
        });

        socket.on('roomLobby', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            data.room = room.toJson();

            log.debug('Room lobby', {
                peer_id: data.peer_id,
                peer_name: data.peer_name,
                peers_id: data.peers_id,
                lobby: data.lobby_status,
                broadcast: data.broadcast,
            });

            if (data.peers_id && data.broadcast) {
                for (let peer_id in data.peers_id) {
                    room.sendTo(data.peers_id[peer_id], 'roomLobby', data);
                }
            } else {
                room.sendTo(data.peer_id, 'roomLobby', data);
            }
        });

        socket.on('peerAction', async (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            log.debug('Peer action', data);

            const presenterActions = ['mute', 'unmute', 'hide', 'unhide', 'stop', 'start', 'eject'];
            if (presenterActions.some((v) => data.action === v)) {
                const isPresenter = await isPeerPresenter(
                    socket.room_id,
                    socket.id,
                    data.from_peer_name,
                    data.from_peer_uuid,
                );
                if (!isPresenter) return;
            }

            const room = roomList.get(socket.room_id);

            data.broadcast
                ? room.broadCast(data.peer_id, 'peerAction', data)
                : room.sendTo(data.peer_id, 'peerAction', data);
        });

        socket.on('updatePeerInfo', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            room.getPeers().get(socket.id).updatePeerInfo(data);

            if (data.broadcast) {
                log.info('updatePeerInfo broadcast data');
                room.broadCast(socket.id, 'updatePeerInfo', data);
            }
        });

        socket.on('updateRoomModerator', async (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, data.peer_name, data.peer_uuid);

            if (!isPresenter) return;

            const moderator = data.moderator;

            room.updateRoomModerator(moderator);

            switch (moderator.type) {
                case 'audio_cant_unmute':
                case 'video_cant_unhide':
                case 'screen_cant_share':
                case 'chat_cant_privately':
                case 'chat_cant_chatgpt':
                    room.broadCast(socket.id, 'updateRoomModerator', moderator);
                    break;
                default:
                    break;
            }
        });

        socket.on('updateRoomModeratorALL', async (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, data.peer_name, data.peer_uuid);

            if (!isPresenter) return;

            const moderator = data.moderator;

            room.updateRoomModeratorALL(moderator);

            room.broadCast(socket.id, 'updateRoomModeratorALL', moderator);
        });

        socket.on('fileInfo', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            if (!isValidFileName(data.fileName)) {
                log.debug('File name not valid', data);
                return;
            }

            log.debug('Send File Info', data);

            const room = roomList.get(socket.room_id);

            data.broadcast ? room.broadCast(socket.id, 'fileInfo', data) : room.sendTo(data.peer_id, 'fileInfo', data);
        });

        socket.on('file', (data) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            data.broadcast ? room.broadCast(socket.id, 'file', data) : room.sendTo(data.peer_id, 'file', data);
        });

        socket.on('fileAbort', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            roomList.get(socket.room_id).broadCast(socket.id, 'fileAbort', data);
        });

        socket.on('shareVideoAction', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            if (data.action == 'open' && !isValidHttpURL(data.video_url)) {
                log.debug('Video src not valid', data);
                return;
            }

            log.debug('Share video: ', data);

            const room = roomList.get(socket.room_id);

            data.peer_id == 'all'
                ? room.broadCast(socket.id, 'shareVideoAction', data)
                : room.sendTo(data.peer_id, 'shareVideoAction', data);
        });

        socket.on('wbCanvasToJson', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            // let objLength = bytesToSize(Object.keys(data).length);
            // log.debug('Send Whiteboard canvas JSON', { length: objLength });

            room.broadCast(socket.id, 'wbCanvasToJson', data);
        });

        socket.on('whiteboardAction', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            log.debug('Whiteboard', data);
            room.broadCast(socket.id, 'whiteboardAction', data);
        });

        socket.on('setVideoOff', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            log.debug('Video off data', data.peer_name);

            const room = roomList.get(socket.room_id);

            room.broadCast(socket.id, 'setVideoOff', data);
        });

        socket.on('recordingAction', async (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            log.debug('Recording action', data);

            const room = roomList.get(socket.room_id);

            room.broadCast(data.peer_id, 'recordingAction', data);
        });

        socket.on('join', async (dataObject, cb) => {
            if (!roomList.has(socket.room_id)) {
                return cb({
                    error: 'Room does not exist',
                });
            }

            // Get peer IPv4 (::1 Its the loopback address in ipv6, equal to 127.0.0.1 in ipv4)
            const peer_ip = socket.handshake.headers['x-forwarded-for'] || socket.conn.remoteAddress;

            // Get peer Geo Location
            if (config.IPLookup.enabled && peer_ip != '::1') {
                dataObject.peer_geo = await getPeerGeoLocation(peer_ip);
            }

            const data = checkXSS(dataObject);

            log.debug('User joined', data);

            // User Auth required, we check if peer valid
            if (hostCfg.user_auth) {
                const peer_username = data.peer_info.peer_username;
                const peer_password = data.peer_info.peer_password;

                const isPeerValid = isAuthPeer(peer_username, peer_password);

                log.debug('[Join] - HOST PROTECTED - USER AUTH check peer', {
                    ip: peer_ip,
                    peer_username: peer_username,
                    peer_password: peer_password,
                    peer_valid: isPeerValid,
                });

                if (!isPeerValid) {
                    // redirect peer to login page
                    return cb('unauthorized');
                }
            }

            const room = roomList.get(socket.room_id);

            room.addPeer(new Peer(socket.id, data));

            const activeRooms = getActiveRooms();

            log.info('[Join] - current active rooms', activeRooms);

            if (!(socket.room_id in presenters)) presenters[socket.room_id] = {};

            const peer = room.getPeers()?.get(socket.id)?.peer_info;

            const peer_id = peer && peer.peer_id;
            const peer_name = peer && peer.peer_name;
            const peer_uuid = peer && peer.peer_uuid;

            // Set the presenters
            const presenter = {
                peer_ip: peer_ip,
                peer_name: peer_name,
                peer_uuid: peer_uuid,
                is_presenter: true,
            };
            // first we check if the username match the presenters username
            if (config.presenters && config.presenters.list && config.presenters.list.includes(peer_name)) {
                presenters[socket.room_id][socket.id] = presenter;
            } else {
                // if not match the presenters username, the first one join room is the presenter
                if (Object.keys(presenters[socket.room_id]).length === 0) {
                    presenters[socket.room_id][socket.id] = presenter;
                }
            }

            log.info('[Join] - Connected presenters grp by roomId', presenters);

            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);

            room.getPeers().get(socket.id).updatePeerInfo({ type: 'presenter', status: isPresenter });

            log.info('[Join] - Is presenter', {
                roomId: socket.room_id,
                peer_name: peer_name,
                peer_presenter: isPresenter,
            });

            if (room.isLocked() && !isPresenter) {
                log.debug('The user was rejected because the room is locked, and they are not a presenter');
                return cb('isLocked');
            }

            if (room.isLobbyEnabled() && !isPresenter) {
                log.debug(
                    'The user is currently waiting to join the room because the lobby is enabled, and they are not a presenter',
                );
                room.broadCast(socket.id, 'roomLobby', {
                    peer_id: peer_id,
                    peer_name: peer_name,
                    lobby_status: 'waiting',
                });
                return cb('isLobby');
            }

            cb(room.toJson());
        });

        socket.on('getRouterRtpCapabilities', (_, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            log.debug('Get RouterRtpCapabilities', getPeerName(room));
            try {
                callback(room.getRtpCapabilities());
            } catch (err) {
                callback({
                    error: err.message,
                });
            }
        });

        socket.on('getProducers', () => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            log.debug('Get producers', getPeerName(room));

            // send all the current producer to newly joined member
            let producerList = room.getProducerListForPeer();

            socket.emit('newProducers', producerList);
        });

        socket.on('createWebRtcTransport', async (_, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            log.debug('Create webrtc transport', getPeerName(room));
            try {
                const { params } = await room.createWebRtcTransport(socket.id);
                callback(params);
            } catch (err) {
                log.error('Create WebRtc Transport error: ', err.message);
                callback({
                    error: err.message,
                });
            }
        });

        socket.on('connectTransport', async ({ transport_id, dtlsParameters }, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            log.debug('Connect transport', getPeerName(room));

            await room.connectPeerTransport(socket.id, transport_id, dtlsParameters);

            callback('success');
        });

        socket.on('produce', async ({ producerTransportId, kind, appData, rtpParameters }, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            let peer_name = getPeerName(room, false);

            // peer_info audio Or video ON
            let data = {
                peer_name: peer_name,
                peer_id: socket.id,
                kind: kind,
                type: appData.mediaType,
                status: true,
            };

            await room.getPeers().get(socket.id).updatePeerInfo(data);

            let producer_id = await room.produce(
                socket.id,
                producerTransportId,
                rtpParameters,
                kind,
                appData.mediaType,
            );

            log.debug('Produce', {
                kind: kind,
                type: appData.mediaType,
                peer_name: peer_name,
                peer_id: socket.id,
                producer_id: producer_id,
            });

            // add & monitor producer audio level
            if (kind === 'audio') {
                room.addProducerToAudioLevelObserver({ producerId: producer_id });
            }

            callback({
                producer_id,
            });
        });

        socket.on('consume', async ({ consumerTransportId, producerId, rtpCapabilities }, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            let params = await room.consume(socket.id, consumerTransportId, producerId, rtpCapabilities);

            log.debug('Consuming', {
                peer_name: getPeerName(room, false),
                producer_id: producerId,
                consumer_id: params ? params.id : undefined,
            });

            callback(params);
        });

        socket.on('producerClosed', (data) => {
            if (!roomList.has(socket.room_id)) return;

            log.debug('Producer close', data);

            const room = roomList.get(socket.room_id);

            // peer_info audio Or video OFF
            room.getPeers().get(socket.id).updatePeerInfo(data);
            room.closeProducer(socket.id, data.producer_id);
        });

        socket.on('resume', async (_, callback) => {
            await consumer.resume();
            callback();
        });

        socket.on('getRoomInfo', async (_, cb) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            log.debug('Send Room Info to', getPeerName(room));
            cb(room.toJson());
        });

        socket.on('refreshParticipantsCount', () => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            let data = {
                room_id: socket.room_id,
                peer_counts: room.getPeers().size,
            };
            log.debug('Refresh Participants count', data);
            room.broadCast(socket.id, 'refreshParticipantsCount', data);
        });

        socket.on('message', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            // check if the message coming from real peer
            const realPeer = isRealPeer(data.peer_name, data.peer_id, socket.room_id);
            if (!realPeer) {
                const peer_name = getPeerName(room, false);
                log.debug('Fake message detected', { realFrom: peer_name, fakeFrom: data.peer_name, msg: data.msg });
                return;
            }

            log.debug('message', data);

            data.to_peer_id == 'all'
                ? room.broadCast(socket.id, 'message', data)
                : room.sendTo(data.to_peer_id, 'message', data);
        });

        socket.on('getChatGPT', async ({ time, room, name, prompt }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            if (!config.chatGPT.enabled) return cb('ChatGPT seems disabled, try later!');
            try {
                // https://platform.openai.com/docs/api-reference/completions/create
                const completion = await chatGPT.completions.create({
                    model: config.chatGPT.model || 'text-davinci-003',
                    prompt: prompt,
                    max_tokens: config.chatGPT.max_tokens,
                    temperature: config.chatGPT.temperature,
                });
                const response = completion.choices[0].text;
                log.debug('ChatGPT', {
                    time: time,
                    room: room,
                    name: name,
                    prompt: prompt,
                    response: response,
                });
                cb(response);
            } catch (error) {
                if (error instanceof OpenAI.APIError) {
                    log.error('ChatGPT', {
                        status: error.status,
                        message: error.message,
                        code: error.code,
                        type: error.type,
                    });
                    cb(error.message);
                } else {
                    // Non-API error
                    log.error('ChatGPT', error);
                    cb(error);
                }
            }
        });

        socket.on('disconnect', async () => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peer = room.getPeers()?.get(socket.id)?.peer_info;

            const peerName = (peer && peer.peer_name) || '';
            const peerUuid = (peer && peer.peer_uuid) || '';

            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peerName, peerUuid);

            log.debug('[Disconnect] - peer name', peerName);

            room.removePeer(socket.id);

            if (room.getPeers().size === 0) {
                //
                roomList.delete(socket.room_id);

                const activeRooms = getActiveRooms();

                log.info('[Disconnect] - Last peer - current active rooms', activeRooms);

                delete presenters[socket.room_id];
                log.info('[Disconnect] - Last peer - current presenters grouped by roomId', presenters);
            }

            room.broadCast(socket.id, 'removeMe', removeMeData(room, peerName, isPresenter));

            removeIP(socket);
        });

        socket.on('exitRoom', async (_, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({
                    error: 'Not currently in a room',
                });
            }

            const room = roomList.get(socket.room_id);

            const peer = room.getPeers()?.get(socket.id)?.peer_info;

            const peerName = (peer && peer.peer_name) || '';
            const peerUuid = (peer && peer.peer_uuid) || '';

            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peerName, peerUuid);

            log.debug('Exit room', peerName);

            // close transports
            await room.removePeer(socket.id);

            room.broadCast(socket.id, 'removeMe', removeMeData(room, peerName, isPresenter));

            if (room.getPeers().size === 0) {
                //
                roomList.delete(socket.room_id);

                delete presenters[socket.room_id];

                log.info('[REMOVE ME] - Last peer - current presenters grouped by roomId', presenters);

                const activeRooms = getActiveRooms();

                log.info('[REMOVE ME] - Last peer - current active rooms', activeRooms);
            }

            socket.room_id = null;

            removeIP(socket);

            callback('Successfully exited room');
        });

        // common
        function getPeerName(room, json = true) {
            try {
                let peer_name = (room && room.getPeers()?.get(socket.id)?.peer_info?.peer_name) || 'undefined';

                if (json) {
                    return {
                        peer_name: peer_name,
                    };
                }
                return peer_name;
            } catch (err) {
                log.error('getPeerName', err);
                return json ? { peer_name: 'undefined' } : 'undefined';
            }
        }

        function isRealPeer(name, id, roomId) {
            const room = roomList.get(roomId);

            let peerName = (room && room.getPeers()?.get(id)?.peer_info?.peer_name) || 'undefined';

            return peerName == name;
        }

        function isValidFileName(fileName) {
            const invalidChars = /[\\\/\?\*\|:"<>]/;
            return !invalidChars.test(fileName);
        }

        function isValidHttpURL(input) {
            const pattern = new RegExp(
                '^(https?:\\/\\/)?' + // protocol
                    '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
                    '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
                    '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
                    '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
                    '(\\#[-a-z\\d_]*)?$',
                'i',
            ); // fragment locator
            return pattern.test(input);
        }

        function removeMeData(room, peerName, isPresenter) {
            const roomId = room && socket.room_id;
            const peerCounts = room && room.getPeers().size;
            log.debug('[REMOVE ME] - DATA', {
                roomId: roomId,
                name: peerName,
                isPresenter: isPresenter,
                count: peerCounts,
            });
            return {
                room_id: roomId,
                peer_id: socket.id,
                peer_name: peerName,
                peer_counts: peerCounts,
                isPresenter: isPresenter,
            };
        }

        function bytesToSize(bytes) {
            let sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
            if (bytes == 0) return '0 Byte';
            let i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
            return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
        }
    });

    async function isPeerPresenter(room_id, peer_id, peer_name, peer_uuid) {
        try {
            if (
                config.presenters &&
                config.presenters.join_first &&
                (!presenters[room_id] || !presenters[room_id][peer_id])
            ) {
                // Presenter not in the presenters config list, disconnected, or peer_id changed...
                for (const [existingPeerID, presenter] of Object.entries(presenters[room_id] || {})) {
                    if (presenter.peer_name === peer_name) {
                        log.info('Presenter found', {
                            room: room_id,
                            peer_id: existingPeerID,
                            peer_name: peer_name,
                        });
                        return true;
                    }
                }
                return false;
            }

            const isPresenter =
                (config.presenters &&
                    config.presenters.join_first &&
                    typeof presenters[room_id] === 'object' &&
                    Object.keys(presenters[room_id][peer_id]).length > 1 &&
                    presenters[room_id][peer_id]['peer_name'] === peer_name &&
                    presenters[room_id][peer_id]['peer_uuid'] === peer_uuid) ||
                (config.presenters && config.presenters.list && config.presenters.list.includes(peer_name));

            log.debug('isPeerPresenter', {
                room_id: room_id,
                peer_id: peer_id,
                peer_name: peer_name,
                peer_uuid: peer_uuid,
                isPresenter: isPresenter,
            });

            return isPresenter;
        } catch (err) {
            log.error('isPeerPresenter', err);
            return false;
        }
    }

    function isAuthPeer(username, password) {
        return hostCfg.users && hostCfg.users.some((user) => user.username === username && user.password === password);
    }

    function getActiveRooms() {
        const roomIds = Array.from(roomList.keys());
        const roomPeersArray = roomIds.map((roomId) => {
            const room = roomList.get(roomId);
            const peerCount = room ? room.getPeers().size : 0;
            const broadcasting = room ? room.isBroadcasting() : false;
            return {
                room: roomId,
                broadcasting: broadcasting,
                peers: peerCount,
            };
        });
        return roomPeersArray;
    }

    async function getPeerGeoLocation(ip) {
        const endpoint = config.IPLookup.getEndpoint(ip);
        log.debug('Get peer geo', { ip: ip, endpoint: endpoint });
        return axios
            .get(endpoint)
            .then((response) => response.data)
            .catch((error) => log.error(error));
    }

    function getIP(req) {
        return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    }
    function allowedIP(ip) {
        return authHost != null && authHost.isAuthorizedIP(ip);
    }
    function removeIP(socket) {
        if (hostCfg.protected) {
            let ip = socket.handshake.address;
            if (ip && allowedIP(ip)) {
                authHost.deleteIP(ip);
                hostCfg.authenticated = false;
                log.info('Remove IP from auth', {
                    ip: ip,
                    authorizedIps: authHost.getAuthorizedIPs(),
                });
            }
        }
    }
}
