'use strict';

const path = require('path');
const express = require('express');

const app = express();
const PORT = Number(process.env.PORT || 8088);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_, res) => {
    res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`SIP web client listening on http://0.0.0.0:${PORT}`);
});
