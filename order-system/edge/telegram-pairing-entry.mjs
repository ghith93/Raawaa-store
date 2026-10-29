// Staged entrypoint. Never log requests, environment, database or Telegram payloads.
import postgres from 'npm:postgres@3.4.7';
import { createEdgePairing } from '../edge-pairing-runtime.mjs';
const handler = createEdgePairing({getEnv:key=>Deno.env.get(key),postgresFactory:postgres});
Deno.serve(handler);
