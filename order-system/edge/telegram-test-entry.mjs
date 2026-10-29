import postgres from 'npm:postgres@3.4.7';
import {createEdgeTelegramTest} from '../edge-test-runtime.mjs';
Deno.serve(createEdgeTelegramTest({getEnv:key=>Deno.env.get(key),postgresFactory:postgres}));
