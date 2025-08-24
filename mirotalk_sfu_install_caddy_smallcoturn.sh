#!/usr/bin/env bash
# ============================================================================
#  Spectrum — "малый кластер" + Caddy + (опционально) coturn  [v2]
#  Стек: Docker + Caddy (Automatic HTTPS) + UFW + (опция) coturn
#  Цели:
#    - Простая установка и быстрая миграция на новый сервер (DNS-переключение)
#    - Профиль "небольшая нагрузка" по умолчанию: узкий UDP-диапазон и 2 воркера
#    - TURN-сервер (coturn) по флагу TURN_ENABLE=1 (порт 3478/UDP[+TCP], узкий relay-диапазон)
#    - Безопасная обёртка config.js (без правок Server.js, без sed)
#
#  Запуск (пример):
#    sudo DOMAIN="meet.example.com" EMAIL="admin@example.com" \
#         ./mirotalk_sfu_install_caddy_smallcoturn_v2.sh
#
#    Опционально (включить TURN):
#    sudo DOMAIN="meet.example.com" EMAIL="admin@example.com" \
#         TURN_ENABLE=1 TURN_USER="miro" TURN_PASS="strong-password" \
#         ./mirotalk_sfu_install_caddy_smallcoturn_v2.sh
# ============================================================================

set -euo pipefail
trap 'echo -e "\033[0;31m✖ Ошибка на строке $LINENO\033[0m"; exit 1' ERR

# ------------ Цвета и лог ------------
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "\n${YELLOW}➜ $*${NC}"; }
ok()   { echo -e "${GREEN}✔ $*${NC}"; }
fail(){ echo -e "${RED}✖ $*${NC}" >&2; exit 1; }

# ------------ Параметры/дефолты ------------
REPO_URL="${REPO_URL:-https://github.com/beowulfworker-commits/mirotalksfu.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/mirotalksfu}"

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
PUBLIC_IP="${PUBLIC_IP:-}"                 # оставь пустым для авто-детекта SFU (рекомендуется)

# Профиль малого кластера по умолчанию
SFU_MIN_PORT="${SFU_MIN_PORT:-40000}"
SFU_MAX_PORT="${SFU_MAX_PORT:-40080}"
SFU_NUM_WORKERS="${SFU_NUM_WORKERS:-2}"

# TURN (опционально)
TURN_ENABLE="${TURN_ENABLE:-0}"            # 1 = ставим coturn и добавляем в ICE
TURN_USER="${TURN_USER:-}"                 # если пусто — сгенерируем
TURN_PASS="${TURN_PASS:-}"                 # если пусто — сгенерируем
TURN_MIN_PORT="${TURN_MIN_PORT:-49160}"
TURN_MAX_PORT="${TURN_MAX_PORT:-49220}"
TURN_TCP_ENABLE="${TURN_TCP_ENABLE:-1}"    # открыть слушание 3478/tcp и relay tcp
TURN_TLS_ENABLE="${TURN_TLS_ENABLE:-0}"    # 5349/tcp (используем только если есть валидные LE-серты в /etc/letsencrypt)

# Docker Compose режим
USE_HOST_NETWORK="${USE_HOST_NETWORK:-1}"  # 1 = host-сеть (рекомендовано для SFU)

[[ $EUID -eq 0 ]] || fail "Запускайте скрипт от root (sudo)."

read_value() { local PROMPT="$1" VAR="$2"; if [[ -z "${!VAR:-}" ]]; then read -rp "$PROMPT: " TMP || true; eval "$VAR=\"${TMP}\""; fi; }

clear
echo -e "${GREEN}MiroTalk SFU — установка (малый кластер) с Caddy [v2]${NC}"
read_value "Введите домен (например, meet.example.com)" DOMAIN
if [[ -z "${EMAIL:-}" ]]; then read -rp "Введите email для ACME (опционально): " EMAIL || true; fi
if [[ -z "${PUBLIC_IP:-}" ]]; then read -rp "Введите публичный IPv4 (опционально, Enter = пропустить): " PUBLIC_IP || true; fi
[[ -n "$DOMAIN" ]] || fail "Домен обязателен."

