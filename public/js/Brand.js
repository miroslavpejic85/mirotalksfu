'use strict';

const brandDataKey = 'brandData';
const brandData = window.sessionStorage.getItem(brandDataKey);

const title = document.getElementById('title');
const icon = document.getElementById('icon');
const appleTouchIcon = document.getElementById('appleTouchIcon');

const description = document.getElementById('description');
const keywords = document.getElementById('keywords');

const ogType = document.getElementById('ogType');
const ogSiteName = document.getElementById('ogSiteName');
const ogTitle = document.getElementById('ogTitle');
const ogDescription = document.getElementById('ogDescription');
const ogImage = document.getElementById('ogImage');
const ogUrl = document.getElementById('ogUrl');

const appTitle = document.getElementById('appTitle');
const appDescription = document.getElementById('appDescription');

const features = document.getElementById('features');
const teams = document.getElementById('teams');
const tryEasier = document.getElementById('tryEasier');
const poweredBy = document.getElementById('poweredBy');
const sponsors = document.getElementById('sponsors');
const advertisers = document.getElementById('advertisers');
const footer = document.getElementById('footer');
//...

// app/src/config.js - ui.brand
let BRAND = {
    app: {
        name: 'MiroTalk SFU',
        title: 'MiroTalk SFU<br />Free browser based Real-time video calls.<br />Simple, Secure, Fast.',
        description:
            'Start your next video call with a single click. No download, plug-in, or login is required. Just get straight to talking, messaging, and sharing your screen.',
    },
    site: {
        title: 'MiroTalk SFU, Free Video Calls, Messaging and Screen Sharing',
        icon: '../images/logo.svg',
        appleTouchIcon: '../images/logo.svg',
    },
    meta: {
        description:
            'MiroTalk SFU powered by WebRTC and mediasoup, Real-time Simple Secure Fast video calls, messaging and screen sharing capabilities in the browser.',
        keywords:
            'webrtc, miro, mediasoup, mediasoup-client, self hosted, voip, sip, real-time communications, chat, messaging, meet, webrtc stun, webrtc turn, webrtc p2p, webrtc sfu, video meeting, video chat, video conference, multi video chat, multi video conference, peer to peer, p2p, sfu, rtc, alternative to, zoom, microsoft teams, google meet, jitsi, meeting',
    },
    og: {
        type: 'app-webrtc',
        siteName: 'MiroTalk SFU',
        title: 'Click the link to make a call.',
        description: 'MiroTalk SFU calling provides real-time video calls, messaging and screen sharing.',
        image: 'https://sfu.mirotalk.com/images/mirotalksfu.png',
        url: 'https://sfu.mirotalk.com',
    },
    html: {
        features: true,
        teams: true,
        tryEasier: true,
        poweredBy: true,
        sponsors: true,
        advertisers: true,
        footer: true,
    },
    //...
};

async function initialize() {
    await getBrand();

    customizeSite();

    customizeMetaTags();

    customizeOpenGraph();

    customizeApp();

    checkBrand();
}

async function getBrand() {
    if (brandData) {
        setBrand(JSON.parse(brandData));
    } else {
        try {
            const response = await fetch('/brand', { timeout: 5000 });
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.json();
            const serverBrand = data.message;
            if (serverBrand) {
                setBrand(serverBrand);
                console.log('FETCH BRAND SETTINGS', {
                    serverBrand: serverBrand,
                    clientBrand: BRAND,
                });
                window.sessionStorage.setItem(brandDataKey, JSON.stringify(serverBrand));
            }
        } catch (error) {
            console.error('FETCH GET BRAND ERROR', error.message);
        }
    }
}

// BRAND configurations
function setBrand(data) {
    BRAND = data;
    console.log('Set Brand done');
}

// BRAND check
function checkBrand() {
    !BRAND.html.features && elementDisplay(features, false);
    !BRAND.html.teams && elementDisplay(teams, false);
    !BRAND.html.tryEasier && elementDisplay(tryEasier, false);
    !BRAND.html.poweredBy && elementDisplay(poweredBy, false);
    !BRAND.html.sponsors && elementDisplay(sponsors, false);
    !BRAND.html.advertisers && elementDisplay(advertisers, false);
    !BRAND.html.footer && elementDisplay(footer, false);
}

// ELEMENT display mode
function elementDisplay(element, display, mode = 'block') {
    if (!element) return;
    element.style.display = display ? mode : 'none';
}

// APP customize
function customizeApp() {
    if (appTitle) {
        appTitle.innerHTML = BRAND.app.title;
    }
    if (appDescription) {
        appDescription.textContent = BRAND.app.description;
    }
}

// SITE metadata
function customizeSite() {
    if (title) {
        title.textContent = BRAND.site.title;
    }
    if (icon) {
        icon.href = BRAND.site.icon;
    }
    if (appleTouchIcon) {
        appleTouchIcon.href = BRAND.site.appleTouchIcon;
    }
}

// SEO metadata
function customizeMetaTags() {
    if (description) {
        description.content = BRAND.meta.description;
    }
    if (keywords) {
        keywords.content = BRAND.meta.keywords;
    }
}

// SOCIAL MEDIA SHARING metadata
function customizeOpenGraph() {
    if (ogType) {
        ogType.content = BRAND.og.type;
    }
    if (ogSiteName) {
        ogSiteName.content = BRAND.og.siteName;
    }
    if (ogTitle) {
        ogTitle.content = BRAND.og.title;
    }
    if (ogDescription) {
        ogDescription.content = BRAND.og.description;
    }
    if (ogImage) {
        ogImage.content = BRAND.og.image;
    }
    if (ogUrl) {
        ogUrl.content = BRAND.og.url;
    }
}

await initialize();
