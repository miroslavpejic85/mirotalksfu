'use strict';

// npx mocha tests/test-HandGesture.js

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const roomHtml = fs.readFileSync(path.join(ROOT, 'public/views/Room.html'), 'utf8');
const roomSource = fs.readFileSync(path.join(ROOT, 'public/js/Room.js'), 'utf8');

const HandGesture = require('../public/js/HandGesture.js');

describe('Hand Gesture Raise-Hand Detection', () => {
    describe('GestureTracker state machine', () => {
        let tracker;

        beforeEach(() => {
            tracker = new HandGesture.GestureTracker({ holdDurationMs: 2000, cooldownMs: 4000 });
        });

        it('tracks holding progress and resets when the palm is dropped early', () => {
            assert.deepEqual(tracker.update(true, 1000), { status: 'holding', progress: 0 });
            assert.deepEqual(tracker.update(true, 2000), { status: 'holding', progress: 0.5 });
            assert.deepEqual(tracker.update(false, 2500), { status: 'idle', progress: 0 });
            assert.deepEqual(tracker.update(true, 3000), { status: 'holding', progress: 0 });
        });

        it('triggers after 2 seconds, then ignores palms until the cooldown expires', () => {
            tracker.update(true, 1000);
            assert.equal(tracker.update(true, 3000).status, 'triggered');
            assert.equal(tracker.update(true, 6999).status, 'cooldown');
            assert.deepEqual(tracker.update(true, 7001), { status: 'holding', progress: 0 });
        });
    });

    describe('HandGestureManager', () => {
        let document;
        let progressContainer;
        let progressFill;
        let manager;

        beforeEach(() => {
            const dom = new JSDOM(`<!doctype html><html><body>
                <div class="Camera">
                    <video id="myVideo"></video>
                    <div id="gestureProgress" class="gesture-hand-progress" hidden>
                        <svg><circle class="gesture-hand-circle-fill"></circle></svg>
                    </div>
                </div>
            </body></html>`);
            document = dom.window.document;
            progressContainer = document.getElementById('gestureProgress');
            progressFill = progressContainer.querySelector('.gesture-hand-circle-fill');
            manager = new HandGesture.HandGestureManager();
            manager.attachElements({ video: document.getElementById('myVideo'), progressContainer, progressFill });
        });

        it('shows the progress ring while holding and hides it when released', () => {
            manager.updateUI(0.5, true);
            assert.equal(progressContainer.hasAttribute('hidden'), false);
            assert.equal(progressFill.style.strokeDashoffset, '50');

            manager.updateUI(0, false);
            assert.equal(progressContainer.hasAttribute('hidden'), true);
            assert.equal(progressContainer.classList.contains('visible'), false);
        });

        it('fires onTrigger once an open palm is held for 2 seconds', () => {
            const onTrigger = sinon.spy();
            manager.onTrigger = onTrigger;
            Object.defineProperty(document.getElementById('myVideo'), 'readyState', { value: 4 });
            manager.recognizer = {
                recognize: sinon.stub().returns({ gestures: [[{ categoryName: 'Open_Palm', score: 0.95 }]] }),
            };
            manager.running = true;
            manager.enabled = true;

            const clock = sinon.useFakeTimers(1000);
            try {
                manager.tick();
                clock.tick(1000);
                assert.equal(onTrigger.called, false);
                assert.equal(progressContainer.classList.contains('visible'), true);
                clock.tick(1200);
                assert.equal(onTrigger.calledOnce, true);
            } finally {
                manager.stop();
                clock.restore();
            }
        });

        it('loads the module worker from HandGestureWorker.js and frees it on dispose()', async () => {
            const saved = {};
            for (const name of ['Worker', 'OffscreenCanvas', 'createImageBitmap']) saved[name] = global[name];
            const workers = [];
            global.Worker = class {
                constructor(url, options) {
                    this.url = String(url);
                    this.options = options;
                    this.listeners = {};
                    workers.push(this);
                }
                addEventListener(type, fn) {
                    (this.listeners[type] ||= []).push(fn);
                }
                postMessage() {}
                terminate() {
                    this.terminated = true;
                }
            };
            global.OffscreenCanvas = class {};
            global.createImageBitmap = async () => ({ close() {} });
            try {
                const workerManager = new HandGesture.HandGestureManager({ baseUrl: 'https://example.test/js/' });
                const ready = workerManager.initRecognizer();
                assert.equal(workers[0].url, 'https://example.test/js/HandGestureWorker.js');
                assert.equal(workers[0].options.type, 'module');
                workers[0].listeners.message.forEach((fn) => fn({ data: { type: 'init_done' } }));
                assert.equal(await ready, true);

                workerManager.dispose();
                assert.equal(workers[0].terminated, true);
                assert.equal(workerManager.worker, null);
                assert.equal(workerManager.workerReady, false);
            } finally {
                for (const [name, value] of Object.entries(saved)) {
                    if (value === undefined) delete global[name];
                    else global[name] = value;
                }
            }
        });
    });

    describe('Room.js integration', () => {
        let context;
        let managers;

        function loadGestureSection() {
            const start = roomSource.indexOf('function createGestureHandProgress(');
            const end = roomSource.indexOf('// UTILITY', start);
            assert.ok(start !== -1 && end > start);
            const dom = new JSDOM(
                '<!doctype html><html><body><div class="Camera"><video></video></div>' +
                    '<input id="quick" type="checkbox" class="gesture-hand-raise-switch"></body></html>'
            );
            const videoEl = dom.window.document.querySelector('video');
            managers = [];
            class FakeManager {
                constructor() {
                    this.start = sinon.spy();
                    this.stop = sinon.spy();
                    this.dispose = sinon.spy();
                    this.attachElements = sinon.spy();
                    managers.push(this);
                }
            }
            context = vm.createContext({
                document: dom.window.document,
                HandGesture: { HandGestureManager: FakeManager },
                rc: { localVideoElement: videoEl },
                video: true,
                hand: false,
                isRulesActive: false,
                isPresenter: false,
                BUTTONS: { main: { raiseHandButton: true } },
                localStorageSettings: { gesture_hand_raise: false },
                lS: { setSettings: sinon.spy() },
                switchGestureHandRaise: { checked: false },
                raiseHandButton: { click: sinon.spy() },
                lowerHandButton: { click: sinon.spy() },
                userLog: sinon.spy(),
            });
            vm.runInContext(
                `let gestureHandRaiseEnabled = false; let handGestureManager = null;\n${roomSource.slice(start, end)}`,
                context
            );
            return videoEl;
        }

        it('persists the setting and starts detection on the local camera tile', () => {
            const videoEl = loadGestureSection();
            context.setGestureHandRaise(true);

            assert.equal(context.localStorageSettings.gesture_hand_raise, true);
            assert.equal(context.lS.setSettings.calledOnce, true);
            assert.equal(context.switchGestureHandRaise.checked, true);
            assert.equal(context.document.getElementById('quick').checked, true, 'menu quick switches follow');
            assert.equal(managers.length, 1);
            assert.equal(managers[0].start.calledOnce, true);
            const { video, progressContainer, onTrigger } = managers[0].attachElements.firstCall.args[0];
            assert.equal(video, videoEl);
            assert.equal(progressContainer.parentElement, videoEl.parentElement);

            // Re-syncing reuses the same progress ring instead of stacking new ones
            context.syncGestureHandRaise();
            assert.equal(videoEl.parentElement.querySelectorAll('.gesture-hand-progress').length, 1);
            assert.equal(typeof onTrigger, 'function');
        });

        it('stops while the camera is off and frees the model when the setting is turned off', () => {
            loadGestureSection();
            context.setGestureHandRaise(true);

            vm.runInContext('video = false', context);
            context.syncGestureHandRaise();
            assert.equal(managers[0].stop.calledOnce, true);

            context.setGestureHandRaise(false);
            assert.equal(managers[0].dispose.calledOnce, true);
        });

        it('toggles the hand on trigger, unless the presenter disabled raising hands', () => {
            loadGestureSection();
            context.onGestureHandRaiseTrigger();
            assert.equal(context.raiseHandButton.click.calledOnce, true);

            vm.runInContext('hand = true', context);
            context.onGestureHandRaiseTrigger();
            assert.equal(context.lowerHandButton.click.calledOnce, true);

            vm.runInContext('isRulesActive = true; BUTTONS.main.raiseHandButton = false', context);
            context.onGestureHandRaiseTrigger();
            assert.equal(context.lowerHandButton.click.calledOnce, true);
            assert.match(context.userLog.firstCall.args[1], /presenter has disabled your ability to raise your hand/);
        });
    });

    describe('Markup wiring', () => {
        it('adds the toggle to the camera settings and loads HandGesture.js after VirtualBackground.js', () => {
            const cameraCard = roomHtml.slice(
                roomHtml.indexOf('id="cameraSettingsDiv"'),
                roomHtml.indexOf('id="ScreenSettingsDiv"')
            );
            assert.match(cameraCard, /id="switchGestureHandRaise"/);

            const handMenu = roomHtml.slice(
                roomHtml.indexOf('id="raiseHandReactionsMenu"'),
                roomHtml.indexOf('id="chatButton"')
            );
            assert.match(handMenu, /id="raiseHandGestureSwitch"\s+class="[^"]*gesture-hand-raise-switch/);

            const gesturePos = roomHtml.indexOf('<script defer src="../js/HandGesture.js"></script>');
            assert.ok(gesturePos > roomHtml.indexOf('../js/VirtualBackground.js'), 'shares VB_TASKS_VISION_VERSION');
            assert.ok(roomHtml.indexOf('../js/Room.js') > gesturePos);
        });
    });
});
