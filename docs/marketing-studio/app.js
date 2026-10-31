(function () {
  'use strict';

  var config = window.RAWAA_CONFIG;
  var ORIGIN = 'https://raawaa-store.pages.dev';
  var STORAGE_KEY = 'rawaa:marketing-aggregate:v1';
  var postOptions = {
    benefit: 'اللمسة التجميلية',
    order_steps: 'خطوات الطلب',
    reference_prices: 'الأحجام والأسعار',
    size_guide: 'رسم مقارنة الأحجام'
  };
  var sourceMedia = { facebook: 'organic', instagram: 'organic', whatsapp: 'messaging' };
  // size_guide is added in local campaign source but is not on the deployed public page yet.
  var deployedContent = ['benefit', 'order_steps', 'reference_prices'];
  var posts = [
    {
      id: 'benefit', title: 'اللمسة التجميلية', purpose: 'تعريف هادئ بالمنتج دون وعد موحّد بالنتيجة.',
      copy: 'اللمسة الأخيرة في روتينك قد تكون بسيطة. رواء سيروم تشطيب للشعر بثلاثة أحجام. تعرّفي على التفاصيل واسألينا عن التوفّر.',
      asset: '../visual-drafts/rawaa-flow-concept-01-1080x1350.jpg',
      alt: 'شرائط فنية بنية منحنية على خلفية عاجية؛ تصور تجريدي مولّد لا يعرض الشعر أو المنتج أو نتيجة استخدام.',
      disclosure: 'صورة تجريدية مولّدة؛ ليست صورة منتج أو نتيجة استخدام.', tag: 'benefit'
    },
    {
      id: 'order_steps', title: 'خطوات الطلب', purpose: 'شرح ما يحدث فعلًا بعد زيارة صفحة المنتج.',
      copy: 'اختاري الحجم، راجعي السعر المرجعي والتوصيل، ثم افتحي رسالة واتساب وأرسليها بنفسك. نؤكد التوفّر والإجمالي قبل الإتمام. فتح واتساب وحده لا يرسل الرسالة ولا يؤكد الطلب.',
      asset: '../../assets/img/campaign/quiet-finish-editorial-v1-720.webp',
      alt: 'مشهد تحريري تعبيري مولّد؛ ليس توثيقًا لطلب أو لعميلة من رواء.',
      disclosure: 'مشهد تعبيري مولّد، لا يثبت استلام رسالة أو طلب.', tag: 'order_steps'
    },
    {
      id: 'reference_prices', title: 'الأحجام والأسعار', purpose: 'عرض السعر المرجعي مع توضيح حدوده.',
      copy: function () { return 'أسعار سيروم رواء المرجعية: ' + priceList() + '. الأسعار للمنتج قبل العطر والتوصيل؛ راجعي التفاصيل واسألينا عن التوفّر والإجمالي النهائي.'; },
      asset: '../../assets/img/products/trio-v6-1080.jpg',
      alt: 'تصور تصميمي لعبوات رواء بثلاثة أحجام، وليس صورة للعبوات الفعلية.',
      disclosure: 'تصور تصميمي للعبوات، لا صورة المنتج الفعلي.', tag: 'reference_prices'
    },
    {
      id: 'size_guide', title: 'رسم مقارنة الأحجام', purpose: 'مقارنة عددية لا توحي بأبعاد العبوات.',
      copy: function () { return 'ثلاثة أحجام لسيروم رواء: ' + priceList() + '. هذه أسعار المنتج المرجعية دون العطر والتوصيل. اطلعي على الخيارات واسألينا عن التوفّر قبل الإتمام.'; },
      asset: '../visual-drafts/size-guide-ar-1080x1350.svg',
      alt: 'رسم متجهي عربي للأحجام والأسعار؛ أشرطة نسبية لا تمثل الأبعاد الفعلية للعبوات.',
      disclosure: 'رسم معلوماتي أصلي؛ الأشرطة ليست أبعادًا فعلية.', tag: 'size_guide'
    }
  ];
  var metricFields = [
    ['reach', 'الوصول'], ['clicks', 'النقرات'], ['messages', 'الرسائل المستلمة'],
    ['inquiries', 'الاستفسارات المؤهلة'], ['orders', 'الطلبات المؤكدة'], ['delivered', 'المسلّمة']
  ];

  function node(tag, className, text) {
    var result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }
  function formatPriceList(storeConfig) {
    return storeConfig.products.map(function (product) {
      var price = Number(product.price);
      return product.sizeLabel + ' بـ ' + storeConfig.currency.symbol + price.toFixed(Number.isInteger(price) ? 0 : 2);
    }).join('، ');
  }
  function priceList() { return formatPriceList(config); }
  function safeInt(value) {
    var n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 && n <= 100000000 ? n : 0;
  }
  function parseMetricRows(raw) {
    try {
      var rows = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(rows)) return [];
      var allowedKeys = ['post', 'date'].concat(metricFields.map(function (field) { return field[0]; }));
      return rows.filter(function (row) {
        return row && typeof row === 'object' && Object.keys(row).length === allowedKeys.length &&
          Object.keys(row).every(function (key) { return allowedKeys.includes(key); }) &&
          Object.keys(postOptions).includes(row.post) && /^\d{4}-\d{2}-\d{2}$/.test(row.date || '') &&
          metricFields.every(function (field) { return Number.isSafeInteger(row[field[0]]) && row[field[0]] >= 0 && row[field[0]] <= 100000000; });
      }).slice(-100);
    } catch { return []; }
  }
  function readRows() { return parseMetricRows(localStorage.getItem(STORAGE_KEY)); }
  function buildPostCard(post) {
    var card = node('article', 'draft-card');
    var image = node('img', 'draft-media' + (post.tag === 'size_guide' ? ' contain' : ''));
    image.src = post.asset;
    image.alt = post.alt;
    image.loading = 'lazy';
    image.width = 1080;
    image.height = 1350;
    card.append(image);

    var body = node('div', 'draft-body');
    var head = node('div', 'draft-head');
    head.append(node('h3', '', post.title), node('span', 'draft-status', 'مسودة'));
    body.append(head, node('p', 'draft-purpose', post.purpose));
    var copy = typeof post.copy === 'function' ? post.copy() : post.copy;
    var copyNode = node('p', 'draft-copy', copy);
    body.append(copyNode, node('p', 'draft-facts', post.disclosure));
    var actions = node('div', 'draft-actions');
    var copyButton = node('button', 'button button-secondary', 'نسخ النص');
    copyButton.type = 'button';
    copyButton.addEventListener('click', function () { copyText(copy, 'نسخ النص'); });
    var link = node('a', '', deployedContent.includes(post.tag) ? 'معاينة صفحة الحملة' : 'يتطلب تحديث صفحة الحملة قبل المشاركة');
    var campaignPreview = buildCampaignUrl(post.tag);
    if (campaignPreview) link.href = campaignPreview;
    else link.setAttribute('aria-disabled', 'true');
    link.dataset.postTag = post.tag;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.append(copyButton, link);
    body.append(actions);
    card.append(body);
    return card;
  }
  function cleanCampaign(value) {
    var clean = String(value || '').trim().toLowerCase();
    return /^[a-z0-9_-]{1,40}$/.test(clean) ? clean : '';
  }
  function campaignUrl(campaignValue, source, tag) {
    var campaign = cleanCampaign(campaignValue);
    var medium = sourceMedia[source];
    if (!campaign || !medium || !Object.prototype.hasOwnProperty.call(sourceMedia, source) || !deployedContent.includes(tag)) return '';
    var url = new URL('/campaign', ORIGIN);
    url.searchParams.set('utm_source', source);
    url.searchParams.set('utm_medium', medium);
    url.searchParams.set('utm_campaign', campaign);
    url.searchParams.set('utm_content', tag);
    return url.href;
  }
  function buildCampaignUrl(tag) {
    return campaignUrl(document.getElementById('utm-campaign').value, document.getElementById('utm-source').value, tag);
  }
  async function copyText(value, label) {
    var status = document.getElementById('copy-status');
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      status.textContent = label + ' إلى الحافظة. لم يُنشر أو يُرسل.';
    } catch {
      status.textContent = 'تعذّر النسخ التلقائي؛ حددي النص الظاهر وانسخيه يدويًا.';
    }
  }
  function updateLink() {
    var campaignInput = document.getElementById('utm-campaign');
    var campaignStatus = document.getElementById('utm-campaign-status');
    var validCampaign = Boolean(cleanCampaign(campaignInput.value));
    campaignInput.setAttribute('aria-invalid', validCampaign ? 'false' : 'true');
    campaignStatus.textContent = validCampaign ? '' : 'استخدمي حروفًا لاتينية صغيرة وأرقامًا وشرطة سفلية/عادية فقط.';
    var tag = document.getElementById('utm-content').value;
    var link = document.getElementById('utm-link');
    link.value = buildCampaignUrl(tag);
    document.getElementById('copy-link').disabled = !validCampaign;
    document.querySelectorAll('[data-post-tag]').forEach(function (anchor) {
      var url = buildCampaignUrl(anchor.dataset.postTag);
      if (url) {
        anchor.href = url; anchor.removeAttribute('aria-disabled'); anchor.textContent = 'معاينة صفحة الحملة';
      } else {
        anchor.removeAttribute('href'); anchor.setAttribute('aria-disabled', 'true');
        anchor.textContent = deployedContent.includes(anchor.dataset.postTag)
          ? 'صحّحي اسم الدورة لمعاينة الحملة'
          : 'يتطلب تحديث صفحة الحملة قبل المشاركة';
      }
    });
    document.getElementById('copy-status').textContent = '';
  }
  function fieldValue(id) {
    return safeInt(document.getElementById(id).value);
  }
  function saveMetric(event) {
    event.preventDefault();
    var post = document.getElementById('metric-post').value;
    var date = document.getElementById('metric-date').value || new Date().toISOString().slice(0, 10);
    var row = { post: post, date: date };
    metricFields.forEach(function (field) { row[field[0]] = fieldValue('metric-' + field[0]); });
    var rows = readRows();
    rows.push(row);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-100)));
      document.getElementById('metrics-status').textContent = 'حُفظت أعداد مجمّعة على هذا الجهاز فقط.';
      renderRows();
      event.target.reset();
      document.getElementById('metric-date').value = '';
      metricFields.forEach(function (field) { document.getElementById('metric-' + field[0]).value = '0'; });
    } catch {
      document.getElementById('metrics-status').textContent = 'تعذّر الحفظ المحلي في هذا المتصفح؛ لم تُرسل البيانات إلى أي خادم.';
    }
  }
  function renderRows() {
    var body = document.getElementById('metrics-rows');
    body.replaceChildren();
    var rows = readRows();
    if (!rows.length) {
      var empty = node('tr');
      var cell = node('td', '', 'لا توجد أرقام مسجلة بعد.');
      cell.colSpan = 8;
      empty.append(cell); body.append(empty); return;
    }
    rows.slice().reverse().forEach(function (row) {
      var tr = node('tr');
      [postOptions[row.post], row.date].concat(metricFields.map(function (field) { return String(row[field[0]]); }))
        .forEach(function (value) { tr.append(node('td', '', value)); });
      body.append(tr);
    });
  }
  function formatCsv(rows) {
    var labels = ['الزاوية', 'التاريخ', 'الوصول', 'نقرات الرابط', 'رسائل مستلمة', 'استفسارات مؤهلة', 'طلبات مؤكدة', 'مسلّمة'];
    var csvRows = [labels].concat(rows.map(function (row) {
      return [postOptions[row.post], row.date].concat(metricFields.map(function (field) { return row[field[0]]; }));
    }));
    return '\ufeff' + csvRows.map(function (cells) {
      return cells.map(function (value) { return '"' + String(value).replaceAll('"', '""') + '"'; }).join(',');
    }).join('\r\n');
  }
  function exportCsv() {
    var rows = readRows();
    if (!rows.length) { document.getElementById('metrics-status').textContent = 'لا يوجد سجل لتصديره.'; return; }
    var csv = formatCsv(rows);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = node('a'); a.href = url; a.download = 'rawaa-marketing-aggregate.csv';
    a.hidden = true; document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    document.getElementById('metrics-status').textContent = 'أُنشئ ملف CSV على جهازك؛ لم يُرفع أو يُرسل.';
  }
  function clearRows() {
    if (!window.confirm('هل تريدين مسح سجل الأعداد المجمّعة من هذا الجهاز؟ لا يمكن التراجع.')) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      document.getElementById('metrics-status').textContent = 'مُسح السجل المحلي.';
      renderRows();
    } catch {
      document.getElementById('metrics-status').textContent = 'تعذّر مسح التخزين المحلي.';
    }
  }
  window.RawaaMarketingStudio = Object.freeze({
    cleanCampaign: cleanCampaign,
    campaignUrl: campaignUrl,
    formatPriceList: formatPriceList,
    parseMetricRows: parseMetricRows,
    formatCsv: formatCsv
  });

  function init() {
    if (!config || !Array.isArray(config.products)) {
      document.getElementById('draft-list').textContent = 'تعذّر تحميل إعدادات المتجر؛ لا تعرض الأداة أسعارًا تقديرية.';
      return;
    }
    var list = document.getElementById('draft-list');
    posts.forEach(function (post) { list.append(buildPostCard(post)); });
    updateLink();
    document.getElementById('utm-source').addEventListener('change', updateLink);
    document.getElementById('utm-content').addEventListener('change', updateLink);
    document.getElementById('utm-campaign').addEventListener('input', updateLink);
    document.getElementById('copy-link').addEventListener('click', function () { copyText(document.getElementById('utm-link').value, 'الرابط'); });
    document.getElementById('metrics-form').addEventListener('submit', saveMetric);
    document.getElementById('export-csv').addEventListener('click', exportCsv);
    document.getElementById('clear-metrics').addEventListener('click', clearRows);
    document.getElementById('metric-date').max = new Date().toISOString().slice(0, 10);
    renderRows();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
