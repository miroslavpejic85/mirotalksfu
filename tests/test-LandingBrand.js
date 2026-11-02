'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const landingHtml = fs.readFileSync(path.join(__dirname, '../public/views/landing.html'), 'utf8');
const brandScript = fs.readFileSync(path.join(__dirname, '../public/js/Brand.js'), 'utf8');

describe('Landing brand visibility', () => {
    for (const source of ['server', 'cache']) {
        for (const landingAbout of [true, false]) {
            for (const faq of [true, false]) {
                it(`${source}: About=${landingAbout}, FAQ=${faq}`, async () => {
                    const dom = new JSDOM(landingHtml, {
                        url: 'https://example.com',
                        runScripts: 'outside-only',
                    });
                    try {
                        const brand = { html: { landingAbout, faq } };
                        if (source === 'cache') {
                            dom.window.sessionStorage.setItem('brandData', JSON.stringify(brand));
                        }
                        dom.window.fetch = async () => ({ ok: true, json: async () => ({ message: brand }) });
                        dom.window.console.log = () => {};
                        const ready = new Promise((resolve) =>
                            dom.window.document.addEventListener('brand:ready', resolve, { once: true })
                        );
                        dom.window.eval(brandScript);
                        await ready;

                        for (const [id, visible] of [
                            ['about', landingAbout],
                            ['navAboutLink', landingAbout],
                            ['faq', faq],
                            ['navFaqLink', faq],
                        ]) {
                            assert.equal(dom.window.document.getElementById(id).style.display, visible ? '' : 'none');
                        }
                        assert.equal(dom.window.document.getElementById('features').style.display, '');
                    } finally {
                        dom.window.close();
                    }
                });
            }
        }
    }

    it('keeps the new sections visible with older cached branding settings', async () => {
        const dom = new JSDOM(landingHtml, { url: 'https://example.com', runScripts: 'outside-only' });
        try {
            dom.window.sessionStorage.setItem('brandData', JSON.stringify({ html: { features: false } }));
            dom.window.console.log = () => {};
            const ready = new Promise((resolve) =>
                dom.window.document.addEventListener('brand:ready', resolve, { once: true })
            );
            dom.window.eval(brandScript);
            await ready;
            for (const id of ['about', 'faq', 'navAboutLink', 'navFaqLink']) {
                assert.equal(dom.window.document.getElementById(id).style.display, '');
            }
            assert.equal(dom.window.document.getElementById('features').style.display, 'none');
        } finally {
            dom.window.close();
        }
    });
});
