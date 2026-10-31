-- Source reconstructed from the live Ghaioooth-core catalog on 2026-10-31.
-- Supabase migration history records this as 20261030134505/rawaa_order_retention.
-- It is ALREADY applied in staging: do not re-apply or create a duplicate migration there.
-- This checked-in copy restores source-of-truth parity for review and local testing.
--
-- The routine only redacts identifiers on orders closed more than 365 days ago.
-- Batch size is bounded; SKIP LOCKED makes concurrent calls safe. It does not
-- disclose row counts to callers except to the trusted scheduler adapter.
create or replace function rawaa_store.redact_expired_order_contacts(batch_limit integer default 100)
returns integer
language plpgsql
set search_path to pg_catalog, rawaa_store
as $function$
declare
  redacted integer;
begin
  if batch_limit is null or batch_limit < 1 or batch_limit > 500 then
    raise exception 'INVALID_BATCH_LIMIT';
  end if;

  with expired as (
    select id
    from rawaa_store.orders
    where closed_at < now() - interval '365 days'
      and (details ?| array['name', 'phone', 'address'] or request_hash is not null or idempotency_key is not null)
    order by closed_at, id
    limit batch_limit
    for update skip locked
  )
  update rawaa_store.orders as orders
  set details = orders.details - array['name', 'phone', 'address'],
      request_hash = null,
      idempotency_key = null
  from expired
  where orders.id = expired.id;

  get diagnostics redacted = row_count;
  return redacted;
end;
$function$;

revoke all on function rawaa_store.redact_expired_order_contacts(integer) from public, anon, authenticated;
grant execute on function rawaa_store.redact_expired_order_contacts(integer) to service_role;
