'use strict';

const liveavatarProvider = require('./providers/liveavatar');
const anamProvider = require('./providers/anam');

const PROVIDERS = {
    liveavatar: liveavatarProvider,
    anam: anamProvider,
};

const getErrorMessage = (error) =>
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    (typeof error?.response?.data === 'string' ? error.response.data : null) ||
    error?.message ||
    'Unknown error';

const createVideoAIService = (videoAIConfig, axiosClient, log) => {
    const resolveProvider = (requestedProvider) => {
        const selected = requestedProvider || videoAIConfig?.defaultProvider || 'liveavatar';
        return PROVIDERS[selected] ? selected : 'liveavatar';
    };

    const isProviderEnabled = (providerName) => {
        if (!videoAIConfig?.enabled) return false;
        const providerConfig = videoAIConfig?.[providerName];
        return !!(providerConfig?.enabled && providerConfig?.apiKey);
    };

    const getProviderConfig = (providerName) => videoAIConfig?.[providerName] || {};

    const ensureProviderEnabled = (providerName) => {
        if (!isProviderEnabled(providerName)) {
            const error = new Error('Video AI seems disabled, try later!');
            error.status = 403;
            throw error;
        }
    };

    const run = async (action, requestedProvider, ...args) => {
        const provider = resolveProvider(requestedProvider);
        ensureProviderEnabled(provider);
        try {
            const providerImpl = PROVIDERS[provider];
            const providerConfig = getProviderConfig(provider);
            const result = await providerImpl[action](providerConfig, axiosClient, ...args, videoAIConfig);
            return { provider, result };
        } catch (error) {
            log.error(`videoAI ${action}`, { provider, error: error?.response?.data || error.message });
            error.normalizedMessage = getErrorMessage(error);
            throw error;
        }
    };

    return {
        resolveProvider,
        isProviderEnabled,
        getProviderAvailability: () => ({
            liveavatar: isProviderEnabled('liveavatar'),
            anam: isProviderEnabled('anam'),
        }),
        getErrorMessage,
        async getAvatarList(requestedProvider) {
            const { provider, result } = await run('listAvatars', requestedProvider);
            return { provider, avatars: result };
        },
        async getVoiceList(requestedProvider) {
            const { provider, result } = await run('listVoices', requestedProvider);
            return { provider, voices: result };
        },
        async previewVoice(requestedProvider, voiceId) {
            const { provider, result } = await run('previewVoice', requestedProvider, voiceId);
            return { provider, audio: result };
        },
        async createSessionToken(requestedProvider, data) {
            const { provider, result } = await run('createSessionToken', requestedProvider, data);
            return { provider, response: result };
        },
        async startSession(requestedProvider, sessionToken) {
            const { provider, result } = await run('startSession', requestedProvider, sessionToken);
            return { provider, response: result };
        },
        async stopSession(requestedProvider, sessionId) {
            if (!sessionId) return { provider: resolveProvider(requestedProvider), response: { status: 'noop' } };
            const { provider, result } = await run('stopSession', requestedProvider, sessionId);
            return { provider, response: result };
        },
    };
};

module.exports = { createVideoAIService, getErrorMessage };
