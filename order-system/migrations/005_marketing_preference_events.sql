-- LOCAL CANDIDATE ONLY — NOT APPLIED TO STAGING.
-- The migration ledger was read-only checked on 2026-10-31; the most recent applied
-- migration was 20261030134505/rawaa_order_retention. Apply only after policy/retention
-- review and a fresh ledger check. Never treat a local SQL file as an applied migration.
--
-- Store only a domain-separated HMAC of the normalized phone, never a raw phone.
-- This table is append-only for the service role except for the bounded expiry worker.
create table rawaa_store.marketing_preference_events (
  event_id bigint generated always as identity primary key,
  phone_key text not null check (phone_key ~ '^[0-9a-f]{64}$'),
  event text not null check (event in ('opt_in', 'withdrawal')),
  consent_version text,
  source text not null,
  occurred_at timestamptz not null default now(),
  constraint marketing_preference_event_shape check (
    (event = 'opt_in' and consent_version is not null and length(consent_version) between 1 and 120 and source = 'order_form')
    or
    (event = 'withdrawal' and consent_version is null and source = 'owner_withdrawal')
  )
);

alter table rawaa_store.marketing_preference_events enable row level security;
revoke all on rawaa_store.marketing_preference_events from public, anon, authenticated;
grant select, insert on rawaa_store.marketing_preference_events to service_role;
grant usage, select on sequence rawaa_store.marketing_preference_events_event_id_seq to service_role;
create index marketing_preference_latest_idx
  on rawaa_store.marketing_preference_events (phone_key, event_id desc);
create index marketing_preference_expiry_idx
  on rawaa_store.marketing_preference_events (occurred_at, event_id);

-- Candidate event-evidence retention: at most 365 days, separately from the local
-- 90-day eligibility window in marketing-preferences.mjs. Neither duration is an
-- approved policy. Deleting only expired events must never revive an older opt-in.
create or replace function rawaa_store.redact_expired_marketing_preference_events(batch_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path to pg_catalog, rawaa_store
as $function$
declare
  redacted integer;
begin
  if batch_limit is null or batch_limit < 1 or batch_limit > 500 then
    raise exception 'INVALID_BATCH_LIMIT';
  end if;

  with expired as (
    select event_id
    from rawaa_store.marketing_preference_events
    where occurred_at < now() - interval '365 days'
    order by occurred_at, event_id
    limit batch_limit
    for update skip locked
  )
  delete from rawaa_store.marketing_preference_events as events
  using expired
  where events.event_id = expired.event_id;

  get diagnostics redacted = row_count;
  return redacted;
end;
$function$;

revoke all on function rawaa_store.redact_expired_marketing_preference_events(integer) from public, anon, authenticated;
grant execute on function rawaa_store.redact_expired_marketing_preference_events(integer) to service_role;
