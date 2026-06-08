/* ============================================================
   Студія масажу Oliva — i18n (UA / EN)
   Перемикач у панелі; вибір зберігається в localStorage.
   Кожен текст у HTML має атрибут data-i18n="ключ".
   ============================================================ */
(function () {
  "use strict";

  var DICT = {
    uk: {
      "top.address": "Київ, вул. Борщагівська, 145",
      "top.hours": "Щодня 9:00 – 21:30",

      "nav.home": "Головна", "nav.services": "Послуги", "nav.prices": "Прайси",
      "nav.gallery": "Галерея", "nav.phyto": "Фітобочка", "nav.team": "Майстри",
      "nav.contacts": "Контакти", "nav.book": "Онлайн запис",

      "hero.eyebrow": "Студія масажу · Київ",
      "hero.title1": "Тут твоє", "hero.title2": "відновлення", "hero.title3": "починається",
      "hero.desc": "Місце, де ти можеш зупинитись, видихнути і відновити своє тіло. Працюємо з напругою глибоко — щоб ти відчув легкість вже після першого сеансу.",
      "hero.cta1": "Записатися онлайн", "hero.cta2": "Переглянути послуги",
      "hero.badgeAddr": "Борщагівська, 145", "hero.badgeDaily": "щодня",

      "mq.1": "Загально-оздоровчий масаж", "mq.2": "Парний масаж", "mq.3": "Антицелюлітний масаж",
      "mq.4": "SPA-ритуали", "mq.5": "Спортивний масаж", "mq.6": "Фітобочка",
      "mq.7": "Масаж обличчя", "mq.8": "Топ майстри",

      "srv.label": "Наші послуги", "srv.title1": "Оберіть свій", "srv.title2": "сеанс відновлення",
      "srv.tab.top": "Топ послуги", "srv.tab.complex": "Комплекси", "srv.tab.spa": "SPA-ритуали",
      "srv.tab.master": "Прайс Майстер", "srv.tab.topmaster": "Прайс Топ Майстер",

      "s.top.1": "Загально-оздоровчий масаж (Топ Майстер) 60 хв",
      "s.top.2": "Парний масаж 60 хв",
      "s.top.3": "Загально-оздоровчий масаж (Топ Майстер) 90 хв",
      "s.top.4": "Класичний масаж обличчя (Топ Майстер) 60 хв",
      "s.top.5": "Антицелюлітний масаж (Топ Майстер) 60 хв",
      "s.top.6": "Спортивний масаж (Топ Майстер) 60 хв",
      "s.top.7": "Фітобочка (кедрова) 30 хв",
      "s.top.8": "Загально-оздоровчий масаж (Майстер) 60 хв",

      "s.cx.1": "Комплекс для схуднення та корекції фігури",
      "s.cx.2": "Антицелюлітний комплекс (курс 10 сеансів)",
      "s.cx.3": "Лімфодренажний масаж + обгортання",
      "s.cx.4": "Масаж спини + шия + голова",

      "s.spa.1": "Фірмовий SPA-ритуал «Oliva» (масаж + маска + аромат)",
      "s.spa.2": "Парний SPA-ритуал для двох",
      "s.spa.3": "Релакс-ритуал «Відновлення» (тіло + обличчя)",
      "s.spa.4": "Фітобочка + масаж спини (детокс-ритуал)",

      "s.m.1": "Загально-оздоровчий масаж (Майстер) 45 хв",
      "s.m.2": "Загально-оздоровчий масаж (Майстер) 60 хв",
      "s.m.3": "Загально-оздоровчий масаж (Майстер) 90 хв",
      "s.m.4": "Антицелюлітний масаж (Майстер) 60 хв",
      "s.m.5": "Спортивний масаж (Майстер) 60 хв",
      "s.m.6": "Парний масаж (Майстер) 60 хв",

      "s.tm.1": "Загально-оздоровчий масаж (Топ Майстер) 45 хв",
      "s.tm.2": "Загально-оздоровчий масаж (Топ Майстер) 60 хв",
      "s.tm.3": "Загально-оздоровчий масаж (Топ Майстер) 90 хв",
      "s.tm.4": "Антицелюлітний масаж (Топ Майстер) 60 хв",
      "s.tm.5": "Спортивний масаж (Топ Майстер) 60 хв",
      "s.tm.6": "Класичний масаж обличчя (Топ Майстер) 60 хв",
      "s.tm.7": "Парний масаж (Топ Майстер) 60 хв",
      "s.tm.8": "Загально-оздоровчий масаж (Топ Майстер) 120 хв",

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
      "why.stat": "роки досвіду",
      "why.f1t": "Глибока робота з тілом", "why.f1d": "Працюємо з напругою глибоко — знімаємо затиски, покращуємо кровообіг та відновлюємо рухливість.",
      "why.f2t": "Сертифіковані майстри", "why.f2d": "Лише майстри з підтвердженою кваліфікацією та постійним підвищенням майстерності.",
      "why.f3t": "Зручний час", "why.f3d": "Приймаємо щодня з 09:00 до 21:30. Легко записатися онлайн у зручний час.",

      "cta.title": "Подаруй відновлення",
      "cta.sub": "Подарунковий сертифікат на масаж або фітобочку — завжди влучний подарунок",
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
      "nav.gallery": "Gallery", "nav.phyto": "Phyto-barrel", "nav.team": "Therapists",
      "nav.contacts": "Contacts", "nav.book": "Book online",

      "hero.eyebrow": "Massage studio · Kyiv",
      "hero.title1": "Your", "hero.title2": "recovery", "hero.title3": "starts here",
      "hero.desc": "A place to stop, breathe out and restore your body. We work deeply with tension — so you feel lightness already after the first session.",
      "hero.cta1": "Book online", "hero.cta2": "View services",
      "hero.badgeAddr": "Borshchahivska, 145", "hero.badgeDaily": "daily",

      "mq.1": "Wellness massage", "mq.2": "Couples massage", "mq.3": "Anti-cellulite massage",
      "mq.4": "SPA rituals", "mq.5": "Sports massage", "mq.6": "Phyto-barrel",
      "mq.7": "Face massage", "mq.8": "Top therapists",

      "srv.label": "Our services", "srv.title1": "Choose your", "srv.title2": "recovery session",
      "srv.tab.top": "Top services", "srv.tab.complex": "Packages", "srv.tab.spa": "SPA rituals",
      "srv.tab.master": "Price · Master", "srv.tab.topmaster": "Price · Top Master",

      "s.top.1": "Wellness massage (Top Master) 60 min",
      "s.top.2": "Couples massage 60 min",
      "s.top.3": "Wellness massage (Top Master) 90 min",
      "s.top.4": "Classic face massage (Top Master) 60 min",
      "s.top.5": "Anti-cellulite massage (Top Master) 60 min",
      "s.top.6": "Sports massage (Top Master) 60 min",
      "s.top.7": "Phyto-barrel (cedar) 30 min",
      "s.top.8": "Wellness massage (Master) 60 min",

      "s.cx.1": "Slimming & body-shaping package",
      "s.cx.2": "Anti-cellulite package (course of 10)",
      "s.cx.3": "Lymphatic drainage + body wrap",
      "s.cx.4": "Back + neck + head massage",

      "s.spa.1": "Signature SPA ritual “Oliva” (massage + mask + aroma)",
      "s.spa.2": "Couples SPA ritual for two",
      "s.spa.3": "Relax ritual “Recovery” (body + face)",
      "s.spa.4": "Phyto-barrel + back massage (detox ritual)",

      "s.m.1": "Wellness massage (Master) 45 min",
      "s.m.2": "Wellness massage (Master) 60 min",
      "s.m.3": "Wellness massage (Master) 90 min",
      "s.m.4": "Anti-cellulite massage (Master) 60 min",
      "s.m.5": "Sports massage (Master) 60 min",
      "s.m.6": "Couples massage (Master) 60 min",

      "s.tm.1": "Wellness massage (Top Master) 45 min",
      "s.tm.2": "Wellness massage (Top Master) 60 min",
      "s.tm.3": "Wellness massage (Top Master) 90 min",
      "s.tm.4": "Anti-cellulite massage (Top Master) 60 min",
      "s.tm.5": "Sports massage (Top Master) 60 min",
      "s.tm.6": "Classic face massage (Top Master) 60 min",
      "s.tm.7": "Couples massage (Top Master) 60 min",
      "s.tm.8": "Wellness massage (Top Master) 120 min",

      "dur.30": "30 minutes", "dur.45": "45 min", "dur.60": "1 hour",
      "dur.60s": "1 hr", "dur.90": "1 hr 30 min", "dur.120": "2 hrs",
      "uah": "UAH", "book": "Book", "from": "from",

      "gal.label": "Atmosphere", "gal.title": "Studio gallery", "gal.more": "More on Instagram →",

      "phyto.badge": "Cedar phyto-barrel",
      "phyto.label": "Warmth worth gifting",
      "phyto.title": "Phyto-barrel",
      "phyto.lead": "Not just a procedure. Not just steam. It’s deep muscle warming, gentle body cleansing, relaxation without strain on the heart ❤️",
      "phyto.p1": "Your head stays outside — you breathe freely while the body slowly lets go of tension.",
      "phyto.giftTitle": "🎁 Gift certificate for a phyto-barrel session",
      "phyto.g1": "— for a loved one", "phyto.g2": "— for mom",
      "phyto.g3": "— for him after the gym", "phyto.g4": "— or just “because you’re tired”",
      "phyto.warm": "Warmth is always spot-on. Care is always in season.",
      "phyto.loc": "Shuliavka, Solomianskyi district",
      "phyto.cta": "Gift a certificate", "phyto.reel": "Watch the reel ↗",

      "team.label": "Our team", "team.title1": "Therapists", "team.title2": "you can trust",
      "team.sub": "Each of our therapists is a certified specialist with years of experience in massage therapy and body recovery.",
      "team.roleTop": "Top therapist", "team.roleMaster": "Therapist", "team.roleMasterM": "Therapist",

      "why.label": "About the studio", "why.title1": "Solomianskyi district,", "why.title2": "next to the metro",
      "why.sub": "Massage in Kyiv, Solomianskyi district — next to Shuliavska metro. A convenient spot to recover after work or training.",
      "why.stat": "years of experience",
      "why.f1t": "Deep bodywork", "why.f1d": "We work deeply with tension — release knots, improve circulation and restore mobility.",
      "why.f2t": "Certified therapists", "why.f2d": "Only therapists with confirmed qualifications and constant skill development.",
      "why.f3t": "Convenient hours", "why.f3d": "Open daily from 09:00 to 21:30. Easy to book online at a convenient time.",

      "cta.title": "Gift recovery",
      "cta.sub": "A gift certificate for a massage or phyto-barrel — always a perfect present",
      "cta.buy": "Buy a certificate →", "cta.book": "Book online",

      "con.label": "Where to find us", "con.title": "Contacts",
      "con.addr": "Address", "con.addrVal": "Kyiv, Borshchahivska St, 145",
      "con.phone": "Phone", "con.hours": "Working hours", "con.hoursVal": "Daily 09:00 — 21:30",
      "con.email": "Email", "con.openMap": "Open in Google Maps →",

      "footer.copy": "© 2026 Oliva Massage Studio · Kyiv, Solomianskyi district",

      "chat.name": "Oliva Administrator", "chat.status": "Usually replies quickly",
      "chat.greet": "Hi! 👋 This is Oliva massage studio. We’ll help with services, prices or booking. How is it easier to reach us?",
      "chat.call": "📞 Call us",

      "sticky.book": "Book online"
    }
  };

  function apply(lang) {
    var dict = DICT[lang] || DICT.uk;
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (dict[key] != null) el.textContent = dict[key];
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-placeholder");
      if (dict[key] != null) el.setAttribute("placeholder", dict[key]);
    });
    document.querySelectorAll(".lang-switch button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-lang") === lang);
    });
    try { localStorage.setItem("oliva_lang", lang); } catch (e) {}
  }

  // Експортуємо мінімальний API
  window.OlivaI18n = {
    apply: apply,
    get: function () {
      try { return localStorage.getItem("oliva_lang") || "uk"; } catch (e) { return "uk"; }
    }
  };

  // Застосувати збережену мову одразу
  apply(window.OlivaI18n.get());
})();
