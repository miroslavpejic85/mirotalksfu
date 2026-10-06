'use strict';

import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/lib/index.min.js';

const statusEl = document.getElementById('status');
const remoteAudio = document.getElementById('remoteAudio');

const wsServerEl = document.getElementById('wsServer');
const domainEl = document.getElementById('domain');
const usernameEl = document.getElementById('username');
const authUsernameEl = document.getElementById('authUsername');
const passwordEl = document.getElementById('password');
const hackIpInContactEl = document.getElementById('hackIpInContact');
const displayNameEl = document.getElementById('displayName');
const outboundProxyEl = document.getElementById('outboundProxy');
const registerExpiresEl = document.getElementById('registerExpires');
const registerBtn = document.getElementById('registerBtn');
const unregisterBtn = document.getElementById('unregisterBtn');
const callBtn = document.getElementById('callBtn');
const hangupBtn = document.getElementById('hangupBtn');
const targetEl = document.getElementById('target');
const targetDomainEl = document.getElementById('targetDomain');
const incomingActionsEl = document.getElementById('incomingActions');
const acceptBtn = document.getElementById('acceptBtn');
const rejectBtn = document.getElementById('rejectBtn');

let userAgent;
let registerer;
let activeSession;
let pendingInvitation;
let ringtoneAudioContext;
let ringtoneInterval = null;

function setStatus(message) {
    statusEl.textContent = message;
    console.log(message);
}

function showIncomingActions(show) {
    incomingActionsEl.style.display = show ? 'flex' : 'none';
}

function stopRingtone() {
    if (ringtoneInterval) {
        clearInterval(ringtoneInterval);
        ringtoneInterval = null;
    }
    if (ringtoneAudioContext && ringtoneAudioContext.state !== 'closed') {
        ringtoneAudioContext.close().catch(() => {});
    }
    ringtoneAudioContext = null;
}

function playRingtonePulse() {
    if (!ringtoneAudioContext || ringtoneAudioContext.state === 'closed') return;
    const now = ringtoneAudioContext.currentTime;
    const burstTimes = [0, 0.42];

    burstTimes.forEach((offset) => {
        const gain = ringtoneAudioContext.createGain();
        gain.gain.value = 0;
        gain.connect(ringtoneAudioContext.destination);

        const oscA = ringtoneAudioContext.createOscillator();
        oscA.type = 'sine';
        oscA.frequency.value = 440;
        oscA.connect(gain);

        const oscB = ringtoneAudioContext.createOscillator();
        oscB.type = 'sine';
        oscB.frequency.value = 480;
        oscB.connect(gain);

        const startAt = now + offset;
        const stopAt = startAt + 0.22;
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.09, startAt + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

        oscA.start(startAt);
        oscB.start(startAt + 0.01);
        oscA.stop(stopAt);
        oscB.stop(stopAt);
    });
}

function startRingtone() {
    if (ringtoneInterval) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        ringtoneAudioContext = new AudioCtx();
        ringtoneAudioContext.resume().catch(() => {});
        playRingtonePulse();
        ringtoneInterval = setInterval(playRingtonePulse, 3200);
    } catch (error) {
        console.warn('Unable to start ringtone:', error);
    }
}

function buildUri(user, domain) {
    return SIP.UserAgent.makeURI(`sip:${user}@${domain}`);
}

function normalizeRouteSet(routeValue) {
    const value = String(routeValue || '').trim();
    if (!value) return null;
    if (/^<\s*sips?:/i.test(value)) return value;
    if (/^sips?:/i.test(value)) return `<${value}>`;
    return `<sip:${value}>`;
}

function attachRemoteAudio(session) {
    const pc = session.sessionDescriptionHandler?.peerConnection;
    if (!pc) return;
    const remoteStream = new MediaStream();

    pc.getReceivers().forEach((receiver) => {
        if (receiver.track) remoteStream.addTrack(receiver.track);
    });

    pc.ontrack = (event) => {
        event.streams[0].getTracks().forEach((track) => remoteStream.addTrack(track));
        remoteAudio.srcObject = remoteStream;
    };

    remoteAudio.srcObject = remoteStream;
}

