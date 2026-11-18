'use strict';

require('should');

const {
    buildIcs,
    formatMeetingTime,
    formatDuration,
    parseLocalDateTime,
    parseDuration,
    escapeText,
    foldLine,
    toUtcStamp,
    toFileName,
} = require('../public/js/CalendarInvite');

const utf8Bytes = (text) => Buffer.byteLength(text, 'utf8');

function unfold(ics) {
    return ics.replace(/\r\n /g, '');
}

describe('test-CalendarInvite', () => {
    describe('parseLocalDateTime', () => {
        it('parses the flatpickr value as local time', () => {
            const date = parseLocalDateTime('2026-11-18 09:30');
            date.getFullYear().should.equal(2026);
            date.getMonth().should.equal(10);
            date.getDate().should.equal(18);
            date.getHours().should.equal(9);
            date.getMinutes().should.equal(30);
        });

        it('rejects empty, malformed and impossible dates', () => {
            (parseLocalDateTime('') === null).should.be.true();
            (parseLocalDateTime(undefined) === null).should.be.true();
            (parseLocalDateTime('tomorrow') === null).should.be.true();
            (parseLocalDateTime('2026-02-30 10:00') === null).should.be.true();
            (parseLocalDateTime('2026-11-18 25:00') === null).should.be.true();
        });
    });

    describe('parseDuration', () => {
        it('accepts whole minutes between 1 and 1440', () => {
            parseDuration('60').should.equal(60);
            parseDuration(1).should.equal(1);
            parseDuration(' 1440 ').should.equal(1440);
        });

        it('rejects invalid durations', () => {
            [0, '0', '1441', '-5', '1.5', 'abc', '', null, undefined].forEach((value) => {
                (parseDuration(value) === null).should.be.true(`expected ${value} to be rejected`);
            });
        });
    });

    describe('escapeText', () => {
        it('escapes iCalendar TEXT special characters', () => {
            escapeText('a\\b;c,d\ne\r\nf').should.equal('a\\\\b\\;c\\,d\\ne\\nf');
        });
    });

    describe('foldLine', () => {
        it('keeps short lines unchanged', () => {
            foldLine('SUMMARY:Hello').should.equal('SUMMARY:Hello');
        });

        it('folds at 75 octets without splitting multi-byte characters', () => {
            const line = 'DESCRIPTION:' + 'Ünïcødé 会议 😀 '.repeat(20);
            const folded = foldLine(line);
            folded.split('\r\n').forEach((part) => (utf8Bytes(part) <= 75).should.be.true());
            folded.replace(/\r\n /g, '').should.equal(line);
        });
    });

    describe('buildIcs', () => {
        const start = new Date(Date.UTC(2026, 10, 18, 8, 30));
        const now = new Date(Date.UTC(2026, 10, 17, 12, 0, 5));
        const url = 'https://sfu.mirotalk.com/join/my-room?name=a,b';

        const ics = buildIcs({
            title: 'MiroTalk SFU meeting: my-room',
            description: 'Click to join: ' + url + '\nPassword: p;w,d',
            url,
            start,
            durationMinutes: 90,
            uid: 'abc-123@sfu.mirotalk.com',
            now,
        });

        it('produces a valid VCALENDAR with CRLF line endings', () => {
            ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n').should.be.true();
            ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n').should.be.true();
            ics.replace(/\r\n/g, '').includes('\n').should.be.false();
            ics.split('\r\n').forEach((line) => (utf8Bytes(line) <= 75).should.be.true());
        });

        it('uses UTC start, end and stamp times', () => {
            const text = unfold(ics);
            text.should.containEql('DTSTART:20261118T083000Z\r\n');
            text.should.containEql('DTEND:20261118T100000Z\r\n');
            text.should.containEql('DTSTAMP:20261117T120005Z\r\n');
            text.should.containEql('UID:abc-123@sfu.mirotalk.com\r\n');
        });

        it('escapes text values but keeps the URL property raw', () => {
            const text = unfold(ics);
            text.should.containEql('SUMMARY:MiroTalk SFU meeting: my-room\r\n');
            text.should.containEql(
                'DESCRIPTION:Click to join: https://sfu.mirotalk.com/join/my-room?name=a\\,b\\nPassword: p\\;w\\,d\r\n'
            );
            text.should.containEql(`URL:${url}\r\n`);
            text.should.containEql('LOCATION:https://sfu.mirotalk.com/join/my-room?name=a\\,b\r\n');
        });

        it('rejects invalid start dates and durations', () => {
            (() => buildIcs({ title: 't', start: new Date('x'), durationMinutes: 60 })).should.throw(
                'Invalid start date'
            );
            (() => buildIcs({ title: 't', start, durationMinutes: 0 })).should.throw('Invalid duration');
        });
    });

    describe('formatDuration', () => {
        it('uses hours and minutes', () => {
            formatDuration(1).should.equal('1 minute');
            formatDuration(45).should.equal('45 minutes');
            formatDuration(60).should.equal('1 hour');
            formatDuration(90).should.equal('1 hour 30 minutes');
            formatDuration(121).should.equal('2 hours 1 minute');
        });
    });

    describe('formatMeetingTime', () => {
        const start = new Date(Date.UTC(2026, 10, 20, 13, 30));

        it('formats date, 24h time range and time zone', () => {
            formatMeetingTime({ start, durationMinutes: 45, timeZone: 'Europe/Belgrade', hour12: false }).should.eql({
                date: 'Friday, November 20, 2026',
                time: '14:30 – 15:15',
                timeZone: 'GMT+01:00, Europe/Belgrade',
                duration: '45 minutes',
            });
        });

        it('formats 12h time without a leading zero', () => {
            const when = formatMeetingTime({ start, durationMinutes: 90, timeZone: 'America/New_York', hour12: true });
            when.time.should.equal('8:30 AM – 10:00 AM');
            when.timeZone.should.equal('GMT-05:00, America/New_York');
            when.duration.should.equal('1 hour 30 minutes');
        });

        it('marks meetings that end the next day', () => {
            const late = new Date(Date.UTC(2026, 10, 20, 22, 30));
            formatMeetingTime({
                start: late,
                durationMinutes: 120,
                timeZone: 'Europe/Belgrade',
                hour12: false,
            }).time.should.equal('23:30 – 01:30 (next day)');
        });

        it('uses the offset in effect on the meeting date (DST)', () => {
            const summer = new Date(Date.UTC(2026, 6, 1, 12, 0));
            formatMeetingTime({
                start: summer,
                durationMinutes: 30,
                timeZone: 'Europe/Belgrade',
                hour12: false,
            }).timeZone.should.equal('GMT+02:00, Europe/Belgrade');
        });

        it('shows UTC with an explicit zero offset', () => {
            formatMeetingTime({ start, durationMinutes: 60, timeZone: 'UTC', hour12: false }).timeZone.should.equal(
                'GMT+00:00, UTC'
            );
        });

        it('rejects invalid input', () => {
            (() => formatMeetingTime({ start: new Date('x'), durationMinutes: 60 })).should.throw('Invalid start date');
            (() => formatMeetingTime({ start, durationMinutes: 0 })).should.throw('Invalid duration');
        });
    });

    describe('toFileName', () => {
        it('creates a safe .ics file name', () => {
            toFileName('my-room').should.equal('my-room.ics');
            toFileName('../a b/c?').should.equal('a_b_c.ics');
            toFileName('').should.equal('meeting.ics');
        });
    });

    it('formats UTC stamps without separators or milliseconds', () => {
        toUtcStamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 678))).should.equal('20260102T030405Z');
    });
});
