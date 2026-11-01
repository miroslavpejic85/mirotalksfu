'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'Server.js'), 'utf8');

const helperSource = serverSource.slice(
    serverSource.indexOf('    // Returns the moderator policy that forbids'),
    serverSource.indexOf('    function isPeerPresenter(')
);
const produceSource = serverSource.slice(
    serverSource.indexOf("        socket.on('produce',"),
    serverSource.indexOf("        socket.on('consume',")
);
const resumeProducerSource = serverSource.slice(
    serverSource.indexOf("        socket.on('resumeProducer',"),
    serverSource.indexOf("        socket.on('resumeConsumer',")
);

describe('Server-side media moderator policies', () => {
    function setup({ moderator = {}, isPresenter = false, kind = 'audio', mediaType = 'audioType' } = {}) {
        const handlers = {};
        const producer = {
            kind,
            appData: { mediaType },
            resume: sinon.stub().resolves(),
            pause: sinon.stub().resolves(),
        };
        const peer = { peer_name: 'bob', peer_uuid: 'uuid-bob', getProducer: () => producer };
        const room = {
            id: 'room-1',
            _moderator: moderator,
            produce: sinon.stub().resolves('producer-1'),
            addProducerToAudioLevelObserver: sinon.stub().resolves(),
            addProducerToActiveSpeakerObserver: sinon.stub().resolves(),
        };
        const socket = {
            id: 'peer-1',
            room_id: 'room-1',
            on: (event, handler) => (handlers[event] = handler),
        };
        const peerInfoUpdate = sinon.spy();
        peer.updatePeerInfo = peerInfoUpdate;

        const context = vm.createContext({
            socket,
            roomExists: () => true,
            getRoom: () => room,
            getPeer: () => peer,
            getRoomAndPeer: () => ({ room, peer }),
            getPeerInfo: () => ({ peer_name: peer.peer_name }),
            isPeerInLobby: () => false,
            isPeerPresenter: () => isPresenter,
            Promise,
            log: { debug: sinon.spy(), warn: sinon.spy() },
        });

        vm.runInContext(`${helperSource}\n${produceSource}\n${resumeProducerSource}`, context);

        return { handlers, room, producer, peerInfoUpdate };
    }

    const cases = [
        { policy: 'audio_cant_unmute', kind: 'audio', mediaType: 'audioType' },
        { policy: 'video_cant_unhide', kind: 'video', mediaType: 'videoType' },
        { policy: 'screen_cant_share', kind: 'video', mediaType: 'screenType' },
        { policy: 'screen_cant_share', kind: 'audio', mediaType: 'audioTab' },
    ];

    for (const { policy, kind, mediaType } of cases) {
        describe(`${policy} (${mediaType})`, () => {
            const appData = { mediaType };
            const params = { producerTransportId: 't1', kind, appData, rtpParameters: {} };

            it('rejects resumeProducer for non-presenters', async () => {
                const state = setup({ moderator: { [policy]: true }, kind, mediaType });
                const callback = sinon.spy();

                await state.handlers.resumeProducer({ producer_id: 'p1', type: mediaType }, callback);

                assert.equal(state.producer.resume.callCount, 0);
                assert.match(callback.firstCall.args[0].error, new RegExp(policy));
            });

            if (policy === 'audio_cant_unmute') {
                it('creates the producer muted for non-presenters', async () => {
                    const state = setup({ moderator: { [policy]: true }, kind, mediaType });
                    const callback = sinon.spy();

                    await state.handlers.produce(params, callback);

                    assert.equal(state.room.produce.callCount, 1);
                    assert.equal(state.producer.pause.callCount, 1);
                    assert.equal(state.peerInfoUpdate.firstCall.args[0].status, false);
                    assert.equal(callback.firstCall.args[0].producer_id, 'producer-1');
                });
            } else {
                it('rejects produce for non-presenters', async () => {
                    const state = setup({ moderator: { [policy]: true }, kind, mediaType });
                    const callback = sinon.spy();

                    await state.handlers.produce(params, callback);

                    assert.equal(state.room.produce.callCount, 0);
                    assert.equal(state.peerInfoUpdate.callCount, 0);
                    assert.match(callback.firstCall.args[0].error, new RegExp(policy));
                });
            }

            it('allows presenters to resume and produce', async () => {
                const state = setup({ moderator: { [policy]: true }, isPresenter: true, kind, mediaType });
                const resumeCb = sinon.spy();
                const produceCb = sinon.spy();

                await state.handlers.resumeProducer({ producer_id: 'p1', type: mediaType }, resumeCb);
                await state.handlers.produce(params, produceCb);

                assert.equal(state.producer.resume.callCount, 1);
                assert.equal(resumeCb.firstCall.args[0], 'successfully');
                assert.equal(state.producer.pause.callCount, 0);
                assert.equal(produceCb.firstCall.args[0].producer_id, 'producer-1');
            });

            it('allows everyone when the policy is off', async () => {
                const state = setup({ moderator: { [policy]: false }, kind, mediaType });
                const resumeCb = sinon.spy();

                await state.handlers.resumeProducer({ producer_id: 'p1', type: mediaType }, resumeCb);

                assert.equal(state.producer.resume.callCount, 1);
                assert.equal(resumeCb.firstCall.args[0], 'successfully');
            });
        });
    }

    it('does not apply the audio policy to unrelated policies', async () => {
        const state = setup({ moderator: { video_cant_unhide: true, screen_cant_share: true } });
        const callback = sinon.spy();

        await state.handlers.resumeProducer({ producer_id: 'p1', type: 'audioType' }, callback);

        assert.equal(state.producer.resume.callCount, 1);
        assert.equal(callback.firstCall.args[0], 'successfully');
    });
});
