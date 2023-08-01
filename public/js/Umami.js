'use strict';

// const url = 'https://localhost:3010/stats';
const url = 'https://sfu.mirotalk.com/stats';

fetch(url)
    .then((response) => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();
    })
    .then((data) => {
        // console.log('STATS', data);
        const { enabled, src, id } = data;
        if (enabled) {
            const script = document.createElement('script');
            script.setAttribute('async', '');
            script.setAttribute('src', src);
            script.setAttribute('data-website-id', id);
            document.head.appendChild(script);
        }
    })
    .catch((error) => {
        console.error('Stats fetch error:', error);
    });
