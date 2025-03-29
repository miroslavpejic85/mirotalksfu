'use strict';

/*
███████ ███████ ██████  ██    ██ ███████ ██████  
██      ██      ██   ██ ██    ██ ██      ██   ██ 
███████ █████   ██████  ██    ██ █████   ██████  
     ██ ██      ██   ██  ██  ██  ██      ██   ██ 
███████ ███████ ██   ██   ████   ███████ ██   ██                                           

prod dependencies: {
    @mattermost/client      : https://www.npmjs.com/package/@mattermost/client
    @ngrok/ngrok            : https://www.npmjs.com/package/@ngrok/ngrok
    @sentry/node            : https://www.npmjs.com/package/@sentry/node
    axios                   : https://www.npmjs.com/package/axios
    chokidar                : https://www.npmjs.com/package/chokidar
    colors                  : https://www.npmjs.com/package/colors
    compression             : https://www.npmjs.com/package/compression
    cors                    : https://www.npmjs.com/package/cors
    crypto-js               : https://www.npmjs.com/package/crypto-js
    discord.js              : https://www.npmjs.com/package/discord.js
    dompurify               : https://www.npmjs.com/package/dompurify
    express                 : https://www.npmjs.com/package/express
    express-openid-connect  : https://www.npmjs.com/package/express-openid-connect
    fluent-ffmpeg           : https://www.npmjs.com/package/fluent-ffmpeg
    he                      : https://www.npmjs.com/package/he
    helmet                  : https://www.npmjs.com/package/helmet
    httpolyglot             : https://www.npmjs.com/package/httpolyglot
    js-yaml                 : https://www.npmjs.com/package/js-yaml
    jsdom                   : https://www.npmjs.com/package/jsdom
    jsonwebtoken            : https://www.npmjs.com/package/jsonwebtoken
    mediasoup               : https://www.npmjs.com/package/mediasoup
    mediasoup-client        : https://www.npmjs.com/package/mediasoup-client
    nodemailer              : https://www.npmjs.com/package/nodemailer
    openai                  : https://www.npmjs.com/package/openai
    qs                      : https://www.npmjs.com/package/qs
    sanitize-filename       : https://www.npmjs.com/package/sanitize-filename
    socket.io               : https://www.npmjs.com/package/socket.io
    swagger-ui-express      : https://www.npmjs.com/package/swagger-ui-express
    uuid                    : https://www.npmjs.com/package/uuid
}

dev dependencies: {
    @babel/core             : https://www.npmjs.com/package/@babel/core
    @babel/preset-env       : https://www.npmjs.com/package/@babel/preset-env
    babel-loader            : https://www.npmjs.com/package/babel-loader
    mocha                   : https://www.npmjs.com/package/mocha
    node-fetch              : https://www.npmjs.com/package/node-fetch
    nodemon                 : https://www.npmjs.com/package/nodemon
    prettier                : https://www.npmjs.com/package/prettier
    proxyquire              : https://www.npmjs.com/package/proxyquire
    should                  : https://www.npmjs.com/package/should
    sinon                   : https://www.npmjs.com/package/sinon
    webpack                 : https://www.npmjs.com/package/webpack
    webpack-cli             : https://www.npmjs.com/package/webpack-cli
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
 * @version 1.8.02
 *
 */

const express = require('express');
const { auth, requiresAuth } = require('express-openid-connect');
const cors = require('cors');
const compression = require('compression');
const socketIo = require('socket.io');
const httpolyglot = require('httpolyglot');
const mediasoup = require('mediasoup');
const mediasoupClient = require('mediasoup-client');
const http = require('http');
const path = require('path');
const axios = require('axios');
const ngrok = require('@ngrok/ngrok');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const sanitizeFilename = require('sanitize-filename');
const helmet = require('helmet');
const config = require('./config');
const checkXSS = require('./XSS');
const Host = require('./Host');
const Room = require('./Room');
const Peer = require('./Peer');
const ServerApi = require('./ServerApi');
const Logger = require('./Logger');
const Validator = require('./Validator');
const HtmlInjector = require('./HtmlInjector');
const log = new Logger('Server');
const yaml = require('js-yaml');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = yaml.load(fs.readFileSync(path.join(__dirname, '/../api/swagger.yaml'), 'utf8'));
const Sentry = require('@sentry/node');
const Discord = require('./Discord');
const Mattermost = require('./Mattermost');
const restrictAccessByIP = require('./middleware/IpWhitelist');
const packageJson = require('../../package.json');

// Incoming Stream to RTPM
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto-js');
const RtmpStreamer = require('./RtmpStreamer.js'); // Import the RtmpStreamer class
const rtmpCfg = config?.media?.rtmp;
const rtmpDir = rtmpCfg?.dir || 'rtmp';

// File and Url Rtmp streams count
let rtmpFileStreamsCount = 0;
let rtmpUrlStreamsCount = 0;

// Email alerts and notifications
const nodemailer = require('./lib/nodemailer');

// Slack API
const CryptoJS = require('crypto-js');
const qS = require('qs');
const slackEnabled = config?.integrations?.slack?.enabled || false;
const slackSigningSecret = config?.integrations?.slack?.signingSecret || '';

const app = express();

const options = {
    cert: fs.readFileSync(path.join(__dirname, config?.server?.ssl.cert || '../ssl/cert.pem'), 'utf-8'),
    key: fs.readFileSync(path.join(__dirname, config?.server?.ssl.key || '../ssl/key.pem'), 'utf-8'),
};

const corsOptions = {
    origin: config.server?.cors?.origin || '*',
    methods: config.server?.cors?.methods || ['GET', 'POST'],
};

const server = httpolyglot.createServer(options, app);

const io = socketIo(server, {
    maxHttpBufferSize: 1e7,
    transports: ['websocket'],
    cors: corsOptions,
});

const host = config?.server?.hostUrl || `http://localhost:${config?.server?.listen?.port || 3010}`;
const trustProxy = Boolean(config?.server?.trustProxy);

const jwtCfg = {
    JWT_KEY: config?.security?.jwt?.key || 'mirotalksfu_jwt_secret',
    JWT_EXP: config?.security?.jwt?.exp || '1h',
};

const hostCfg = {
    protected: config?.security?.host?.protected,
    authenticated: !config?.security?.host?.protected,
    user_auth: config?.security?.host?.user_auth,
    users: config?.security?.host?.users,
    users_from_db: config?.security?.host?.users_from_db,
    users_api_room_allowed: config?.security?.host?.users_api_room_allowed,
    users_api_rooms_allowed: config?.security?.host?.users_api_rooms_allowed,
    users_api_endpoint: config?.security?.host?.users_api_endpoint,
    users_api_secret_key: config?.security?.host?.users_api_secret_key,
    api_room_exists: config?.security?.host?.api_room_exists,
    presenters: config?.security?.host?.presenters,
};

const restApi = {
    basePath: '/api/v1', // api endpoint path
    docs: host + '/api/v1/docs', // api docs
    allowed: config.api?.allowed || {},
};

// Sentry monitoring
const sentryEnabled = config.integrations?.sentry?.enabled || false;
const sentryDSN = config.integrations.sentry.DSN;
const sentryTracesSampleRate = config.integrations.sentry.tracesSampleRate;
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

// Handle WebHook
const webhook = {
    enabled: config?.webhook?.enabled || false,
    url: config?.webhook?.url || 'http://localhost:8888/webhook-endpoint',
};

// Discord Bot
const { enabled, commands, token } = config?.integrations?.discord || {};

if (enabled && commands.length > 0 && token) {
    const discordBot = new Discord(token, commands);
    log.info('Discord bot is enabled and starting');
}

// Stats
const defaultStats = {
    enabled: true,
    src: 'https://stats.mirotalk.com/script.js',
    id: '41d26670-f275-45bb-af82-3ce91fe57756',
};

// OpenAI/ChatGPT
let chatGPT;
if (config?.integrations?.chatGPT?.enabled) {
    if (config?.integrations?.chatGPT?.apiKey) {
        const { OpenAI } = require('openai');
        const configuration = {
            basePath: config?.integrations?.chatGPT?.basePath,
            apiKey: config?.integrations?.chatGPT?.apiKey,
        };
        chatGPT = new OpenAI(configuration);
    } else {
        log.warn('ChatGPT seems enabled, but you missing the apiKey!');
    }
}

// OpenID Connect
const OIDC = config?.security?.oidc || { enabled: false };

// directory
const dir = {
    public: path.join(__dirname, '../../public'),
    rec: path.join(__dirname, '../', config?.media?.recording?.dir || 'rec', '/'),
    rtmp: path.join(__dirname, '../', config?.media?.rtmp?.dir || 'rtmp', '/'),
};

// Rec directory create and set max file size
const recMaxFileSize = config?.media?.recording?.maxFileSize || 1 * 1024 * 1024 * 1024; // 1GB default
const serverRecordingEnabled = config?.media?.recording?.enabled || false;
if (serverRecordingEnabled) {
    log.debug('Server Recording enabled creating dir', dir.rtmp);
    if (!fs.existsSync(dir.rec)) {
        fs.mkdirSync(dir.rec, { recursive: true });
    }
}

