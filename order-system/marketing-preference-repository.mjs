const PHONE_KEY = /^[0-9a-f]{64}$/;
const VERSION = /^[A-Za-z0-9._-]{1,120}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Private PostgreSQL adapter. It accepts keyed events only; raw phone values are never queried or stored here. */
export function createPostgresMarketingPreferenceRepository(db) {
  if (typeof db?.query !== 'function') throw new Error('INVALID_CONFIGURATION');

  return Object.freeze({
    async appendEvent(event) {
      if (!event || typeof event !== 'object' || !PHONE_KEY.test(event.phoneKey) ||
          !['opt_in', 'withdrawal'].includes(event.event) ||
          (event.event === 'opt_in' && (typeof event.consentVersion !== 'string' || !VERSION.test(event.consentVersion) || event.source !== 'order_form')) ||
          (event.event === 'withdrawal' && (event.consentVersion !== null || event.source !== 'owner_withdrawal')) ||
          !TIME.test(event.occurredAt) || !Number.isFinite(Date.parse(event.occurredAt))) {
        throw new Error('INVALID_EVENT');
      }
      const result = await db.query(
        `insert into rawaa_store.marketing_preference_events
          (phone_key, event, consent_version, source, occurred_at)
         values ($1, $2, $3, $4, $5::timestamptz)
         returning event_id`,
        [event.phoneKey, event.event, event.consentVersion, event.source, event.occurredAt]
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1 || !Number.isInteger(Number(result.rows[0]?.event_id))) {
        throw new Error('PREFERENCE_UNAVAILABLE');
      }
      return { eventId: Number(result.rows[0].event_id) };
    },

    async latestEvent(phoneKey) {
      if (typeof phoneKey !== 'string' || !PHONE_KEY.test(phoneKey)) throw new Error('INVALID_PHONE_KEY');
      const result = await db.query(
        `select phone_key as "phoneKey", event, consent_version as "consentVersion", source,
          to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "occurredAt"
         from rawaa_store.marketing_preference_events
         where phone_key = $1
         order by event_id desc
         limit 1`,
        [phoneKey]
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length > 1) throw new Error('PREFERENCE_UNAVAILABLE');
      return result.rows[0] || null;
    }
  });
}
