'use strict';

const jwt = require('jsonwebtoken');
const config = require('./config');
const { v4: uuidV4 } = require('uuid');

const JWT_KEY = (config.jwt && config.jwt.key) || 'mirotalksfu_jwt_secret';
const JWT_EXP = (config.jwt && config.jwt.exp) || '1h';

module.exports = class ServerApi {
    constructor(host = null, authorization = null) {
        this._host = host;
        this._authorization = authorization;
        this._api_key_secret = config.api.keySecret;
    }

    isAuthorized() {
        if (this._authorization != this._api_key_secret) return false;
        return true;
    }

    getMeetings(roomList) {
        const meetings = Array.from(roomList.entries()).map(([id, room]) => {
            const peers = Array.from(room.peers.values()).map(
                ({
                    peer_info: {
                        peer_name,
                        peer_presenter,
                        peer_video,
                        peer_audio,
                        peer_screen,
                        peer_hand,
                        os_name,
                        os_version,
                        browser_name,
                        browser_version,
                    },
                }) => ({
                    name: peer_name,
                    presenter: peer_presenter,
                    video: peer_video,
                    audio: peer_audio,
                    screen: peer_screen,
                    hand: peer_hand,
                    os: os_name ? `${os_name} ${os_version}` : '',
                    browser: browser_name ? `${browser_name} ${browser_version}` : '',
                }),
            );
            return {
                roomId: id,
                peers: peers,
            };
        });
        return meetings;
    }

    getMeetingURL() {
        return 'https://' + this._host + '/join/' + uuidV4();
    }

    getJoinURL(data) {
        // Get data
        const { room, roomPassword, name, audio, video, screen, notify, token } = data;

        const roomValue = room || uuidV4();
        const nameValue = name || 'User-' + this.getRandomNumber();
        const roomPasswordValue = roomPassword || false;
        const audioValue = audio || false;
        const videoValue = video || false;
        const screenValue = screen || false;
        const notifyValue = notify || false;
        const jwtToken = token ? '&token=' + this.getToken(token) : '';

        const joinURL =
            'https://' +
            this._host +
            '/join?' +
            `room=${roomValue}` +
            `&roomPassword=${roomPasswordValue}` +
            `&name=${encodeURIComponent(nameValue)}` +
            `&audio=${audioValue}` +
            `&video=${videoValue}` +
            `&screen=${screenValue}` +
            `&notify=${notifyValue}` +
            jwtToken;

        return joinURL;
    }

    getToken(token) {
        if (!token) return '';

        const { username = 'username', password = 'password', presenter = false, expire } = token;

        const expireValue = expire || JWT_EXP;

        const payload = {
            username: String(username),
            password: String(password),
            presenter: String(presenter),
        };

        const jwtToken = jwt.sign(payload, JWT_KEY, { expiresIn: expireValue });

        return jwtToken;
    }

    getRandomNumber() {
        return Math.floor(Math.random() * 999999);
    }
};
