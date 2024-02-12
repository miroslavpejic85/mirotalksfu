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

    getMeetingURL() {
        return 'https://' + this._host + '/join/' + uuidV4();
    }

    getJoinURL(data) {
        // Get data
        const { room, roomPassword, name, audio, video, screen, notify, token } = data;

        const roomValue = room || uuidV4();
        const roomPasswordValue = roomPassword || false;
        const nameValue = name || uuidV4();
        const audioValue = audio || false;
        const videoValue = video || false;
        const screenValue = screen || false;
        const notifyValue = notify || false;

        let jwtToken = '';

        if (token) {
            // JWT.io
            const { username, password, presenter, expire } = token;

            const usernameValue = username || 'username';
            const passwordValue = password || 'password';
            const presenterValue = String(presenter);
            const expireValue = expire || JWT_EXP;

            jwtToken =
                '&token=' +
                jwt.sign({ username: usernameValue, password: passwordValue, presenter: presenterValue }, JWT_KEY, {
                    expiresIn: expireValue,
                });
        }
        return (
            'https://' +
            this._host +
            '/join?room=' +
            roomValue +
            '&roomPassword=' +
            roomPasswordValue +
            '&name=' +
            nameValue +
            '&audio=' +
            audioValue +
            '&video=' +
            videoValue +
            '&screen=' +
            screenValue +
            '&notify=' +
            notifyValue +
            jwtToken
        );
    }
};
