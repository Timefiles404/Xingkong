#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${WORK_DIR:-$ROOT_DIR/.migration}"
DB_CONTAINER="${DB_CONTAINER:-newapi-postgres}"
DB_NAME="${DB_NAME:-mynewapi}"
DB_USER="${DB_USER:-user_rmzsQn}"

mkdir -p "$WORK_DIR"

TIMESTAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_CSV="$WORK_DIR/wallet-lots-backup-$TIMESTAMP.csv"
REPORT_CSV="$WORK_DIR/legacy-balance-wallet-lots-report-$TIMESTAMP.csv"
CONTAINER_REPORT="/tmp/legacy-balance-wallet-lots-report-$TIMESTAMP.csv"

log_step() {
  printf '\n>>> %s\n' "$1"
}

cleanup() {
  docker exec "$DB_CONTAINER" rm -f "$CONTAINER_REPORT" >/dev/null 2>&1 || true
}

trap cleanup EXIT

log_step "Check local target database container"
docker ps --format '{{.Names}}' | grep -Fx "$DB_CONTAINER" >/dev/null

log_step "Backup current wallet lots"
docker exec -i "$DB_CONTAINER" \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "\copy (SELECT * FROM wallet_lots ORDER BY id) TO STDOUT WITH CSV HEADER" \
  > "$BACKUP_CSV"

log_step "Rebuild current wallet lots from migrated balances"
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
BEGIN;

CREATE TEMP TABLE tmp_non_admin_users AS
SELECT
  id,
  username,
  COALESCE(quota, 0)::bigint AS quota,
  GREATEST(COALESCE(NULLIF(created_at, 0), EXTRACT(EPOCH FROM NOW())::bigint), 1)::bigint AS seed_created_at
FROM users
WHERE deleted_at IS NULL
  AND role < 10;

WITH archived AS (
  UPDATE wallet_lots wl
  SET
    quota_remaining = 0,
    gross_cny_remaining = 0,
    updated_at = EXTRACT(EPOCH FROM NOW())::bigint,
    source_note = CASE
      WHEN position('superseded_by_legacy_balance_seed' in COALESCE(wl.source_note, '')) > 0 THEN wl.source_note
      WHEN COALESCE(wl.source_note, '') = '' THEN 'superseded_by_legacy_balance_seed'
      ELSE wl.source_note || ' | superseded_by_legacy_balance_seed'
    END
  FROM tmp_non_admin_users u
  WHERE wl.user_id = u.id
    AND wl.quota_remaining > 0
  RETURNING wl.id
)
SELECT COUNT(*) FROM archived;

INSERT INTO wallet_lots (
  user_id,
  source_type,
  source_id,
  source_note,
  quota_total,
  quota_remaining,
  original_usd_value,
  gross_cny_basis,
  gross_cny_remaining,
  payment_fee_cny,
  cash_net_cny,
  downstream_cny_per_usd_snapshot,
  original_downstream_cash_amount_cny,
  created_at,
  updated_at
)
SELECT
  u.id,
  'topup',
  -u.id,
  'legacy_balance_seed_paid_1cny_100usd',
  GREATEST(u.quota - 40000, 0)::bigint,
  GREATEST(u.quota - 40000, 0)::bigint,
  GREATEST(u.quota - 40000, 0)::numeric / 10000.0,
  GREATEST(u.quota - 40000, 0)::numeric / 1000000.0,
  GREATEST(u.quota - 40000, 0)::numeric / 1000000.0,
  0,
  GREATEST(u.quota - 40000, 0)::numeric / 1000000.0,
  100.0,
  GREATEST(u.quota - 40000, 0)::numeric / 1000000.0,
  u.seed_created_at,
  EXTRACT(EPOCH FROM NOW())::bigint
FROM tmp_non_admin_users u
WHERE u.quota > 40000;

INSERT INTO wallet_lots (
  user_id,
  source_type,
  source_id,
  source_note,
  quota_total,
  quota_remaining,
  original_usd_value,
  gross_cny_basis,
  gross_cny_remaining,
  payment_fee_cny,
  cash_net_cny,
  downstream_cny_per_usd_snapshot,
  original_downstream_cash_amount_cny,
  created_at,
  updated_at
)
SELECT
  u.id,
  'gift',
  -u.id,
  'legacy_balance_seed_free_4usd',
  LEAST(u.quota, 40000)::bigint,
  LEAST(u.quota, 40000)::bigint,
  LEAST(u.quota, 40000)::numeric / 10000.0,
  0,
  0,
  0,
  0,
  100.0,
  0,
  u.seed_created_at,
  EXTRACT(EPOCH FROM NOW())::bigint
FROM tmp_non_admin_users u
WHERE u.quota > 0;

COPY (
  WITH paid_lots AS (
    SELECT
      user_id,
      COALESCE(SUM(quota_remaining), 0)::bigint AS paid_quota,
      COALESCE(SUM(gross_cny_remaining), 0)::numeric(20,6) AS paid_gross_cny
    FROM wallet_lots
    WHERE quota_remaining > 0
      AND gross_cny_remaining > 0
    GROUP BY user_id
  ),
  gift_lots AS (
    SELECT
      user_id,
      COALESCE(SUM(quota_remaining), 0)::bigint AS gift_quota
    FROM wallet_lots
    WHERE quota_remaining > 0
      AND gross_cny_remaining <= 0
    GROUP BY user_id
  )
  SELECT
    COUNT(*) AS users_processed,
    COUNT(*) FILTER (WHERE quota > 40000) AS users_with_paid_balance,
    COALESCE(SUM(GREATEST(quota - 40000, 0)), 0)::bigint AS expected_paid_quota,
    COALESCE(SUM(LEAST(quota, 40000)), 0)::bigint AS expected_free_quota,
    COALESCE(SUM(COALESCE(p.paid_quota, 0)), 0)::bigint AS inserted_paid_quota,
    COALESCE(SUM(COALESCE(g.gift_quota, 0)), 0)::bigint AS inserted_free_quota,
    COALESCE(SUM(COALESCE(p.paid_gross_cny, 0)), 0)::numeric(20,6) AS inserted_paid_gross_cny
  FROM tmp_non_admin_users u
  LEFT JOIN paid_lots p ON p.user_id = u.id
  LEFT JOIN gift_lots g ON g.user_id = u.id
) TO '$CONTAINER_REPORT' WITH CSV HEADER;

COMMIT;
SQL

log_step "Copy repair report"
docker cp "$DB_CONTAINER:$CONTAINER_REPORT" "$REPORT_CSV"
cat "$REPORT_CSV"

printf '\nWallet lot backup: %s\n' "$BACKUP_CSV"
printf 'Report: %s\n' "$REPORT_CSV"
