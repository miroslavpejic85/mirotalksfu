'use strict';

/*
███████ ███████ ██████  ██    ██ ███████ ██████  
██      ██      ██   ██ ██    ██ ██      ██   ██ 
███████ █████   ██████  ██    ██ █████   ██████  
     ██ ██      ██   ██  ██  ██  ██      ██   ██ 
███████ ███████ ██   ██   ████   ███████ ██   ██                                           

dependencies: {
    @ffmpeg-installer/ffmpeg: https://www.npmjs.com/package/@ffmpeg-installer/ffmpeg
    @sentry/node            : https://www.npmjs.com/package/@sentry/node
    axios                   : https://www.npmjs.com/package/axios
    body-parser             : https://www.npmjs.com/package/body-parser
    compression             : https://www.npmjs.com/package/compression
    colors                  : https://www.npmjs.com/package/colors
    cors                    : https://www.npmjs.com/package/cors
    crypto-js               : https://www.npmjs.com/package/crypto-js
    express                 : https://www.npmjs.com/package/express
    express-openid-connect  : https://www.npmjs.com/package/express-openid-connect
    fluent-ffmpeg           : https://www.npmjs.com/package/fluent-ffmpeg
    httpolyglot             : https://www.npmjs.com/package/httpolyglot
    jsonwebtoken            : https://www.npmjs.com/package/jsonwebtoken
    js-yaml                 : https://www.npmjs.com/package/js-yaml
    mediasoup               : https://www.npmjs.com/package/mediasoup
    mediasoup-client        : https://www.npmjs.com/package/mediasoup-client
    ngrok                   : https://www.npmjs.com/package/ngrok
    openai                  : https://www.npmjs.com/package/openai
    qs                      : https://www.npmjs.com/package/qs
    socket.io               : https://www.npmjs.com/package/socket.io
    swagger-ui-express      : https://www.npmjs.com/package/swagger-ui-express
    uuid                    : https://www.npmjs.com/package/uuid
    xss                     : https://www.npmjs.com/package/xss
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
 * @version 1.5.54
 *
 */

const express = require('express');
const { auth, requiresAuth } = require('express-openid-connect');
const cors = require('cors');
const compression = require('compression');
const socketIo = require('socket.io');
const https = require('httpolyglot');
const mediasoup = require('mediasoup');
const mediasoupClient = require('mediasoup-client');
const http = require('http');
const path = require('path');
const axios = require('axios');
const ngrok = require('ngrok');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const config = require('./config');
const checkXSS = require('./XSS.js');
const Host = require('./Host');
const Room = require('./Room');
const Peer = require('./Peer');
const ServerApi = require('./ServerApi');
const Logger = require('./Logger');
const Validator = require('./Validator');
const log = new Logger('Server');
const yaml = require('js-yaml');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = yaml.load(fs.readFileSync(path.join(__dirname, '/../api/swagger.yaml'), 'utf8'));
const Sentry = require('@sentry/node');
const restrictAccessByIP = require('./middleware/IpWhitelist.js');
const packageJson = require('../../package.json');

// Incoming Stream to RTPM
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto-js');
const RtmpStreamer = require('./RtmpStreamer.js'); // Import the RtmpStreamer class
const rtmpCfg = config.server.rtmp;
const rtmpDir = rtmpCfg && rtmpCfg.dir ? rtmpCfg.dir : 'rtmp';

// File and Url Rtmp streams count
let rtmpFileStreamsCount = 0;
let rtmpUrlStreamsCount = 0;

// Email alerts and notifications
const nodemailer = require('./lib/nodemailer');

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

const corsOptions = {
    origin: config.server?.cors?.origin || '*',
    methods: config.server?.cors?.methods || ['GET', 'POST'],
};

const httpsServer = https.createServer(options, app);
const io = socketIo(httpsServer, {
    maxHttpBufferSize: 1e7,
    transports: ['websocket'],
    cors: corsOptions,
});

const host = 'https://' + 'localhost' + ':' + config.server.listen.port; // config.server.listen.ip

const jwtCfg = {
    JWT_KEY: (config.jwt && config.jwt.key) || 'mirotalksfu_jwt_secret',
    JWT_EXP: (config.jwt && config.jwt.exp) || '1h',
};

const hostCfg = {
    protected: config.host.protected,
    user_auth: config.host.user_auth,
    users_from_db: config.host.users_from_db,
    users_api_endpoint: config.host.users_api_endpoint,
    users_api_secret_key: config.host.users_api_secret_key,
    users: config.host.users,
    authenticated: !config.host.protected,
};

const restApi = {
    basePath: '/api/v1', // api endpoint path
    docs: host + '/api/v1/docs', // api docs
    allowed: config.api?.allowed,
};

