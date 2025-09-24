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

const whoAreYouTitle = document.getElementById('whoAreYouTitle');
const whoAreYouDescription = document.getElementById('whoAreYouDescription');
const presenterLoginButton = document.getElementById('presenterLoginButton');
const guestJoinRoomButton = document.getElementById('guestJoinRoomButton');
//...

// app/src/config.js - ui.brand
let BRAND = {
    app: {
        language: 'ru',
        name: 'Kremlevka',
        title: 'Kremlevka<br />Бесплатные видеозвонки прямо в браузере.<br />Просто, безопасно, быстро.',
        description:
            'Начните видеозвонок в один клик. Не нужны загрузки, плагины или регистрация — сразу общайтесь, переписывайтесь и делитесь экраном.',
        joinDescription: 'Введите название комнаты.<br />Можно использовать предложенный вариант.',
        joinButtonLabel: 'ВОЙТИ В КОМНАТУ',
        joinLastLabel: 'Недавняя комната:',
    },
    site: {
        title: 'Kremlevka — видеозвонки, сообщения и демонстрация экрана',
        icon: '../images/logo.svg',
        appleTouchIcon: '../images/logo.svg',
        newRoomTitle: 'Придумайте название.<br />Поделитесь ссылкой.<br />Начните конференцию.',
        newRoomDescription:
            'Каждая комната получает уникальный URL. Просто придумайте название и поделитесь ссылкой — это легко.',
    },
    meta: {
        description:
            'Kremlevka — защищённые видеозвонки, обмен сообщениями и демонстрация экрана в браузере.',
        keywords:
            'webrtc, mirotalk, видеозвонки, конференция, демонстрация экрана, sfu, связь, браузер, кремлёвка',
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
    whoAreYou: {
        title: 'Кто вы?',
        description:
            'Если вы ведущий, авторизуйтесь сейчас.<br />Если вы гость, дождитесь подключения ведущего.',
        buttonLoginLabel: 'ВОЙТИ',
        buttonJoinLabel: 'ПРИСОЕДИНИТЬСЯ',
    },
    about: {
        imageUrl: '../images/mirotalk-logo.gif',
        title: '<strong>WebRTC SFU v1.9.45</strong>',
        html: `
            <button
                id="support-button"
                data-umami-event="Support button"
                onclick="window.open('https://codecanyon.net/user/miroslavpejic85', '_blank')">
                <i class="fas fa-heart"></i> Поддержать проект
            </button>
            <br /><br /><br />
            Автор:
            <a 
                id="linkedin-button" 
                data-umami-event="Linkedin button" 
                href="https://www.linkedin.com/in/miroslav-pejic-976a07101/" 
                target="_blank"> 
                Miroslav Pejic
            </a>
            <br /><br />
            Почта:
            <a 
                id="email-button" 
                data-umami-event="Email button" 
                href="mailto:miroslav.pejic.85@gmail.com?subject=Kremlevka info">
                miroslav.pejic.85@gmail.com
            </a>
            <br /><br />
            <hr />
            <span>&copy; 2025 Kremlevka, все права защищены</span>
            <hr />
        `,
    },
    widget: {
        enabled: false,
        roomId: 'support-room',
        theme: 'dark',
        widgetState: 'minimized',
        widgetType: 'support',
        supportWidget: {
            position: 'top-right',
            expertImages: [
                'https://photo.cloudron.pocketsolution.net/uploads/original/95/7d/a5f7f7a2c89a5fee7affda5f013c.jpeg',
            ],
            buttons: {
                audio: true,
                video: true,
                screen: true,
                chat: true,
                join: true,
            },
            checkOnlineStatus: false,
            isOnline: true,
            customMessages: {
                heading: 'Нужна помощь?',
                subheading: 'Получите поддержку от нашей команды за считанные секунды!',
                connectText: 'свяжемся < 5 секунд',
                onlineText: 'Мы онлайн',
                offlineText: 'Мы офлайн',
                poweredBy: 'Работает на Kremlevka',
            },
            alert: {
                enabled: false,
                type: 'email',
            },
        },
    },
    //...
};

async function initialize() {
    await getBrand();

    customizeSite();

    customizeMetaTags();

    customizeApp();

    customizeWidget();

    customizeWhoAreYou();

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
            } else {
                console.warn('FETCH BRAND SETTINGS - DISABLED');
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

// WIDGET customize
function customizeWidget() {
    if (BRAND.widget?.enabled) {
        const domain = window.location.host;
        const roomId = BRAND.widget?.roomId || 'support-room';
        const userName = 'guest-' + Math.floor(Math.random() * 10000);
        if (typeof MiroTalkWidget !== 'undefined') {
            new MiroTalkWidget(domain, roomId, userName, BRAND.widget);
        } else {
            console.warn('MiroTalkWidget is not defined in the current context. Please check Widget.js loading.', {
                domain,
                roomId,
                userName,
                widget: BRAND.widget,
            });
        }
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

function customizeWhoAreYou() {
    if (whoAreYouTitle && BRAND.whoAreYou?.title) {
        whoAreYouTitle.textContent = BRAND.whoAreYou.title;
    }
    if (whoAreYouDescription && BRAND.whoAreYou?.description) {
        whoAreYouDescription.innerHTML = BRAND.whoAreYou.description;
    }
    if (presenterLoginButton && BRAND.whoAreYou?.buttonLoginLabel) {
        presenterLoginButton.textContent = BRAND.whoAreYou.buttonLoginLabel;
    }
    if (guestJoinRoomButton && BRAND.whoAreYou?.buttonJoinLabel) {
        guestJoinRoomButton.textContent = BRAND.whoAreYou.buttonJoinLabel;
    }
}

initialize();
