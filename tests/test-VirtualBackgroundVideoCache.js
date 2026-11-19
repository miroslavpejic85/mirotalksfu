'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const express = require('express');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'Server.js'), 'utf8');

describe('Virtual background video caching', () => {
    let server;
    let baseUrl;

    before(async () => {
        const helper = serverSource.match(
            /const virtualBackgroundVideosDir =[\s\S]*?function isVirtualBackgroundVideoAsset\(filePath\) \{[\s\S]*?\n\}\n/
        );
        assert.ok(helper, 'cache helper exists in Server.js');
        assert.match(
            serverSource,
            /if \(isVirtualBackgroundVideoAsset\(filePath\)\) \{\s*res\.setHeader\('Cache-Control', virtualBackgroundVideoCacheControl\);/
        );
        const context = vm.createContext({ path, dir: { public: path.join(__dirname, '..', 'public') } });
        vm.runInContext(
            `${helper[0]}globalThis.helper = { isVirtualBackgroundVideoAsset, virtualBackgroundVideoCacheControl };`,
            context
        );
        const { isVirtualBackgroundVideoAsset, virtualBackgroundVideoCacheControl } = context.helper;

        const app = express();
        app.use(
            express.static(context.dir.public, {
                setHeaders: (res, filePath) => {
                    if (isVirtualBackgroundVideoAsset(filePath)) {
                        res.setHeader('Cache-Control', virtualBackgroundVideoCacheControl);
                    }
                },
            })
        );
        server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(() => new Promise((resolve) => server.close(resolve)));

    const head = async (url, headers = {}) => {
        const response = await fetch(baseUrl + url, { headers });
        await response.arrayBuffer();
        return response;
    };

    it('lets browsers keep preset videos and posters without revalidating', async () => {
        for (const url of [
            '/images/virtual-background/videos/cozy-fireplace.mp4',
            '/images/virtual-background/videos/cozy-fireplace.jpg',
        ]) {
            const response = await head(url);
            assert.equal(response.status, 200, url);
            assert.equal(response.headers.get('cache-control'), 'public, max-age=2592000, immutable', url);
        }
    });

    it('keeps the long cache on range requests used for video playback', async () => {
        const response = await head('/images/virtual-background/videos/cozy-fireplace.mp4', { Range: 'bytes=0-99' });
        assert.equal(response.status, 206);
        assert.equal(response.headers.get('content-length'), '100');
        assert.equal(response.headers.get('cache-control'), 'public, max-age=2592000, immutable');
    });

    it('leaves the manifest, docs and other static files on the default cache policy', async () => {
        for (const url of [
            '/images/virtual-background/default/manifest.json',
            '/images/virtual-background/default/background-1.jpg',
            '/images/virtual-background/videos/README.md',
        ]) {
            const response = await head(url);
            assert.equal(response.status, 200, url);
            assert.equal(response.headers.get('cache-control'), 'public, max-age=0', url);
        }
    });
});
