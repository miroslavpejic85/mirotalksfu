'use strict';

const getHeaders = (providerConfig) => ({
    'Content-Type': 'application/json',
    'X-API-KEY': providerConfig.apiKey,
});

const listAvatars = async (providerConfig, axiosClient) => {
    const [publicRes, privateRes] = await Promise.allSettled([
        axiosClient.get(`${providerConfig.basePath}/v1/avatars/public?page_size=100`, {
            headers: getHeaders(providerConfig),
        }),
        axiosClient.get(`${providerConfig.basePath}/v1/avatars?page_size=100`, {
            headers: getHeaders(providerConfig),
        }),
    ]);

    const publicAvatars = publicRes.status === 'fulfilled' ? publicRes.value.data?.data?.results || [] : [];
    const privateAvatars = privateRes.status === 'fulfilled' ? privateRes.value.data?.data?.results || [] : [];

    return [...publicAvatars, ...privateAvatars].map((avatar) => ({
        avatar_id: avatar.id,
        avatar_name: avatar.name,
        preview_image_url: avatar.preview_url,
        preview_video_url: null,
        avatar_model: null,
        is_paid: false,
    }));
};

const listVoices = async (providerConfig, axiosClient) => {
    const response = await axiosClient.get(`${providerConfig.basePath}/v1/voices?page_size=100`, {
        headers: getHeaders(providerConfig),
    });

    return (response.data?.data?.results || []).map((voice) => ({
        voice_id: voice.id,
        name: voice.name,
        language: voice.language,
        gender: voice.gender,
        sample_url: null,
        is_paid: false,
    }));
};

const previewVoice = async (providerConfig, axiosClient, voiceId) => {
    const response = await axiosClient.get(
        `${providerConfig.basePath}/v1/voices/${encodeURIComponent(voiceId)}/preview`,
        {
            headers: getHeaders(providerConfig),
        }
    );

    const audioBase64 = response.data?.data?.audio_base64;
    if (!audioBase64) return null;
    return `data:audio/mpeg;base64,${audioBase64}`;
};

const createSessionToken = async (providerConfig, axiosClient, data) => {
    if (!data.voiceId) {
        const error = new Error('LiveAvatar requires a voice selection before starting a session.');
        error.status = 400;
        throw error;
    }

    const mode = providerConfig.mode || 'FULL';
    const contextId = providerConfig.contextId;
    const avatarPersona = {};
    if (data.voiceId) avatarPersona.voice_id = data.voiceId;
    if (contextId) avatarPersona.context_id = contextId;

    const body = {
        mode,
        avatar_id: data.avatarId,
        video_settings: { quality: data.quality || 'high' },
    };
    if (mode === 'FULL') body.avatar_persona = avatarPersona;

    const response = await axiosClient.post(`${providerConfig.basePath}/v1/sessions/token`, body, {
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'X-API-KEY': providerConfig.apiKey,
        },
    });

    return response.data;
};

const startSession = async (providerConfig, axiosClient, sessionToken) => {
    const response = await axiosClient.post(
        `${providerConfig.basePath}/v1/sessions/start`,
        {},
        {
            headers: {
                accept: 'application/json',
                Authorization: `Bearer ${sessionToken}`,
            },
        }
    );

    return response.data.data;
};

const stopSession = async (providerConfig, axiosClient, sessionId) => {
    const response = await axiosClient.post(
        `${providerConfig.basePath}/v1/sessions/stop`,
        { session_id: sessionId },
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