// Rtmp directory create
const rtmpEnabled = rtmpCfg && rtmpCfg.enabled;
if (rtmpEnabled) {
    log.debug('RTMP enabled creating dir', dir.rtmp);
    if (!fs.existsSync(dir.rtmp)) {
        fs.mkdirSync(dir.rtmp, { recursive: true });
    }
}

// html views
const views = {
    html: path.join(__dirname, '../../public/views'),
    about: path.join(__dirname, '../../', 'public/views/about.html'),
    landing: path.join(__dirname, '../../', 'public/views/landing.html'),
    login: path.join(__dirname, '../../', 'public/views/login.html'),
    newRoom: path.join(__dirname, '../../', 'public/views/newroom.html'),
    notFound: path.join(__dirname, '../../', 'public/views/404.html'),
    permission: path.join(__dirname, '../../', 'public/views/permission.html'),
    privacy: path.join(__dirname, '../../', 'public/views/privacy.html'),
    room: path.join(__dirname, '../../', 'public/views/Room.html'),
    rtmpStreamer: path.join(__dirname, '../../', 'public/views/RtmpStreamer.html'),
    whoAreYou: path.join(__dirname, '../../', 'public/views/whoAreYou.html'),
};

const filesPath = [views.landing, views.newRoom, views.room, views.login];

const htmlInjector = new HtmlInjector(filesPath, config.ui.brand);

const authHost = new Host(); // Authenticated IP by Login

const roomList = new Map(); // All Rooms

const presenters = {}; // Collect presenters grp by roomId

const streams = {}; // Collect all rtmp streams

const webRtcServerActive = config.mediasoup.webRtcServerActive;

// ip (server local IPv4)
const IP = webRtcServerActive
    ? config.mediasoup.webRtcServerOptions.listenInfos[0].ip
    : config.mediasoup.webRtcTransport.listenInfos[0].ip;

// announcedAddress (server public IPv4)
let announcedAddress = webRtcServerActive
    ? config.mediasoup.webRtcServerOptions.listenInfos[0].announcedAddress
    : config.mediasoup.webRtcTransport.listenInfos[0].announcedAddress;

// All mediasoup workers
const workers = [];
let nextMediasoupWorkerIdx = 0;

// Autodetect announcedAddress with multiple fallback services
if (!announcedAddress && IP === '0.0.0.0') {
    const detectPublicIp = async () => {
        const services = config.system?.services?.ip || [
            'http://api.ipify.org',
            'http://ipinfo.io/ip',
            'http://ifconfig.me/ip',
        ];

        for (const service of services) {
            try {
                const ip = await fetchPublicIp(service);
                if (ip) {
                    announcedAddress = ip;
                    updateAnnouncedAddress(ip);
                    startServer();
                    return;
                }
            } catch (err) {
                log.warn(`Failed to detect IP from ${service}`, err.message);
            }
        }
        throw new Error('All public IP detection services failed! Please check your network connection');
    };

    detectPublicIp().catch((err) => {
        log.error('Public IP detection failed', err.message);
        process.exit(1);
    });
} else {
    startServer();
}

function fetchPublicIp(serviceUrl) {
    return new Promise((resolve, reject) => {
        http.get(serviceUrl, (resp) => {
            if (resp.statusCode !== 200) {
                return reject(new Error(`HTTP ${resp.statusCode}`));
            }
            let data = '';
            resp.on('data', (chunk) => (data += chunk));
            resp.on('end', () => resolve(data.toString().trim()));
        }).on('error', reject);
    });
}

function updateAnnouncedAddress(ip) {
    const target = webRtcServerActive
        ? config.mediasoup.webRtcServerOptions.listenInfos
        : config.mediasoup.webRtcTransport.listenInfos;

    target.forEach((info) => {
        info.announcedAddress = ip;
    });
}

