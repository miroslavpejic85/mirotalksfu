#!/usr/bin/env bash
# Local test: a one-node k3s cluster (node "sfu1") in Docker, running the same manifests as production.
#   ./run.sh up       create the cluster and deploy MiroTalk SFU
#   ./run.sh status   pods and URLs
#   ./run.sh logs     follow the MiroTalk logs
#   ./run.sh down     delete everything
# Requires: docker, kubectl
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
K8S_DIR="$(dirname "$DIR")"
ENV_FILE="$K8S_DIR/production/.env" # the local overlay builds on ../production
NAME="mirotalksfu-k3s"
K3S_IMAGE="${K3S_IMAGE:-rancher/k3s:v1.33.5-k3s1}"
SFU_IMAGE="mirotalk/sfu:latest"
REDIS_IMAGE="valkey/valkey:8-alpine"
HTTPS_PORT=8443           # must match NODE_DOMAIN / SERVER_HOST_URL in kustomization.yaml
API_PORT=16443
MEDIA_PORTS="40000-40002" # SFU_MIN_PORT..SFU_MIN_PORT+SFU_NUM_WORKERS (2 workers)
export KUBECONFIG="$DIR/kubeconfig.yaml"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

wait_for() { # wait_for <seconds> <description> <command...>
    local timeout=$1 what=$2
    shift 2
    for _ in $(seq 1 "$timeout"); do
        if "$@" >/dev/null 2>&1; then return 0; fi
        sleep 1
    done
    echo "Timed out waiting for $what" >&2
    exit 1
}

ensure_env() {
    if [ -f "$ENV_FILE" ]; then
        log "Using existing $ENV_FILE"
        return
    fi
    log "Creating $ENV_FILE from .env.template with a random JWT_SECRET"
    cp "$K8S_DIR/../.env.template" "$ENV_FILE"
    local secret
    secret="$(openssl rand -hex 32)"
    sed -i.bak "s/^JWT_SECRET=.*/JWT_SECRET=$secret/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
}

import_image() {
    local image=$1
    docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image"
    docker save "$image" | docker exec -i "$NAME" ctr -n k8s.io images import - >/dev/null
}

up() {
    command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
    command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 1; }
    if docker inspect "$NAME" >/dev/null 2>&1; then
        echo "Cluster already exists, run: $0 down" >&2
        exit 1
    fi
    ensure_env

    log "Starting k3s node sfu1 ($K3S_IMAGE)"
    docker run -d --name "$NAME" --hostname sfu1 --privileged \
        --tmpfs /run --tmpfs /var/run \
        -v "$K8S_DIR/cluster/traefik-config.yaml:/var/lib/rancher/k3s/server/manifests/traefik-config.yaml:ro" \
        -p "127.0.0.1:$API_PORT:6443" \
        -p "127.0.0.1:$HTTPS_PORT:443" \
        -p "127.0.0.1:$MEDIA_PORTS:$MEDIA_PORTS/udp" \
        -p "127.0.0.1:$MEDIA_PORTS:$MEDIA_PORTS/tcp" \
        "$K3S_IMAGE" server --node-name sfu1 --tls-san 127.0.0.1 >/dev/null

    wait_for 120 "kubeconfig" docker exec "$NAME" test -s /etc/rancher/k3s/k3s.yaml
    docker exec "$NAME" cat /etc/rancher/k3s/k3s.yaml | sed "s#https://127.0.0.1:6443#https://127.0.0.1:$API_PORT#" >"$KUBECONFIG"
    wait_for 120 "node sfu1" kubectl wait node sfu1 --for=condition=Ready --timeout=1s

    log "Importing images into the node ($SFU_IMAGE, $REDIS_IMAGE)"
    import_image "$SFU_IMAGE"
    import_image "$REDIS_IMAGE"

    log "Waiting for Traefik (DaemonSet on host ports 80/443)"
    wait_for 300 "Traefik" kubectl -n kube-system rollout status ds/traefik --timeout=1s

    log "Deploying MiroTalk SFU"
    kubectl label node sfu1 mirotalk/sfu=true --overwrite >/dev/null
    kubectl apply -k "$DIR"
    wait_for 60 "MiroTalk pod" kubectl -n mirotalk get pod -l app=mirotalksfu -o name
    kubectl -n mirotalk wait pod -l app=mirotalksfu --for=condition=Ready --timeout=180s >/dev/null
    kubectl -n mirotalk wait pod -l app=redis --for=condition=Ready --timeout=60s >/dev/null

    status
}

status() {
    kubectl -n mirotalk get pods -o wide
    cat <<EOF

MiroTalk SFU is running in k3s. Open in Chrome or Firefox (accept the self-signed certificate):
  https://meet.localhost:$HTTPS_PORT      shared entry point
  https://sfu1.localhost:$HTTPS_PORT      node sfu1

kubectl:  export KUBECONFIG=$KUBECONFIG
Logs:     $0 logs
Remove:   $0 down
EOF
}

logs() { kubectl -n mirotalk logs -f -l app=mirotalksfu --tail=100; }

down() {
    log "Deleting the local cluster"
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    rm -f "$KUBECONFIG"
}

case "${1:-}" in
    up) up ;;
    status) status ;;
    logs) logs ;;
    down) down ;;
    *)
        echo "Usage: $0 {up|status|logs|down}" >&2
        exit 1
        ;;
esac
