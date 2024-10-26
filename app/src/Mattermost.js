'use strict';

const { Client4 } = require('@mattermost/client');

const { v4: uuidV4 } = require('uuid');

const config = require('./config');

const Logger = require('./Logger');

const log = new Logger('Mattermost');

class Mattermost {
    constructor(app) {
        const {
            enabled,
            token,
            serverUrl,
            username,
            password,
            commands = '/sfu',
            texts = '/sfu',
        } = config.mattermost || {};

        if (!enabled) return; // Check if Mattermost integration is enabled

        this.app = app;
        this.allowed = config.api.allowed && config.api.allowed.mattermost;
        this.token = token;
        this.serverUrl = serverUrl;
        this.username = username;
        this.password = password;
        this.commands = commands;
        this.texts = texts;

        this.client = new Client4();
        this.client.setUrl(this.serverUrl);
        this.authenticate();
        this.setupEventHandlers();
    }

    async authenticate() {
        try {
            const user = await this.client.login(this.username, this.password);
            log.debug('--------> Logged into Mattermost as', user.username);
        } catch (error) {
            log.error('Failed to log into Mattermost:', error);
        }
    }

    setupEventHandlers() {
        this.app.post('/mattermost', (req, res) => {
            //
            if (!this.allowed) {
                return res
                    .status(403)
                    .send('This endpoint has been disabled. Please contact the administrator for further information.');
            }

            log.debug('Mattermost request received:', { header: req.header, body: req.body });

            const { token, text, command, channel_id } = req.body;
            if (token !== this.token) {
                log.error('Invalid token attempt', { token });
                return res.status(403).send('Invalid token');
            }

            const payload = { text: '', channel_id };
            if (this.processInput(command, payload, req) || this.processInput(text, payload, req)) {
                return res.json(payload);
            }

            return res.status(200).send('Command not recognized');
        });
    }

    processInput(input, payload, req) {
        for (const cmd of [...this.commands, ...this.texts]) {
            if (input.trim() === cmd.name) {
                switch (cmd.name) {
                    case '/sfu':
                        payload.text = `${cmd.message} ${this.getMeetingURL(req)}`;
                        break;
                    default:
                        break;
                }
                return true;
            }
        }
        return false;
    }

    getMeetingURL(req) {
        const host = req.headers.host;
        const protocol = host.includes('localhost') ? 'http' : 'https';
        return `${protocol}://${host}/join/${uuidV4()}`;
    }
}

module.exports = Mattermost;
