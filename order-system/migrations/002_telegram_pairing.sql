-- Applied as rawaa_telegram_pairing_staging. The pairing endpoint is deployed for owner-only staging; delivery is not enabled.
-- One live challenge and one selected private chat for the single store owner.
create table rawaa_store.telegram_pairing_challenge (
  singleton boolean primary key default true check (singleton),
  id uuid not null unique,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed boolean not null default false,
  check (expires_at > issued_at and expires_at <= issued_at + interval '10 minutes')
);
create table rawaa_store.telegram_recipient (
  singleton boolean primary key default true check (singleton),
  chat_id bigint not null check (chat_id > 0),
  paired_at timestamptz not null default now()
);
alter table rawaa_store.telegram_pairing_challenge enable row level security;
alter table rawaa_store.telegram_recipient enable row level security;
revoke all on rawaa_store.telegram_pairing_challenge, rawaa_store.telegram_recipient from public, anon, authenticated;
grant select, insert, update, delete on rawaa_store.telegram_pairing_challenge, rawaa_store.telegram_recipient to service_role;
