-- Staged only. Requires an authenticated, non-spoofable client identity source.
-- Never store raw addresses; identity_key is a keyed HMAC.
create table rawaa_store.order_rate_limit (
  identity_key text primary key check (identity_key ~ '^[0-9a-f]{64}$'),
  attempts integer not null check (attempts > 0 and attempts <= 10),
  window_end timestamptz not null
);
alter table rawaa_store.order_rate_limit enable row level security;
revoke all on rawaa_store.order_rate_limit from public, anon, authenticated;
grant select, insert, update, delete on rawaa_store.order_rate_limit to service_role;
create index order_rate_limit_expiry_idx on rawaa_store.order_rate_limit (window_end);
