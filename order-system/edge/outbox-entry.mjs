// Deployed scheduler entrypoint. No secrets are embedded; the caller authenticates
// with a dedicated high-entropy secret held outside this repository.
import postgres from 'npm:postgres@3.4.7';
import { createEdgeOutbox } from '../edge-outbox-runtime.mjs';
const handler = createEdgeOutbox({ getEnv: key => Deno.env.get(key), postgresFactory: postgres });
Deno.serve(handler);
