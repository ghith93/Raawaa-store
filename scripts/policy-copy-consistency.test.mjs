/*
 * حارس نصوص السياسة: ألا يقول نصٌّ منشور شيئًا يخالف js/config.js.
 *
 * العطل الذي أوجبه (7 نوفمبر 2026): بعد اعتماد «التوصيل مجاني لكل المحافظات»،
 * بقي في صفحة المنتج سطر قصير يظهر **على الهاتف وحده** يقول
 * «توصيل حماة مجانًا» — أي أن الزائرة على الهاتف كانت تقرأ سياسة ملغاة، بينما
 * تقرأ الزائرة على الشاشة الواسعة السياسة الصحيحة. وفحص CSS/JS لا يرى نصًا،
 * وفحص المظهر لا يميّز بين سياستين كلتاهما «تبدو» صحيحة.
 *
 * القاعدة: الأرقام تُقرأ من الإعدادات؛ والتغطية (mobile/desktop) لا تُغيّر الحكم.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const PAGES = ['index.html', 'serum.html', 'campaign.html', 'hama.html', 'privacy.html'];

/** يُزيل التعليقات والـJSON-LD حتى لا يُحاسب الشرح على ما يشرحه. */
function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ');
}

test('لا نص منشور يقيّد التوصيل المجاني بحماة أو بمحافظة بعينها', () => {
  // السياسة السارية: توصيل صفر لكل المحافظات ولكل طرق الدفع (قرار المالك).
  // استثناء مشروع: الحديث عن «تنسيق المنطقة والموعد» عبر واتساب ليس ادعاء سعر.
  const forbidden = [
    /توصيل\s+(?:مجاني\s+)?(?:داخل|في)\s+حماة\s+(?:فقط|مجانًا)/,
    /توصيل\s+حماة\s+مجانًا/,
    /مجاني\s+(?:داخل|في)\s+حماة\s+فقط/,
    /شام\s+كاش\s+(?:داخل|في)\s+حماة\s+فقط/,
  ];
  const offenders = [];
  for (const page of PAGES) {
    const text = visibleText(read(page));
    for (const pattern of forbidden) {
      const hit = text.match(pattern);
      if (hit) offenders.push(`${page}: «${hit[0]}»`);
    }
  }
  assert.deepEqual(offenders, [],
    `نص يقيّد التوصيل بحماة بينما السياسة مجانية لكل المحافظات:\n${offenders.join('\n')}`);
});

test('لا رسوم توصيل مكتوبة بالرقم في نصوص الصفحات', () => {
  // الرسوم تأتي من config.js. رقم مكتوب هنا هو نسخة ثانية تنحرف بصمت.
  const offenders = [];
  for (const page of PAGES) {
    const text = visibleText(read(page));
    // «$2» أو «$4» كرسوم توصيل — لا كسعر عطر أو سعر منتج (مسبوقة بكلمة توصيل).
    const hit = text.match(/توصيل[^<.]{0,20}\$\s?[1-9]/);
    if (hit) offenders.push(`${page}: «${hit[0].trim()}»`);
  }
  assert.deepEqual(offenders, [],
    `رسوم توصيل مكتوبة يدويًا — يجب أن تأتي من js/config.js:\n${offenders.join('\n')}`);
});

test('النسبة المكتوبة في النصوص تطابق config.js', () => {
  const config = read('js/config.js');
  const match = config.match(/id:\s*'shamcash'[\s\S]{0,200}?discountPercent:\s*(\d+)/);
  assert.ok(match, 'لم أجد نسبة شام كاش في config.js');
  const percent = Number(match[1]);

  const offenders = [];
  for (const page of PAGES) {
    const text = visibleText(read(page));
    for (const hit of text.matchAll(/خصم\s*(\d+)\s*%/g)) {
      if (Number(hit[1]) !== percent) offenders.push(`${page}: «${hit[0]}» والتكوين ${percent}%`);
    }
  }
  assert.deepEqual(offenders, [],
    `نسبة خصم منشورة لا تطابق js/config.js (${percent}%):\n${offenders.join('\n')}`);
});

test('النص القصير والكامل في الشريط العلوي يحملان السياسة نفسها', () => {
  // العطل الأصلي: القصير (هاتف) والكامل (سطح المكتب) قالا سياستين مختلفتين.
  const offenders = [];
  for (const page of PAGES) {
    const html = read(page);
    const short = html.match(/class="topbar-short"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';
    const full = html.match(/class="topbar-full"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';
    if (!short || !full) continue;
    const claims = (text) => ({
      free: /توصيل[^.]{0,12}مجاني|التوصيل مجاني/.test(text),
      hamaOnly: /حماة\s+(?:فقط|مجانًا)/.test(text),
      percent: text.match(/(\d+)\s*%/)?.[1],
    });
    const a = claims(short);
    const b = claims(full);
    if (a.hamaOnly !== b.hamaOnly || a.free !== b.free || a.percent !== b.percent) {
      offenders.push(`${page}: القصير ${JSON.stringify(a)} ≠ الكامل ${JSON.stringify(b)}`);
    }
  }
  assert.deepEqual(offenders, [],
    `الشريط العلوي يقدّم سياستين مختلفتين حسب عرض الشاشة:\n${offenders.join('\n')}`);
});
