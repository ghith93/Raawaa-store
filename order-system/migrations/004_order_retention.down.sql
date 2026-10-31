-- Rollback for 004_order_retention.sql in a fresh environment only.
-- Staging already has this routine under migration 20261030134505; do not run here.
-- This removes only the function and never touches orders or their data.
drop function if exists rawaa_store.redact_expired_order_contacts(integer);
