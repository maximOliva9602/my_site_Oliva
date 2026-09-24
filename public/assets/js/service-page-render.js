/* ============================================================
   service-page-render.js — розмітка сторінки послуги (/service/<slug>).
   Спільна для сервера й браузера:
   - сервер (server.js) рендерить нею ГОТОВИЙ HTML — заголовок, H1, ціни,
     опис, кроки, FAQ одразу в першій відповіді. Раніше сторінка
     приходила порожньою («Завантаження…») і наповнювалась лише
     JavaScript'ом, тож пошуковик бачив майже пусту сторінку.
   - браузер (service.html) тією ж функцією перебудовує той самий HTML
     і вішає перемикачі тривалості/рівня/абонементів.
   Нічого з DOM тут не чіпаємо — лише рядки.
   ============================================================ */
(function (global) {
  "use strict";

  var BASE = "https://massage-oliva.com";

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  /* Незамінний пробіл між числом і одиницею ("6000 грн"), щоб "грн" не
     переносилось саме по собі на новий рядок. */
  function nbspCur(s) { return String(s).replace(/ (?=\S+$)/, " "); }
  function lines(s) { return String(s || "").split("\n").map(function (x) { return x.trim(); }).filter(Boolean); }
  function pair(line) {
    var i = line.indexOf("::");
    if (i === -1) return { title: line.trim(), text: "" };
    return { title: line.slice(0, i).trim(), text: line.slice(i + 2).trim() };
  }
  /* Крок «Як проходить…»: "Заголовок :: Опис :: /фото.jpg" (фото необов'язкове). */
  function stepParts(line) {
    var p = String(line == null ? "" : line).split("::").map(function (x) { return x.trim(); });
    return { title: p[0] || "", text: p[1] || "", photo: p[2] || "" };
  }
  /* Рядок абонемента: "5 сеансів :: Разом :: Стара сума :: Бейдж :: рекомендовано".
     "Разом"/"Стара сума" можуть містити ціни кількох рівнів через кому. */
  function parseAbonLevels(raw, sessions) {
    if (!raw) return [];
    return raw.split(",").map(function (s) { return s.trim(); }).filter(Boolean).map(function (chunk) {
      var lm = chunk.match(/^(Топ Майстер|Майстер|Експерт)\s+(.+)$/i);
      var level = lm ? lm[1] : "";
      var price = lm ? lm[2].trim() : chunk;
      var num = parseFloat(String(price).replace(/[^\d.,]/g, "").replace(",", "."));
      var perSession = (sessions && num) ? Math.round(num / sessions) : null;
      return { level: level, price: price, perSession: perSession != null ? (perSession + " грн") : "" };
    });
  }
  function parseAbon(line) {
    var parts = line.split("::").map(function (x) { return x.trim(); });
    var title = parts[0] || "";
    var m = title.match(/\d+/);
    var sessions = m ? parseInt(m[0], 10) : null;
    return {
      title: title, totals: parseAbonLevels(parts[1] || "", sessions),
      originals: parseAbonLevels(parts[2] || "", sessions), badge: parts[3] || "", popular: !!parts[4]
    };
  }
  /* "[90 хв]" перемикає групу тривалості для наступних рядків абонементів. */
  function parseAbonemenItems(raw) {
    var groups = [], current = null;
    lines(raw).forEach(function (line) {
      var dm = line.match(/^\[(.+)\]$/);
      if (dm) { current = { duration: dm[1].trim(), items: [] }; groups.push(current); return; }
      if (!current) { current = { duration: "", items: [] }; groups.push(current); }
      var a = parseAbon(line);
      /* Рядок без жодної ціни («5 сеансів» і все) — недописаний пакет;
         картка «Разом: » з порожньою сумою лише плутала клієнтів. */
      if (a.title && a.totals.length) current.items.push(a);
    });
    return groups.filter(function (g) { return g.items.length; });
  }
  var LEVEL_ORDER = ["Майстер", "Топ Майстер", "Експерт"];
  /* Тумблер рівня — лише коли в прайсі послуга справді поділена за рівнями. */
  function collectRealLevels(vs) {
    var set = {};
    vs.forEach(function (v) { if (v.realLevel) set[v.realLevel] = true; });
    return LEVEL_ORDER.filter(function (l) { return set[l]; });
  }
  /* Прибираємо markdown-хвости (*текст*, "\."), які лишаються при копіюванні. */
  function clean(s) {
    s = String(s == null ? "" : s).trim();
    s = s.replace(/^\*+\s*/, "").replace(/\s*\*+$/, "");
    s = s.replace(/\\\./g, ".");
    return s;
  }
  function fmtDur(min) {
    var h = Math.floor(min / 60), m = min % 60;
    if (!h) return min + " хв";
    return h + " год" + (m ? " " + m + " хв" : "");
  }
  /* Коротка адреса філії з назви на кшталт "OLIVA за адресою: м. Київ, Успішна, 8". */
  function branchLabel(b) {
    var s = String(b.address || b.name || "").replace(/^.*за адресою:\s*/i, "").replace(/^м\.\s*Київ,?\s*/i, "").replace(/^вул\.\s*/i, "").trim();
    return s;
  }

  /* ---- Головне: зібрати HTML сторінки ----
     opts: { page, services, branches, groups (SG), related: [{title, href}], categoryLink: {title, href}, path } */
  function build(opts) {
    var p = {};
    Object.keys(opts.page || {}).forEach(function (k) { p[k] = opts.page[k]; });
    ["hero_tagline", "hero_description", "symptoms_quote", "detail_description"].forEach(function (f) {
      if (p[f]) p[f] = clean(p[f]);
    });
    var SG = opts.groups;
    var key = p.service_key;
    var allServices = opts.services || [];
    var branches = opts.branches || [];

    var variants = allServices.filter(function (s) {
      return SG.parseName(s.name).cat === key;
    }).map(function (s) {
      var parsed = SG.parseName(s.name);
      return { id: s.id, level: parsed.level || "Майстер", realLevel: parsed.level || null, dur: parsed.dur, price: s.price };
    }).filter(function (v) { return v.dur; }).sort(function (a, b) { return a.dur - b.dur; });

    var minPrice = variants.length ? Math.min.apply(null, variants.map(function (v) { return v.price; })) : null;
    var maxPrice = variants.length ? Math.max.apply(null, variants.map(function (v) { return v.price; })) : null;
    /* Запис одразу на цю послугу: booking.html?service=<id> підставляє
       послугу й категорію — клієнту лишається обрати майстра й час. */
    var cheapest = variants.slice().sort(function (a, b) { return a.price - b.price; })[0];
    var bookHref = cheapest ? "/booking.html?service=" + cheapest.id : "/booking.html";

    var abonGroups = parseAbonemenItems(p.abonement_items);
    var abonLevels = collectRealLevels(variants);
    var state = { durIdx: 0, level: abonLevels.length ? abonLevels[0] : null };
    function parseDurNum(s) { var m = String(s || "").match(/\d+/); return m ? parseInt(m[0], 10) : null; }
    /* Перемикач тривалості — з прайсу (90 хв / 130 хв), а якщо тривалість
       у прайсі одна — з груп абонементів "[90 хв]". */
    var realDurs = variants.map(function (v) { return v.dur; })
      .filter(function (d, i, a) { return a.indexOf(d) === i; }).sort(function (a, b) { return a - b; });
    var useRealSwitch = realDurs.length > 1;
    var switchOpts = useRealSwitch
      ? realDurs.map(function (d) { return { label: d + " хв", num: d }; })
      : (abonGroups.length > 1 ? abonGroups.map(function (g) { return { label: g.duration, num: parseDurNum(g.duration) }; }) : []);
    function activeDurNum() {
      if (switchOpts.length) return switchOpts[state.durIdx] ? switchOpts[state.durIdx].num : null;
      return abonGroups.length ? parseDurNum(abonGroups[0].duration) : null;
    }
    function groupVisible(gi) {
      if (!useRealSwitch) return gi === state.durIdx;
      var gd = parseDurNum(abonGroups[gi].duration);
      return gd == null || gd === activeDurNum();
    }
    /* "Ціна за візит" — реальна ціна з прайсу під обрану тривалість/рівень. */
    function realPriceFor(durNum, level) {
      var pool = variants;
      if (level) {
        var byLevel = pool.filter(function (v) { return v.level === level; });
        if (byLevel.length) pool = byLevel;
      }
      if (durNum != null) {
        var exact = pool.filter(function (v) { return v.dur === durNum; });
        if (exact.length) pool = exact;
      }
      if (!pool.length) return null;
      var prices = pool.map(function (v) { return v.price; });
      var min = Math.min.apply(null, prices), max = Math.max.apply(null, prices);
      return { price: Math.round(min / 100), exact: min === max };
    }
    function priceBigHtml(r) { return (r.exact ? "" : "<span>від </span>") + r.price + " грн"; }
    function durSwitchHtml() {
      if (switchOpts.length < 2) return "";
      return '<div class="abon-duration-switch-wrap"><div class="abon-duration-switch">' + switchOpts.map(function (o, i) {
        return '<button type="button" class="abon-duration-btn' + (i === state.durIdx ? " active" : "") + '" data-abon-dur="' + i + '">' + esc(o.label) + "</button>";
      }).join("") + "</div></div>";
    }

    var title = p.hero_title || key;
    /* SEO-заголовок і опис задаються окремо в адмінці; якщо порожні —
       будуємо з H1 і короткого опису. */
    var seoTitle = p.seo_title || (title + " — Студія масажу Oliva, Київ");
    var metaDesc = p.seo_description || p.hero_description || p.hero_tagline || title;
    if (metaDesc.length > 300) metaDesc = metaDesc.slice(0, 297).replace(/\s+\S*$/, "") + "…";
    var ogImg = p.hero_photo ? (p.hero_photo.indexOf("http") === 0 ? p.hero_photo : BASE + p.hero_photo) : BASE + "/assets/img/og-image.jpg";

    /* Філії, де послуга реально надається (branches[].service_ids). Якщо
       даних немає — показуємо обидві адреси, як і раніше. */
    var variantIds = variants.map(function (v) { return v.id; });
    var here = branches.filter(function (b) {
      /* Порожній service_ids = філія надає всі послуги (як в онлайн-записі). */
      return !(b.service_ids || []).length || b.service_ids.some(function (id) { return variantIds.indexOf(id) !== -1; });
    });
    if (!here.length) here = branches;

    var html = "";

    // Хлібні крихти — і для людини, і для пошуковика (BreadcrumbList нижче)
    var crumbs = [{ title: "Головна", href: "/" }, { title: "Послуги", href: "/#services" }];
    if (opts.categoryLink) crumbs.push(opts.categoryLink);

    // HERO
    var heroSizeCls = { compact: " hero--compact", tall: " hero--tall" }[p.hero_photo_size] || "";
    var heroInnerCls = p.hero_text_align === "right" ? " hero-inner--right" : "";
    html += '<section class="hero' + heroSizeCls + '">' +
      (p.hero_photo ? '<img class="hero-bg" src="' + esc(p.hero_photo) + '" alt="' + esc(title) + '">' : '<div class="hero-bg-fallback"></div>') +
      '<div class="hero-overlay"></div>' +
      '<div class="wrap"><div class="hero-inner' + heroInnerCls + '">' +
        '<div class="hero-eyebrow">Студія масажу Oliva · Київ</div>' +
        '<h1 class="hero-title">' + esc(title) + "</h1>" +
        '<div class="hero-btns">' +
          '<a href="' + bookHref + '" class="btn btn-primary">Записатися онлайн →</a>' +
          '<a href="/certificate.html" class="btn btn-secondary">🎁 Подарувати сертифікат</a>' +
        "</div>" +
      "</div></div>" +
    "</section>";

    if (p.hero_tagline || p.hero_description) {
      html += '<div class="hero-sub">' +
        (p.hero_tagline ? '<div class="hero-tagline">' + esc(p.hero_tagline) + "</div>" : "") +
        (p.hero_description ? '<p class="hero-desc">' + esc(p.hero_description) + "</p>" : "") +
      "</div>";
    }

    // Хлібні крихти — під шапкою (і BreadcrumbList нижче для пошуковика)
    html += '<nav class="crumbs" aria-label="Навігація"><div class="wrap">' + crumbs.map(function (c) {
      return '<a href="' + esc(c.href) + '">' + esc(c.title) + "</a>";
    }).join('<span>›</span>') + '<span>›</span><span class="crumbs-cur">' + esc(title) + "</span></div></nav>";

    // ЦІНА (+ абонементи)
    if (abonGroups.length) {
      var renderAbonCards = function (items) {
        return items.map(function (a) {
          var single = a.totals.length <= 1 && !(a.totals[0] && a.totals[0].level);
          var body;
          if (single) {
            var t = a.totals[0];
            body =
              '<div class="abon-card-price">' + esc(t ? (t.perSession || t.price) : "") + "</div>" +
              (t && t.perSession ? '<div class="abon-card-persession">за сеанс</div>' : "") +
              '<div class="abon-card-divider"></div>' +
              '<div class="abon-card-total">Разом: <b>' + nbspCur(esc(t ? t.price : "")) + "</b>" + (a.originals[0] ? " <del>" + nbspCur(esc(a.originals[0].price)) + "</del>" : "") + "</div>";
          } else {
            body = '<div class="abon-levels">' + a.totals.map(function (t, i) {
              var orig = a.originals[i];
              return '<div class="abon-level-row"><span class="abon-level-name">' + esc(t.level || "Разом") + "</span>" +
                '<span class="abon-level-total"><span class="abon-level-total-label">Разом: </span>' + nbspCur(esc(t.price)) + (orig ? " <del>" + nbspCur(esc(orig.price)) + "</del>" : "") + "</span></div>";
            }).join("") + "</div>";
          }
          return '<div class="abon-card' + (a.popular ? " abon-card--popular" : "") + (single ? "" : " abon-card--levels") + '">' +
            (a.popular ? '<div class="abon-card-popular-label">Найпопулярніший</div>' : "") +
            (a.badge ? '<div class="abon-badge">' + esc(a.badge) + "</div>" : "") +
            '<div class="abon-card-title">' + esc(a.title) + "</div>" +
            body +
          "</div>";
        }).join("");
      };
      var abonHeaderR = realPriceFor(activeDurNum(), state.level) || (minPrice != null ? { price: Math.round(minPrice / 100), exact: false } : null);
      html += '<div class="abon-section"><div class="abon-block">' +
        '<div class="abon-grid">' +
        '<div class="abon-price-col">' +
          durSwitchHtml() +
          (abonLevels.length ? '<div class="abon-level-switch-wrap"><div class="abon-level-switch">' + abonLevels.map(function (lv, i) {
            return '<button type="button" class="abon-level-btn' + (i === 0 ? " active" : "") + '" data-abon-level="' + esc(lv) + '">' + esc(lv) + "</button>";
          }).join("") + "</div></div>" : "") +
          '<div class="abon-price-label">Ціна за візит</div>' +
          (abonHeaderR ? '<div class="abon-price-big" id="abonPriceBig">' + priceBigHtml(abonHeaderR) + "</div>" : "") +
          '<a href="' + bookHref + '" class="btn btn-primary" style="width:100%;justify-content:center;">Записатися →</a>' +
        "</div>" +
        '<div class="abon-info-box">' +
        '<div class="abon-info-title">Абонементи</div>' +
        '<div class="abon-info-sub">Більше турботи — вигідніше</div>' +
        '<div class="abon-cards-wrap">' +
        abonGroups.map(function (g, i) {
          return '<div class="abon-cards" data-abon-group="' + i + '"' + (groupVisible(i) ? "" : ' style="display:none;"') + ">" + renderAbonCards(g.items) + "</div>";
        }).join("") +
        '<div class="abon-none" style="display:' + (abonGroups.some(function (g, gi) { return groupVisible(gi); }) ? "none" : "block") + ';color:var(--text-dim);font-size:13px;padding:18px 4px;">Для цієї тривалості абонементів немає — запитайте в адміністратора.</div>' +
        '<button type="button" class="abon-carousel-arrow abon-carousel-arrow--prev" data-abon-dir="-1" aria-label="Попередній пакет">&#8249;</button>' +
        '<button type="button" class="abon-carousel-arrow abon-carousel-arrow--next" data-abon-dir="1" aria-label="Наступний пакет">&#8250;</button>' +
        "</div></div></div></div></div>";
    } else if (minPrice != null) {
      var soloR = realPriceFor(activeDurNum(), null);
      html += '<div class="abon-section"><div class="abon-block abon-block--price-only">' +
        '<div class="abon-price-col abon-price-col--solo">' +
          durSwitchHtml() +
          '<div class="abon-price-label">Ціна за візит</div>' +
          '<div class="abon-price-big" id="abonPriceBig">' + priceBigHtml(soloR || { price: Math.round(minPrice / 100), exact: false }) + "</div>" +
          '<a href="' + bookHref + '" class="btn btn-primary" style="width:100%;justify-content:center;">Записатися →</a>' +
        "</div></div></div>";
    }

    // КРОКИ
    var stepItems = lines(p.steps_items).map(stepParts).filter(function (x) { return x.title; });
    if (stepItems.length) {
      var anyStepPhoto = stepItems.some(function (s) { return s.photo; });
      html += '<section class="block symptoms steps-section"><div class="wrap">' +
        '<h2 class="block-title">' + esc(p.steps_title || "Як проходить ваш сеанс") + "</h2>" +
        '<div class="steps-row' + (anyStepPhoto ? " steps-row--photos" : "") + '">' + stepItems.map(function (s, i) {
          return '<div class="step">' +
            (anyStepPhoto ? '<div class="step-photo' + (s.photo ? "" : " step-photo--empty") + '">' +
              (s.photo ? '<img src="' + esc(s.photo) + '" alt="' + esc(s.title) + '" loading="lazy">' : "") +
            "</div>" : "") +
            '<div class="step-num">0' + (i + 1) + "</div>" +
            '<h3 class="step-title">' + esc(s.title) + "</h3>" +
            (s.text ? '<div class="step-text">' + esc(s.text) + "</div>" : "") +
          "</div>";
        }).join("") + "</div>" +
      "</div></section>";
    }

    // «ЗНАЙОМЕ ВІДЧУТТЯ?»
    var symptomItems = lines(p.symptoms_items);
    if (symptomItems.length) {
      var symPhoto = p.symptoms_photo || p.hero_photo;
      var symPhotoSizeCls = { square: " symptoms-photo--square", wide: " symptoms-photo--wide", tall: " symptoms-photo--tall" }[p.symptoms_photo_size] || "";
      html += '<section class="block symptoms"><div class="wrap"><div class="symptoms-grid">' +
        "<div>" +
          '<h2 class="block-title">' + esc(p.symptoms_title || "Знайоме відчуття?") + "</h2>" +
          '<div class="symptoms-list">' + symptomItems.map(function (x) { return '<div class="symptoms-item"><span class="dot"></span>' + esc(x) + "</div>"; }).join("") + "</div>" +
          (p.symptoms_quote ? '<div class="symptoms-quote">' + esc(p.symptoms_quote) + "</div>" : "") +
        "</div>" +
        (symPhoto ? '<div class="symptoms-photo' + symPhotoSizeCls + '"><img src="' + esc(symPhoto) + '" alt="' + esc(title) + '" loading="lazy"></div>' : "") +
      "</div></div></section>";
    }

    // ПЕРЕВАГИ
    var benefitItems = lines(p.benefits_items).map(pair).filter(function (x) { return x.title; });
    if (benefitItems.length) {
      html += '<section class="block"><div class="wrap">' +
        '<h2 class="block-title">' + esc(p.benefits_title || "Що ви відчуєте після масажу") + "</h2>" +
        '<div class="benefits-grid benefits-grid--last">' + benefitItems.map(function (b) {
          return '<div class="benefit-card"><h3 class="benefit-title">' + esc(b.title) + "</h3>" + (b.text ? '<div class="benefit-text">' + esc(b.text) + "</div>" : "") + "</div>";
        }).join("") + "</div>" +
      "</div></section>";
    }

    // ОПИС + КОМУ ПІДІЙДЕ + ДЕ ПРОХОДИТЬ
    var suitableItems = lines(p.suitable_items);
    var desc = p.detail_description || p.hero_description;
    html += '<section class="block detail"><div class="wrap"><div class="detail-grid">' +
      "<div>" +
        '<div class="detail-eyebrow">Послуга</div>' +
        '<h2 class="detail-title">' + esc(title) + "</h2>" +
        (desc ? lines(desc).map(function (para) { return '<p class="detail-desc">' + esc(para) + "</p>"; }).join("") : "") +
        (variants.length ? '<div class="detail-prices"><div class="suitable-title">Тривалість і ціна</div>' +
          realDurs.map(function (d) {
            var r = realPriceFor(d, null);
            return '<div class="detail-price-row"><span>' + esc(fmtDur(d)) + "</span><b>" + (r ? (r.exact ? "" : "від ") + r.price + " грн" : "") + "</b></div>";
          }).join("") + "</div>" : "") +
      "</div>" +
      "<div>" +
        (suitableItems.length ? '<div class="suitable-title">Кому підійде</div><div class="suitable-list">' +
          suitableItems.map(function (x) { return '<div class="suitable-item"><span class="check">✓</span>' + esc(x) + "</div>"; }).join("") +
        "</div>" : "") +
        (here.length ? '<div class="detail-loc"><div class="suitable-title" style="margin-top:18px;">Де проходить</div>' +
          here.map(function (b) { return "<div>📍 Київ, " + esc(branchLabel(b)) + (b.nearby ? ' <span style="color:var(--text-dim);">· ' + esc(b.nearby) + "</span>" : "") + "</div>"; }).join("") + "</div>"
          : '<div class="detail-loc">📍 Київ · Шулявська · район Індустріального мосту</div>') +
      "</div>" +
    "</div></div></section>";

    // ПОДАРУНКОВИЙ СЕРТИФІКАТ
    html += '<section class="block"><div class="wrap"><div class="cert-cta">' +
      '<div><h2 class="block-title" style="margin-bottom:8px;">Подарунковий сертифікат на ' + esc(title) + "</h2>" +
      '<p class="detail-desc" style="margin:0;">Можна подарувати саме цю процедуру або суму на будь-яку послугу студії — електронний чи паперовий сертифікат, з отриманням у студії або доставкою.</p></div>' +
      '<a href="/certificate.html" class="btn btn-secondary">🎁 Оформити сертифікат</a>' +
    "</div></div></section>";

    // FAQ
    var faqItems = lines(p.faq_items).map(pair).filter(function (x) { return x.title && x.text; });
    if (faqItems.length) {
      html += '<section class="block"><div class="wrap">' +
        '<h2 class="block-title">Часті питання</h2>' +
        '<div class="faq-list">' + faqItems.map(function (f) {
          return '<details class="faq-item"><summary>' + esc(f.title) + "</summary><p>" + esc(f.text) + "</p></details>";
        }).join("") + "</div>" +
      "</div></section>";
    }

    // Схожі послуги / категорія
    var related = opts.related || [];
    if (related.length || opts.categoryLink) {
      html += '<section class="block"><div class="wrap">' +
        '<h2 class="block-title">Вас також може зацікавити</h2>' +
        '<div class="related-row">' +
        (opts.categoryLink ? '<a class="related-link related-link--cat" href="' + esc(opts.categoryLink.href) + '">Усі програми: ' + esc(opts.categoryLink.title) + " →</a>" : "") +
        related.map(function (r) { return '<a class="related-link" href="' + esc(r.href) + '">' + esc(r.title) + " →</a>"; }).join("") +
        "</div></div></section>";
    }

    html += contactsHtml();

    /* Структуровані дані: послуга з цінами, FAQ, хлібні крихти. */
    var path = opts.path || "";
    var jsonld = [{
      "@context": "https://schema.org",
      "@type": "Service",
      "name": title,
      "description": metaDesc,
      "url": BASE + path,
      "image": ogImg,
      "areaServed": { "@type": "City", "name": "Київ" },
      "provider": { "@id": BASE + "/#business" }
    }];
    if (minPrice != null) {
      jsonld[0].offers = {
        "@type": "AggregateOffer", "priceCurrency": "UAH",
        "lowPrice": String(Math.round(minPrice / 100)), "highPrice": String(Math.round(maxPrice / 100)),
        "offerCount": String(variants.length), "url": BASE + path
      };
    }
    if (faqItems.length) {
      jsonld.push({
        "@context": "https://schema.org", "@type": "FAQPage",
        "mainEntity": faqItems.map(function (f) {
          return { "@type": "Question", "name": f.title, "acceptedAnswer": { "@type": "Answer", "text": f.text } };
        })
      });
    }
    jsonld.push({
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      "itemListElement": crumbs.concat([{ title: title, href: path }]).map(function (c, i) {
        return { "@type": "ListItem", "position": i + 1, "name": c.title, "item": BASE + (c.href.charAt(0) === "/" ? c.href : "/" + c.href) };
      })
    });

    return {
      html: html, title: title, seoTitle: seoTitle, description: metaDesc, ogImage: ogImg, jsonld: jsonld,
      ctx: {
        state: state, realPriceFor: realPriceFor, activeDurNum: activeDurNum,
        groupVisible: groupVisible, priceBigHtml: priceBigHtml
      }
    };
  }

  function contactsHtml() {
    return '<section class="contacts-section" id="contacts"><div class="wrap">' +
      '<div class="section-label">Де нас знайти</div>' +
      '<h2 class="section-title">Контакти</h2>' +
      '<div class="contacts-grid">' +
        "<div>" +
          '<div class="contact-block">' +
            '<a href="https://maps.google.com/?q=Київ,+вул.+Борщагівська,+145" target="_blank" rel="noopener" class="contact-value" style="display:block;">Київ, вул. Борщагівська, 145</a>' +
            '<a href="/uspishna" class="contact-value" style="display:block;margin-top:4px;">Київ, вул. Успішна, 8</a></div>' +
          '<div class="contact-block"><div class="contact-label">Телефон</div><a href="tel:+380974340112" class="contact-value">+38 097 434 01 12</a></div>' +
          '<div class="contact-block"><div class="contact-label">Графік роботи</div><div class="contact-value">Щодня 09:00 — 21:30</div></div>' +
          '<div class="contact-block"><div class="contact-label">Пошта</div><a href="mailto:olivastudio96@gmail.com" class="contact-value">olivastudio96@gmail.com</a></div>' +
        '<div class="social-row">' +
        '<a href="https://www.instagram.com/oliva_massage_studio/" target="_blank" rel="noopener" class="social-btn social-btn--instagram" title="Instagram"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg></a>' +
        '<a href="https://www.tiktok.com/@oliva_massage_studio" target="_blank" rel="noopener" class="social-btn social-btn--tiktok" title="TikTok"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.32 6.32 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z"/></svg></a>' +
        '<a href="https://wa.me/380974340112" target="_blank" rel="noopener" class="social-btn social-btn--whatsapp" title="WhatsApp"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg></a>' +
        '<a href="https://viber.me/+380974340112" class="social-btn social-btn--viber" title="Viber"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M11.398.002C8.865-.03 3.73.734 1.37 5.885c-1.177 2.535-1.33 5.84-1.13 8.68.198 2.84.772 5.63 2.698 7.226 0 0 2.56 2.657 8.548 2.905v2.527s-.038.992.617.992c.803 0 1.288-.824 2.063-1.703.43-.485.98-1.154 1.4-1.648 3.87.327 6.842-.422 7.177-.533.78-.254 5.197-1.7 5.197-7.74 0-5.955-2.855-9.61-6.285-10.964-1.12-.44-2.98-.82-5.587-.863-.237-.003-.474-.004-.71-.003zM11.47 2.4c.23-.002.46 0 .687.004 2.306.038 3.982.375 4.946.762 2.817 1.104 5.127 4.146 5.127 9.265 0 5.093-3.55 6.15-4.177 6.354-.27.088-2.966.732-6.328.526 0 0-2.51 3.025-3.296 3.815-.124.125-.265.174-.36.15-.134-.034-.17-.19-.168-.42l.02-3.7s-.004 0 0 0c-4.995-.617-5.29-5.45-5.427-7.32-.136-1.872.006-4.834.994-7.006 1.933-4.163 6.197-4.434 7.98-4.43zm.194 3.217c-.327 0-.327.504 0 .508 3.09.02 4.855 1.816 4.873 4.982.003.33.51.327.507 0-.02-3.445-1.993-5.47-5.38-5.49zm-2.44 1.37c-.31-.018-.614.063-.9.24-.273.168-.443.366-.588.63l-.04.076c-.474.86-.456 1.712.007 2.706l.028.063c.393.87 1.24 2.107 2.367 3.093 1.133.99 2.552 1.882 4.01 2.155l.064.01c1.254.198 2.073-.05 2.648-.585l.012-.012c.22-.224.393-.434.545-.67.194-.3.217-.61.063-.87l-.013-.02c-.454-.706-1.264-1.358-1.714-1.533-.27-.104-.54-.06-.756.173l-.457.528c-.214.244-.534.224-.534.224-2.47-.638-3.138-3.163-3.138-3.163s-.023-.322.218-.535l.524-.46c.232-.218.274-.488.168-.757-.18-.452-.835-1.265-1.543-1.72-.19-.122-.39-.19-.592-.19-.003 0-.005 0-.007 0l-.002-.002zM12.2 7.617c-.33 0-.33.517 0 .52 1.96.016 2.917.993 2.93 2.99.003.33.52.327.516 0-.016-2.277-1.17-3.493-3.447-3.51z"/></svg></a>' +
        '<a href="https://t.me/massage_oliva_kyiv" target="_blank" rel="noopener" class="social-btn social-btn--telegram" title="Telegram"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.96 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg></a>' +
        '<a href="https://youtube.com/@oliva_massage_studio" target="_blank" rel="noopener" class="social-btn social-btn--youtube" title="YouTube"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M23.495 6.205a3.007 3.007 0 0 0-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 0 0 .527 6.205a31.247 31.247 0 0 0-.522 5.805 31.247 31.247 0 0 0 .522 5.783 3.007 3.007 0 0 0 2.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 0 0 2.088-2.088 31.247 31.247 0 0 0 .5-5.783 31.247 31.247 0 0 0-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/></svg></a>' +
        '<a href="https://www.threads.net/@oliva_massage_studio" target="_blank" rel="noopener" class="social-btn social-btn--threads" title="Threads"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.028-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.044 0 5.49 1.045 7.148 3.01 1.504 1.788 2.267 4.184 2.267 7.123 0 .44-.015.877-.044 1.308l-.006.082c-.11 1.649-.547 3.051-1.3 4.172-.824 1.225-1.985 2.063-3.452 2.489a9.26 9.26 0 0 1-2.622.371zm3.553-9.48c-.232-1.225-.856-1.972-1.787-2.09a3.494 3.494 0 0 0-.439-.03c-.626 0-1.175.193-1.631.573-.508.424-.82 1.044-.916 1.793a5.65 5.65 0 0 0-.044.728c0 .18.007.357.022.527.09.917.425 1.657.971 2.127.456.395 1.045.601 1.7.601.11 0 .222-.007.336-.02.75-.09 1.328-.418 1.722-1.007.36-.542.543-1.261.543-2.137 0-.084-.002-.169-.006-.253l-.458-.564z"/></svg></a>' +
        '</div>' +
        "</div>" +
        "<div>" +
          '<div class="map-embed-wrap">' +
            '<div class="map-embed-item">' +
              '<div class="map-embed-label">Борщагівська, 145</div>' +
              '<iframe src="https://maps.google.com/maps?q=Київ,+вул.+Борщагівська,+145&z=16&output=embed" width="100%" height="330" style="border:0;border-radius:16px;display:block;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Борщагівська, 145"></iframe>' +
              '<a href="https://maps.google.com/?q=Київ,+вул.+Борщагівська,+145" target="_blank" rel="noopener" class="map-open-link">Відкрити в Google Maps →</a>' +
            "</div>" +
            '<div class="map-embed-item">' +
              '<div class="map-embed-label">Успішна, 8</div>' +
              '<iframe src="https://maps.google.com/maps?q=50.3864358,30.4572199&z=16&output=embed" width="100%" height="330" style="border:0;border-radius:16px;display:block;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Успішна, 8"></iframe>' +
              '<a href="https://maps.google.com/?q=50.3864358,30.4572199" target="_blank" rel="noopener" class="map-open-link">Відкрити в Google Maps →</a>' +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>" +
    "</div></section>";
  }

  global.OlivaServicePage = { build: build, esc: esc, fmtDur: fmtDur, branchLabel: branchLabel, contactsHtml: contactsHtml };
})(typeof window !== "undefined" ? window : globalThis);
