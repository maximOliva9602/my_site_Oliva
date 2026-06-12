/* ============================================================
   Студія масажу Oliva — i18n (UA / EN)
   Перемикач у панелі; вибір зберігається в localStorage.
   Кожен текст у HTML має атрибут data-i18n="ключ".
   Назви послуг та категорій перекладаються фразово через SRV_PHRASES.
   ============================================================ */
(function () {
  "use strict";

  var DICT = {
    uk: {
      "top.address": "Київ, вул. Борщагівська, 145",
      "top.hours": "Щодня 9:00 – 21:30",

      "nav.home": "Головна", "nav.services": "Послуги", "nav.prices": "Прайси",
      "nav.gallery": "Акції", "nav.phyto": "Фітобочка", "nav.team": "Майстри",
      "nav.contacts": "Контакти", "nav.book": "Онлайн запис",
      "nav.cert": "🎁 Сертифікат", "nav.tips": "🤍 Чайові", "nav.review": "✍️ Відгук",
      "nav.blog": "Блог", "nav.shop": "Магазин", "nav.training": "Навчання",

      "hero.eyebrow": "Студія масажу OLIVA",
      "hero.title1": "Тут починається", "hero.title2": "твоє відновлення", "hero.title3": "",
      "hero.desc": "",
      "hero.cta1": "Записатися онлайн", "hero.cta2": "Переглянути послуги",
      "hero.badgeAddr": "Борщагівська, 145", "hero.badgeDaily": "щодня",

      "mq.1": "Загально-оздоровчий масаж", "mq.2": "Парний масаж", "mq.3": "Антицелюлітний масаж",
      "mq.4": "SPA-ритуали", "mq.5": "Спортивний масаж", "mq.6": "Фітобочка",
      "mq.7": "Масаж обличчя", "mq.8": "Топ майстри",

      "srv.label": "Наші послуги", "srv.title1": "Оберіть свій", "srv.title2": "сеанс відновлення",
      "srv.tab.top": "Популярні", "srv.tab.all": "Усі послуги",
      "srv.tab.complex": "Комплекси", "srv.tab.spa": "SPA-ритуали",
      "srv.tab.master": "Прайс Майстер", "srv.tab.topmaster": "Прайс Топ Майстер",

      "dur.30": "30 хвилин", "dur.45": "45 хв.", "dur.60": "1 година",
      "dur.60s": "1 год.", "dur.90": "1 год. 30 хв.", "dur.120": "2 год.",
      "uah": "грн", "book": "Записатися", "from": "від",

      "gal.label": "Атмосфера", "gal.title": "Галерея студії", "gal.more": "Більше в Instagram →",

      "phyto.badge": "Кедрова фітобочка",
      "phyto.label": "Тепло, яке хочеться подарувати",
      "phyto.title": "Фітобочка",
      "phyto.lead": "Не просто процедура. Не просто пар. Це глибоке прогрівання м'язів, м'яке очищення організму, розслаблення без навантаження на серце ❤️",
      "phyto.p1": "Голова залишається зовні — ви дихаєте вільно, а тіло повільно відпускає напругу.",
      "phyto.giftTitle": "🎁 Подарунковий сертифікат на фітобочку",
      "phyto.g1": "— для коханої людини", "phyto.g2": "— для мами",
      "phyto.g3": "— для чоловіка після спорту", "phyto.g4": "— або просто «бо ти втомилась»",
      "phyto.warm": "Тепло — це завжди влучно. Турбота — завжди актуально.",
      "phyto.loc": "Шулявка, Солом'янський район",
      "phyto.cta": "Подарувати сертифікат", "phyto.reel": "Дивитись reel ↗",

      "team.label": "Наша команда", "team.title1": "Фахівці, яким", "team.title2": "довіряють",
      "team.sub": "Кожен наш майстер — сертифікований спеціаліст з багаторічним досвідом у масажній терапії та відновленні тіла.",
      "team.roleTop": "Топ-майстер", "team.roleMaster": "Майстриня", "team.roleMasterM": "Майстер",

      "why.label": "Про студію", "why.title1": "Солом'янський район,", "why.title2": "поруч з метро",
      "why.sub": "Масаж у Києві, Солом'янський район — поруч із метро Шулявська. Зручна локація, де можна відновитися після роботи або тренування.",
      "why.stat": "задоволених клієнтів",
      "why.f1t": "Глибока робота з тілом", "why.f1d": "Працюємо з напругою глибоко — знімаємо затиски, покращуємо кровообіг та відновлюємо рухливість.",
      "why.f2t": "Сертифіковані майстри", "why.f2d": "Лише майстри з підтвердженою кваліфікацією та постійним підвищенням майстерності.",
      "why.f3t": "Зручний час", "why.f3d": "Приймаємо щодня з 09:00 до 21:30. Легко записатися онлайн у зручний час.",

      "cta.label": "Подарунок, який відчуваєш",
      "cta.title": "СЕРТИФІКАТ",
      "cta.sub": "Подаруй відпочинок у студії масажу —\nзавжди влучний подарунок",
      "cta.buy": "Купити сертифікат →", "cta.book": "Записатися онлайн",

      "con.label": "Де нас знайти", "con.title": "Контакти",
      "con.addr": "Адреса", "con.addrVal": "Київ, вул. Борщагівська, 145",
      "con.phone": "Телефон", "con.hours": "Графік роботи", "con.hoursVal": "Щодня 09:00 — 21:30",
      "con.email": "Пошта", "con.openMap": "Відкрити в Google Maps →",

      "footer.copy": "© 2026 Студія масажу Oliva · Київ, Солом'янський район",

      "chat.name": "Адміністратор Oliva", "chat.status": "Зазвичай відповідає швидко",
      "chat.greet": "Вітаю! 👋 Це студія масажу Oliva. Підкажемо з послугами, цінами чи записом. Як зручніше зв'язатися?",
      "chat.call": "📞 Подзвонити",

      "sticky.book": "Записатися онлайн"
    },

    en: {
      "top.address": "Kyiv, Borshchahivska St, 145",
      "top.hours": "Daily 9:00 – 21:30",

      "nav.home": "Home", "nav.services": "Services", "nav.prices": "Prices",
      "nav.gallery": "Promotions", "nav.phyto": "Phyto-barrel", "nav.team": "Therapists",
      "nav.contacts": "Contacts", "nav.book": "Book online",
      "nav.cert": "🎁 Gift Card", "nav.tips": "🤍 Tips", "nav.review": "✍️ Review",
      "nav.blog": "Blog", "nav.shop": "Shop", "nav.training": "Training",

      "hero.eyebrow": "Massage Studio OLIVA",
      "hero.title1": "Here begins", "hero.title2": "your recovery", "hero.title3": "",
      "hero.desc": "",
      "hero.cta1": "Book online", "hero.cta2": "View services",
      "hero.badgeAddr": "Borshchahivska, 145", "hero.badgeDaily": "daily",

      "mq.1": "Wellness massage", "mq.2": "Couples massage", "mq.3": "Anti-cellulite massage",
      "mq.4": "SPA rituals", "mq.5": "Sports massage", "mq.6": "Phyto-barrel",
      "mq.7": "Face massage", "mq.8": "Top therapists",

      "srv.label": "Our services", "srv.title1": "Choose your", "srv.title2": "recovery session",
      "srv.tab.top": "Popular", "srv.tab.all": "All services",
      "srv.tab.complex": "Packages", "srv.tab.spa": "SPA rituals",
      "srv.tab.master": "Price · Master", "srv.tab.topmaster": "Price · Top Master",

      "dur.30": "30 minutes", "dur.45": "45 min", "dur.60": "1 hour",
      "dur.60s": "1 hr", "dur.90": "1 hr 30 min", "dur.120": "2 hrs",
      "uah": "UAH", "book": "Book", "from": "from",

      "gal.label": "Atmosphere", "gal.title": "Studio gallery", "gal.more": "More on Instagram →",

      "phyto.badge": "Cedar phyto-barrel",
      "phyto.label": "Warmth worth gifting",
      "phyto.title": "Phyto-barrel",
      "phyto.lead": "Not just a procedure. Not just steam. It's deep muscle warming, gentle body cleansing, relaxation without strain on the heart ❤️",
      "phyto.p1": "Your head stays outside — you breathe freely while the body slowly lets go of tension.",
      "phyto.giftTitle": "🎁 Gift certificate for a phyto-barrel session",
      "phyto.g1": "— for a loved one", "phyto.g2": "— for mom",
      "phyto.g3": "— for him after the gym", "phyto.g4": "— or just \"because you're tired\"",
      "phyto.warm": "Warmth is always spot-on. Care is always in season.",
      "phyto.loc": "Shuliavka, Solomianskyi district",
      "phyto.cta": "Gift a certificate", "phyto.reel": "Watch the reel ↗",

      "team.label": "Our team", "team.title1": "Therapists", "team.title2": "you can trust",
      "team.sub": "Each of our therapists is a certified specialist with years of experience in massage therapy and body recovery.",
      "team.roleTop": "Top therapist", "team.roleMaster": "Therapist", "team.roleMasterM": "Therapist",

      "why.label": "About the studio", "why.title1": "Solomianskyi district,", "why.title2": "next to the metro",
      "why.sub": "Massage in Kyiv, Solomianskyi district — next to Shuliavska metro. A convenient spot to recover after work or training.",
      "why.stat": "satisfied clients",
      "why.f1t": "Deep bodywork", "why.f1d": "We work deeply with tension — release knots, improve circulation and restore mobility.",
      "why.f2t": "Certified therapists", "why.f2d": "Only therapists with confirmed qualifications and constant skill development.",
      "why.f3t": "Convenient hours", "why.f3d": "Open daily from 09:00 to 21:30. Easy to book online at a convenient time.",

      "cta.label": "A gift you feel",
      "cta.title": "CERTIFICATE",
      "cta.sub": "Gift a massage studio experience —\nalways a perfect present",
      "cta.buy": "Buy a certificate →", "cta.book": "Book online",

      "con.label": "Where to find us", "con.title": "Contacts",
      "con.addr": "Address", "con.addrVal": "Kyiv, Borshchahivska St, 145",
      "con.phone": "Phone", "con.hours": "Working hours", "con.hoursVal": "Daily 09:00 — 21:30",
      "con.email": "Email", "con.openMap": "Open in Google Maps →",

      "footer.copy": "© 2026 Oliva Massage Studio · Kyiv, Solomianskyi district",

      "chat.name": "Oliva Administrator", "chat.status": "Usually replies quickly",
      "chat.greet": "Hi! 👋 This is Oliva massage studio. We'll help with services, prices or booking. How is it easier to reach us?",
      "chat.call": "📞 Call us",

      "sticky.book": "Book online"
    }
  };

  /* -------------------------------------------------------
     Фразовий словник для послуг (UA → EN)
     Порядок важливий: специфічніші фрази — першими.
  ------------------------------------------------------- */
  var SRV_PHRASES = [
    // SPA rituals (specific first)
    ['SPA Ритуал "Фіто-оновлення тіла"',           'SPA Ritual "Phyto Body Renewal"'],
    ['Тепловий SPA-ритуал "Глибоке прогрівання для двох"', 'Thermal SPA ritual "Deep Warming for Two"'],
    ['Обгортання Amore Shemen (гаряче)',             'Amore Shemen wrap (hot)'],
    ['Обгортання Amore Shemen (холодне)',            'Amore Shemen wrap (cold)'],
    ['Обгортання Amore Shemen',                      'Amore Shemen wrap'],
    ['Обгортання Bruno Vassari Detox',               'Bruno Vassari Detox wrap'],
    ['Гаряче (бандажне) обгортання SPA Seaweed',    'Hot bandage wrap SPA Seaweed'],
    ['🔥 Гаряча експрес-трансформація тіла',        '🔥 Hot Express Body Transformation'],
    ['❄️ Холодне моделювання тіла',                 '❄️ Cold Body Sculpting'],
    ['🔥 Гаряче моделювання тіла',                  '🔥 Hot Body Sculpting'],
    // Service types
    ['Загально-оздоровчий масаж',                   'Wellness massage'],
    ['Антистресовий масаж',                          'Anti-stress massage'],
    ['Парний масаж',                                 'Couples massage'],
    ['Масаж спини',                                  'Back massage'],
    ['Масаж шийно-комірцевої зони',                  'Neck & shoulder massage'],
    ['Класичний масаж обличчя',                      'Classic face massage'],
    ['Лімфодренажний масаж',                         'Lymphatic drainage massage'],
    ['Антицелюлітний масаж',                         'Anti-cellulite massage'],
    ['Паріння у фітобочці',                          'Phyto-barrel steam'],
    ['Дитячий масаж',                                "Children's massage"],
    ['Масаж в чотири руки',                          'Four-hands massage'],
    ['Масаж гарячим камінням',                       'Hot stone massage'],
    ['SPA-ритуали',                                  'SPA rituals'],
    // Level suffixes
    ['(Топ Майстер)',                                '(Top Master)'],
    ['(Майстер)',                                    '(Master)'],
    // Duration words (after service names to avoid conflicts)
    [' хв',                                          ' min'],
    [' год. 40 хв.',                                 ' hr 40 min'],
    [' год. 30 хв.',                                 ' hr 30 min'],
    [' год. 15 хв.',                                 ' hr 15 min'],
    [' год. 10 хв.',                                 ' hr 10 min'],
    [' год.',                                        ' hr'],
    ['год',                                          'hr'],
  ];

  /* Translate a single text using the phrase dictionary */
  function translateText(text, lang) {
    if (lang === 'uk') return text; // UK — original, handled via data-uk restore
    var result = text;
    for (var i = 0; i < SRV_PHRASES.length; i++) {
      // Simple global replace of all occurrences
      result = result.split(SRV_PHRASES[i][0]).join(SRV_PHRASES[i][1]);
    }
    return result;
  }

  /* Apply phrase-based translation to all service content elements */
  function applyServicePhrases(lang) {
    var selectors = [
      '.srv-card-name',
      '.srv-list-name',
      '.srv-category-label',
      '.srv-list-dur',
    ];
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        // Save original Ukrainian text on first encounter
        if (!el.hasAttribute('data-uk')) {
          el.setAttribute('data-uk', el.textContent);
        }
        if (lang === 'uk') {
          el.textContent = el.getAttribute('data-uk');
        } else {
          el.textContent = translateText(el.getAttribute('data-uk'), lang);
        }
      });
    });

    // Translate "Book" buttons in service lists that have no data-i18n
    var dict = DICT[lang] || DICT.uk;
    document.querySelectorAll('.srv-card-btn:not([data-i18n])').forEach(function (el) {
      if (!el.hasAttribute('data-uk')) {
        el.setAttribute('data-uk', el.textContent);
      }
      el.textContent = lang === 'uk' ? (el.getAttribute('data-uk') || dict['book']) : dict['book'];
    });

    // Currency in list items (.cur span)
    document.querySelectorAll('.cur').forEach(function (el) {
      if (!el.hasAttribute('data-uk')) {
        el.setAttribute('data-uk', el.textContent);
      }
      el.textContent = lang === 'uk' ? (el.getAttribute('data-uk') || ' грн') : ' UAH';
    });
  }

  function apply(lang) {
    var dict = DICT[lang] || DICT.uk;
    document.documentElement.lang = lang;

    // Standard data-i18n elements
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (dict[key] != null) el.textContent = dict[key];
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-placeholder");
      if (dict[key] != null) el.setAttribute("placeholder", dict[key]);
    });

    // Phrase-based service content
    applyServicePhrases(lang);

    // Language switcher buttons state
    document.querySelectorAll(".lang-switch button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-lang") === lang);
    });

    try { localStorage.setItem("oliva_lang", lang); } catch (e) {}
  }

  // Мінімальний публічний API
  window.OlivaI18n = {
    apply: apply,
    get: function () {
      try { return localStorage.getItem("oliva_lang") || "uk"; } catch (e) { return "uk"; }
    }
  };

  // Застосувати збережену мову одразу
  apply(window.OlivaI18n.get());
})();
