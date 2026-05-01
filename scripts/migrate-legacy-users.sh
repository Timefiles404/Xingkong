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
SRC_CSV="$WORK_DIR/legacy-users.csv"
BACKUP_CSV="$WORK_DIR/local-users-backup-$TIMESTAMP.csv"
TOKENS_BACKUP_CSV="$WORK_DIR/local-tokens-backup-$TIMESTAMP.csv"
REPORT_FILE="$WORK_DIR/migration-report-$TIMESTAMP.txt"
CONTAINER_CSV="/tmp/legacy-users-$TIMESTAMP.csv"
TOKENS_SRC_CSV="$WORK_DIR/legacy-tokens.csv"
TOKENS_CONTAINER_CSV="/tmp/legacy-tokens-$TIMESTAMP.csv"

log_step() {
  printf '\n>>> %s\n' "$1"
}

log_info() {
  printf '%s\n' "$1"
}

cleanup() {
  rm -f "$SRC_CSV"
  rm -f "$TOKENS_SRC_CSV"
  docker exec "$DB_CONTAINER" rm -f "$CONTAINER_CSV" >/dev/null 2>&1 || true
  docker exec "$DB_CONTAINER" rm -f "$TOKENS_CONTAINER_CSV" >/dev/null 2>&1 || true
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

log_step "Backup local users table"
docker exec -i "$DB_CONTAINER" \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "\copy (SELECT id, username, display_name, role, status, quota FROM users ORDER BY id) TO STDOUT WITH CSV HEADER" \
  > "$BACKUP_CSV"

log_step "Backup local tokens table"
docker exec -i "$DB_CONTAINER" \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "\copy (SELECT id, user_id, name, key, status, created_time, accessed_time, expired_time, remain_quota, unlimited_quota, model_limits_enabled, model_limits, allow_ips, used_quota, \"group\", cross_group_retry FROM tokens ORDER BY id) TO STDOUT WITH CSV HEADER" \
  > "$TOKENS_BACKUP_CSV"

log_step "Export remote active users to CSV"
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
      display_name,
      password,
      ROUND(COALESCE(quota, 0) / 50.0)::bigint AS quota
    FROM users
    WHERE deleted_at IS NULL
      AND username IS NOT NULL
      AND BTRIM(username) <> ''
    ORDER BY id
  ) TO '/work/legacy-users.csv' WITH CSV HEADER"

if [[ ! -s "$SRC_CSV" ]]; then
  echo "Remote export failed: $SRC_CSV was not created." >&2
  exit 1
fi

IMPORT_ROWS="$(tail -n +2 "$SRC_CSV" | wc -l | awk '{print $1}')"
log_info "Exported rows: $IMPORT_ROWS"

log_step "Export remote active tokens to CSV"
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
      user_id,
      name,
      key,
      status,
      created_time,
      accessed_time,
      expired_time,
      ROUND(COALESCE(remain_quota, 0) / 50.0)::bigint AS remain_quota,
      COALESCE(unlimited_quota, false) AS unlimited_quota,
      COALESCE(model_limits_enabled, false) AS model_limits_enabled,
      COALESCE(model_limits, '') AS model_limits,
      COALESCE(allow_ips, '') AS allow_ips,
      ROUND(COALESCE(used_quota, 0) / 50.0)::bigint AS used_quota,
      COALESCE(\"group\", '') AS \"group\",
      COALESCE(cross_group_retry, false) AS cross_group_retry
    FROM tokens
    WHERE deleted_at IS NULL
    ORDER BY id
  ) TO '/work/legacy-tokens.csv' WITH CSV HEADER"

if [[ ! -s "$TOKENS_SRC_CSV" ]]; then
  echo "Remote token export failed: $TOKENS_SRC_CSV was not created." >&2
  exit 1
fi

TOKEN_ROWS="$(tail -n +2 "$TOKENS_SRC_CSV" | wc -l | awk '{print $1}')"
log_info "Exported active tokens: $TOKEN_ROWS"

log_step "Copy CSV into local postgres container"
docker cp "$SRC_CSV" "$DB_CONTAINER:$CONTAINER_CSV"
docker cp "$TOKENS_SRC_CSV" "$DB_CONTAINER:$TOKENS_CONTAINER_CSV"

log_step "Merge remote users into local users table"
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
BEGIN;

CREATE TEMP TABLE legacy_users_import (
  id bigint,
  username text,
  display_name text,
  password text,
  quota bigint
) ON COMMIT DROP;

\copy legacy_users_import FROM '$CONTAINER_CSV' WITH CSV HEADER

DELETE FROM legacy_users_import
WHERE username IS NULL OR BTRIM(username) = '';

MERGE INTO users AS dst
USING (
  SELECT
    id,
    BTRIM(username) AS username,
    NULLIF(BTRIM(COALESCE(display_name, '')), '') AS display_name,
    password,
    COALESCE(quota, 0)::bigint AS quota
  FROM legacy_users_import
) AS src
ON (dst.id = src.id OR dst.username = src.username)
WHEN MATCHED THEN
  UPDATE SET
    username = src.username,
    display_name = COALESCE(src.display_name, src.username),
    password = src.password,
    quota = src.quota
WHEN NOT MATCHED THEN
  INSERT (
    id,
    username,
    password,
    display_name,
    role,
    status,
    quota,
    used_quota,
    request_count,
    "group",
    created_at
  )
  VALUES (
    src.id,
    src.username,
    src.password,
    COALESCE(src.display_name, src.username),
    1,
    1,
    src.quota,
    0,
    0,
    'default',
    EXTRACT(EPOCH FROM NOW())::bigint
  );