export DEBIAN_FRONTEND=noninteractive

# ------------ Базовые пакеты ------------
info "Установка системных компонентов..."
apt-get update
apt-get install -y git curl ufw ca-certificates lsb-release gnupg jq

# Docker
if ! command -v docker >/dev/null 2>&1; then
  info "Установка Docker Engine..."
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
  ok "Docker установлен."
else
  ok "Docker уже установлен."
fi

# Compose
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  info "Установка docker-compose..."
  apt-get install -y docker-compose || true
  if command -v docker-compose >/dev/null 2>&1; then COMPOSE="docker-compose"
  elif docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"
  else fail "Не найден docker compose."; fi
fi
ok "Будет использована команда: ${COMPOSE}"

# ------------ DNS-проверка ------------
info "Проверка DNS A-записи ${DOMAIN}..."
RESOLVED_IPS=$(getent ahosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u || true)
echo " • A ${DOMAIN} → ${RESOLVED_IPS:-<ничего>}"
if [[ -n "$PUBLIC_IP" ]] && ! echo "${RESOLVED_IPS}" | grep -q -w "$PUBLIC_IP"; then
  echo -e "${YELLOW}⚠ A-запись пока не указывает на ${PUBLIC_IP}. Automatic HTTPS может пройти не сразу.${NC}"
fi

# ------------ Caddy ------------
install_caddy_repo() {
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
}
if ! command -v caddy >/dev/null 2>&1; then
  info "Установка Caddy..."
  install_caddy_repo
else
  ok "Caddy уже установлен."
fi

# Освободим 80/443 от возможного nginx/apache
for svc in nginx apache2; do
  if systemctl is-active --quiet "$svc"; then
    info "Останавливаю конфликтующий сервис: $svc"
    systemctl stop "$svc" || true
    systemctl disable "$svc" || true
  fi
done

# ------------ UFW ------------
info "Настройка UFW (80/443 и UDP диапазон SFU)..."
ufw allow 22/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw allow ${SFU_MIN_PORT}:${SFU_MAX_PORT}/udp || true
ufw --force enable || true
ok "UFW базово настроен."

# ------------ Клонирование проекта ------------
info "Клонирование репозитория ${REPO_URL}..."
rm -rf "$INSTALL_DIR"
git clone "$REPO_URL" "$INSTALL_DIR"
cd "$INSTALL_DIR"
ok "Репозиторий склонирован: $INSTALL_DIR"

# ------------ .env и config.js ------------
set_or_add_env () { local KEY="$1" VAL="$2" FILE="$3"; if grep -qE "^[#\s]*${KEY}=" "$FILE"; then sed -i "s|^[#\s]*${KEY}=.*|${KEY}=${VAL}|" "$FILE"; else echo "${KEY}=${VAL}" >> "$FILE"; fi; }

info "Готовлю .env и app/src/config.js..."
if [[ -f .env.template ]]; then
  cp -f .env.template .env
elif [[ -f .env.example ]]; then
  cp -f .env.example .env
elif [[ ! -f .env ]]; then
  touch .env
fi

set_or_add_env "ENVIRONMENT" "production" ".env"
if [[ -n "$PUBLIC_IP" ]]; then
  set_or_add_env "SFU_ANNOUNCED_IP" "$PUBLIC_IP" ".env"
else
  set_or_add_env "SFU_ANNOUNCED_IP" "" ".env"   # авто-детект
fi
set_or_add_env "SFU_MIN_PORT" "$SFU_MIN_PORT" ".env"
set_or_add_env "SFU_MAX_PORT" "$SFU_MAX_PORT" ".env"
set_or_add_env "SFU_NUM_WORKERS" "$SFU_NUM_WORKERS" ".env"

