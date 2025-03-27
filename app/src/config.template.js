'use strict';

const dotenv = require('dotenv').config();
const packageJson = require('../../package.json');

const os = require('os');
const fs = require('fs');

const PLATFORM = os.platform();
const IS_DOCKER = fs.existsSync('/.dockerenv');

// ###################################################################################################
const ENVIRONMENT = process.env.NODE_ENV || 'development'; // production
const PUBLIC_IP = process.env.SFU_PUBLIC_IP || ''; // SFU Public IP
const LISTEN_IP = process.env.SFU_LISTEN_IP || '0.0.0.0'; // SFU listen IP
const IPv4 = getIPv4(); // Determines the appropriate IPv4 address based on ENVIRONMENT
// ###################################################################################################

/*
    Set the port range for WebRTC communication. This range is used for the dynamic allocation of UDP ports for media streams.
        - Each participant requires 2 ports: one for audio and one for video.
        - The default configuration supports up to 50 participants (50 * 2 ports = 100 ports).
        - To support more participants, simply increase the port range.
    Note: 
    - When running in Docker, use 'network mode: host' for improved performance.
    - Alternatively, enable 'webRtcServerActive: true' mode for better scalability.
    - Make sure these port ranges are not blocked by the firewall, if they are, add the necessary rules
*/
const RTC_MIN_PORT = parseInt(process.env.SFU_MIN_PORT) || 40000;
const RTC_MAX_PORT = parseInt(process.env.SFU_MAX_PORT) || 40100;

/*
    One worker can handle approximately 100 concurrent participants.
    The number of workers cannot exceed the number of available CPU cores.
*/
const NUM_CPUS = os.cpus().length;
const NUM_WORKERS = Math.min(process.env.SFU_NUM_WORKERS || NUM_CPUS, NUM_CPUS);

// RTMP using FMMPEG for streaming...
const FFMPEG_PATH = process.env.FFMPEG_PATH || getFFmpegPath(PLATFORM);

