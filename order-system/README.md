# Order system — work in progress

Not connected to the store and not suitable for real orders yet. The owner edge function is deployed for staging. Never put credentials or customer records in this directory. All tests use synthetic data. The SQL migration was applied to a private staging schema in Ghaioooth-core (20261029220654); tables are empty and are not exposed by the REST schema configuration. Do not apply it again there. Production use still requires review of retention, security, access model, failure handling and pricing.

Run the zero-dependency unit tests:

```sh
node --test order-system/*.test.mjs
```

To run the local, ephemeral PostgreSQL integration checks, install the pinned test-only PGlite outside the tracked tree and point to its module:

```sh
npm install --prefix .cache/rawaa-pgtest --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
PGLITE_MODULE="$PWD/.cache/rawaa-pgtest/node_modules/@electric-sql/pglite/dist/index.js" node order-system/schema-pg-test.mjs
PGLITE_MODULE="$PWD/.cache/rawaa-pgtest/node_modules/@electric-sql/pglite/dist/index.js" node order-system/repository-pg-test.mjs
PGLITE_MODULE="$PWD/.cache/rawaa-pgtest/node_modules/@electric-sql/pglite/dist/index.js" node order-system/outbox-pg-test.mjs
PGLITE_MODULE="$PWD/.cache/rawaa-pgtest/node_modules/@electric-sql/pglite/dist/index.js" node order-system/pagination-pg-test.mjs
```

These tests emulate roles and a local PostgreSQL database; they do not verify a real Supabase project's settings, network, permissions, concurrency, production credentials, Telegram, or notification delivery. The integration scripts are also configured for CI; CI results are not available until the workflow runs.

The persistence adapter requires a trusted server-side database driver and read-committed transactions. The owner dashboard and owner-only API are deployed for staging; the owner reports successful sign-in. An authenticated real order display has not been tested. Local browser tests used synthetic network responses; no iPhone browser test was performed. The customer order endpoint and outbox scheduler are not deployed.

The staged `order-http.mjs` requires explicit consent, bounded requests, a server-verified challenge and an injected distributed rate limiter; a PostgreSQL rate limiter has been prototyped locally, but no trusted client identity adapter or cleanup scheduler is configured. The owner provided a public Turnstile sitekey and saved a secret in Supabase; no live widget, verification test, or public endpoint is enabled. A failed save response is deliberately treated as uncertain; re-use the same idempotency key with a fresh challenge token. The scheduler is still required to process a saved pending outbox row after a lost response.

`telegram-pairing.mjs` is deployed as an owner-only staging function with private storage and an owner UI. The owner confirmed pairing and receipt of a live test message, and a stored recipient and consumed challenge were independently verified. No actual order alert has been tested. The owner-only test endpoint and button are deployed; the owner confirmed receiving its test message. Never use the first incoming message as proof of ownership.

`postgres-rate-limiter.mjs` is local-only. It stores HMAC identities, caps requests atomically, and needs a strong independent secret, a trustworthy canonical client identity from the deployment platform, and scheduled cleanup. Never trust arbitrary X-Forwarded-For headers. The 10-attempt/15-minute prototype also requires tuning for shared networks before launch.

`outbox-batch.mjs` is a local, bounded batch runner; it does not itself schedule jobs, and is not deployed. It fails closed on an absent recipient and avoids auto-retrying unknown deliveries.

`customer-order-client.mjs` is a local prototype only. It stores only an opaque idempotency key in session storage and requires a new challenge for each retry. After reload, re-entering the same details reuses that key; closing the tab or clearing browser data can still lose it. The customer UI and those remaining recovery cases must be addressed before enabling it.

`turnstile-controller.mjs` is a local adapter tested with a mocked widget. Tokens are held only in memory, cleared on expiration, consumed once, and never logged. The actual sitekey/secret and hostname have not yet been verified together with Cloudflare.

`edge-order-runtime.mjs` composes the staged order handler, server-side validation, rate limiter and private database adapter. It deliberately refuses configuration without an injected trusted identity provider and leaves notification jobs pending for a scheduler. It is not deployed; no production trusted identity, scheduler or customer form has been enabled.

`edge-outbox-runtime.mjs` and `outbox-scheduler-api.mjs` are staged only: a dedicated high-entropy secret gates bounded batch processing. No scheduler secret, function or cron job is deployed. Supabase notes that pg_net queues can temporarily expose request headers to database login roles, so shared-project permissions and isolated secret design require review before scheduling.

`customer-checkout-flow.mjs` is a staged orchestration layer: it requires consent and a fresh challenge for each attempt, and never masks a confirmed save if a widget reset fails. It is not wired to a customer UI.

`end-to-end-pg-test.mjs` exercises mocked challenge, lost confirmation, reload/retry, a bounded outbox run, mock Telegram, and an owner-authorized view on ephemeral PostgreSQL. This is not a live integration test.

For a local, AST-only architecture scan using Graphify, see `docs/GRAPHIFY-AR.md`. The graph is not a substitute for runtime verification.
