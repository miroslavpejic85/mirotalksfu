'use strict';

const fetch = require('node-fetch');

const API_KEY = 'mirotalksfu_default_secret';
const MIROTALK_URL = 'https://sfu.mirotalk.org/api/v1/meeting';

function getResponse() {
    return fetch(MIROTALK_URL, {
        method: 'POST',
        headers: {
            authorization: API_KEY,
            'Content-Type': 'application/json',
        },
    });
}

getResponse().then(async (res) => {
    console.log('Status code:', res.status);
    const data = await res.json();
    console.log('meeting:', data.meeting);
});