SELECT setval(
  pg_get_serial_sequence('users', 'id'),
  GREATEST(COALESCE((SELECT MAX(id) FROM users), 1), 1),
  true
);

COMMIT;
SQL

log_step "Merge remote tokens into local tokens table"
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
BEGIN;

CREATE TEMP TABLE legacy_tokens_import (
  id bigint,
  user_id bigint,
  name text,
  key text,
  status bigint,
  created_time bigint,
  accessed_time bigint,
  expired_time bigint,
  remain_quota bigint,
  unlimited_quota boolean,
  model_limits_enabled boolean,
  model_limits text,
  allow_ips text,
  used_quota bigint,
  "group" text,
  cross_group_retry boolean
) ON COMMIT DROP;

\copy legacy_tokens_import FROM '$TOKENS_CONTAINER_CSV' WITH CSV HEADER

DELETE FROM legacy_tokens_import
WHERE key IS NULL OR BTRIM(key) = '';

DELETE FROM legacy_tokens_import t
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE u.id = t.user_id
);

MERGE INTO tokens AS dst
USING (
  SELECT
    id,
    user_id,
    COALESCE(NULLIF(BTRIM(name), ''), 'Imported Token') AS name,
    BTRIM(key) AS key,
    COALESCE(status, 1)::bigint AS status,
    COALESCE(created_time, EXTRACT(EPOCH FROM NOW())::bigint)::bigint AS created_time,
    COALESCE(accessed_time, 0)::bigint AS accessed_time,
    COALESCE(expired_time, -1)::bigint AS expired_time,
    COALESCE(remain_quota, 0)::bigint AS remain_quota,
    COALESCE(unlimited_quota, false) AS unlimited_quota,
    COALESCE(model_limits_enabled, false) AS model_limits_enabled,
    COALESCE(model_limits, '') AS model_limits,
    COALESCE(allow_ips, '') AS allow_ips,
    COALESCE(used_quota, 0)::bigint AS used_quota,
    COALESCE(NULLIF(BTRIM("group"), ''), '') AS "group",
    COALESCE(cross_group_retry, false) AS cross_group_retry
  FROM legacy_tokens_import
) AS src
ON (dst.id = src.id OR dst.key = src.key)
WHEN MATCHED THEN
  UPDATE SET
    user_id = src.user_id,
    name = src.name,
    key = src.key,
    status = src.status,
    created_time = src.created_time,
    accessed_time = src.accessed_time,
    expired_time = src.expired_time,
    remain_quota = src.remain_quota,
    unlimited_quota = src.unlimited_quota,
    model_limits_enabled = src.model_limits_enabled,
    model_limits = src.model_limits,
    allow_ips = src.allow_ips,
    used_quota = src.used_quota,
    "group" = src."group",
    cross_group_retry = src.cross_group_retry
WHEN NOT MATCHED THEN
  INSERT (
    id,
    user_id,
    name,
    key,
    status,
    created_time,
    accessed_time,
    expired_time,
    remain_quota,
    unlimited_quota,
    model_limits_enabled,
    model_limits,
    allow_ips,
    used_quota,
    "group",
    cross_group_retry
  )
  VALUES (
    src.id,
    src.user_id,
    src.name,
    src.key,
    src.status,
    src.created_time,
    src.accessed_time,
    src.expired_time,
    src.remain_quota,
    src.unlimited_quota,
    src.model_limits_enabled,
    src.model_limits,
    src.allow_ips,
    src.used_quota,
    src."group",
    src.cross_group_retry
  );

SELECT setval(
  pg_get_serial_sequence('tokens', 'id'),
  GREATEST(COALESCE((SELECT MAX(id) FROM tokens), 1), 1),
  true
);

COMMIT;
SQL

log_step "Route auto-group tokens to default fallback"
docker exec -i "$DB_CONTAINER" \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "INSERT INTO options(key, value) VALUES ('AutoGroups', '[\"default\"]') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;"

log_step "Write migration report"
{
  echo "Imported rows from source CSV: $IMPORT_ROWS"
  echo "Imported tokens from source CSV: $TOKEN_ROWS"
  echo
  echo "Local users after migration:"
  docker exec "$DB_CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -At \
    -c "SELECT COUNT(*) FROM users;"
  echo
  echo "Sample users:"
  docker exec "$DB_CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT id, username, display_name, role, quota FROM users ORDER BY id LIMIT 20;"
  echo
  echo "Local tokens after migration:"
  docker exec "$DB_CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -At \
    -c "SELECT COUNT(*) FROM tokens;"
} > "$REPORT_FILE"

log_step "Verify migration summary"
docker exec "$DB_CONTAINER" \
  psql -U "$DB_USER" -d "$DB_NAME" \
  -c "SELECT COUNT(*) AS total_users, MIN(id) AS min_id, MAX(id) AS max_id, SUM(quota) AS total_quota FROM users;"

docker exec "$DB_CONTAINER" \
  psql -U "$DB_USER" -d "$DB_NAME" \
  -c "SELECT COUNT(*) AS total_tokens, MIN(id) AS min_id, MAX(id) AS max_id, SUM(remain_quota) AS total_remain_quota, SUM(used_quota) AS total_used_quota FROM tokens;"

log_info ""
log_info "Migration completed."
log_info "Remote source was read-only."
log_info "Local backup: $BACKUP_CSV"
log_info "Local token backup: $TOKENS_BACKUP_CSV"
log_info "Report: $REPORT_FILE"
