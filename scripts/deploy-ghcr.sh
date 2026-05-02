#!/usr/bin/env bash
set -euo pipefail

if [ "${CONFIRM_PRODUCTION_DEPLOY:-}" != "yes" ]; then
  echo "This script recreates the production app container." >&2
  echo "Set CONFIRM_PRODUCTION_DEPLOY=yes to continue." >&2
  exit 2
fi

COMPOSE_FILE="${COMPOSE_FILE:-/opt/1panel/docker/compose/newapi/docker-compose.yml}"
IMAGE_NAME="${IMAGE_NAME:-ghcr.io/timefiles404/xingkong:latest}"
APP_SERVICE="${APP_SERVICE:-app}"
MONITOR_SERVICE="${MONITOR_SERVICE:-uptime-kuma}"
DB_CONTAINER="${DB_CONTAINER:-newapi-postgres}"
DB_NAME="${DB_NAME:-mynewapi}"
DB_USER="${DB_USER:-user_rmzsQn}"
STATUS_URL="${STATUS_URL:-http://127.0.0.1:3000/api/status}"
STATUS_FILE="${STATUS_FILE:-/tmp/newapi-status.json}"

if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo "[1/6] pulling image $IMAGE_NAME"
else
  echo "[1/6] updating image $IMAGE_NAME"
fi
docker pull "$IMAGE_NAME"

echo "[2/6] pointing compose app image to $IMAGE_NAME"
python3 - "$COMPOSE_FILE" "$IMAGE_NAME" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
image = sys.argv[2]
text = path.read_text()
lines = text.splitlines()
in_app = False
for i, line in enumerate(lines):
    stripped = line.strip()
    if line.startswith('  ') and not line.startswith('    ') and stripped.endswith(':'):
        in_app = stripped == 'app:'
        continue
    if in_app and stripped.startswith('image:'):
        indent = line[:len(line) - len(line.lstrip())]
        lines[i] = f'{indent}image: {image}'
        break
else:
    raise SystemExit('app image line not found')
path.write_text('\n'.join(lines) + '\n')
PY

echo "[2.5/6] enabling in-panel auto update support"
python3 - "$COMPOSE_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
lines = path.read_text().splitlines()

def find_service_bounds(lines, service):
    start = None
    for i, line in enumerate(lines):
        if line.startswith("  ") and not line.startswith("    ") and line.strip() == f"{service}:":
            start = i
            break
    if start is None:
        raise SystemExit(f"{service} service not found")
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i].startswith("  ") and not lines[i].startswith("    ") and lines[i].strip().endswith(":"):
            end = i
            break
    return start, end

def ensure_list_item(lines, service, section, item):
    start, end = find_service_bounds(lines, service)
    section_idx = None
    for i in range(start + 1, end):
        if lines[i].strip() == f"{section}:" and lines[i].startswith("    "):
            section_idx = i
            break
    if section_idx is None:
        insert_at = end
        lines.insert(insert_at, f"    {section}:")
        lines.insert(insert_at + 1, f"      - {item}")
        return
    item_line = f"      - {item}"
    for i in range(section_idx + 1, end):
        if lines[i].startswith("    ") and not lines[i].startswith("      "):
            break
        if lines[i].strip() == f"- {item}":
            return
    insert_at = section_idx + 1
    while insert_at < len(lines) and lines[insert_at].startswith("      - "):
        insert_at += 1
    lines.insert(insert_at, item_line)

ensure_list_item(lines, "app", "volumes", "/var/run/docker.sock:/var/run/docker.sock")
ensure_list_item(lines, "app", "volumes", "/opt/1panel/docker/compose/newapi/docker-compose.yml:/host-compose/docker-compose.yml")
ensure_list_item(lines, "app", "environment", "XINGKONG_AUTO_UPDATE_COMPOSE_FILE=/host-compose/docker-compose.yml")
ensure_list_item(lines, "app", "environment", "XINGKONG_AUTO_UPDATE_COMPOSE_HOST_FILE=/opt/1panel/docker/compose/newapi/docker-compose.yml")
ensure_list_item(lines, "app", "environment", "XINGKONG_AUTO_UPDATE_SERVICE=app")
ensure_list_item(lines, "app", "environment", "XINGKONG_AUTO_UPDATE_COMPOSE_PROJECT=newapi")
ensure_list_item(lines, "app", "environment", "XINGKONG_AUTO_UPDATE_IMAGE_REPO=ghcr.io/timefiles404/xingkong")

path.write_text("\n".join(lines) + "\n")
PY

echo "[3/6] forcing runtime options"
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "INSERT INTO options(key,value) VALUES ('theme.frontend','default') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;" >/dev/null
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "INSERT INTO options(key,value) VALUES ('QuotaPerUnit','10000') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;" >/dev/null
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "INSERT INTO options(key,value) VALUES ('DisplayInCurrencyEnabled','true') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;" >/dev/null
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "INSERT INTO options(key,value) VALUES ('general_setting.quota_display_type','USD') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;" >/dev/null

echo "[4/6] recreating $APP_SERVICE"
docker compose -f "$COMPOSE_FILE" up -d "$MONITOR_SERVICE"
docker compose -f "$COMPOSE_FILE" up -d --force-recreate "$APP_SERVICE"

echo "[5/6] waiting for app"
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

echo "[6/6] status"
cat "$STATUS_FILE"
echo
