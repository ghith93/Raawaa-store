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
      city: 'الرقة',
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
          alt: 'تصور تصميمي لعبوة سيروم رواء بحجم 30 مل على حافة حجرية — ليس صورة منتج مُصنَّع'
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
          alt: 'تصور تصميمي لعبوة سيروم رواء بحجم 50 مل على حافة حجرية — ليس صورة منتج مُصنَّع'
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
          alt: 'تصور تصميمي لعبوة سيروم رواء بحجم 100 مل على حافة حجرية — ليس صورة منتج مُصنَّع'
        }
      }
    ],

    /**
     * طرق الدفع والدفع-عند-الاستلام.
     * جميع القيم معرَّفة من صاحب المشروع. الخصم والرسوم تُحسب في السلة
     * ويظهر أثرها بالتفصيل في رسالة واتساب — لا يُخصم شيء تلقائيًا على أي بوابة.
     * `available: false` تعني أن الخيار معروض للمعلومة دون إمكانية اختياره.
     */
    payment: {
      title: 'طريقة الدفع',
      freeDeliveryNote: 'التوصيل المجاني يسري داخل الرقة على الطلبات المدفوعة عبر شام كاش.',
      methods: [
        {
          id: 'shamcash',
          label: 'شام كاش',
          short: 'شام كاش',
          description: 'خصم 10% على قيمة المنتجات + توصيل مجاني.',
          discountPercent: 10,
          deliveryFee: 0,
          freeDelivery: true,
          requiresReceipt: true,
          available: true,
          confirmNote: 'يُرسَل إشعار التحويل على واتساب لتأكيد الدفع قبل تجهيز الطلب.'
        },
        {
          id: 'cod',
          label: 'الدفع عند الاستلام',
          short: 'الدفع عند الاستلام',
          description: 'بلا خصم، ورسوم توصيل 2 دولار تُضاف إلى الإجمالي.',
          discountPercent: 0,
          deliveryFee: 2,
          freeDelivery: false,
          requiresReceipt: false,
          available: true,
          confirmNote: 'يُدفع المبلغ كاملًا عند استلام الطلب.'
        }
      ]
    },

    imagery: {
      hero: {
        base: 'hero-wide',
        avif: ['hero-wide-480.avif', 'hero-wide-720.avif', 'hero-wide-1080.avif', 'hero-wide-1312.avif'],
        webp: ['hero-wide-480.webp', 'hero-wide-720.webp', 'hero-wide-1080.webp', 'hero-wide-1312.webp'],
        widths: [480, 720, 1080, 1312],
        src: 'assets/img/products/hero-wide-1080.jpg',
        width: 1080,
        height: 672,
        alt: 'تصور تصميمي لعبوة سيروم رواء على حافة حجرية بجانب قماش زيتوني وغصن زيتون'
      },
      trio: {
        base: 'trio-wide',
        avif: ['trio-wide-480.avif', 'trio-wide-720.avif', 'trio-wide-1080.avif', 'trio-wide-1312.avif'],
        webp: ['trio-wide-480.webp', 'trio-wide-720.webp', 'trio-wide-1080.webp', 'trio-wide-1312.webp'],
        widths: [480, 720, 1080, 1312],
        src: 'assets/img/products/trio-wide-1080.jpg',
        width: 1080,
        height: 672,
        alt: 'الأحجام الثلاثة لسيروم رواء 30 و50 و100 مل — تصور تصميمي'
      },
      editorial: {
        base: 'editorial-portrait',
        avif: ['editorial-portrait-480.avif', 'editorial-portrait-720.avif', 'editorial-portrait-768.avif'],
        webp: ['editorial-portrait-480.webp', 'editorial-portrait-720.webp', 'editorial-portrait-768.webp'],
        widths: [480, 720, 768],
        src: 'assets/img/products/editorial-portrait-720.jpg',
        width: 720,
        height: 1290,
        alt: 'صورة تحريرية لعبوة سيروم رواء بين قماش كتاني وغصن زيتون'
      },
      detail: {
        base: 'detail-label',
        avif: ['detail-label-480.avif', 'detail-label-720.avif', 'detail-label-900.avif'],
        webp: ['detail-label-480.webp', 'detail-label-720.webp', 'detail-label-900.webp'],
        widths: [480, 720, 900],
        src: 'assets/img/products/detail-label-720.jpg',
        width: 720,
        height: 720,
        alt: 'مقربة من غطاء وملصق عبوة سيروم رواء'
      }
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
