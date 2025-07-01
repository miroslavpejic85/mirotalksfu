'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');
const Logger = require('../Logger');
const log = new Logger('NodeMailer');

// ####################################################
// EMAIL CONFIG
// ####################################################

const emailConfig = config.integrations?.email || {};
const EMAIL_ALERT = emailConfig.alert || false;
const EMAIL_HOST = emailConfig.host || false;
const EMAIL_PORT = emailConfig.port || false;
const EMAIL_USERNAME = emailConfig.username || false;
const EMAIL_PASSWORD = emailConfig.password || false;
const EMAIL_FROM = emailConfig.from || emailConfig.username;
const EMAIL_SEND_TO = emailConfig.sendTo || false;

if (EMAIL_ALERT && EMAIL_HOST && EMAIL_PORT && EMAIL_USERNAME && EMAIL_PASSWORD && EMAIL_SEND_TO) {
    log.info('Email', {
        alert: EMAIL_ALERT,
        host: EMAIL_HOST,
        port: EMAIL_PORT,
        username: EMAIL_USERNAME,
        password: EMAIL_PASSWORD,
        from: EMAIL_FROM,
        to: EMAIL_SEND_TO,
    });
}

const IS_TLS_PORT = EMAIL_PORT === 465;
const transport = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: IS_TLS_PORT,
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
        case 'alert':
            subject = getAlertSubject(data);
            body = getAlertBody(data);
            break;
        //...
        default:
            break;
    }

    if (subject && body) sendEmail(subject, body);
}

function sendEmail(subject, body) {
    transport
        .sendMail({
            from: EMAIL_FROM,
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

function getAlertSubject(data) {
    const { subject } = data;
    return subject || 'MiroTalk SFU - Alert';
}

function getAlertBody(data) {
    const { body } = data;

    const currentDataTime = getCurrentDataTime();

    return `
        <h1>🚨 Alert Notification</h1>
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
                <td>⚠️ Alert</td>
                <td>${body}</td>
            </tr>
            <tr>
                <td>🕒 Date, Time</td>
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
