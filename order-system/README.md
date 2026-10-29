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

The persistence adapter requires an explicit trusted server-side driver exposing `transaction(callback)` and `tx.query(sql, values)` at read committed isolation; PGlite is currently only a local test implementation. A staged worker can atomically claim jobs and mark expired leases unknown; it is not connected to a scheduler or the live service. No automatic retry exists yet; the owner interface is deployed for testing but owner reports successful login, but a real order display has not yet been tested. Security and monitoring still need implementation. Client prices must never be treated as trusted. The `owner-preview/` static demo displays synthetic orders only and is never included in the storefront build. `owner-app/` is a disabled local fixture. The deployable `owner/` version is configured for the live staging service and only enables login on the approved production origin; its authenticated live path has not been tested. Local browser tests used synthetic network responses. Mobile layout and accessibility were checked locally in Chromium, not on an actual iPhone. The Supabase edge function `rawaa-owner-orders` is deployed in staging with JWT verification on and configured for the confirmed owner and production origin; an unauthenticated request was rejected by the gateway. Its Deno bundle fails closed locally without configuration; no authenticated live owner test has been run. Real owner and database connectivity are not verified. A staged owner API checks a server-verified identity and rejects unapproved origins; the live authentication provider, server deployment and database are not wired. The staged interface can page through the API when configured; it is not production-ready. No functional customer order endpoint is deployed.

The staged `order-http.mjs` requires explicit consent, bounded requests, a server-verified challenge and an injected distributed rate limiter; no production rate limiter, Turnstile widget/secret or public endpoint is configured. A failed save response is deliberately treated as uncertain; re-use the same idempotency key with a fresh challenge token. The scheduler is still required to process a saved pending outbox row after a lost response.

`telegram-pairing.mjs` is a local prototype: its repository must atomically validate the one-time code and bind the private Telegram chat. It has no production storage, owner UI, deployment, or real Telegram test. Never use the first incoming message as proof of ownership.
