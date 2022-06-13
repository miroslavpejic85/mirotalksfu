'use strict';

const fetch = require('node-fetch');

const API_KEY = 'mirotalksfu_default_secret';
const MIROTALK_URL = 'https://sfu.mirotalk.com/api/v1/join';

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
            screen: true,
            notify: true,
        }),
    });
}

getResponse().then(async (res) => {
    console.log('Status code:', res.status);
    const data = await res.json();
    console.log('join:', data.join);
});
