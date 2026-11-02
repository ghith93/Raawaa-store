# تقليل تشغيلات CI المكررة — 2 نوفمبر 2026

## الدليل والمشكلة

- على SHA واحد `9445a8d6cacadb65b2955f1b6e94a379627c35fa` شغّل GitHub سير `Site checks` مرتين: حدث `push` في [41456563795](https://github.com/ghith93/Raawaa-store/actions/runs/41456563795) وحدث `pull_request` في [41456574512](https://github.com/ghith93/Raawaa-store/actions/runs/41456574512). اكتمل كلاهما بنجاح، مع Chromium وWebKit وتدقيق الإتاحة في كل تشغيل. كان هذا تكرارًا فعليًا لمصفوفة CI وليس افتراضًا من إعداد YAML وحده.
- كان `concurrency.group` يستخدم `${{ github.ref }}`؛ قيمة ref تختلف بين `refs/heads/<branch>` لحدث push ومرجع pull request، لذلك لم يدمج التشغيلين أو يلغِ أحدهما الآخر.
- توثيق GitHub الرسمي يتيح تقييد حدث push بفرع، مع إبقاء pull requests مشمولة عبر فلتر مستقل: [Workflow syntax — branch filters](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax). ووجدنا النمط نفسه موثقًا في [issue #44 على مستودع sealoc](https://github.com/sealoc/sealoc/issues/44)؛ استخدمناه كقرينة مساعدة لا كبديل عن دليل تشغيلات رواء.

## التغيير

- في `.github/workflows/site-checks.yml` أصبح حدث `push` محصورًا بـ`main`؛ ما زال `pull_request` يعمل لكل الفروع، و`workflow_dispatch` متاحًا للتشغيل اليدوي.
- أضيف فحص انحدار في `scripts/check-site.mjs` يثبت أن الدفع محصور في main وأن طلبات الدمج على كل الفروع ما زالت مشمولة. يحافظ ذلك على بوابة PR المطلوبة ويزيل التشغيل الموازي الزائد على commits فروع PR.
- لم نغيّر workflow النشر أو صلاحيات GitHub أو إجراءات Supabase، ولم نلغِ أي تشغيل يدوي. لا يُقدّر المستند وفورات مالية: إعدادات المستودع تشير إلى مشروع عام، لكن الهدف المقاس هو تقليل وقت runner والتوازي/الانتظار، لا ادعاء خفض فاتورة.

## التحقق والحدود

- محليًا: `node scripts/check-site.mjs` نجح **530/530** بعد إضافة الحارس؛ `node --check scripts/check-site.mjs` واختبارات `scripts/perf-budget.test.mjs` ‏**5/5** نجحت، و`git diff --check` نظيف.
- CI على commit `9445a8d` سبق هذا التغيير ونجح؛ **لم يُشغّل CI بعد على تعديل trigger الجديد**. لا نعتبر التحسين مكتملًا قبل نجاح فحوص PR على SHA الذي يحتوي التغيير.
- لا تتأثر فحوص `code-quality` التي كانت مسبقًا تعمل على PR و`main` فقط. لا تعمل فحوص site-checks تلقائيًا على push لفرع بلا PR بعد هذا التغيير؛ يمكن تشغيلها يدويًا أو فتح PR، وفق سير العمل المعتمد في المستودع.
