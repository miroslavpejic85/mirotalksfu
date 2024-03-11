'use strict';

const os = require('os');
const ifaces = os.networkInterfaces();

const getLocalIp = () => {
    let localIp = '127.0.0.1';
    let checkIp = true;
    Object.keys(ifaces).forEach((ifname) => {
        for (const iface of ifaces[ifname]) {
            // Ignore IPv6 and 127.0.0.1
            if (iface.family !== 'IPv4' || iface.internal !== false || checkIp === false) {
                continue;
            }
            // Set the local ip to the first IPv4 address found and exit the loop
            localIp = iface.address;
            checkIp = false;
            return;
        }
    });
    return localIp;
};

// https://api.ipify.org

module.exports = {
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
            dir: 'rec',
            enabled: false,
        },
    },
    host: {
        /*
            Host Protection (default: false)
            To enhance host security, enable host protection - user auth and provide valid
            usernames and passwords in the users array or active users_from_db using users_api_endpoint for check.
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
            },
            {
                username: 'username2',
                password: 'password2',
            },
            //...
        ],
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
    ui: {
        /*
            Toggle the visibility of specific HTML elements within the room
        */
        buttons: {
            main: {
                shareButton: true,
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
                micOptionsButton: true, // presenter
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
    console: {
        /*
            timeZone: Time Zone corresponding to timezone identifiers from the IANA Time Zone Database es 'Europe/Rome' default UTC
        */
        timeZone: 'UTC',
        debug: true,
        colors: true,
    },
    ngrok: {
        /* 
        Ngrok
            1. Goto https://ngrok.com
            2. Get started for free 
            3. Copy YourNgrokAuthToken: https://dashboard.ngrok.com/get-started/your-authtoken
        */
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
        numWorkers: require('os').cpus().length,
        worker: {
            rtcMinPort: 40000,
            rtcMaxPort: 40100,
            logLevel: 'error',
            logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp', 'rtx', 'bwe', 'score', 'simulcast', 'svc', 'sctp'],
        },
        // Router settings
        router: {
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
                { protocol: 'udp', ip: '0.0.0.0', announcedAddress: getLocalIp(), port: 44444 },
                { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: getLocalIp(), port: 44444 },
            ],
        },
        // WebRtcTransportOptions
        webRtcTransport: {
            listenInfos: [
                { protocol: 'udp', ip: '0.0.0.0', announcedAddress: getLocalIp() },
                { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: getLocalIp() },
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
