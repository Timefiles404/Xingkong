#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/opt/new-api-upstream"
COMPOSE_FILE="/opt/1panel/docker/compose/newapi/docker-compose.yml"
IMAGE_NAME="mynewapi:local"
APP_SERVICE="app"
MONITOR_SERVICE="uptime-kuma"
DB_CONTAINER="newapi-postgres"
DB_NAME="mynewapi"
DB_USER="user_rmzsQn"
STATUS_URL="http://127.0.0.1:3000/api/status"
STATUS_FILE="/tmp/newapi-status.json"

cd "$ROOT_DIR"

echo "[1/5] building image $IMAGE_NAME"
docker build --tag "$IMAGE_NAME" .

echo "[2/5] forcing frontend theme to default"
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "INSERT INTO options(key,value) VALUES ('theme.frontend','default') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;" >/dev/null
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "INSERT INTO options(key,value) VALUES ('QuotaPerUnit','10000') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;" >/dev/null
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "INSERT INTO options(key,value) VALUES ('DisplayInCurrencyEnabled','true') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;" >/dev/null
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "INSERT INTO options(key,value) VALUES ('general_setting.quota_display_type','USD') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;" >/dev/null
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" <<'SQL' >/dev/null
INSERT INTO options(key,value) VALUES
('console_setting.announcements_enabled','true'),
('console_setting.api_info_enabled','true'),
('console_setting.uptime_kuma_enabled','true'),
('console_setting.faq_enabled','false'),
('console_setting.announcements','[{"id":1,"content":"欢迎使用星空控制台。公告、API 地址与状态监控现已在新版界面中维护。","publishDate":"2026-04-29T00:00:00.000Z","type":"ongoing"}]'),
('console_setting.api_info','[{"id":1,"url":"https://new.xingkongai.online","route":"OpenAI","description":"OpenAI 兼容入口","color":"blue"},{"id":2,"url":"https://new.xingkongai.online/v1","route":"v1","description":"标准 /v1 代理入口","color":"green"}]'),
('console_setting.uptime_kuma_groups','[{"id":1,"categoryName":"星空","url":"http://uptime-kuma:3001","slug":"newapi"}]'),
('SidebarModulesAdmin','{"usage":{"enabled":true,"playground":true,"token":true},"data":{"enabled":true,"detail":true,"log":true},"personal":{"enabled":true,"topup":true,"personal":true},"admin":{"enabled":true,"channel":true,"models":true,"redemption":true,"user":true,"setting":true,"subscription":true,"profit":true}}'),
('HeaderNavModules','{"home":false,"console":true,"pricing":{"enabled":true,"requireAuth":true},"docs":false,"about":true}')
ON CONFLICT (key) DO NOTHING;
SQL

echo "[3/5] recreating $APP_SERVICE"
docker compose -f "$COMPOSE_FILE" up -d "$MONITOR_SERVICE"
docker compose -f "$COMPOSE_FILE" up -d --force-recreate "$APP_SERVICE"

echo "[4/5] waiting for app"
rm -f "$STATUS_FILE"
for _ in $(seq 1 60); do
  if curl -fsS "$STATUS_URL" >"$STATUS_FILE" 2>/dev/null; then
    break
  fi
  sleep 2
done

if ! test -s "$STATUS_FILE"; then
  echo "status endpoint did not become ready" >&2
  exit 1
fi

echo "[5/5] status"
cat "$STATUS_FILE"
echo
