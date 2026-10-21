/*
 * SIP phone module
 * Exposes window.initSipPhoneMvp(config) and window.SipPhoneUtils (pure helpers).
 */
(function () {
    'use strict';

    const SETTINGS_STORAGE_KEY = 'MIROTALK_SIP_SETTINGS';
    const ACCOUNT_STORAGE_KEY = 'MIROTALK_SIP_ACCOUNT';
    const RECENT_STORAGE_KEY = 'MIROTALK_SIP_RECENT';
    const MAX_RECENT_TARGETS = 6;
    const LONG_PRESS_MS = 550;
    const DTMF_TONES = '0123456789*#';
    const DTMF_FREQUENCIES = {
        1: [697, 1209],
        2: [697, 1336],
        3: [697, 1477],
        4: [770, 1209],
        5: [770, 1336],
        6: [770, 1477],
        7: [852, 1209],
        8: [852, 1336],
        9: [852, 1477],
        '*': [941, 1209],
        0: [941, 1336],
        '#': [941, 1477],
    };

    // ####################################################
    // PURE HELPERS
    // ####################################################

    const PHONE_SEPARATORS = /[\s\-.()/]/g;
    const SIP_USER_CHARS = /^[A-Za-z0-9_.!~*'()&=+$,;?/-]+$/;
    const MIN_PHONE_DIGITS = 7;

    function escapeSipUser(user) {
        return String(user).replace(/#/g, '%23');
    }

    /**
     * Classify and normalize what the user typed into the dialer.
     * - "1001", "alice"                 -> extension on the SIP domain
     * - "+1 (555) 123-4567", "0039..."  -> phone number on the gateway (or SIP domain)
     * - "tel:+15551234567"              -> phone number
     * - "bob@example.com", "sip:bob@x"  -> SIP address as-is
     * @returns {{type: 'extension'|'phone'|'uri', user: string, uri: string}|null}
     */
    function parseSipTarget(rawValue, { domain = '', phoneDomain = '' } = {}) {
        let raw = String(rawValue || '').trim();
        if (!raw) return null;
        const sipDomain = String(domain || '').trim();
        const gateway = String(phoneDomain || '').trim() || sipDomain;

        const schemeMatch = raw.match(/^(sips?):(.*)$/i);
        if (schemeMatch) {
            const scheme = schemeMatch[1].toLowerCase();
            const body = schemeMatch[2].trim();
            if (!body || /\s/.test(body)) return null;
            if (body.includes('@')) {
                const user = body.slice(0, body.indexOf('@'));
                return { type: 'uri', user, uri: `${scheme}:${body}` };
            }
            if (!sipDomain) return null;
            return { type: 'uri', user: body, uri: `${scheme}:${escapeSipUser(body)}@${sipDomain}` };
        }

        if (/^tel:/i.test(raw)) raw = raw.slice(4).split(';')[0].trim();

        if (raw.includes('@')) {
            if (/\s/.test(raw)) return null;
            return { type: 'uri', user: raw.slice(0, raw.indexOf('@')), uri: `sip:${raw}` };
        }

        const compact = raw.replace(PHONE_SEPARATORS, '');
        if (/^\+?[0-9*#]+$/.test(compact) && /\d/.test(compact)) {
            const digits = compact.replace(/\D/g, '');
            const isPhone = compact.startsWith('+') || digits.length >= MIN_PHONE_DIGITS;
            const host = isPhone ? gateway : sipDomain;
            if (!host) return null;
            return {
                type: isPhone ? 'phone' : 'extension',
                user: compact,
                uri: `sip:${escapeSipUser(compact)}@${host}`,
            };
        }

        // Only dial characters but not a valid number (e.g. "12+34") is a typo, not a username.
        if (/^[0-9+*#\s\-.()/]+$/.test(raw)) return null;
        if (!SIP_USER_CHARS.test(raw) || !sipDomain) return null;
        return { type: 'extension', user: raw, uri: `sip:${raw}@${sipDomain}` };
    }

    function formatCallDuration(totalSeconds) {
        const seconds = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        const pad = (n) => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    function readStorage(storage, key, fallback) {
        try {
            const raw = storage?.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (error) {
            return fallback;
        }
    }

    function writeStorage(storage, key, value) {
        try {
            storage?.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn('[SIP] Unable to persist settings', error);
        }
    }

    function t(text, namespace = 'labels') {
        return window.i18n?.t ? window.i18n.t(text, namespace) : text;
    }

    // ####################################################
    // SIP PHONE
    // ####################################################

    function initSipPhoneMvp(config = {}) {
        const {
            elements = {},
            getPeerName = () => 'user',
            openSipTab = () => {},
            onUsernameCopied = () => {},
            onIncomingCall = () => {},
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
            sipPhoneGateway,
            sipRegisterExpires,
            sipStatus,
            sipStatusBar,
            sipCallTimer,
            sipRemoteAudio,
            sipAccountDetails,
            sipAccountSummary,
            sipGenerateUserBtn,
            sipCopyUserBtn,
            sipRegisterBtn,
            sipUnregisterBtn,
            sipTargetType,
            sipTargetPreview,
            sipBackspaceBtn,
            sipDialpad,
            sipCallBtn,
            sipMuteBtn,
            sipMuteLabel,
            sipHangupBtn,
            sipIncomingActions,
            sipIncomingFrom,
            sipAcceptBtn,
            sipRejectBtn,
            sipRecentCalls,
            sipRecentList,
        } = elements;

        if (!sipRegisterBtn || !tabSipPhoneBtn) return;

        const accountInputs = [
            sipWsServer,
            sipDomain,
            sipUsername,
            sipAuthUsername,
            sipPassword,
            sipHackIpInContact,
            sipDisplayName,
            sipOutboundProxy,
            sipRegisterExpires,
        ].filter(Boolean);

        let sipModule = null;
        let sipUserAgent = null;
        let sipRegisterer = null;
        let sipRegistering = false;
        let sipUnregistering = false;
        const terminatedSessions = new WeakSet();
        const sessionFailures = new WeakMap();
        let sipActiveSession = null;
        let sipActiveLabel = '';
        let sipPendingInvitation = null;
        let sipRingtoneContext = null;
        let sipRingtoneInterval = null;
        let sipKeyToneContext = null;
        let sipCallStartedAt = 0;
        let sipCallTimerInterval = null;
        let sipMuted = false;

        // ####################################################
        // DEFAULTS & PERSISTENCE
        // ####################################################

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

        // Server settings are shared across tabs; the identity is per-tab so two tabs never register the same user.
        function loadSavedSettings() {
            const settings = readStorage(window.localStorage, SETTINGS_STORAGE_KEY, {});
            const account = readStorage(window.sessionStorage, ACCOUNT_STORAGE_KEY, {});
            const assign = (input, value) => {
                if (input && typeof value === 'string' && value && !input.value) input.value = value;
            };
            assign(sipWsServer, settings.wsServer);
            assign(sipDomain, settings.domain);
            assign(sipDisplayName, settings.displayName);
            assign(sipOutboundProxy, settings.outboundProxy);
            assign(sipPhoneGateway, settings.phoneGateway);
            if (sipRegisterExpires && settings.registerExpires) sipRegisterExpires.value = settings.registerExpires;
            if (sipHackIpInContact && typeof settings.hackIpInContact === 'boolean') {
                sipHackIpInContact.checked = settings.hackIpInContact;
            }
            assign(sipUsername, account.username);
            assign(sipAuthUsername, account.authUsername);
        }

        function saveSettings() {
            writeStorage(window.localStorage, SETTINGS_STORAGE_KEY, {
                wsServer: sipWsServer?.value?.trim() || '',
                domain: sipDomain?.value?.trim() || '',
                displayName: sipDisplayName?.value?.trim() || '',
                outboundProxy: sipOutboundProxy?.value?.trim() || '',
                phoneGateway: sipPhoneGateway?.value?.trim() || '',
                registerExpires: sipRegisterExpires?.value || '600',
                hackIpInContact: !!sipHackIpInContact?.checked,
            });
            writeStorage(window.sessionStorage, ACCOUNT_STORAGE_KEY, {
                username: sipUsername?.value?.trim() || '',
                authUsername: sipAuthUsername?.value?.trim() || '',
            });
        }

        function initSipDefaults() {
            if (!sipWsServer || !sipDomain || !sipUsername) return;
            loadSavedSettings();
            const host = getSipDefaultHost();
            if (!sipWsServer.value) sipWsServer.value = `ws://${host}:5066`;
            if (!sipDomain.value) sipDomain.value = host;
            if (!sipUsername.value) sipUsername.value = randomSipUsername();
            if (sipAuthUsername && !sipAuthUsername.value) sipAuthUsername.value = sipUsername.value;
            if (sipRegisterExpires && !sipRegisterExpires.value) sipRegisterExpires.value = '600';
        }

        function getRecentTargets() {
            const list = readStorage(window.localStorage, RECENT_STORAGE_KEY, []);
            return Array.isArray(list)
                ? list.filter((item) => typeof item === 'string' && item).slice(0, MAX_RECENT_TARGETS)
                : [];
        }

        function addRecentTarget(target) {
            const value = String(target || '').trim();
            if (!value) return;
            const list = [value, ...getRecentTargets().filter((item) => item !== value)].slice(0, MAX_RECENT_TARGETS);
            writeStorage(window.localStorage, RECENT_STORAGE_KEY, list);
            renderRecentTargets();
        }

        function renderRecentTargets() {
            if (!sipRecentCalls || !sipRecentList) return;
            const list = getRecentTargets();
            sipRecentList.replaceChildren();
            list.forEach((target) => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'sip-recent-chip';
                chip.textContent = target;
                chip.title = target;
                chip.onclick = () => setTarget(target, true);
                sipRecentList.appendChild(chip);
            });
            sipRecentCalls.classList.toggle('hidden', list.length === 0);
        }

        // ####################################################
        // STATUS & UI STATE
        // ####################################################

        function setSipStatus(message, state) {
            if (sipStatus) sipStatus.textContent = message;
            if (sipStatusBar && state) sipStatusBar.dataset.state = state;
            console.log('[SIP]', message);
        }

        function isRegistered() {
            return !!sipModule && sipRegisterer?.state === sipModule.RegistererState.Registered;
        }

        function isEstablished(session) {
            return !!sipModule && session?.state === sipModule.SessionState.Established;
        }

        function getTargetContext() {
            return {
                domain: sipDomain?.value?.trim() || '',
                phoneDomain: sipPhoneGateway?.value?.trim() || '',
            };
        }

        function refreshTargetInfo() {
            const raw = sipTarget?.value || '';
            const parsed = parseSipTarget(raw, getTargetContext());
            if (sipBackspaceBtn) sipBackspaceBtn.classList.toggle('hidden', !raw);
            if (sipTargetType) {
                let label = '';
                if (parsed?.type === 'phone') label = t('Phone number');
                else if (parsed?.type === 'uri') label = t('SIP address');
                else if (parsed) label = t('Extension');
                sipTargetType.textContent = label;
                sipTargetType.dataset.type = parsed?.type || '';
                sipTargetType.classList.toggle('hidden', !parsed);
            }
            if (sipTargetPreview) sipTargetPreview.textContent = parsed ? parsed.uri : '';
            refreshUi();
        }

        function refreshUi() {
            const registered = isRegistered();
            const hasUserAgent = !!sipUserAgent;
            const inCall = !!sipActiveSession;
            const established = isEstablished(sipActiveSession);
            const hasTarget = !!parseSipTarget(sipTarget?.value, getTargetContext());

            sipRegisterBtn.classList.toggle('hidden', hasUserAgent);
            sipRegisterBtn.disabled = sipRegistering;
            sipUnregisterBtn?.classList.toggle('hidden', !hasUserAgent);
            accountInputs.forEach((input) => (input.disabled = hasUserAgent));
            if (sipGenerateUserBtn) sipGenerateUserBtn.disabled = hasUserAgent;

            if (sipCallBtn) {
                sipCallBtn.classList.toggle('hidden', inCall);
                sipCallBtn.disabled = !registered || !hasTarget;
            }
            sipHangupBtn?.classList.toggle('hidden', !inCall);
            sipMuteBtn?.classList.toggle('hidden', !established);
            sipDialpad?.classList.toggle('sip-dialpad-dtmf', established);

            if (sipAccountSummary) {
                const username = sipUsername?.value?.trim();
                const domain = sipDomain?.value?.trim();
                sipAccountSummary.textContent = registered && username && domain ? `sip:${username}@${domain}` : '';
            }
        }

        function setIncomingVisible(visible, from = '') {
            if (sipIncomingFrom) sipIncomingFrom.textContent = from;
            sipIncomingActions?.classList.toggle('hidden', !visible);
        }

        function startCallTimer() {
            stopCallTimer();
            sipCallStartedAt = Date.now();
            const update = () => {
                if (sipCallTimer) sipCallTimer.textContent = formatCallDuration((Date.now() - sipCallStartedAt) / 1000);
            };
            update();
            sipCallTimer?.classList.remove('hidden');
            sipCallTimerInterval = setInterval(update, 1000);
        }

        function stopCallTimer() {
            if (sipCallTimerInterval) clearInterval(sipCallTimerInterval);
            sipCallTimerInterval = null;
            sipCallTimer?.classList.add('hidden');
        }

        function setMuted(muted) {
            sipMuted = muted;
            const pc = sipActiveSession?.sessionDescriptionHandler?.peerConnection;
            pc?.getSenders().forEach((sender) => {
                if (sender.track && sender.track.kind === 'audio') sender.track.enabled = !muted;
            });
            if (sipMuteBtn) {
                sipMuteBtn.setAttribute('aria-pressed', String(muted));
                sipMuteBtn.classList.toggle('sip-btn-muted', muted);
                const icon = sipMuteBtn.querySelector('i');
                if (icon) icon.className = muted ? 'fa-solid fa-microphone-slash' : 'fa-solid fa-microphone';
            }
            if (sipMuteLabel) sipMuteLabel.textContent = muted ? t('Unmute', 'buttons') : t('Mute', 'buttons');
        }

        // ####################################################
        // TONES
        // ####################################################

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

        function playKeyTone(key) {
            const frequencies = DTMF_FREQUENCIES[key];
            if (!frequencies) return;
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                if (!sipKeyToneContext || sipKeyToneContext.state === 'closed') sipKeyToneContext = new AudioCtx();
                const ctx = sipKeyToneContext;
                ctx.resume().catch(() => {});
                const now = ctx.currentTime;
                const gain = ctx.createGain();
                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
                gain.connect(ctx.destination);
                frequencies.forEach((frequency) => {
                    const osc = ctx.createOscillator();
                    osc.type = 'sine';
                    osc.frequency.value = frequency;
                    osc.connect(gain);
                    osc.start(now);
                    osc.stop(now + 0.15);
                });
            } catch (error) {
                console.warn('[SIP] Key tone warning', error);
            }
        }

        // ####################################################
        // MEDIA & SESSION HELPERS
        // ####################################################

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
            sipRemoteAudio.play?.().catch(() => {});
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
                    Promise.resolve(session.dispose()).catch((error) =>
                        console.warn('[SIP] Session dispose warning', error)
                    );
                } catch (error) {
                    console.warn('[SIP] Session dispose warning', error);
                }
            }
        }

        function describeResponse(response) {
            const message = response?.message;
            if (!message) return 'unknown';
            return [message.statusCode, message.reasonPhrase].filter(Boolean).join(' ');
        }

        function describeIdentity(identity) {
            const displayName = identity?.displayName;
            const user = identity?.uri?.user || '';
            return displayName && displayName !== user ? `${displayName} (${user})` : user || 'unknown';
        }

        function idleState() {
            return isRegistered() ? 'registered' : 'idle';
        }

        function onSessionTerminated(session, message) {
            if (terminatedSessions.has(session)) return;
            terminatedSessions.add(session);
            stopSipRingtone();
            stopCallTimer();
            cleanupSipRemoteAudio();
            disposeSipSession(session);
            if (sipActiveSession === session) {
                sipActiveSession = null;
                sipActiveLabel = '';
                setMuted(false);
                if (message) setSipStatus(message, idleState());
            }
            refreshUi();
        }

        function bindSipSession(session) {
            let established = false;
            let endedByRemote = false;
            const previous = session.delegate || {};
            session.delegate = {
                ...previous,
                // SIP.js leaves accepting the BYE to the delegate when one is provided.
                onBye: (bye) => {
                    endedByRemote = true;
                    Promise.resolve(bye.accept()).catch((error) => console.warn('[SIP] BYE accept warning', error));
                },
            };
            session.stateChange.addListener((state) => {
                if (sipActiveSession !== session) return;
                if (state === sipModule.SessionState.Established) {
                    established = true;
                    attachSipRemoteAudio(session);
                    setMuted(false);
                    startCallTimer();
                    setSipStatus(`In call with ${sipActiveLabel}`, 'incall');
                    refreshUi();
                }
                if (state === sipModule.SessionState.Terminated) {
                    const failure = sessionFailures.get(session);
                    if (!established && failure) {
                        onSessionTerminated(session, null);
                        setSipStatus(failure, 'error');
                        return;
                    }
                    let message = 'Call ended';
                    if (established && endedByRemote) message = 'Call ended by remote party';
                    onSessionTerminated(session, message);
                }
            });
        }

        // SIP.js may terminate the session before or after the reject callback, so handle both orders.
        function reportSessionFailure(session, message) {
            sessionFailures.set(session, message);
            if (terminatedSessions.has(session) && !sipActiveSession) setSipStatus(message, 'error');
        }

        async function loadSipModule() {
            if (sipModule) return sipModule;
            setSipStatus('Loading SIP library...', 'busy');
            sipModule = await import('https://cdn.jsdelivr.net/npm/sip.js@0.21.2/lib/index.min.js');
            return sipModule;
        }

        // ####################################################
        // REGISTRATION
        // ####################################################

        async function teardownUserAgent() {
            const userAgent = sipUserAgent;
            sipUserAgent = null;
            sipRegisterer = null;
            if (userAgent) {
                try {
                    await userAgent.stop();
                } catch (error) {
                    console.warn('[SIP] UserAgent stop warning', error);
                }
            }
        }

        async function sipRegister() {
            if (sipUserAgent || sipRegistering) {
                setSipStatus('Already registered or registering');
                return;
            }
            sipRegistering = true;
            refreshUi();
            try {
                initSipDefaults();

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
                    setSipStatus('Missing WS server/domain/username', 'error');
                    return;
                }
                if (!/^wss?:\/\//i.test(wsServer)) {
                    setSipStatus('WS server must start with ws:// or wss://', 'error');
                    return;
                }

                await loadSipModule();

                const uri = sipModule.UserAgent.makeURI(`sip:${username}@${domain}`);
                if (!uri) {
                    setSipStatus('Invalid SIP URI', 'error');
                    return;
                }

                setSipStatus(`Connecting to ${wsServer}...`, 'busy');

                const userAgent = new sipModule.UserAgent({
                    uri,
                    hackIpInContact,
                    contactName: username,
                    ...(displayName ? { displayName } : {}),
                    ...(outboundProxy ? { routeSet: [outboundProxy] } : {}),
                    transportOptions: { server: wsServer },
                    authorizationUsername: authUsername,
                    authorizationPassword: password,
                    delegate: {
                        onInvite: handleIncomingInvitation,
                        onDisconnect: (error) => {
                            if (!error || sipUserAgent !== userAgent) return;
                            handleConnectionLost();
                        },
                    },
                });
                sipUserAgent = userAgent;

                await userAgent.start();

                const registerer = new sipModule.Registerer(userAgent, { expires: registerExpires });
                sipRegisterer = registerer;
                registerer.stateChange.addListener((state) => {
                    if (sipRegisterer !== registerer) return;
                    if (state === sipModule.RegistererState.Registered) {
                        setSipStatus(
                            `Registered as sip:${username}@${domain}${outboundProxy ? ' via outbound proxy' : ''}`,
                            'registered'
                        );
                        saveSettings();
                        if (sipAccountDetails) sipAccountDetails.open = false;
                    } else if (
                        state === sipModule.RegistererState.Unregistered &&
                        !sipUnregistering &&
                        !sipRegistering
                    ) {
                        setSipStatus('Registration lost, please register again', 'error');
                    }
                    refreshUi();
                });

                setSipStatus(`Registering sip:${username}@${domain}...`, 'busy');
                await registerer.register({
                    requestDelegate: {
                        onReject: (response) => {
                            if (sipRegisterer !== registerer) return;
                            setSipStatus(`Registration failed: ${describeResponse(response)}`, 'error');
                            teardownUserAgent().finally(refreshUi);
                        },
                    },
                });
            } catch (error) {
                setSipStatus(`Register failed: ${error?.message || error}`, 'error');
                console.error(error);
                await teardownUserAgent();
            } finally {
                sipRegistering = false;
                refreshUi();
            }
        }

        function handleConnectionLost() {
            stopSipRingtone();
            setIncomingVisible(false);
            sipPendingInvitation = null;
            if (sipActiveSession) onSessionTerminated(sipActiveSession, null);
            teardownUserAgent().finally(() => {
                if (sipAccountDetails) sipAccountDetails.open = true;
                setSipStatus('Disconnected from SIP server', 'error');
                refreshUi();
            });
        }

        async function sipUnregister() {
            sipUnregistering = true;
            try {
                stopSipRingtone();
                setIncomingVisible(false);
                if (sipPendingInvitation) {
                    const invitation = sipPendingInvitation;
                    sipPendingInvitation = null;
                    await invitation.reject().catch(() => {});
                }
                if (sipActiveSession) {
                    await sipHangup();
                }
                if (sipRegisterer) {
                    await sipRegisterer.unregister().catch((error) => console.warn('[SIP] Unregister warning', error));
                }
                await teardownUserAgent();
                if (sipAccountDetails) sipAccountDetails.open = true;
                setSipStatus('Unregistered', 'idle');
            } catch (error) {
                setSipStatus(`Unregister failed: ${error?.message || error}`, 'error');
                console.error(error);
            } finally {
                sipUnregistering = false;
                refreshUi();
            }
        }

        // ####################################################
        // CALLS
        // ####################################################

        async function sipCall() {
            try {
                if (!sipUserAgent || !isRegistered()) {
                    setSipStatus('Register first', 'error');
                    if (sipAccountDetails) sipAccountDetails.open = true;
                    return;
                }
                if (sipActiveSession) {
                    setSipStatus('A call is already active');
                    return;
                }

                const rawTarget = sipTarget?.value?.trim() || '';
                const parsed = parseSipTarget(rawTarget, getTargetContext());
                if (!parsed) {
                    setSipStatus(
                        rawTarget ? 'Invalid call target' : 'Enter an extension, phone number or SIP address',
                        'error'
                    );
                    sipTarget?.focus();
                    return;
                }

                const targetUri = sipModule.UserAgent.makeURI(parsed.uri);
                if (!targetUri) {
                    setSipStatus(`Invalid target SIP URI: ${parsed.uri}`, 'error');
                    return;
                }

                const inviter = new sipModule.Inviter(sipUserAgent, targetUri, {
                    sessionDescriptionHandlerOptions: {
                        constraints: { audio: true, video: false },
                    },
                });

                cleanupSipRemoteAudio();
                sipActiveSession = inviter;
                sipActiveLabel = parsed.type === 'uri' ? parsed.uri : parsed.user;
                bindSipSession(inviter);
                addRecentTarget(rawTarget);
                setSipStatus(`Calling ${sipActiveLabel}...`, 'busy');
                refreshUi();

                await inviter.invite({
                    requestDelegate: {
                        onProgress: (response) => {
                            const code = response?.message?.statusCode;
                            if (sipActiveSession === inviter && code >= 180) {
                                setSipStatus(`Ringing ${sipActiveLabel}...`, 'busy');
                            }
                        },
                        onReject: (response) => {
                            reportSessionFailure(inviter, `Call failed: ${describeResponse(response)}`);
                        },
                    },
                });
            } catch (error) {
                setSipStatus(`Call failed: ${error?.message || error}`, 'error');
                const session = sipActiveSession;
                sipActiveSession = null;
                if (session) disposeSipSession(session);
                refreshUi();
                console.error(error);
            }
        }

        async function sipHangup() {
            const session = sipActiveSession;
            if (!session) {
                setSipStatus('No active call');
                return;
            }
            try {
                const { SessionState } = sipModule;
                if (session.state === SessionState.Initial || session.state === SessionState.Establishing) {
                    if (typeof session.cancel === 'function') await session.cancel();
                    else await session.reject();
                } else if (session.state === SessionState.Established) {
                    await session.bye();
                }
            } catch (error) {
                console.warn('[SIP] Hang up warning', error);
            } finally {
                onSessionTerminated(session, null);
                setSipStatus('Call ended', idleState());
            }
        }

        function handleIncomingInvitation(invitation) {
            const from = describeIdentity(invitation.remoteIdentity);

            if (sipActiveSession || sipPendingInvitation) {
                invitation.reject({ statusCode: 486 }).catch(() => {});
                console.log('[SIP] Busy, rejected incoming call from', from);
                return;
            }

            sipPendingInvitation = invitation;
            invitation.stateChange.addListener((state) => {
                if (state !== sipModule.SessionState.Terminated || sipPendingInvitation !== invitation) return;
                sipPendingInvitation = null;
                setIncomingVisible(false);
                stopSipRingtone();
                setSipStatus(`Missed call from ${from}`, idleState());
            });

            setIncomingVisible(true, from);
            setSipStatus(`Incoming call from ${from}`, 'incoming');
            startSipRingtone();
            onIncomingCall(from);
        }

        async function sipAcceptIncoming() {
            const invitation = sipPendingInvitation;
            if (!invitation) {
                setSipStatus('No incoming call');
                return;
            }
            sipPendingInvitation = null;
            setIncomingVisible(false);
            stopSipRingtone();

            try {
                cleanupSipRemoteAudio();
                sipActiveSession = invitation;
                sipActiveLabel = describeIdentity(invitation.remoteIdentity);
                bindSipSession(invitation);
                setSipStatus(`Connecting to ${sipActiveLabel}...`, 'busy');
                refreshUi();

                await invitation.accept({
                    sessionDescriptionHandlerOptions: {
                        constraints: { audio: true, video: false },
                    },
                });
            } catch (error) {
                setSipStatus(`Accept failed: ${error?.message || error}`, 'error');
                if (sipActiveSession === invitation) onSessionTerminated(invitation, null);
                console.error(error);
            }
        }

        async function sipRejectIncoming() {
            const invitation = sipPendingInvitation;
            if (!invitation) {
                setSipStatus('No incoming call');
                return;
            }
            sipPendingInvitation = null;
            setIncomingVisible(false);
            stopSipRingtone();
            try {
                await invitation.reject();
                setSipStatus('Incoming call rejected', idleState());
            } catch (error) {
                setSipStatus(`Reject failed: ${error?.message || error}`, 'error');
                console.error(error);
            }
        }

        // ####################################################
        // DIALER
        // ####################################################

        function sendSipDtmf(tone) {
            const session = sipActiveSession;
            if (!isEstablished(session) || !DTMF_TONES.includes(tone)) return false;
            const sdh = session.sessionDescriptionHandler;
            try {
                if (sdh && typeof sdh.sendDtmf === 'function' && sdh.sendDtmf(tone)) return true;
            } catch (error) {
                console.warn('[SIP] RTP DTMF failed, falling back to SIP INFO', error);
            }
            session
                .info({
                    requestOptions: {
                        body: {
                            contentDisposition: 'render',
                            contentType: 'application/dtmf-relay',
                            content: `Signal=${tone}\r\nDuration=160`,
                        },
                    },
                })
                .catch((error) => console.warn('[SIP] DTMF INFO failed', error));
            return true;
        }

        function setTarget(value, focus = false) {
            if (!sipTarget) return;
            sipTarget.value = value;
            refreshTargetInfo();
            if (focus) {
                sipTarget.focus();
                sipTarget.setSelectionRange(value.length, value.length);
            }
        }

        function insertIntoTarget(text) {
            if (!sipTarget) return;
            const value = sipTarget.value;
            const isFocused = document.activeElement === sipTarget;
            const start = isFocused ? (sipTarget.selectionStart ?? value.length) : value.length;
            const end = isFocused ? (sipTarget.selectionEnd ?? value.length) : value.length;
            sipTarget.value = value.slice(0, start) + text + value.slice(end);
            const caret = start + text.length;
            if (isFocused) sipTarget.setSelectionRange(caret, caret);
            refreshTargetInfo();
        }

        function backspaceTarget() {
            if (!sipTarget || !sipTarget.value) return;
            const value = sipTarget.value;
            const isFocused = document.activeElement === sipTarget;
            let start = isFocused ? (sipTarget.selectionStart ?? value.length) : value.length;
            const end = isFocused ? (sipTarget.selectionEnd ?? value.length) : value.length;
            if (start === end) start = Math.max(0, start - 1);
            sipTarget.value = value.slice(0, start) + value.slice(end);
            if (isFocused) sipTarget.setSelectionRange(start, start);
            refreshTargetInfo();
        }

        function pressDialKey(key) {
            if (!key) return;
            if (isEstablished(sipActiveSession)) {
                if (sendSipDtmf(key)) playKeyTone(key);
                return;
            }
            playKeyTone(key);
            insertIntoTarget(key);
        }

        // Short press runs onPress, holding runs onLongPress (e.g. 0 -> +, backspace -> clear).
        function bindPressAndHold(button, onPress, onLongPress) {
            let timer = null;
            let longPressed = false;
            const clear = () => {
                if (timer) clearTimeout(timer);
                timer = null;
            };
            button.addEventListener('pointerdown', (event) => {
                if (event.button !== undefined && event.button !== 0) return;
                longPressed = false;
                clear();
                if (onLongPress) {
                    timer = setTimeout(() => {
                        timer = null;
                        longPressed = true;
                        onLongPress();
                    }, LONG_PRESS_MS);
                }
            });
            ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => button.addEventListener(type, clear));
            button.addEventListener('contextmenu', (event) => event.preventDefault());
            button.addEventListener('click', (event) => {
                event.preventDefault();
                if (longPressed) {
                    longPressed = false;
                    return;
                }
                onPress();
            });
        }

        function bindDialer() {
            sipDialpad?.querySelectorAll('.sip-key').forEach((button) => {
                button.type = 'button';
                const key = button.dataset.key;
                const longKey = button.dataset.longKey;
                bindPressAndHold(
                    button,
                    () => pressDialKey(key),
                    longKey
                        ? () => {
                              if (!isEstablished(sipActiveSession)) insertIntoTarget(longKey);
                          }
                        : null
                );
            });

            if (sipBackspaceBtn) {
                sipBackspaceBtn.type = 'button';
                bindPressAndHold(sipBackspaceBtn, backspaceTarget, () => setTarget('', true));
            }

            sipTarget?.addEventListener('input', refreshTargetInfo);
            sipTarget?.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (!sipActiveSession) sipCall();
            });

            // DTMF from the keyboard while in a call and focus is not in a text field.
            document.getElementById('tabSipPhone')?.addEventListener('keydown', (event) => {
                if (!isEstablished(sipActiveSession)) return;
                if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
                if (!DTMF_TONES.includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
                event.preventDefault();
                pressDialKey(event.key);
            });
        }

        // ####################################################
        // WIRING
        // ####################################################

        initSipDefaults();
        setSipStatus('Not registered', 'idle');
        setIncomingVisible(false);
        renderRecentTargets();
        refreshTargetInfo();
        bindDialer();

        tabSipPhoneBtn.onclick = (e) => {
            initSipDefaults();
            refreshTargetInfo();
            openSipTab(e);
        };
        if (sipUsername && sipAuthUsername) {
            let lastUsername = sipUsername.value;
            sipUsername.addEventListener('input', () => {
                if (!sipAuthUsername.value || sipAuthUsername.value === lastUsername) {
                    sipAuthUsername.value = sipUsername.value;
                }
                lastUsername = sipUsername.value;
            });
        }
        [sipDomain, sipPhoneGateway].forEach((input) => input?.addEventListener('input', refreshTargetInfo));
        [
            sipWsServer,
            sipDomain,
            sipDisplayName,
            sipOutboundProxy,
            sipPhoneGateway,
            sipRegisterExpires,
            sipHackIpInContact,
        ]
            .filter(Boolean)
            .forEach((input) => input.addEventListener('change', saveSettings));

        if (sipGenerateUserBtn) {
            sipGenerateUserBtn.onclick = () => {
                const generated = randomSipUsername();
                sipUsername.value = generated;
                if (sipAuthUsername) sipAuthUsername.value = generated;
                setSipStatus('Generated random SIP username');
            };
        }
        if (sipCopyUserBtn) {
            sipCopyUserBtn.onclick = async () => {
                try {
                    if (!sipUsername?.value) return;
                    await navigator.clipboard.writeText(sipUsername.value);
                    onUsernameCopied();
                } catch (error) {
                    setSipStatus('Copy failed: clipboard permission denied', 'error');
                    console.error(error);
                }
            };
        }
        sipRegisterBtn.onclick = sipRegister;
        if (sipUnregisterBtn) sipUnregisterBtn.onclick = sipUnregister;
        if (sipCallBtn) sipCallBtn.onclick = sipCall;
        if (sipHangupBtn) sipHangupBtn.onclick = sipHangup;
        if (sipMuteBtn) sipMuteBtn.onclick = () => setMuted(!sipMuted);
        if (sipAcceptBtn) sipAcceptBtn.onclick = sipAcceptIncoming;
        if (sipRejectBtn) sipRejectBtn.onclick = sipRejectIncoming;

        window.addEventListener('pagehide', () => {
            if (sipUserAgent) sipUnregister();
        });
    }

    if (typeof window !== 'undefined') {
        window.initSipPhoneMvp = initSipPhoneMvp;
        window.SipPhoneUtils = { parseSipTarget, formatCallDuration };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { parseSipTarget, formatCallDuration };
    }
})();
