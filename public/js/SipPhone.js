/*
 * SIP phone module
 * Exposes window.initSipPhoneMvp(config)
 */
(function () {
    'use strict';

    function initSipPhoneMvp(config = {}) {
        const {
            elements = {},
            getPeerName = () => 'user',
            openSipTab = () => {},
            setIncomingActionsVisible = () => {},
            onUsernameCopied = () => {},
        } = config;

        const {
            tabSipPhoneBtn,
            sipWsServer,
            sipDomain,
            sipUsername,
            sipAuthUsername,
            sipPassword,
            sipTarget,
            sipHackIpInContact,
            sipDisplayName,
            sipOutboundProxy,
            sipRegisterExpires,
            sipStatus,
            sipRemoteAudio,
            sipGenerateUserBtn,
            sipCopyUserBtn,
            sipRegisterBtn,
            sipUnregisterBtn,
            sipCallBtn,
            sipHangupBtn,
            sipAcceptBtn,
            sipRejectBtn,
        } = elements;

        if (!sipRegisterBtn || !tabSipPhoneBtn) return;

        let sipModule = null;
        let sipUserAgent = null;
        let sipRegisterer = null;
        let sipActiveSession = null;
        let sipPendingInvitation = null;
        let sipRingtoneContext = null;
        let sipRingtoneInterval = null;

        function getSipDefaultHost() {
            if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return '127.0.0.1';
            return location.hostname;
        }

        function randomSipUsername() {
            const base = String(getPeerName() || 'user')
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '')
                .slice(0, 6);
            const suffix = Math.floor(1000 + Math.random() * 9000);
            return `${base || 'user'}${suffix}`;
        }

        function normalizeSipRouteSet(routeValue) {
            const value = String(routeValue || '').trim();
            if (!value) return null;
            if (/^<\s*sips?:/i.test(value)) return value;
            if (/^sips?:/i.test(value)) return `<${value}>`;
            return `<sip:${value}>`;
        }

        function initSipDefaults() {
            if (!sipWsServer || !sipDomain || !sipUsername) return;
            const host = getSipDefaultHost();
            if (!sipWsServer.value) sipWsServer.value = `ws://${host}:5066`;
            if (!sipDomain.value) sipDomain.value = host;
            if (!sipUsername.value) sipUsername.value = randomSipUsername();
            if (sipAuthUsername && !sipAuthUsername.value) sipAuthUsername.value = sipUsername.value;
            if (sipRegisterExpires && !sipRegisterExpires.value) sipRegisterExpires.value = '600';
        }

        function setSipStatus(message) {
            if (sipStatus) sipStatus.textContent = message;
            console.log('[SIP]', message);
        }

        function playSipRingtoneBurst() {
            if (!sipRingtoneContext || sipRingtoneContext.state === 'closed') return;
            const now = sipRingtoneContext.currentTime;
            const burstTimes = [0, 0.42];

            burstTimes.forEach((offset) => {
                const gain = sipRingtoneContext.createGain();
                gain.gain.value = 0;
                gain.connect(sipRingtoneContext.destination);

                const toneA = sipRingtoneContext.createOscillator();
                toneA.type = 'sine';
                toneA.frequency.value = 440;
                toneA.connect(gain);

                const toneB = sipRingtoneContext.createOscillator();
                toneB.type = 'sine';
                toneB.frequency.value = 480;
                toneB.connect(gain);

                const startAt = now + offset;
                const stopAt = startAt + 0.22;
                gain.gain.setValueAtTime(0.0001, startAt);
                gain.gain.exponentialRampToValueAtTime(0.09, startAt + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

                toneA.start(startAt);
                toneB.start(startAt + 0.01);
                toneA.stop(stopAt);
                toneB.stop(stopAt);
            });
        }

        function startSipRingtone() {
            if (sipRingtoneInterval) return;
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                sipRingtoneContext = new AudioCtx();
                sipRingtoneContext.resume().catch(() => {});
                playSipRingtoneBurst();
                sipRingtoneInterval = setInterval(playSipRingtoneBurst, 3200);
            } catch (error) {
                console.warn('[SIP] Unable to start ringtone:', error);
            }
        }

        function stopSipRingtone() {
            if (sipRingtoneInterval) {
                clearInterval(sipRingtoneInterval);
                sipRingtoneInterval = null;
            }
            if (sipRingtoneContext && sipRingtoneContext.state !== 'closed') {
                sipRingtoneContext.close().catch(() => {});
            }
            sipRingtoneContext = null;
        }

        function toggleSipIncomingActions(showActions) {
            setIncomingActionsVisible(showActions);
        }

        function cleanupSipRemoteAudio() {
            if (!sipRemoteAudio) return;
            const current = sipRemoteAudio.srcObject;
            if (current && typeof current.getTracks === 'function') {
                current.getTracks().forEach((track) => track.stop());
            }
            sipRemoteAudio.srcObject = null;
        }

        function attachSipRemoteAudio(session) {
            if (!sipRemoteAudio) return;
            const pc = session?.sessionDescriptionHandler?.peerConnection;
            if (!pc) return;

            const remoteStream = new MediaStream();
            pc.getReceivers().forEach((receiver) => {
                if (receiver.track) remoteStream.addTrack(receiver.track);
            });

            pc.ontrack = (event) => {
                event.streams[0]?.getTracks()?.forEach((track) => remoteStream.addTrack(track));
                sipRemoteAudio.srcObject = remoteStream;
            };

            sipRemoteAudio.srcObject = remoteStream;
        }

        function disposeSipSession(session) {
            if (!session) return;
            try {
                const pc = session.sessionDescriptionHandler?.peerConnection;
                if (pc && pc.signalingState !== 'closed') pc.close();
            } catch (error) {
                console.warn('[SIP] PeerConnection close warning', error);
            }
            if (typeof session.dispose === 'function') {
                try {
                    session.dispose();
                } catch (error) {
                    console.warn('[SIP] Session dispose warning', error);
                }
            }
        }

        function bindSipSessionState(session) {
            session.stateChange.addListener((state) => {
                setSipStatus(`Call state: ${state}`);
                if (state === sipModule.SessionState.Established) {
                    attachSipRemoteAudio(session);
                }
                if (state === sipModule.SessionState.Terminated) {
                    stopSipRingtone();
                    cleanupSipRemoteAudio();
                    disposeSipSession(session);
                    if (sipActiveSession === session) sipActiveSession = null;
                }
            });
        }

        function bindSipSessionDelegate(session, extraDelegate = {}) {
            const previous = session.delegate || {};
            session.delegate = {
                ...previous,
                ...extraDelegate,
                onBye: async (bye) => {
                    try {
                        await bye.accept();
                    } catch (error) {
                        console.warn('[SIP] BYE accept warning', error);
                    }
                    setSipStatus('Call ended by remote party');
                    stopSipRingtone();
                    if (typeof previous.onBye === 'function') {
                        try {
                            previous.onBye(bye);
                        } catch (error) {
                            console.warn('[SIP] Previous onBye delegate warning', error);
                        }
                    }
                },
            };
        }

        async function loadSipModule() {
            if (sipModule) return sipModule;
            setSipStatus('Loading SIP library...');
            sipModule = await import('https://cdn.jsdelivr.net/npm/sip.js@0.21.2/lib/index.min.js');
            return sipModule;
        }

        async function sipRegister() {
            try {
                initSipDefaults();

                if (sipUserAgent) {
                    setSipStatus('Already registered or registering');
                    return;
                }

                const wsServer = sipWsServer?.value?.trim();
                const domain = sipDomain?.value?.trim();
                const username = sipUsername?.value?.trim();
                const authUsername = sipAuthUsername?.value?.trim() || username;
                const password = sipPassword?.value || '';
                const hackIpInContact = !!sipHackIpInContact?.checked;
                const displayName = sipDisplayName?.value?.trim() || undefined;
                const outboundProxy = normalizeSipRouteSet(sipOutboundProxy?.value);
                const registerExpires = Math.max(60, parseInt(sipRegisterExpires?.value || '600', 10) || 600);

                if (!wsServer || !domain || !username) {
                    setSipStatus('Missing WS server/domain/username');
                    return;
                }

                await loadSipModule();

                const uri = sipModule.UserAgent.makeURI(`sip:${username}@${domain}`);
                if (!uri) {
                    setSipStatus('Invalid SIP URI');
                    return;
                }

                sipUserAgent = new sipModule.UserAgent({
                    uri,
                    hackIpInContact,
                    contactName: username,
                    ...(displayName ? { displayName } : {}),
                    ...(outboundProxy ? { routeSet: [outboundProxy] } : {}),
                    transportOptions: { server: wsServer },
                    authorizationUsername: authUsername,
                    authorizationPassword: password,
                    delegate: {
                        onInvite: (invitation) => {
                            sipPendingInvitation = invitation;
                            toggleSipIncomingActions(true);
                            setSipStatus(`Incoming call from ${invitation.remoteIdentity.uri.user}`);
                            startSipRingtone();
                        },
                    },
                });

                await sipUserAgent.start();
                sipRegisterer = new sipModule.Registerer(sipUserAgent, { expires: registerExpires });
                await sipRegisterer.register();

                setSipStatus(
                    `Registered as sip:${username}@${domain}${outboundProxy ? ' via outbound proxy' : ''} (exp ${registerExpires}s)`
                );
            } catch (error) {
                setSipStatus(`Register failed: ${error?.message || error}`);
                console.error(error);
            }
        }

        async function sipUnregister() {
            try {
                stopSipRingtone();
                toggleSipIncomingActions(false);
                if (sipPendingInvitation) {
                    await sipPendingInvitation.reject();
                    sipPendingInvitation = null;
                }
                if (sipActiveSession) {
                    await sipHangup();
                }
                if (sipRegisterer) {
                    await sipRegisterer.unregister();
                    sipRegisterer = null;
                }
                if (sipUserAgent) {
                    await sipUserAgent.stop();
                    sipUserAgent = null;
                }
                setSipStatus('Unregistered');
            } catch (error) {
                setSipStatus(`Unregister failed: ${error?.message || error}`);
                console.error(error);
            }
        }

        async function sipCall() {
            try {
                if (!sipUserAgent) {
                    setSipStatus('Register first');
                    return;
                }
                if (sipActiveSession) {
                    setSipStatus('A call is already active');
                    return;
                }

                const target = sipTarget?.value?.trim();
                const targetDomain = sipDomain?.value?.trim();
                if (!target || !targetDomain) {
                    setSipStatus('Missing call target/domain');
                    return;
                }

                const targetUri = sipModule.UserAgent.makeURI(`sip:${target}@${targetDomain}`);
                if (!targetUri) {
                    setSipStatus('Invalid target SIP URI');
                    return;
                }

                const inviter = new sipModule.Inviter(sipUserAgent, targetUri, {
                    sessionDescriptionHandlerOptions: {
                        constraints: { audio: true, video: false },
                    },
                });

                cleanupSipRemoteAudio();
                bindSipSessionState(inviter);
                bindSipSessionDelegate(inviter, {
                    onProgress: (response) => {
                        setSipStatus(`Call progress: ${response?.message?.statusCode || 'ringing'}`);
                    },
                    onReject: (response) => {
                        setSipStatus(`Call rejected: ${response?.message?.statusCode || 'unknown'}`);
                    },
                });

                sipActiveSession = inviter;
                await inviter.invite();
            } catch (error) {
                setSipStatus(`Call failed: ${error?.message || error}`);
                sipActiveSession = null;
                console.error(error);
            }
        }

        async function sipHangup() {
            try {
                if (!sipActiveSession) {
                    setSipStatus('No active call');
                    return;
                }

                const session = sipActiveSession;
                if (
                    session.state === sipModule.SessionState.Initial ||
                    session.state === sipModule.SessionState.Establishing
                ) {
                    await session.cancel();
                } else if (session.state === sipModule.SessionState.Established) {
                    await session.bye();
                }

                stopSipRingtone();
                cleanupSipRemoteAudio();
                disposeSipSession(session);
                sipActiveSession = null;
                setSipStatus('Call ended');
            } catch (error) {
                setSipStatus(`Hang up failed: ${error?.message || error}`);
                console.error(error);
            }
        }

        async function sipAcceptIncoming() {
            try {
                if (!sipPendingInvitation) {
                    setSipStatus('No incoming call');
                    return;
                }

                sipActiveSession = sipPendingInvitation;
                sipPendingInvitation = null;
                toggleSipIncomingActions(false);
                stopSipRingtone();

                cleanupSipRemoteAudio();
                bindSipSessionState(sipActiveSession);
                bindSipSessionDelegate(sipActiveSession);

                await sipActiveSession.accept({
                    sessionDescriptionHandlerOptions: {
                        constraints: { audio: true, video: false },
                    },
                });
            } catch (error) {
                setSipStatus(`Accept failed: ${error?.message || error}`);
                sipActiveSession = null;
                console.error(error);
            }
        }

        async function sipRejectIncoming() {
            try {
                if (!sipPendingInvitation) {
                    setSipStatus('No incoming call');
                    return;
                }
                await sipPendingInvitation.reject();
                sipPendingInvitation = null;
                toggleSipIncomingActions(false);
                stopSipRingtone();
                setSipStatus('Incoming call rejected');
            } catch (error) {
                setSipStatus(`Reject failed: ${error?.message || error}`);
                console.error(error);
            }
        }

        initSipDefaults();
        setSipStatus('Idle');
        toggleSipIncomingActions(false);

        tabSipPhoneBtn.onclick = (e) => {
            initSipDefaults();
            openSipTab(e);
        };
        if (sipUsername && sipAuthUsername) {
            sipUsername.addEventListener('input', () => {
                if (!sipAuthUsername.value) sipAuthUsername.value = sipUsername.value;
            });
        }
        sipGenerateUserBtn.onclick = () => {
            const generated = randomSipUsername();
            sipUsername.value = generated;
            if (sipAuthUsername) sipAuthUsername.value = generated;
            setSipStatus('Generated random SIP username');
        };
        sipCopyUserBtn.onclick = async () => {
            try {
                if (!sipUsername?.value) return;
                await navigator.clipboard.writeText(sipUsername.value);
                onUsernameCopied();
            } catch (error) {
                setSipStatus('Copy failed: clipboard permission denied');
                console.error(error);
            }
        };
        sipRegisterBtn.onclick = sipRegister;
        sipUnregisterBtn.onclick = sipUnregister;
        sipCallBtn.onclick = sipCall;
        sipHangupBtn.onclick = sipHangup;
        sipAcceptBtn.onclick = sipAcceptIncoming;
        sipRejectBtn.onclick = sipRejectIncoming;
    }

    window.initSipPhoneMvp = initSipPhoneMvp;
})();
