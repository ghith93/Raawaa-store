// v2 is the local 90-day proposal; public UI wording still requires approval.
const CONSENT_VERSION = 'rawaa-marketing-opt-in-v2';
const PHONE_DOMAIN = 'rawaa:marketing-phone:v1\0';
const PHONE_FORMAT = /^\+[1-9]\d{7,14}$/;
// Conservative local proposal: consent is eligible for manual outreach for 90 days.
// This is not a legal determination or live policy; obtain owner/legal review first.
const CONSENT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const SAFE_TIME = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));

/** Normalize supported Syrian local, international, and Arabic-Indic phone notation. */
export function normalizeMarketingPhone(input, defaultCountryCode = '963') {
  if (typeof input !== 'string' || input.length > 40 || !/^\+?[0-9٠-٩۰-۹ ()-]+$/.test(input.trim())) return null;
  const ascii = input.trim().replace(/[٠-٩۰-۹]/g, digit => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
  const plus = ascii.startsWith('+');
  let digits = ascii.replace(/\D/g, '');
  let normalized;
  if (plus) normalized = '+' + digits;
  else if (digits.startsWith('00')) normalized = '+' + digits.slice(2);
  else if (digits.startsWith(defaultCountryCode)) normalized = '+' + digits;
  else if (digits.startsWith('0')) normalized = '+' + defaultCountryCode + digits.slice(1);
  else return null;
  return PHONE_FORMAT.test(normalized) ? normalized : null;
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Private preference service. The repository contract accepts only an HMAC phone key,
 * never a raw phone, for immutable events. Persistence and deployment are separately
 * gated; every eligibility lookup fails closed.
 */
export function createMarketingPreferenceService({ repository, hmacSecret, cryptoImpl = globalThis.crypto, now = Date.now }) {
  if (typeof repository?.appendEvent !== 'function' || typeof repository?.latestEvent !== 'function' ||
      typeof hmacSecret !== 'string' || new TextEncoder().encode(hmacSecret).length < 32 ||
      typeof cryptoImpl?.subtle?.importKey !== 'function' || typeof cryptoImpl?.subtle?.sign !== 'function' ||
      typeof now !== 'function') throw new Error('INVALID_CONFIGURATION');

  let keyPromise;
  async function phoneKey(rawPhone) {
    const phone = normalizeMarketingPhone(rawPhone);
    if (!phone) return null;
    keyPromise ||= cryptoImpl.subtle.importKey('raw', new TextEncoder().encode(hmacSecret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const key = await keyPromise;
    const message = new TextEncoder().encode(PHONE_DOMAIN + phone);
    return hex(await cryptoImpl.subtle.sign('HMAC', key, message));
  }
  function timestamp() {
    const value = new Date(now());
    if (!Number.isFinite(value.getTime())) throw new Error('CLOCK_UNAVAILABLE');
    return value.toISOString();
  }
  async function append(rawPhone, event, consentVersion, source) {
    const key = await phoneKey(rawPhone);
    if (!key) return { recorded: false, reason: 'invalid_phone' };
    const at = timestamp();
    await repository.appendEvent({ phoneKey: key, event, consentVersion, source, occurredAt: at });
    return { recorded: true, event, occurredAt: at };
  }
  return Object.freeze({
    /** Explicit opt-in only; false/missing never creates a subscription event. */
    async recordOptIn({ phone, explicitConsent, consentVersion }) {
      if (explicitConsent !== true) return { recorded: false, reason: 'no_opt_in' };
      if (consentVersion !== CONSENT_VERSION) return { recorded: false, reason: 'invalid_consent_version' };
      try { return await append(phone, 'opt_in', CONSENT_VERSION, 'order_form'); }
      catch { return { recorded: false, reason: 'unavailable' }; }
    },
    /** Owner-verified request; the public customer never calls this API directly. */
    async recordWithdrawal({ phone, ownerAuthorized }) {
      if (ownerAuthorized !== true) return { recorded: false, reason: 'unauthorized' };
      const key = await phoneKey(phone);
      if (!key) return { recorded: false, reason: 'invalid_phone' };
      const at = timestamp();
      await repository.appendEvent({ phoneKey: key, event: 'withdrawal', consentVersion: null, source: 'owner_withdrawal', occurredAt: at });
      return { recorded: true, event: 'withdrawal', occurredAt: at };
    },
    /** Only an explicit current opt-in as the latest event can pass. Errors deny. */
    async canReceiveManualMarketing(phone) {
      try {
        const key = await phoneKey(phone);
        if (!key) return false;
        const event = await repository.latestEvent(key);
        const nowMs = new Date(now()).getTime();
        const eventMs = SAFE_TIME(event?.occurredAt) ? Date.parse(event.occurredAt) : NaN;
        return Boolean(Number.isFinite(nowMs) && event && event.phoneKey === key && event.event === 'opt_in' &&
          event.consentVersion === CONSENT_VERSION && event.source === 'order_form' &&
          Number.isFinite(eventMs) && eventMs <= nowMs && nowMs - eventMs < CONSENT_MAX_AGE_MS);
      } catch { return false; }
    }
  });
}

export { CONSENT_VERSION as MARKETING_CONSENT_VERSION };
