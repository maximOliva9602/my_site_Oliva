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
      "nav.cert": "🎁 Сертифікат", "nav.tips": "Чайові", "nav.review": "Відгук",
      "nav.share": "💬 Поділитися враженнями",
      "nav.blog": "Блог", "nav.shop": "Магазин", "nav.training": "Навчання",

      "hero.eyebrow": "Студія масажу OLIVA",
      "hero.brand1": "Студія масажу",
      "hero.title1": "Тут починається", "hero.title2": "твоє відновлення", "hero.title3": "",
      "hero.desc": "",
      "hero.cta1": "Записатися онлайн", "hero.cta2": "Переглянути послуги",
      "hero.badgeAddr": "Борщагівська, 145", "hero.badgeDaily": "щодня",

      "mq.1": "Загально-оздоровчий масаж", "mq.2": "Парний масаж", "mq.3": "Антицелюлітний масаж",
      "mq.4": "SPA-ритуали", "mq.5": "Спортивний масаж", "mq.6": "Фітобочка",
      "mq.7": "Масаж обличчя", "mq.8": "Топ майстри",

      "srv.label": "Наші послуги", "srv.title1": "Оберіть свій", "srv.title2": "сеанс відновлення",
      "srv.tab.top": "Популярні",
      "srv.tab.complex": "Комплекси", "srv.tab.spa": "SPA-ритуали",
      "srv.tab.general": "Масажі", "srv.tab.spa2": "SPA для двох", "srv.tab.spa1": "SPA для одного",
      "srv.tab.body": "Корекція фігури", "srv.tab.extra": "Додаткові послуги",
      "srv.tier.label": "Рівень майстра:", "srv.tier.master": "Майстер", "srv.tier.top": "Топ Майстер",

      "dur.30": "30 хвилин", "dur.45": "45 хв.", "dur.60": "1 година",
      "dur.60s": "1 год.", "dur.90": "1 год. 30 хв.", "dur.120": "2 год.",
      "uah": "грн", "book": "Записатися", "from": "від",

      "car.label": "Наші послуги",
      "car.title": "Оберіть свій сеанс",
      "car.book": "Записатися →",
      "car.s1name": "Парний масаж",
      "car.s1price": "від 2 700 грн",
      "car.s2name": "Загально-оздоровчий масаж",
      "car.s2price": "від 700 грн",
      "car.s3name": "SPA-ритуали",
      "car.s3price": "від 2 150 грн",
      "car.s4name": "Обгортання для схуднення",
      "car.s4price": "від 1 600 грн",
      "car.s5name": "Апаратні масажі",
      "car.s5price": "від 700 грн",

      "promo.label": "Спеціальні пропозиції",
      "promo.title1": "Акції",
      "promo.title2": "та знижки",
      "promo.t1": "Абонементи",
      "promo.r1n": "Курс 5 сеансів масажу",
      "promo.r1s": "Дійсний 2 місяці",
      "promo.r2n": "Курс 10 сеансів масажу",
      "promo.r2s": "Дійсний 3 місяці",
      "promo.r3n": "Курс 15 сеансів масажу",
      "promo.r3s": "Дійсний 4 місяці",
      "promo.t2": "Знижки",
      "promo.t2note": "(не поширюються на Топ Майстрів)",
      "promo.d1n": "До дня народження",
      "promo.d1s": "Діє в день народження та 5 днів після",
      "promo.d2n": "Для військових",
      "promo.d3n": "На перший візит",
      "promo.d3s": "За промокодом",

      "rules.label": "Студія масажу Oliva",
      "rules.title1": "Правила",
      "rules.title2": "відвідування",
      "rules.trigger1": "Бронювання послуг студії",
      "rules.trigger2": "Запізнення",
      "rules.trigger3": "Неявка на процедуру",
      "rules.trigger4": "Скасування та перенесення запису",
      "rules.trigger5": "Форс-мажорний шанс",
      "rules.trigger6": "Подарункові сертифікати",
      "rules.trigger7": "Абонементи",
      "rules.trigger8": "Стан здоров'я",
      "rules.trigger9": "Правила перебування у студії",

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

      "sticky.book": "Записатися онлайн",

      "cert.back": "← Повернутись на головну",
      "cert.eyebrow": "Студія масажу Oliva · Київ",
      "cert.title1": "Подарунковий", "cert.title2": "сертифікат",
      "cert.sub": "Ідеальний подарунок для близьких — сеанс масажу або SPA-ритуал у затишній атмосфері. Оформимо та доставимо Новою Поштою.",
      "cert.perk1": "Красиво оформлений", "cert.perk2": "Доставка Новою Поштою", "cert.perk3": "На будь-яку послугу студії",
      "cert.formTitle": "Заповніть форму",
      "cert.labelName": "Ваше ім'я *", "cert.labelPhone": "Номер телефону *",
      "cert.labelRecipient": "Сертифікат на ім'я *",
      "cert.labelService": "Оберіть послугу *",
      "cert.tabPopular": "⭐ Популярні", "cert.tabAll": "Усі послуги",
      "cert.labelType": "Тип сертифіката *",
      "cert.typeDigital": "📱 Електронний", "cert.typePaper": "📄 Паперовий",
      "cert.labelDelivery": "Спосіб отримання *",
      "cert.deliveryNp": "📦 Нова Пошта", "cert.deliveryTaxi": "🚕 Таксі", "cert.deliveryStudio": "🏠 У студії",
      "cert.labelWishes": "Побажання до сертифіката",
      "cert.phName": "Наприклад: Олег",
      "cert.phRecipient": "Ім'я отримувача",
      "cert.phWishes": "Підпис, побажання, особливі деталі оформлення…",
      "cert.submit": "🎁 Замовити сертифікат",
      "cert.successBrandSub": "Студія масажу",
      "cert.successTitle": "Замовлення отримано!",
      "cert.successSub": "Дякуємо! Скоро з вами зв'яжемося.",
      "cert.successShareTitle1": "Даруйте емоції — ",
      "cert.successShareTitleAccent": "діліться ними ✨",
      "cert.successShareText1": "Відмітьте Oliva в Instagram під час вручення або отримання сертифіката і ми підготуємо для вас ",
      "cert.successShareBonus": "приємний бонус 🎁",
      "cert.successBack": "← Повернутись на головну",
      "cert.infoAbout": "Про сертифікат",
      "cert.infoRules": "Умови використання",
      "cert.about.p1": "Подарунковий сертифікат від студії масажу Oliva — це не просто подарунок. Це турбота, відпочинок та відновлення, які залишаються в пам'яті надовго.",
      "cert.about.p2": "Даруючи сертифікат, ви даруєте близькій людині можливість зупинитися серед щоденного поспіху, відновити сили, позбутися напруги та присвятити час собі.",
      "cert.about.p3": "Сертифікат можна оформити на будь-яку суму або на конкретну послугу: загально-оздоровчий масаж, парний масаж, SPA-ритуали, фітотерапію у фітобочці, стоун-терапію та інші процедури студії.",
      "cert.rules.li1": "Сертифікат не підлягає поверненню та обміну на грошові кошти",
      "cert.rules.li2": "Сертифікати між собою не сумуються",
      "cert.rules.li3": "При відміні запису менше ніж за 5 годин до візиту сертифікат вважається використаним",
      "cert.rules.li4": "У разі втрати або пошкодження сертифікат не може бути поновлений, кошти не повертаються",
      "cert.rules.li5": "При записі обов'язково повідомте адміністратора про наявність подарункового сертифіката та візьміть його із собою. Послуги надаються лише після пред'явлення сертифіката.",
      "cert.rules.li6": "Термін дії сертифікату — 2 місяці з дня купівлі",
      "cert.totalLabel": "Загальна сума:",
      "cert.variants": "варіантів",
      "cert.masterType.master": "Майстер",
      "cert.masterType.top": "Топ Майстер",
      "cert.masterType.ritual": "Ритуал",
      "cert.masterType.phyto": "Фітобочка",
      "srv.more": "Детальніше",
      "cert.changeService": "Змінити",
      "cert.change": "Змінити",
      "cert.remove": "Видалити",
      "cert.addService": "＋ Додати ще одну послугу",
      "cert.errName": "Вкажіть ваше ім'я",
      "cert.errPhone": "Вкажіть номер телефону",
      "cert.errRecipient": "Вкажіть ім'я отримувача",
      "cert.errService": "Оберіть послугу та тривалість",
      "cert.errType": "Оберіть тип сертифіката",
      "cert.errDelivery": "Оберіть спосіб отримання",
      "cert.addrLabel": "Адреса *",
      "cert.errAddress": "Вкажіть адресу"
    },

    en: {
      "top.address": "Kyiv, Borshchahivska St, 145",
      "top.hours": "Daily 9:00 – 21:30",

      "nav.home": "Home", "nav.services": "Services", "nav.prices": "Prices",
      "nav.gallery": "Promotions", "nav.phyto": "Phyto-barrel", "nav.team": "Therapists",
      "nav.contacts": "Contacts", "nav.book": "Book online",
      "nav.cert": "🎁 Gift Card", "nav.tips": "Tips", "nav.review": "Review",
      "nav.share": "💬 Share impressions",
      "nav.blog": "Blog", "nav.shop": "Shop", "nav.training": "Training",

      "hero.eyebrow": "Massage Studio OLIVA",
      "hero.brand1": "Massage Studio",
      "hero.title1": "Here begins", "hero.title2": "your recovery", "hero.title3": "",
      "hero.desc": "",
      "hero.cta1": "Book online", "hero.cta2": "View services",
      "hero.badgeAddr": "Borshchahivska, 145", "hero.badgeDaily": "daily",

      "mq.1": "Wellness massage", "mq.2": "Couples massage", "mq.3": "Anti-cellulite massage",
      "mq.4": "SPA rituals", "mq.5": "Sports massage", "mq.6": "Phyto-barrel",
      "mq.7": "Face massage", "mq.8": "Top therapists",

      "srv.label": "Our services", "srv.title1": "Choose your", "srv.title2": "recovery session",
      "srv.tab.top": "Popular",
      "srv.tab.complex": "Packages", "srv.tab.spa": "SPA rituals",
      "srv.tab.general": "Massages", "srv.tab.spa2": "SPA for two", "srv.tab.spa1": "SPA for one",
      "srv.tab.body": "Body shaping", "srv.tab.extra": "Add-on services",
      "srv.tier.label": "Specialist level:", "srv.tier.master": "Master", "srv.tier.top": "Top Master",

      "dur.30": "30 minutes", "dur.45": "45 min", "dur.60": "1 hour",
      "dur.60s": "1 hr", "dur.90": "1 hr 30 min", "dur.120": "2 hrs",
      "uah": "UAH", "book": "Book", "from": "from",

      "car.label": "Our services",
      "car.title": "Choose your session",
      "car.book": "Book →",
      "car.s1name": "Couples massage",
      "car.s1price": "from 2 700 UAH",
      "car.s2name": "General wellness massage",
      "car.s2price": "from 700 UAH",
      "car.s3name": "SPA rituals",
      "car.s3price": "from 2 150 UAH",
      "car.s4name": "Slimming wraps",
      "car.s4price": "from 1 600 UAH",
      "car.s5name": "Hardware massages",
      "car.s5price": "from 700 UAH",

      "promo.label": "Special offers",
      "promo.title1": "Deals",
      "promo.title2": "& discounts",
      "promo.t1": "Subscriptions",
      "promo.r1n": "5-session massage course",
      "promo.r1s": "Valid for 2 months",
      "promo.r2n": "10-session massage course",
      "promo.r2s": "Valid for 3 months",
      "promo.r3n": "15-session massage course",
      "promo.r3s": "Valid for 4 months",
      "promo.t2": "Discounts",
      "promo.t2note": "(not applicable to Top Masters)",
      "promo.d1n": "Birthday discount",
      "promo.d1s": "Valid on birthday and 5 days after",
      "promo.d2n": "For military personnel",
      "promo.d3n": "First visit",
      "promo.d3s": "With promo code",

      "rules.label": "Oliva Massage Studio",
      "rules.title1": "Visit",
      "rules.title2": "Policy",
      "rules.trigger1": "Booking studio services",
      "rules.trigger2": "Late arrival",
      "rules.trigger3": "No-show",
      "rules.trigger4": "Cancellation & rescheduling",
      "rules.trigger5": "Force-majeure",
      "rules.trigger6": "Gift certificates",
      "rules.trigger7": "Subscriptions",
      "rules.trigger8": "Health conditions",
      "rules.trigger9": "Studio conduct rules",

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

      "sticky.book": "Book online",

      "cert.back": "← Back to home",
      "cert.eyebrow": "Massage Studio Oliva · Kyiv",
      "cert.title1": "Gift", "cert.title2": "Certificate",
      "cert.sub": "The perfect gift for loved ones — a massage session or SPA ritual in a cozy atmosphere. We'll prepare and deliver by Nova Poshta.",
      "cert.perk1": "Beautifully presented", "cert.perk2": "Nova Poshta delivery", "cert.perk3": "Any service",
      "cert.formTitle": "Fill in the form",
      "cert.labelName": "Your name *", "cert.labelPhone": "Phone number *",
      "cert.labelRecipient": "Certificate recipient *",
      "cert.labelService": "Choose a service *",
      "cert.tabPopular": "⭐ Popular", "cert.tabAll": "All services",
      "cert.labelType": "Certificate type *",
      "cert.typeDigital": "📱 Digital", "cert.typePaper": "📄 Printed",
      "cert.labelDelivery": "Delivery method *",
      "cert.deliveryNp": "📦 Nova Poshta", "cert.deliveryTaxi": "🚕 Taxi", "cert.deliveryStudio": "🏠 Studio pickup",
      "cert.labelWishes": "Wishes for the certificate",
      "cert.phName": "E.g.: Alex",
      "cert.phRecipient": "Recipient's name",
      "cert.phWishes": "Signature, wishes, special details…",
      "cert.submit": "🎁 Order certificate",
      "cert.successBrandSub": "Massage studio",
      "cert.successTitle": "Order received!",
      "cert.successSub": "Thank you! We'll contact you shortly.",
      "cert.successShareTitle1": "Share the emotions — ",
      "cert.successShareTitleAccent": "tag us ✨",
      "cert.successShareText1": "Tag Oliva on Instagram when you give or receive the certificate and we'll prepare ",
      "cert.successShareBonus": "a nice bonus 🎁",
      "cert.successBack": "← Back to home",
      "cert.infoAbout": "About the certificate",
      "cert.infoRules": "Terms of use",
      "cert.about.p1": "A gift certificate from Oliva massage studio is more than just a gift. It's care, rest, and recovery that will be remembered for a long time.",
      "cert.about.p2": "By giving a certificate, you give your loved one the chance to pause in the daily rush, restore energy, relieve tension, and dedicate time to themselves.",
      "cert.about.p3": "A certificate can be issued for any amount or for a specific service: general wellness massage, couples massage, SPA rituals, phytotherapy in a herbal barrel, stone therapy, and other studio procedures.",
      "cert.rules.li1": "The certificate is non-refundable and cannot be exchanged for cash",
      "cert.rules.li2": "Certificates cannot be combined with each other",
      "cert.rules.li3": "If an appointment is cancelled less than 5 hours before the visit, the certificate is considered used",
      "cert.rules.li4": "In case of loss or damage, the certificate cannot be renewed and the funds are non-refundable",
      "cert.rules.li5": "When booking, please inform the administrator that you have a gift certificate and bring it with you. Services are provided only upon presentation of the certificate.",
      "cert.rules.li6": "The certificate is valid for 2 months from the date of purchase",
      "cert.totalLabel": "Total:",
      "cert.variants": "options",
      "cert.masterType.master": "Master",
      "cert.masterType.top": "Top Master",
      "cert.masterType.ritual": "Ritual",
      "cert.masterType.phyto": "Phyto-barrel",
      "srv.more": "Details",
      "cert.changeService": "Change",
      "cert.change": "Change",
      "cert.remove": "Remove",
      "cert.addService": "＋ Add another service",
      "cert.errName": "Please enter your name",
      "cert.errPhone": "Please enter your phone number",
      "cert.errRecipient": "Please enter recipient's name",
      "cert.errService": "Please select a service and duration",
      "cert.errType": "Please select certificate type",
      "cert.errDelivery": "Please select delivery method",
      "cert.addrLabel": "Address *",
      "cert.errAddress": "Please enter address"
    }
  };

  /* -------------------------------------------------------
     Правила відвідування — вміст тіл (EN)
     Зберігається тут, щоб уникати дублювання у HTML.
  ------------------------------------------------------- */
  var RULES_BODIES_EN = {
    "rules-body-1":
      '<div class="rules-block">' +
        '<p>To confirm a booking the studio may request a deposit (prepayment) of a fixed amount of <strong>(500 UAH)</strong>.</p>' +
        '<p>The deposit is payment for reserving the specialist\'s time.</p>' +
        '<p>The deposit amount is credited toward the total cost of the procedure at the time of your visit.</p>' +
        '<p>Specialist time is reserved individually, so if a client does not show up, the deposit is considered compensation for the reserved time.</p>' +
      '</div>' +
      '<div class="rules-block">' +
        '<div class="rules-block-title">Booking without a deposit</div>' +
        '<p>When booking without a deposit (prepayment), the client agrees that in the event of a no-show without prior notice or notice less than <strong>5 hours</strong> before the procedure, the studio has the right to request compensation for the specialist\'s reserved time of <strong>(500 UAH)</strong>.</p>' +
      '</div>',

    "rules-body-2":
      '<div class="rules-block">' +
        '<p>If a client is late, the duration of the procedure may be reduced by the time missed.</p>' +
        '<p>The price of the procedure does not change.</p>' +
        '<p>If the start of the procedure is delayed through no fault of the client, the studio guarantees the procedure will be carried out in full according to the booked duration.</p>' +
      '</div>',

    "rules-body-3":
      '<div class="rules-block">' +
        '<p>If a client does not show up or cancels less than <strong>5 hours</strong> before the procedure, the deposit is non-refundable.</p>' +
        '<p>In this case the deposit is treated as compensation for the specialist\'s reserved time.</p>' +
        '<p>This rule also applies in the case of significant lateness that makes the procedure impossible.</p>' +
      '</div>',

    "rules-body-4":
      '<div class="rules-block">' +
        '<p>Rescheduling or cancellation is possible no later than <strong>5 hours</strong> before the start of the procedure.</p>' +
        '<p>Clients are given one opportunity to reschedule with less than <strong>5 hours</strong> notice without losing the session.</p>' +
        '<p>In the event of a second reschedule or cancellation with less than <strong>5 hours</strong> notice, the deposit or prepayment is forfeited as compensation for the specialist\'s reserved time.</p>' +
        '<p>If a booking made without prepayment is cancelled or missed, the next booking at the studio may only be confirmed after a deposit or prepayment is made.</p>' +
      '</div>',

    "rules-body-5":
      '<div class="rules-block">' +
        '<p>In the event of force-majeure circumstances such as an air-raid alert, natural disaster, emergency, or other circumstances beyond the control of the studio or client that make the procedure impossible, the appointment will be rescheduled to another day and time by mutual agreement.</p>' +
        '<p>In such cases the deposit, subscription, or gift certificate is not considered used.</p>' +
      '</div>',

    "rules-body-6":
      '<div class="rules-block">' +
        '<p>A gift certificate confirms the right to receive studio services in the amount or for the service specified in the certificate.</p>' +
        '<p>If the cost of the procedure exceeds the value of the certificate, the client pays the difference.</p>' +
        '<p>Gift certificates cannot be exchanged for cash.</p>' +
        '<p>If the client fails to show up without prior notice or with less than <strong>5 hours</strong> notice, the certificate is considered used.</p>' +
      '</div>',

    "rules-body-7":
      '<div class="rules-block">' +
        '<p>A subscription entitles the holder to the number of massage procedures corresponding to the purchased package.</p>' +
        '<p>Subscription validity: <strong>2 months — 5 sessions; 3 months — 10 sessions; 4 months — 15 sessions</strong> from the date of purchase, unless otherwise specified at the time of purchase.</p>' +
        '<p>Within the validity of the subscription, the client may reschedule or cancel with less than <strong>5 hours</strong> notice once without losing a session.</p>' +
        '<p>In the event of a second no-show or cancellation with less than <strong>5 hours</strong> notice, the session is considered used.</p>' +
        '<p>Unused sessions after the subscription expires are forfeited.</p>' +
        '<p>A subscription may be transferred to another person once, subject to agreement with studio administration.</p>' +
      '</div>',

    "rules-body-8":
      '<div class="rules-block">' +
        '<p>Before the procedure, the client must inform the specialist of any chronic conditions, injuries, surgeries, pregnancy, high blood pressure, other medical restrictions, and any allergic reactions. The client is responsible for the accuracy of the information provided.</p>' +
        '<p>If contraindications or health risks are present, the studio has the right to refuse the procedure.</p>' +
        '<p>The decision on whether to proceed with the procedure is made by the studio specialist.</p>' +
        '<p>The studio is not responsible for deterioration of the client\'s health if information about existing conditions or contraindications was concealed.</p>' +
      '</div>',

    "rules-body-9":
      '<div class="rules-block">' +
        '<p>Clients are required to observe rules of conduct and respect other studio guests.</p>' +
        '<p>Entry to the studio in a state of alcohol or drug intoxication is prohibited.</p>' +
        '<p>Administration has the right to refuse service in the event of a violation of studio rules.</p>' +
      '</div>'
  };

  /* -------------------------------------------------------
     Фразовий словник для послуг (UA → EN)
     Порядок важливий: специфічніші фрази — першими.
  ------------------------------------------------------- */
  var SRV_PHRASES = [
    // SPA rituals (specific first, both quote styles)
    ['SPA Ритуал «Фіто-оновлення тіла»',            'SPA Ritual «Phyto Body Renewal»'],
    ['SPA Ритуал "Фіто-оновлення тіла"',            'SPA Ritual "Phyto Body Renewal"'],
    ['Тепловий SPA-ритуал «Глибоке прогрівання для двох»', 'Thermal SPA ritual «Deep Warming for Two»'],
    ['Тепловий SPA-ритуал "Глибоке прогрівання для двох"', 'Thermal SPA ritual "Deep Warming for Two"'],
    ['SPA Ритуал "Глибоке прогрівання для двох"',   'SPA Ritual "Deep Warming for Two"'],
    ['Обгортання Amore Shemen (гаряче)',             'Amore Shemen wrap (hot)'],
    ['Обгортання Amore Shemen (холодне)',            'Amore Shemen wrap (cold)'],
    ['Обгортання Amore Shemen',                      'Amore Shemen wrap'],
    ['Обгортання Bruno Vassari Detox',               'Bruno Vassari Detox wrap'],
    ['Гаряче (бандажне) обгортання SPA Seaweed',    'Hot bandage wrap SPA Seaweed'],
    ['Гаряче обгортання SPA Seaweed',               'Hot wrap SPA Seaweed'],
    ['Сольове обгортання',                           'Salt wrap'],
    ['🔥 Гаряча експрес-трансформація тіла',        '🔥 Hot Express Body Transformation'],
    ['Гаряча експрес-трансформація тіла',           'Hot Express Body Transformation'],
    ['❄️ Холодне моделювання тіла',                 '❄️ Cold Body Sculpting'],
    ['🔥 Гаряче моделювання тіла',                  '🔥 Hot Body Sculpting'],
    ['Холодне моделювання тіла',                    'Cold Body Sculpting'],
    ['Гаряче моделювання тіла',                     'Hot Body Sculpting'],
    // Face massage (specific first)
    ['Скульптуруючий масаж обличчя',                'Sculpting face massage'],
    ['Пластичний масаж обличчя',                    'Plastic face massage'],
    ['Моделюючий масаж обличчя',                    'Modelling face massage'],
    ['Антивіковий масаж обличчя',                   'Anti-aging face massage'],
    ['Лімфодренажний масаж обличчя',                'Lymphatic drainage face massage'],
    ['Класичний масаж обличчя',                     'Classic face massage'],
    ['Relax масаж обличчя',                         'Relax face massage'],
    ['Гуа-ша обличчя',                              'Gua sha face'],
    ['Кобідо',                                      'Kobido'],
    // Body massage (specific first)
    ['Загально-оздоровчий масаж',                   'Wellness massage'],
    ['Антистресовий масаж',                          'Anti-stress massage'],
    ['Антицелюлітний масаж',                         'Anti-cellulite massage'],
    ['Вакуумно-баночний масаж',                      'Vacuum cupping massage'],
    ['Міофасціальний масаж',                         'Myofascial massage'],
    ['Лімфодренажний масаж',                         'Lymphatic drainage massage'],
    ['Моделюючий масаж',                             'Modelling massage'],
    ['Медовий масаж',                                'Honey massage'],
    ['Спортивний масаж',                             'Sports massage'],
    ['Букальний масаж',                              'Buccal massage'],
    ['Вісцеральний масаж',                           'Visceral massage'],
    ['Масаж для вагітних',                           'Pregnancy massage'],
    ['Масаж стоп',                                   'Foot massage'],
    ['Масаж шийно-комірцевої зони',                  'Neck & shoulder massage'],
    ['Масаж спини',                                  'Back massage'],
    ['Парний масаж',                                 'Couples massage'],
    ['Масаж в чотири руки',                          'Four-hands massage'],
    ['Масаж гарячим камінням',                       'Hot stone massage'],
    ['Дитячий масаж',                                "Children's massage"],
    ['Дитячий',                                      "Children's"],
    ['Паріння у фітобочці',                          'Phyto-barrel steam'],
    ['Кінезіотейпування',                            'Kinesiotaping'],
    ['Relax масаж',                                  'Relax massage'],
    ['SPA-ритуали',                                  'SPA rituals'],
    // Master type labels (standalone)
    ['Топ Майстер',                                  'Top Master'],
    ['Майстер',                                      'Master'],
    ['Ритуал',                                       'Ritual'],
    ['Фітобочка',                                    'Phyto-barrel'],
    // Level suffixes
    ['(Топ Майстер)',                                '(Top Master)'],
    ['(Майстер)',                                    '(Master)'],
    // Duration words (after service names to avoid conflicts)
    [' хв',                                          ' min'],
    ['година',                                       'hour'],
    [' год. 40 хв.',                                 ' hr 40 min'],
    [' год. 30 хв.',                                 ' hr 30 min'],
    [' год. 15 хв.',                                 ' hr 15 min'],
    [' год. 10 хв.',                                 ' hr 10 min'],
    [' год.',                                        ' hr'],
    [' год',                                         ' hr'],
    ['варіантів',                                    'options'],
    // Wrapping types used in certificate
    ['Гаряче ·',                                     'Hot ·'],
    ['Холодне ·',                                    'Cold ·'],
    // Currency
    [' грн',                                         ' UAH'],
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
      '.srv-multi-dur',
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

  /* Storage for original rules-body innerHTML (keyed by element id) */
  var _rulesOriginals = {};

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

    // Rules bodies: swap full HTML content
    document.querySelectorAll("[data-rules-body]").forEach(function (el) {
      var bodyId = el.getAttribute("data-rules-body");
      // Save original on first encounter
      if (!_rulesOriginals[bodyId]) {
        _rulesOriginals[bodyId] = el.innerHTML;
      }
      if (lang === 'uk') {
        el.innerHTML = _rulesOriginals[bodyId];
      } else if (RULES_BODIES_EN[bodyId] != null) {
        el.innerHTML = RULES_BODIES_EN[bodyId];
      }
    });

    // Phrase-based service content
    applyServicePhrases(lang);

    // Language switcher buttons state
    document.querySelectorAll(".lang-switch button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-lang") === lang);
    });

    // Notify certificate page if it registered a callback
    if (typeof window._olivaLangCallback === 'function') {
      window._olivaLangCallback(lang);
    }

    try { localStorage.setItem("oliva_lang", lang); } catch (e) {}

    /* Блоки, які малюються з JS (описи послуг, посилання на статтю), не
       мають data-i18n і перекладаються власними обробниками. Вони чекали
       на подію langchange, а її ніхто не надсилав — тому при перемиканні
       мови ці тексти лишались українськими. */
    try {
      document.dispatchEvent(new CustomEvent("langchange", { detail: lang }));
    } catch (e) { /* дуже старий браузер — не критично */ }
  }

  // Мінімальний публічний API
  window.OlivaI18n = {
    apply: apply,
    translate: translateText,
    get: function () {
      try { return localStorage.getItem("oliva_lang") || "uk"; } catch (e) { return "uk"; }
    }
  };

  // Застосувати збережену мову одразу
  apply(window.OlivaI18n.get());
})();
