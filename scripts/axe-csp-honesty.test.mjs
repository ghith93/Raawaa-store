/*
 * حارس: لا فحص إتاحة يعمل في وضع «معطَّل الحماية».
 *
 * القصة: كانت كل أدوات axe تحقن axe-core بـ`page.add_script_tag(content=...)`،
 * أي بعنصر <script> سطري. تحت CSP صارم (script-src 'self') يُرفض ذلك، فكانت
 * الأدوات تلتفّ حول السياسة: `Page.setBypassCSP` في axe-audit، أو حقن بعد
 * التحميل في a11y-audit. النتيجة أن التدقيق كان يجري في **بيئة لا يراها أي
 * زائر**: الحماية معطّلة. فإن كسر CSP الصفحةَ، لم يظهر ذلك في التقرير.
 *
 * القاعدة الآن: axe يُحمَّل كسكربت init **قبل** التنقّل. هذا الفحص يمنع الرجوع
 * إلى أي من الحلّين القديمين، ويؤكد أن كل استدعاء لـaxe يقع بعد هذا التسجيل.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(ROOT, path), 'utf8');

/**
 * يُزيل تعليقات Python قبل الفحص.
 *
 * ضروري: الملفات **توثّق** الطريقة المرفوضة بالاسم (`add_script_tag`,
 * `Page.setBypassCSP`)، ولو فُحص النص الخام لصار الشرح نفسه مخالفة.
 * نحن نفحص الكود المنفَّذ لا وصفه.
 */
function stripPythonComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"""([\s\S]*?)"""/g, '""')
    .replace(/(^|[^:])(#)[^\n]*/g, '$1');
}

const PY_TOOLS = ['scripts/serum-browser-test.py', 'scripts/campaign-browser-test.py',
                  'scripts/a11y-audit.py', 'scripts/axe-audit.py'];

test('لا أداة تُعطّل CSP لتشغيل axe', () => {
  const offenders = [];
  for (const file of PY_TOOLS) {
    if (/setBypassCSP/.test(stripPythonComments(read(file)))) {
      offenders.push(`${file}: setBypassCSP`);
    }
  }
  assert.deepEqual(offenders, [],
    `تدقيق الإتاحة يجب أن يعمل تحت CSP الحقيقية، لا بتعطيلها:\n${offenders.join('\n')}`);
});

test('لا أداة تحقن axe بوسم سكربت سطري', () => {
  const offenders = [];
  for (const file of PY_TOOLS) {
    stripPythonComments(read(file)).split('\n').forEach((line, index) => {
      if (line.includes('add_script_tag')) offenders.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, [],
    `add_script_tag يُنشئ <script> سطريًا يرفضه script-src 'self'. استخدم add_init_script قبل التنقّل:\n${offenders.join('\n')}`);
});

test('كل استدعاء لـ axe.run يسبقه تسجيل axe على السياق', () => {
  // نستثني تعريف audit() نفسه (يقبل page جاهزة من المستدعي).
  const offenders = [];
  for (const file of ['scripts/serum-browser-test.py', 'scripts/campaign-browser-test.py']) {
    const lines = stripPythonComments(read(file)).split('\n');
    lines.forEach((line, index) => {
      if (!line.includes('axe.run')) return;
      // تعريف الدالة: لا يسبقه new_context في نفس النطاق، وهو مسموح.
      const isHelper = lines.slice(index, index + 2).join(' ').includes('async () =>') &&
        lines.slice(Math.max(0, index - 12), index).some(l => l.startsWith('def audit('));
      if (isHelper) return;
      let ctxAt = null;
      let initAt = null;
      for (let j = index - 1; j >= 0; j -= 1) {
        if (ctxAt === null && lines[j].includes('new_context')) ctxAt = j;
        if (initAt === null && (lines[j].includes('install_axe') || lines[j].includes('add_init_script(script=AXE'))) initAt = j;
        if (ctxAt !== null && initAt !== null) break;
      }
      if (!(initAt !== null && ctxAt !== null && initAt > ctxAt)) {
        offenders.push(`${file}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    `هذه المواضع تشغّل axe على سياق لم يُسجَّل عليه axe:\n${offenders.join('\n')}`);
});

test('أدوات الإتاحة المستقلة تسجّل axe قبل التنقّل', () => {
  for (const file of ['scripts/a11y-audit.py', 'scripts/axe-audit.py']) {
    const code = read(file);
    const initAt = code.indexOf('add_init_script(script=');
    const gotoAt = code.indexOf('.goto(');
    assert.ok(initAt !== -1, `${file} لا يسجّل axe كسكربت init`);
    assert.ok(gotoAt === -1 || initAt < gotoAt,
      `${file}: تسجيل axe يجب أن يسبق أول تنقّل`);
  }
});
