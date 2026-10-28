/**
 * RAWAA | رواء — المصدر المركزي لإعدادات العلامة والمنتجات وطرق الدفع.
 * أي تغيير في الأسعار أو رقم واتساب أو طرق الدفع أو الرسوم يتم هنا فقط.
 * لا تُكرَّر هذه القيم في أي ملف آخر — الواجهة تُبنى من هذه البيانات حرفيًا.
 */
(function () {
  'use strict';

  var config = {
    brand: {
      latinName: 'RAWAA',
      arabicName: 'رواء',
      tagline: 'عناية هادئة بالشعر',
      shortDescription: 'سيروم شعر نسائي بأحجام ثلاثة، بطلب مباشر عبر واتساب.',
      city: 'حماة',
      country: 'سوريا'
    },

    /**
     * رقم واتساب بصيغة دولية بدون علامة + وبدون مسافات.
     * الرقم المحلي المعتمد من صاحب المشروع: 0997310856 → 963997310856
     * (تنسيق الرابط مُتحقَّق منه آليًا؛ حالة تفعيل الحساب لم تُختبر آليًا.)
     */
    contact: {
      whatsappNumber: '963997310856',
      displayNumber: '0997310856',
      hoursNote: 'نرد على الرسائل خلال ساعات اليوم المعتادة، وغالبًا خلال ساعات قليلة.'
    },

    currency: {
      code: 'USD',
      symbol: '$',
      arabicLabel: 'دولار أمريكي',
      position: 'prefix'
    },

    /**
     * الأسعار أسعار مرجعية مقدَّمة من صاحب المشروع (ليست تسعيرًا نهائيًا معتمدًا).
     * الخصم والتوصيل يُحسبان في الواجهة من الكائن `payment` أدناه.
     */
    products: [
      {
        id: 'serum-30',
        name: 'سيروم رواء للشعر',
        sizeMl: 30,
        sizeLabel: '30 مل',
        shortLabel: '30 مل — الحجم التجريبي',
        note: 'مناسب للتعرّف على المنتج أو للسفر.',
        price: 6,
        image: {
          base: 'size-30',
          avif: ['size-30-480.avif', 'size-30-720.avif', 'size-30-900.avif'],
          webp: ['size-30-480.webp', 'size-30-720.webp', 'size-30-900.webp'],
          widths: [480, 720, 900],
          src: 'assets/img/products/size-30-720.jpg',
          width: 720,
          height: 720,
          alt: 'تصور تصميمي لعبوة سيروم رواء 30 مل — زجاج كهرماني وملصق عاجي باسم RAWAA ورواء، وليست صورة منتج مُصنَّع'
        }
      },
      {
        id: 'serum-50',
        name: 'سيروم رواء للشعر',
        sizeMl: 50,
        sizeLabel: '50 مل',
        shortLabel: '50 مل — الأكثر طلبًا',
        note: 'الاستخدام اليومي المعتاد لعدة أسابيع.',
        price: 10,
        badge: 'الأكثر اختيارًا',
        image: {
          base: 'size-50',
          avif: ['size-50-480.avif', 'size-50-720.avif', 'size-50-900.avif'],
          webp: ['size-50-480.webp', 'size-50-720.webp', 'size-50-900.webp'],
          widths: [480, 720, 900],
          src: 'assets/img/products/size-50-720.jpg',
          width: 720,
          height: 720,
          alt: 'تصور تصميمي لعبوة سيروم رواء 50 مل — زجاج كهرماني وغطاء قطّارة أسود وملصق عاجي، وليست صورة منتج مُصنَّع'
        }
      },
      {
        id: 'serum-100',
        name: 'سيروم رواء للشعر',
        sizeMl: 100,
        sizeLabel: '100 مل',
        shortLabel: '100 مل — العبوة الكبيرة',
        note: 'أفضل قيمة لكل ملليلتر على المدى الطويل.',
        price: 12,
        badge: 'أفضل قيمة',
        image: {
          base: 'size-100',
          avif: ['size-100-480.avif', 'size-100-720.avif', 'size-100-900.avif'],
          webp: ['size-100-480.webp', 'size-100-720.webp', 'size-100-900.webp'],
          widths: [480, 720, 900],
          src: 'assets/img/products/size-100-720.jpg',
          width: 720,
          height: 720,
          alt: 'تصور تصميمي لعبوة سيروم رواء 100 مل — أكبر أحجام العلامة، وليست صورة منتج مُصنَّع'
        }
      }
    ],

    /**
     * طرق الدفع والدفع-عند-الاستلام.
     * جميع القيم معرَّفة من صاحب المشروع. الخصم والرسوم تُحسب في السلة
     * ويظهر أثرها بالتفصيل في رسالة واتساب — لا يُخصم شيء تلقائيًا على أي بوابة.
     * `available: false` تعني أن الخيار معروض للمعلومة دون إمكانية اختياره.
     */
    /**
     * مناطق التوصيل — الأرقام من صاحب المشروع:
     *   حماة (المدينة الأم): 2 دولار
     *   باقي المحافظات:      4 دولارات
     * التوصيل المجاني مع شام كاش يسري داخل حماة فقط.
     */
    delivery: {
      defaultZone: 'hama',
      zones: [
        { id: 'hama', label: 'حماة', fee: 2, freeWithShamCash: true },
        { id: 'other', label: 'باقي المحافظات', fee: 4, freeWithShamCash: false }
      ],
      note: 'التوصيل المجاني مع شام كاش داخل حماة فقط. خارج حماة تُضاف رسوم التوصيل حتى مع شام كاش.'
    },

    payment: {
      title: 'طريقة الدفع',
      freeDeliveryNote: 'التوصيل المجاني مع شام كاش يسري داخل حماة فقط؛ باقي المحافظات عليها رسوم توصيل 4 دولارات.',
      methods: [
        {
          id: 'shamcash',
          label: 'شام كاش',
          short: 'شام كاش',
          description: 'خصم 10% على قيمة المنتجات + توصيل مجاني داخل حماة.',
          discountPercent: 10,
          freeDeliveryIn: ['hama'],
          requiresReceipt: true,
          available: true,
          confirmNote: 'يُرسَل إشعار التحويل على واتساب لتأكيد الدفع قبل تجهيز الطلب.'
        },
        {
          id: 'cod',
          label: 'الدفع عند الاستلام',
          short: 'الدفع عند الاستلام',
          description: 'بلا خصم، وتُضاف رسوم التوصيل: 2 دولار داخل حماة، 4 دولارات لباقي المحافظات.',
          discountPercent: 0,
          freeDeliveryIn: [],
          requiresReceipt: false,
          available: true,
          confirmNote: 'يُدفع المبلغ كاملًا عند استلام الطلب.'
        }
      ]
    },

    imagery: {
      hero: {
        base: 'hero-wide',
        avif: ['hero-wide-480.avif', 'hero-wide-720.avif', 'hero-wide-1080.avif', 'hero-wide-1400.avif', 'hero-wide-1600.avif'],
        webp: ['hero-wide-480.webp', 'hero-wide-720.webp', 'hero-wide-1080.webp', 'hero-wide-1400.webp', 'hero-wide-1600.webp'],
        widths: [480, 720, 1080, 1400, 1600],
        src: 'assets/img/products/hero-wide-1080.jpg',
        width: 1080,
        height: 540,
        alt: 'تصور تصميمي للأحجام الثلاثة لسيروم رواء على سطح فاتح بإضاءة ناعمة — وليست صورة منتج مُصنَّع'
      },
      trio: {
        base: 'trio',
        avif: ['trio-480.avif', 'trio-720.avif', 'trio-1080.avif', 'trio-1400.avif'],
        webp: ['trio-480.webp', 'trio-720.webp', 'trio-1080.webp', 'trio-1400.webp'],
        widths: [480, 720, 1080, 1400],
        src: 'assets/img/products/trio-1080.jpg',
        width: 1080,
        height: 810,
        alt: 'الأحجام الثلاثة لسيروم رواء 30 و50 و100 مل بجانب بعضها — تصور تصميمي'
      },
      editorial: {
        base: 'editorial',
        avif: ['editorial-480.avif', 'editorial-720.avif', 'editorial-900.avif'],
        webp: ['editorial-480.webp', 'editorial-720.webp', 'editorial-900.webp'],
        widths: [480, 720, 900],
        src: 'assets/img/products/editorial-720.jpg',
        width: 720,
        height: 1029,
        alt: 'صورة تحريرية لعبوة سيروم رواء بإضاءة جانبية ناعمة — تصور تصميمي'
      },
      detail: {
        base: 'detail-label',
        avif: ['detail-label-480.avif', 'detail-label-720.avif', 'detail-label-900.avif'],
        webp: ['detail-label-480.webp', 'detail-label-720.webp', 'detail-label-900.webp'],
        widths: [480, 720, 900],
        src: 'assets/img/products/detail-label-720.jpg',
        width: 720,
        height: 720,
        alt: 'مقربة من ملصق عبوة رواء يظهر الاسم والشعار — تصور تصميمي'
      }
    },


    /**
     * تكلفة الوحدة — من صاحب المشروع: 3.00 دولار تشمل السيروم والتغليف لحجم 100 مل.
     * تفصيل التكلفة لكل حجم غير معروف بعد، فنستخدم توزيعًا تقديريًا:
     * تكلفة ثابتة 1.20$ للتغليف + 0.018$ لكل ملليلتر.
     * 🔴 يجب استبدالها بتكلفة المصنع الفعلية قبل التصنيع.
     */
    costing: {
      source: 'owner-estimate',
      cost100ml: 3.00,
      fixedCost: 1.20,
      perMl: 0.018,
      note: 'تقديري — لم يُؤكَّد تفصيل التكلفة لكل حجم من المصنع.'
    },

    cart: {
      maxQuantityPerItem: 10,
      minQuantityPerItem: 1
    },

    /**
     * ما يُطلب تأكيده من الزبونة داخل رسالة واتساب.
     * لا تُحذف هذه البنود: هي التي تُبقي الرسالة استفسارًا لا بيعًا مؤكدًا.
     */
    order: {
      confirmationPoints: [
        'تأكيد توفّر الأحجام المطلوبة',
        'تأكيد السعر النهائي لهذا الطلب',
        'تأكيد رسوم التوصيل وموعده',
        'تأكيد تفاصيل الدفع'
      ],
      greeting: 'مرحبًا رواء،',
      intro: 'أرغب بالاستفسار عن السيروم وطلب الأحجام التالية:'
    }
  };

  // تجميد الإعدادات لمنع التعديل العشوائي أثناء التشغيل.
  function deepFreeze(value) {
    Object.getOwnPropertyNames(value).forEach(function (key) {
      var prop = value[key];
      if (prop && typeof prop === 'object' && !Object.isFrozen(prop)) {
        deepFreeze(prop);
      }
    });
    return Object.freeze(value);
  }

  window.RAWAA_CONFIG = deepFreeze(config);
})();
