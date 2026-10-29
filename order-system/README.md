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

The staged `order-http.mjs` requires explicit consent, bounded requests, a server-verified challenge and an injected distributed rate limiter; no production rate limiter, Turnstile widget/secret or public endpoint is configured. A failed save response is deliberately treated as uncertain; re-use the same idempotency key with a fresh challenge token. The scheduler is still required to process a saved pending outbox row after a lost response.

`telegram-pairing.mjs` is deployed as an owner-only staging function with private storage and an owner UI. The owner confirmed pairing, and a stored recipient and consumed challenge were independently verified. No live Telegram message has been sent. The owner-only test endpoint is deployed, and its button is staged locally; no real message has been sent or confirmed. Never use the first incoming message as proof of ownership.
