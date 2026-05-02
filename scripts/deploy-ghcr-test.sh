#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-ghcr.io/timefiles404/xingkong:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-newapi-ghcr-test}"
HOST_PORT="${HOST_PORT:-13000}"
BIND_ADDR="${BIND_ADDR:-127.0.0.1}"
NETWORK_NAME="${NETWORK_NAME:-1panel-network}"
SQL_DSN="${SQL_DSN:-postgresql://user_rmzsQn:password_bDWewb@postgresql:5432/mynewapi}"
REDIS_CONN_STRING="${REDIS_CONN_STRING:-redis://:redis_XTyhsG@redis:6379}"
STATUS_URL="http://127.0.0.1:${HOST_PORT}/api/status"

echo "[1/4] pulling image ${IMAGE_NAME}"
docker pull "$IMAGE_NAME"

echo "[2/4] recreating test container ${CONTAINER_NAME} on port ${HOST_PORT}"
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d \
  --name "$CONTAINER_NAME" \
  --network "$NETWORK_NAME" \
  -p "${BIND_ADDR}:${HOST_PORT}:3000" \
  -v /opt/new-api/test-data:/data \
  -v /opt/new-api/test-logs:/app/logs \
  -e "SQL_DSN=${SQL_DSN}" \
  -e "REDIS_CONN_STRING=${REDIS_CONN_STRING}" \
  -e "TZ=Asia/Shanghai" \
  -e "ERROR_LOG_ENABLED=true" \
  -e "BATCH_UPDATE_ENABLED=true" \
  -e "SESSION_SECRET=test-session-secret-not-for-production" \
  -e "CRYPTO_SECRET=test-crypto-secret-not-for-production" \
  "$IMAGE_NAME" \
  --log-dir /app/logs >/dev/null

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