module.exports = {
    services: {
        ip: ['http://api.ipify.org', 'http://ipinfo.io/ip', 'http://ifconfig.me/ip'],
    },
    systemInfo: {
        os: {
            type: os.type(),
            release: os.release(),
            arch: os.arch(),
        },
        cpu: {
            cores: os.cpus().length,
            model: os.cpus()[0].model,
        },
        memory: {
            total: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        },
        isDocker: IS_DOCKER,
    },
    console: {
        /*
            timeZone: Time Zone corresponding to timezone identifiers from the IANA Time Zone Database es 'Europe/Rome' default UTC
        */
        timeZone: 'UTC',
        debug: true,
        colors: true,
    },
    server: {
        hostUrl: '', // default to http://localhost:port
        listen: {
            // app listen on
            ip: '0.0.0.0',
            port: process.env.PORT || 3010,
        },
        trustProxy: false, // Enables trust for proxy headers (e.g., X-Forwarded-For) based on the trustProxy setting
        ssl: {
            // ssl/README.md
            cert: process.env.SSL_CERT || '../ssl/cert.pem',
            key: process.env.SSL_KEY || '../ssl/key.pem',
        },
        cors: {
            /* 
                origin: Allow specified origin es ['https://example.com', 'https://subdomain.example.com', 'http://localhost:3010'] or all origins if not specified
                methods: Allow only GET and POST methods
            */
            origin: '*',
            methods: ['GET', 'POST'],
        },
        recording: {
            /*
                The recording will be saved to the directory designated within your Server app/<dir>
                Note: if you use Docker: Create the "app/rec" directory, configure it as a volume in docker-compose.yml, 
                ensure proper permissions, and start the Docker container.
            */
            enabled: false,
            endpoint: '', // Change the URL if you want to save the recording to a different server or cloud service (http://localhost:8080), otherwise leave it as is (empty).
            dir: 'rec',
            maxFileSize: 1 * 1024 * 1024 * 1024, // 1 GB
        },
        rtmp: {
            /*
                Real-Time Messaging Protocol (RTMP) is a communication protocol for streaming audio, video, and data over the Internet. (beta)

                Configuration:
                - enabled: Enable or disable the RTMP streaming feature. Set to 'true' to enable, 'false' to disable.
                - fromFile: Enable or disable the RTMP streaming from File. Set to 'true' to enable, 'false' to disable.
                - fromUrl: Enable or disable the RTMP streaming from Url. Set to 'true' to enable, 'false' to disable.
                - fromStream: Enable or disable the RTMP Streamer. Set to 'true' to enable, 'false' to disable.
                - maxStreams: Specifies the maximum number of simultaneous streams permitted for File, URL, and Stream. The default value is 1.
                - server: The URL of the RTMP server. Leave empty to use the built-in MiroTalk RTMP server (rtmp://localhost:1935). Change the URL to connect to a different RTMP server.
                - appName: The application name for the RTMP stream. Default is 'mirotalk'.
                - streamKey: The stream key for the RTMP stream. Leave empty if not required.
                - secret: The secret key for RTMP streaming. Must match the secret in rtmpServers/node-media-server/src/config.js. Leave empty if no authentication is needed.
                - apiSecret: The API secret for streaming WebRTC to RTMP through the MiroTalk API.
                - expirationHours: The number of hours before the RTMP URL expires. Default is 4 hours.
                - dir: Directory where your video files are stored to be streamed via RTMP.
                - ffmpegPath: Path of the ffmpeg installation on the system (which ffmpeg)
                - platform: 'darwin', 'linux', 'win32', etc.

                Important: Before proceeding, make sure your RTMP server is up and running. 
                For more information, refer to the documentation here: https://docs.mirotalk.com/mirotalk-sfu/rtmp/.
                You can start the server by running the following command:
                - Start: npm run nms-start - Start the RTMP server.
                - Stop: npm run npm-stop - Stop the RTMP server.
                - Logs: npm run npm-logs - View the logs of the RTMP server.
            */
            enabled: false,
            fromFile: true,
            fromUrl: true,
            fromStream: true,
            maxStreams: 1,
            server: 'rtmp://localhost:1935',
            appName: 'mirotalk',
            streamKey: '',
            secret: 'mirotalkRtmpSecret',
            apiSecret: 'mirotalkRtmpApiSecret',
            expirationHours: 4,
            dir: 'rtmp',
            ffmpegPath: FFMPEG_PATH,
            platform: PLATFORM,
        },
    },
    middleware: {
        /*
            Middleware:
                - IP Whitelist: Access to the instance is restricted to only the specified IP addresses in the allowed list. This feature is disabled by default.
                - ...
        */
        IpWhitelist: {
            enabled: false,
            allowed: ['127.0.0.1', '::1'],
        },
    },
    api: {
        // Default secret key for app/api
        keySecret: 'mirotalksfu_default_secret',
        // Define which endpoints are allowed
        allowed: {
            stats: true,
            meetings: false,
            meeting: true,
            join: true,
            token: false,
            slack: true,
            mattermost: true,
            //...
        },
    },
    jwt: {
        /*
            JWT https://jwt.io/
            Securely manages credentials for host configurations and user authentication, enhancing security and streamlining processes.
         */
        key: 'mirotalksfu_jwt_secret',
        exp: '1h',
    },
    oidc: {
        /*
            OIDC stands for OpenID Connect, which is an authentication protocol built on top of OAuth 2.0. 
            It provides a simple identity layer on the OAuth 2.0 protocol, allowing clients to verify the identity of the end-user 
            based on the authentication performed by an authorization server.
            How to configure your own Provider:
                1. Sign up for an account at https://auth0.com.
                2. Navigate to https://manage.auth0.com/ to create a new application tailored to your specific requirements.
            For those seeking an open-source solution, check out: https://github.com/panva/node-oidc-provider
        */
        enabled: false,
        baseURLDynamic: false,
        peer_name: {
            force: true, // Enforce using profile data for peer_name
            email: true, // Use email as peer_name
            name: false, // Don't use full name (family_name + given_name)
        },
        config: {
            issuerBaseURL: 'https://server.example.com',
            baseURL: `http://localhost:${process.env.PORT ? process.env.PORT : 3010}`, // https://sfu.mirotalk.com
            clientID: 'clientID',
            clientSecret: 'clientSecret',
            secret: 'mirotalksfu-oidc-secret',
            authorizationParams: {
                response_type: 'code',
                scope: 'openid profile email',
            },
            authRequired: false, // Set to true if authentication is required for all routes
            auth0Logout: true, // Set to true to enable logout with Auth0
            routes: {
                callback: '/auth/callback', // Indicating the endpoint where your application will handle the callback from the authentication provider after a user has been authenticated.
                login: false, // Dedicated route in your application for user login.
                logout: '/logout', // Indicating the endpoint where your application will handle user logout requests.
            },
        },
    },
    host: {
        /*
            Host Protection (default: false)
            To enhance host security, enable host protection - user auth and provide valid
            usernames and passwords in the users array or active users_from_db using users_api_endpoint for check.
            When oidc.enabled is utilized alongside host protection, the authenticated user will be recognized as valid.
        */
        protected: false,
        user_auth: false,
        users_from_db: false, // if true ensure that api.token is also set to true.
        users_api_endpoint: 'http://localhost:9000/api/v1/user/isAuth',
        users_api_room_allowed: 'http://localhost:9000/api/v1/user/isRoomAllowed',
        users_api_rooms_allowed: 'http://localhost:9000/api/v1/user/roomsAllowed',
        api_room_exists: 'http://localhost:9000/api/v1/room/exists',
        //users_api_endpoint: 'https://webrtc.mirotalk.com/api/v1/user/isAuth',
        //users_api_room_allowed: 'https://webrtc.mirotalk.com/api/v1/user/isRoomAllowed',
        //users_api_rooms_allowed: 'https://webrtc.mirotalk.com/api/v1/user/roomsAllowed',
        //api_room_exists: 'https://webrtc.mirotalk.com//api/v1/room/exists',
        users_api_secret_key: 'mirotalkweb_default_secret',
        users: [
            {
                username: 'username',
                password: 'password',
                displayname: 'username displayname',
                allowed_rooms: ['*'],
            },
            {
                username: 'username2',
                password: 'password2',
                displayname: 'username2 displayname',
                allowed_rooms: ['room1', 'room2'],
            },
            {
                username: 'username3',
                password: 'password3',
                displayname: 'username3 displayname',
            },
            //...
        ],
    },
    presenters: {
        list: [
            /*
                By default, the presenter is identified as the first participant to join the room, distinguished by their username and UUID. 
                Additional layers can be added to specify valid presenters and co-presenters by setting designated usernames.
            */
            'Miroslav Pejic',
            'miroslav.pejic.85@gmail.com',
        ],
        join_first: true, // Set to true for traditional behavior, false to prioritize presenters
    },
    chatGPT: {
        /*
        ChatGPT
            1. Goto https://platform.openai.com/
            2. Create your account
            3. Generate your APIKey https://platform.openai.com/account/api-keys
        */
        enabled: false,
        basePath: 'https://api.openai.com/v1/',
        apiKey: '',
        model: 'gpt-3.5-turbo',
        max_tokens: 1000,
        temperature: 0,
    },
    videoAI: {
        /*
        HeyGen Video AI
            1. Goto  https://app.heygen.com
            2. Create your account
            3. Generate your APIKey https://app.heygen.com/settings?nav=API
         */
        enabled: false,
        basePath: 'https://api.heygen.com',
        apiKey: '',
        systemLimit:
            'You are a streaming avatar from MiroTalk SFU, an industry-leading product that specialize in videos communications.',
    },
    email: {
        /*
            Configure email settings for notifications or alerts
            Refer to the documentation for Gmail configuration: https://support.google.com/mail/answer/185833?hl=en
        */
        alert: false,
        host: 'smtp.gmail.com',
        port: 587,
        username: 'your_username',
        password: 'your_password',
        sendTo: 'sfu.mirotalk@gmail.com',
    },
    ngrok: {
        /* 
        Ngrok
            1. Goto https://ngrok.com
            2. Get started for free 
            3. Copy YourNgrokAuthToken: https://dashboard.ngrok.com/get-started/your-authtoken
        */
        enabled: false,
        authToken: '',
    },
    sentry: {
        /*
        Sentry
            1. Goto https://sentry.io/
            2. Create account
            3. On dashboard goto Settings/Projects/YourProjectName/Client Keys (DSN)
        */
        enabled: false,
        DSN: '',
        tracesSampleRate: 0.5,
    },
    webhook: {
        /*
            Enable or disable webhook functionality.
            Set `enabled` to `true` to activate webhook sending of socket events (join, exitRoom, disconnect)
        */
        enabled: false,
        url: 'https://your-site.com/webhook-endpoint',
    },
    mattermost: {
        /*
        Mattermost: https://mattermost.com
            1. Navigate to Main Menu > Integrations > Slash Commands in Mattermost.
            2. Click on Add Slash Command and configure the following settings:
                - Title: Enter a descriptive title (e.g., `SFU Command`).
                - Command Trigger Word: Set the trigger word to `sfu`.
                - Callback URLs: Enter the URL for your Express server (e.g., `https://yourserver.com/mattermost`).
                - Request Method: Select POST.
                - Enable Autocomplete: Check the box for Autocomplete.
                - Autocomplete Description: Provide a brief description (e.g., `Get MiroTalk SFU meeting room`).
            3. Save the slash command and copy the generated token (YourMattermostToken).   
        */
        enabled: false,
        serverUrl: 'YourMattermostServerUrl',
        username: 'YourMattermostUsername',
        password: 'YourMattermostPassword',
        token: 'YourMattermostToken',
        commands: [
            {
                name: '/sfu',
                message: 'Here is your meeting room:',
            },
            //....
        ],
        texts: [
            {
                name: '/sfu',
                message: 'Here is your meeting room:',
            },
            //....
        ],
    },
    slack: {
        /*
        Slack
            1. Goto https://api.slack.com/apps/
            2. Create your app
            3. On Settings - Basic Information - App Credentials, chose your Signing Secret
            4. Create a Slash Commands and put as Request URL: https://your.domain.name/slack
        */
        enabled: false,
        signingSecret: '',
    },
    discord: {
        /*
        Discord
            1. Go to the Discord Developer Portal: https://discord.com/developers/.
            2. Create a new application and name it whatever you like.
            3. Under the Bot section, click Add Bot and confirm.
            4. Copy your bot token (this will be used later).
            5. Under OAuth2 -> URL Generator, select bot scope, and under Bot Permissions, select the permissions you need (e.g., Send Messages and Read Messages).
            6. Copy the generated invite URL, open it in a browser, and invite the bot to your Discord server.
            7. Add the Bot in the Server channel permissions
            8. Type /sfu (commands.name) in the channel, the response will return a URL for the meeting
        */
        enabled: false,
        token: '',
        commands: [
            {
                name: '/sfu',
                message: 'Here is your SFU meeting room:',
                baseUrl: 'https://sfu.mirotalk.com/join/',
            },
        ],
    },
    IPLookup: {
        /*
        GeoJS
            https://www.geojs.io/docs/v1/endpoints/geo/
        */
        enabled: false,
        getEndpoint(ip) {
            return `https://get.geojs.io/v1/ip/geo/${ip}.json`;
        },
    },
    survey: {
        /*
        QuestionPro
            1. GoTo https://www.questionpro.com/
            2. Create your account
            3. Create your custom survey
        */
        enabled: false,
        url: '',
    },
    redirect: {
        /*
        Redirect URL on leave room
            Upon leaving the room, users who either opt out of providing feedback or if the survey is disabled 
            will be redirected to a specified URL. If enabled false the default '/newroom' URL will be used.
        */
        enabled: false,
        url: '',
    },
    ui: {
        /*
            Customize your MiroTalk instance
            Branding and customizations require a license: https://codecanyon.net/item/mirotalk-sfu-webrtc-realtime-video-conferences/40769970
        */
        brand: {
            app: {
                language: 'en', // https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes
                name: 'MiroTalk SFU',
                title: 'MiroTalk SFU<br />Free browser based Real-time video calls.<br />Simple, Secure, Fast.',
                description:
                    'Start your next video call with a single click. No download, plug-in, or login is required. Just get straight to talking, messaging, and sharing your screen.',
                joinDescription: 'Pick a room name.<br />How about this one?',
                joinButtonLabel: 'JOIN ROOM',
                joinLastLabel: 'Your recent room:',
            },
            site: {
                title: 'MiroTalk SFU, Free Video Calls, Messaging and Screen Sharing',
                icon: '../images/logo.svg',
                appleTouchIcon: '../images/logo.svg',
                newRoomTitle: 'Pick name. <br />Share URL. <br />Start conference.',
                newRoomDescription:
                    "Each room has its disposable URL. Just pick a room name and share your custom URL. It's that easy.",
            },
            meta: {
                description:
                    'MiroTalk SFU powered by WebRTC and mediasoup, Real-time Simple Secure Fast video calls, messaging and screen sharing capabilities in the browser.',
                keywords:
                    'webrtc, miro, mediasoup, mediasoup-client, self hosted, voip, sip, real-time communications, chat, messaging, meet, webrtc stun, webrtc turn, webrtc p2p, webrtc sfu, video meeting, video chat, video conference, multi video chat, multi video conference, peer to peer, p2p, sfu, rtc, alternative to, zoom, microsoft teams, google meet, jitsi, meeting',
            },
            og: {
                type: 'app-webrtc',
                siteName: 'MiroTalk SFU',
                title: 'Click the link to make a call.',
                description: 'MiroTalk SFU calling provides real-time video calls, messaging and screen sharing.',
                image: 'https://sfu.mirotalk.com/images/mirotalksfu.png',
                url: 'https://sfu.mirotalk.com',
            },
            html: {
                features: true,
                teams: true,
                tryEasier: true,
                poweredBy: true,
                sponsors: true,
                advertisers: true,
                footer: true,
            },
            about: {
                imageUrl: '../images/mirotalk-logo.gif',
                title: `WebRTC SFU v${packageJson.version}`,
                html: `
                    <button 
                        id="support-button" 
                        data-umami-event="Support button" 
                        onclick="window.open('https://codecanyon.net/user/miroslavpejic85', '_blank')">
                        <i class="fas fa-heart"></i> Support
                    </button>
                    <br /><br /><br />
                    Author: 
                    <a 
                        id="linkedin-button" 
                        data-umami-event="Linkedin button" 
                        href="https://www.linkedin.com/in/miroslav-pejic-976a07101/" 
                        target="_blank"> 
                        Miroslav Pejic
                    </a>
                    <br /><br />
                    Email: 
                    <a 
                        id="email-button" 
                        data-umami-event="Email button" 
                        href="mailto:miroslav.pejic.85@gmail.com?subject=MiroTalk SFU info"> 
                        miroslav.pejic.85@gmail.com
                    </a>
                    <br /><br />
                    <hr />
                    <span>&copy; 2025 MiroTalk SFU, all rights reserved</span>
                    <hr />
                `,
            },
            //...
        },
        /*
            Toggle the visibility of specific HTML elements within the room
        */
        buttons: {
            main: {
                shareButton: true, // presenter
                hideMeButton: true,
                startAudioButton: true,
                startVideoButton: true,
                startScreenButton: true,
                swapCameraButton: true,
                chatButton: true,
                pollButton: true,
                editorButton: true,
                raiseHandButton: true,
                transcriptionButton: true,
                whiteboardButton: true,
                documentPiPButton: true,
                snapshotRoomButton: true,
                emojiRoomButton: true,
                settingsButton: true,
                aboutButton: true,
                exitButton: true,
            },
            settings: {
                fileSharing: true,
                lockRoomButton: true, // presenter
                unlockRoomButton: true, // presenter
                broadcastingButton: true, // presenter
                lobbyButton: true, // presenter
                sendEmailInvitation: true, // presenter
                micOptionsButton: true, // presenter
                tabRTMPStreamingBtn: true, // presenter
                tabModerator: true, // presenter
                tabRecording: true,
                host_only_recording: true, // presenter
                pushToTalk: true,
                keyboardShortcuts: true,
                virtualBackground: true,
            },
            producerVideo: {
                videoPictureInPicture: true,
                videoMirrorButton: true,
                fullScreenButton: true,
                snapShotButton: true,
                muteAudioButton: true,
                videoPrivacyButton: true,
                audioVolumeInput: true,
            },
            consumerVideo: {
                videoPictureInPicture: true,
                videoMirrorButton: true,
                fullScreenButton: true,
                snapShotButton: true,
                focusVideoButton: true,
                sendMessageButton: true,
                sendFileButton: true,
                sendVideoButton: true,
                muteVideoButton: true,
                muteAudioButton: true,
                audioVolumeInput: true,
                geolocationButton: true, // Presenter
                banButton: true, // presenter
                ejectButton: true, // presenter
            },
            videoOff: {
                sendMessageButton: true,
                sendFileButton: true,
                sendVideoButton: true,
                muteAudioButton: true,
                audioVolumeInput: true,
                geolocationButton: true, // Presenter
                banButton: true, // presenter
                ejectButton: true, // presenter
            },
            chat: {
                chatPinButton: true,
                chatMaxButton: true,
                chatSaveButton: true,
                chatEmojiButton: true,
                chatMarkdownButton: true,
                chatSpeechStartButton: true,
                chatGPT: true,
            },
            poll: {
                pollPinButton: true,
                pollMaxButton: true,
                pollSaveButton: true,
            },
            participantsList: {
                saveInfoButton: true, // presenter
                sendFileAllButton: true, // presenter
                ejectAllButton: true, // presenter
                sendFileButton: true, // presenter & guests
                geoLocationButton: true, // presenter
                banButton: true, // presenter
                ejectButton: true, // presenter
            },
            whiteboard: {
                whiteboardLockButton: true, // presenter
            },
            //...
        },
    },
    stats: {
        /*
            Umami: https://github.com/umami-software/umami
            We use our Self-hosted Umami to track aggregated usage statistics in order to improve our service.
        */
        enabled: true,
        src: 'https://stats.mirotalk.com/script.js',
        id: '41d26670-f275-45bb-af82-3ce91fe57756',
    },
    mediasoup: {
        // Worker settings
        numWorkers: NUM_WORKERS,
        worker: {
            rtcMinPort: RTC_MIN_PORT,
            rtcMaxPort: RTC_MAX_PORT,
            disableLiburing: false, // https://github.com/axboe/liburing
            logLevel: 'error',
            logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp', 'rtx', 'bwe', 'score', 'simulcast', 'svc', 'sctp'],
        },
        // Router settings
        router: {
            audioLevelObserverEnabled: true,
            activeSpeakerObserverEnabled: false,
            mediaCodecs: [
                {
                    kind: 'audio',
                    mimeType: 'audio/opus',
                    clockRate: 48000,
                    channels: 2,
                },
                {
                    kind: 'video',
                    mimeType: 'video/VP8',
                    clockRate: 90000,
                    parameters: {
                        'x-google-start-bitrate': 1000,
                    },
                },
                {
                    kind: 'video',
                    mimeType: 'video/VP9',
                    clockRate: 90000,
                    parameters: {
                        'profile-id': 0, // Default profile for wider compatibility
                        'x-google-start-bitrate': 1000,
                    },
                },
                {
                    kind: 'video',
                    mimeType: 'video/VP9',
                    clockRate: 90000,
                    parameters: {
                        'profile-id': 2, // High profile for modern devices
                        'x-google-start-bitrate': 1000,
                    },
                },
                {
                    kind: 'video',
                    mimeType: 'video/h264',
                    clockRate: 90000,
                    parameters: {
                        'packetization-mode': 1,
                        'profile-level-id': '42e01f', // Baseline profile for compatibility
                        'level-asymmetry-allowed': 1,
                        'x-google-start-bitrate': 1000,
                    },
                },
                {
                    kind: 'video',
                    mimeType: 'video/h264',
                    clockRate: 90000,
                    parameters: {
                        'packetization-mode': 1,
                        'profile-level-id': '4d0032', // High profile for modern devices
                        'level-asymmetry-allowed': 1,
                        'x-google-start-bitrate': 1000,
                    },
                },
            ],
        },
        // WebRtcServerOptions
        webRtcServerActive: false,
        webRtcServerOptions: {
            listenInfos: [
                // { protocol: 'udp', ip: LISTEN_IP, announcedAddress: IPv4, port: RTC_MIN_PORT },
                // { protocol: 'tcp', ip: LISTEN_IP, announcedAddress: IPv4, port: RTC_MIN_PORT },
                {
                    protocol: 'udp',
                    ip: LISTEN_IP,
                    announcedAddress: IPv4,
                    portRange: { min: RTC_MIN_PORT, max: RTC_MIN_PORT + NUM_WORKERS },
                },
                {
                    protocol: 'tcp',
                    ip: LISTEN_IP,
                    announcedAddress: IPv4,
                    portRange: { min: RTC_MIN_PORT, max: RTC_MIN_PORT + NUM_WORKERS },
                },
            ],
        },
        // WebRtcTransportOptions
        webRtcTransport: {
            listenInfos: [
                // { protocol: 'udp', ip: IPv4, portRange: { min: RTC_MIN_PORT, max: RTC_MAX_PORT } },
                // { protocol: 'tcp', ip: IPv4, portRange: { min: RTC_MIN_PORT, max: RTC_MAX_PORT } },
                {
                    protocol: 'udp',
                    ip: LISTEN_IP,
                    announcedAddress: IPv4,
                    portRange: { min: RTC_MIN_PORT, max: RTC_MAX_PORT },
                },
                {
                    protocol: 'tcp',
                    ip: LISTEN_IP,
                    announcedAddress: IPv4,
                    portRange: { min: RTC_MIN_PORT, max: RTC_MAX_PORT },
                },
            ],
            initialAvailableOutgoingBitrate: 1000000,
            minimumAvailableOutgoingBitrate: 600000,
            maxSctpMessageSize: 262144,
            maxIncomingBitrate: 1500000,
        },
    },
};

