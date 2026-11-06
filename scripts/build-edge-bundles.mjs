#!/usr/bin/env node
/**
 * يبني حزم Edge المرافقة للفرع بأمر واحد ورايات موحّدة.
 *
 * لماذا هذا الملف؟ كانت كل حزمة تُبنى يدويًا برايات مختلفة، فانحرفت حزمتان عن
 * مصادرهما بصمت: `outbox` كانت تسحب محرك التسعير عبر استيراد غير معزول، و
 * `telegram-test` بُنيت بلا `--charset=utf8` فتضخّمت بترميز الهروب العربي.
 * البناء الموحّد + بوابة `git diff` في CI يجعلان الانحراف فشلًا ظاهرًا لا صامتًا.
 *
 * التشغيل: node scripts/build-edge-bundles.mjs [--check]
 *   --check : يعيد البناء ثم يفشل إذا اختلفت أي حزمة ملتزَمة (بلا كتابة فوق الملفات).
 *
 * حزمة استقبال الطلبات لها أمرها الخاص (`npm run build:order`) لأنها تولّد بصمة
 * الإعدادات أولًا؛ هذا السكربت يبني الأربع الأخرى فقط.
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const check = process.argv.includes('--check');
const names = ['outbox', 'owner', 'telegram-pairing', 'telegram-test'];
// رايات موحّدة لكل الحزم. أي تغيير هنا يجب أن يرافقه إعادة بناء كل الحزم.
const flags = ['--bundle', '--format=esm', '--minify', '--charset=utf8', '--external:npm:postgres@3.4.7'];
const temp = await mkdtemp(join(tmpdir(), 'rawaa-edge-'));
const drifted = [];
try {
  for (const name of names) {
    const entry = `order-system/edge/${name}-entry.mjs`;
    const target = `order-system/edge/${name}-bundle.mjs`;
    const out = join(temp, `${name}.mjs`);
    execFileSync('npx', ['--yes', 'esbuild@0.27.3', entry, ...flags, `--outfile=${out}`], { cwd: root, stdio: 'pipe' });
    const built = await readFile(out, 'utf8');
    // الحزمة سطح نشر فعلي: لا أسرار، ولا استيراد خارج postgres، ومخرج واحد.
    if (/\d{6,}:[A-Za-z0-9_-]{20,}/.test(built)) throw new Error(`${name}: bot-token-shaped literal`);
    if (/eyJ[A-Za-z0-9_-]{10,}/.test(built)) throw new Error(`${name}: jwt-shaped literal`);
    if (/BEGIN [A-Z ]*PRIVATE KEY/.test(built)) throw new Error(`${name}: private key block`);
    const imports = [...built.matchAll(/from\s*["']([^"']+)["']/g)].map(m => m[1]);
    if (imports.some(i => i !== 'npm:postgres@3.4.7')) throw new Error(`${name}: unexpected import ${imports.join(', ')}`);
    if ((built.match(/Deno\.serve\(/g) || []).length !== 1) throw new Error(`${name}: expected exactly one Deno.serve`);
    execFileSync(process.execPath, ['--check', out], { stdio: 'pipe' });

    const current = await readFile(new URL(target, root), 'utf8').catch(() => '');
    if (current !== built) {
      drifted.push(name);
      if (!check) await writeFile(new URL(target, root), built, 'utf8');
    }
    console.log(`  ${name}: ${Buffer.byteLength(built)} بايت${current === built ? ' · مطابق' : check ? ' · منحرف' : ' · أُعيد بناؤه'}`);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}

if (check && drifted.length) {
  console.error(`✗ حزم منحرفة عن مصادرها: ${drifted.join(', ')}`);
  console.error('  شغّل: npm run build:edge ثم أضف الناتج إلى الالتزام.');
  process.exit(1);
}
console.log(check ? '✓ كل الحزم مطابقة لمصادرها' : '✓ تم بناء حزم Edge');
