'use strict';

const fetch = require('node-fetch');

const API_KEY = 'mirotalksfu_default_secret';
const MIROTALK_URL = 'http://localhost:3010/api/v1/join';

function getResponse() {
    return fetch(MIROTALK_URL, {
        method: 'POST',
        headers: {
            authorization: API_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            room: 'test',
            name: 'mirotalksfu',
            audio: true,
            video: true,
        }),
    });
}

getResponse().then(async (res) => {
    console.log('Status code:', res.status);
    const data = await res.json();
    console.log('join:', data.join);
});
