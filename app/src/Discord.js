'use strict';

const { Client, GatewayIntentBits } = require('discord.js');

const { v4: uuidV4 } = require('uuid');

const Logger = require('./Logger');

const log = new Logger('Discord');

// Discord Bot Class Implementation
class Discord {
    constructor(token, commands) {
        this.token = token;
        this.commands = commands;
        this.discordClient = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent, // Make sure this is enabled in your Discord Developer Portal
            ],
        });

        this.setupEventHandlers();

        this.discordClient.login(this.token).catch((error) => {
            log.error('Failed to login to Discord:', error);
        });
    }

    setupEventHandlers() {
        this.discordClient.once('ready', () => {
            log.info(`Discord Bot Logged in as ${this.discordClient.user.tag}!`, '😎');
        });

        this.discordClient.on('error', (error) => {
            log.error(`Discord Client Error: ${error.message}`, { stack: error.stack });
        });

        this.discordClient.on('messageCreate', async (message) => {
            if (message.author.bot) return;

            for (const command of this.commands) {
                if (message.content.startsWith(command.name)) {
                    switch (command.name) {
                        case '/sfu':
                            const roomId = this.generateMeetingRoom(command.baseUrl);
                            await this.sendMessage(message.channel, `${command.message} ${roomId}`);
                            break;
                        //....
                        default:
                            await this.sendMessage(message.channel, command.message);
                            break;
                    }
                    break; // Exit the loop after finding the command
                }
            }
        });
    }

    generateMeetingRoom(baseUrl) {
        const roomId = uuidV4();
        return `${baseUrl}${roomId}`;
    }

    async sendMessage(channel, content) {
        try {
            await channel.send(content);
        } catch (error) {
            log.error(`Failed to send message: ${error.message}`);
        }
    }
}

module.exports = Discord;
