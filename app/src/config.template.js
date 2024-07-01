'use strict';

const os = require('os');

// https://api.ipify.org

function getIPv4() {
    const ifaces = os.networkInterfaces();
    for (const interfaceName in ifaces) {
        const iface = ifaces[interfaceName];
        for (const { address, family, internal } of iface) {
            if (family === 'IPv4' && !internal) {
                return address;
            }
        }
    }
    return '0.0.0.0'; // Default to 0.0.0.0 if no external IPv4 address found
}

const IPv4 = getIPv4();

const numWorkers = require('os').cpus().length;

module.exports = {
    console: {
        /*
            timeZone: Time Zone corresponding to timezone identifiers from the IANA Time Zone Database es 'Europe/Rome' default UTC
        */
        timeZone: 'UTC',
        debug: true,
        colors: true,
    },
    server: {
        listen: {
            // app listen on
            ip: '0.0.0.0',
            port: process.env.PORT || 3010,
        },
        ssl: {
            // ssl/README.md
            cert: '../ssl/cert.pem',
            key: '../ssl/key.pem',
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
                - ffmpeg: Path of the ffmpeg installation on the system (which ffmpeg)

                Important: Ensure your RTMP server is operational before proceeding. You can start the server by running the following command:
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
            ffmpeg: '/usr/bin/ffmpeg',
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
            meetings: false,
            meeting: true,
            join: true,
            token: false,
            slack: true,
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
        //users_api_endpoint: 'http://localhost:9000/api/v1/user/isAuth',
        users_api_endpoint: 'https://webrtc.mirotalk.com/api/v1/user/isAuth',
        users_api_secret_key: 'mirotalkweb_default_secret',
        users: [
            {
                username: 'username',
                password: 'password',
                allowed_rooms: ['*'],
            },
            {
                username: 'username2',
                password: 'password2',
                allowed_rooms: ['room1', 'room2'],
            },
            {
                username: 'username3',
                password: 'password3',
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
            'You are a streaming avatar from MiroTalk SFU, an industry-leading product that specialize in videos communications. Audience will try to have a conversation with you, please try answer the questions or respond their comments naturally, and concisely. - please try your best to response with short answers, and only answer the last question.',
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
        */
        brand: {
            app: {
                name: 'MiroTalk SFU',
                title: 'MiroTalk SFU<br />Free browser based Real-time video calls.<br />Simple, Secure, Fast.',
                description:
                    'Start your next video call with a single click. No download, plug-in, or login is required. Just get straight to talking, messaging, and sharing your screen.',
            },
            site: {
                title: 'MiroTalk SFU, Free Video Calls, Messaging and Screen Sharing',
                icon: '../images/logo.svg',
                appleTouchIcon: '../images/logo.svg',
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
                teams: true, // Please keep me always visible, thank you!
                tryEasier: true,
                poweredBy: true,
                sponsors: true,
                advertisers: true,
                footer: true,
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
                raiseHandButton: true,
                transcriptionButton: true,
                whiteboardButton: true,
                emojiRoomButton: true,
                settingsButton: true,
                aboutButton: true, // Please keep me always visible, thank you!
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
            },
            producerVideo: {
                videoPictureInPicture: true,
                fullScreenButton: true,
                snapShotButton: true,
                muteAudioButton: true,
                videoPrivacyButton: true,
            },
            consumerVideo: {
                videoPictureInPicture: true,
                fullScreenButton: true,
                snapShotButton: true,
                sendMessageButton: true,
                sendFileButton: true,
                sendVideoButton: true,
                muteVideoButton: true,
                muteAudioButton: true,
                audioVolumeInput: true, // Disabled for mobile
                geolocationButton: true, // Presenter
                banButton: true, // presenter
                ejectButton: true, // presenter
            },
            videoOff: {
                sendMessageButton: true,
                sendFileButton: true,
                sendVideoButton: true,
                muteAudioButton: true,
                audioVolumeInput: true, // Disabled for mobile
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
        numWorkers: numWorkers,
        worker: {
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
                        'profile-id': 2,
                        'x-google-start-bitrate': 1000,
                    },
                },
                {
                    kind: 'video',
                    mimeType: 'video/h264',
                    clockRate: 90000,
                    parameters: {
                        'packetization-mode': 1,
                        'profile-level-id': '4d0032',
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
                        'profile-level-id': '42e01f',
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
                // { protocol: 'udp', ip: '0.0.0.0', announcedAddress: IPv4, port: 40000 },
                // { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: IPv4, port: 40000 },
                {
                    protocol: 'udp',
                    ip: '0.0.0.0',
                    announcedAddress: IPv4,
                    portRange: { min: 40000, max: 40000 + numWorkers },
                },
                {
                    protocol: 'tcp',
                    ip: '0.0.0.0',
                    announcedAddress: IPv4,
                    portRange: { min: 40000, max: 40000 + numWorkers },
                },
            ],
        },
        // WebRtcTransportOptions
        webRtcTransport: {
            listenInfos: [
                // { protocol: 'udp', ip: IPv4, portRange: { min: 40000, max: 40100 } },
                // { protocol: 'tcp', ip: IPv4, portRange: { min: 40000, max: 40100 } },
                {
                    protocol: 'udp',
                    ip: '0.0.0.0',
                    announcedAddress: IPv4,
                    portRange: { min: 40000, max: 40100 },
                },
                {
                    protocol: 'tcp',
                    ip: '0.0.0.0',
                    announcedAddress: IPv4,
                    portRange: { min: 40000, max: 40100 },
                },
            ],
            initialAvailableOutgoingBitrate: 1000000,
            minimumAvailableOutgoingBitrate: 600000,
            maxSctpMessageSize: 262144,
            maxIncomingBitrate: 1500000,
        },
        //announcedAddress: replace by 'public static IPV4 address' https://api.ipify.org (type string --> 'xx.xxx.xxx.xx' not xx.xxx.xxx.xx)
        //announcedAddress: '' will be auto-detected on server start, for docker localPC set '127.0.0.1' otherwise the 'public static IPV4 address'
    },
};
