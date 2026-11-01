-- LOCAL CANDIDATE ROLLBACK ONLY. Not applied to staging.
-- This removes the preference-event store and its bounded cleanup routine, so all
-- stored opt-in/withdrawal digests are irreversibly lost. Export nothing; use only
-- after deciding that marketing eligibility must be disabled and preserving the
-- audit/retention requirements is no longer necessary.
drop function if exists rawaa_store.redact_expired_marketing_preference_events(integer);
drop table if exists rawaa_store.marketing_preference_events;
