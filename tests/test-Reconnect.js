'use strict';

require('should');

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const roomClientSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'RoomClient.js'), 'utf8');

describe('test-Reconnect', () => {
    let getReconnectDirectJoinURL;

    before(() => {
        const context = vm.createContext({
            window: { location: { origin: 'https://localhost:3010' } },
        });
        vm.runInContext(`${roomClientSource}; globalThis.RoomClientForTest = RoomClient;`, context);
        getReconnectDirectJoinURL = context.RoomClientForTest.prototype.getReconnectDirectJoinURL;
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