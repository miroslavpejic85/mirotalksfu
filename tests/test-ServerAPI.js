'use strict';

// npx mocha test-ServerApi.js

require('should');

const sinon = require('sinon');
const proxyquire = require('proxyquire');
const jwt = require('jsonwebtoken');
const CryptoJS = require('crypto-js');
const ServerApi = require('../app/src/ServerApi');
const config = require('../app/src/config');

describe('test-ServerAPI', () => {
    let serverApi;
    const host = 'example.com';
    const authorization = 'secret-key';
    const apiKeySecret = 'secret-key';
    const timestamp = new Date().toISOString();

    beforeEach(() => {
        // Mocking config values
        sinon.stub(config.api, 'keySecret').value(apiKeySecret);
        serverApi = new ServerApi(host, authorization);
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('isAuthorized', () => {
        it('should return true when authorization matches the api key secret', () => {
            serverApi.isAuthorized().should.be.true();
        });

        it('should return false when authorization does not match the api key secret', () => {
            serverApi = new ServerApi(host, 'wrong-key');
            serverApi.isAuthorized().should.be.false();
        });
    });

    describe('getStats', () => {
        it('should return total number of rooms and users', () => {
            const roomList = new Map([
                [
                    'room1',
                    {
                        peers: new Map([
                            ['peer1', { peer_info: { peer_name: 'John Doe' } }],
                            ['peer2', { peer_info: { peer_name: 'Jane Doe' } }],
                        ]),
                    },
                ],
                [
                    'room2',
                    {
                        peers: new Map([['peer3', { peer_info: { peer_name: 'Sam Smith' } }]]),
                    },
                ],
            ]);

            const result = serverApi.getStats(roomList, timestamp);

            result.should.deepEqual({
                timestamp: timestamp,
                totalRooms: 2,
                totalUsers: 3,
            });
        });

        it('should return 0 users when there are no peers in any room', () => {
            const roomList = new Map([
                ['room1', { peers: new Map() }],
                ['room2', { peers: new Map() }],
            ]);

            const result = serverApi.getStats(roomList, timestamp);

            result.should.deepEqual({
                timestamp: timestamp,
                totalRooms: 2,
                totalUsers: 0,
            });
        });

        it('should return 0 rooms when roomList is empty', () => {
            const roomList = new Map();

            const result = serverApi.getStats(roomList, timestamp);

            result.should.deepEqual({
                timestamp: timestamp,
                totalRooms: 0,
                totalUsers: 0,
            });
        });
    });

    describe('getMeetings', () => {
        it('should return formatted meetings with peer information', () => {
            const roomList = new Map([
                [
                    'room1',
                    {
                        peers: new Map([
                            [
                                'peer1',
                                {
                                    peer_info: {
                                        peer_name: 'John Doe',
                                        peer_presenter: true,
                                        peer_video: true,
                                        peer_audio: true,
                                        peer_screen: false,
                                        peer_hand: false,
                                        os_name: 'Windows',
                                        os_version: '10',
                                        browser_name: 'Chrome',
                                        browser_version: '100',
                                    },
                                },
                            ],
                        ]),
                    },
                ],
            ]);

            const result = serverApi.getMeetings(roomList);
            result.should.deepEqual([
                {
                    roomId: 'room1',
                    peers: [
                        {
                            name: 'John Doe',
                            presenter: true,
                            video: true,
                            audio: true,
                            screen: false,
                            hand: false,
                            os: 'Windows 10',
                            browser: 'Chrome 100',
                        },
                    ],
                },
            ]);
        });

        it('should handle rooms with no peers', () => {
            const roomList = new Map([['room1', { peers: new Map() }]]);
            const result = serverApi.getMeetings(roomList);
            result.should.deepEqual([{ roomId: 'room1', peers: [] }]);
        });
    });

    describe('getMeetingURL', () => {
        it('should return a meeting URL with a generated UUID', () => {
            const uuidV4Stub = sinon.stub().returns('12345');
            const ServerApi = proxyquire('../app/src/ServerApi', {
                uuid: { v4: uuidV4Stub },
            });

            serverApi = new ServerApi(host, authorization);

            const result = serverApi.getMeetingURL();
            result.should.equal('https://example.com/join/12345');
        });
    });

    describe('getJoinURL', () => {
        it('should return a valid join URL with the given data', () => {
            const data = {
                room: 'room1',
                roomPassword: 'password123',
                name: 'John Doe',
                audio: true,
                video: false,
                screen: false,
                hide: false,
                notify: false,
                duration: '00:30:00',
                token: { username: 'user', password: 'pass', presenter: true, expire: '1h' },
            };

            const tokenStub = sinon.stub(serverApi, 'getToken').returns('testToken');

            const result = serverApi.getJoinURL(data);
            result.should.equal(
                'https://example.com/join?room=room1&roomPassword=password123&name=John%20Doe&audio=true&video=false&screen=false&hide=false&notify=false&duration=00:30:00&token=testToken',
            );

            tokenStub.restore();
        });

        it('should use default values when data is not provided', () => {
            const randomStub = sinon.stub().returns('123456');
            const uuidV4Stub = sinon.stub().returns('room1');
            const ServerApi = proxyquire('../app/src/ServerApi', {
                uuid: { v4: uuidV4Stub },
            });

            serverApi = new ServerApi(host, authorization);
            sinon.stub(serverApi, 'getRandomNumber').callsFake(randomStub);

            const result = serverApi.getJoinURL({});
            result.should.equal(
                'https://example.com/join?room=room1&roomPassword=false&name=User-123456&audio=false&video=false&screen=false&hide=false&notify=false&duration=unlimited',
            );
        });
    });

    describe('getToken', () => {
        it('should return an encrypted JWT token', () => {
            const tokenData = { username: 'user', password: 'pass', presenter: true, expire: '1h' };
            const signStub = sinon.stub(jwt, 'sign').returns('jwtToken');
            const encryptStub = sinon.stub(CryptoJS.AES, 'encrypt').returns({ toString: () => 'encryptedPayload' });

            const result = serverApi.getToken(tokenData);
            result.should.equal('jwtToken');

            signStub
                .calledWith({ data: 'encryptedPayload' }, 'mirotalksfu_jwt_secret', { expiresIn: '1h' })
                .should.be.true();
            encryptStub
                .calledWith(
                    JSON.stringify({ username: 'user', password: 'pass', presenter: 'true' }),
                    'mirotalksfu_jwt_secret',
                )
                .should.be.true();

            signStub.restore();
            encryptStub.restore();
        });

        it('should return an empty string if no token data is provided', () => {
            const result = serverApi.getToken(null);
            result.should.equal('');
        });
    });

    describe('getRandomNumber', () => {
        it('should return a random number between 0 and 999999', () => {
            const result = serverApi.getRandomNumber();
            result.should.be.within(0, 999999);
        });
    });
});
