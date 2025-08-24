'use strict'
/**
 * Универсальная конфигурация MiroTalk SFU.
 * Все ключи читаются из process.env (файл .env), с разумными значениями по умолчанию.
 *
 * ВАЖНО:
 * - PUBLIC_ADDR = доменное имя, по которому к приложению ходят браузеры через Nginx (например: meet.example.com)
 * - SFU_ANNOUNCED_IP = внешний (публичный) IP сервера для ICE/DTLS
 * - APP_PORT = порт локального приложения (за Nginx), обычно 3010
 * - MEDIASOUP_MIN_PORT / MEDIASOUP_MAX_PORT = диапазон UDP-портов для WebRTC (должен совпадать с UFW/compose)
 */

const os = require('os');

// Утилиты для безопасного чтения переменных окружения
const getEnv = (key, def = undefined) =>
  process.env[key] !== undefined && process.env[key] !== '' ? process.env[key] : def;

const getInt = (key, def) => {
  const v = getEnv(key);
  const n = v !== undefined ? parseInt(String(v), 10) : NaN;
  return Number.isFinite(n) ? n : def;
};

const getBool = (key, def) => {
  const v = getEnv(key);
  if (v === undefined) return def;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
};

// Базовые настройки
const ENVIRONMENT = getEnv('ENVIRONMENT', 'production');
const PUBLIC_ADDR = getEnv('PUBLIC_ADDR', 'localhost');              // домен для клиентов
const APP_PORT    = getInt('APP_PORT', 3010);                        // локальный порт приложения
const ANNOUNCED_IP = getEnv('SFU_ANNOUNCED_IP', undefined);          // внешний IP (важно для ICE)
const MIN_PORT    = getInt('MEDIASOUP_MIN_PORT', 40000);
const MAX_PORT    = getInt('MEDIASOUP_MAX_PORT', 40100);

// Опционально: лимиты битрейтов можно вынести в .env при желании
const INITIAL_OBW = getInt('MEDIASOUP_INITIAL_OBW', 1_000_000);
const MIN_OBW     = getInt('MEDIASOUP_MIN_OBW', 300_000);
const MAX_IBW     = getInt('MEDIASOUP_MAX_IBW', 2_000_000);

// Если вы терминируете TLS в Nginx (рекомендовано), HTTPS здесь не включаем
const ENABLE_HTTPS = getBool('APP_ENABLE_HTTPS', false);

// Собираем итоговую конфигурацию
module.exports = {
  env: ENVIRONMENT,

  // URL, по которому клиенты открывают приложение (через Nginx/HTTPS)
  serverUrl: `https://${PUBLIC_ADDR}`,

  server: {
    listenIp: '0.0.0.0',
    listenPort: APP_PORT,
    https: {
      enable: ENABLE_HTTPS,
      // Если вы всё же хотите поднимать TLS внутри самого Node (обычно НЕ нужно),
      // задайте пути к ключам/сертификатам через переменные окружения:
      // APP_TLS_CERT и APP_TLS_KEY
      cert: getEnv('APP_TLS_CERT', ''),
      key:  getEnv('APP_TLS_KEY', '')
    }
  },

  mediasoup: {
    // workers = число CPU, но минимум 1
    numWorkers: Math.max(1, os.cpus().length),

    worker: {
      rtcMinPort: MIN_PORT,
      rtcMaxPort: MAX_PORT
    },

    // WebRTC-транспорты
    webRtcTransport: {
      listenIps: [
        {
          ip: '0.0.0.0',
          // announcedIp — обязателен для работы за NAT/прокси: внешний IP сервера
          announcedIp: ANNOUNCED_IP
        }
      ],
      initialAvailableOutgoingBitrate: INITIAL_OBW,
      minimumAvailableOutgoingBitrate: MIN_OBW,
      maxIncomingBitrate: MAX_IBW
    },

    // Если используете записи/RTMP и т.п. через plain-транспорты
    plainTransport: {
      listenIp: {
        ip: '0.0.0.0',
        announcedIp: ANNOUNCED_IP
      },
      maxSrtpLifetime: 2 ** 31 - 1
    }
  }
};
