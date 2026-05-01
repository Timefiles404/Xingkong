#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${WORK_DIR:-$ROOT_DIR/.migration}"

SRC_DOCKER_IMAGE="${SRC_DOCKER_IMAGE:-postgres:18-alpine}"
SRC_HOST="${SRC_HOST:?SRC_HOST is required}"
SRC_PORT="${SRC_PORT:?SRC_PORT is required}"
SRC_DB="${SRC_DB:?SRC_DB is required}"
SRC_USER="${SRC_USER:?SRC_USER is required}"
SRC_PASS="${SRC_PASS:?SRC_PASS is required}"

DB_CONTAINER="${DB_CONTAINER:-newapi-postgres}"
DB_NAME="${DB_NAME:-mynewapi}"
DB_USER="${DB_USER:-user_rmzsQn}"

mkdir -p "$WORK_DIR"

TIMESTAMP="$(date +%Y%m%d%H%M%S)"
SRC_CSV="$WORK_DIR/legacy-user-balances.csv"
BACKUP_CSV="$WORK_DIR/local-user-balances-backup-$TIMESTAMP.csv"
REPORT_FILE="$WORK_DIR/balance-sync-report-$TIMESTAMP.txt"
CONTAINER_CSV="/tmp/legacy-user-balances-$TIMESTAMP.csv"
CONTAINER_REPORT="/tmp/balance-sync-report-$TIMESTAMP.csv"

log_step() {
  printf '\n>>> %s\n' "$1"
}

cleanup() {
  rm -f "$SRC_CSV"
  docker exec "$DB_CONTAINER" rm -f "$CONTAINER_CSV" >/dev/null 2>&1 || true
  docker exec "$DB_CONTAINER" rm -f "$CONTAINER_REPORT" >/dev/null 2>&1 || true
}

trap cleanup EXIT

log_step "Check local target database container"
docker ps --format '{{.Names}}' | grep -Fx "$DB_CONTAINER" >/dev/null

log_step "Check source database connection"
docker run --rm \
  -e "PGPASSWORD=$SRC_PASS" \
  "$SRC_DOCKER_IMAGE" \
  psql \
  -h "$SRC_HOST" \
  -p "$SRC_PORT" \
  -U "$SRC_USER" \
  -d "$SRC_DB" \
  -v ON_ERROR_STOP=1 \
  -c "SELECT current_database(), current_user;"

log_step "Backup local user balances"
docker exec -i "$DB_CONTAINER" \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "\copy (SELECT id, username, quota FROM users ORDER BY id) TO STDOUT WITH CSV HEADER" \
  > "$BACKUP_CSV"

log_step "Export remote user balances to CSV"
docker run --rm \
  -e "PGPASSWORD=$SRC_PASS" \
  -v "$WORK_DIR:/work" \
  -w /work \
  "$SRC_DOCKER_IMAGE" \
  psql \
  -h "$SRC_HOST" \
  -p "$SRC_PORT" \
  -U "$SRC_USER" \
  -d "$SRC_DB" \
  -v ON_ERROR_STOP=1 \
  -c "\copy (
    SELECT
      id,
      username,
      ROUND(COALESCE(quota, 0) / 50.0)::bigint AS quota
    FROM users
    WHERE deleted_at IS NULL
      AND username IS NOT NULL
      AND BTRIM(username) <> ''
    ORDER BY id
  ) TO '/work/legacy-user-balances.csv' WITH CSV HEADER"

if [[ ! -s "$SRC_CSV" ]]; then
  echo "Remote export failed: $SRC_CSV was not created." >&2
  exit 1
fi

log_step "Copy CSV into local postgres container"
docker cp "$SRC_CSV" "$DB_CONTAINER:$CONTAINER_CSV"

log_step "Sync balances into local users table"
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
BEGIN;

CREATE TEMP TABLE legacy_user_balances_import (
  id bigint,
  username text,
  quota bigint
) ON COMMIT DROP;

\copy legacy_user_balances_import FROM '$CONTAINER_CSV' WITH CSV HEADER

DELETE FROM legacy_user_balances_import
WHERE username IS NULL OR BTRIM(username) = '';

CREATE TEMP TABLE balance_sync_before AS
SELECT id, username, quota
FROM users;

CREATE TEMP TABLE balance_sync_matches AS
SELECT
  dst.id AS local_id,
  dst.username AS local_username,
  dst.quota AS local_quota_before,
  src.id AS remote_id,
  src.username AS remote_username,
  COALESCE(src.quota, 0)::bigint AS remote_quota
FROM users dst
JOIN legacy_user_balances_import src
  ON dst.id = src.id OR dst.username = src.username;

UPDATE users dst
SET quota = m.remote_quota
FROM balance_sync_matches m
WHERE dst.id = m.local_id;

COPY (
  SELECT
    COUNT(*) AS matched_users,
    COUNT(*) FILTER (WHERE local_quota_before IS DISTINCT FROM remote_quota) AS changed_users,
    COALESCE(SUM(local_quota_before), 0) AS quota_before_sum,
    COALESCE(SUM(remote_quota), 0) AS quota_after_sum
  FROM balance_sync_matches
) TO '$CONTAINER_REPORT' WITH CSV HEADER;

COMMIT;
SQL

log_step "Show sync summary"
docker cp "$DB_CONTAINER:$CONTAINER_REPORT" "$REPORT_FILE"
cat "$REPORT_FILE"
printf '\nLocal backup: %s\n' "$BACKUP_CSV"
printf 'Report: %s\n' "$REPORT_FILE"
