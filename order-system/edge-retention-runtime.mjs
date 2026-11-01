import { createRetentionSchedulerHandler } from './retention-scheduler-api.mjs';

/** Local staging adapter. The database function already enforces its own bounded batch limit. */
export function createEdgeRetention({ getEnv, postgresFactory }) {
  let databaseUrl;
  let secret;
  try {
    databaseUrl = getEnv('SUPABASE_DB_URL');
    secret = getEnv('RAWAA_RETENTION_SCHEDULER_SECRET');
    if (!databaseUrl || typeof postgresFactory !== 'function') throw new Error('INVALID_CONFIGURATION');
  } catch {
    return () => new Response('{"error":"unavailable"}', {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }

  let sql;
  const connection = () => sql ||= postgresFactory(databaseUrl, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 5
  });
  const runCleanup = async () => {
    const jobs = [
      'select rawaa_store.redact_expired_order_contacts($1)::integer as redacted',
      'select rawaa_store.redact_expired_marketing_preference_events($1)::integer as redacted'
    ];
    for (const sql of jobs) {
      const rows = await connection().unsafe(sql, [500]);
      if (!Array.isArray(rows) || rows.length !== 1 || !Number.isInteger(Number(rows[0]?.redacted))) {
        throw new Error('CLEANUP_UNAVAILABLE');
      }
    }
  };
  return createRetentionSchedulerHandler({ secret, runCleanup });
}
