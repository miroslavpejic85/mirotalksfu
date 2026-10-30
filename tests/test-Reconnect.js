'use strict';

require('should');

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const roomClientSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'RoomClient.js'), 'utf8');

describe('test-Reconnect', () => {
    let getReconnectDirectJoinURL;
    let proto;

    before(() => {
        const context = vm.createContext({
            window: { location: { origin: 'https://localhost:3010' }, localStorage: {} },
            endRoomSession: () => {},
            setTimeout: () => {}, // refreshBrowser defers the actual navigation
        });
        vm.runInContext(`${roomClientSource}; globalThis.RoomClientForTest = RoomClient;`, context);
        proto = context.RoomClientForTest.prototype;
        getReconnectDirectJoinURL = proto.getReconnectDirectJoinURL;
    });

    function createRestartClient() {
        const banners = [];
        const client = {
            _isConnected: true,
            serverRestarting: false,
            serverAwayShown: false,
            maxReconnectAttempts: 10,
            serverRestartReconnectAttempts: 120,
            reconnectAttempts: null,
            connectCalls: 0,
            banners,
            socket: {
                io: { reconnectionAttempts: (n) => (client.reconnectAttempts = n) },
                connect: () => client.connectCalls++,
            },
            sound: () => {},
            isRecording: () => false,
            hasActiveRecorder: () => false,
            showReconnectAlert: (reason) => banners.push({ type: 'reconnect', reason }),
            showServerRestartAlert: (meta) => banners.push({ type: 'restart', meta }),
            renderReconnectBanner: (opts) => banners.push({ type: 'render', opts }),
            peer_info: { peer_audio: true, peer_video: true, peer_screen: false, peer_name: 'User' },
        };
        client.handleServerRestart = proto.handleServerRestart.bind(client);
        client.saveReconnectMediaState = proto.saveReconnectMediaState.bind(client);
        return client;
    }

    it('rejoins with the media state from before the server restart, not the one left by closed transports', () => {
        const client = createRestartClient();
        let stored = null;
        client.updatePeerInfoInLocalStorage = (info) => (stored = info);
        client.getReconnectDirectJoinURL = () => 'url';

        proto.handleServerRestart.call(client);
        // transportclose -> closeProducer -> setIsAudio/setIsVideo(false)
        client.peer_info.peer_audio = false;
        client.peer_info.peer_video = false;
        proto.handleDisconnect.call(client, 'transport close');

        proto.refreshBrowser.call(client);

        // Object built inside the vm realm: compare a plain copy
        JSON.parse(JSON.stringify(stored)).should.eql({
            peer_audio: true,
            peer_video: true,
            peer_screen: false,
            peer_name: 'User',
        });
    });

    it('shows the server restart banner and extends reconnect attempts on serverShutdown', () => {
        const client = createRestartClient();

        proto.handleServerRestart.call(client);

        client.serverRestarting.should.be.true();
        client._isConnected.should.be.false();
        client.maxReconnectAttempts.should.equal(120);
        client.reconnectAttempts.should.equal(120);
        client.banners.should.eql([{ type: 'restart', meta: undefined }]);

        proto.handleServerRestart.call(client);
        client.banners.length.should.equal(1);
    });

    it('keeps the restart banner on disconnect and resumes reconnect after a server-initiated disconnect', () => {
        const client = createRestartClient();
        proto.handleServerRestart.call(client);

        proto.handleDisconnect.call(client, 'transport close');
        client.connectCalls.should.equal(0);

        proto.handleDisconnect.call(client, 'io server disconnect');
        client.connectCalls.should.equal(1);

        client.banners.every((b) => b.type === 'restart').should.be.true();
    });

    it('shows the generic reconnect banner on an unplanned disconnect', () => {
        const client = createRestartClient();

        proto.handleDisconnect.call(client, 'transport close');

        client.banners.should.eql([{ type: 'reconnect', reason: 'transport close' }]);
        client.connectCalls.should.equal(0);
    });

    it('shows the retry countdown in the restart banner while reconnecting', () => {
        const client = createRestartClient();
        client.serverRestarting = true;

        proto.updateReconnectAlert.call(client, 15000, 3);

        client.banners.should.eql([{ type: 'restart', meta: 'Retry in 15s' }]);
    });

    it('does not include the stale client presenter flag in reconnect URLs', () => {
        const client = {
            room_id: 'test',
            RoomPassword: false,
            peer_name: 'Presenter',
            getPeerInfoFromLocalStorage: () => ({
                peer_presenter: true,
                peer_audio: false,
                peer_video: false,
                peer_screen: false,
                peer_token: 'signed-token',
            }),
        };

        const reconnectUrl = getReconnectDirectJoinURL.call(client);

        reconnectUrl.includes('isPresenter').should.be.false();
        reconnectUrl.includes('token=signed-token').should.be.true();
        reconnectUrl.should.equal(
            'https://localhost:3010/join?room=test&roomPassword=false&name=Presenter&audio=false&video=false&screen=false&notify=0&token=signed-token'
        );
    });
});

describe('test-Reconnect virtual background restore', () => {
    const roomSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'Room.js'), 'utf8');
    const match = roomSource.match(/function restoreVirtualBackgroundState\(\) \{[\s\S]*?\n\}\n/);

    function restore(saved, available = true) {
        const store = saved ? { virtualBackgroundSettings: JSON.stringify(saved) } : {};
        const context = vm.createContext({
            console: { warn() {} },
            localStorage: { getItem: (key) => store[key] ?? null },
            isVirtualBackgroundAvailable: () => available,
        });
        vm.runInContext(
            `var virtualBackgroundBlurLevel = null, virtualBackgroundSelectedImage = null, virtualBackgroundTransparent = null;
            ${match[0]}
            restoreVirtualBackgroundState();
            globalThis.state = { blur: virtualBackgroundBlurLevel, image: virtualBackgroundSelectedImage, transparent: virtualBackgroundTransparent };`,
            context
        );
        return JSON.parse(JSON.stringify(context.state));
    }

    it('exists in Room.js', () => {
        (match !== null).should.be.true();
    });

    it('restores blur before the rejoin produces the camera', () => {
        restore({ blurLevel: 20, imageUrl: null, transparent: null }).should.eql({
            blur: 20,
            image: null,
            transparent: null,
        });
    });

    it('restores a virtual background image', () => {
        restore({ blurLevel: null, imageUrl: '../images/virtual-background/x.jpg', transparent: null }).should.eql({
            blur: null,
            image: '../images/virtual-background/x.jpg',
            transparent: null,
        });
    });

    it('restores a transparent background', () => {
        restore({ blurLevel: null, imageUrl: null, transparent: true }).should.eql({
            blur: null,
            image: null,
            transparent: true,
        });
    });

    it('does nothing when nothing is saved or virtual background is unavailable', () => {
        restore(null).should.eql({ blur: null, image: null, transparent: null });
        restore({ blurLevel: 20 }, false).should.eql({ blur: null, image: null, transparent: null });
    });
});
