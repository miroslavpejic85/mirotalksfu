'use strict';

const base = require('./config.template.js');
const config = { ...base };

config.ui = config.ui || {};
config.ui.brand = {
  htmlInjection: true,
  app: {
    language: 'ru',
    name: 'Kremlevka',
    title: '<h1>Кремлёвка</h1> - надежная видеосвязь.',
    description: 'Защищенная линия связи.',
    joinDescription: 'Введите код конференции.',
    joinButtonLabel: 'ВОЙТИ',
    joinLastLabel: 'История комнат:'
  },
  site: {
    title: 'Кремлёвка – зашифрованые видеоконференции',
    icon: '../images/mirotalk-logo.svg',
    appleTouchIcon: '../images/mirotalk-logo.svg',
    newRoomTitle: 'Создайте комнату.',
    newRoomDescription: 'Каждой комнате соответствует уникальный URL.'
  },
  meta: {
    description: 'Кремлёвка — платформа видеовстреч.',
    keywords: 'видеозвонки, конференции'
  },
  og: {
    type: 'app-webrtc',
    siteName: 'Kremlevka',
    title: 'Kremlevka',
    description: 'Зашифрованные видеоконференции.'
  },
  html: {
    features: false,
    teams: false,
    tryEasier: false,
    poweredBy: false,
    sponsors: false,
    advertisers: false,
    footer: false
  }
};

module.exports = config;
