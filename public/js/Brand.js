'use strict';

const brandDataKey = 'brandData';
const brandData = window.sessionStorage.getItem(brandDataKey);

const title = document.getElementById('title');
const icon = document.getElementById('icon');
const appleTouchIcon = document.getElementById('appleTouchIcon');
const newRoomTitle = document.getElementById('newRoomTitle');
const newRoomDescription = document.getElementById('newRoomDescription');

const description = document.getElementById('description');
const keywords = document.getElementById('keywords');

const appTitle = document.getElementById('appTitle');
const appDescription = document.getElementById('appDescription');
const joinDescription = document.getElementById('joinDescription');
const joinRoomBtn = document.getElementById('joinRoomButton');
const joinLastLabel = document.getElementById('joinLastLabel');

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
        language: 'en',
        name: 'MiroTalk SFU',
        title: 'MiroTalk SFU<br />Free browser based Real-time video calls.<br />Simple, Secure, Fast.',
        description:
            'Start your next video call with a single click. No download, plug-in, or login is required. Just get straight to talking, messaging, and sharing your screen.',
        joinDescription: 'Pick a room name.<br />How about this one?',
        joinButtonLabel: 'JOIN ROOM',
        joinLastLabel: 'Your recent room:',
    },
    site: {
        title: 'MiroTalk SFU, Free Video Calls, Messaging and Screen Sharing',
        icon: '../images/logo.svg',
        appleTouchIcon: '../images/logo.svg',
        newRoomTitle: 'Pick name. <br />Share URL. <br />Start conference.',
        newRoomDescription:
            "Each room has its disposable URL. Just pick a room name and share your custom URL. It's that easy.",
    },
    meta: {
        description:
            'MiroTalk SFU powered by WebRTC and mediasoup, Real-time Simple Secure Fast video calls, messaging and screen sharing capabilities in the browser.',
        keywords:
            'webrtc, miro, mediasoup, mediasoup-client, self hosted, voip, sip, real-time communications, chat, messaging, meet, webrtc stun, webrtc turn, webrtc p2p, webrtc sfu, video meeting, video chat, video conference, multi video chat, multi video conference, peer to peer, p2p, sfu, rtc, alternative to, zoom, microsoft teams, google meet, jitsi, meeting',
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
    about: {
        imageUrl: '../images/mirotalk-logo.gif',
        title: '<strong>WebRTC SFU v1.8.02</strong>',
        html: `
            <button 
                id="support-button" 
                data-umami-event="Support button" 
                onclick="window.open('https://codecanyon.net/user/miroslavpejic85', '_blank')">
                <i class="fas fa-heart"></i> Support
            </button>
            <br /><br /><br />
            Author: 
            <a 
                id="linkedin-button" 
                data-umami-event="Linkedin button" 
                href="https://www.linkedin.com/in/miroslav-pejic-976a07101/" 
                target="_blank"> 
                Miroslav Pejic
            </a>
            <br /><br />
            Email: 
            <a 
                id="email-button" 
                data-umami-event="Email button" 
                href="mailto:miroslav.pejic.85@gmail.com?subject=MiroTalk SFU info"> 
                miroslav.pejic.85@gmail.com
            </a>
            <br /><br />
            <hr />
            <span>&copy; 2025 MiroTalk SFU, all rights reserved</span>
            <hr />
        `,
    },
    //...
};

async function initialize() {
    await getBrand();

    customizeSite();

    customizeMetaTags();

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
    if (appTitle && BRAND.app?.title) {
        appTitle.innerHTML = BRAND.app?.title;
    }
    if (appDescription && BRAND.app?.description) {
        appDescription.textContent = BRAND.app.description;
    }
    if (joinDescription && BRAND.app?.joinDescription) {
        joinDescription.innerHTML = BRAND.app.joinDescription;
    }
    if (joinRoomBtn && BRAND.app?.joinButtonLabel) {
        joinRoomBtn.innerText = BRAND.app.joinButtonLabel;
    }
    if (joinLastLabel && BRAND.app?.joinLastLabel) {
        joinLastLabel.innerText = BRAND.app.joinLastLabel;
    }
}

// SITE metadata
function customizeSite() {
    if (title && BRAND.site?.title) {
        title.textContent = BRAND.site?.title;
    }
    if (icon && BRAND.site?.icon) {
        icon.href = BRAND.site?.icon;
    }
    if (appleTouchIcon && BRAND.site?.appleTouchIcon) {
        appleTouchIcon.href = BRAND.site.appleTouchIcon;
    }
    if (newRoomTitle && BRAND.site?.newRoomTitle) {
        newRoomTitle.innerHTML = BRAND.site?.newRoomTitle;
    }
    if (newRoomDescription && BRAND.site?.newRoomDescription) {
        newRoomDescription.textContent = BRAND.site.newRoomDescription;
    }
}

// SEO metadata
function customizeMetaTags() {
    if (description && BRAND.meta?.description) {
        description.content = BRAND.meta.description;
    }
    if (keywords && BRAND.meta?.keywords) {
        keywords.content = BRAND.meta.keywords;
    }
}

initialize();
