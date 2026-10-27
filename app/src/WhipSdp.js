'use strict';

/**
 * WHIP (RFC 9725) SDP <-> mediasoup ORTC translation.
 *
 * Reuses the SDP helpers shipped with mediasoup-client (the same code the browser
 * uses to talk to mediasoup) so that the produced RTP parameters and the SDP answer
 * stay consistent with the rest of the SFU.
 */

const sdpTransform = require('sdp-transform');
const ortc = require('mediasoup-client/ortc');
const sdpCommonUtils = require('mediasoup-client/handlers/sdp/commonUtils');
const sdpUnifiedPlanUtils = require('mediasoup-client/handlers/sdp/unifiedPlanUtils');
const ortcUtils = require('mediasoup-client/handlers/ortc/utils');
const { RemoteSdp } = require('mediasoup-client/handlers/sdp/RemoteSdp');

const MAX_SDP_LENGTH = 64 * 1024;
const SUPPORTED_KINDS = ['audio', 'video'];
const SEND_DIRECTIONS = ['sendonly', 'sendrecv'];

class WhipSdpError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'WhipSdpError';
        this.status = status;
    }
}

const clone = (obj) => JSON.parse(JSON.stringify(obj));

// H264 profile-level-id "42xxyy" without constraint_set1 is plain Baseline (e.g. FFmpeg/x264 "42001f").
function isPlainBaselineH264(codec) {
    if (!codec || String(codec.mimeType).toLowerCase() !== 'video/h264') return false;
    const pli = String(codec.parameters?.['profile-level-id'] || '');
    if (!/^[0-9a-f]{6}$/i.test(pli)) return false;
    return pli.slice(0, 2).toLowerCase() === '42' && (parseInt(pli.slice(2, 4), 16) & 0x40) === 0;
}

// Encoders (x264, NVENC...) label Baseline streams that never use the Baseline-only tools
// (FMO/ASO/redundant slices), i.e. valid Constrained Baseline, the profile WebRTC routers expose.
function normalizeBaselineH264(offerRtpCapabilities, routerRtpCapabilities) {
    if ((routerRtpCapabilities.codecs || []).some(isPlainBaselineH264)) return;
    for (const codec of offerRtpCapabilities.codecs || []) {
        if (isPlainBaselineH264(codec)) {
            const level = codec.parameters['profile-level-id'].slice(4);
            codec.parameters['profile-level-id'] = `42e0${level}`;
        }
    }
}

// Offerer DTLS role, from its a=setup: 'actpass' and 'active' make it the DTLS client.
function resolveOffererDtlsRole(role) {
    return role === 'server' ? 'server' : 'client';
}

function getEncodings(offerMediaObject, codecs) {
    const sendRids = (offerMediaObject.rids || []).filter((rid) => rid.direction === 'send');
    if (offerMediaObject.simulcast && sendRids.length > 0) {
        return sendRids.map((rid) => ({ rid: String(rid.id) }));
    }
    if ((offerMediaObject.ssrcs || []).length > 0) {
        return sdpUnifiedPlanUtils.getRtpEncodings({ offerMediaObject, codecs });
    }
    // No a=ssrc lines: mediasoup binds the single stream through the MID header extension
    return [{}];
}

/**
 * Parse and validate a WHIP SDP offer and negotiate it against the router capabilities.
 *
 * @param {string} sdp - SDP offer received in the WHIP POST body.
 * @param {object} routerRtpCapabilities - mediasoup router.rtpCapabilities.
 * @returns {{ sdpObject, dtlsParameters, sections: Array<{ kind, mid, offerMediaObject, rtpParameters, answerRtpParameters }> }}
 */
