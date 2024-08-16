'use strict';

// npx mocha checkValidator.js

require('should');

const checkValidator = require('../app/src/Validator');

describe('checkValidator', () => {
    describe('1. Handling invalid room name', () => {
        it('should return false for non-string inputs', () => {
            checkValidator.isValidRoomName(123).should.be.false();
            checkValidator.isValidRoomName({}).should.be.false();
            checkValidator.isValidRoomName([]).should.be.false();
            checkValidator.isValidRoomName(null).should.be.false();
            checkValidator.isValidRoomName(undefined).should.be.false();
        });

        it('should return false for xss injection inputs', () => {
            checkValidator.isValidRoomName('<script>alert("xss")</script>').should.be.false();
        });

        it('should return true for valid room name', () => {
            checkValidator.isValidRoomName('Room1').should.be.true();
            checkValidator.isValidRoomName('ConferenceRoom').should.be.true();
            checkValidator.isValidRoomName('Room_123').should.be.true();
            checkValidator.isValidRoomName('30521HungryHat').should.be.true();
            checkValidator.isValidRoomName('dbc4a9d9-6879-479a-b8fe-cedaad176b0d').should.be.true();
        });

        it('should return false for room name with path traversal', () => {
            checkValidator.isValidRoomName('../etc/passwd').should.be.false();
            checkValidator.isValidRoomName('..\\etc\\passwd').should.be.false();
            checkValidator.isValidRoomName('Room/../../etc').should.be.false();
            checkValidator.isValidRoomName('Room\\..\\..\\etc').should.be.false();
        });

        it('should return true for room names with special characters that do not imply path traversal', () => {
            checkValidator.isValidRoomName('Room_@!#$%^&*()').should.be.true();
            checkValidator.isValidRoomName('Room-Name').should.be.true();
            checkValidator.isValidRoomName('Room.Name').should.be.true();
        });
    });

    describe('2. Handling valid recording file name', () => {
        it('should return false for non-string inputs', () => {
            checkValidator.isValidRecFileNameFormat(123).should.be.false();
            checkValidator.isValidRecFileNameFormat({}).should.be.false();
            checkValidator.isValidRecFileNameFormat([]).should.be.false();
            checkValidator.isValidRecFileNameFormat(null).should.be.false();
            checkValidator.isValidRecFileNameFormat(undefined).should.be.false();
        });

        it('should return false for strings that do not start with "Rec_" or end with ".webm"', () => {
            checkValidator.isValidRecFileNameFormat('Recording.webm').should.be.false();
            checkValidator.isValidRecFileNameFormat('Rec_Recording.mp4').should.be.false();
            checkValidator.isValidRecFileNameFormat('rec_Recording.webm').should.be.false();
            checkValidator.isValidRecFileNameFormat('RecordingRec_.webm').should.be.false();
        });

        it('should return true for valid recording file name format', () => {
            checkValidator.isValidRecFileNameFormat('Rec_Meeting1.webm').should.be.true();
            checkValidator.isValidRecFileNameFormat('Rec_Session_2024.webm').should.be.true();
            checkValidator.isValidRecFileNameFormat('Rec_Test.webm').should.be.true();
        });

        it('should return false for recording file name format with path traversal', () => {
            checkValidator.isValidRecFileNameFormat('../Rec_Test.webm').should.be.false();
            checkValidator.isValidRecFileNameFormat('Rec_../Test.webm').should.be.false();
            checkValidator.isValidRecFileNameFormat('Rec_Test/../../config.webm').should.be.false();
            checkValidator.isValidRecFileNameFormat('Rec_Test\\..\\..\\config.webm').should.be.false();
        });
    });

    describe('3. Handle path traversal', () => {
        it('should return false for strings without path traversal', () => {
            checkValidator.hasPathTraversal('Room1').should.be.false();
            checkValidator.hasPathTraversal('Rec_Test.webm').should.be.false();
            checkValidator.hasPathTraversal('simple/path').should.be.false();
        });

        it('should return true for strings with path traversal', () => {
            checkValidator.hasPathTraversal('../etc/passwd').should.be.true();
            checkValidator.hasPathTraversal('..\\etc\\passwd').should.be.true();
            checkValidator.hasPathTraversal('Room/../../etc').should.be.true();
            checkValidator.hasPathTraversal('Room\\..\\..\\etc').should.be.true();
        });

        it('should return false for strings with ".." that do not indicate path traversal', () => {
            checkValidator.hasPathTraversal('Room..').should.be.false();
            checkValidator.hasPathTraversal('Rec..webm').should.be.false();
            checkValidator.hasPathTraversal('NoPathTraversalHere..').should.be.false();
        });

        it('should return true for complex path traversal patterns', () => {
            checkValidator.hasPathTraversal('....//').should.be.true();
            checkValidator.hasPathTraversal('..\\..\\').should.be.true();
            checkValidator.hasPathTraversal('.../../').should.be.true();
        });
    });
});
