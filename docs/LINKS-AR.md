# روابط جاهزة للنسخ واللصق — RAWAA | رواء

كل رابط في سطر مستقل، بلا تنسيق، جاهز للنسخ.

---

## الجزء الأول — إنشاء المستودع العام

```
https://github.com/new
```

اسم المستودع:

```
rawaa-store
```

اختر: Public · ولا تضف README ولا .gitignore ولا License.

---

## الجزء الثاني — إنشاء التوكن (Fine-grained)

```
https://github.com/settings/personal-access-tokens/new
```

القيم المطلوبة:

```
Token name: rawaa-agent
Expiration: 7 days
Repository access: Only select repositories -> rawaa-store
```

الصلاحيات (والباقي كله No access):

```
Contents        = Read and write
Pull requests   = Read and write
Metadata        = Read (تلقائي)
Administration  = No access
Secrets         = No access
Workflows       = No access
```

---

## الجزء الثالث — بعد إنشاء المستودع (بدّل USERNAME باسمك)

رابط الرفع:

```
https://github.com/USERNAME/rawaa-store/upload/main
```

رابط النشر على GitHub Pages:

```
https://github.com/USERNAME/rawaa-store/settings/pages
```

رابط المراجعة والمراقبة:

```
https://github.com/USERNAME/rawaa-store/actions
```

---

## الجزء الرابع — إبطال التوكن (بعد انتهائي)

```
https://github.com/settings/tokens
```

---

## الجزء الخامس — بدائل لا تحتاج أي مفتاح

معاينة فورية بسحب الملف:

```
https://app.netlify.com/drop
```

---

## لا تُرسل هذه أبدًا في أي محادثة

```
كلمة مرور GitHub
رمز التحقق (2FA / OTP)
مفتاح SSH الخاص (id_rsa)
مفتاح يبدأ بـ ghp_  (classic token = صلاحيات كل مستودعاتك)
```

التوكن الوحيد المطلوب يبدأ بـ `github_pat_` ومحدود بمستودع واحد و7 أيام.
