-- Rollback for 003_order_rate_limit.sql only. Drops rate-limit state; orders and the
-- notification outbox (001) are untouched. Safe to run at any time after 003 applied.
drop index if exists rawaa_store.order_rate_limit_expiry_idx;
drop table if exists rawaa_store.order_rate_limit;
