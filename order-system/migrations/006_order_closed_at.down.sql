-- LOCAL CANDIDATE ROLLBACK ONLY. Not applied to staging.
--
-- Removes the lifecycle column, its trigger, and the relaxed identifier rules.
-- Rolling back requires every surviving order to still carry both identifiers;
-- if any row was already redacted by 004, restoring NOT NULL will fail closed
-- rather than silently inventing values. That is intentional: exported/redacted
-- identifiers cannot be reconstructed, so resolve those rows explicitly first.
drop index if exists rawaa_store.orders_closed_at_idx;

alter table rawaa_store.orders
  drop constraint if exists orders_identifiers_present_until_redacted;

drop trigger if exists orders_set_closed_at on rawaa_store.orders;
drop function if exists rawaa_store.set_order_closed_at();

alter table rawaa_store.orders
  alter column request_hash set not null,
  alter column idempotency_key set not null;

alter table rawaa_store.orders
  drop column if exists closed_at;
