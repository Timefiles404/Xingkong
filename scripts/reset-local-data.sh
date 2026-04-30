#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="newapi-postgres"
DB_NAME="mynewapi"
DB_USER="user_rmzsQn"
ROOT_USER_ID="1"
NEW_QUOTA_PER_UNIT="10000"
OLD_QUOTA_PER_UNIT="500000"
SCALE_DIVISOR="50"

docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" <<SQL
BEGIN;

DELETE FROM subscription_pre_consume_records;
DELETE FROM subscription_orders;
DELETE FROM user_subscriptions;
DELETE FROM subscription_plans;
DELETE FROM checkins;
DELETE FROM quota_data;
DELETE FROM logs;
DELETE FROM midjourneys;
DELETE FROM tasks;
DELETE FROM top_ups;
DELETE FROM redemptions;
DELETE FROM passkey_credentials;
DELETE FROM two_fa_backup_codes;
DELETE FROM two_fas;
DELETE FROM user_oauth_bindings;

DELETE FROM tokens WHERE user_id <> ${ROOT_USER_ID};
DELETE FROM users WHERE id <> ${ROOT_USER_ID};

UPDATE users
SET
  role = 100,
  status = 1,
  inviter_id = 0,
  quota = ROUND(quota::numeric / ${SCALE_DIVISOR})::integer,
  used_quota = ROUND(used_quota::numeric / ${SCALE_DIVISOR})::integer,
  aff_quota = 0,
  aff_history = 0,
  aff_count = 0,
  aff_code = 'root',
  github_id = '',
  discord_id = '',
  oidc_id = '',
  wechat_id = '',
  telegram_id = '',
  linux_do_id = '',
  stripe_customer = '',
  setting = COALESCE(setting, '')
WHERE id = ${ROOT_USER_ID};

UPDATE tokens
SET
  remain_quota = ROUND(remain_quota::numeric / ${SCALE_DIVISOR})::integer,
  used_quota = ROUND(used_quota::numeric / ${SCALE_DIVISOR})::integer
WHERE user_id = ${ROOT_USER_ID};

UPDATE options SET value = '${NEW_QUOTA_PER_UNIT}' WHERE key = 'QuotaPerUnit';
INSERT INTO options(key, value)
VALUES ('QuotaPerUnit', '${NEW_QUOTA_PER_UNIT}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO options(key, value) VALUES
('general_setting.quota_display_type','USD'),
('DisplayInCurrencyEnabled','true'),
('QuotaForNewUser','0'),
('QuotaForInviter','0'),
('QuotaForInvitee','0'),
('QuotaRemindThreshold','10000'),
('PreConsumedQuota','10000'),
('checkin_setting.min_quota','100'),
('checkin_setting.max_quota','1000'),
('CreemProducts','[]')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

COMMIT;
SQL
