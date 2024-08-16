'use strict';

// npx mocha checkXSS.js

require('should');

const checkXSS = require('../app/src/Validator');

describe('checkValidator', () => {
    describe('1. Handling valid room name', () => {
        it('should return false for non-string inputs', () => {
            checkXSS.isValidRoomName(123).should.be.false();
            checkXSS.isValidRoomName({}).should.be.false();
            checkXSS.isValidRoomName([]).should.be.false();
            checkXSS.isValidRoomName(null).should.be.false();
            checkXSS.isValidRoomName(undefined).should.be.false();
        });

        it('should return true for valid room name', () => {
            checkXSS.isValidRoomName('Room1').should.be.true();
            checkXSS.isValidRoomName('ConferenceRoom').should.be.true();
            checkXSS.isValidRoomName('Room_123').should.be.true();
            checkXSS.isValidRoomName('30521HungryHat').should.be.true();
            checkXSS.isValidRoomName('dbc4a9d9-6879-479a-b8fe-cedaad176b0d').should.be.true();
        });

        it('should return false for room name with path traversal', () => {
            checkXSS.isValidRoomName('../etc/passwd').should.be.false();
            checkXSS.isValidRoomName('..\\etc\\passwd').should.be.false();
            checkXSS.isValidRoomName('Room/../../etc').should.be.false();
            checkXSS.isValidRoomName('Room\\..\\..\\etc').should.be.false();
        });

        it('should return true for room names with special characters that do not imply path traversal', () => {
            checkXSS.isValidRoomName('Room_@!#$%^&*()').should.be.true();
            checkXSS.isValidRoomName('Room-Name').should.be.true();
            checkXSS.isValidRoomName('Room.Name').should.be.true();
        });
    });

    describe('2. Handling valid recording file name', () => {
        it('should return false for non-string inputs', () => {
            checkXSS.isValidRecFileNameFormat(123).should.be.false();
            checkXSS.isValidRecFileNameFormat({}).should.be.false();
            checkXSS.isValidRecFileNameFormat([]).should.be.false();
            checkXSS.isValidRecFileNameFormat(null).should.be.false();
            checkXSS.isValidRecFileNameFormat(undefined).should.be.false();
        });

        it('should return false for strings that do not start with "Rec_" or end with ".webm"', () => {
            checkXSS.isValidRecFileNameFormat('Recording.webm').should.be.false();
            checkXSS.isValidRecFileNameFormat('Rec_Recording.mp4').should.be.false();
            checkXSS.isValidRecFileNameFormat('rec_Recording.webm').should.be.false();
            checkXSS.isValidRecFileNameFormat('RecordingRec_.webm').should.be.false();
        });

        it('should return true for valid recording file name format', () => {
            checkXSS.isValidRecFileNameFormat('Rec_Meeting1.webm').should.be.true();
            checkXSS.isValidRecFileNameFormat('Rec_Session_2024.webm').should.be.true();
            checkXSS.isValidRecFileNameFormat('Rec_Test.webm').should.be.true();
        });

        it('should return false for recording file name format with path traversal', () => {
            checkXSS.isValidRecFileNameFormat('../Rec_Test.webm').should.be.false();
            checkXSS.isValidRecFileNameFormat('Rec_../Test.webm').should.be.false();
            checkXSS.isValidRecFileNameFormat('Rec_Test/../../config.webm').should.be.false();
            checkXSS.isValidRecFileNameFormat('Rec_Test\\..\\..\\config.webm').should.be.false();
        });
    });

    describe('3. Handle path traversal', () => {
        it('should return false for strings without path traversal', () => {
            checkXSS.hasPathTraversal('Room1').should.be.false();
            checkXSS.hasPathTraversal('Rec_Test.webm').should.be.false();
            checkXSS.hasPathTraversal('simple/path').should.be.false();
        });

        it('should return true for strings with path traversal', () => {
            checkXSS.hasPathTraversal('../etc/passwd').should.be.true();
            checkXSS.hasPathTraversal('..\\etc\\passwd').should.be.true();
            checkXSS.hasPathTraversal('Room/../../etc').should.be.true();
            checkXSS.hasPathTraversal('Room\\..\\..\\etc').should.be.true();
        });

        it('should return false for strings with ".." that do not indicate path traversal', () => {
            checkXSS.hasPathTraversal('Room..').should.be.false();
            checkXSS.hasPathTraversal('Rec..webm').should.be.false();
            checkXSS.hasPathTraversal('NoPathTraversalHere..').should.be.false();
        });

        it('should return true for complex path traversal patterns', () => {
            checkXSS.hasPathTraversal('....//').should.be.true();
            checkXSS.hasPathTraversal('..\\..\\').should.be.true();
            checkXSS.hasPathTraversal('.../../').should.be.true();
        });
    });
});
