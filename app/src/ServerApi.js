'use strict';

const { encrypt } = require('../helper/encoder_decoder');
const config = require('./config');
const { v4: uuidV4 } = require('uuid');

module.exports = class ServerApi {
    constructor(host = null, authorization = null) {
        this._host = host;
        this._authorization = authorization;
        this._api_key_secret = config.api.keySecret;
    }

    isAuthorized() {
        // if (this._authorization != this._api_key_secret) return false;
        return true;
    }

    getMeetingURL() {
        let isHttps = config.server.ishttps;

        if (isHttps) {
            return 'https://' + this._host + '/join/' + uuidV4();
        }
        else{
            return 'http://' + this._host + '/join/' + uuidV4();
        }
    }

    getJoinURL(data) {
        let isHttps = config.server.ishttps;
        const encrypt_room_data = encrypt(data)

        if (isHttps) {
            return 'https://' +this._host +'/join/?meeting='+encrypt_room_data
        }
        else{
            return 'http://' +this._host +'/join/?meeting='+encrypt_room_data
        }
    }
};
