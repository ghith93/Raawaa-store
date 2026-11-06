-- LOCAL CANDIDATE MIGRATION. Not applied to staging yet.
--
-- Why this exists
-- ---------------
-- 004_order_retention.sql redacts orders using `closed_at`, but the checked-in
-- 001_private_orders.sql never creates that column, and 004 sets
-- `request_hash = null` / `idempotency_key = null` on columns declared NOT NULL.
-- On a fresh database built from 001..005 the cleanup routine therefore fails:
--   column "closed_at" does not exist
-- and, once the column exists, it would fail again on the NOT NULL constraints.
-- Staging may already carry `closed_at` from the live catalog, so every step here
-- is written to be safe whether or not the column is present.
--
-- This migration only adds the missing lifecycle column, keeps it truthful via a
-- trigger, and relaxes the two identifier columns *just enough* for redaction
-- while still requiring them on any order that has not been redacted.
-- It does not rewrite 004 (already applied) and it deletes no data.

alter table rawaa_store.orders
  add column if not exists closed_at timestamptz;

comment on column rawaa_store.orders.closed_at is
  'Set when an order reaches a terminal status (cancelled/fulfilled); null while open. Retention is measured from here.';

-- Terminal-status clock. Backfill uses now(), never created_at: the real closing
-- time of pre-existing rows is unknown, and guessing an earlier timestamp could
-- redact contact data before its 365-day window has actually elapsed.
update rawaa_store.orders
set closed_at = now()
where closed_at is null
  and order_status in ('cancelled', 'fulfilled');

create or replace function rawaa_store.set_order_closed_at()
returns trigger
language plpgsql
set search_path to pg_catalog, rawaa_store
as $function$
begin
  if new.order_status in ('cancelled', 'fulfilled') then
    -- Keep the first closing time; later edits must not extend the retention window.
    if tg_op = 'INSERT' or old.order_status is distinct from new.order_status then
      new.closed_at := now();
    end if;
  else
    -- Reopened orders are not eligible for contact redaction.
    new.closed_at := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists orders_set_closed_at on rawaa_store.orders;
create trigger orders_set_closed_at
before insert or update of order_status on rawaa_store.orders
for each row execute function rawaa_store.set_order_closed_at();

revoke all on function rawaa_store.set_order_closed_at() from public, anon, authenticated;

-- Redaction clears both identifiers. They stay mandatory for every order that
-- still holds contact details, so the insert invariant is not weakened.
alter table rawaa_store.orders
  alter column request_hash drop not null,
  alter column idempotency_key drop not null;

do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'rawaa_store.orders'::regclass
      and conname = 'orders_identifiers_present_until_redacted'
  ) then
    alter table rawaa_store.orders
      add constraint orders_identifiers_present_until_redacted
      check (
        (request_hash is not null and idempotency_key is not null)
        or (closed_at is not null and not (details ?| array['name', 'phone', 'address']))
      );
  end if;
end;
$do$;

-- Bounded cleanup scans by (closed_at, id); index only the rows it can consider.
create index if not exists orders_closed_at_idx
  on rawaa_store.orders (closed_at, id)
  where closed_at is not null;
