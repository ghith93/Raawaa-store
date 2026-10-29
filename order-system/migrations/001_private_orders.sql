-- Applied to Ghaioooth-core as rawaa_private_order_staging (20261029220654).
-- It is an empty, private staging area, not a live order service.
-- A private, unexposed schema: access is reserved for a trusted server role.
create schema rawaa_store;
revoke all on schema rawaa_store from public, anon, authenticated;
grant usage on schema rawaa_store to service_role;

create table rawaa_store.orders (
  id uuid primary key,
  reference text not null unique check (reference ~ '^RAWAA-[A-Z0-9]{6,30}$'),
  idempotency_key uuid not null unique,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  order_status text not null default 'pending_review' check (order_status in ('pending_review', 'confirmed', 'cancelled', 'fulfilled')),
  -- Validated, server-calculated snapshot. Never accept client totals as authoritative.
  details jsonb not null check (jsonb_typeof(details) = 'object')
);

create table rawaa_store.notification_outbox (
  order_id uuid primary key references rawaa_store.orders(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending', 'sending', 'sent', 'failed', 'unknown')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_until timestamptz,
  lease_id uuid,
  updated_at timestamptz not null default now(),
  check ((state = 'sending' and lease_until is not null and lease_id is not null) or (state <> 'sending' and lease_until is null and lease_id is null))
);

alter table rawaa_store.orders enable row level security;
alter table rawaa_store.notification_outbox enable row level security;
revoke all on all tables in schema rawaa_store from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema rawaa_store to service_role;
alter default privileges in schema rawaa_store revoke all on tables from public, anon, authenticated;
-- Deliberately no public policies or owner access yet. Owner authentication, data
-- retention, notification retries, rate limiting and the API must be built before use.
