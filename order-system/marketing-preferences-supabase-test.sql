-- pgTAP contract tests for the isolated Supabase CLI local stack.
-- All inserted identifiers are synthetic digests; transaction rolls back at end.
begin;
select plan(18);

select has_table('rawaa_store', 'marketing_preference_events', 'candidate migration creates the private preference-event table');
select ok(
  (select relrowsecurity from pg_class where oid = 'rawaa_store.marketing_preference_events'::regclass),
  'row-level security is enabled'
);
select ok(has_table_privilege('service_role', 'rawaa_store.marketing_preference_events', 'select'), 'service_role can read events');
select ok(has_table_privilege('service_role', 'rawaa_store.marketing_preference_events', 'insert'), 'service_role can append events');
select ok(not has_table_privilege('service_role', 'rawaa_store.marketing_preference_events', 'update'), 'service_role cannot update event history');
select ok(not has_table_privilege('service_role', 'rawaa_store.marketing_preference_events', 'delete'), 'service_role cannot delete event history directly');
select ok(not has_table_privilege('anon', 'rawaa_store.marketing_preference_events', 'select'), 'anon cannot read events');
select ok(not has_table_privilege('authenticated', 'rawaa_store.marketing_preference_events', 'insert'), 'authenticated cannot insert events');
select ok(not has_table_privilege('authenticated', 'rawaa_store.marketing_preference_events', 'select'), 'authenticated cannot read events');
select ok(has_function_privilege('service_role', 'rawaa_store.redact_expired_marketing_preference_events(integer)', 'execute'), 'service_role can run bounded cleanup');
select ok(not has_function_privilege('anon', 'rawaa_store.redact_expired_marketing_preference_events(integer)', 'execute'), 'anon cannot run cleanup');
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'rawaa_store'
      and table_name = 'marketing_preference_events'
      and column_name in ('phone', 'phone_number', 'raw_phone', 'normalized_phone')
  ),
  'event table contains no raw phone column'
);

insert into rawaa_store.marketing_preference_events (phone_key, event, consent_version, source)
values
  (repeat('a', 64), 'opt_in', 'rawaa-marketing-opt-in-v2', 'order_form'),
  (repeat('a', 64), 'withdrawal', null, 'owner_withdrawal');
select is(
  (select event from rawaa_store.marketing_preference_events where phone_key = repeat('a', 64) order by event_id desc limit 1),
  'withdrawal'::text,
  'withdrawal is the latest event and overrides opt-in'
);

insert into rawaa_store.marketing_preference_events (phone_key, event, consent_version, source, occurred_at)
values
  (repeat('b', 64), 'opt_in', 'v2', 'order_form', now() - interval '367 days'),
  (repeat('c', 64), 'opt_in', 'v2', 'order_form', now() - interval '366 days'),
  (repeat('d', 64), 'opt_in', 'v2', 'order_form', now());
select is(rawaa_store.redact_expired_marketing_preference_events(1), 1, 'cleanup is bounded to the requested batch size');
select is(
  (select count(*)::integer from rawaa_store.marketing_preference_events where occurred_at < now() - interval '365 days'),
  1,
  'one expired row remains after a one-row cleanup batch'
);
select is(rawaa_store.redact_expired_marketing_preference_events(1), 1, 'next cleanup batch removes the next expired row');
select is(
  (select count(*)::integer from rawaa_store.marketing_preference_events where occurred_at < now() - interval '365 days'),
  0,
  'no expired events remain after both batches'
);
select is(
  (select count(*)::integer from rawaa_store.marketing_preference_events where phone_key = repeat('d', 64)),
  1,
  'non-expired event is preserved'
);

select * from finish();
rollback;
