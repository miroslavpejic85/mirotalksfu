'use strict';

async function getJoin() {
    try {
        // Use dynamic import with await
        const { default: fetch } = await import('node-fetch');

        const API_KEY = 'mirotalksfu_default_secret';
        const MIROTALK_URL = 'https://sfu.mirotalk.com/api/v1/join';
        // const MIROTALK_URL = 'http://localhost:3010/api/v1/join';

        const response = await fetch(MIROTALK_URL, {
            method: 'POST',
            headers: {
                authorization: API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                room: 'test',
                password: false,
                name: 'mirotalksfu',
                audio: true,
                video: true,
                screen: true,
                notify: true,
            }),
        });
        const data = await response.json();
        if (data.error) {
            console.log('Error:', data.error);
        } else {
            console.log('join:', data.join);
        }
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

getJoin();