function parseOffer(sdp, routerRtpCapabilities) {
    if (typeof sdp !== 'string' || !sdp.trim()) {
        throw new WhipSdpError('Missing SDP offer');
    }
    if (sdp.length > MAX_SDP_LENGTH) {
        throw new WhipSdpError('SDP offer too large', 413);
    }

    let sdpObject;
    try {
        sdpObject = sdpTransform.parse(sdp);
    } catch (error) {
        throw new WhipSdpError('Malformed SDP offer');
    }

    const media = sdpObject.media || [];
    if (media.length === 0) {
        throw new WhipSdpError('SDP offer has no media sections');
    }

    const seenKinds = new Set();
    const seenMids = new Set();
    for (const m of media) {
        if (!SUPPORTED_KINDS.includes(m.type)) {
            throw new WhipSdpError(`Unsupported media section "${m.type}", only audio and video are accepted`);
        }
        if (seenKinds.has(m.type)) {
            throw new WhipSdpError(`Only one ${m.type} media section is supported`);
        }
        seenKinds.add(m.type);
        if (m.port === 0) {
            throw new WhipSdpError(`Rejected ${m.type} media section (port 0) is not supported`);
        }
        if (m.direction && !SEND_DIRECTIONS.includes(m.direction)) {
            throw new WhipSdpError(`The ${m.type} media section must be sendonly`);
        }
        if (m.mid === undefined || m.mid === null || m.mid === '') {
            throw new WhipSdpError('Every media section must have an a=mid (BUNDLE is required)');
        }
        const mid = String(m.mid);
        if (seenMids.has(mid)) {
            throw new WhipSdpError(`Duplicate a=mid "${mid}"`);
        }
        seenMids.add(mid);
    }

    let dtlsParameters;
    let extendedRtpCapabilities;
    try {
        dtlsParameters = sdpCommonUtils.extractDtlsParameters({ sdpObject });
        dtlsParameters.role = resolveOffererDtlsRole(dtlsParameters.role);

        const offerRtpCapabilities = sdpCommonUtils.extractRtpCapabilities({ sdpObject });
        ortc.validateAndNormalizeRtpCapabilities(offerRtpCapabilities);
        ortcUtils.addNackSupportForOpus(offerRtpCapabilities);

        const routerCaps = clone(routerRtpCapabilities);
        ortc.validateAndNormalizeRtpCapabilities(routerCaps);

        normalizeBaselineH264(offerRtpCapabilities, routerCaps);

        extendedRtpCapabilities = ortc.getExtendedRtpCapabilities(offerRtpCapabilities, routerCaps, false);
    } catch (error) {
        throw new WhipSdpError(`Invalid SDP offer: ${error.message}`);
    }

    const sections = media.map((offerMediaObject) => {
        const kind = offerMediaObject.type;
        const mid = String(offerMediaObject.mid);

        const rtpParameters = ortc.getSendingRtpParameters(kind, extendedRtpCapabilities);
        const answerRtpParameters = ortc.getSendingRemoteRtpParameters(kind, extendedRtpCapabilities);

        if (rtpParameters.codecs.length === 0) {
            throw new WhipSdpError(`No supported ${kind} codec in the SDP offer`, 406);
        }

        rtpParameters.codecs = ortc.reduceCodecs(rtpParameters.codecs);
        answerRtpParameters.codecs = ortc.reduceCodecs(answerRtpParameters.codecs);

        rtpParameters.mid = mid;
        rtpParameters.rtcp.cname = sdpCommonUtils.getCname({ offerMediaObject });

        try {
            rtpParameters.encodings = getEncodings(offerMediaObject, rtpParameters.codecs);
        } catch (error) {
            throw new WhipSdpError(`Invalid ${kind} encodings: ${error.message}`);
        }

        return { kind, mid, offerMediaObject, rtpParameters, answerRtpParameters };
    });

    return { sdpObject, dtlsParameters, sections };
}

// Echo the offerer's Opus preferences in the answer (no fmtp would mean mono / no FEC, RFC 7587).
function getCodecOptions(rtpParameters) {
    const codec = rtpParameters.codecs[0];
    if (!codec || codec.mimeType.toLowerCase() !== 'audio/opus') return undefined;
    const params = codec.parameters || {};
    return {
        opusStereo: Number(params.stereo) === 1 || Number(params['sprop-stereo']) === 1,
        opusFec: params.useinbandfec === undefined ? true : Number(params.useinbandfec) === 1,
        opusDtx: Number(params.usedtx) === 1,
        opusNack: true,
    };
}

/**
 * Build the SDP answer for a parsed offer, using the mediasoup WebRtcTransport parameters.
 * NOTE: Must run before produce(): it completes the codec parameters of each section's rtpParameters.
 */
function buildAnswer({ offer, iceParameters, iceCandidates, dtlsParameters }) {
    // Every WebRTC stack supports sha-256 (RFC 8122) while some WHIP clients only verify that one.
    const sha256 = (dtlsParameters.fingerprints || []).find((f) => f.algorithm === 'sha-256');
    const answerDtlsParameters = {
        role: 'auto',
        fingerprints: sha256 ? [sha256] : dtlsParameters.fingerprints,
    };

    const remoteSdp = new RemoteSdp({
        iceParameters,
        iceCandidates,
        dtlsParameters: answerDtlsParameters,
    });

    remoteSdp.updateDtlsRole(offer.dtlsParameters.role === 'client' ? 'server' : 'client');

    if (offer.sdpObject.extmapAllowMixed) {
        remoteSdp.setSessionExtmapAllowMixed();
    }

    for (const section of offer.sections) {
        const { reuseMid } = remoteSdp.getNextMediaSectionIdx();
        remoteSdp.send({
            offerMediaObject: section.offerMediaObject,
            reuseMid,
            offerRtpParameters: section.rtpParameters,
            answerRtpParameters: section.answerRtpParameters,
            codecOptions: getCodecOptions(section.rtpParameters),
        });
    }

    return remoteSdp.getSdp();
}

module.exports = { parseOffer, buildAnswer, WhipSdpError, MAX_SDP_LENGTH };
