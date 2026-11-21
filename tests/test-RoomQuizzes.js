'use strict';

// npx mocha tests/test-RoomQuizzes.js

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const RoomQuizzes = require('../app/src/RoomQuizzes');

const ROOT = path.join(__dirname, '..');
const clientSource = fs.readFileSync(path.join(ROOT, 'public/js/Quiz.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(ROOT, 'app/src/Server.js'), 'utf8');
const roomHtml = fs.readFileSync(path.join(ROOT, 'public/views/Room.html'), 'utf8');
const roomClientJs = fs.readFileSync(path.join(ROOT, 'public/js/RoomClient.js'), 'utf8');
const roomJs = fs.readFileSync(path.join(ROOT, 'public/js/Room.js'), 'utf8');
const quizCss = fs.readFileSync(path.join(ROOT, 'public/css/Quiz.css'), 'utf8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sampleQuestions = () => [
    { question: 'Capital of Italy?', options: ['Milan', 'Rome', 'Naples'], correct: 1 },
    { question: '2 + 2?', options: ['3', '4'], correct: 1 },
    { question: 'Largest planet?', options: ['Jupiter', 'Mars'], correct: 0 },
];

describe('room quizzes', () => {
    // ####################################################
    // SERVER STATE MODULE
    // ####################################################

    describe('server state (unit)', () => {
        const host = { key: 'u:host', name: 'Host' };
        const alice = { key: 'u:alice', name: 'Alice' };
        const bob = { key: 'u:bob', name: 'Bob' };

        const createQuiz = (extra = {}) =>
            RoomQuizzes.create('r', { title: 'Quiz', mode: 'step', questions: sampleQuestions(), ...extra }, host).quiz;

        beforeEach(() => RoomQuizzes.reset());

        it('validates and normalizes a new quiz', () => {
            const create = (data) => RoomQuizzes.create('r', data, host);
            const valid = { title: 'Quiz', mode: 'step', questions: sampleQuestions() };

            assert.equal(create({ ...valid, title: ' ' }).error, 'The quiz title is required');
            assert.equal(create({ ...valid, mode: 'random' }).error, 'Invalid request');
            assert.equal(create({ ...valid, questions: 'nope' }).error, 'Invalid request');
            assert.equal(create({ ...valid, questions: [] }).error, 'At least one question is required');
            const many = Array.from({ length: RoomQuizzes.LIMITS.MAX_QUESTIONS + 1 }, () => sampleQuestions()[1]);
            assert.equal(create({ ...valid, questions: many }).error, 'Too many questions');
            assert.equal(
                create({ ...valid, questions: [{ question: ' ', options: ['a', 'b'], correct: 0 }] }).error,
                'Every question needs a text'
            );
            assert.equal(
                create({ ...valid, questions: [{ question: 'Q', options: ['a', ' A '], correct: 0 }] }).error,
                'At least 2 different options are required'
            );
            assert.equal(
                create({ ...valid, questions: [{ question: 'Q', options: ['a', 'b'] }] }).error,
                'Mark the correct answer of every question'
            );
            assert.equal(
                create({ ...valid, questions: [{ question: 'Q', options: ['a', 'b', ''], correct: 2 }] }).error,
                'Mark the correct answer of every question',
                'the correct option cannot be an empty one'
            );
            assert.equal(
                create({ ...valid, questions: [{ question: 'Q', options: Array(7).fill(0).map(String), correct: 0 }] })
                    .error,
                'At least 2 different options are required'
            );
            const seven = Array.from({ length: 7 }, (_, i) => `opt ${i}`);
            assert.equal(
                create({ ...valid, questions: [{ question: 'Q', options: seven, correct: 0 }] }).error,
                'Too many options'
            );

            const { quiz } = create({
                title: ' Friday\u202E\u0000   quiz ',
                mode: 'all',
                anonymous: 'true',
                questions: [{ question: 'Pick', options: ['', 'Yes', 'No', ' yes '], correct: 3 }],
            });
            assert.equal(quiz.title, 'Friday quiz');
            assert.equal(quiz.mode, 'all');
            assert.equal(quiz.anonymous, false, 'only a real boolean enables anonymous mode');
            assert.equal(quiz.status, 'ready');
            assert.deepEqual(quiz.questions[0].options, ['Yes', 'No']);
            assert.equal(quiz.questions[0].correct, 0, 'a duplicate of the correct option points to the kept one');
        });

        it('caps the number of quizzes per room', () => {
            for (let i = 0; i < RoomQuizzes.LIMITS.MAX_QUIZZES_PER_ROOM; i++) assert.ok(createQuiz());
            assert.equal(
                RoomQuizzes.create('r', { title: 'Q', mode: 'step', questions: sampleQuestions() }, host).error,
                'The maximum number of quizzes has been reached'
            );
            assert.ok(
                RoomQuizzes.create('other', { title: 'Q', mode: 'step', questions: sampleQuestions() }, host).quiz
            );
        });

        it('runs one question at a time and reveals the answers to the participants only when asked', () => {
            const quiz = createQuiz({ anonymous: true });

            // Before the start: participants see no question at all
            let view = RoomQuizzes.toPublic(quiz, alice.key);
            assert.equal(view.status, 'ready');
            assert.equal(view.questions.length, 0);
            assert.equal(view.can_manage, false);
            assert.equal(
                RoomQuizzes.answer('r', quiz.id, alice, 0, 1).error,
                'This question is no longer accepting answers'
            );
            const hostView = RoomQuizzes.toPublic(quiz, host.key);
            assert.equal(hostView.can_manage, true);
            assert.equal(hostView.questions.length, 3, 'the managers preview every question');
            assert.equal(hostView.questions[0].correct, 1);

            assert.ok(RoomQuizzes.start(quiz).quiz);
            assert.equal(RoomQuizzes.start(quiz).error, 'The quiz has already started');
            assert.equal(quiz.current, 0);

            RoomQuizzes.answer('r', quiz.id, alice, 0, 1);
            RoomQuizzes.answer('r', quiz.id, bob, 0, 0);
            assert.equal(
                RoomQuizzes.answer('r', quiz.id, alice, 1, 1).error,
                'This question is no longer accepting answers'
            );

            view = RoomQuizzes.toPublic(quiz, alice.key);
            assert.equal(view.questions.length, 1, 'future questions stay on the server');
            const open = view.questions[0];
            assert.equal(open.my_answer, 1);
            assert.equal(open.correct, -1, 'the correct option is not sent before the reveal');
            assert.equal(open.total_answers, undefined);
            assert.ok(open.options.every((option) => option.votes === undefined && option.voters === undefined));
            assert.equal(view.leaderboard, undefined);
            assert.ok(!JSON.stringify(view).includes('Bob'));

            // The host (a presenter) sees who answered what, live
            const live = RoomQuizzes.toPublic(quiz, host.key, true).questions[0];
            assert.equal(live.correct, 1);
            assert.equal(live.total_answers, 2);
            assert.deepEqual(live.options[1].voters, ['Alice']);
            assert.deepEqual(live.options[0].voters, ['Bob']);

            assert.ok(RoomQuizzes.reveal(quiz).quiz);
            assert.equal(RoomQuizzes.reveal(quiz).error, 'Invalid request', 'already revealed');
            assert.equal(
                RoomQuizzes.answer('r', quiz.id, alice, 0, 0).error,
                'This question is no longer accepting answers'
            );
            view = RoomQuizzes.toPublic(quiz, alice.key);
            const revealed = view.questions[0];
            assert.equal(revealed.correct, 1);
            assert.deepEqual(
                revealed.options.map((option) => option.votes),
                [1, 1, 0]
            );
            assert.equal(revealed.options[0].voters, undefined, 'anonymous for the participants');
            assert.equal(view.my_score, 1);
            assert.equal(view.revealed_count, 1);
            assert.deepEqual(RoomQuizzes.toPublic(quiz, host.key, true).questions[0].options[1].voters, ['Alice']);

            assert.ok(RoomQuizzes.next(quiz).quiz);
            assert.equal(quiz.current, 1);
            RoomQuizzes.answer('r', quiz.id, alice, 1, 0);
            RoomQuizzes.answer('r', quiz.id, bob, 1, 1);
            // next() also reveals a question still open
            assert.ok(RoomQuizzes.next(quiz).quiz);
            assert.equal(quiz.questions[1].state, 'revealed');
            assert.equal(RoomQuizzes.next(quiz).error, 'This is the last question');

            RoomQuizzes.answer('r', quiz.id, bob, 2, 0);
            assert.ok(RoomQuizzes.finish(quiz).quiz);
            assert.equal(RoomQuizzes.finish(quiz).error, 'Invalid request');

            view = RoomQuizzes.toPublic(quiz, alice.key);
            assert.equal(view.status, 'finished');
            assert.equal(view.my_score, 1);
            assert.equal(view.revealed_count, 3);
            assert.equal(view.participant_count, 2);
            assert.equal(view.average_score, 1.5);
            assert.equal(view.leaderboard, undefined, 'anonymous: no names for the participants');
            assert.deepEqual(RoomQuizzes.toPublic(quiz, host.key, true).leaderboard, [
                { name: 'Bob', score: 2, answers: [0, 1, 0] },
                { name: 'Alice', score: 1, answers: [1, 0, -1] },
            ]);
            assert.equal(
                RoomQuizzes.toPublic(quiz, alice.key, true).leaderboard.length,
                2,
                'presenters get the answers too'
            );
        });

        it('keeps the answers of participants sharing a name apart', () => {
            const quiz = createQuiz({ mode: 'all' });
            RoomQuizzes.start(quiz);
            RoomQuizzes.answer('r', quiz.id, { key: 'u:1', name: 'Guest' }, 0, 1);
            RoomQuizzes.answer('r', quiz.id, { key: 'u:2', name: 'Guest' }, 0, 0);
            RoomQuizzes.finish(quiz);
            assert.deepEqual(RoomQuizzes.toPublic(quiz, host.key).leaderboard, [
                { name: 'Guest', score: 1, answers: [1, -1, -1] },
                { name: 'Guest', score: 0, answers: [0, -1, -1] },
            ]);
        });

        it('opens every question at once and shares a named leaderboard when not anonymous', () => {
            const quiz = createQuiz({ mode: 'all', anonymous: false });
            RoomQuizzes.start(quiz);
            assert.equal(RoomQuizzes.reveal(quiz).error, 'Invalid request');
            assert.equal(RoomQuizzes.next(quiz).error, 'Invalid request');

            RoomQuizzes.answer('r', quiz.id, alice, 2, 0);
            RoomQuizzes.answer('r', quiz.id, alice, 0, 1);
            RoomQuizzes.answer('r', quiz.id, bob, 0, 2);
            let view = RoomQuizzes.toPublic(quiz, alice.key);
            assert.equal(view.questions.length, 3);
            assert.ok(view.questions.every((question) => question.correct === -1));
            assert.equal(view.leaderboard, undefined);

            RoomQuizzes.finish(quiz);
            view = RoomQuizzes.toPublic(quiz, bob.key);
            assert.deepEqual(view.leaderboard, [
                { name: 'Alice', score: 2 },
                { name: 'Bob', score: 0 },
            ]);
            assert.ok(
                view.leaderboard.every((entry) => !('answers' in entry)),
                'per participant answers are for the managers'
            );
            assert.deepEqual(view.questions[0].options[1].voters, ['Alice']);
            assert.equal(view.my_score, 0);
        });

        it('hides the questions never asked when a step quiz finishes early', () => {
            const quiz = createQuiz();
            RoomQuizzes.start(quiz);
            RoomQuizzes.answer('r', quiz.id, alice, 0, 1);
            RoomQuizzes.finish(quiz);
            const view = RoomQuizzes.toPublic(quiz, alice.key);
            assert.equal(view.questions.length, 1);
            assert.equal(view.asked_count, 1);
            assert.equal(view.revealed_count, 1);
            assert.equal(view.my_score, 1);
            assert.ok(!JSON.stringify(view).includes('Largest planet'));
            assert.equal(RoomQuizzes.toPublic(quiz, host.key).questions[2].state, 'pending');
        });

        it('allows changing and retracting an answer, rejects invalid ones', () => {
            const quiz = createQuiz({ mode: 'all' });
            RoomQuizzes.start(quiz);
            assert.equal(RoomQuizzes.answer('r', quiz.id, host, 0, 1).error, 'Invalid request', 'the creator');
            assert.equal(RoomQuizzes.answer('r', quiz.id, alice, 0, 3).error, 'Invalid request');
            assert.equal(RoomQuizzes.answer('r', quiz.id, alice, 0, '1').error, 'Invalid request');
            assert.equal(
                RoomQuizzes.answer('r', quiz.id, alice, 9, 0).error,
                'This question is no longer accepting answers'
            );
            assert.equal(RoomQuizzes.answer('r', 'missing', alice, 0, 0).error, 'Quiz not found');
            assert.equal(RoomQuizzes.answer('other', quiz.id, alice, 0, 0).error, 'Quiz not found');

            RoomQuizzes.answer('r', quiz.id, alice, 0, 0);
            RoomQuizzes.answer('r', quiz.id, alice, 0, 1);
            let host0 = RoomQuizzes.toPublic(quiz, host.key).questions[0];
            assert.equal(host0.total_answers, 1);
            assert.equal(host0.options[1].votes, 1);
            RoomQuizzes.answer('r', quiz.id, alice, 0, -1);
            host0 = RoomQuizzes.toPublic(quiz, host.key).questions[0];
            assert.equal(host0.total_answers, 0);
        });

        it('shows the names of an anonymous quiz to the presenters only, not to a participant creator', () => {
            const quiz = createQuiz({ mode: 'all', anonymous: true });
            RoomQuizzes.start(quiz);
            RoomQuizzes.answer('r', quiz.id, alice, 0, 1);
            RoomQuizzes.answer('r', quiz.id, bob, 0, 0);

            // The creator is a regular participant: it runs the quiz with the counts only
            const creator = RoomQuizzes.toPublic(quiz, host.key, false);
            assert.equal(creator.can_manage, true);
            assert.equal(creator.questions[0].correct, 1);
            assert.deepEqual(
                creator.questions[0].options.map((option) => option.votes),
                [1, 1, 0]
            );
            assert.ok(creator.questions[0].options.every((option) => option.voters === undefined));
            assert.equal(creator.leaderboard, undefined);
            RoomQuizzes.finish(quiz);
            const finished = RoomQuizzes.toPublic(quiz, host.key, false);
            assert.equal(finished.leaderboard, undefined, 'no named results to export');
            assert.ok(!JSON.stringify(finished).includes('Alice'));

            // A presenter of the room sees them
            const presenter = RoomQuizzes.toPublic(quiz, 'u:presenter', true);
            assert.deepEqual(presenter.questions[0].options[1].voters, ['Alice']);
            assert.equal(presenter.leaderboard.length, 2);

            // Not anonymous: the creator sees the names
            const open = createQuiz({ mode: 'all' });
            RoomQuizzes.start(open);
            RoomQuizzes.answer('r', open.id, alice, 0, 1);
            const openView = RoomQuizzes.toPublic(open, host.key, false);
            assert.deepEqual(openView.questions[0].options[1].voters, ['Alice']);
            assert.equal(openView.leaderboard.length, 1);
        });

        it('serializes from a summary shared by the recipients of one update', () => {
            const quiz = createQuiz({ anonymous: true });
            RoomQuizzes.start(quiz);
            RoomQuizzes.answer('r', quiz.id, alice, 0, 1);
            RoomQuizzes.answer('r', quiz.id, bob, 0, 0);
            RoomQuizzes.reveal(quiz);
            const summary = RoomQuizzes.summarize(quiz);
            for (const [key, presenter] of [
                [host.key, true],
                [host.key, false],
                [alice.key, false],
                [bob.key, true],
                ['u:late', false],
            ]) {
                assert.deepEqual(
                    RoomQuizzes.toPublic(quiz, key, presenter, summary),
                    RoomQuizzes.toPublic(quiz, key, presenter)
                );
            }
            // Recipients do not share mutable arrays
            const a = RoomQuizzes.toPublic(quiz, host.key, true, summary);
            a.questions[0].options[1].voters.push('Mallory');
            assert.deepEqual(RoomQuizzes.toPublic(quiz, host.key, true, summary).questions[0].options[1].voters, [
                'Alice',
            ]);
        });

        it('bounds the cleanup work on oversized texts', () => {
            const huge = ' x'.repeat(5e6);
            const started = Date.now();
            const { quiz } = RoomQuizzes.create(
                'r',
                { title: huge, mode: 'step', questions: [{ question: huge, options: [huge, 'b'], correct: 1 }] },
                host
            );
            assert.ok(Date.now() - started < 500);
            assert.equal(quiz.title.length, RoomQuizzes.LIMITS.MAX_TITLE_LENGTH - 1, 'cut on a word boundary trim');
            assert.equal(quiz.questions[0].options[0].length <= RoomQuizzes.LIMITS.MAX_OPTION_LENGTH, true);
        });

        it('serializes per viewer without leaking voter keys, removes and clears', () => {
            const quiz = createQuiz({ mode: 'all' });
            RoomQuizzes.start(quiz);
            RoomQuizzes.answer('r', quiz.id, { key: 'u:carol', name: 'Tom &amp; Jerry' }, 0, 1);
            const forHost = RoomQuizzes.toPublic(quiz, host.key);
            assert.deepEqual(forHost.questions[0].options[1].voters, ['Tom & Jerry']);
            assert.equal(forHost.is_mine, true);
            assert.ok(!JSON.stringify(forHost).includes('u:'), 'voter keys stay on the server');
            assert.equal(RoomQuizzes.toPublic(quiz, alice.key, true).can_manage, true, 'presenters manage');

            assert.equal(RoomQuizzes.remove('r', quiz.id), true);
            assert.equal(RoomQuizzes.list('r').length, 0);
            createQuiz();
            RoomQuizzes.clear('r');
            assert.equal(RoomQuizzes.list('r').length, 0);
        });
    });

    // ####################################################
    // SFU IDENTITY (answers by name, creator rights by connection)
    // ####################################################

    describe('creator rights bound to the connection', () => {
        beforeEach(() => RoomQuizzes.reset());

        const creator = { key: 'n:Host', ownerKey: 's:sock-1', name: 'Host' };

        it('keeps the creator rights on the creating connection only', () => {
            const room = { id: 'room-1' };
            const { quiz } = RoomQuizzes.create(
                room,
                { title: 'Q', mode: 'all', questions: sampleQuestions() },
                creator
            );
            assert.equal(RoomQuizzes.isCreator(quiz, 's:sock-1'), true);
            assert.equal(RoomQuizzes.isCreator(quiz, 'n:Host'), false, 'the name alone is not enough');

            // Someone joining later with the same name: no manager view, no correct answers
            const impostor = RoomQuizzes.toPublic(quiz, { key: 'n:Host', ownerKey: 's:sock-9' });
            assert.equal(impostor.is_mine, false);
            assert.equal(impostor.can_manage, false);
            assert.equal(impostor.questions.length, 0);
            assert.equal(RoomQuizzes.toPublic(quiz, { key: 'n:Host', ownerKey: 's:sock-1' }).can_manage, true);

            // The creator connection cannot answer, the answers follow the name across connections
            RoomQuizzes.start(quiz);
            assert.equal(RoomQuizzes.answer(room, quiz.id, creator, 0, 1).error, 'Invalid request');
            const bob = { key: 'n:Bob', ownerKey: 's:sock-2', name: 'Bob' };
            RoomQuizzes.answer(room, quiz.id, bob, 0, 1);
            const reloaded = RoomQuizzes.toPublic(quiz, { key: 'n:Bob', ownerKey: 's:sock-3' });
            assert.equal(reloaded.questions[0].my_answer, 1, 'same answer after a page reload');
            RoomQuizzes.answer(room, quiz.id, { ...bob, ownerKey: 's:sock-3' }, 0, 0);
            assert.equal(
                RoomQuizzes.toPublic(quiz, creator).questions[0].total_answers,
                1,
                'no duplicate after a reload'
            );
        });

        it('keeps the quizzes of each Room object apart', () => {
            const roomA = { id: 'same-id' };
            const roomB = { id: 'same-id' };
            RoomQuizzes.create(roomA, { title: 'A', mode: 'all', questions: sampleQuestions() }, creator);
            assert.equal(RoomQuizzes.list(roomA).length, 1);
            assert.equal(RoomQuizzes.list(roomB).length, 0, 'a recreated room starts empty');
            assert.equal(RoomQuizzes.list('same-id').length, 0);
            RoomQuizzes.clear(roomA);
            assert.equal(RoomQuizzes.list(roomA).length, 0);
        });
    });

    // ####################################################
    // SIGNALING SERVER (Server.js quiz handler, run with mocks)
    // ####################################################

    describe('signaling server handler', () => {
        const handlerSource = serverSource.slice(
            serverSource.indexOf(
                '        // ####################################################\n        // ROOM QUIZZES'
            ),
            serverSource.indexOf('        // Room collaborative editor')
        );
        const timersSource = serverSource.slice(
            serverSource.indexOf('// Pending batched quiz answer broadcasts'),
            serverSource.indexOf('\n}\n', serverSource.indexOf('function cancelQuizBroadcast')) + 3
        );

        it('extracts the handler from Server.js', () => {
            assert.ok(handlerSource.includes("socket.on('quiz'"));
            assert.ok(timersSource.includes('function cancelQuizBroadcast'));
        });

        function createRoom() {
            const peers = new Map();
            const sent = [];
            const room = {
                id: 'room-1',
                _moderator: { polls_cant_create: false },
                peers,
                getPeer: (id) => peers.get(id),
                getAdmittedPeerIds: () => [...peers.entries()].filter(([, p]) => !p.peer_lobby).map(([id]) => id),
                send: (id, event, data) => sent.push({ id, event, data: JSON.parse(JSON.stringify(data)) }),
                sendToAll: (event, data) => {
                    for (const id of room.getAdmittedPeerIds()) room.send(id, event, data);
                },
            };
            return { room, sent };
        }

        function setup() {
            RoomQuizzes.reset();
            const { room, sent } = createRoom();
            const roomList = new Map([['room-1', room]]);
            const presenters = new Set();
            const context = vm.createContext({
                RoomQuizzes,
                Validator: {
                    isValidData: (data) => Boolean(data && typeof data === 'object' && Object.keys(data).length),
                },
                log: { debug() {}, error() {} },
                roomList,
                setTimeout,
                clearTimeout,
                Date,
                String,
                isPeerPresenter: (room_id, peer_id, name, uuid) =>
                    room_id === 'room-1' &&
                    presenters.has(peer_id) &&
                    room.getPeer(peer_id)?.peer_info.peer_uuid === uuid,
                isPeerInLobby: (peer) => Boolean(peer && peer.peer_lobby === true),
            });
            vm.runInContext(timersSource, context);
            // Script level const declarations are not context properties: expose them to share the timers
            const timers = vm.runInContext('({ quizBroadcastTimers, QUIZ_ANSWER_BATCH_MS })', context);

            const sockets = new Map();
            function join(id, name, { presenter = false, lobby = false } = {}) {
                const handlers = {};
                const emitted = [];
                const socket = {
                    id,
                    room_id: 'room-1',
                    on: (event, handler) => (handlers[event] = handler),
                    emit: (event, data) => emitted.push({ event, data: JSON.parse(JSON.stringify(data)) }),
                };
                const peer = {
                    id,
                    peer_name: name,
                    peer_lobby: lobby,
                    peer_info: { peer_name: name, peer_uuid: 'uuid-' + name },
                };
                room.peers.set(id, peer);
                if (presenter) presenters.add(id);
                const socketContext = vm.createContext({
                    ...context,
                    socket,
                    roomExists: (s) => roomList.has(s.room_id),
                    getRoomAndPeer: (s) => ({ room: roomList.get(s.room_id), peer: room.getPeer(s.id) }),
                });
                // Share the module level timers of the server
                socketContext.quizBroadcastTimers = timers.quizBroadcastTimers;
                socketContext.QUIZ_ANSWER_BATCH_MS = timers.QUIZ_ANSWER_BATCH_MS;
                socketContext.cancelQuizBroadcast = context.cancelQuizBroadcast;
                vm.runInContext(handlerSource, socketContext);
                const client = {
                    id,
                    emitted,
                    send: async (action, data = {}) => {
                        socket.lastQuizActionAt = 0; // the throttle is tested separately
                        await handlers.quiz({ action, ...data });
                    },
                    raw: (payload) => handlers.quiz(payload),
                    received: (action) =>
                        sent.filter((m) => m.id === id && m.event === 'quiz' && m.data.action === action),
                    last: (action) =>
                        sent.filter((m) => m.id === id && m.event === 'quiz' && m.data.action === action).at(-1)?.data,
                    error: () => emitted.filter((m) => m.data.action === 'error').at(-1)?.data.message,
                };
                sockets.set(id, client);
                return client;
            }
            return { room, sent, join, presenters };
        }

        it('runs a quiz step by step, the answers only reach the participants when revealed', async () => {
            const { join, sent } = setup();
            const host = join('s-host', 'Host', { presenter: true });
            const guest = join('s-guest', 'Guest');
            const waiting = join('s-lobby', 'Waiting', { lobby: true });

            await guest.send('list');
            assert.deepEqual(guest.emitted.at(-1).data, { action: 'list', quizzes: [] });

            await host.send('create', {
                title: 'Geo <img src=x onerror=alert(1)>',
                mode: 'step',
                anonymous: true,
                questions: sampleQuestions(),
            });
            const created = guest.last('update');
            assert.equal(created.created_by, 's-host');
            assert.equal(created.quiz.title, 'Geo <img src=x onerror=alert(1)>', 'stored as plain text');
            assert.equal(created.quiz.questions.length, 0);
            assert.equal(host.last('update').quiz.questions.length, 3);
            assert.equal(waiting.received('update').length, 0, 'lobby peers get nothing');
            const quizId = created.quiz.id;

            await guest.send('start', { quiz_id: quizId });
            assert.equal(guest.last('update').event, undefined, 'participants cannot drive it');

            await host.send('start', { quiz_id: quizId });
            assert.equal(guest.last('update').event, 'start');
            assert.equal(guest.last('update').quiz.questions[0].correct, -1);

            await guest.send('answer', { quiz_id: quizId, question: 0, option: 0 });
            await sleep(250);
            assert.equal(guest.last('update').quiz.questions[0].my_answer, 0);
            assert.deepEqual(host.last('update').quiz.questions[0].options[0].voters, ['Guest']);
            assert.ok(
                !JSON.stringify(sent.filter((m) => m.id === 's-guest')).includes('"correct":1'),
                'no early leak of the answer'
            );

            await host.send('answer', { quiz_id: quizId, question: 0, option: 1 });
            assert.equal(host.error(), 'Invalid request', 'presenters do not answer');

            await host.send('reveal', { quiz_id: quizId });
            const revealed = guest.last('update').quiz.questions[0];
            assert.equal(revealed.correct, 1);
            assert.equal(revealed.options[0].voters, undefined, 'anonymous for the participants');

            await host.send('finish', { quiz_id: quizId });
            assert.equal(guest.last('update').quiz.status, 'finished');
            assert.equal(guest.last('update').quiz.leaderboard, undefined);
            assert.deepEqual(host.last('update').quiz.leaderboard, [{ name: 'Guest', score: 0, answers: [0, -1, -1] }]);
            assert.ok(!JSON.stringify(sent).includes('uuid-'), 'peer uuids never sent');
            const payloads = JSON.stringify(sent.map((m) => m.data));
            assert.ok(!payloads.includes('"s:') && !payloads.includes('"n:'), 'no voter or owner keys sent');
        });

        it('binds the creator rights to the connection and enforces the presenter-only polls rule', async () => {
            const { join, room } = setup();
            join('s-host', 'Host', { presenter: true });
            const guest = join('s-guest', 'Guest');
            const other = join('s-other', 'Other');

            await guest.send('create', { title: 'Mine', mode: 'all', questions: sampleQuestions() });
            const quizId = guest.last('update').quiz.id;
            assert.equal(guest.last('update').quiz.can_manage, true);
            assert.equal(other.last('update').quiz.can_manage, false);

            // Same name on a new connection (reload or impostor): participant view only
            room.peers.delete('s-guest');
            const again = join('s-guest-2', 'Guest');
            await again.send('list');
            const snapshot = again.emitted.at(-1).data.quizzes[0];
            assert.equal(snapshot.can_manage, false);
            await again.send('start', { quiz_id: quizId });
            assert.equal(again.received('update').length, 0);

            await other.send('delete', { quiz_id: quizId });
            assert.equal(other.received('delete').length, 0);

            room._moderator.polls_cant_create = true;
            await other.send('create', { title: 'Blocked', mode: 'all', questions: sampleQuestions() });
            assert.equal(other.error(), 'The moderator does not allow non-presenters to create quizzes');
        });

        it('batches a burst of answers into one room update', async () => {
            const { join } = setup();
            const host = join('s-host', 'Host', { presenter: true });
            const a = join('s-a', 'Ann');
            const b = join('s-b', 'Ben');
            await host.send('create', { title: 'Burst', mode: 'all', questions: sampleQuestions() });
            const quizId = host.last('update').quiz.id;
            await host.send('start', { quiz_id: quizId });

            const before = host.received('update').length;
            await a.send('answer', { quiz_id: quizId, question: 0, option: 1 });
            await b.send('answer', { quiz_id: quizId, question: 0, option: 0 });
            assert.equal(host.received('update').length, before, 'not sent yet');
            await sleep(300);
            assert.equal(host.received('update').length, before + 1, 'one update for both answers');
            assert.equal(host.last('update').quiz.questions[0].total_answers, 2);

            // A manager action right after an answer carries it, no stale update after it
            await a.send('answer', { quiz_id: quizId, question: 1, option: 1 });
            await host.send('finish', { quiz_id: quizId });
            const count = host.received('update').length;
            await sleep(300);
            assert.equal(host.received('update').length, count);
            assert.equal(host.last('update').event, 'finish');
            assert.equal(host.last('update').quiz.questions[1].total_answers, 1);
        });

        it('ignores invalid payloads, throttles, and reports errors to the sender only', async () => {
            const { join } = setup();
            const host = join('s-host', 'Host', { presenter: true });
            const guest = join('s-guest', 'Guest');
            await host.raw(null);
            await host.raw(['list']);
            await host.raw('list');
            assert.equal(host.emitted.length, 0);

            await guest.send('create', {
                title: 'Bad',
                mode: 'step',
                questions: [{ question: 'Q', options: ['a', 'b'] }],
            });
            assert.equal(guest.error(), 'Mark the correct answer of every question');
            assert.equal(host.emitted.length, 0);

            // Throttle: a second action within 100 ms is dropped
            await sleep(120);
            await guest.raw({ action: 'list' });
            await guest.raw({ action: 'list' });
            assert.equal(guest.emitted.filter((m) => m.data.action === 'list').length, 1);
        });
    });

    // ####################################################
    // CLIENT UI
    // ####################################################

    describe('client UI', () => {
        function setup() {
            const dom = new JSDOM(
                `<form id="quizForm" class="hidden">
                    <input id="quizTitle" type="text" />
                    <input id="quizModeStep" type="radio" name="quizMode" checked />
                    <input id="quizModeAll" type="radio" name="quizMode" />
                    <input id="quizAnonymous" type="checkbox" />
                    <div id="quizQuestions"></div>
                    <button id="quizAddQuestionBtn" type="button"></button>
                    <button id="quizCancelBtn" type="button"></button>
                    <button id="quizLoadBtn" type="button"></button>
                    <button id="quizSaveBtn" type="button"></button>
                    <input id="quizFileInput" type="file" />
                </form>
                <div id="quizEmpty"></div>
                <div id="quizList"></div>
                <span id="quizCount"></span>`,
                { runScripts: 'outside-only' }
            );
            const { window } = dom;
            window.eval(`${clientSource}\nwindow.RoomQuizzes = RoomQuizzes;`);
            const doc = window.document;
            const sent = [];
            const errors = [];
            const events = [];
            const downloads = [];
            const loaded = [];
            const quizzes = new window.RoomQuizzes({
                elements: {
                    list: doc.getElementById('quizList'),
                    empty: doc.getElementById('quizEmpty'),
                    form: doc.getElementById('quizForm'),
                    title: doc.getElementById('quizTitle'),
                    modeStep: doc.getElementById('quizModeStep'),
                    modeAll: doc.getElementById('quizModeAll'),
                    anonymous: doc.getElementById('quizAnonymous'),
                    questions: doc.getElementById('quizQuestions'),
                    addQuestionBtn: doc.getElementById('quizAddQuestionBtn'),
                    cancelBtn: doc.getElementById('quizCancelBtn'),
                    count: doc.getElementById('quizCount'),
                    loadBtn: doc.getElementById('quizLoadBtn'),
                    saveBtn: doc.getElementById('quizSaveBtn'),
                    fileInput: doc.getElementById('quizFileInput'),
                },
                // JSON round trip like the socket transport (also drops jsdom realm prototypes)
                send: (action, data) => sent.push(JSON.parse(JSON.stringify({ action, ...data }))),
                getMyPeerId: () => 'me',
                onError: (message) => errors.push(message),
                onQuizEvent: (quiz, event, isMine) => events.push({ id: quiz.id, event, isMine }),
                onLoaded: (title) => loaded.push(title),
                translate: (text) => text,
                download: (blob, fileName) => downloads.push({ blob, fileName }),
            });
            return { window, doc, quizzes, sent, errors, events, downloads, loaded };
        }

        const question = (extra = {}) => ({
            index: 0,
            text: 'Best <b>day</b>?',
            state: 'open',
            correct: -1,
            my_answer: -1,
            options: [{ text: 'Monday' }, { text: '<img src=x onerror=alert(1)>' }],
            ...extra,
        });

        const sampleQuiz = (extra = {}) => ({
            id: 'q1',
            title: 'Fun <i>quiz</i>',
            mode: 'step',
            anonymous: true,
            status: 'running',
            current: 0,
            created_at: 1,
            creator_name: 'Bob',
            is_mine: false,
            can_manage: false,
            question_count: 2,
            asked_count: 1,
            revealed_count: 0,
            participant_count: 1,
            my_score: 0,
            average_score: 0,
            questions: [question()],
            ...extra,
        });

        it('renders the participant view as plain text and sends answers', () => {
            const { doc, quizzes, sent, events } = setup();
            quizzes.handle({ action: 'update', quiz: sampleQuiz(), event: 'start', by: 'bob' });
            assert.deepEqual(events, [{ id: 'q1', event: 'start', isMine: false }]);

            const card = doc.querySelector('.quiz-card');
            assert.equal(card.querySelector('.quiz-title').textContent, 'Fun <i>quiz</i>');
            assert.equal(card.querySelector('.quiz-question-text').textContent, 'Best <b>day</b>?');
            assert.equal(doc.querySelector('img'), null, 'no HTML injection');
            assert.equal(doc.querySelector('b'), null);
            assert.equal(card.querySelector('.quiz-progress').textContent, 'Question 1 of 2');
            assert.equal(card.querySelectorAll('.poll-option-result').length, 0, 'no results before the reveal');
            assert.equal(card.querySelector('.poll-card-actions'), null, 'no manage actions');
            assert.equal(doc.getElementById('quizCount').textContent, '1');

            const buttons = card.querySelectorAll('.quiz-option');
            buttons[1].click();
            assert.deepEqual(sent, [{ action: 'answer', quiz_id: 'q1', question: 0, option: 1 }]);

            quizzes.handle({ action: 'update', quiz: sampleQuiz({ questions: [question({ my_answer: 1 })] }) });
            doc.querySelectorAll('.quiz-option')[1].click();
            assert.deepEqual(sent[1], { action: 'answer', quiz_id: 'q1', question: 0, option: -1 }, 'retract');
        });

        it('shows the revealed answer, the score and locks the question', () => {
            const { doc, quizzes, sent } = setup();
            const revealed = question({
                state: 'revealed',
                correct: 0,
                my_answer: 1,
                total_answers: 4,
                options: [
                    { text: 'Monday', votes: 3 },
                    { text: 'Friday', votes: 1 },
                ],
            });
            quizzes.handle({ action: 'list', quizzes: [sampleQuiz({ revealed_count: 1, questions: [revealed] })] });
            const buttons = doc.querySelectorAll('.quiz-option');
            assert.ok(buttons[0].classList.contains('is-correct'));
            assert.ok(buttons[1].classList.contains('is-wrong'));
            assert.ok([...buttons].every((btn) => btn.disabled));
            assert.deepEqual(
                [...doc.querySelectorAll('.poll-option-result')].map((el) => el.textContent),
                ['75% (3)', '25% (1)']
            );
            assert.equal(doc.querySelector('.quiz-score-text').textContent, 'Your score: 0/1');
            assert.equal(doc.querySelector('.quiz-note').textContent, 'Waiting for the next question');
            buttons[0].click();
            assert.equal(sent.length, 0);
        });

        it('gives the managers color coded names and the quiz controls', async () => {
            const { doc, quizzes, sent } = setup();
            const live = question({
                correct: 1,
                total_answers: 2,
                options: [
                    { text: 'Monday', votes: 1, voters: ['Ann'] },
                    { text: 'Friday', votes: 1, voters: ['Max'] },
                ],
            });
            const managed = sampleQuiz({
                is_mine: true,
                can_manage: true,
                questions: [live, question({ index: 1, state: 'pending' })],
                leaderboard: [{ name: 'Ann', score: 0 }],
            });
            quizzes.handle({ action: 'update', quiz: managed });

            const chips = [...doc.querySelectorAll('.quiz-voter')];
            assert.deepEqual(
                chips.map((chip) => [chip.textContent, chip.classList.contains('is-correct')]),
                [
                    ['Ann', false],
                    ['Max', true],
                ]
            );
            assert.ok(chips[0].classList.contains('is-wrong'));
            assert.ok(
                [...doc.querySelectorAll('.quiz-option')].every((btn) => btn.disabled),
                'managers do not answer'
            );
            assert.equal(doc.querySelector('.quiz-leaderboard'), null, 'no ranking before the first reveal');

            const labels = () =>
                [...doc.querySelectorAll('.poll-card-actions button')].map((b) => b.textContent.trim());
            assert.deepEqual(labels(), ['Reveal answer', 'Finish quiz', 'Save to file', 'Delete']);
            doc.querySelector('.poll-card-actions button').click();
            assert.deepEqual(sent, [{ action: 'reveal', quiz_id: 'q1' }]);

            quizzes.handle({
                action: 'update',
                quiz: {
                    ...managed,
                    revealed_count: 1,
                    questions: [{ ...live, state: 'revealed' }, managed.questions[1]],
                },
            });
            assert.deepEqual(labels(), ['Next question', 'Finish quiz', 'Save to file', 'Delete']);
            assert.equal(doc.querySelector('.quiz-leaderboard-name').textContent, 'Ann', 'live ranking');

            quizzes.handle({ action: 'update', quiz: { ...managed, status: 'ready', current: -1 } });
            assert.deepEqual(labels(), ['Start quiz', 'Save to file', 'Delete']);
            assert.equal(doc.querySelectorAll('.quiz-question').length, 0, 'preview collapsed');
            doc.querySelector('.quiz-review-toggle').click();
            assert.equal(doc.querySelectorAll('.quiz-question').length, 2);

            doc.querySelector('.poll-card-actions .poll-btn-danger').click();
            await new Promise((resolve) => setTimeout(resolve, 0));
            assert.deepEqual(sent.at(-1), { action: 'delete', quiz_id: 'q1' });
            quizzes.handle({ action: 'delete', quiz_id: 'q1' });
            assert.equal(doc.querySelectorAll('.quiz-card').length, 0);
            assert.ok(!doc.getElementById('quizEmpty').classList.contains('hidden'));
        });

        it('renders the final results and the leaderboard', () => {
            const { doc, quizzes } = setup();
            quizzes.handle({
                action: 'list',
                quizzes: [
                    sampleQuiz({
                        status: 'finished',
                        anonymous: false,
                        revealed_count: 2,
                        my_score: 2,
                        participant_count: 3,
                        average_score: 1.3,
                        questions: [question({ state: 'revealed', correct: 0, my_answer: 0 })],
                        leaderboard: [
                            { name: 'Me', score: 2 },
                            { name: 'Ann', score: 2 },
                            { name: 'Max', score: 0 },
                        ],
                    }),
                ],
            });
            assert.equal(doc.querySelector('.quiz-score-text').textContent, 'Your score: 2/2');
            assert.ok(doc.querySelector('.quiz-score').classList.contains('is-perfect'));
            assert.equal(doc.querySelector('.quiz-summary').textContent, '3 participants·Average score: 1.3/2');
            assert.deepEqual(
                [...doc.querySelectorAll('.quiz-leaderboard-item')].map((item) => item.dataset.rank),
                ['1', '1', '3'],
                'same score, same rank'
            );
            assert.equal(doc.getElementById('quizCount').textContent, '');

            // Joined after the quiz: no personal score
            quizzes.handle({
                action: 'list',
                quizzes: [
                    sampleQuiz({
                        status: 'finished',
                        revealed_count: 1,
                        questions: [question({ state: 'revealed', correct: 0 })],
                    }),
                ],
            });
            assert.equal(doc.querySelector('.quiz-score'), null);
            assert.ok(doc.querySelector('.quiz-summary'));
        });

        it('gives a participant creator of an anonymous quiz no ranking nor results export', () => {
            const { doc, quizzes } = setup();
            const base = sampleQuiz({ is_mine: true, can_manage: true, revealed_count: 1 });
            quizzes.handle({ action: 'list', quizzes: [base] });
            assert.equal(doc.querySelector('.quiz-leaderboard-wrap'), null);
            quizzes.handle({ action: 'list', quizzes: [{ ...base, status: 'finished' }] });
            assert.equal(doc.querySelector('.quiz-leaderboard-wrap'), null);
            assert.deepEqual(
                [...doc.querySelectorAll('.poll-card-actions button')].map((b) => b.textContent.trim()),
                ['Save to file', 'Delete']
            );
        });

        it('lets the managers download the results of a finished quiz as CSV', async () => {
            const { doc, quizzes, downloads } = setup();
            const finished = sampleQuiz({
                id: 'q9',
                title: 'Friday "trivia" / week 1',
                status: 'finished',
                is_mine: true,
                can_manage: true,
                question_count: 3,
                revealed_count: 2,
                questions: [
                    question({
                        state: 'revealed',
                        correct: 1,
                        text: 'Capital, of "Italy"?',
                        options: [{ text: 'Milan' }, { text: 'Rome' }],
                    }),
                    question({
                        index: 1,
                        state: 'revealed',
                        correct: 0,
                        text: '2 + 2?',
                        options: [{ text: '4' }, { text: '=1+1' }],
                    }),
                    question({ index: 2, state: 'pending', text: 'Never asked' }),
                ],
                leaderboard: [
                    { name: 'Ann', score: 2, answers: [1, 0, -1] },
                    { name: '=HYPERLINK("x")', score: 0, answers: [0, 1, -1] },
                    { name: 'Max', score: 0, answers: [-1, -1, -1] },
                ],
            });

            // Running quiz: no export yet
            quizzes.handle({ action: 'list', quizzes: [{ ...finished, status: 'running' }] });
            const labels = () =>
                [...doc.querySelectorAll('.poll-card-actions button')].map((b) => b.textContent.trim());
            assert.ok(!labels().includes('Download results'));

            quizzes.handle({ action: 'list', quizzes: [finished] });
            assert.deepEqual(labels(), ['Download results', 'Save to file', 'Delete']);
            doc.querySelector('.poll-card-actions button').click();
            assert.equal(downloads.length, 1);
            assert.match(downloads[0].fileName, /^Quiz-Friday-trivia-week-1-\d{4}-\d{2}-\d{2}\.csv$/);
            assert.equal(downloads[0].blob.type, 'text/csv;charset=utf-8');

            const csv = quizzes.buildResultsCsv(finished);
            assert.ok(csv.startsWith('\uFEFF'), 'UTF-8 BOM for spreadsheet apps');
            assert.deepEqual(csv.slice(1).split('\r\n'), [
                '"Rank","Participant","Score (out of 2)","1. Capital, of ""Italy""?","2. 2 + 2?"',
                '"","Correct answer","","Rome","4"',
                '"1","Ann","2","Rome","4"',
                '"2","\'=HYPERLINK(""x"")","0","Milan","\'=1+1"',
                '"2","Max","0","",""',
                '',
            ]);
            assert.ok(!csv.includes('Never asked'), 'questions never asked are left out');

            // Participants never get the export
            quizzes.handle({ action: 'list', quizzes: [{ ...finished, is_mine: false, can_manage: false }] });
            assert.equal(doc.querySelector('.poll-card-actions'), null);
            assert.equal(quizzes.buildResultsCsv({ ...finished, can_manage: false }), null);
        });

        const readDownload = (window, download) => window.RoomQuizzes.readText(download.blob).then(JSON.parse);

        it('saves the builder to a file, even a draft, and loads it back', async () => {
            const { window, doc, quizzes, sent, errors, downloads, loaded } = setup();
            quizzes.showForm();
            doc.getElementById('quizSaveBtn').click();
            assert.deepEqual(errors, ['The quiz is empty']);
            assert.equal(downloads.length, 0);

            doc.getElementById('quizTitle').value = ' Trivia: week 1 ';
            doc.getElementById('quizModeAll').checked = true;
            doc.getElementById('quizAnonymous').checked = false;
            const first = doc.querySelector('.quiz-form-question');
            first.querySelector('.quiz-form-question-text').value = 'Capital of Italy?';
            first.querySelector('.quiz-form-add-option').click();
            const inputs = first.querySelectorAll('.quiz-form-option-text');
            inputs[0].value = 'Milan';
            inputs[2].value = 'Rome'; // the empty option in between is left out
            first.querySelectorAll('.quiz-form-correct')[2].checked = true;
            doc.getElementById('quizAddQuestionBtn').click();
            // Draft: second question without text and correct answer
            doc.querySelectorAll('.quiz-form-question')[1].querySelector('.quiz-form-option-text').value = 'Maybe';
            doc.getElementById('quizAddQuestionBtn').click(); // empty, left out

            doc.getElementById('quizSaveBtn').click();
            assert.equal(downloads.length, 1);
            assert.equal(downloads[0].fileName, 'Quiz-Trivia-week-1.json');
            assert.equal(downloads[0].blob.type, 'application/json');
            const file = await readDownload(window, downloads[0]);
            assert.deepEqual(file, {
                type: 'mirotalk-quiz',
                version: 1,
                title: 'Trivia: week 1',
                mode: 'all',
                anonymous: false,
                questions: [
                    { question: 'Capital of Italy?', options: ['Milan', 'Rome'], correct: 1 },
                    { question: '', options: ['Maybe'], correct: -1 },
                ],
            });
            assert.ok(!doc.getElementById('quizForm').classList.contains('hidden'), 'saving keeps the builder open');

            // Load it in a new room: the builder is filled, ready to review and create
            const other = setup();
            const json = JSON.stringify(file);
            assert.equal(await other.quizzes.loadFile(new other.window.File([json], 'quiz.json')), true);
            assert.deepEqual(other.loaded, ['Trivia: week 1']);
            assert.ok(!other.doc.getElementById('quizForm').classList.contains('hidden'));
            assert.equal(other.doc.getElementById('quizTitle').value, 'Trivia: week 1');
            assert.ok(other.doc.getElementById('quizModeAll').checked);
            assert.equal(other.doc.getElementById('quizAnonymous').checked, false);
            const blocks = other.doc.querySelectorAll('.quiz-form-question');
            assert.equal(blocks.length, 2);
            assert.equal(blocks[1].querySelectorAll('.quiz-form-option').length, 2, 'at least 2 option inputs');

            // The draft still has to be completed before creating it
            other.quizzes.submitForm();
            assert.deepEqual(other.errors, ['Every question needs a text']);
            blocks[1].querySelector('.quiz-form-question-text').value = 'Sure?';
            blocks[1].querySelectorAll('.quiz-form-option-text')[1].value = 'No';
            blocks[1].querySelectorAll('.quiz-form-correct')[1].checked = true;
            other.quizzes.submitForm();
            assert.deepEqual(other.sent, [
                {
                    action: 'create',
                    title: 'Trivia: week 1',
                    mode: 'all',
                    anonymous: false,
                    questions: [
                        { question: 'Capital of Italy?', options: ['Milan', 'Rome'], correct: 1 },
                        { question: 'Sure?', options: ['Maybe', 'No'], correct: 1 },
                    ],
                },
            ]);
            assert.equal(sent.length, 0);
        });

        it('rejects invalid quiz files and clamps the loaded values', async () => {
            const { window, doc, quizzes, errors, loaded } = setup();
            const { parseDefinition } = window.RoomQuizzes;
            const valid = { type: 'mirotalk-quiz', questions: [{ question: 'Q', options: ['a', 'b'], correct: 0 }] };
            assert.equal(parseDefinition('not json'), null);
            assert.equal(parseDefinition('null'), null);
            assert.equal(parseDefinition(JSON.stringify({ ...valid, type: 'other' })), null);
            assert.equal(parseDefinition(JSON.stringify({ ...valid, questions: [] })), null);
            assert.equal(
                parseDefinition(JSON.stringify({ ...valid, questions: Array(31).fill(valid.questions[0]) })),
                null
            );
            assert.equal(
                parseDefinition(JSON.stringify({ ...valid, questions: [{ question: 'Q', options: 'a' }] })),
                null
            );

            // JSON round trip: drops the jsdom realm prototypes
            const parsed = JSON.parse(
                JSON.stringify(
                    parseDefinition(
                        JSON.stringify({
                            type: 'mirotalk-quiz',
                            version: 99,
                            title: 'T'.repeat(500),
                            mode: 'weird',
                            questions: [
                                { question: 42, options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], correct: 6 },
                                { question: 'Q', options: [{ html: '<b>x</b>' }, 'ok'], correct: 0 },
                            ],
                        })
                    )
                )
            );
            assert.equal(parsed.title.length, 120);
            assert.equal(parsed.mode, 'step');
            assert.equal(parsed.anonymous, true, 'anonymous unless explicitly disabled');
            assert.deepEqual(parsed.questions[0], {
                question: '42',
                options: ['a', 'b', 'c', 'd', 'e', 'f'],
                correct: -1,
            });
            assert.deepEqual(parsed.questions[1], { question: 'Q', options: ['', 'ok'], correct: -1 }, 'empty correct');

            assert.equal(await quizzes.loadFile(new window.File(['{"type":"other"}'], 'x.json')), false);
            const huge = new window.File(['x'.repeat(window.RoomQuizzes.MAX_FILE_SIZE + 1)], 'big.json');
            assert.equal(await quizzes.loadFile(huge), false);
            assert.deepEqual(errors, ['Invalid quiz file', 'Invalid quiz file']);
            assert.deepEqual(loaded, []);
            assert.ok(doc.getElementById('quizForm').classList.contains('hidden'), 'builder untouched');
        });

        it('saves a quiz of the room for the managers only', async () => {
            const { window, doc, quizzes, downloads } = setup();
            const managed = sampleQuiz({
                title: 'Geo',
                can_manage: true,
                is_mine: true,
                status: 'ready',
                question_count: 2,
                questions: [
                    question({ index: 1, text: 'Second', correct: 0, options: [{ text: 'x' }, { text: 'y' }] }),
                    question({ index: 0, text: 'First', correct: 1, options: [{ text: 'a' }, { text: 'b' }] }),
                ],
            });
            quizzes.handle({ action: 'list', quizzes: [managed] });
            [...doc.querySelectorAll('.poll-card-actions button')]
                .find((btn) => btn.textContent.trim() === 'Save to file')
                .click();
            assert.equal(downloads[0].fileName, 'Quiz-Geo.json');
            assert.deepEqual((await readDownload(window, downloads[0])).questions, [
                { question: 'First', options: ['a', 'b'], correct: 1 },
                { question: 'Second', options: ['x', 'y'], correct: 0 },
            ]);

            // Participants never get the correct answers
            quizzes.handle({ action: 'list', quizzes: [{ ...managed, can_manage: false, is_mine: false }] });
            assert.equal(doc.querySelector('.poll-card-actions'), null);
            quizzes.saveQuiz(managed.id);
            assert.equal(downloads.length, 1);
        });

        it('validates the builder before sending', () => {
            const { doc, quizzes, sent, errors } = setup();
            quizzes.showForm();
            assert.equal(doc.querySelectorAll('.quiz-form-question').length, 1);
            assert.equal(doc.querySelectorAll('.quiz-form-option').length, 2);

            quizzes.submitForm();
            assert.deepEqual(errors, ['The quiz title is required']);

            doc.getElementById('quizTitle').value = ' Trivia ';
            quizzes.submitForm();
            assert.equal(errors[1], 'Every question needs a text');

            const [first] = doc.querySelectorAll('.quiz-form-question');
            first.querySelector('.quiz-form-question-text').value = 'Capital of Italy?';
            const firstInputs = first.querySelectorAll('.quiz-form-option-text');
            firstInputs[0].value = 'Milan';
            firstInputs[1].value = 'Rome';
            quizzes.submitForm();
            assert.equal(errors[2], 'Mark the correct answer of every question');
            first.querySelectorAll('.quiz-form-correct')[1].checked = true;

            for (let i = 0; i < 10; i++) first.querySelector('.quiz-form-add-option').click();
            assert.equal(first.querySelectorAll('.quiz-form-option').length, 6);

            doc.getElementById('quizAddQuestionBtn').click();
            const second = doc.querySelectorAll('.quiz-form-question')[1];
            assert.equal(second.querySelector('.quiz-form-question-label').textContent, 'Question 2');
            second.querySelector('.quiz-form-question-text').value = '2 + 2?';
            const secondInputs = second.querySelectorAll('.quiz-form-option-text');
            secondInputs[0].value = '4';
            secondInputs[1].value = ' 4 ';
            second.querySelectorAll('.quiz-form-correct')[1].checked = true;
            quizzes.submitForm();
            assert.equal(errors[3], 'At least 2 different options are required');

            second.querySelector('.quiz-form-add-option').click();
            second.querySelectorAll('.quiz-form-option-text')[2].value = '5';
            doc.getElementById('quizModeAll').checked = true;
            doc.getElementById('quizAnonymous').checked = false;
            quizzes.submitForm();
            assert.deepEqual(sent, [
                {
                    action: 'create',
                    title: 'Trivia',
                    mode: 'all',
                    anonymous: false,
                    questions: [
                        { question: 'Capital of Italy?', options: ['Milan', 'Rome'], correct: 1 },
                        { question: '2 + 2?', options: ['4', '5'], correct: 0 },
                    ],
                },
            ]);
            assert.ok(doc.getElementById('quizForm').classList.contains('hidden'));
            assert.equal(doc.querySelectorAll('.quiz-form-question').length, 1, 'form reset');
            assert.ok(doc.getElementById('quizModeStep').checked);
        });

        it('ignores malformed server messages', () => {
            const { doc, quizzes } = setup();
            quizzes.handle(null);
            quizzes.handle({ action: 'update', quiz: { id: 1 } });
            quizzes.handle({ action: 'update', quiz: sampleQuiz({ questions: [{ text: 'x' }] }) });
            quizzes.handle({ action: 'list', quizzes: 'nope' });
            assert.equal(doc.querySelectorAll('.quiz-card').length, 0);
        });
    });

    // ####################################################
    // WIRING
    // ####################################################

    describe('wiring', () => {
        it('loads the quiz UI in the polls panel', () => {
            assert.match(
                roomHtml,
                /<script defer src="\.\.\/js\/Quiz\.js"><\/script>\s*<script defer src="\.\.\/js\/RoomClient\.js">/
            );
            assert.match(roomHtml, /<link rel="stylesheet" href="\.\.\/css\/Quiz\.css" \/>/);
            for (const id of [
                'pollTabQuiz',
                'pollPanePolls',
                'pollPaneQuiz',
                'quizForm',
                'quizNewBtn',
                'quizLoadBtn',
                'quizFileInput',
            ]) {
                assert.match(roomHtml, new RegExp(`id="${id}"`));
            }
            assert.match(roomClientJs, /this\.socket\.on\('quiz', this\.handleQuiz\)/);
            assert.match(roomClientJs, /this\.socket\.emit\('quiz', \{ action: 'list' \}\)/);
            assert.match(roomClientJs, /new RoomQuizzes\(/);
            assert.match(roomJs, /rc\.initQuizzes\(\)/);
            assert.match(serverSource, /const RoomQuizzes = require\('\.\/RoomQuizzes'\)/);
        });

        it('scopes the shared poll classes to the quiz pane', () => {
            const selectors = quizCss
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .match(/[^{}]+(?=\{)/g)
                .map((s) => s.trim());
            for (const selector of selectors.flatMap((s) => s.split(',').map((part) => part.trim()))) {
                if (
                    !/\.poll-(btn|form|card|option|question|empty|list|link|meta|badge|creator|voters|anonymous)/.test(
                        selector
                    )
                )
                    continue;
                assert.ok(selector.startsWith('.quiz-pane '), `${selector} must be scoped`);
            }
        });
    });
});