/**
 * Determines the appropriate IPv4 address based on environment and configuration
 * Priority order:
 * 1. Explicitly configured PUBLIC_IP (if set)
 * 2. Environment-specific detection
 *
 * @returns {string} The selected IPv4 address
 */
function getIPv4() {
    // Highest priority: use explicitly configured IP if available
    if (PUBLIC_IP) return PUBLIC_IP;

    switch (ENVIRONMENT) {
        case 'development':
            return IS_DOCKER ? '127.0.0.1' : getLocalIPv4();

        case 'production':
            /*
             * Production Environment Notes:
             * ----------------------------------
             * 1. Recommended: Explicitly set your public IPv4 address
             *    - For cloud providers (AWS/Azure/GCP):
             *      - AWS: Use Elastic IP associated with your EC2 instance
             *      - GCP: Use static external IP assigned to your VM
             *      - Azure: Use public IP address resource
             *
             * 2. Auto-detection Fallback:
             *    - Will attempt to detect public IP if not manually configured
             *    - Not recommended for production as it may cause:
             *      - DNS resolution delays during startup
             *      - Inconsistent behavior if detection services are unavailable
             *
             * 3. For containerized production:
             *    - Set via environment variable
             *    - Use cloud provider metadata service when available
             *      (e.g., AWS EC2 metadata service)
             */
            return PUBLIC_IP;

        default:
            // Fallback for unknown environments - use local IP detection
            return getLocalIPv4();
    }
}

