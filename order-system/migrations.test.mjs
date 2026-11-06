import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';

const migration = await readFile(new URL('./migrations/004_order_retention.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('./migrations/004_order_retention.down.sql', import.meta.url), 'utf8');
const preferences = await readFile(new URL('./migrations/005_marketing_preference_events.sql', import.meta.url), 'utf8');
const preferencesRollback = await readFile(new URL('./migrations/005_marketing_preference_events.down.sql', import.meta.url), 'utf8');
const pgliteIntegration = await readFile(new URL('./marketing-preferences-pg-test.mjs', import.meta.url), 'utf8');
const ciWorkflow = await readFile(new URL('../.github/workflows/site-checks.yml', import.meta.url), 'utf8');
const supabaseLocalScript = await readFile(new URL('../scripts/test-marketing-supabase-local.sh', import.meta.url), 'utf8');
const supabaseLocalTests = await readFile(new URL('./marketing-preferences-supabase-test.sql', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const localSupabaseWorkflow = await readFile(new URL('../.github/workflows/local-supabase.yml', import.meta.url), 'utf8');
const ownerSetupHtml = await readFile(new URL('../setup.html', import.meta.url), 'utf8');
const lifecycle = await readFile(new URL('./migrations/006_order_closed_at.sql', import.meta.url), 'utf8');
const lifecycleRollback = await readFile(new URL('./migrations/006_order_closed_at.down.sql', import.meta.url), 'utf8');
const chainIntegration = await readFile(new URL('./retention-chain-pg-test.mjs', import.meta.url), 'utf8');

test('retention source matches the already-applied staging migration and remains bounded/private', () => {
  assert.match(migration, /20261030134505\/rawaa_order_retention/);
  assert.match(migration, /closed_at < now\(\) - interval '365 days'/);
  assert.match(migration, /batch_limit < 1 or batch_limit > 500/);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /details - array\['name', 'phone', 'address'\]/);
  assert.match(migration, /request_hash = null/);
  assert.match(migration, /idempotency_key = null/);
  assert.match(migration, /revoke all .* from public, anon, authenticated/i);
  assert.match(migration, /grant execute .* to service_role/i);
  assert.doesNotMatch(migration, /create\s+table|insert\s+into/i);
});

test('retention rollback removes only the function, never order or outbox data', () => {
  assert.match(rollback, /drop function if exists rawaa_store\.redact_expired_order_contacts\(integer\)/i);
  assert.doesNotMatch(rollback, /drop\s+table|delete\s+from|truncate/i);
  assert.match(rollback, /do not run here/i);
});

test('marketing preference schema stores only a keyed digest, is private, and has bounded expiry', () => {
  assert.match(preferences, /phone_key text not null check \(phone_key ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(preferences, /event in \('opt_in', 'withdrawal'\)/);
  assert.match(preferences, /alter table rawaa_store\.marketing_preference_events enable row level security/i);
  assert.match(preferences, /revoke all .* from public, anon, authenticated/i);
  assert.match(preferences, /grant select, insert on rawaa_store\.marketing_preference_events to service_role/i);
  assert.doesNotMatch(preferences, /grant [^;]*delete on rawaa_store\.marketing_preference_events to service_role/i);
  assert.match(preferences, /security definer/i);
  assert.match(preferences, /occurred_at < now\(\) - interval '365 days'/);
  assert.match(preferences, /batch_limit < 1 or batch_limit > 500/);
  assert.match(preferences, /for update skip locked/i);
  assert.doesNotMatch(preferences, /phone\s+text|raw_phone|insert\s+into[^;]*phone\s*[,)]/i);
  assert.match(preferencesRollback, /drop table if exists rawaa_store\.marketing_preference_events/i);
  assert.match(preferencesRollback, /irreversibly lost/i);
});

test('candidate migration has a PGlite integration test enrolled in the existing isolated CI job', () => {
  assert.match(pgliteIntegration, /create role anon/);
  assert.match(pgliteIntegration, /db\.exec\(migration\)/);
  assert.match(pgliteIntegration, /await db\.exec\(rollback\)/);
  assert.match(ciWorkflow, /@electric-sql\/pglite@0\.3\.14/);
  assert.match(ciWorkflow, /order-system\/\*-pg-test\.mjs/);
  assert.match(pgliteIntegration, /marketing_preference_events/);
  assert.doesNotMatch(pgliteIntegration, /fetch\(|https?:\/\//i);
});

test('local Supabase CLI harness is temporary, explicitly local, and never links to a hosted project', () => {
  assert.equal(packageJson.scripts['test:marketing:supabase-local'], 'bash scripts/test-marketing-supabase-local.sh');
  assert.match(supabaseLocalScript, /mktemp -d/);
  assert.match(supabaseLocalScript, /supabase start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor/);
  assert.match(supabaseLocalScript, /supabase db reset --local/);
  assert.match(supabaseLocalScript, /supabase test db --local/);
  assert.match(supabaseLocalScript, /supabase stop/);
  assert.match(supabaseLocalScript, /docker info/);
  assert.doesNotMatch(supabaseLocalScript, /supabase link|supabase (?:db reset|test db) --linked|\.supabase\.co|RAWAA_.*TOKEN/i);
  // السلوك لا اسم ملف: الفحص كان يطبّق 005 وحدها على مخطط صناعي فيمرّ بينما
  // السلسلة الحقيقية تنكسر. الآن يجب أن يُصطفّ كل ملف هجرة بالترتيب.
  assert.match(supabaseLocalScript, /order-system\/migrations\/\[0-9\]\[0-9\]\[0-9\]_\*\.sql/);
  assert.match(supabaseLocalScript, /\*\.down\.sql\) continue/);
  assert.doesNotMatch(supabaseLocalScript, /create schema rawaa_store/, 'no synthetic bootstrap schema: 001 creates it');
  const chainCount = Number(/-lt (\d+)/.exec(supabaseLocalScript)?.[1]);
  const migrationFiles = readdirSync(new URL('./migrations/', import.meta.url))
    .filter((name) => /^\d{3}_.*\.sql$/.test(name) && !name.endsWith('.down.sql'));
  assert.equal(chainCount, migrationFiles.length, 'the harness must require every checked-in migration');
  assert.match(supabaseLocalTests, /select plan\(18\)/);
  assert.match(supabaseLocalTests, /select \* from finish\(\)/);
  assert.match(supabaseLocalTests, /rollback;/i);
  assert.match(supabaseLocalTests, /redact_expired_marketing_preference_events\(1\)/);
});

test('owner setup generates secrets locally and no longer calls the retired identity probe', async () => {
  assert.match(ownerSetupHtml, /crypto\.getRandomValues/);
  assert.doesNotMatch(ownerSetupHtml, /rawaa-header-probe|fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/i);
  await assert.rejects(readFile(new URL('../.github/workflows/identity-header-probe.yml', import.meta.url)), { code: 'ENOENT' });
  await assert.rejects(readFile(new URL('./edge/owner-setup-page.mjs', import.meta.url)), { code: 'ENOENT' });
});

test('hosted Supabase probe runs reviewed main code only with read-only access and pinned CLI', () => {
  assert.match(localSupabaseWorkflow, /branches:\s*\n\s*- main/);
  assert.match(localSupabaseWorkflow, /workflow_dispatch:/);
  assert.match(localSupabaseWorkflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(localSupabaseWorkflow, /runs-on: ubuntu-24\.04/);
  assert.match(localSupabaseWorkflow, /uses: supabase\/setup-cli@[0-9a-f]{40} # v3/);
  assert.match(localSupabaseWorkflow, /version: 2\.122\.0/);
  assert.match(localSupabaseWorkflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(localSupabaseWorkflow, /runs-on: \[?self-hosted|pull_request:|workflow_run:|secrets\./i);
  assert.match(localSupabaseWorkflow, /npm run test:marketing:supabase-local/);
});

// 004 يعتمد closed_at الذي لا ينشئه 001، ويُفرغ عمودين NOT NULL. الأصل إصلاح
// ذلك بهجرة لاحقة لا بتعديل 004 المطبَّقة على staging والمنصوص عليها أعلاه.
test('lifecycle repair ships as a new forward migration and leaves the applied 004 untouched', () => {
  assert.match(migration, /closed_at < now\(\) - interval '365 days'/);
  assert.match(lifecycle, /add column if not exists closed_at timestamptz/);
  assert.match(lifecycle, /create trigger orders_set_closed_at/);
  assert.match(lifecycle, /before insert or update of order_status/);
  // لا نخمّن وقت إغلاق قديمًا قد يقصّر نافذة الاحتفاظ قبل انقضائها فعلًا.
  assert.match(lifecycle, /set closed_at = now\(\)/);
  assert.doesNotMatch(lifecycle, /set closed_at = created_at/);
  // Relaxation must stay paired with a guard, never a bare drop.
  assert.match(lifecycle, /alter column request_hash drop not null/);
  assert.match(lifecycle, /alter column idempotency_key drop not null/);
  assert.match(lifecycle, /orders_identifiers_present_until_redacted/);
  assert.match(lifecycle, /revoke all on function rawaa_store\.set_order_closed_at\(\) from public, anon, authenticated/);
  assert.doesNotMatch(lifecycle, /drop table|truncate|delete from/i);
});

test('lifecycle rollback removes only its own objects and restores the identifier invariant', () => {
  assert.match(lifecycleRollback, /drop trigger if exists orders_set_closed_at/);
  assert.match(lifecycleRollback, /drop function if exists rawaa_store\.set_order_closed_at\(\)/);
  assert.match(lifecycleRollback, /drop column if exists closed_at/);
  assert.match(lifecycleRollback, /alter column request_hash set not null/);
  assert.match(lifecycleRollback, /alter column idempotency_key set not null/);
  assert.doesNotMatch(lifecycleRollback, /drop table|truncate|delete from/i);
});

test('full migration chain is exercised together so a missing column cannot pass CI again', () => {
  // كل اختبار ميزة كان يطبّق الهجرات التي يحتاجها فقط، فلم تُجرَّب 001..005 معًا.
  assert.match(chainIntegration, /readdir/);
  assert.match(chainIntegration, /\.sort\(\)/);
  assert.match(chainIntegration, /!name\.endsWith\('\.down\.sql'\)/);
  assert.match(chainIntegration, /redact_expired_order_contacts/);
  assert.match(chainIntegration, /PGLITE_MODULE/);
  assert.doesNotMatch(chainIntegration, /fetch\(|https?:\/\//i);
  // CI يكتشف الملفات بالـglob، فيلتقط هذا الاختبار دون تسجيل يدوي.
  assert.match(ciWorkflow, /order-system\/\*-pg-test\.mjs/);
});

test('CI fails on a stale or corrupt committed intake bundle instead of silently rebuilding it', () => {
  assert.match(ciWorkflow, /node scripts\/build-order-entry\.mjs/);
  assert.match(ciWorkflow, /node --check order-system\/edge\/order-entry-bundle\.mjs/);
  assert.match(ciWorkflow, /git diff --exit-code -- order-system\/edge\/order-entry-bundle\.mjs/);
});
