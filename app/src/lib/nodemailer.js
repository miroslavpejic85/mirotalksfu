'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');
const Logger = require('../Logger');
const log = new Logger('NodeMailer');

// ####################################################
// EMAIL CONFIG
// ####################################################

const EMAIL_HOST = config.email ? config.email.host : false;
const EMAIL_PORT = config.email ? config.email.port : false;
const EMAIL_USERNAME = config.email ? config.email.username : false;
const EMAIL_PASSWORD = config.email ? config.email.password : false;
const EMAIL_SEND_TO = config.email ? config.email.sendTo : false;
const EMAIL_ALERT = config.email ? config.email.alert : false;

if (EMAIL_ALERT && EMAIL_HOST && EMAIL_PORT && EMAIL_USERNAME && EMAIL_PASSWORD && EMAIL_SEND_TO) {
    log.info('Email', {
        alert: EMAIL_ALERT,
        host: EMAIL_HOST,
        port: EMAIL_PORT,
        username: EMAIL_USERNAME,
        password: EMAIL_PASSWORD,
    });
}

const transport = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    auth: {
        user: EMAIL_USERNAME,
        pass: EMAIL_PASSWORD,
    },
});

// ####################################################
// EMAIL SEND ALERTS AND NOTIFICATIONS
// ####################################################

function sendEmailAlert(event, data) {
    if (!EMAIL_ALERT || !EMAIL_HOST || !EMAIL_PORT || !EMAIL_USERNAME || !EMAIL_PASSWORD || !EMAIL_SEND_TO) return;

    log.info('sendEMailAlert', {
        event: event,
        data: data,
    });

    let subject = false;
    let body = false;

    switch (event) {
        case 'join':
            subject = getJoinRoomSubject(data);
            body = getJoinRoomBody(data);
            break;
        // ...
        default:
            break;
    }

    if (subject && body) sendEmail(subject, body);
}

function sendEmail(subject, body) {
    transport
        .sendMail({
            from: EMAIL_USERNAME,
            to: EMAIL_SEND_TO,
            subject: subject,
            html: body,
        })
        .catch((err) => log.error(err));
}

// ####################################################
// EMAIL TEMPLATES
// ####################################################

function getJoinRoomSubject(data) {
    const { room_id } = data;
    return `MiroTalk SFU - New user Join to Room ${room_id}`;
}
function getJoinRoomBody(data) {
    const { peer_name, room_id, domain, os, browser } = data;

    const currentDataTime = getCurrentDataTime();

    const localDomains = ['localhost', '127.0.0.1'];

    const currentDomain = localDomains.some((localDomain) => domain.includes(localDomain))
        ? `${domain}:${config.server.listen.port}`
        : domain;

    const room_join = `https://${currentDomain}/join/`;

    return `
        <h1>New user join</h1>
        <style>
            table {
                font-family: arial, sans-serif;
                border-collapse: collapse;
                width: 100%;
            }
            td {
                border: 1px solid #dddddd;
                text-align: left;
                padding: 8px;
            }
            tr:nth-child(even) {
                background-color: #dddddd;
            }
        </style>
        <table>
            <tr>
                <td>User</td>
                <td>${peer_name}</td>
            </tr>
            <tr>
                <td>Os</td>
                <td>${os}</td>
            </tr>
            <tr>
                <td>Browser</td>
                <td>${browser}</td>
            </tr>
            <tr>
                <td>Room</td>
                <td>${room_join}${room_id}</td>
            </tr>
            <tr>
                <td>Date, Time</td>
                <td>${currentDataTime}</td>
            </tr>
        </table>
    `;
}

// ####################################################
// UTILITY
// ####################################################

function getCurrentDataTime() {
    const currentTime = new Date().toLocaleString('en-US', log.tzOptions);
    const milliseconds = String(new Date().getMilliseconds()).padStart(3, '0');
    return `${currentTime}:${milliseconds}`;
}

module.exports = {
    sendEmailAlert,
};
