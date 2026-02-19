'use strict';

async function endMeeting() {
    try {
        // Use dynamic import with await
        const { default: fetch } = await import('node-fetch');

        const API_KEY_SECRET = 'mirotalksfu_default_secret';
        const MIROTALK_URL = 'https://sfu.mirotalk.com/api/v1/meeting';
        // const MIROTALK_URL = 'http://localhost:3010/api/v1/meeting';

        const ROOM = 'test'; // Room name to end

        const response = await fetch(`${MIROTALK_URL}/${ROOM}`, {
            method: 'DELETE',
            headers: {
                authorization: API_KEY_SECRET,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                // redirect: 'https://example.com/meeting-ended', // Optional: URL to redirect peers to (if empty, peers go to home page)
            }),
        });
        const data = await response.json();
        if (data.error) {
            console.log('Error:', data.error);
        } else {
            console.log('result:', data);
        }
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

endMeeting();
