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
        // Get data...
        const { room, roomPassword, name, audio, video, screen, notify, token } = data;

        let jwtToken = '';

        if (token) {
            const { username, password, presenter, expire } = token;
            jwtToken =
                '&token=' +
                jwt.sign({ username: username, password: password, presenter: presenter }, JWT_KEY, {
                    expiresIn: expire ? expire : JWT_EXP,
                });
        }
        return (
            'https://' +
            this._host +
            '/join?room=' +
            room +
            '&roomPassword=' +
            roomPassword +
            '&name=' +
            name +
            '&audio=' +
            audio +
            '&video=' +
            video +
            '&screen=' +
            screen +
            '&notify=' +
            notify +
            jwtToken
        );
    }
};
