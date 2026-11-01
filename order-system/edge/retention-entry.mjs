// Staged entrypoint for the owner-authorized daily retention task. No secrets are embedded.
import postgres from 'npm:postgres@3.4.7';
import { createEdgeRetention } from '../edge-retention-runtime.mjs';

const handler = createEdgeRetention({
  getEnv: key => Deno.env.get(key),
  postgresFactory: postgres
});
Deno.serve(handler);
