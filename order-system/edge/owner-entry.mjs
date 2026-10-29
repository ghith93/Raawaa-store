// Deployed edge entrypoint. No secrets or owner identity are embedded.
import postgres from 'npm:postgres@3.4.7';
import { createEdgeOwner } from '../edge-owner-runtime.mjs';
const handler = createEdgeOwner({ getEnv: key => Deno.env.get(key), postgresFactory: postgres });
Deno.serve(handler);
