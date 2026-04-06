'use strict';

const nodemailer = require('nodemailer');
const icalGenerator = require('ical-generator').default;
const { isValidEmail } = require('../Validator');
const config = require('../config');
const Logger = require('../Logger');
const log = new Logger('NodeMailer');

const APP_NAME = config.ui.brand.app.name || 'MiroTalk SFU';

// ####################################################
// EMAIL CONFIG
// ####################################################

const emailConfig = config.integrations?.email || {};
const EMAIL_ALERT = emailConfig.alert || false;
const EMAIL_NOTIFY = emailConfig.notify || false;
const EMAIL_HOST = emailConfig.host || false;
const EMAIL_PORT = emailConfig.port || false;
const EMAIL_USERNAME = emailConfig.username || false;
const EMAIL_PASSWORD = emailConfig.password || false;
const EMAIL_FROM = emailConfig.from || emailConfig.username;
const EMAIL_SEND_TO = emailConfig.sendTo || false;

if ((EMAIL_ALERT || EMAIL_NOTIFY) && EMAIL_HOST && EMAIL_PORT && EMAIL_USERNAME && EMAIL_PASSWORD && EMAIL_SEND_TO) {
    log.info('Email', {
        alert: EMAIL_ALERT,
        notify: EMAIL_NOTIFY,
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

    log.debug('sendEMailAlert', {
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
        case 'widget':
            subject = getWidgetRoomSubject(data);
            body = getWidgetRoomBody(data);
            break;
        case 'alert':
            subject = getAlertSubject(data);
            body = getAlertBody(data);
            break;
        default:
            break;
    }

    if (subject && body) {
        sendEmail(subject, body);
        return true;
    }
    return false;
}

function sendEmailNotifications(event, data, notifications) {
    if (!EMAIL_NOTIFY || !EMAIL_HOST || !EMAIL_PORT || !EMAIL_USERNAME || !EMAIL_PASSWORD) return;

    log.debug('sendEmailNotifications', {
        event: event,
        data: data,
        notifications: notifications,
    });

    let subject = false;
    let body = false;

    switch (event) {
        case 'join':
            subject = getJoinRoomSubject(data);
            body = getJoinRoomBody(data);
            break;
        // left...
        default:
            break;
    }

    const emailSendTo = notifications?.mode?.email;

    if (subject && body && isValidEmail(emailSendTo)) {
        sendEmail(subject, body, emailSendTo);
        return true;
    }
    log.error('sendEmailNotifications: Invalid email', { email: emailTo });
    return false;
}

function sendEmail(subject, body, emailSendTo = false) {
    transport
        .sendMail({
            from: EMAIL_FROM,
            to: emailSendTo ? emailSendTo : EMAIL_SEND_TO,
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
    return `${APP_NAME} - New user Join to Room ${room_id}`;
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

// ==========
// Widget
// ==========

function getWidgetRoomSubject(data) {
    const { room_id } = data;
    return `${APP_NAME} WIDGET - New user Wait for expert assistance in Room ${room_id}`;
}

function getWidgetRoomBody(data) {
    return getJoinRoomBody(data);
}

// ==========
// Alert
// ==========

function getAlertSubject(data) {
    const { subject } = data;
    return subject || `${APP_NAME} - Alert`;
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

// ####################################################
// SCHEDULE MEETING
// ####################################################

async function sendScheduleMeeting(data) {
    if (!EMAIL_HOST || !EMAIL_PORT || !EMAIL_USERNAME || !EMAIL_PASSWORD) {
        throw new Error('Email is not configured');
    }

    const { title, description, dateTime, duration, recipients, roomName, hostUrl } = data;

    const start = new Date(dateTime);
    const end = new Date(start.getTime() + duration * 60 * 1000);
    const roomUrl = `${hostUrl}/join/?room=${encodeURIComponent(roomName)}`;

    // Generate .ics content using ical-generator
    const calendar = icalGenerator({ name: APP_NAME, method: 'REQUEST' });
    const event = calendar.createEvent({
        start: start,
        end: end,
        summary: title,
        description: `${description ? description + '\n\n' : ''}Join the meeting: ${roomUrl}`,
        url: roomUrl,
        status: 'CONFIRMED',
        organizer: { name: APP_NAME, email: EMAIL_FROM },
    });
    recipients.forEach((email) => event.createAttendee({ email, rsvp: true, role: 'REQ-PARTICIPANT' }));
    const icsContent = calendar.toString();

    const subject = `${APP_NAME} - Meeting Invitation: ${title}`;
    const body = getScheduleMeetingBody({ title, description, roomUrl, start, end, duration });

    const promises = recipients.map((recipient) => {
        return transport.sendMail({
            from: EMAIL_FROM,
            to: recipient,
            subject: subject,
            html: body,
            icalEvent: {
                filename: 'meeting.ics',
                method: 'REQUEST',
                content: icsContent,
            },
        });
    });

    await Promise.all(promises);

    log.debug('Schedule meeting emails sent', { title, roomName, recipients });
}

function getScheduleMeetingBody(data) {
    const { title, description, roomUrl, start, end, duration } = data;

    const formatDate = (d) =>
        d.toLocaleString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });

    return `
        <div style="font-family: arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333;">📅 Meeting Invitation</h1>
            <h2 style="color: #555;">${title}</h2>
            ${description ? `<p style="color: #666;">${description}</p>` : ''}
            <table style="font-family: arial, sans-serif; border-collapse: collapse; width: 100%; margin: 20px 0;">
                <tr>
                    <td style="border: 1px solid #ddd; padding: 10px; font-weight: bold;">📅 Date & Time</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">${formatDate(start)}</td>
                </tr>
                <tr style="background-color: #f9f9f9;">
                    <td style="border: 1px solid #ddd; padding: 10px; font-weight: bold;">⏱️ Duration</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">${duration} minutes</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 10px; font-weight: bold;">🔗 Join Link</td>
                    <td style="border: 1px solid #ddd; padding: 10px;">
                        <a href="${roomUrl}" style="color: #0270D7;">${roomUrl}</a>
                    </td>
                </tr>
            </table>
            <p style="margin-top: 20px;">
                <a href="${roomUrl}" 
                   style="display: inline-block; padding: 12px 24px; background-color: #0270D7; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
                    Join Meeting
                </a>
            </p>
            <p style="color: #999; font-size: 12px; margin-top: 20px;">
                This invitation was sent via ${APP_NAME}. A calendar event (.ics) is attached.
            </p>
        </div>
    `;
}

module.exports = {
    sendEmailAlert,
    sendEmailNotifications,
    sendScheduleMeeting,
};