function cleanupRemoteAudio() {
    const current = remoteAudio.srcObject;
    if (current && typeof current.getTracks === 'function') {
        current.getTracks().forEach((track) => track.stop());
    }
    remoteAudio.srcObject = null;
}

function disposeSession(session) {
    if (!session) return;
    try {
        const pc = session.sessionDescriptionHandler?.peerConnection;
        if (pc && pc.signalingState !== 'closed') {
            pc.close();
        }
    } catch (error) {
        console.warn('PeerConnection close warning:', error);
    }

    if (typeof session.dispose === 'function') {
        try {
            session.dispose();
        } catch (error) {
            console.warn('Session dispose warning:', error);
        }
    }
}

function bindSessionStateHandlers(session) {
    session.stateChange.addListener((state) => {
        setStatus(`Call state: ${state}`);
        if (state === SIP.SessionState.Established) {
            attachRemoteAudio(session);
        }
        if (state === SIP.SessionState.Terminated) {
            stopRingtone();
            cleanupRemoteAudio();
            disposeSession(session);
            if (activeSession === session) activeSession = null;
        }
    });
}

function bindSessionDelegate(session, extraDelegate = {}) {
    const previous = session.delegate || {};

    session.delegate = {
        ...previous,
        ...extraDelegate,
        onBye: async (bye) => {
            try {
                await bye.accept();
            } catch (error) {
                console.warn('BYE accept warning:', error);
            }

            setStatus('Call ended by remote party');
            stopRingtone();

            if (typeof previous.onBye === 'function') {
                try {
                    previous.onBye(bye);
                } catch (error) {
                    console.warn('Previous onBye delegate warning:', error);
                }
            }
        },
    };
}

async function register() {
    try {
        if (userAgent) {
            setStatus('Already registered or registering');
            return;
        }

        const wsServer = wsServerEl.value.trim();
        const domain = domainEl.value.trim();
        const username = usernameEl.value.trim();
        const authUsername = authUsernameEl.value.trim() || username;
        const password = passwordEl.value;
        const hackIpInContact = !!hackIpInContactEl?.checked;
        const displayName = displayNameEl?.value?.trim() || undefined;
        const outboundProxy = normalizeRouteSet(outboundProxyEl?.value);
        const registerExpires = Math.max(60, parseInt(registerExpiresEl?.value || '600', 10) || 600);

        if (!wsServer || !domain || !username) {
            setStatus('Missing wsServer/domain/username');
            return;
        }

        const uri = buildUri(username, domain);
        if (!uri) {
            setStatus('Invalid SIP URI');
            return;
        }

        userAgent = new SIP.UserAgent({
            uri,
            hackIpInContact,
            contactName: username,
            ...(displayName ? { displayName } : {}),
            ...(outboundProxy ? { routeSet: [outboundProxy] } : {}),
            transportOptions: {
                server: wsServer,
            },
            authorizationUsername: authUsername,
            authorizationPassword: password,
            delegate: {
                onInvite: (invitation) => {
                    pendingInvitation = invitation;
                    setStatus(`Incoming call from ${invitation.remoteIdentity.uri.user}. Click "Accept incoming".`);
                    showIncomingActions(true);
                    startRingtone();
                },
            },
        });

        await userAgent.start();

        registerer = new SIP.Registerer(userAgent, { expires: registerExpires });
        await registerer.register();

        setStatus(
            `Registered as sip:${username}@${domain}${outboundProxy ? ' via outbound proxy' : ''} (exp ${registerExpires}s)`
        );
    } catch (error) {
        const message = error?.message || String(error);
        if (message.includes('WebSocket closed') && wsServerEl.value.includes('localhost')) {
            setStatus(`Register failed: ${message}. Try ws://127.0.0.1:5066 (localhost cookies can break handshake).`);
        } else {
            setStatus(`Register failed: ${message}`);
        }
        console.error(error);
    }
}

