#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-ghcr.io/timefiles404/xingkong:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-newapi-ghcr-test}"
HOST_PORT="${HOST_PORT:-13000}"
BIND_ADDR="${BIND_ADDR:-127.0.0.1}"
NETWORK_NAME="${NETWORK_NAME:-1panel-network}"
SQL_DSN="${SQL_DSN:-postgresql://user_rmzsQn:password_bDWewb@postgresql:5432/mynewapi}"
REDIS_CONN_STRING="${REDIS_CONN_STRING:-redis://:redis_XTyhsG@redis:6379}"
TEST_COMPOSE_DIR="${TEST_COMPOSE_DIR:-/opt/new-api-ghcr-test}"
TEST_COMPOSE_FILE="${TEST_COMPOSE_FILE:-${TEST_COMPOSE_DIR}/docker-compose.yml}"
STATUS_URL="http://127.0.0.1:${HOST_PORT}/api/status"

echo "[1/4] pulling image ${IMAGE_NAME}"
docker pull "$IMAGE_NAME"

echo "[2/4] recreating test container ${CONTAINER_NAME} on port ${HOST_PORT}"
mkdir -p "$TEST_COMPOSE_DIR"
export IMAGE_NAME CONTAINER_NAME HOST_PORT BIND_ADDR NETWORK_NAME SQL_DSN REDIS_CONN_STRING
python3 - "$TEST_COMPOSE_FILE" <<'PY'
from pathlib import Path
import os
import sys

path = Path(sys.argv[1])
env = os.environ

def q(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'

image = env.get("IMAGE_NAME", "ghcr.io/timefiles404/xingkong:latest")
container = env.get("CONTAINER_NAME", "newapi-ghcr-test")
host_port = env.get("HOST_PORT", "13000")
bind_addr = env.get("BIND_ADDR", "127.0.0.1")
network = env.get("NETWORK_NAME", "1panel-network")
sql_dsn = env.get("SQL_DSN", "postgresql://user_rmzsQn:password_bDWewb@postgresql:5432/mynewapi")
redis = env.get("REDIS_CONN_STRING", "redis://:redis_XTyhsG@redis:6379")
host_compose = str(path)

content = f"""services:
  app:
    image: {q(image)}
    container_name: {q(container)}
    restart: unless-stopped
    networks:
      - app-network
    ports:
      - {q(f"{bind_addr}:{host_port}:3000")}
    volumes:
      - /opt/new-api/test-data:/data
      - /opt/new-api/test-logs:/app/logs
      - /var/run/docker.sock:/var/run/docker.sock
      - {host_compose}:/host-compose/docker-compose.yml
    environment:
      - SQL_DSN={sql_dsn}
      - REDIS_CONN_STRING={redis}
      - TZ=Asia/Shanghai
      - ERROR_LOG_ENABLED=true
      - BATCH_UPDATE_ENABLED=true
      - SESSION_SECRET=test-session-secret-not-for-production
      - CRYPTO_SECRET=test-crypto-secret-not-for-production
      - XINGKONG_AUTO_UPDATE_COMPOSE_FILE=/host-compose/docker-compose.yml
      - XINGKONG_AUTO_UPDATE_COMPOSE_HOST_FILE={host_compose}
      - XINGKONG_AUTO_UPDATE_SERVICE=app
      - XINGKONG_AUTO_UPDATE_COMPOSE_PROJECT={Path(host_compose).parent.name}
      - XINGKONG_AUTO_UPDATE_IMAGE_REPO=ghcr.io/timefiles404/xingkong
    command: ["--log-dir", "/app/logs"]

networks:
  app-network:
    external: true
    name: {q(network)}
"""
path.write_text(content)
PY
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker compose -f "$TEST_COMPOSE_FILE" up -d --force-recreate app >/dev/null

echo "[3/4] waiting for test app"
for _ in $(seq 1 60); do
  if curl -fsS "$STATUS_URL" >/tmp/newapi-ghcr-test-status.json 2>/dev/null; then
    break
  fi
  sleep 2
done

if ! test -s /tmp/newapi-ghcr-test-status.json; then
  echo "test app did not become ready; recent logs:" >&2
  docker logs --tail 80 "$CONTAINER_NAME" >&2 || true
  exit 1
fi

echo "[4/4] test status"
cat /tmp/newapi-ghcr-test-status.json
echo
echo "Test URL: ${STATUS_URL}"
