'use strict';

const getHeaders = (providerConfig) => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${providerConfig.apiKey}`,
});

const listAvatars = async (providerConfig, axiosClient) => {
    const response = await axiosClient.get(`${providerConfig.basePath}/v1/avatars?perPage=100`, {
        headers: getHeaders(providerConfig),
    });

    return (response.data?.data || []).map((avatar) => ({
        avatar_id: avatar.id,
        avatar_name: avatar.displayName || avatar.name || avatar.id,
        preview_image_url: avatar.landscapeImageUrl || avatar.imageUrl || '',
        preview_video_url: avatar.videoUrl || avatar.idleVideoUrl || null,
        avatar_model: avatar.defaultAvatarModel || providerConfig.avatarModel || 'cara-4',
        is_paid: false,
    }));
};

const listVoices = async (providerConfig, axiosClient) => {
    const response = await axiosClient.get(`${providerConfig.basePath}/v1/voices?perPage=100`, {
        headers: getHeaders(providerConfig),
    });

    return (response.data?.data || []).map((voice) => ({
        voice_id: voice.id,
        name: voice.displayName || voice.name || 'Unnamed',
        language: voice.country || '',
        gender: voice.gender || null,
        sample_url: voice.sampleUrl || voice.previewSampleUrl || null,
        is_paid: false,
    }));
};

const previewVoice = async (providerConfig, axiosClient, voiceId) => {
    const response = await axiosClient.get(`${providerConfig.basePath}/v1/voices?perPage=100`, {
        headers: getHeaders(providerConfig),
    });
    const voice = (response.data?.data || []).find((item) => item.id === voiceId);
    return voice?.sampleUrl || voice?.previewSampleUrl || null;
};

const createSessionToken = async (providerConfig, axiosClient, data, globalConfig) => {
    if (!data.voiceId || !providerConfig.llmId) {
        const error = new Error('Anam requires both voice and LLM configuration. Set voice and VIDEOAI_ANAM_LLM_ID.');
        error.status = 400;
        throw error;
    }

    const body = {
        personaConfig: {
            name: 'MiroTalk Avatar',
            avatarId: data.avatarId,
            avatarModel: data.avatarModel || providerConfig.avatarModel || 'cara-4',
            voiceId: data.voiceId,
            llmId: providerConfig.llmId,
            systemPrompt: providerConfig.systemLimit || globalConfig.systemLimit,
        },
    };

    if (globalConfig.sessionTimeLimit > 0) {
        body.personaConfig.maxSessionLengthSeconds = globalConfig.sessionTimeLimit;
    }

    const response = await axiosClient.post(`${providerConfig.basePath}/v1/auth/session-token`, body, {
        headers: getHeaders(providerConfig),
    });

    return {
        session_id: null,
        session_token: response.data?.sessionToken,
    };
};

const startSession = async (providerConfig, axiosClient, sessionToken) => ({ session_token: sessionToken });

const stopSession = async (providerConfig, axiosClient, sessionId) => {
    const response = await axiosClient.post(
        `${providerConfig.basePath}/v1/sessions/${encodeURIComponent(sessionId)}/stop`,
        {},
        { headers: getHeaders(providerConfig) }
    );
    return response.data;
};

module.exports = {
    listAvatars,
    listVoices,
    previewVoice,
    createSessionToken,
    startSession,
    stopSession,
};
