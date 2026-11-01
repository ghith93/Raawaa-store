// Local staged owner-only entrypoint; not deployed. Requires migration 005 and a
// dedicated RAWAA_MARKETING_HMAC_KEY. Never embed secrets or customer identifiers.
import postgres from 'npm:postgres@3.4.7';
import { createEdgeMarketingPreferences } from '../edge-marketing-preferences-runtime.mjs';

const handler = createEdgeMarketingPreferences({
  getEnv: key => Deno.env.get(key),
  postgresFactory: postgres
});

Deno.serve(handler);
