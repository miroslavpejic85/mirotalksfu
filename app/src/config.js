'use strict';

const base = require('./config.template.js');
const config = { ...base };

config.ui = config.ui || {};
config.ui.brand = {
  htmlInjection: true,
  app: {
    language: 'ru',
    name: 'Spectrum',
    title: '<h1>Spectrum</h1> Быстрые и безопасные видеовстречи.',
    description: 'Защищенная линия связи.',
    joinDescription: 'Введите код конференции.',
    joinButtonLabel: 'ВОЙТИ',
    joinLastLabel: 'Последняя использованная комната:'
  },
  site: {
    title: 'Spectrum – видеоконференции на базе WebRTC',
    icon: '../images/spectrum-logo.svg',
    appleTouchIcon: '../images/spectrum-logo.svg',
    newRoomTitle: 'Создайте комнату.<br/>Поделитесь ссылкой.<br/>Начните встречу.',
    newRoomDescription: 'Каждой комнате соответствует уникальный URL.'
  },
  meta: {
    description: 'Spectrum — платформа видеовстреч.',
    keywords: 'spectrum, webrtc, видеозвонки, конференции, sfu'
  },
  og: {
    type: 'app-webrtc',
    siteName: 'Spectrum',
    title: 'Присоединяйтесь к встрече Spectrum',
    description: 'Видеоконференции без установки и регистрации.'
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