/**
 * Retrieves the most suitable local IPv4 address by:
 * 1. Checking platform-specific priority interfaces first (Ethernet/Wi-Fi)
 * 2. Falling back to scanning all non-virtual interfaces
 * 3. Excluding APIPA (169.254.x.x) and internal/virtual addresses
 *
 * @returns {string} Valid IPv4 address or '0.0.0.0' if none found
 */
function getLocalIPv4() {
    const ifaces = os.networkInterfaces();
    const platform = os.platform();

    // ===== 1. Platform-Specific Configuration =====
    /**
     * Interface priority list (ordered by most preferred first).
     * Windows: Physical Ethernet/Wi-Fi before virtual adapters
     * macOS: Built-in en0 (Ethernet/Wi-Fi) before secondary interfaces
     * Linux: Standard eth0/wlan0 before containers/virtual NICs
     */
    const PRIORITY_CONFIG = {
        win32: [
            { name: 'Ethernet', type: 'wired' }, // Primary wired
            { name: 'Wi-Fi', type: 'wireless' }, // Primary wireless
            { name: 'Local Area Connection', type: 'wired' }, // Legacy wired
        ],
        darwin: [
            { name: 'en0', type: 'wired/wireless' }, // macOS primary
            { name: 'en1', type: 'secondary' }, // macOS secondary
        ],
        linux: [
            { name: 'eth0', type: 'wired' }, // Linux primary Ethernet
            { name: 'wlan0', type: 'wireless' }, // Linux primary wireless
        ],
    };

    /**
     * Virtual interfaces to exclude (case-insensitive partial matches):
     * - Common: Docker, VPNs, loopback
     * - Windows: Hyper-V, VMware, Bluetooth
     * - macOS: AWDL (Apple Wireless Direct Link), virtualization
     * - Linux: Kubernetes, libvirt bridges
     */
    const VIRTUAL_INTERFACES = {
        all: ['docker', 'veth', 'tun', 'lo'], // Cross-platform virtual NICs
        win32: ['Virtual', 'vEthernet', 'Teredo', 'Bluetooth'],
        darwin: ['awdl', 'bridge', 'utun'],
        linux: ['virbr', 'kube', 'cni'],
    };

    // ===== 2. Priority Interface Check =====
    const platformPriorities = PRIORITY_CONFIG[platform] || [];
    const virtualExcludes = [...VIRTUAL_INTERFACES.all, ...(VIRTUAL_INTERFACES[platform] || [])];

    for (const { name: ifName } of platformPriorities) {
        // Windows: Match interface names containing priority string (e.g., "Ethernet 2")
        // Unix: Match exact interface names (eth0, wlan0)
        const matchingIfaces = platform === 'win32' ? Object.keys(ifaces).filter((k) => k.includes(ifName)) : [ifName];

        for (const interfaceName of matchingIfaces) {
            const addr = findValidAddress(ifaces[interfaceName]);
            if (addr) {
                return addr;
            }
        }
    }

    // ===== 3. Fallback: Full Interface Scan =====
    const fallbackAddress = scanAllInterfaces(ifaces, virtualExcludes);
    if (fallbackAddress) return fallbackAddress;

    // ===== 4. Final Fallback =====
    return '0.0.0.0';
}