async function unregister() {
    try {
        stopRingtone();
        if (pendingInvitation) {
            await pendingInvitation.reject();
            pendingInvitation = null;
        }
        showIncomingActions(false);
        if (activeSession) {
            await hangup();
        }
        if (registerer) {
            await registerer.unregister();
            registerer = null;
        }
        if (userAgent) {
            await userAgent.stop();
            userAgent = null;
        }
        setStatus('Unregistered');
    } catch (error) {
        setStatus(`Unregister failed: ${error?.message || error}`);
        console.error(error);
    }
}

async function call() {
    try {
        if (!userAgent) {
            setStatus('Register first');
            return;
        }
        if (activeSession) {
            setStatus('A call is already active');
            return;
        }

        const target = targetEl.value.trim();
        const targetDomain = targetDomainEl.value.trim();
        const targetUri = buildUri(target, targetDomain);

        if (!targetUri) {
            setStatus('Invalid target URI');
            return;
        }

        const inviter = new SIP.Inviter(userAgent, targetUri, {
            sessionDescriptionHandlerOptions: {
                constraints: { audio: true, video: false },
            },
        });

        cleanupRemoteAudio();
        bindSessionStateHandlers(inviter);
        bindSessionDelegate(inviter, {
            onReject: (response) => {
                setStatus(`Call rejected: ${response?.message?.statusCode || 'unknown'}`);
            },
            onProgress: (response) => {
                setStatus(`Call progress: ${response?.message?.statusCode || 'ringing'}`);
            },
        });

        activeSession = inviter;
        await inviter.invite();
    } catch (error) {
        setStatus(`Call failed: ${error?.message || error}`);
        activeSession = null;
        console.error(error);
    }
}

async function hangup() {
    try {
        if (!activeSession) {
            setStatus('No active call');
            return;
        }

        const session = activeSession;

        if (session.state === SIP.SessionState.Initial || session.state === SIP.SessionState.Establishing) {
            await session.cancel();
        } else if (session.state === SIP.SessionState.Established) {
            await session.bye();
        }

        stopRingtone();
        cleanupRemoteAudio();
        disposeSession(session);
        activeSession = null;
        setStatus('Call ended');
    } catch (error) {
        setStatus(`Hang up failed: ${error?.message || error}`);
        console.error(error);
    }
}

async function acceptIncoming() {
    try {
        if (!pendingInvitation) {
            setStatus('No incoming call to accept');
            return;
        }
        activeSession = pendingInvitation;
        pendingInvitation = null;
        showIncomingActions(false);
        stopRingtone();

        cleanupRemoteAudio();
        bindSessionStateHandlers(activeSession);
        bindSessionDelegate(activeSession);

        await activeSession.accept({
            sessionDescriptionHandlerOptions: {
                constraints: { audio: true, video: false },
            },
        });
    } catch (error) {
        setStatus(`Accept failed: ${error?.message || error}`);
        console.error(error);
        activeSession = null;
    }
}

async function rejectIncoming() {
    try {
        if (!pendingInvitation) {
            setStatus('No incoming call to reject');
            return;
        }
        await pendingInvitation.reject();
        pendingInvitation = null;
        showIncomingActions(false);
        stopRingtone();
        setStatus('Incoming call rejected');
    } catch (error) {
        setStatus(`Reject failed: ${error?.message || error}`);
        console.error(error);
    }
}

registerBtn.addEventListener('click', register);
unregisterBtn.addEventListener('click', unregister);
callBtn.addEventListener('click', call);
hangupBtn.addEventListener('click', hangup);
acceptBtn.addEventListener('click', acceptIncoming);
rejectBtn.addEventListener('click', rejectIncoming);
usernameEl.addEventListener('input', () => {
    if (!authUsernameEl.value) authUsernameEl.value = usernameEl.value;
});
