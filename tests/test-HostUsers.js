'use strict';

// npx mocha tests/test-HostUsers.js

require('should');

const { parseHostUsers, findHostUser } = require('../app/src/HostUsers');

describe('test-HostUsers', () => {
    describe('compact format', () => {
        it('parses users, display names and allowed rooms', () => {
            parseHostUsers('alice:pw1:Alice:*|bob:pw2:Bob:room1, room2').should.eql([
                { username: 'alice', password: 'pw1', displayname: 'Alice', allowed_rooms: ['*'] },
                { username: 'bob', password: 'pw2', displayname: 'Bob', allowed_rooms: ['room1', 'room2'] },
            ]);
        });

        it('defaults displayname to empty and allowed_rooms to all', () => {
            parseHostUsers('alice:pw1').should.eql([
                { username: 'alice', password: 'pw1', displayname: '', allowed_rooms: ['*'] },
            ]);
            parseHostUsers('alice:pw1:Alice:').should.eql([
                { username: 'alice', password: 'pw1', displayname: 'Alice', allowed_rooms: ['*'] },
            ]);
        });

        it('ignores empty entries and surrounding whitespace', () => {
            parseHostUsers(' alice:pw1 || bob:pw2 ')
                .map((u) => u.username)
                .should.eql(['alice', 'bob']);
        });

        it('rejects malformed entries without leaking the password', () => {
            (() => parseHostUsers('ok:pw|justaname')).should.throw(/entry #2 is malformed/);
            let message = '';
            try {
                parseHostUsers('alice:Sup3r:Secret:Alice:*');
            } catch (err) {
                message = err.message;
            }
            message.should.match(/entry #1 is malformed/);
            message.should.not.containEql('Sup3r');
            message.should.not.containEql('Secret');
        });
    });

    describe('JSON format', () => {
        it('parses users and normalizes missing fields', () => {
            parseHostUsers(
                '[{"username":"alice","password":"p:w|1,x","displayname":"Alice","allowed_rooms":["r1"]},{"username":"bob","password":"pw2"}]'
            ).should.eql([
                { username: 'alice', password: 'p:w|1,x', displayname: 'Alice', allowed_rooms: ['r1'] },
                { username: 'bob', password: 'pw2', displayname: '', allowed_rooms: ['*'] },
            ]);
        });

        it('accepts allowed_rooms as a comma-separated string', () => {
            parseHostUsers('[{"username":"a","password":"b","allowed_rooms":"r1,r2"}]')[0].allowed_rooms.should.eql([
                'r1',
                'r2',
            ]);
        });

        it('normalizes an already parsed array (older config.js)', () => {
            parseHostUsers('[]').should.eql([]);
            parseHostUsers([{ username: 'a', password: 'b' }]).should.eql([
                { username: 'a', password: 'b', displayname: '', allowed_rooms: ['*'] },
            ]);
        });

        it('rejects invalid JSON', () => {
            (() => parseHostUsers('[{"username":')).should.throw(/not valid JSON/);
            (() => parseHostUsers('[1')).should.throw(/not valid JSON/);
        });

        it('keeps invalid entries as null so startup validation rejects them', () => {
            parseHostUsers('[null, "x"]').should.eql([null, null]);
        });
    });

    it('returns an empty list when unset', () => {
        parseHostUsers(undefined).should.eql([]);
        parseHostUsers('').should.eql([]);
        parseHostUsers('   ').should.eql([]);
    });

    describe('findHostUser', () => {
        const users = parseHostUsers('alice:pw1:Alice:*|bob:pw2');

        it('returns the user matching username and password', () => {
            findHostUser(users, 'alice', 'pw1').displayname.should.equal('Alice');
        });

        it('does not match on wrong password or display name', () => {
            (findHostUser(users, 'alice', 'pw2') === null).should.be.true();
            (findHostUser(users, 'Alice', 'pw1') === null).should.be.true();
        });

        it('handles missing or invalid user lists', () => {
            (findHostUser(undefined, 'alice', 'pw1') === null).should.be.true();
            (findHostUser([null], 'alice', 'pw1') === null).should.be.true();
        });
    });
});