# Шаг 1: получить базовый config.js из шаблона, если нужен
if [[ -f app/src/config.template.js && ! -f app/src/config.js && ! -f app/src/config.base.js ]]; then
  cp -f app/src/config.template.js app/src/config.js
fi

# Шаг 2: переименовать исходный config.js в config.base.js (только если ещё не переименован)
if [[ -f app/src/config.js && ! -f app/src/config.base.js ]]; then
  mv -f app/src/config.js app/src/config.base.js
fi

# Шаг 3: создать НОВЫЙ app/src/config.js (обёртка поверх config.base.js)
if [[ ! -f app/src/config.base.js ]]; then
  fail "Не найден ни app/src/config.base.js, ни app/src/config.js. Нет источника для конфигурации."
fi

cat > app/src/config.js <<'EOF'
// MIROTALK_INSTALLER_WRAPPER v4 (safe wrapper in config.js)
const base = require('./config.base.js');

function ensure(obj, path, def) {
  const segs = path.split('.');
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const k = segs[i];
    if (cur[k] === undefined || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  const last = segs[segs.length - 1];
  if (cur[last] === undefined) cur[last] = def;
}

const config = base;

// Диапазон портов воркера из .env
if (process.env.SFU_MIN_PORT && process.env.SFU_MAX_PORT) {
  ensure(config, 'mediasoup.worker', {});
  config.mediasoup.worker.rtcMinPort = parseInt(process.env.SFU_MIN_PORT, 10);
  config.mediasoup.worker.rtcMaxPort = parseInt(process.env.SFU_MAX_PORT, 10);
}

// Объявленный внешний адрес (может быть пустым — автоопределение)
const announced = process.env.SFU_ANNOUNCED_IP || '';

// Router: наблюдатели + кодеки по умолчанию
ensure(config, 'mediasoup.router', {
  audioLevelObserverEnabled: true,
  activeSpeakerObserverEnabled: true,
  mediaCodecs: [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    { kind: 'video', mimeType: 'video/VP8',  clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
    { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: {
        'level-asymmetry-allowed': 1, 'packetization-mode': 1, 'profile-level-id': '42e01f' } }
  ]
});

// WebRTC-транспорт: listenIps и безопасные дефолты битрейтов
ensure(config, 'mediasoup.webRtcTransport', {
  listenIps: [{ ip: '0.0.0.0', announcedIp: announced }],
  initialAvailableOutgoingBitrate: 1200000,
  maxIncomingBitrate: 2000000,
  enableUdp: true,
  enableTcp: true,
  preferUdp: true
});

// ICE servers: берём из переменной окружения ICE_SERVERS_JSON, иначе STUN Google
try {
  if (process.env.ICE_SERVERS_JSON) {
    config.webrtc = config.webrtc || {};
    config.webrtc.iceServers = JSON.parse(process.env.ICE_SERVERS_JSON);
  } else {
    config.webrtc = config.webrtc || {};
    config.webrtc.iceServers = config.webrtc.iceServers || [
      { urls: ['stun:stun.l.google.com:19302'] }
    ];
  }
} catch (e) {
  console.error('Invalid ICE_SERVERS_JSON:', e);
}

module.exports = config;
EOF

ok ".env и app/src/config.js (обёртка) готовы."

# ------------ TURN (опция) ------------
ICE_SERVERS_JSON='[{"urls":["stun:stun.l.google.com:19302"]}]'

if [[ "$TURN_ENABLE" == "1" ]]; then
  info "Включён TURN (coturn). Установка и настройка..."
  apt-get install -y coturn

  # Генерация логина/пароля при отсутствии
  if [[ -z "$TURN_USER" ]]; then TURN_USER="miro$(head -c4 /dev/urandom | tr -dc 'a-z0-9' | head -c4)"; fi
  if [[ -z "$TURN_PASS" ]]; then TURN_PASS="$(head -c24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c20)"; fi

  # Конфиг coturn
  cat > /etc/turnserver.conf <<EOF_TURN
listening-port=3478
# TLS-порт используем только если включен TURN_TLS_ENABLE и есть валидные сертификаты LE
$( [[ "$TURN_TLS_ENABLE" == "1" ]] && echo "tls-listening-port=5349" )

min-port=${TURN_MIN_PORT}
max-port=${TURN_MAX_PORT}

fingerprint
lt-cred-mech

user=${TURN_USER}:${TURN_PASS}

server-name=${DOMAIN}
realm=${DOMAIN}

total-quota=200
stale-nonce=600

# Если сервер за NAT — укажем внешний IP
$( [[ -n "$PUBLIC_IP" ]] && echo "external-ip=${PUBLIC_IP}" )

no-stdout-log
EOF_TURN

  # TLS (если включён и наличие LE-сертов)
  if [[ "$TURN_TLS_ENABLE" == "1" ]]; then
    if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" && -f "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" ]]; then
      echo "cert=/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" >> /etc/turnserver.conf
      echo "pkey=/etc/letsencrypt/live/${DOMAIN}/privkey.pem" >> /etc/turnserver.conf
    else
      echo -e "${YELLOW}⚠ Включён TURN_TLS_ENABLE=1, но LE-сертификаты не найдены. Пропускаю TLS на 5349.${NC}"
      sed -i '/^tls-listening-port/d' /etc/turnserver.conf || true
    fi
  fi

  # Автозапуск coturn
  if [[ -f /etc/default/coturn ]]; then
    sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  fi
  systemctl enable --now coturn
  systemctl restart coturn

  ok "coturn запущен."

  # UFW для TURN
  info "Открываю порты UFW для TURN..."
  ufw allow 3478/udp || true
  if [[ "$TURN_TCP_ENABLE" == "1" ]]; then ufw allow 3478/tcp || true; fi
  ufw allow ${TURN_MIN_PORT}:${TURN_MAX_PORT}/udp || true
  if [[ "$TURN_TCP_ENABLE" == "1" ]]; then ufw allow ${TURN_MIN_PORT}:${TURN_MAX_PORT}/tcp || true; fi
  if [[ "$TURN_TLS_ENABLE" == "1" ]]; then ufw allow 5349/tcp || true; fi
  ufw --force enable || true
  ok "UFW правила для TURN применены."

  # Построим ICE_SERVERS_JSON с учетом TURN
  ICE_SERVERS_JSON=$(jq -n \
    --arg d "$DOMAIN" \
    --arg u "$TURN_USER" \
    --arg p "$TURN_PASS" \
    '[{"urls":["stun:stun.l.google.com:19302"]},
      {"urls":["stun:\($d):3478"]},
      {"urls":["turn:\($d):3478"],"username":$u,"credential":$p}
    ]')
fi

# ------------ Dockerfile (Node 18 как в оф. рекомендации) ------------
info "Создаю Dockerfile..."
cat > Dockerfile <<'EOF_DOCKER'
FROM node:18-bullseye

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential python3 python3-pip python-is-python3 g++ make curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

ENV npm_config_loglevel=info \
    npm_config_progress=false \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_foreground_scripts=true \
    npm_config_python=/usr/bin/python \
    npm_config_unsafe_perm=true \
    npm_config_jobs=2 \
    PYTHON=/usr/bin/python \
    NODE_ENV=production \
    NODE_OPTIONS=--max_old_space_size=2048

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --production --no-audit --no-fund

COPY . .

EXPOSE 3010
CMD ["node", "app/src/Server.js"]
EOF_DOCKER
ok "Dockerfile создан."

# ------------ docker-compose ------------
info "Формирую docker-compose.yml..."
if [[ "${USE_HOST_NETWORK}" == "1" ]]; then
cat > docker-compose.yml <<EOF_YML
services:
  mirotalksfu:
    build: .
    container_name: mirotalksfu
    restart: unless-stopped
    network_mode: "host"
    environment:
      - NODE_ENV=production
      - ICE_SERVERS_JSON=$(echo "$ICE_SERVERS_JSON" | jq -c .)
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:3010/ >/dev/null || exit 1"]
      interval: 20s
      timeout: 5s
      retries: 15
      start_period: 40s
EOF_YML
else
cat > docker-compose.yml <<EOF_YML
services:
  mirotalksfu:
    build: .
    container_name: mirotalksfu
    restart: unless-stopped
    ports:
      - "127.0.0.1:3010:3010"
      - "${SFU_MIN_PORT}-${SFU_MAX_PORT}:${SFU_MIN_PORT}-${SFU_MAX_PORT}/udp"
    environment:
      - NODE_ENV=production
      - ICE_SERVERS_JSON=$(echo "$ICE_SERVERS_JSON" | jq -c .)
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:3010/ >/dev/null || exit 1"]
      interval: 20s
      timeout: 5s
      retries: 15
      start_period: 40s
EOF_YML
fi
ok "docker-compose.yml создан."

# ------------ Сборка и запуск контейнера ------------
info "Сборка и запуск контейнера..."
$COMPOSE up -d --build --force-recreate

info "Ожидание запуска контейнера..."
MAX_ATTEMPTS=15
for ((i=1; i<=MAX_ATTEMPTS; i++)); do
  if $COMPOSE ps --services --filter "status=running" | grep -q .; then
    break
  fi
  sleep 1
done

$COMPOSE ps || true
if ! $COMPOSE ps --services --filter "status=running" | grep -q .; then
  $COMPOSE logs --tail=200 || true
  fail "Контейнер не запущен после ${MAX_ATTEMPTS} попыток. Исправьте ошибки выше и повторите."
fi
ok "Контейнер(ы) запущены."

# ------------ Caddyfile ------------
info "Готовлю Caddyfile (Automatic HTTPS)..."
mkdir -p /etc/caddy
cat > /etc/caddy/Caddyfile <<EOF_CADDY
{
    $( [[ -n "$EMAIL" ]] && echo "email $EMAIL" )
    # debug
}

${DOMAIN} {
    encode gzip
    reverse_proxy 127.0.0.1:3010
}
EOF_CADDY

caddy validate --config /etc/caddy/Caddyfile
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy
ok "Caddy слушает 80/443. Сертификат будет/уже получен."

# ------------ Вывод итогов и тесты ------------
ICE_PRETTY=$(echo "$ICE_SERVERS_JSON" | jq -c .)
echo -e "\n${GREEN}=======================================================${NC}"
echo -e "${GREEN}🎉 УСТАНОВКА ЗАВЕРШЕНА (малый кластер, v2)!${NC}"
echo -e "URL: ${YELLOW}https://${DOMAIN}${NC}"
echo -e "Проект: ${YELLOW}${INSTALL_DIR}${NC}"
echo -e "Контейнеры: ${YELLOW}$(${COMPOSE} ps --services | paste -sd ', ' -)${NC}"
echo -e "ICE servers: ${YELLOW}${ICE_PRETTY}${NC}"
if [[ "$TURN_ENABLE" == "1" ]]; then
  echo -e "\nTURN: ${YELLOW}включён${NC}  (user=${TURN_USER})"
  echo -e "Порты: 3478/udp$([[ \"$TURN_TCP_ENABLE\" == \"1\" ]] && echo \", 3478/tcp\") и ${TURN_MIN_PORT}-${TURN_MAX_PORT}/udp$([[ \"$TURN_TCP_ENABLE\" == \"1\" ]] && echo \",tcp\")"
  echo -e "Проверка (замени параметры в URL):"
  echo -e "  https://p2p.mirotalk.com/icetest?iceServers=[{\"urls\":\"stun:${DOMAIN}:3478\"},{\"urls\":\"turn:${DOMAIN}:3478\",\"username\":\"${TURN_USER}\",\"credential\":\"${TURN_PASS}\"}]"
fi
echo -e "${GREEN}=======================================================${NC}\n"