// Custom middleware function for OIDC authentication
function OIDCAuth(req, res, next) {
    if (OIDC.enabled) {
        function handleHostProtected(req) {
            if (!hostCfg.protected) return;

            const ip = authHost.getIP(req);
            hostCfg.authenticated = true;
            authHost.setAuthorizedIP(ip, true);
            // Check...
            log.debug('OIDC ------> Host protected', {
                authenticated: hostCfg.authenticated,
                authorizedIPs: authHost.getAuthorizedIPs(),
            });
        }

        if (req.oidc.isAuthenticated()) {
            log.debug('OIDC ------> User already Authenticated');
            handleHostProtected(req);
            return next();
        }

        // Apply requiresAuth() middleware conditionally
        requiresAuth()(req, res, function () {
            log.debug('OIDC ------> requiresAuth');
            // Check if user is authenticated
            if (req.oidc.isAuthenticated()) {
                log.debug('[OIDC] ------> User isAuthenticated');
                handleHostProtected(req);
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
    app.set('trust proxy', trustProxy); // Enables trust for proxy headers (e.g., X-Forwarded-For) based on the trustProxy setting
    app.use(helmet.noSniff()); // Enable content type sniffing prevention
    // Use all static files from the public folder
    app.use(
        express.static(dir.public, {
            setHeaders: (res, filePath) => {
                if (filePath.endsWith('.js')) {
                    res.setHeader('Content-Type', 'application/javascript');
                } //...
            },
        }),
    );
    app.use(cors(corsOptions));
    app.use(compression());
    app.use(express.json({ limit: '50mb' })); // Handles JSON payloads
    app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Handles URL-encoded payloads
    app.use(express.raw({ type: 'video/webm', limit: '50mb' })); // Handles raw binary data
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

    // Mattermost
    const mattermost = new Mattermost(app);

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
        if (err && (err instanceof SyntaxError || err.status === 400 || 'body' in err)) {
            log.error('Request Error', {
                header: req.headers,
                body: req.body,
                error: err.message,
            });
            return res.status(400).send({ status: 404, message: err.message }); // Bad request
        }

        // Prevent open redirect attacks by checking if the path is an external domain
        const cleanPath = req.path.replace(/^\/+/, '');
        if (/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}/.test(cleanPath)) {
            return res.status(400).send('Bad Request: Potential Open Redirect Detected');
        }

        if (req.path.endsWith('/') && req.path.length > 1) {
            let query = req.url.substring(req.path.length).replace(/\/$/, ''); // Ensure query params don't end in '/'
            return res.redirect(301, req.path.slice(0, -1) + query);
        }

        next();
    });

    // OpenID Connect - Dynamically set baseURL based on incoming host and protocol
    if (OIDC.enabled) {
        const getDynamicConfig = (host, protocol) => {
            const baseURL = `${protocol}://${host}`;

            const config = OIDC.baseUrlDynamic
                ? {
                      ...OIDC.config,
                      baseURL,
                  }
                : OIDC.config;

            log.debug('OIDC baseURL', config.baseURL);

            return config;
        };

        // Apply the authentication middleware using dynamic baseURL configuration
        app.use((req, res, next) => {
            const host = req.headers.host;
            const protocol = req.protocol === 'https' ? 'https' : 'http';
            const dynamicOIDCConfig = getDynamicConfig(host, protocol);
            try {
                auth(dynamicOIDCConfig)(req, res, next);
            } catch (err) {
                log.error('OIDC Auth Middleware Error', err);
                process.exit(1);
            }
        });
    }

    // Route to display user information
    app.get('/profile', OIDCAuth, (req, res) => {
        if (OIDC.enabled) {
            const user = { ...req.oidc.user };
            user.peer_name = {
                force: OIDC.peer_name?.force || false,
                email: OIDC.peer_name?.email || false,
                name: OIDC.peer_name?.name || false,
            };
            log.debug('OIDC get Profile', user);
            return res.json(user);
        }
        // OIDC disabled
        res.status(201).json({
            email: false,
            name: false,
            peer_name: false,
            message: 'Profile not found because OIDC is disabled',
        });
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
                });
            }
            req.logout(); // Logout user
        }
        res.redirect('/'); // Redirect to the home page after logout
    });

    // UI buttons configuration
    app.get('/config', (req, res) => {
        res.status(200).json({ message: config?.ui?.buttons || false });
    });

    // Brand configuration
    app.get('/brand', (req, res) => {
        res.status(200).json({ message: config?.ui?.brand || false });
    });

    // main page
    app.get('/', OIDCAuth, (req, res) => {
        //log.debug('/ - hostCfg ----->', hostCfg);
        if (!OIDC.enabled && hostCfg.protected) {
            const ip = getIP(req);
            if (allowedIP(ip)) {
                htmlInjector.injectHtml(views.landing, res);
                hostCfg.authenticated = true;
            } else {
                hostCfg.authenticated = false;
                res.redirect('/login');
            }
        } else {
            return htmlInjector.injectHtml(views.landing, res);
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
    app.get('/newroom', OIDCAuth, (req, res) => {
        //log.info('/newroom - hostCfg ----->', hostCfg);

        if (!OIDC.enabled && hostCfg.protected) {
            const ip = getIP(req);
            if (allowedIP(ip)) {
                res.redirect('/');
                hostCfg.authenticated = true;
            } else {
                hostCfg.authenticated = false;
                res.redirect('/login');
            }
        } else {
            htmlInjector.injectHtml(views.newRoom, res);
        }
    });

    // Check if room active (exists)
    app.post('/isRoomActive', (req, res) => {
        const { roomId } = checkXSS(req.body);

        if (roomId && (hostCfg.protected || hostCfg.user_auth)) {
            const roomActive = roomList.has(roomId);
            if (roomActive) log.debug('isRoomActive', { roomId, roomActive });
            res.status(200).json({ message: roomActive });
        } else {
            res.status(400).json({ message: 'Unauthorized' });
        }
    });

    // Handle Direct join room with params
    app.get('/join/', async (req, res) => {
        if (Object.keys(req.query).length > 0) {
            //log.debug('/join/params - hostCfg ----->', hostCfg);

            log.debug('Direct Join', req.query);

            // http://localhost:3010/join?room=test&roomPassword=0&name=mirotalksfu&audio=1&video=1&screen=0&hide=0&notify=1&duration=00:00:30
            // http://localhost:3010/join?room=test&roomPassword=0&name=mirotalksfu&audio=1&video=1&screen=0&hide=0&notify=0&token=token

            const { room, roomPassword, name, audio, video, screen, hide, notify, duration, token, isPresenter } =
                checkXSS(req.query);

            if (!room) {
                log.warn('/join/params room empty', room);
                return res.redirect('/');
            }

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
                        const roomAllowedForUser = await isRoomAllowedForUser('Direct Join with token', username, room);
                        if (!roomAllowedForUser) {
                            log.warn('Direct Room Join for this User is Unauthorized', {
                                username: username,
                                room: room,
                            });
                            return res.redirect('/whoAreYou/' + room);
                        }
                    }
                } catch (err) {
                    log.error('Direct Join JWT error', { error: err.message, token: token });
                    return hostCfg.protected || hostCfg.user_auth
                        ? htmlInjector.injectHtml(views.login, res)
                        : htmlInjector.injectHtml(views.landing, res);
                }
            } else {
                const allowRoomAccess = isAllowedRoomAccess('/join/params', req, hostCfg, roomList, room);
                const roomAllowedForUser = await isRoomAllowedForUser('Direct Join without token', name, room);

                log.debug('Direct Room Join no JWT --------------->', {
                    allowRoomAccess: allowRoomAccess,
                    roomAllowedForUser: roomAllowedForUser,
                });

                if (!allowRoomAccess && !roomAllowedForUser) {
                    log.warn('Direct Room Join Unauthorized', room);
                    return OIDC.enabled ? res.redirect('/') : res.redirect('/whoAreYou/' + room);
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
                return htmlInjector.injectHtml(views.room, res);
            } else {
                return htmlInjector.injectHtml(views.login, res);
            }
        }

        return res.redirect('/');
    });

    // join room by id
    app.get('/join/:roomId', async (req, res) => {
        //
        const { roomId } = checkXSS(req.params);

        if (!roomId) {
            log.warn('/join/:roomId empty', roomId);
            return res.redirect('/');
        }

        if (!Validator.isValidRoomName(roomId)) {
            log.warn('/join/:roomId invalid', roomId);
            return res.redirect('/');
        }

        const allowRoomAccess = isAllowedRoomAccess('/join/:roomId', req, hostCfg, roomList, roomId);

        if (allowRoomAccess) {
            // 1. Protect room access with database check
            if (!OIDC.enabled && hostCfg.protected && hostCfg.users_from_db) {
                const roomExists = await roomExistsForUser(roomId);
                log.debug('/join/:roomId exists from API endpoint', roomExists);
                return roomExists ? htmlInjector.injectHtml(views.room, res) : res.redirect('/login');
            }
            // 2. Protect room access with configuration check
            if (!OIDC.enabled && hostCfg.protected && !hostCfg.users_from_db) {
                const roomExists = hostCfg.users.some(
                    (user) => user.allowed_rooms && (user.allowed_rooms.includes(roomId) || roomList.has(roomId)),
                );
                log.debug('/join/:roomId exists from config allowed rooms', roomExists);
                return roomExists ? htmlInjector.injectHtml(views.room, res) : res.redirect('/whoAreYou/' + roomId);
            }
            htmlInjector.injectHtml(views.room, res);
        } else {
            // Who are you?
            !OIDC.enabled && hostCfg.protected ? res.redirect('/whoAreYou/' + roomId) : res.redirect('/');
        }
    });

    // not specified correctly the room id
    app.get('/join/*', (req, res) => {
        res.redirect('/');
    });

    // if not allow video/audio
    app.get('/permission', (req, res) => {
        res.sendFile(views.permission);
    });

    // privacy policy
    app.get('/privacy', (req, res) => {
        res.sendFile(views.privacy);
    });

    // mirotalk about
    app.get('/about', (req, res) => {
        res.sendFile(views.about);
    });

    // Get stats endpoint
    app.get('/stats', (req, res) => {
        const stats = config?.features?.stats || defaultStats;
        // log.debug('Send stats', stats);
        res.send(stats);
    });

    // handle who are you: Presenter or Guest
    app.get('/whoAreYou/:roomId', (req, res) => {
        res.sendFile(views.whoAreYou);
    });

    // handle login if user_auth enabled
    app.get('/login', (req, res) => {
        if (hostCfg.protected || hostCfg.user_auth) {
            return htmlInjector.injectHtml(views.login, res);
        }
        res.redirect('/');
    });

    // handle logged on host protected
    app.get('/logged', (req, res) => {
        const ip = getIP(req);
        if (allowedIP(ip)) {
            res.redirect('/');
            hostCfg.authenticated = true;
        } else {
            hostCfg.authenticated = false;
            res.redirect('/login');
        }
    });

    // ####################################################
    // AXIOS
    // ####################################################

    // handle login on host protected
    app.post('/login', async (req, res) => {
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

            const isPresenter = Boolean(
                hostCfg?.presenters?.join_first || hostCfg?.presenters?.list?.includes(username),
            );

            const token = encodeToken({ username: username, password: password, presenter: isPresenter });
            const allowedRooms = await getUserAllowedRooms(username, password);

            return res.status(200).json({ message: token, allowedRooms: allowedRooms });
        }

        if (isPeerValid) {
            log.debug('PEER LOGIN OK', { ip: ip, authorized: true });
            const isPresenter = hostCfg?.presenters?.list?.includes(username) || false;
            const token = encodeToken({ username: username, password: password, presenter: isPresenter });
            const allowedRooms = await getUserAllowedRooms(username, password);
            return res.status(200).json({ message: token, allowedRooms: allowedRooms });
        } else {
            return res.status(401).json({ message: 'unauthorized' });
        }
    });

    // ####################################################
    // KEEP RECORDING ON SERVER DIR
    // ####################################################

    app.post('/recSync', (req, res) => {
        // Store recording...
        if (serverRecordingEnabled) {
            //
            try {
                const { fileName } = checkXSS(req.query);

                if (!fileName) {
                    return res.status(400).send('Filename not provided');
                }

                // Sanitize and validate filename
                const safeFileName = sanitizeFilename(fileName);
                if (safeFileName !== fileName || !Validator.isValidRecFileNameFormat(fileName)) {
                    log.warn('[RecSync] - Invalid file name:', fileName);
                    return res.status(400).send('Invalid file name');
                }

                const parts = fileName.split('_');
                const roomId = parts[1];

                if (!roomList.has(roomId)) {
                    log.warn('[RecSync] - RoomID not exists in filename', fileName);
                    return res.status(400).send('Invalid file name');
                }

                // Ensure directory exists
                if (!fs.existsSync(dir.rec)) {
                    fs.mkdirSync(dir.rec, { recursive: true });
                }

                // Resolve and validate file path
                const filePath = path.resolve(dir.rec, fileName);
                if (!filePath.startsWith(path.resolve(dir.rec))) {
                    log.warn('[RecSync] - Attempt to save file outside allowed directory:', fileName);
                    return res.status(400).send('Invalid file path');
                }

                //Validate content type
                if (!['application/octet-stream'].includes(req.headers['content-type'])) {
                    log.warn('[RecSync] - Invalid content type:', req.headers['content-type']);
                    return res.status(400).send('Invalid content type');
                }

                // Set up write stream and handle file upload
                const writeStream = fs.createWriteStream(filePath, { flags: 'a' });
                let receivedBytes = 0;

                req.on('data', (chunk) => {
                    receivedBytes += chunk.length;
                    if (receivedBytes > recMaxFileSize) {
                        req.destroy(); // Stop receiving data
                        writeStream.destroy(); // Stop writing data
                        log.warn('[RecSync] - File size exceeds limit:', fileName);
                        return res.status(413).send('File too large');
                    }
                });

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
        log.debug('RTMP enabled', rtmpEnabled);
        res.json({ enabled: rtmpEnabled });
    });

    app.post('/initRTMP', checkRTMPApiSecret, checkMaxStreams, async (req, res) => {
        if (!rtmpCfg || !rtmpCfg.enabled) {
            return res.status(400).send('RTMP server is not enabled or missing the config');
        }

        const domainName = config?.integrations?.ngrok?.enabled
            ? 'localhost'
            : req.headers.host?.split(':')[0] || 'localhost';

        const rtmpUseNodeMediaServer = rtmpCfg.useNodeMediaServer ?? true;
        const rtmpServer = rtmpCfg.server != '' ? rtmpCfg.server : false;
        const rtmpServerAppName = rtmpCfg.appName != '' ? rtmpCfg.appName : 'live';
        const rtmpStreamKey = rtmpCfg.streamKey != '' ? rtmpCfg.streamKey : uuidv4();
        const rtmpServerSecret = rtmpCfg.secret != '' ? rtmpCfg.secret : false;
        const expirationHours = rtmpCfg.expirationHours || 4;
        const rtmpServerURL = rtmpServer ? rtmpServer : `rtmp://${domainName}:1935`;
        const rtmpServerPath = '/' + rtmpServerAppName + '/' + rtmpStreamKey;

        const rtmp = rtmpUseNodeMediaServer
            ? generateRTMPUrl(rtmpServerURL, rtmpServerPath, rtmpServerSecret, expirationHours)
            : rtmpServerURL + rtmpServerPath;

        log.info('initRTMP', {
            headers: req.headers,
            rtmpUseNodeMediaServer: rtmpUseNodeMediaServer,
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

    // Join roomId redirect to /join?room=roomId
    app.get('/:roomId', (req, res) => {
        const { roomId } = checkXSS(req.params);

        if (!roomId) {
            log.warn('/:roomId empty', roomId);
            return res.redirect('/');
        }

        log.debug('Detected roomId --> redirect to /join?room=roomId');
        res.redirect(`/join/${roomId}`);
    });

    // ####################################################
    // REST API
    // ####################################################

    app.get(restApi.basePath + '/stats', (req, res) => {
        try {
            // Check if endpoint allowed
            if (restApi.allowed && !restApi.allowed.stats) {
                return res.status(403).json({
                    success: false,
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

            const { timestamp, totalRooms, totalUsers } = api.getStats(roomList);

            res.json({
                success: true,
                timestamp,
                totalRooms,
                totalUsers,
            });

            // log.debug the output if all done
            log.debug('MiroTalk get stats - Authorized', {
                header: req.headers,
                body: req.body,
                timestamp,
                totalRooms,
                totalUsers,
            });
        } catch (error) {
            console.error('Error fetching stats', error);
            res.status(500).json({ success: false, error: 'Failed to retrieve stats.' });
        }
    });

    // request meetings list
    app.get(restApi.basePath + '/meetings', (req, res) => {
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
    app.post(restApi.basePath + '/meeting', (req, res) => {
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
    app.post(restApi.basePath + '/join', (req, res) => {
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
    app.post(restApi.basePath + '/token', (req, res) => {
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
        const safeConfig = {
            // Network & Connectivity
            network: {
                server_listen: host,
                server_tunnel: tunnel,
                trust_proxy: trustProxy,
                sfu: {
                    listenIP: IP,
                    publicIP: announcedAddress,
                    numWorker: config.mediasoup?.numWorkers,
                    rtcMinPort: config.mediasoup?.worker?.rtcMinPort,
                    rtcMaxPort: config.mediasoup?.worker?.rtcMaxPort,
                },
                ngrok_enabled: config.ngrok?.enabled ? config.ngrok : false,
            },

            // Security & Authentication
            security: {
                cors: corsOptions,
                jwtCfg: jwtCfg,
                host: hostCfg?.protected || hostCfg?.user_auth ? hostCfg : { presenters: hostCfg.presenters },
                ip_lookup: config.integrations?.IPLookup?.enabled ? config.integrations.IPLookup : false,
                oidc: OIDC?.enabled ? OIDC : false,
                middleware: {
                    IpWhitelist: config?.security?.middleware?.IpWhitelist?.enabled
                        ? config.security.middleware.IpWhitelist
                        : false,
                    //...
                },
            },

            // API & Services
            api: {
                rest_api: restApi,
                webhook: webhook.enabled ? webhook : false,
            },

            // Media Configuration
            media: {
                mediasoup: {
                    listenInfos: config.mediasoup?.webRtcTransport?.listenInfos,
                    worker_bin: mediasoup?.workerBin,
                    server_version: mediasoup?.version,
                    client_version: mediasoupClient?.version,
                },
                rtmp: rtmpCfg?.enabled ? rtmpCfg : false,
                videoAI: config.integrations?.videoAI?.enabled ? config.integrations.videoAI : false,
                server_recording: config?.media?.recording?.enabled ? config.media.recording : false,
            },

            // Communication Integrations
            integrations: {
                discord: config.integrations?.discord?.enabled ? config.integrations.discord : false,
                mattermost: config.integrations?.mattermost?.enabled ? config.integrations.mattermost : false,
                slack: slackEnabled ? config.integrations?.slack : false,
                chatGPT: config.integrations?.chatGPT?.enabled ? config.integrations.chatGPT : false,
                email_alerts: config?.integrations?.email?.alert ? config.integrations.email : false,
            },

            // UI & Branding
            ui: {
                brand: config.ui?.brand,
                buttons: config.ui?.buttons,
            },

            // Monitoring & Analytics
            monitoring: {
                sentry: sentryEnabled ? config.integrations?.sentry : false,
                stats: config.features?.stats?.enabled ? config.features.stats : false,
                system_info: config.system?.info,
            },

            // Features & Functionality
            features: {
                survey: config.features?.survey?.enabled ? config.features.survey : false,
                redirect: config.features?.redirect?.enabled ? config.features.redirect : false,
            },

            // Version Information
            versions: {
                app: packageJson?.version,
                node: process.versions.node,
            },
        };

        return safeConfig;
    }

    // ####################################################
    // NGROK
    // ####################################################

    async function ngrokStart() {
        try {
            await ngrok.authtoken(config?.integrations?.ngrok?.authToken);
            const listener = await ngrok.forward({ addr: config?.server?.listen?.port });
            const tunnelUrl = listener.url();
            log.info('Server config', getServerConfig(tunnelUrl));
        } catch (err) {
            log.warn('Ngrok Start error', err);
            await ngrok.kill();
            process.exit(1);
        }
    }

    // ####################################################
    // START SERVER
    // ####################################################

    server.listen(config?.server?.listen?.port || 3010, () => {
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

        if (config?.integrations?.ngrok?.enabled && config?.integrations?.ngrok?.authToken !== '') {
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

        const { logLevel, logTags, rtcMinPort, rtcMaxPort, disableLiburing } = config.mediasoup.worker;

        log.info('WORKERS:', numWorkers);

        for (let i = 0; i < numWorkers; i++) {
            //
            const worker = await mediasoup.createWorker({
                logLevel: logLevel,
                logTags: logTags,
                rtcMinPort: Number(rtcMinPort),
                rtcMaxPort: Number(rtcMaxPort),
                disableLiburing: Boolean(disableLiburing),
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
            if (!roomExists(socket)) {
                return cb({
                    error: 'Room does not exist',
                });
            }

            // Get peer IPv4 (::1 Its the loopback address in ipv6, equal to 127.0.0.1 in ipv4)
            const peer_ip = getIpSocket(socket);

            // Get peer Geo Location
            if (config?.integrations?.IPLookup?.enabled && peer_ip != '::1') {
                dataObject.peer_geo = await getPeerGeoLocation(peer_ip);
            }

            const data = checkXSS(dataObject);

            log.info('User joined', data);

            if (!Validator.isValidRoomName(socket.room_id)) {
                log.warn('[Join] - Invalid room name', socket.room_id);
                return cb('invalid');
            }

            const room = getRoom(socket);

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
                            log.warn('[Join] - Invalid token', peer_token);
                            return cb('unauthorized');
                        }

                        const { username, password, presenter } = checkXSS(decodeToken(peer_token));

                        const isPeerValid = await isAuthPeer(username, password);

                        if (!isPeerValid) {
                            // redirect peer to login page
                            log.warn('[Join] - Invalid peer not authenticated', isPeerValid);
                            return cb('unauthorized');
                        }

                        const is_presenter =
                            presenter === '1' ||
                            presenter === 'true' ||
                            (hostCfg?.presenters?.join_first && room?.getPeersCount() === 0);

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
                    if (!hostCfg.users_from_db) return cb('unauthorized');
                }

                if (!hostCfg.users_from_db) {
                    const roomAllowedForUser = isRoomAllowedForUser('[Join]', peer_name, room.id);
                    if (!roomAllowedForUser) {
                        log.warn('[Join] - Room not allowed for this peer', { peer_name, room_id: room.id });
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
            if (hostCfg?.presenters?.list?.includes(peer_name)) {
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
                : isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);

            const peer = room.getPeer(socket.id);

            if (!peer) {
                return cb({
                    error: 'Peer does not exist in the room',
                });
            }

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
                    log.warn('[Join] - Room not allowed for this peer', { peer_name, room_id: room.id });
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

            // handle WebHook
            if (webhook.enabled) {
                // Trigger a POST request when a user joins
                axios
                    .post(webhook.url, { event: 'join', data })
                    .then((response) => log.debug('Join event tracked:', response.data))
                    .catch((error) => log.error('Error tracking join event:', error.message));
            }

            cb(room.toJson());
        });

        socket.on('getRouterRtpCapabilities', (_, callback) => {
            if (!roomExists(socket)) {
                return callback({ error: 'Room not found' });
            }

            const { room, peer } = getRoomAndPeer(socket);

            const peerInfo = getPeerInfo(peer);

            log.debug('Get RouterRtpCapabilities', peerInfo);

            try {
                const getRouterRtpCapabilities = room.getRtpCapabilities();

                //log.debug('Get RouterRtpCapabilities callback', { callback: getRouterRtpCapabilities });

                callback(getRouterRtpCapabilities);
            } catch (err) {
                log.error('Get RouterRtpCapabilities error', {
                    error: err,
                    peerInfo,
                });
                callback({
                    error: err.message,
                });
            }
        });

        socket.on('createWebRtcTransport', async (_, callback) => {
            if (!roomExists(socket)) {
                return callback({ error: 'Room not found' });
            }

            const { room, peer } = getRoomAndPeer(socket);

            const peerInfo = getPeerInfo(peer);

            log.debug('Create WebRtc transport', peerInfo);

            try {
                const createWebRtcTransport = await room.createWebRtcTransport(socket.id);

                //log.debug('Create WebRtc transport callback', { callback: createWebRtcTransport });

                callback(createWebRtcTransport);
            } catch (err) {
                log.error('Create WebRtc Transport error', {
                    error: err,
                    peerInfo,
                });
                callback({ error: err.message });
            }
        });

        socket.on('connectTransport', async ({ transport_id, dtlsParameters }, callback) => {
            if (!roomExists(socket)) {
                return callback({ error: 'Room not found' });
            }

            const { room, peer } = getRoomAndPeer(socket);

            const peerInfo = getPeerInfo(peer);

            log.debug('Connect transport', { transport_id: transport_id, peerInfo });

            try {
                const connectTransport = await room.connectPeerTransport(socket.id, transport_id, dtlsParameters);

                //log.debug('Connect transport', { callback: connectTransport });

                callback(connectTransport);
            } catch (err) {
                log.error('Connect transport error', {
                    error: err,
                    peerInfo,
                });
                callback({ error: err.message });
            }
        });

        socket.on('restartIce', async ({ transport_id }, callback) => {
            if (!roomExists(socket)) {
                return callback({ error: 'Room not found' });
            }

            const peer = getPeer(socket);

            if (!peer) {
                return callback({ error: 'Peer not found' });
            }

            const peerInfo = getPeerInfo(peer);

            log.debug('Restart ICE', { transport_id: transport_id, peerInfo });

            try {
                const transport = peer.getTransport(transport_id);

                if (!transport) {
                    throw new Error(`Restart ICE, transport with id "${transport_id}" not found`);
                }

                const iceParameters = await transport.restartIce();

                log.debug('Restart ICE callback', { callback: iceParameters });

                callback(iceParameters);
            } catch (err) {
                log.error('Restart ICE error', {
                    error: err,
                    peerInfo,
                });
                callback({ error: err.message });
            }
        });

        socket.on('produce', async ({ producerTransportId, kind, appData, rtpParameters }, callback, errback) => {
            if (!roomExists(socket)) {
                return callback({ error: 'Room not found' });
            }

            const { room, peer } = getRoomAndPeer(socket);

            if (!peer) {
                return callback({ error: 'Peer not found' });
            }

            const peerInfo = getPeerInfo(peer);

            const data = {
                room_id: room.id,
                peer_name: peerInfo.peer_name,
                peer_id: socket.id,
                kind: kind,
                type: appData.mediaType,
                status: true,
            };

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
                    producer_id: producer_id,
                    peer_id: socket.id,
                    peerInfo: peerInfo,
                });

                // add & monitor producer audio level and active speaker
                if (kind === 'audio') {
                    room.addProducerToAudioLevelObserver({ producerId: producer_id });
                    room.addProducerToActiveSpeakerObserver({ producerId: producer_id });
                }

                callback({ producer_id });
            } catch (err) {
                log.error('Producer transport error', {
                    error: err,
                    peerInfo,
                });
                callback({ error: err.message });
            }
        });

        socket.on('consume', async ({ consumerTransportId, producerId, rtpCapabilities, type }, callback) => {
            if (!roomExists(socket)) {
                return callback({ error: 'Room not found' });
            }

            const { room, peer } = getRoomAndPeer(socket);

            if (!peer) {
                return callback({ error: 'Peer not found' });
            }

            const peerInfo = getPeerInfo(peer);

            try {
                const params = await room.consume(socket.id, consumerTransportId, producerId, rtpCapabilities, type);

                log.debug('Consuming', {
                    producer_type: type,
                    producer_id: producerId,
                    consumer_id: params ? params.id : undefined,
                    peerInfo: peerInfo,
                });

                callback(params);
            } catch (err) {
                log.error('Consumer transport error', {
                    error: err,
                    type,
                    consumerTransportId,
                    producerId,
                    rtpCapabilities,
                    peerInfo,
                });
                callback({ error: err.message });
            }
        });

        socket.on('producerClosed', (data) => {
            if (!roomExists(socket)) return;

            const { room, peer } = getRoomAndPeer(socket);

            const peerInfo = getPeerInfo(peer);

            if (peer) peer.updatePeerInfo(data); // peer_info.audio OR video OFF

            try {
                room.closeProducer(socket.id, data.producer_id);
            } catch (err) {
                log.error('Producer Close error', {
                    error: err.message,
                    peerInfo,
                });
            }
        });

        socket.on('pauseProducer', async ({ producer_id, type }, callback) => {
            if (!roomExists(socket)) return;

            const peer = getPeer(socket);

            if (!peer) {
                return callback({
                    error: `Peer with ID: ${socket.id} for producer with id "${producer_id}" type "${type}" not found`,
                });
            }

            const producer = peer.getProducer(producer_id);

            if (!producer) {
                return callback({ error: `Producer with id "${producer_id}" type "${type}" not found` });
            }

            const peerInfo = getPeerInfo(peer);

            try {
                await producer.pause();

                log.debug('Producer paused', { producer_id, type, peerInfo });

                callback('successfully');
            } catch (error) {
                log.error('Pause producer', {
                    error: error,
                    peerInfo,
                });
                callback({ error: error.message });
            }
        });

        socket.on('resumeProducer', async ({ producer_id, type }, callback) => {
            if (!roomExists(socket)) return;

            const peer = getPeer(socket);

            if (!peer) {
                return callback({
                    error: `peer with ID: "${socket.id}" for producer with id "${producer_id}" type "${type}" not found`,
                });
            }

            const producer = peer.getProducer(producer_id);

            if (!producer) {
                return callback({ error: `producer with id "${producer_id}" type "${type}" not found` });
            }

            const peerInfo = getPeerInfo(peer);

            try {
                await producer.resume();

                log.debug('Producer resumed', { producer_id, type, peerInfo });

                callback('successfully');
            } catch (error) {
                log.error('Resume producer', {
                    error: error,
                    peerInfo,
                });
                callback({ error: error.message });
            }
        });

        socket.on('resumeConsumer', async ({ consumer_id, type }, callback) => {
            if (!roomExists(socket)) return;

            const peer = getPeer(socket);

            if (!peer) {
                return callback({
                    error: `peer with ID: "${socket.id}" for consumer with id "${consumer_id}" type "${type}" not found`,
                });
            }

            const consumer = peer.getConsumer(consumer_id);

            if (!consumer) {
                return callback({ error: `consumer with id "${consumer_id}" type "${type}" not found` });
            }

            const peerInfo = getPeerInfo(peer);

            try {
                await consumer.resume();

                log.debug('Consumer resumed', { consumer_id, type, peerInfo });

                callback('successfully');
            } catch (error) {
                log.error('Resume consumer', {
                    error: error,
                    peerInfo,
                });
                callback({ error: error.message });
            }
        });

        socket.on('getProducers', () => {
            if (!roomExists(socket)) return;

            const { room, peer } = getRoomAndPeer(socket);

            const { peer_name } = peer || 'undefined';

            log.debug('Get producers', peer_name);

            // send all the current producer to newly joined member
            const producerList = room.getProducerListForPeer();

            socket.emit('newProducers', producerList);
        });

        socket.on('getPeerCounts', async ({}, callback) => {
            if (!roomExists(socket)) return;

            const room = getRoom(socket);

            const peerCounts = room.getPeersCount();

            log.debug('Peer counts', { peerCounts: peerCounts });

            callback({ peerCounts: peerCounts });
        });

        socket.on('cmd', async (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            const room = getRoom(socket);

            const peer = getPeer(socket);

            if (!room || !peer) return;

            log.debug('cmd', data);

            switch (data.type) {
                case 'privacy':
                    peer.updatePeerInfo({ type: data.type, status: data.active });
                    break;
                case 'ejectAll':
                    const { peer_name, peer_uuid } = data;
                    const isPresenter = isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);
                    if (!isPresenter) return;
                    break;
                case 'peerAudio':
                    // Keep producer volume to update consumer on join room...
                    if (data.audioProducerId) {
                        peer.updatePeerInfo({ type: data.type, volume: data.volume * 100 });
                    }
                    break;
                default:
                    break;
                //...
            }

            data.broadcast ? room.broadCast(socket.id, 'cmd', data) : room.sendTo(data.peer_id, 'cmd', data);
        });

        socket.on('roomAction', async (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            const isPresenter = isPeerPresenter(socket.room_id, socket.id, data.peer_name, data.peer_uuid);

            const room = getRoom(socket);

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
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            const room = getRoom(socket);

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
            if (!roomExists(socket)) return;

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
                const isPresenter = isPeerPresenter(
                    socket.room_id,
                    socket.id,
                    data.from_peer_name,
                    data.from_peer_uuid,
                );
                if (!isPresenter) return;
            }

            const room = getRoom(socket);

            if (data.action === 'ban') room.addBannedPeer(data.to_peer_uuid);

            data.broadcast
                ? room.broadCast(data.peer_id, 'peerAction', data)
                : room.sendTo(data.peer_id, 'peerAction', data);
        });

        socket.on('updatePeerInfo', (dataObject) => {
            if (!roomExists(socket)) return;

            const { room, peer } = getRoomAndPeer(socket);

            if (!peer) return;

            const data = checkXSS(dataObject);

            peer.updatePeerInfo(data);

            if (data.broadcast) {
                log.debug('updatePeerInfo broadcast data');
                room.broadCast(socket.id, 'updatePeerInfo', data);
            }
        });

        socket.on('updateRoomModerator', (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            const room = getRoom(socket);

            const isPresenter = isPeerPresenter(socket.room_id, socket.id, data.peer_name, data.peer_uuid);

            if (!isPresenter) return;

            const moderator = data.moderator;

            room.updateRoomModerator(moderator);

            switch (moderator.type) {
                case 'audio_cant_unmute':
                case 'video_cant_unhide':
                case 'screen_cant_share':
                case 'chat_cant_privately':
                case 'chat_cant_chatgpt':
                case 'media_cant_sharing':
                    room.broadCast(socket.id, 'updateRoomModerator', moderator);
                    break;
                default:
                    break;
            }
        });

        socket.on('updateRoomModeratorALL', (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            const room = getRoom(socket);

            const isPresenter = isPeerPresenter(socket.room_id, socket.id, data.peer_name, data.peer_uuid);

            if (!isPresenter) return;

            const moderator = data.moderator;

            room.updateRoomModeratorALL(moderator);

            room.broadCast(socket.id, 'updateRoomModeratorALL', moderator);
        });

        socket.on('getRoomInfo', async (_, cb) => {
            if (!roomExists(socket)) return;

            const { room, peer } = getRoomAndPeer(socket);

            const { peer_name } = peer || 'undefined';

            log.debug('Send Room Info to', peer_name);

            cb(room.toJson());
        });

        socket.on('fileInfo', (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            if (!isValidFileName(data.fileName)) {
                log.debug('File name not valid', data);
                return;
            }

            log.debug('Send File Info', data);

            const room = getRoom(socket);

            data.broadcast ? room.broadCast(socket.id, 'fileInfo', data) : room.sendTo(data.peer_id, 'fileInfo', data);
        });

        socket.on('file', (data) => {
            if (!roomExists(socket)) return;

            const room = getRoom(socket);

            data.broadcast ? room.broadCast(socket.id, 'file', data) : room.sendTo(data.peer_id, 'file', data);
        });

        socket.on('fileAbort', (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            const room = getRoom(socket);

            room.broadCast(socket.id, 'fileAbort', data);
        });

        socket.on('receiveFileAbort', (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            const room = getRoom(socket);

            room.broadCast(socket.id, 'receiveFileAbort', data);
        });

        socket.on('shareVideoAction', (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            if (data.action == 'open' && !isValidHttpURL(data.video_url)) {
                log.debug('Video src not valid', data);
                return;
            }

            log.debug('Share video: ', data);

            const room = getRoom(socket);

            room.updateShareMedia(data);

            data.peer_id == 'all'
                ? room.broadCast(socket.id, 'shareVideoAction', data)
                : room.sendTo(data.peer_id, 'shareVideoAction', data);
        });

        socket.on('wbCanvasToJson', (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            const room = getRoom(socket);

            // const objLength = bytesToSize(Object.keys(data).length);

            // log.debug('Send Whiteboard canvas JSON', { length: objLength });

            room.broadCast(socket.id, 'wbCanvasToJson', data);
        });

        socket.on('whiteboardAction', (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            const room = getRoom(socket);

            log.debug('Whiteboard', data);
            room.broadCast(socket.id, 'whiteboardAction', data);
        });

        socket.on('setVideoOff', (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            log.debug('Video off data', data.peer_name);

            const room = getRoom(socket);

            room.broadCast(socket.id, 'setVideoOff', data);
        });

        socket.on('recordingAction', async (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            log.debug('Recording action', data);

            const room = getRoom(socket);

            room.broadCast(socket.id, 'recordingAction', data);
        });

        socket.on('refreshParticipantsCount', () => {
            if (!roomExists(socket)) return;

            const room = getRoom(socket);

            const peerCounts = room.getPeersCount();

            const data = {
                room_id: socket.room_id,
                peer_counts: peerCounts,
            };
            log.debug('Refresh Participants count', data);
            room.broadCast(socket.id, 'refreshParticipantsCount', data);
        });

        socket.on('message', (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            const { room, peer } = getRoomAndPeer(socket);

            const { peer_name } = peer || 'undefined';

            const realPeer = data.peer_name === peer_name;

            if (!realPeer) {
                log.warn('Fake message detected', {
                    ip: getIpSocket(socket),
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
            if (!roomExists(socket)) return;

            if (!config?.integrations?.chatGPT?.enabled) return cb({ message: 'ChatGPT seems disabled, try later!' });

            // https://platform.openai.com/docs/api-reference/completions/create
            try {
                // Add the prompt to the context
                context.push({ role: 'user', content: prompt });
                // Call OpenAI's API to generate response
                const completion = await chatGPT.chat.completions.create({
                    model: config?.integrations?.chatGPT?.model || 'gpt-3.5-turbo',
                    messages: context,
                    max_tokens: config?.integrations?.chatGPT?.max_tokens,
                    temperature: config?.integrations?.chatGPT?.temperature,
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

        // https://docs.heygen.com/reference/list-avatars-v2
        socket.on('getAvatarList', async ({}, cb) => {
            if (!config?.integrations?.videoAI?.enabled || !config?.integrations?.videoAI?.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });

            try {
                const response = await axios.get(`${config?.integrations?.videoAI?.basePath}/v2/avatars`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Key': config?.integrations?.videoAI?.apiKey,
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

        // https://docs.heygen.com/reference/list-voices-v2
        socket.on('getVoiceList', async ({}, cb) => {
            if (!config?.integrations?.videoAI?.enabled || !config?.integrations?.videoAI?.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });

            try {
                const response = await axios.get(`${config?.integrations?.videoAI?.basePath}/v2/voices`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Key': config?.integrations?.videoAI?.apiKey,
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

        // https://docs.heygen.com/reference/new-session
        socket.on('streamingNew', async ({ quality, avatar_id, voice_id }, cb) => {
            if (!roomExists(socket)) return;

            if (!config?.integrations?.videoAI?.enabled || !config?.integrations?.videoAI?.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });
            try {
                const voice = voice_id ? { voice_id: voice_id } : {};
                const response = await axios.post(
                    `${config?.integrations?.videoAI?.basePath}/v1/streaming.new`,
                    {
                        quality,
                        avatar_id,
                        voice: voice,
                    },
                    {
                        headers: {
                            accept: 'application/json',
                            'content-type': 'application/json',
                            'x-api-key': config?.integrations?.videoAI?.apiKey,
                        },
                    },
                );

                const data = { response: response.data };

                log.debug('streamingNew', data);

                cb(data);
            } catch (error) {
                log.error('streamingNew', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data });
            }
        });

        // https://docs.heygen.com/reference/start-session
        socket.on('streamingStart', async ({ session_id, sdp }, cb) => {
            if (!roomExists(socket)) return;

            if (!config?.integrations?.videoAI?.enabled || !config?.integrations?.videoAI?.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });

            try {
                const response = await axios.post(
                    `${config?.integrations?.videoAI?.basePath}/v1/streaming.start`,
                    { session_id, sdp },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config?.integrations?.videoAI?.apiKey,
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

        // https://docs.heygen.com/reference/submit-ice-information
        socket.on('streamingICE', async ({ session_id, candidate }, cb) => {
            if (!roomExists(socket)) return;

            if (!config?.integrations?.videoAI?.enabled || !config?.integrations?.videoAI?.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });

            try {
                const response = await axios.post(
                    `${config?.integrations?.videoAI?.basePath}/v1/streaming.ice`,
                    { session_id, candidate },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config?.integrations?.videoAI?.apiKey,
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

        // https://docs.heygen.com/reference/send-task
        socket.on('streamingTask', async ({ session_id, text }, cb) => {
            if (!roomExists(socket)) return;

            if (!config?.integrations?.videoAI?.enabled || !config?.integrations?.videoAI?.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });

            try {
                const response = await axios.post(
                    `${config?.integrations?.videoAI?.basePath}/v1/streaming.task`,
                    {
                        session_id,
                        text,
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config?.integrations?.videoAI?.apiKey,
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

        // https://docs.heygen.com/reference/interrupt-task
        socket.on('streamingInterrupt', async ({ session_id, text }, cb) => {
            if (!roomExists(socket)) return;

            if (!config?.integrations?.videoAI?.enabled || !config?.integrations?.videoAI?.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });

            try {
                const response = await axios.post(
                    `${config?.integrations?.videoAI?.basePath}/v1/streaming.interrupt`,
                    {
                        session_id,
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config?.integrations?.videoAI?.apiKey,
                        },
                    },
                );

                const data = { response: response.data };

                log.debug('streamingInterrupt', data);

                cb(data);
            } catch (error) {
                log.error('streamingInterrupt', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('talkToOpenAI', async ({ text, context }, cb) => {
            if (!roomExists(socket)) return;

            if (!config?.integrations?.videoAI?.enabled || !config?.integrations?.videoAI?.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });

            try {
                const systemLimit = config?.integrations?.videoAI?.systemLimit;
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

        // https://docs.heygen.com/reference/close-session
        socket.on('streamingStop', async ({ session_id }, cb) => {
            if (!roomExists(socket)) return;

            if (!config?.integrations?.videoAI?.enabled || !config?.integrations?.videoAI?.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });

            try {
                const response = await axios.post(
                    `${config?.integrations?.videoAI?.basePath}/v1/streaming.stop`,
                    {
                        session_id,
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config?.integrations?.videoAI?.apiKey,
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
            if (!roomExists(socket)) return;

            const room = getRoom(socket);

            const rtmpFiles = await room.getRTMP(rtmpDir);

            cb(rtmpFiles);
        });

        socket.on('startRTMP', async (dataObject, cb) => {
            if (!roomExists(socket)) return;

            if (rtmpCfg && rtmpFileStreamsCount >= rtmpCfg.maxStreams) {
                log.warn('RTMP max file streams reached', rtmpFileStreamsCount);
                return cb(false);
            }

            const data = checkXSS(dataObject);
            const { peer_name, peer_uuid, file } = data;
            const isPresenter = isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);
            if (!isPresenter) return cb(false);

            const room = getRoom(socket);

            const DEFAULT_HOST = 'localhost';
            const host = config?.ngrok?.enabled
                ? DEFAULT_HOST
                : socket?.handshake?.headers?.host?.split(':')[0] || DEFAULT_HOST;

            const rtmp = await room.startRTMP(socket.id, room, host, 1935, `../${rtmpDir}/${file}`);

            if (rtmp !== false) rtmpFileStreamsCount++;

            log.debug('startRTMP - rtmpFileStreamsCount ---->', rtmpFileStreamsCount);

            cb(rtmp);
        });

        socket.on('stopRTMP', async () => {
            if (!roomExists(socket)) return;

            const room = getRoom(socket);

            rtmpFileStreamsCount--;

            log.debug('stopRTMP - rtmpFileStreamsCount ---->', rtmpFileStreamsCount);

            await room.stopRTMP();
        });

        socket.on('endOrErrorRTMP', async () => {
            if (!roomExists(socket)) return;

            rtmpFileStreamsCount--;

            log.debug('endRTMP - rtmpFileStreamsCount ---->', rtmpFileStreamsCount);
        });

        socket.on('startRTMPfromURL', async (dataObject, cb) => {
            if (!roomExists(socket)) return;

            if (rtmpCfg && rtmpUrlStreamsCount >= rtmpCfg.maxStreams) {
                log.warn('RTMP max Url streams reached', rtmpUrlStreamsCount);
                return cb(false);
            }

            const data = checkXSS(dataObject);
            const { peer_name, peer_uuid, inputVideoURL } = data;
            const isPresenter = isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);
            if (!isPresenter) return cb(false);

            const room = getRoom(socket);

            const DEFAULT_HOST = 'localhost';
            const host = config?.integrations?.ngrok?.enabled
                ? DEFAULT_HOST
                : socket?.handshake?.headers?.host?.split(':')[0] || DEFAULT_HOST;

            const rtmp = await room.startRTMPfromURL(socket.id, room, host, 1935, inputVideoURL);

            if (rtmp !== false) rtmpUrlStreamsCount++;

            log.debug('startRTMPfromURL - rtmpUrlStreamsCount ---->', rtmpUrlStreamsCount);

            cb(rtmp);
        });

        socket.on('stopRTMPfromURL', async () => {
            if (!roomExists(socket)) return;

            const room = getRoom(socket);

            rtmpUrlStreamsCount--;

            log.debug('stopRTMPfromURL - rtmpUrlStreamsCount ---->', rtmpUrlStreamsCount);

            await room.stopRTMPfromURL();
        });

        socket.on('endOrErrorRTMPfromURL', async () => {
            if (!roomExists(socket)) return;

            rtmpUrlStreamsCount--;

            log.debug('endRTMPfromURL - rtmpUrlStreamsCount ---->', rtmpUrlStreamsCount);
        });

        socket.on('createPoll', (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            const { question, options } = data;

            const room = getRoom(socket);

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
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            const { room, peer } = getRoomAndPeer(socket);

            const { peer_name } = peer || socket.id;

            const roomPolls = room.getPolls();

            const poll = roomPolls[data.pollIndex];
            if (poll) {
                poll.voters.set(peer_name, data.option);
                room.sendToAll('updatePolls', room.convertPolls(roomPolls));
                log.debug('[Poll] vote', roomPolls);
            }
        });

        socket.on('updatePoll', () => {
            if (!roomExists(socket)) return;

            const room = getRoom(socket);

            const roomPolls = room.getPolls();

            if (roomPolls.length > 0) {
                room.sendToAll('updatePolls', room.convertPolls(roomPolls));
                log.debug('[Poll] updatePoll', roomPolls);
            }
        });

        socket.on('editPoll', (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            const { index, question, options } = data;

            const room = getRoom(socket);

            const roomPolls = room.getPolls();

            if (roomPolls[index]) {
                roomPolls[index].question = question;
                roomPolls[index].options = options;
                room.sendToAll('updatePolls', roomPolls);
                log.debug('[Poll] editPoll', roomPolls);
            }
        });

        socket.on('deletePoll', async (data) => {
            if (!roomExists(socket)) return;

            const { index, peer_name, peer_uuid } = checkXSS(data);

            // Disable for now...
            // const isPresenter = isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);
            // if (!isPresenter) return;

            const room = getRoom(socket);

            const roomPolls = room.getPolls();

            if (roomPolls[index]) {
                roomPolls.splice(index, 1);
                room.sendToAll('updatePolls', roomPolls);
                log.debug('[Poll] deletePoll', roomPolls);
            }
        });

        // Room collaborative editor

        socket.on('editorChange', (dataObject) => {
            if (!roomExists(socket)) return;

            //const data = checkXSS(dataObject);
            const data = dataObject;

            const room = getRoom(socket);

            room.broadCast(socket.id, 'editorChange', data);
        });

        socket.on('editorActions', (dataObject) => {
            if (!roomExists(socket)) return;

            const data = checkXSS(dataObject);

            const room = getRoom(socket);

            log.debug('editorActions', data);

            room.broadCast(socket.id, 'editorActions', data);
        });

        socket.on('editorUpdate', (dataObject) => {
            if (!roomExists(socket)) return;

            //const data = checkXSS(dataObject);
            const data = dataObject;

            const room = getRoom(socket);

            room.broadCast(socket.id, 'editorUpdate', data);
        });

        socket.on('disconnect', (reason) => {
            if (!roomExists(socket)) return;

            const { room, peer } = getRoomAndPeer(socket);

            const { peer_name, peer_uuid } = peer || {};

            const isPresenter = isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);

            log.debug('[Disconnect] - peer name', { peer_name, reason });

            room.removePeer(socket.id);

            if (room.getPeersCount() === 0) {
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

            if (webhook.enabled) {
                const data = {
                    timestamp: log.getDateTime(false),
                    room_id: socket.room_id,
                    peer_name: peer_name,
                    presenter: isPresenter,
                    reason: reason,
                };
                // Trigger a POST request when a user disconnects
                axios
                    .post(webhook.url, { event: 'disconnect', data })
                    .then((response) => log.debug('Disconnect event tracked:', response.data))
                    .catch((error) => log.error('Error tracking disconnect event:', error.message));
            }

            socket.room_id = null;
        });

        socket.on('exitRoom', (_, callback) => {
            if (!roomExists(socket)) {
                return callback({
                    error: 'Not currently in a room',
                });
            }

            const { room, peer } = getRoomAndPeer(socket);

            const { peer_name, peer_uuid } = peer || {};

            const isPresenter = isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);

            log.debug('Exit room', peer_name);

            room.removePeer(socket.id);

            room.broadCast(socket.id, 'removeMe', removeMeData(room, peer_name, isPresenter));

            if (room.getPeersCount() === 0) {
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

            if (isPresenter) removeIP(socket);

            if (webhook.enabled) {
                const data = {
                    timestamp: log.getDateTime(false),
                    room_id: socket.room_id,
                    peer_name: peer_name,
                    presenter: isPresenter,
                };
                // Trigger a POST request when a user exits
                axios
                    .post(webhook.url, { event: 'exit', data })
                    .then((response) => log.debug('ExitROom event tracked:', response.data))
                    .catch((error) => log.error('Error tracking exitRoom event:', error.message));
            }

            socket.room_id = null;

            callback('Successfully exited room');
        });

        // Helpers

        function getRoomAndPeer(socket) {
            const room = getRoom(socket);

            const peer = getPeer(socket);

            return { room, peer };
        }

        function getRoom(socket) {
            return roomList.get(socket.room_id) || null;
        }

        function getPeer(socket) {
            const room = getRoom(socket); // Reusing getRoom to retrieve the room

            return room.getPeer ? room.getPeer(socket.id) || null : null;
        }

        function roomExists(socket) {
            return roomList.has(socket.room_id);
        }

        function getPeerInfo(peer) {
            if (!peer || !peer.peer_info) {
                return {
                    peer_name: peer?.peer_name || 'Unknown',
                    isDesktop: false,
                    os: 'Unknown',
                    browser: 'Unknown',
                };
            }

            const { peer_name, peer_info } = peer;
            const { is_desktop_device, os_name, os_version, browser_name, browser_version } = peer_info;

            return {
                peer_name: peer_name || 'Unknown',
                isDesktop: Boolean(is_desktop_device),
                os: os_name && os_version ? `${os_name} ${os_version}` : os_name || 'Unknown',
                browser:
                    browser_name && browser_version ? `${browser_name} ${browser_version}` : browser_name || 'Unknown',
            };
        }

        function isValidFileName(fileName) {
            const invalidChars = /[\\\/\?\*\|:"<>]/;
            return !invalidChars.test(fileName);
        }

        function isValidHttpURL(input) {
            try {
                const url = new URL(input);
                return url.protocol === 'http:' || url.protocol === 'https:';
            } catch (_) {
                return false;
            }
        }

        function removeMeData(room, peerName, isPresenter) {
            const roomId = room && socket.room_id;
            const peerCounts = room && room.getPeersCount();
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

    function isPeerPresenter(room_id, peer_id, peer_name, peer_uuid) {
        try {
            if (hostCfg?.presenters?.join_first && (!presenters[room_id] || !presenters[room_id][peer_id])) {
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
                // First condition: join_first validation
                (hostCfg?.presenters?.join_first &&
                    presenters[room_id]?.[peer_id]?.peer_name === peer_name &&
                    presenters[room_id]?.[peer_id]?.peer_uuid === peer_uuid &&
                    Object.keys(presenters[room_id]?.[peer_id] || {}).length > 1) ||
                // Fallback condition: list check
                hostCfg?.presenters?.list?.includes(peer_name);

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
                // Using either email or username, as the username can also be an email here.
                const response = await axios.post(
                    hostCfg.users_api_endpoint,
                    {
                        email: username,
                        username: username,
                        password: password,
                        api_secret_key: hostCfg.users_api_secret_key,
                    },
                    {
                        timeout: 5000, // Timeout set to 5 seconds (5000 milliseconds)
                    },
                );
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
            const peerCount = (room && room.getPeersCount()) || 0;
            const broadcasting = (room && room.isBroadcasting()) || false;
            return {
                room: roomId,
                broadcasting: broadcasting,
                peers: peerCount,
            };
        });
        return roomPeersArray;
    }

    function isAllowedRoomAccess(logMessage, req, hostCfg, roomList, roomId) {
        const OIDCUserAuthenticated = OIDC.enabled && req.oidc.isAuthenticated();
        const hostUserAuthenticated = hostCfg.protected && hostCfg.authenticated;
        const roomExist = roomList.has(roomId);
        const roomCount = roomList.size;

        const allowRoomAccess =
            (!hostCfg.protected && !OIDC.enabled) || // No host protection and OIDC mode enabled (default)
            (OIDCUserAuthenticated && roomExist) || // User authenticated via OIDC and room Exist
            (hostUserAuthenticated && roomExist) || // User authenticated via Login and room Exist
            ((OIDCUserAuthenticated || hostUserAuthenticated) && roomCount === 0) || // User authenticated joins the first room
            roomExist; // User Or Guest join an existing Room

        log.debug(logMessage, {
            OIDCUserAuthenticated: OIDCUserAuthenticated,
            hostUserAuthenticated: hostUserAuthenticated,
            roomExist: roomExist,
            roomCount: roomCount,
            extraInfo: {
                roomId: roomId,
                OIDCUserEnabled: OIDC.enabled,
                hostProtected: hostCfg.protected,
                hostAuthenticated: hostCfg.authenticated,
            },
            allowRoomAccess: allowRoomAccess,
        });

        return allowRoomAccess;
    }

    async function roomExistsForUser(room) {
        if (hostCfg.protected || hostCfg.user_auth) {
            // Check if passed room exists
            if (hostCfg.users_from_db && hostCfg.api_room_exists) {
                try {
                    const response = await axios.post(
                        hostCfg.api_room_exists,
                        {
                            room: room,
                            api_secret_key: hostCfg.users_api_secret_key,
                        },
                        {
                            timeout: 5000, // Timeout set to 5 seconds (5000 milliseconds)
                        },
                    );
                    log.debug('AXIOS roomExistsForUser', { room: room, exists: true });
                    return response.data && response.data.message === true;
                } catch (error) {
                    log.error('AXIOS roomExistsForUser error', error.message);
                    return false;
                }
            }
        }
    }

    async function getUserAllowedRooms(username, password) {
        // Gel user allowed rooms from db...
        if (hostCfg.protected && hostCfg.users_from_db && hostCfg.users_api_rooms_allowed) {
            try {
                // Using either email or username, as the username can also be an email here.
                const response = await axios.post(
                    hostCfg.users_api_rooms_allowed,
                    {
                        email: username,
                        username: username,
                        password: password,
                        api_secret_key: hostCfg.users_api_secret_key,
                    },
                    {
                        timeout: 5000, // Timeout set to 5 seconds (5000 milliseconds)
                    },
                );
                const allowedRooms = response.data ? response.data.message : {};
                log.debug('AXIOS getUserAllowedRooms', allowedRooms);
                return allowedRooms;
            } catch (error) {
                log.error('AXIOS getUserAllowedRooms error', error.message);
                return {};
            }
        }

        // Get allowed rooms for user from config.js file
        if (hostCfg.protected && !hostCfg.users_from_db) {
            const isOIDCEnabled = config?.security?.oidc?.enabled;

            const user = hostCfg.users.find((user) => user.displayname === username || user.username === username);

            if (!isOIDCEnabled && !user) {
                log.debug('getUserAllowedRooms - user not found', username);
                return false;
            }
            return user.allowed_rooms;
        }

        return ['*'];
    }

    async function isRoomAllowedForUser(message, username, room) {
        const logData = { message, username, room };

        log.debug('isRoomAllowedForUser ------>', logData);

        if (!username || !room) return false;

        const isOIDCEnabled = config?.security?.oidc?.enabled;

        if (hostCfg.protected || hostCfg.user_auth) {
            // Check if allowed room for user from DB...
            if (hostCfg.users_from_db && hostCfg.users_api_room_allowed) {
                try {
                    // Using either email or username, as the username can also be an email here.
                    const response = await axios.post(
                        hostCfg.users_api_room_allowed,
                        {
                            email: username,
                            username: username,
                            room: room,
                            api_secret_key: hostCfg.users_api_secret_key,
                        },
                        {
                            timeout: 5000, // Timeout set to 5 seconds (5000 milliseconds)
                        },
                    );
                    log.debug('AXIOS isRoomAllowedForUser', { room: room, allowed: true });
                    return response.data && response.data.message === true;
                } catch (error) {
                    log.error('AXIOS isRoomAllowedForUser error', error.message);
                    return false;
                }
            }

            const isInPresenterLists = hostCfg?.presenters?.list?.includes(username);

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
        const endpoint = config?.integrations?.IPLookup?.getEndpoint(ip);
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
        log.info('Allowed IPs', {
            ip: ip,
            authorizedIP: authorizedIP,
            authorizedIPs: authorizedIPs,
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
                });
            }
        }
    }
}

process.on('SIGINT', () => {
    log.debug('PROCESS', 'SIGINT');
    htmlInjector.cleanup();
    process.exit();
});

process.on('SIGTERM', () => {
    log.debug('PROCESS', 'SIGTERM');
    htmlInjector.cleanup();
    process.exit();
});
