'use strict';

require('should');

const RoomPassword = require('../app/src/RoomPassword');

describe('test-RoomPassword', () => {
    beforeEach(() => RoomPassword.reset());

    it('compares passwords', () => {
        RoomPassword.passwordMatches('abc', 'abc').should.be.true();
        RoomPassword.passwordMatches('abc', 'abd').should.be.false();
        RoomPassword.passwordMatches('abc', undefined).should.be.false();
        RoomPassword.passwordMatches(undefined, 'abc').should.be.false();
        RoomPassword.passwordMatches(undefined, undefined).should.be.true();
    });

    it('blocks after max failures per ip and room, and expires after the window', () => {
        const t = 1000;
        for (let i = 0; i < RoomPassword.MAX_FAILED_ATTEMPTS; i++) {
            RoomPassword.isBlocked('1.1.1.1', 'r', t).should.be.false();
            RoomPassword.recordFailure('1.1.1.1', 'r', t);
        }
        RoomPassword.isBlocked('1.1.1.1', 'r', t).should.be.true();
        RoomPassword.isBlocked('2.2.2.2', 'r', t).should.be.false();
        RoomPassword.isBlocked('1.1.1.1', 'other', t).should.be.false();
        RoomPassword.isBlocked('1.1.1.1', 'r', t + RoomPassword.WINDOW_MS + 1).should.be.false();
    });

    it('clears failures on success', () => {
        for (let i = 0; i < RoomPassword.MAX_FAILED_ATTEMPTS - 1; i++) RoomPassword.recordFailure('1.1.1.1', 'r');
        RoomPassword.recordSuccess('1.1.1.1', 'r');
        RoomPassword.recordFailure('1.1.1.1', 'r');
        RoomPassword.isBlocked('1.1.1.1', 'r').should.be.false();
    });
});
