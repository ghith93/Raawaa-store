-- Staged only. Requires an authenticated, non-spoofable client identity source.
-- Reviewed 2026-10-30 and applied ONCE the same day to Ghaioooth-core as migration
--   `rawaa_order_rate_limit` (table verified: RLS on, service_role only, expiry index).
-- NEVER re-apply this file to that database. Any change there belongs in an 004.
-- The review covered:
--   access: RLS on, all privileges revoked from public/anon/authenticated, service_role
--     only — consistent with 001/002 and with the shared-project posture.
--   cleanup: bounded (500 rows/run) delete of windows expired over 24 h ago, served by
--     order_rate_limit_expiry_idx; a scheduler must call it repeatedly (not deployed).
--   reversibility: 003_order_rate_limit.down.sql drops table and index only; it never
--     touches orders or the notification outbox. Rate-limit history is expendable.
--   attempts ceiling raised 10 -> 100 so the real cap stays tunable in
--     postgres-rate-limiter.mjs (default 10/15 min) for shared CGNAT networks. The
--     ceiling only bounds counter growth; it is not the enforcement limit.
-- Never store raw addresses; identity_key is a keyed HMAC.
create table rawaa_store.order_rate_limit (
  identity_key text primary key check (identity_key ~ '^[0-9a-f]{64}$'),
  attempts integer not null check (attempts > 0 and attempts <= 100),
  window_end timestamptz not null
);
alter table rawaa_store.order_rate_limit enable row level security;
revoke all on rawaa_store.order_rate_limit from public, anon, authenticated;
grant select, insert, update, delete on rawaa_store.order_rate_limit to service_role;
create index order_rate_limit_expiry_idx on rawaa_store.order_rate_limit (window_end);