// Sentry monitoring
const sentryEnabled = config.sentry.enabled;
const sentryDSN = config.sentry.DSN;
const sentryTracesSampleRate = config.sentry.tracesSampleRate;
if (sentryEnabled) {
    Sentry.init({
        dsn: sentryDSN,
        integrations: [
            Sentry.captureConsoleIntegration({
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
        log.warn('ChatGPT seems enabled, but you missing the apiKey!');
    }
}

// OpenID Connect
const OIDC = config.oidc ? config.oidc : { enabled: false };

// directory
const dir = {
    public: path.join(__dirname, '../../', 'public'),
    rec: path.join(__dirname, '../', config?.server?.recording?.dir ? config.server.recording.dir + '/' : 'rec/'),
};

// rec directory create
const serverRecordingEnabled = config?.server?.recording?.enabled;
if (serverRecordingEnabled) {
    if (!fs.existsSync(dir.rec)) {
        fs.mkdirSync(dir.rec, { recursive: true });
    }
}

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
    rtmpStreamer: path.join(__dirname, '../../', 'public/views/RtmpStreamer.html'),
};

const authHost = new Host(); // Authenticated IP by Login

const roomList = new Map(); // All Rooms

const presenters = {}; // Collect presenters grp by roomId

const streams = {}; // Collect all rtmp streams

const webRtcServerActive = config.mediasoup.webRtcServerActive;

// ip (server local IPv4)
const IPv4 = webRtcServerActive
    ? config.mediasoup.webRtcServerOptions.listenInfos[0].ip
    : config.mediasoup.webRtcTransport.listenInfos[0].ip;

// announcedAddress (server public IPv4)
let announcedAddress = webRtcServerActive
    ? config.mediasoup.webRtcServerOptions.listenInfos[0].announcedAddress
    : config.mediasoup.webRtcTransport.listenInfos[0].announcedAddress;

// All mediasoup workers
const workers = [];
let nextMediasoupWorkerIdx = 0;

// Autodetect announcedAddress (https://www.ipify.org)
if (!announcedAddress && IPv4 === '0.0.0.0') {
    http.get(
        {
            host: 'api.ipify.org',
            port: 80,
            path: '/',
        },
        (resp) => {
            resp.on('data', (ip) => {
                announcedAddress = ip.toString();
                if (webRtcServerActive) {
                    config.mediasoup.webRtcServerOptions.listenInfos.forEach((info) => {
                        info.announcedAddress = announcedAddress;
                    });
                } else {
                    config.mediasoup.webRtcTransport.listenInfos.forEach((info) => {
                        info.announcedAddress = announcedAddress;
                    });
                }
                startServer();
            });
        },
    );
} else {
    startServer();
}

// Custom middleware function for OIDC authentication
function OIDCAuth(req, res, next) {
    if (OIDC.enabled) {
        // Apply requiresAuth() middleware conditionally
        requiresAuth()(req, res, function () {
            log.debug('[OIDC] ------> requiresAuth');
            // Check if user is authenticated
            if (req.oidc.isAuthenticated()) {
                log.debug('[OIDC] ------> User isAuthenticated');
                // User is authenticated
                if (hostCfg.protected) {
                    const ip = authHost.getIP(req);
                    hostCfg.authenticated = true;
                    authHost.setAuthorizedIP(ip, true);
                    // Check...
                    log.debug('[OIDC] ------> Host protected', {
                        authenticated: hostCfg.authenticated,
                        authorizedIPs: authHost.getAuthorizedIPs(),
                        activeRoom: authHost.isRoomActive(),
                    });
                }
                next();
            } else {
                // User is not authenticated
                res.status(401).send('Unauthorized');
            }
        });
    } else {
        next();
    }
}

function startServer() {
    // Start the app
    app.use(cors(corsOptions));
    app.use(compression());
    app.use(express.json({ limit: '50mb' })); // Ensure the body parser can handle large files
    app.use(express.static(dir.public));
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.raw({ type: 'video/webm', limit: '50mb' })); // handle raw binary data
    app.use(restApi.basePath + '/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument)); // api docs

    // IP Whitelist check ...
    app.use(restrictAccessByIP);

    // Logs requests
    /*
    app.use((req, res, next) => {
        log.debug('New request:', {
            headers: req.headers,
            body: req.body,
            method: req.method,
            path: req.originalUrl,
        });
        next();
    });
    */

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

    // OpenID Connect
    if (OIDC.enabled) {
        try {
            app.use(auth(OIDC.config));
        } catch (err) {
            log.error(err);
            process.exit(1);
        }
    }

    // Route to display user information
    app.get('/profile', OIDCAuth, (req, res) => {
        if (OIDC.enabled) {
            return res.json(req.oidc.user); // Send user information as JSON
        }
        res.sendFile(views.notFound);
    });

    // Authentication Callback Route
    app.get('/auth/callback', (req, res, next) => {
        next(); // Let express-openid-connect handle this route
    });

    // Logout Route
    app.get('/logout', (req, res) => {
        if (OIDC.enabled) {
            //
            if (hostCfg.protected) {
                const ip = authHost.getIP(req);
                if (authHost.isAuthorizedIP(ip)) {
                    authHost.deleteIP(ip);
                }
                hostCfg.authenticated = false;
                //
                log.debug('[OIDC] ------> Logout', {
                    authenticated: hostCfg.authenticated,
                    authorizedIPs: authHost.getAuthorizedIPs(),
                    activeRoom: authHost.isRoomActive(),
                });
            }
            req.logout(); // Logout user
        }
        res.redirect('/'); // Redirect to the home page after logout
    });

    // UI buttons configuration
    app.get('/config', (req, res) => {
        res.status(200).json({ message: config.ui ? config.ui.buttons : false });
    });

    // Brand configuration
    app.get('/brand', (req, res) => {
        res.status(200).json({ message: config.ui ? config.ui.brand : false });
    });

    // main page
    app.get(['/'], OIDCAuth, (req, res) => {
        //log.debug('/ - hostCfg ----->', hostCfg);
        if ((!OIDC.enabled && hostCfg.protected && !hostCfg.authenticated) || authHost.isRoomActive()) {
            const ip = getIP(req);
            if (allowedIP(ip)) {
                res.sendFile(views.landing);
                hostCfg.authenticated = true;
            } else {
                hostCfg.authenticated = false;
                res.sendFile(views.login);
            }
        } else {
            res.sendFile(views.landing);
        }
    });

    // Route to display rtmp streamer
    app.get('/rtmp', OIDCAuth, (req, res) => {
        if (!rtmpCfg || !rtmpCfg.fromStream) {
            return res.json({ message: 'The RTMP Streamer is currently disabled.' });
        }
        return res.sendFile(views.rtmpStreamer);
    });

    // set new room name and join
    app.get(['/newroom'], OIDCAuth, (req, res) => {
        //log.info('/newroom - hostCfg ----->', hostCfg);

        if ((!OIDC.enabled && hostCfg.protected && !hostCfg.authenticated) || authHost.isRoomActive()) {
            const ip = getIP(req);
            if (allowedIP(ip)) {
                res.sendFile(views.newRoom);
                hostCfg.authenticated = true;
            } else {
                hostCfg.authenticated = false;
                res.sendFile(views.login);
            }
        } else {
            res.sendFile(views.newRoom);
        }
    });

    // Handle Direct join room with params
    app.get('/join/', async (req, res) => {
        if (Object.keys(req.query).length > 0) {
            //log.debug('/join/params - hostCfg ----->', hostCfg);

            log.debug('Direct Join', req.query);

            // http://localhost:3010/join?room=test&roomPassword=0&name=mirotalksfu&audio=1&video=1&screen=0&hide=0&notify=1
            // http://localhost:3010/join?room=test&roomPassword=0&name=mirotalksfu&audio=1&video=1&screen=0&hide=0&notify=0&token=token

            const { room, roomPassword, name, audio, video, screen, hide, notify, token, isPresenter } = checkXSS(
                req.query,
            );

            if (!Validator.isValidRoomName(room)) {
                return res.status(400).json({
                    message: 'Invalid Room name!\nPath traversal pattern detected!',
                });
            }

            let peerUsername = '';
            let peerPassword = '';
            let isPeerValid = false;
            let isPeerPresenter = false;

            if (token) {
                try {
                    const validToken = await isValidToken(token);

                    if (!validToken) {
                        return res.status(401).json({ message: 'Invalid Token' });
                    }

                    const { username, password, presenter } = checkXSS(decodeToken(token));

                    peerUsername = username;
                    peerPassword = password;
                    isPeerValid = await isAuthPeer(username, password);
                    isPeerPresenter = presenter === '1' || presenter === 'true';

                    if (isPeerPresenter && !hostCfg.users_from_db) {
                        const roomAllowedForUser = isRoomAllowedForUser('Direct Join with token', username, room);
                        if (!roomAllowedForUser) {
                            return res.status(401).json({ message: 'Direct Room Join for this User is Unauthorized' });
                        }
                    }
                } catch (err) {
                    log.error('Direct Join JWT error', { error: err.message, token: token });
                    return hostCfg.protected || hostCfg.user_auth
                        ? res.sendFile(views.login)
                        : res.sendFile(views.landing);
                }
            } else {
                const allowRoomAccess = isAllowedRoomAccess('/join/params', req, hostCfg, authHost, roomList, room);
                const roomAllowedForUser = isRoomAllowedForUser('Direct Join with token', name, room);
                if (!allowRoomAccess && !roomAllowedForUser) {
                    return res.status(401).json({ message: 'Direct Room Join Unauthorized' });
                }
            }

            const OIDCUserAuthenticated = OIDC.enabled && req.oidc.isAuthenticated();

            if (
                (hostCfg.protected && isPeerValid && isPeerPresenter && !hostCfg.authenticated) ||
                OIDCUserAuthenticated
            ) {
                const ip = getIP(req);
                hostCfg.authenticated = true;
                authHost.setAuthorizedIP(ip, true);
                log.debug('Direct Join user auth as host done', {
                    ip: ip,
                    username: peerUsername,
                    password: peerPassword,
                });
            }

            if (room && (hostCfg.authenticated || isPeerValid)) {
                return res.sendFile(views.room);
            } else {
                return res.sendFile(views.login);
            }
        }
    });

    // join room by id
    app.get('/join/:roomId', (req, res) => {
        //
        const roomId = req.params.roomId;

        if (!Validator.isValidRoomName(roomId)) {
            log.warn('/join/:roomId invalid', roomId);
            return res.redirect('/');
        }

        const allowRoomAccess = isAllowedRoomAccess('/join/:roomId', req, hostCfg, authHost, roomList, roomId);

        if (allowRoomAccess) {
            if (hostCfg.protected) authHost.setRoomActive();

            res.sendFile(views.room);
        } else {
            if (!OIDC.enabled && hostCfg.protected) {
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
            hostCfg.authenticated = true;
        } else {
            hostCfg.authenticated = false;
            res.sendFile(views.login);
        }
    });

    // ####################################################
    // AXIOS
    // ####################################################

    // handle login on host protected
    app.post(['/login'], async (req, res) => {
        const ip = getIP(req);
        log.debug(`Request login to host from: ${ip}`, req.body);

        const { username, password } = checkXSS(req.body);

        const isPeerValid = await isAuthPeer(username, password);

        if (hostCfg.protected && isPeerValid && !hostCfg.authenticated) {
            const ip = getIP(req);
            hostCfg.authenticated = true;
            authHost.setAuthorizedIP(ip, true);
            log.debug('HOST LOGIN OK', {
                ip: ip,
                authorized: authHost.isAuthorizedIP(ip),
                authorizedIps: authHost.getAuthorizedIPs(),
            });

            const isPresenter =
                config.presenters && config.presenters.join_first
                    ? true
                    : config.presenters &&
                      config.presenters.list &&
                      config.presenters.list.includes(username).toString();

            const token = encodeToken({ username: username, password: password, presenter: isPresenter });
            return res.status(200).json({ message: token });
        }

        if (isPeerValid) {
            log.debug('PEER LOGIN OK', { ip: ip, authorized: true });
            const isPresenter =
                config.presenters && config.presenters.list && config.presenters.list.includes(username).toString();
            const token = encodeToken({ username: username, password: password, presenter: isPresenter });
            return res.status(200).json({ message: token });
        } else {
            return res.status(401).json({ message: 'unauthorized' });
        }
    });

    // ####################################################
    // KEEP RECORDING ON SERVER DIR
    // ####################################################

    app.post(['/recSync'], (req, res) => {
        // Store recording...
        if (serverRecordingEnabled) {
            //
            try {
                const { fileName } = req.query;

                if (!fileName) {
                    return res.status(400).send('Filename not provided');
                }

                if (!Validator.isValidRecFileNameFormat(fileName)) {
                    log.warn('[RecSync] - Invalid file name', fileName);
                    return res.status(400).send('Invalid file name');
                }

                const parts = fileName.split('_');
                const roomId = parts[1];

                if (!roomList.has(roomId)) {
                    log.warn('[RecSync] - RoomID not exists in filename', fileName);
                    return res.status(400).send('Invalid file name');
                }

                if (!fs.existsSync(dir.rec)) {
                    fs.mkdirSync(dir.rec, { recursive: true });
                }
                const filePath = dir.rec + fileName;
                const writeStream = fs.createWriteStream(filePath, { flags: 'a' });

                req.pipe(writeStream);

                writeStream.on('error', (err) => {
                    log.error('[RecSync] - Error writing to file:', err.message);
                    res.status(500).send('Internal Server Error');
                });

                writeStream.on('finish', () => {
                    log.debug('[RecSync] - File saved successfully:', fileName);
                    res.status(200).send('File uploaded successfully');
                });
            } catch (err) {
                log.error('[RecSync] - Error processing upload', err.message);
                res.status(500).send('Internal Server Error');
            }
        }
    });

    // ###############################################################
    // INCOMING STREAM (getUserMedia || getDisplayMedia) TO RTMP
    // ###############################################################

    function checkRTMPApiSecret(req, res, next) {
        const expectedApiSecret = rtmpCfg && rtmpCfg.apiSecret;
        const apiSecret = req.headers.authorization;

        if (!apiSecret || apiSecret !== expectedApiSecret) {
            log.warn('RTMP apiSecret Unauthorized', {
                apiSecret: apiSecret,
                expectedApiSecret: expectedApiSecret,
            });
            return res.status(401).send('Unauthorized');
        }
        next();
    }

    function checkMaxStreams(req, res, next) {
        const maxStreams = (rtmpCfg && rtmpCfg.maxStreams) || 1; // Set your maximum allowed streams here
        const activeStreams = Object.keys(streams).length;
        if (activeStreams >= maxStreams) {
            log.warn('Maximum number of streams reached', activeStreams);
            return res.status(429).send('Maximum number of streams reached, please try later!');
        }
        next();
    }

    app.get('/activeStreams', checkRTMPApiSecret, (req, res) => {
        const activeStreams = Object.keys(streams).length;
        log.info('Active Streams', activeStreams);
        res.json(activeStreams);
    });

    app.get('/rtmpEnabled', (req, res) => {
        const rtmpEnabled = rtmpCfg && rtmpCfg.enabled;
        log.debug('RTMP enabled', rtmpEnabled);
        res.json({ enabled: rtmpEnabled });
    });

    app.post('/initRTMP', checkRTMPApiSecret, checkMaxStreams, async (req, res) => {
        if (!rtmpCfg || !rtmpCfg.enabled) {
            return res.status(400).send('RTMP server is not enabled or missing the config');
        }

        const domainName = config.ngrok.enabled ? 'localhost' : req.headers.host.split(':')[0];

        const rtmpServer = rtmpCfg.server != '' ? rtmpCfg.server : false;
        const rtmpServerAppName = rtmpCfg.appName != '' ? rtmpCfg.appName : 'live';
        const rtmpStreamKey = rtmpCfg.streamKey != '' ? rtmpCfg.streamKey : uuidv4();
        const rtmpServerSecret = rtmpCfg.secret != '' ? rtmpCfg.secret : false;
        const expirationHours = rtmpCfg.expirationHours || 4;
        const rtmpServerURL = rtmpServer ? rtmpServer : `rtmp://${domainName}:1935`;
        const rtmpServerPath = '/' + rtmpServerAppName + '/' + rtmpStreamKey;

        const rtmp = rtmpServerSecret
            ? generateRTMPUrl(rtmpServerURL, rtmpServerPath, rtmpServerSecret, expirationHours)
            : rtmpServerURL + rtmpServerPath;

        log.info('initRTMP', {
            headers: req.headers,
            rtmpServer,
            rtmpServerSecret,
            rtmpServerURL,
            rtmpServerPath,
            expirationHours,
            rtmpStreamKey,
            rtmp,
        });

        const stream = new RtmpStreamer(rtmp, rtmpStreamKey);
        streams[rtmpStreamKey] = stream;

        log.info('Active RTMP Streams', Object.keys(streams).length);

        return res.json({ rtmp });
    });

    app.post('/streamRTMP', checkRTMPApiSecret, (req, res) => {
        if (!rtmpCfg || !rtmpCfg.enabled) {
            return res.status(400).send('RTMP server is not enabled');
        }
        if (!req.body || req.body.length === 0) {
            return res.status(400).send('Invalid video data');
        }

        const rtmpStreamKey = req.query.key;
        const stream = streams[rtmpStreamKey];

        if (!stream || !stream.isRunning()) {
            delete streams[rtmpStreamKey];
            log.debug('Stream not found', { rtmpStreamKey, streams: Object.keys(streams).length });
            return res.status(404).send('FFmpeg Stream not found');
        }

        log.debug('Received video data', {
            // data: req.body.slice(0, 20).toString('hex'),
            key: rtmpStreamKey,
            size: bytesToSize(req.headers['content-length']),
        });

        stream.write(Buffer.from(req.body));
        res.sendStatus(200);
    });

    app.post('/stopRTMP', checkRTMPApiSecret, (req, res) => {
        if (!rtmpCfg || !rtmpCfg.enabled) {
            return res.status(400).send('RTMP server is not enabled');
        }

        const rtmpStreamKey = req.query.key;
        const stream = streams[rtmpStreamKey];

        if (stream) {
            stream.end();
            delete streams[rtmpStreamKey];
            log.debug('Active RTMP Streams', Object.keys(streams).length);
        }

        res.sendStatus(200);
    });

    // ####################################################
    // REST API
    // ####################################################

    // request meetings list
    app.get([restApi.basePath + '/meetings'], (req, res) => {
        // Check if endpoint allowed
        if (restApi.allowed && !restApi.allowed.meetings) {
            return res.status(403).json({
                error: 'This endpoint has been disabled. Please contact the administrator for further information.',
            });
        }
        // check if user was authorized for the api call
        const { host, authorization } = req.headers;
        const api = new ServerApi(host, authorization);
        if (!api.isAuthorized()) {
            log.debug('MiroTalk get meetings - Unauthorized', {
                header: req.headers,
                body: req.body,
            });
            return res.status(403).json({ error: 'Unauthorized!' });
        }
        // Get meetings
        const meetings = api.getMeetings(roomList);
        res.json({ meetings: meetings });
        // log.debug the output if all done
        log.debug('MiroTalk get meetings - Authorized', {
            header: req.headers,
            body: req.body,
            meetings: meetings,
        });
    });

    // request meeting room endpoint
    app.post([restApi.basePath + '/meeting'], (req, res) => {
        // Check if endpoint allowed
        if (restApi.allowed && !restApi.allowed.meeting) {
            return res.status(403).json({
                error: 'This endpoint has been disabled. Please contact the administrator for further information.',
            });
        }
        // check if user was authorized for the api call
        const { host, authorization } = req.headers;
        const api = new ServerApi(host, authorization);
        if (!api.isAuthorized()) {
            log.debug('MiroTalk get meeting - Unauthorized', {
                header: req.headers,
                body: req.body,
            });
            return res.status(403).json({ error: 'Unauthorized!' });
        }
        // setup meeting URL
        const meetingURL = api.getMeetingURL();
        res.json({ meeting: meetingURL });
        // log.debug the output if all done
        log.debug('MiroTalk get meeting - Authorized', {
            header: req.headers,
            body: req.body,
            meeting: meetingURL,
        });
    });

    // request join room endpoint
    app.post([restApi.basePath + '/join'], (req, res) => {
        // Check if endpoint allowed
        if (restApi.allowed && !restApi.allowed.join) {
            return res.status(403).json({
                error: 'This endpoint has been disabled. Please contact the administrator for further information.',
            });
        }
        // check if user was authorized for the api call
        const { host, authorization } = req.headers;
        const api = new ServerApi(host, authorization);
        if (!api.isAuthorized()) {
            log.debug('MiroTalk get join - Unauthorized', {
                header: req.headers,
                body: req.body,
            });
            return res.status(403).json({ error: 'Unauthorized!' });
        }
        // setup Join URL
        const joinURL = api.getJoinURL(req.body);
        res.json({ join: joinURL });
        // log.debug the output if all done
        log.debug('MiroTalk get join - Authorized', {
            header: req.headers,
            body: req.body,
            join: joinURL,
        });
    });

    // request token endpoint
    app.post([restApi.basePath + '/token'], (req, res) => {
        // Check if endpoint allowed
        if (restApi.allowed && !restApi.allowed.token) {
            return res.status(403).json({
                error: 'This endpoint has been disabled. Please contact the administrator for further information.',
            });
        }
        // check if user was authorized for the api call
        const { host, authorization } = req.headers;
        const api = new ServerApi(host, authorization);
        if (!api.isAuthorized()) {
            log.debug('MiroTalk get token - Unauthorized', {
                header: req.headers,
                body: req.body,
            });
            return res.status(403).json({ error: 'Unauthorized!' });
        }
        // Get Token
        const token = api.getToken(req.body);
        res.json({ token: token });
        // log.debug the output if all done
        log.debug('MiroTalk get token - Authorized', {
            header: req.headers,
            body: req.body,
            token: token,
        });
    });

    // ####################################################
    // SLACK API
    // ####################################################

    app.post('/slack', (req, res) => {
        if (!slackEnabled) return res.end('`Under maintenance` - Please check back soon.');

        if (restApi.allowed && !restApi.allowed.slack) {
            return res.end(
                '`This endpoint has been disabled`. Please contact the administrator for further information.',
            );
        }

        log.debug('Slack', req.headers);

        if (!slackSigningSecret) return res.end('`Slack Signing Secret is empty!`');

        const slackSignature = req.headers['x-slack-signature'];
        const requestBody = qS.stringify(req.body, { format: 'RFC1738' });
        const timeStamp = req.headers['x-slack-request-timestamp'];
        const time = Math.floor(new Date().getTime() / 1000);

        if (Math.abs(time - timeStamp) > 300) return res.end('`Wrong timestamp` - Ignore this request.');

        const sigBaseString = 'v0:' + timeStamp + ':' + requestBody;
        const mySignature = 'v0=' + CryptoJS.HmacSHA256(sigBaseString, slackSigningSecret);

        if (mySignature == slackSignature) {
            const host = req.headers.host;
            const api = new ServerApi(host);
            const meetingURL = api.getMeetingURL();
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
    // SERVER CONFIG
    // ####################################################

    function getServerConfig(tunnel = false) {
        return {
            app_version: packageJson.version,
            node_version: process.versions.node,
            cors_options: corsOptions,
            middleware: config.middleware,
            server_listen: host,
            server_tunnel: tunnel,
            hostConfig: hostCfg,
            jwtCfg: jwtCfg,
            presenters: config.presenters,
            rest_api: restApi,
            mediasoup_worker_bin: mediasoup.workerBin,
            mediasoup_server_version: mediasoup.version,
            mediasoup_client_version: mediasoupClient.version,
            mediasoup_listenInfos: config.mediasoup.webRtcTransport.listenInfos,
            ip_lookup_enabled: config.IPLookup.enabled,
            sentry_enabled: sentryEnabled,
            redirect_enabled: config.redirect.enabled,
            slack_enabled: slackEnabled,
            stats_enabled: config.stats.enabled,
            chatGPT_enabled: config.chatGPT.enabled,
            configUI: config.ui,
            serverRec: config?.server?.recording,
            oidc: OIDC.enabled ? OIDC : false,
        };
    }

    // ####################################################
    // NGROK
    // ####################################################

    async function ngrokStart() {
        try {
            await ngrok.authtoken(config.ngrok.authToken);
            await ngrok.connect(config.server.listen.port);
            const api = ngrok.getApi();
            const list = await api.listTunnels();
            const tunnel = list.tunnels[0].public_url;
            log.info('Server config', getServerConfig(tunnel));
        } catch (err) {
            log.error('Ngrok Start error: ', err.body);
            await ngrok.kill();
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

        if (config.ngrok.enabled && config.ngrok.authToken !== '') {
            return ngrokStart();
        }
        log.info('Server config', getServerConfig());
    });

    // ####################################################
    // WORKERS
    // ####################################################

    (async () => {
        try {
            await createWorkers();
        } catch (err) {
            log.error('Create Worker ERROR --->', err);
            process.exit(1);
        }
    })();

    async function createWorkers() {
        const { numWorkers } = config.mediasoup;

        const { logLevel, logTags, rtcMinPort, rtcMaxPort } = config.mediasoup.worker;

        log.info('WORKERS:', numWorkers);

        for (let i = 0; i < numWorkers; i++) {
            //
            const worker = await mediasoup.createWorker({
                logLevel: logLevel,
                logTags: logTags,
                rtcMinPort: rtcMinPort,
                rtcMaxPort: rtcMaxPort,
            });

            if (webRtcServerActive) {
                const webRtcServerOptions = clone(config.mediasoup.webRtcServerOptions);
                const portIncrement = i;

                for (const listenInfo of webRtcServerOptions.listenInfos) {
                    if (!listenInfo.portRange) {
                        listenInfo.port += portIncrement;
                    }
                }

                log.info('Create a WebRtcServer', {
                    worker_pid: worker.pid,
                    webRtcServerOptions: webRtcServerOptions,
                });

                const webRtcServer = await worker.createWebRtcServer(webRtcServerOptions);
                worker.appData.webRtcServer = webRtcServer;
            }

            worker.on('died', () => {
                log.error('Mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
                setTimeout(() => process.exit(1), 2000);
            });

            workers.push(worker);

            /*
            setInterval(async () => {
                const usage = await worker.getResourceUsage();
                log.info('mediasoup Worker resource usage', { worker_pid: worker.pid, usage: usage });
                const dump = await worker.dump();
                log.info('mediasoup Worker dump', { worker_pid: worker.pid, dump: dump });
            }, 120000);
            */
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
            try {
                log.error('Client error', error.message);
                socket.disconnect(true); // true indicates a forced disconnection
            } catch (error) {
                log.error('Error handling Client error', error.message);
            }
        });

        socket.on('error', (error) => {
            try {
                log.error('Socket error', error.message);
                socket.disconnect(true); // true indicates a forced disconnection
            } catch (error) {
                log.error('Error handling socket error', error.message);
            }
        });

        socket.on('createRoom', async ({ room_id }, callback) => {
            socket.room_id = room_id;

            if (roomList.has(socket.room_id)) {
                callback({ error: 'already exists' });
            } else {
                log.debug('Created room', { room_id: socket.room_id });
                const worker = await getMediasoupWorker();
                roomList.set(socket.room_id, new Room(socket.room_id, worker, io));
                callback({ room_id: socket.room_id });
            }
        });

        socket.on('join', async (dataObject, cb) => {
            if (!roomList.has(socket.room_id)) {
                return cb({
                    error: 'Room does not exist',
                });
            }

            // Get peer IPv4 (::1 Its the loopback address in ipv6, equal to 127.0.0.1 in ipv4)
            const peer_ip = getIpSocket(socket);

            // Get peer Geo Location
            if (config.IPLookup.enabled && peer_ip != '::1') {
                dataObject.peer_geo = await getPeerGeoLocation(peer_ip);
            }

            const data = checkXSS(dataObject);

            log.info('User joined', data);

            if (!Validator.isValidRoomName(socket.room_id)) {
                log.warn('[Join] - Invalid room name', socket.room_id);
                return cb('invalid');
            }

            const room = roomList.get(socket.room_id);

            const { peer_name, peer_id, peer_uuid, peer_token, os_name, os_version, browser_name, browser_version } =
                data.peer_info;

            let is_presenter = true;

            // User Auth required or detect token, we check if peer valid
            if (hostCfg.user_auth || peer_token) {
                // Check JWT
                if (peer_token) {
                    try {
                        const validToken = await isValidToken(peer_token);

                        if (!validToken) {
                            return cb('unauthorized');
                        }

                        const { username, password, presenter } = checkXSS(decodeToken(peer_token));

                        const isPeerValid = await isAuthPeer(username, password);

                        if (!isPeerValid) {
                            // redirect peer to login page
                            return cb('unauthorized');
                        }

                        is_presenter =
                            presenter === '1' ||
                            presenter === 'true' ||
                            (config.presenters.join_first && room.getPeers().size === 0);

                        log.debug('[Join] - HOST PROTECTED - USER AUTH check peer', {
                            ip: peer_ip,
                            peer_username: username,
                            peer_password: password,
                            peer_valid: isPeerValid,
                            peer_presenter: is_presenter,
                        });
                    } catch (err) {
                        log.error('[Join] - JWT error', {
                            error: err.message,
                            token: peer_token,
                        });
                        return cb('unauthorized');
                    }
                } else {
                    return cb('unauthorized');
                }

                if (!hostCfg.users_from_db) {
                    const roomAllowedForUser = isRoomAllowedForUser('[Join]', peer_name, room.id);
                    if (!roomAllowedForUser) {
                        return cb('notAllowed');
                    }
                }
            }

            // check if banned...
            if (room.isBanned(peer_uuid)) {
                log.info('[Join] - peer is banned!', {
                    room_id: data.room_id,
                    peer: {
                        name: peer_name,
                        uuid: peer_uuid,
                        os_name: os_name,
                        os_version: os_version,
                        browser_name: browser_name,
                        browser_version: browser_version,
                    },
                });
                return cb('isBanned');
            }

            room.addPeer(new Peer(socket.id, data));

            const activeRooms = getActiveRooms();

            log.info('[Join] - current active rooms', activeRooms);

            const activeStreams = getRTMPActiveStreams();

            log.info('[Join] - current active RTMP streams', activeStreams);

            if (!(socket.room_id in presenters)) presenters[socket.room_id] = {};

            // Set the presenters
            const presenter = {
                peer_ip: peer_ip,
                peer_name: peer_name,
                peer_uuid: peer_uuid,
                is_presenter: is_presenter,
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

            const isPresenter = peer_token
                ? is_presenter
                : await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);

            const peer = room.getPeer(socket.id);

            peer.updatePeerInfo({ type: 'presenter', status: isPresenter });

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

            if ((hostCfg.protected || hostCfg.user_auth) && isPresenter && !hostCfg.users_from_db) {
                const roomAllowedForUser = isRoomAllowedForUser('[Join]', peer_name, room.id);
                if (!roomAllowedForUser) {
                    return cb('notAllowed');
                }
            }

            // SCENARIO: Notify when the first user join room and is awaiting assistance...
            if (room.getPeersCount() === 1) {
                nodemailer.sendEmailAlert('join', {
                    room_id: room.id,
                    peer_name: peer_name,
                    domain: socket.handshake.headers.host.split(':')[0],
                    os: os_name ? `${os_name} ${os_version}` : '',
                    browser: browser_name ? `${browser_name} ${browser_version}` : '',
                }); // config.email.alert: true
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
                const getRouterRtpCapabilities = room.getRtpCapabilities();

                //log.debug('Get RouterRtpCapabilities callback', { callback: getRouterRtpCapabilities });

                callback(getRouterRtpCapabilities);
            } catch (err) {
                log.error('Get RouterRtpCapabilities error', err);
                callback({
                    error: err.message,
                });
            }
        });

        socket.on('createWebRtcTransport', async (_, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            log.debug('Create WebRtc transport', getPeerName(room));

            try {
                const createWebRtcTransport = await room.createWebRtcTransport(socket.id);

                //log.debug('Create WebRtc transport callback', { callback: createWebRtcTransport });

                callback(createWebRtcTransport);
            } catch (err) {
                log.error('Create WebRtc Transport error', err);
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

            const peer_name = getPeerName(room, false);

            log.debug('Connect transport', { peer_name: peer_name, transport_id: transport_id });

            try {
                const connectTransport = await room.connectPeerTransport(socket.id, transport_id, dtlsParameters);

                //log.debug('Connect transport', { callback: connectTransport });

                callback(connectTransport);
            } catch (err) {
                log.error('Connect transport error', err);
                callback({
                    error: err.message,
                });
            }
        });

        socket.on('restartIce', async ({ transport_id }, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            const peer = room.getPeer(socket.id);

            const peer_name = getPeerName(room, false);

            log.debug('Restart ICE', { peer_name: peer_name, transport_id: transport_id });

            try {
                const transport = peer.getTransport(transport_id);

                if (!transport) {
                    throw new Error(`Restart ICE, transport with id "${transport_id}" not found`);
                }

                const iceParameters = await transport.restartIce();

                log.debug('Restart ICE callback', { callback: iceParameters });

                callback(iceParameters);
            } catch (err) {
                log.error('Restart ICE error', err);
                callback({
                    error: err.message,
                });
            }
        });

        socket.on('produce', async ({ producerTransportId, kind, appData, rtpParameters }, callback, errback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            const peer_name = getPeerName(room, false);

            // peer_info.audio OR video ON
            const data = {
                room_id: room.id,
                peer_name: peer_name,
                peer_id: socket.id,
                kind: kind,
                type: appData.mediaType,
                status: true,
            };

            const peer = room.getPeer(socket.id);

            peer.updatePeerInfo(data);

            try {
                const producer_id = await room.produce(
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

                // add & monitor producer audio level and active speaker
                if (kind === 'audio') {
                    room.addProducerToAudioLevelObserver({ producerId: producer_id });
                    room.addProducerToActiveSpeakerObserver({ producerId: producer_id });
                }

                //log.debug('Producer transport callback', { callback: producer_id });

                callback({
                    producer_id,
                });
            } catch (err) {
                log.error('Producer transport error', err);
                callback({
                    error: err.message,
                });
            }
        });

        socket.on('consume', async ({ consumerTransportId, producerId, rtpCapabilities }, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            const peer_name = getPeerName(room, false);

            try {
                const params = await room.consume(socket.id, consumerTransportId, producerId, rtpCapabilities);

                log.debug('Consuming', {
                    peer_name: peer_name,
                    producer_id: producerId,
                    consumer_id: params ? params.id : undefined,
                });

                //log.debug('Consumer transport callback', { callback: params });

                callback(params);
            } catch (err) {
                log.error('Consumer transport error', err);
                callback({
                    error: err.message,
                });
            }
        });

        socket.on('producerClosed', (data) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peer = room.getPeer(socket.id);

            peer.updatePeerInfo(data); // peer_info.audio OR video OFF

            room.closeProducer(socket.id, data.producer_id);
        });

        socket.on('pauseProducer', async ({ producer_id }, callback) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peer_name = getPeerName(room, false);

            const peer = room.getPeer(socket.id);

            if (!peer) {
                return callback({
                    error: `peer with ID: ${socket.id} for producer with id "${producer_id}" not found`,
                });
            }

            const producer = peer.getProducer(producer_id);

            if (!producer) {
                return callback({ error: `producer with id "${producer_id}" not found` });
            }

            try {
                await producer.pause();
            } catch (error) {
                return callback({ error: error.message });
            }

            log.debug('Producer paused', { peer_name: peer_name, producer_id: producer_id });

            callback('successfully');
        });

        socket.on('resumeProducer', async ({ producer_id }, callback) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peer_name = getPeerName(room, false);

            const peer = room.getPeer(socket.id);

            if (!peer) {
                return callback({
                    error: `peer with ID: "${socket.id}" for producer with id "${producer_id}" not found`,
                });
            }

            const producer = peer.getProducer(producer_id);

            if (!producer) {
                return callback({ error: `producer with id "${producer_id}" not found` });
            }

            try {
                await producer.resume();
            } catch (error) {
                return callback({ error: error.message });
            }

            log.debug('Producer resumed', { peer_name: peer_name, producer_id: producer_id });

            callback('successfully');
        });

        socket.on('resumeConsumer', async ({ consumer_id }, callback) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peer_name = getPeerName(room, false);

            const peer = room.getPeer(socket.id);

            if (!peer) {
                return callback({
                    error: `peer with ID: "${socket.id}" for consumer with id "${consumer_id}" not found`,
                });
            }

            const consumer = peer.getConsumer(consumer_id);

            if (!consumer) {
                return callback({ error: `consumer with id "${consumer_id}" not found` });
            }

            try {
                await consumer.resume();
            } catch (error) {
                return callback({ error: error.message });
            }

            log.debug('Consumer resumed', { peer_name: peer_name, consumer_id: consumer_id });

            callback('successfully');
        });

        socket.on('getProducers', () => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            log.debug('Get producers', getPeerName(room));

            // send all the current producer to newly joined member
            const producerList = room.getProducerListForPeer();

            socket.emit('newProducers', producerList);
        });

        socket.on('getPeerCounts', async ({}, callback) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peerCounts = room.getPeersCount();

            log.debug('Peer counts', { peerCounts: peerCounts });

            callback({ peerCounts: peerCounts });
        });

        socket.on('cmd', async (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            log.debug('cmd', data);

            const room = roomList.get(socket.room_id);

            switch (data.type) {
                case 'privacy':
                    const peer = room.getPeer(socket.id);
                    peer.updatePeerInfo({ type: data.type, status: data.active });
                    break;
                case 'ejectAll':
                    const { peer_name, peer_uuid } = data;
                    const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);
                    if (!isPresenter) return;
                    break;
                default:
                    break;
                //...
            }

            data.broadcast ? room.broadCast(socket.id, 'cmd', data) : room.sendTo(data.peer_id, 'cmd', data);
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
                case 'isBanned':
                    log.info('The user has been banned from the room due to spamming messages', data);
                    room.addBannedPeer(data.peer_uuid);
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

            const presenterActions = [
                'mute',
                'unmute',
                'hide',
                'unhide',
                'stop',
                'start',
                'eject',
                'ban',
                'geoLocation',
            ];

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

            if (data.action === 'ban') room.addBannedPeer(data.to_peer_uuid);

            data.broadcast
                ? room.broadCast(data.peer_id, 'peerAction', data)
                : room.sendTo(data.peer_id, 'peerAction', data);
        });

        socket.on('updatePeerInfo', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            const peer = room.getPeer(socket.id);

            if (!peer) return;

            peer.updatePeerInfo(data);

            if (data.broadcast) {
                log.debug('updatePeerInfo broadcast data');
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

        socket.on('getRoomInfo', async (_, cb) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            log.debug('Send Room Info to', getPeerName(room));

            cb(room.toJson());
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

        socket.on('receiveFileAbort', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            roomList.get(socket.room_id).broadCast(socket.id, 'receiveFileAbort', data);
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

            // const objLength = bytesToSize(Object.keys(data).length);

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

            room.broadCast(socket.id, 'recordingAction', data);
        });

        socket.on('refreshParticipantsCount', () => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peerCounts = room.getPeers().size;

            const data = {
                room_id: socket.room_id,
                peer_counts: peerCounts,
            };
            log.debug('Refresh Participants count', data);
            room.broadCast(socket.id, 'refreshParticipantsCount', data);
        });

        socket.on('message', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            // check if the message coming from real peer
            const realPeer = isRealPeer(data.peer_name, socket.id, socket.room_id);

            if (!realPeer) {
                const peer_name = getPeerName(room, false);
                log.debug('Fake message detected', {
                    realFrom: peer_name,
                    fakeFrom: data.peer_name,
                    msg: data.peer_msg,
                });
                return;
            }

            log.info('message', data);

            data.to_peer_id == 'all'
                ? room.broadCast(socket.id, 'message', data)
                : room.sendTo(data.to_peer_id, 'message', data);
        });

        socket.on('getChatGPT', async ({ time, room, name, prompt, context }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            if (!config.chatGPT.enabled) return cb({ message: 'ChatGPT seems disabled, try later!' });
            // https://platform.openai.com/docs/api-reference/completions/create
            try {
                // Add the prompt to the context
                context.push({ role: 'user', content: prompt });
                // Call OpenAI's API to generate response
                const completion = await chatGPT.chat.completions.create({
                    model: config.chatGPT.model || 'gpt-3.5-turbo',
                    messages: context,
                    max_tokens: config.chatGPT.max_tokens,
                    temperature: config.chatGPT.temperature,
                });
                // Extract message from completion
                const message = completion.choices[0].message.content.trim();
                // Add response to context
                context.push({ role: 'assistant', content: message });
                // Log conversation details
                log.info('ChatGPT', {
                    time: time,
                    room: room,
                    name: name,
                    context: context,
                });
                // Callback response to client
                cb({ message: message, context: context });
            } catch (error) {
                if (error.name === 'APIError') {
                    log.error('ChatGPT', {
                        name: error.name,
                        status: error.status,
                        message: error.message,
                        code: error.code,
                        type: error.type,
                    });
                    cb({ message: error.message });
                } else {
                    // Non-API error
                    log.error('ChatGPT', error);
                    cb({ message: error.message });
                }
            }
        });

        // https://docs.heygen.com/reference/overview-copy

        socket.on('getAvatarList', async ({}, cb) => {
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });
            try {
                const response = await axios.get(`${config.videoAI.basePath}/v1/avatar.list`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Key': config.videoAI.apiKey,
                    },
                });

                const data = { response: response.data.data };

                //log.debug('getAvatarList', data);

                cb(data);
            } catch (error) {
                log.error('getAvatarList', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('getVoiceList', async ({}, cb) => {
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });
            try {
                const response = await axios.get(`${config.videoAI.basePath}/v1/voice.list`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Key': config.videoAI.apiKey,
                    },
                });

                const data = { response: response.data.data };

                //log.debug('getVoiceList', data);

                cb(data);
            } catch (error) {
                log.error('getVoiceList', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('streamingNew', async ({ quality, avatar_name, voice_id }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });
            try {
                const response = await axios.post(
                    `${config.videoAI.basePath}/v1/streaming.new`,
                    {
                        quality,
                        avatar_name,
                        voice: {
                            voice_id: voice_id,
                        },
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config.videoAI.apiKey,
                        },
                    },
                );

                log.warn('STREAMING NEW', response);

                const data = { response: response.data };

                log.debug('streamingNew', data);

                cb(data);
            } catch (error) {
                log.error('streamingNew', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('streamingStart', async ({ session_id, sdp }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });

            try {
                const response = await axios.post(
                    `${config.videoAI.basePath}/v1/streaming.start`,
                    { session_id, sdp },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config.videoAI.apiKey,
                        },
                    },
                );

                const data = { response: response.data.data };

                log.debug('startSessionAi', data);

                cb(data);
            } catch (error) {
                log.error('streamingStart', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('streamingICE', async ({ session_id, candidate }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });

            try {
                const response = await axios.post(
                    `${config.videoAI.basePath}/v1/streaming.ice`,
                    { session_id, candidate },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config.videoAI.apiKey,
                        },
                    },
                );

                const data = { response: response.data };

                log.debug('streamingICE', data);

                cb(data);
            } catch (error) {
                log.error('streamingICE', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('streamingTask', async ({ session_id, text }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });
            try {
                const response = await axios.post(
                    `${config.videoAI.basePath}/v1/streaming.task`,
                    {
                        session_id,
                        text,
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config.videoAI.apiKey,
                        },
                    },
                );

                const data = { response: response.data };

                log.debug('streamingTask', data);

                cb(data);
            } catch (error) {
                log.error('streamingTask', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('talkToOpenAI', async ({ text, context }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });
            try {
                const systemLimit = config.videoAI.systemLimit;
                const arr = {
                    messages: [...context, { role: 'system', content: systemLimit }, { role: 'user', content: text }],
                    model: 'gpt-3.5-turbo',
                };
                const chatCompletion = await chatGPT.chat.completions.create(arr);
                const chatText = chatCompletion.choices[0].message.content;
                context.push({ role: 'system', content: chatText });
                context.push({ role: 'assistant', content: chatText });

                const data = { response: chatText, context: context };

                log.debug('talkToOpenAI', data);

                cb(data);
            } catch (error) {
                log.error('talkToOpenAI', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('streamingStop', async ({ session_id }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });
            try {
                const response = await axios.post(
                    `${config.videoAI.basePath}/v1/streaming.stop`,
                    {
                        session_id,
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config.videoAI.apiKey,
                        },
                    },
                );

                const data = { response: response.data };

                log.debug('streamingStop', data);

                cb(data);
            } catch (error) {
                log.error('streamingStop', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('getRTMP', async ({}, cb) => {
            if (!roomList.has(socket.room_id)) return;
            const room = roomList.get(socket.room_id);
            const rtmpFiles = await room.getRTMP(rtmpDir);
            cb(rtmpFiles);
        });

        socket.on('startRTMP', async (dataObject, cb) => {
            if (!roomList.has(socket.room_id)) return;

            if (rtmpCfg && rtmpFileStreamsCount >= rtmpCfg.maxStreams) {
                log.warn('RTMP max file streams reached', rtmpFileStreamsCount);
                return cb(false);
            }

            const data = checkXSS(dataObject);
            const { peer_name, peer_uuid, file } = data;
            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);
            if (!isPresenter) return cb(false);

            const room = roomList.get(socket.room_id);
            const host = config.ngrok.enabled ? 'localhost' : socket.handshake.headers.host.split(':')[0];
            const rtmp = await room.startRTMP(socket.id, room, host, 1935, `../${rtmpDir}/${file}`);

            if (rtmp !== false) rtmpFileStreamsCount++;
            log.debug('startRTMP - rtmpFileStreamsCount ---->', rtmpFileStreamsCount);

            cb(rtmp);
        });

        socket.on('stopRTMP', async () => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            rtmpFileStreamsCount--;
            log.debug('stopRTMP - rtmpFileStreamsCount ---->', rtmpFileStreamsCount);

            await room.stopRTMP();
        });

        socket.on('endOrErrorRTMP', async () => {
            if (!roomList.has(socket.room_id)) return;
            rtmpFileStreamsCount--;
            log.debug('endRTMP - rtmpFileStreamsCount ---->', rtmpFileStreamsCount);
        });

        socket.on('startRTMPfromURL', async (dataObject, cb) => {
            if (!roomList.has(socket.room_id)) return;

            if (rtmpCfg && rtmpUrlStreamsCount >= rtmpCfg.maxStreams) {
                log.warn('RTMP max Url streams reached', rtmpUrlStreamsCount);
                return cb(false);
            }

            const data = checkXSS(dataObject);
            const { peer_name, peer_uuid, inputVideoURL } = data;
            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);
            if (!isPresenter) return cb(false);

            const room = roomList.get(socket.room_id);
            const host = config.ngrok.enabled ? 'localhost' : socket.handshake.headers.host.split(':')[0];
            const rtmp = await room.startRTMPfromURL(socket.id, room, host, 1935, inputVideoURL);

            if (rtmp !== false) rtmpUrlStreamsCount++;
            log.debug('startRTMPfromURL - rtmpUrlStreamsCount ---->', rtmpUrlStreamsCount);

            cb(rtmp);
        });

        socket.on('stopRTMPfromURL', async () => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            rtmpUrlStreamsCount--;
            log.debug('stopRTMPfromURL - rtmpUrlStreamsCount ---->', rtmpUrlStreamsCount);

            await room.stopRTMPfromURL();
        });

        socket.on('endOrErrorRTMPfromURL', async () => {
            if (!roomList.has(socket.room_id)) return;
            rtmpUrlStreamsCount--;
            log.debug('endRTMPfromURL - rtmpUrlStreamsCount ---->', rtmpUrlStreamsCount);
        });

        socket.on('createPoll', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const { question, options } = data;

            const room = roomList.get(socket.room_id);

            const newPoll = {
                question: question,
                options: options,
                voters: new Map(),
            };

            const roomPolls = room.getPolls();

            roomPolls.push(newPoll);
            room.sendToAll('updatePolls', room.convertPolls(roomPolls));
            log.debug('[Poll] createPoll', roomPolls);
        });

        socket.on('vote', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            const roomPolls = room.getPolls();

            const poll = roomPolls[data.pollIndex];
            if (poll) {
                const peer_name = getPeerName(room, false) || socket.id;
                poll.voters.set(peer_name, data.option);
                room.sendToAll('updatePolls', room.convertPolls(roomPolls));
                log.debug('[Poll] vote', roomPolls);
            }
        });

        socket.on('updatePoll', () => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const roomPolls = room.getPolls();

            if (roomPolls.length > 0) {
                room.sendToAll('updatePolls', room.convertPolls(roomPolls));
                log.debug('[Poll] updatePoll', roomPolls);
            }
        });

        socket.on('editPoll', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const { index, question, options } = data;

            const room = roomList.get(socket.room_id);

            const roomPolls = room.getPolls();

            if (roomPolls[index]) {
                roomPolls[index].question = question;
                roomPolls[index].options = options;
                room.sendToAll('updatePolls', roomPolls);
                log.debug('[Poll] editPoll', roomPolls);
            }
        });

        socket.on('deletePoll', async (data) => {
            if (!roomList.has(socket.room_id)) return;

            const { index, peer_name, peer_uuid } = checkXSS(data);

            // Disable for now...
            // const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);
            // if (!isPresenter) return;

            const room = roomList.get(socket.room_id);

            const roomPolls = room.getPolls();

            if (roomPolls[index]) {
                roomPolls.splice(index, 1);
                room.sendToAll('updatePolls', roomPolls);
                log.debug('[Poll] deletePoll', roomPolls);
            }
        });

        // Room collaborative editor

        socket.on('editorChange', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            //const data = checkXSS(dataObject);
            const data = dataObject;

            const room = roomList.get(socket.room_id);

            room.broadCast(socket.id, 'editorChange', data);
        });

        socket.on('editorActions', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            log.debug('editorActions', data);

            room.broadCast(socket.id, 'editorActions', data);
        });

        socket.on('editorUpdate', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            //const data = checkXSS(dataObject);
            const data = dataObject;

            const room = roomList.get(socket.room_id);

            room.broadCast(socket.id, 'editorUpdate', data);
        });

        socket.on('disconnect', async () => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peer = room.getPeer(socket.id);

            const { peer_name, peer_uuid } = peer || {};

            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);

            log.debug('[Disconnect] - peer name', peer_name);

            room.removePeer(socket.id);

            if (room.getPeers().size === 0) {
                //
                stopRTMPActiveStreams(isPresenter, room);

                roomList.delete(socket.room_id);

                delete presenters[socket.room_id];

                log.info('[Disconnect] - Last peer - current presenters grouped by roomId', presenters);

                const activeRooms = getActiveRooms();

                log.info('[Disconnect] - Last peer - current active rooms', activeRooms);

                const activeStreams = getRTMPActiveStreams();

                log.info('[Disconnect] - Last peer - current active RTMP streams', activeStreams);
            }

            room.broadCast(socket.id, 'removeMe', removeMeData(room, peer_name, isPresenter));

            if (isPresenter) removeIP(socket);

            socket.room_id = null;
        });

        socket.on('exitRoom', async (_, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({
                    error: 'Not currently in a room',
                });
            }

            const room = roomList.get(socket.room_id);

            const peer = room.getPeer(socket.id);

            const { peer_name, peer_uuid } = peer || {};

            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);

            log.debug('Exit room', peer_name);

            room.removePeer(socket.id);

            room.broadCast(socket.id, 'removeMe', removeMeData(room, peer_name, isPresenter));

            if (room.getPeers().size === 0) {
                //
                stopRTMPActiveStreams(isPresenter, room);

                roomList.delete(socket.room_id);

                delete presenters[socket.room_id];

                log.info('[REMOVE ME] - Last peer - current presenters grouped by roomId', presenters);

                const activeRooms = getActiveRooms();

                log.info('[REMOVE ME] - Last peer - current active rooms', activeRooms);

                const activeStreams = getRTMPActiveStreams();

                log.info('[REMOVE ME] - Last peer - current active RTMP streams', activeStreams);
            }

            socket.room_id = null;

            if (isPresenter) removeIP(socket);

            callback('Successfully exited room');
        });

        // common
        function getPeerName(room, json = true) {
            try {
                const DEFAULT_PEER_NAME = 'undefined';
                const peer = room.getPeer(socket.id);
                const peerName = peer.peer_name || DEFAULT_PEER_NAME;
                if (json) {
                    return { peer_name: peerName };
                }
                return peerName;
            } catch (err) {
                log.error('getPeerName', err);
                return json ? { peer_name: DEFAULT_PEER_NAME } : DEFAULT_PEER_NAME;
            }
        }

        function isRealPeer(name, id, roomId) {
            if (!roomList.has(socket.room_id)) return false;

            const room = roomList.get(roomId);

            const peer = room.getPeer(id);

            if (!peer) return false;

            const { peer_name } = peer;

            return peer_name == name;
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
            const data = {
                room_id: roomId,
                peer_id: socket.id,
                peer_name: peerName,
                peer_counts: peerCounts,
                isPresenter: isPresenter,
            };
            log.debug('[REMOVE ME DATA]', data);
            return data;
        }
    });

    function generateRTMPUrl(baseURL, streamPath, secretKey, expirationHours = 4) {
        const currentTime = Math.floor(Date.now() / 1000);
        const expirationTime = currentTime + expirationHours * 3600;
        const hashValue = crypto.MD5(`${streamPath}-${expirationTime}-${secretKey}`).toString();
        const rtmpUrl = `${baseURL}${streamPath}?sign=${expirationTime}-${hashValue}`;

        log.debug('generateRTMPUrl', {
            currentTime,
            expirationTime,
            hashValue,
            rtmpUrl,
        });

        return rtmpUrl;
    }

    function getRTMPActiveStreams() {
        return {
            rtmpStreams: Object.keys(streams).length,
            rtmpFileStreamsCount,
            rtmpUrlStreamsCount,
        };
    }

    function stopRTMPActiveStreams(isPresenter, room) {
        if (isPresenter) {
            if (room.isRtmpFileStreamerActive()) {
                room.stopRTMP();
                rtmpFileStreamsCount--;
                log.info('[REMOVE ME] - Stop RTMP Stream From FIle', rtmpFileStreamsCount);
            }
            if (room.isRtmpUrlStreamerActive()) {
                room.stopRTMPfromURL();
                rtmpUrlStreamsCount--;
                log.info('[REMOVE ME] - Stop RTMP Stream From URL', rtmpUrlStreamsCount);
            }
        }
    }

    function bytesToSize(bytes) {
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes == 0) return '0 Byte';
        const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
        return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
    }

    function clone(value) {
        if (value === undefined) return undefined;
        if (Number.isNaN(value)) return NaN;
        if (typeof structuredClone === 'function') return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    }

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

    async function isAuthPeer(username, password) {
        if (hostCfg.users_from_db && hostCfg.users_api_endpoint) {
            try {
                const response = await axios.post(hostCfg.users_api_endpoint, {
                    email: username,
                    password: password,
                    api_secret_key: hostCfg.users_api_secret_key,
                });
                return response.data && response.data.message === true;
            } catch (error) {
                log.error('AXIOS isAuthPeer error', error.message);
                return false;
            }
        } else {
            return (
                hostCfg.users && hostCfg.users.some((user) => user.username === username && user.password === password)
            );
        }
    }

    async function isValidToken(token) {
        return new Promise((resolve, reject) => {
            jwt.verify(token, jwtCfg.JWT_KEY, (err, decoded) => {
                if (err) {
                    // Token is invalid
                    resolve(false);
                } else {
                    // Token is valid
                    resolve(true);
                }
            });
        });
    }

    function encodeToken(token) {
        if (!token) return '';

        const { username = 'username', password = 'password', presenter = false, expire } = token;

        const expireValue = expire || jwtCfg.JWT_EXP;

        // Constructing payload
        const payload = {
            username: String(username),
            password: String(password),
            presenter: String(presenter),
        };

        // Encrypt payload using AES encryption
        const payloadString = JSON.stringify(payload);
        const encryptedPayload = CryptoJS.AES.encrypt(payloadString, jwtCfg.JWT_KEY).toString();

        // Constructing JWT token
        const jwtToken = jwt.sign({ data: encryptedPayload }, jwtCfg.JWT_KEY, { expiresIn: expireValue });

        return jwtToken;
    }

    function decodeToken(jwtToken) {
        if (!jwtToken) return null;

        // Verify and decode the JWT token
        const decodedToken = jwt.verify(jwtToken, jwtCfg.JWT_KEY);
        if (!decodedToken || !decodedToken.data) {
            throw new Error('Invalid token');
        }

        // Decrypt the payload using AES decryption
        const decryptedPayload = CryptoJS.AES.decrypt(decodedToken.data, jwtCfg.JWT_KEY).toString(CryptoJS.enc.Utf8);

        // Parse the decrypted payload as JSON
        const payload = JSON.parse(decryptedPayload);

        return payload;
    }

    function getActiveRooms() {
        const roomIds = Array.from(roomList.keys());
        const roomPeersArray = roomIds.map((roomId) => {
            const room = roomList.get(roomId);
            const peerCount = (room && room.getPeers().size) || 0;
            const broadcasting = (room && room.isBroadcasting()) || false;
            return {
                room: roomId,
                broadcasting: broadcasting,
                peers: peerCount,
            };
        });
        return roomPeersArray;
    }

    function isAllowedRoomAccess(logMessage, req, hostCfg, authHost, roomList, roomId) {
        const OIDCUserAuthenticated = OIDC.enabled && req.oidc.isAuthenticated();
        const hostUserAuthenticated = hostCfg.protected && hostCfg.authenticated;
        const roomActive = authHost.isRoomActive();
        const roomExist = roomList.has(roomId);
        const roomCount = roomList.size;

        const allowRoomAccess =
            (!hostCfg.protected && !OIDC.enabled) || // No host protection and OIDC mode enabled (default)
            OIDCUserAuthenticated || // User authenticated via OIDC
            hostUserAuthenticated || // User authenticated via Login
            ((OIDCUserAuthenticated || hostUserAuthenticated) && roomCount === 0) || // User authenticated joins the first room
            roomExist; // User Or Guest join an existing Room

        log.debug(logMessage, {
            OIDCUserEnabled: OIDC.enabled,
            OIDCUserAuthenticated: OIDCUserAuthenticated,
            hostUserAuthenticated: hostUserAuthenticated,
            hostProtected: hostCfg.protected,
            hostAuthenticated: hostCfg.authenticated,
            roomActive: roomActive,
            roomExist: roomExist,
            roomCount: roomCount,
            roomId: roomId,
            allowRoomAccess: allowRoomAccess,
        });

        return allowRoomAccess;
    }

    function isRoomAllowedForUser(message, username, room) {
        const logData = { message, username, room };

        log.debug('isRoomAllowedForUser ------>', logData);

        const isOIDCEnabled = config.oidc && config.oidc.enabled;

        if (hostCfg.protected || hostCfg.user_auth) {
            const isInPresenterLists = config.presenters.list.includes(username);

            if (isInPresenterLists) {
                log.debug('isRoomAllowedForUser - user in presenters list room allowed', room);
                return true;
            }

            const user = hostCfg.users.find((user) => user.displayname === username || user.username === username);

            if (!isOIDCEnabled && !user) {
                log.debug('isRoomAllowedForUser - user not found', username);
                return false;
            }

            if (
                isOIDCEnabled ||
                !user.allowed_rooms ||
                (user.allowed_rooms && (user.allowed_rooms.includes('*') || user.allowed_rooms.includes(room)))
            ) {
                log.debug('isRoomAllowedForUser - user room allowed', room);
                return true;
            }

            log.debug('isRoomAllowedForUser - user room not allowed', room);
            return false;
        }

        log.debug('isRoomAllowedForUser - No host protected or user_auth enabled, user room allowed', room);
        return true;
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
        return req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'] || req.socket.remoteAddress || req.ip;
    }

    function getIpSocket(socket) {
        return (
            socket.handshake.headers['x-forwarded-for'] ||
            socket.handshake.headers['X-Forwarded-For'] ||
            socket.handshake.address
        );
    }

    function allowedIP(ip) {
        const authorizedIPs = authHost.getAuthorizedIPs();
        const authorizedIP = authHost.isAuthorizedIP(ip);
        const isRoomActive = authHost.isRoomActive();
        log.info('Allowed IPs', {
            ip: ip,
            authorizedIP: authorizedIP,
            authorizedIPs: authorizedIPs,
            isRoomActive: isRoomActive,
        });
        return authHost != null && authorizedIP;
    }

    function removeIP(socket) {
        if (hostCfg.protected) {
            const ip = getIpSocket(socket);
            if (ip && allowedIP(ip)) {
                authHost.deleteIP(ip);
                hostCfg.authenticated = false;
                log.info('Remove IP from auth', {
                    ip: ip,
                    authorizedIps: authHost.getAuthorizedIPs(),
                    roomActive: authHost.isRoomActive(),
                });
            }
        }
    }
}
