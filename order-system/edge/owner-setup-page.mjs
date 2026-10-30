// Temporary owner setup page served by rawaa-header-probe. iPhone-first.
// Section 1 generates the scheduler secret LOCALLY in the owner's browser via
// crypto.getRandomValues — the value is never sent to this server or anywhere else.
// Section 2/3 link to the Supabase and GitHub secret pages with copy buttons.
// Section 4 runs the identity spoofing probe from the browser (fetch with forged
// headers to this same origin) and renders an honest verdict.
// Delete this function after setup (delete_edge_function, slug rawaa-header-probe).
const NAMES = ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'true-client-ip'];

const HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>إعداد رواء من الآيفون</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Tahoma, sans-serif; background: #101418; color: #eef2f5; margin: 0; padding: 16px; line-height: 1.7; }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  h2 { font-size: 1.05rem; margin: 0 0 8px; color: #ffd479; }
  section { background: #1a2129; border-radius: 14px; padding: 16px; margin: 14px 0; }
  button { font-size: 1rem; padding: 12px 18px; border-radius: 12px; border: 0; background: #2f81f7; color: #fff; margin: 6px 4px 6px 0; }
  button.alt { background: #3a4653; }
  input, pre { width: 100%; box-sizing: border-box; background: #0d1117; color: #7ee787; border: 1px solid #30363d; border-radius: 10px; padding: 10px; font-size: 0.95rem; margin: 8px 0; }
  pre { white-space: pre-wrap; word-break: break-all; direction: ltr; text-align: left; }
  a { color: #79c0ff; }
  .ok { color: #7ee787; } .bad { color: #ff7b72; } .warn { color: #ffd479; }
  .small { font-size: 0.85rem; color: #9aa7b2; }
  code { direction: ltr; display: inline-block; background: #0d1117; padding: 4px 8px; border-radius: 8px; }
</style>
</head>
<body>
<h1>إعداد رواء من الآيفون</h1>
<p class="small">صفحة مؤقتة تُحذف بعد الانتهاء. توليد السرّ يجري داخل هاتفك فقط.</p>

<section>
<h2>١) ولِّد السرّ</h2>
<button id="genBtn">ولِّد سرًّا جديدًا</button>
<div id="secretWrap" hidden>
<input id="secretOut" readonly dir="ltr" onclick="this.select()">
<button class="alt" id="copySecret">نسخ السرّ</button>
<p class="small">احفظه عندك. لا ترسله لأحد، حتى لي.</p>
</div>
</section>

<section>
<h2>٢) ألصقه في Supabase</h2>
<p><a href="https://supabase.com/dashboard/project/oyoyozdugicmnkfhjovo/functions">افتح صفحة أسرار Supabase</a> ← تبويب Manage (الإدارة) ← Secrets (الأسرار) ← إضافة.</p>
<p>الاسم الذي ستضيفه (اضغط للنسخ):<br><code onclick="copyText('RAWAA_OUTBOX_SCHEDULER_SECRET')">RAWAA_OUTBOX_SCHEDULER_SECRET</code></p>
<p class="small">القيمة = السرّ الذي ولّدته في الخطوة ١.</p>
</section>

<section>
<h2>٣) ألصقه في GitHub</h2>
<p><a href="https://github.com/ghith93/Raawaa-store/settings/secrets/actions/new">افتح صفحة إضافة سرّ GitHub</a> ← Name:</p>
<p><code onclick="copyText('RAWAA_OUTBOX_SCHEDULER_SECRET')">RAWAA_OUTBOX_SCHEDULER_SECRET</code></p>
<p class="small">Secret = نفس السرّ ← Add secret. ثم تابع تشغيل المجدول من هنا:<br>
<a href="https://github.com/ghith93/Raawaa-store/actions/workflows/outbox-scheduler.yml">صفحة مجدول التنبيهات</a></p>
</section>

<section>
<h2>٤) بثبة التزوير</h2>
<p class="small">نرسل ترويسات مزوّرة بقيمة 8.8.8.8 ونرى ماذا تصل فعلًا.</p>
<button id="probeBtn">ابدأ البثبة</button>
<button class="alt" id="copyResult" hidden>نسخ النتيجة لإرسالها</button>
<pre id="probeOut">اضغط الزر للبدء…</pre>
</section>

<script>
function copyText(text) {
  navigator.clipboard.writeText(text).then(function(){ alert("تم النسخ"); }, function(){ alert("انسخ يدويًا: " + text); });
}
document.getElementById("genBtn").onclick = function() {
  var bytes = crypto.getRandomValues(new Uint8Array(48));
  var bin = "";
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  var val = btoa(bin).split("+").join("-").split("/").join("_").split("=").join("");
  document.getElementById("secretOut").value = val;
  document.getElementById("secretWrap").hidden = false;
};
document.getElementById("copySecret").onclick = function() {
  copyText(document.getElementById("secretOut").value);
};
document.getElementById("probeBtn").onclick = async function() {
  var out = document.getElementById("probeOut");
  out.textContent = "جارٍ القياس…";
  var lines = [];
  try {
    var base = await fetch("?format=json", { method: "GET", cache: "no-store" });
    lines.push("== بدون تزوير (خط الأساس) ==");
    lines.push(JSON.stringify(await base.json(), null, 2));
  } catch (e) {
    lines.push("== بدون تزوير ==");
    lines.push("فشل الاتصال بالدالة.");
  }
  try {
    var forged = await fetch("?format=json", {
      method: "POST",
      cache: "no-store",
      headers: { "X-Forwarded-For": "8.8.8.8", "X-Real-IP": "8.8.8.8", "CF-Connecting-IP": "8.8.8.8" }
    });
    var data = await forged.json();
    lines.push("");
    lines.push("== مع تزوير 8.8.8.8 ==");
    lines.push(JSON.stringify(data, null, 2));
    lines.push("");
    var spoofed = [];
    for (var key in data) {
      var v = data[key];
      if (typeof v === "string" && v.indexOf("8.8.8.8") !== -1) spoofed.push(key);
    }
    if (spoofed.length) {
      lines.push("النتيجة: غير آمن — هذه الرؤوس قابلة للتزوير: " + spoofed.join(", "));
    } else {
      lines.push("النتيجة: التزوير لم ينجح في أي رأس. cf-connecting-ip هو المرشّح الآمن.");
    }
  } catch (e) {
    lines.push("");
    lines.push("== مع التزوير ==");
    lines.push("الطلب لم يكتمل — قد تكون Cloudflare رفضت الترويسة المزوّرة (سلوك حماية متوقع).");
  }
  lines.push("");
  lines.push("أرسل النتيجة كاملة في المحادثة ثم احذف هذه الصفحة.");
  out.textContent = lines.join(String.fromCharCode(10));
  document.getElementById("copyResult").hidden = false;
};
document.getElementById("copyResult").onclick = function() {
  copyText(document.getElementById("probeOut").textContent);
};
</script>
</body>
</html>`;

Deno.serve(request => {
  const url = new URL(request.url);
  const wantsJson = url.searchParams.get('format') === 'json' || request.method === 'POST';
  if (wantsJson) {
    const seen = {};
    for (const name of NAMES) seen[name] = request.headers.get(name);
    return new Response(JSON.stringify(seen), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }
    });
  }
  return new Response(HTML, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': 'inline; filename="index.html"',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'x-content-type-options': 'nosniff'
    }
  });
});
