// Staged customer-intake entrypoint. NOT deployed. The live server-side gateway probe
// (2026-10-30) sent 8.8.8.8 as CF-Connecting-IP and got HTTP 403; X-Forwarded-For was
// overwritten, X-Real-IP was absent, and True-Client-IP accepted the synthetic value.
// Therefore use only cf-connecting-ip; never trust the other client-supplied headers.
// The owner has provisioned RAWAA_RATE_LIMIT_HMAC_KEY in Supabase (its value is not read
// into this repository/session). Deployment remains gated on privacy review, approved
// migration 005 and HMAC-key setup, a customer UI wired to the optional consent result,
// deployed/tested retention scheduling, rebuilding this entry bundle, and synthetic
// staging end-to-end tests.
// The store config is inlined at bundle time from js/config.js so prices are always
// recomputed server-side from the single trusted source, never from client input.
import postgres from 'npm:postgres@3.4.7';
import { createEdgeOrder } from '../edge-order-runtime.mjs';
import { createClientIdentity } from '../client-identity.mjs';
import { RAWAA_STORE_CONFIG, RAWAA_CONFIG_HASH } from './store-config.generated.mjs';

// Gateway overwrite/rejection behavior was verified via a server-side probe.
// IPv6 callers share a /64 bucket so one household network cannot mint fresh limit keys.
const identity = createClientIdentity({
  mode: 'platform-header',
  header: 'cf-connecting-ip',
  ipv6GroupBits: 64
});

if (!RAWAA_CONFIG_HASH) throw new Error('STALE_CONFIG');

const handler = createEdgeOrder({
  getEnv: key => Deno.env.get(key),
  postgresFactory: postgres,
  getTrustedIdentity: identity.getTrustedIdentity,
  config: RAWAA_STORE_CONFIG
});

Deno.serve(handler);