/**
 * Scans all non-virtual interfaces for valid IPv4 addresses
 * @param {Object} ifaces - Network interfaces from os.networkInterfaces()
 * @param {string[]} excludes - Virtual interface prefixes to ignore
 * @returns {string|null} First valid IPv4 address found
 */
function scanAllInterfaces(ifaces, excludes) {
    for (const [name, addresses] of Object.entries(ifaces)) {
        // Skip interfaces with excluded prefixes (case-insensitive)
        if (excludes.some((ex) => name.toLowerCase().includes(ex.toLowerCase()))) {
            continue;
        }
        const addr = findValidAddress(addresses);
        if (addr) {
            console.log(`[Fallback] Using ${name}: ${addr}`);
            return addr;
        }
    }
    return null;
}

/**
 * Validates a network address as:
 * - IPv4 family
 * - Non-internal (not loopback)
 * - Non-APIPA (not 169.254.x.x)
 * @param {Object[]} addresses - Network interface addresses
 * @returns {string|undefined} Valid address or undefined
 */
function findValidAddress(addresses) {
    return addresses?.find(
        (addr) => addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.'), // Exclude APIPA
    )?.address;
}

/**
 * Finds the appropriate FFmpeg executable path for the current platform
 *
 * @param {string} platform - The Node.js process.platform value (darwin, linux, win32)
 * @returns {string} The first valid FFmpeg path found, or the default path for the platform
 *
 * @description
 * This function handles FFmpeg path detection across different operating systems.
 * It checks common installation locations and returns the first accessible path.
 * If no valid path is found, it returns the first default path for the platform.
 */
function getFFmpegPath(platform) {
    // Common FFmpeg installation paths organized by platform
    const paths = {
        // macOS (Homebrew default locations)
        darwin: [
            '/usr/local/bin/ffmpeg', // Traditional Homebrew location
            '/opt/homebrew/bin/ffmpeg', // Apple Silicon Homebrew location
        ],
        // Linux (common package manager locations)
        linux: [
            '/usr/bin/ffmpeg', // System package manager installation
            '/usr/local/bin/ffmpeg', // Manual compilation default
        ],
        // Windows (common installation paths)
        win32: [
            'C:\\ffmpeg\\bin\\ffmpeg.exe', // Standard FFmpeg Windows installation
            'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe', // Program Files installation
        ],
    };

    // Get platform-specific paths or default to Linux paths if platform not recognized
    const platformPaths = paths[platform] || ['/usr/bin/ffmpeg'];

    // Try to find the first existing accessible path
    for (const path of platformPaths) {
        try {
            // Check if the path exists and is accessible
            fs.accessSync(path);
            return path;
        } catch (e) {
            // Path not accessible, try next one
            continue;
        }
    }

    // If no path was accessible, return the first default path for the platform
    // This allows the calling code to handle the "not found" case with proper error messaging
    return platformPaths[0];
}
