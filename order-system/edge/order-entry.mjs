// Staged customer-intake entrypoint. NOT deployed, and deployment stays gated on:
//   1) the live identity probe result (button in the owner setup page, COPY-PASTE.md)
//      confirming that cf-connecting-ip cannot be spoofed on this deployment;
//   2) the owner creating RAWAA_RATE_LIMIT_HMAC_KEY (>=32 chars) in Supabase secrets;
//   3) the gradual-rollout checklist in docs/RAWAA-AUTOMATION-MASTER-PLAN-AR.md (M1).
// The store config is inlined at bundle time from js/config.js so prices are always
// recomputed server-side from the single trusted source, never from client input.
import postgres from 'npm:postgres@3.4.7';
import { createEdgeOrder } from '../edge-order-runtime.mjs';
import { createClientIdentity } from '../client-identity.mjs';
import { RAWAA_STORE_CONFIG, RAWAA_CONFIG_HASH } from './store-config.generated.mjs';

// Baseline header evidence (2026-10-30) points to cf-connecting-ip; the forged
// header probe must confirm it before this entry is ever deployed. IPv6 callers
// share a /64 bucket so one household network cannot mint fresh limit keys.
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
