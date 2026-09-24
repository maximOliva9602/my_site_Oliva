/* ============================================================
   SEO-сторінки, які сервер віддає ГОТОВИМ HTML:
   - /service/<slug> — сторінка конкретної послуги (дані з service_pages);
   - /spa-dlya-dvoh-kyiv, /spa-dlya-odnogo-kyiv — категорійні сторінки,
     що збирають усі SPA-програми групи з живого прайсу.
   Розмітку сторінки послуги будує той самий public/assets/js/
   service-page-render.js, що й браузер, — тож те, що бачить пошуковик
   у першій відповіді, збігається з тим, що бачить людина.
   ============================================================ */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const db = require("./db");

const PUB = path.join(__dirname, "..", "public");
const BASE = "https://massage-oliva.com";

/* Клієнтські модулі (групи послуг і рендер сторінки) виконуємо в пісочниці
   з фейковим window — вони нічого, крім window.X = …, не роблять. */
function loadBrowserModules() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  ["assets/js/service-groups.js", "assets/js/service-page-render.js"].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(PUB, f), "utf8"), sandbox, { filename: f });
  });
  return { SG: sandbox.window.OlivaServiceGroups, SP: sandbox.window.OlivaServicePage };
}
const MODS = loadBrowserModules();
const SG = MODS.SG, SP = MODS.SP;
const esc = SP.esc;

/* ---- Транслітерація для ЧПУ (КМУ-2010, спрощено) ---- */
const TR = { а:"a",б:"b",в:"v",г:"h",ґ:"g",д:"d",е:"e",є:"ie",ж:"zh",з:"z",и:"y",і:"i",ї:"i",й:"i",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ь:"",ю:"iu",я:"ia","'":"","’":"","ʼ":"" };
function slugify(s) {
  return String(s || "").toLowerCase()
    .replace(/[а-яіїєґ'’ʼ]/g, function (c) { return TR[c] != null ? TR[c] : c; })
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/* ---- Дані ---- */
function publicServices() {
  return db.prepare(
    "SELECT id, name, duration_min, price, category, description, image_url, featured, in_carousel FROM services WHERE active=1 ORDER BY sort_order, id"
  ).all();
}
function publicBranches() {
  const branches = db.prepare("SELECT id, name, photo, address, subtitle, nearby FROM branches WHERE active=1 ORDER BY sort_order, id").all();
  const svcStmt = db.prepare("SELECT service_id FROM branch_services WHERE branch_id=?");
  branches.forEach(function (b) { b.service_ids = svcStmt.all(b.id).map(function (r) { return r.service_id; }); });
  return branches;
}
function groupOfKey(key, services) {
  const s = services.find(function (x) { return SG.parseName(x.name).cat === key; });
  return s ? SG.resolveGroup(s, key) : SG.resolveGroup({ name: key, category: "" }, key);
}

/* ---- Категорійні сторінки ---- */
const CATEGORIES = {
  "spa-dlya-dvoh-kyiv": {
    group: "spa2",
    crumb: "SPA для двох",
    h1: "SPA для двох у Києві",
    title: "SPA для двох у Києві — парні SPA-програми та масаж | Oliva",
    description: "SPA для двох у Києві: парний масаж, SPA-ритуал «Фіто-оновлення тіла» для двох, Stone Therapy для двох, тепловий ритуал «Глибоке прогрівання». Фітобочка, скраб, масаж. Подарунковий сертифікат. Онлайн-запис.",
    tagline: "Кілька годин тепла, тиші й турботи — удвох",
    intro: [
      "SPA для двох — це час, який ви проводите разом без телефонів, поспіху й щоденних справ. У студії Oliva ми зібрали кілька парних програм: від класичного парного масажу, коли двоє майстрів працюють одночасно в одному кабінеті, до багатоетапних SPA-ритуалів з фітобочкою на травах, скрабуванням тіла, масажем гарячим камінням і завершальним масажем.",
      "Парні програми обирають для побачення, річниці, дня народження, як подарунок батькам чи подрузі — або просто тоді, коли хочеться разом відпочити й перезавантажитись. Усе відбувається в одному просторі, тож ви не розходитесь по різних кімнатах і проживаєте цей досвід удвох.",
    ],
    howTo: [
      ["Хочете саме масаж", "Парний масаж — два майстри, два столи, одночасний сеанс. Оберіть тривалість 60, 90 чи 120 хвилин."],
      ["Хочете повний SPA-ритуал", "«Фіто-оновлення тіла» для двох поєднує фітобочку, скрабування, душ і масаж — це найповніша програма для двох."],
      ["Любите тепло", "Тепловий ритуал «Глибоке прогрівання» та Stone Therapy для двох — з гарячим камінням, що глибоко розслаблює м'язи."],
      ["Шукаєте подарунок", "Подарунковий сертифікат можна оформити на конкретну програму для двох або на суму — власник обере сам."],
    ],
    faq: [
      ["Чи будемо ми в одному кабінеті?", "Так. Парні програми проходять в одному просторі: двоє майстрів працюють одночасно, тож ви відпочиваєте разом."],
      ["Скільки триває SPA для двох?", "Залежить від програми: парний масаж — від 60 хвилин, SPA-ритуали — від 90 хвилин до кількох годин. Точну тривалість і ціну кожної програми видно в картках вище."],
      ["Чи можна подарувати SPA для двох?", "Так. На сторінці подарункового сертифіката оберіть потрібну програму або вкажіть суму. Сертифікат буває електронний або паперовий — паперовий можна забрати в студії чи замовити доставку."],
      ["Як записатися на SPA для двох?", "Натисніть «Записатися» в картці програми — відкриється онлайн-запис із уже обраною послугою, лишиться вибрати дату й час. Або зателефонуйте: 097 434 01 12."],
      ["Кому краще утриматися від прогрівання?", "Фітобочка й гаряче каміння — це тепло. За вагітності, підвищеної температури, гострих запалень, серцево-судинних захворювань чи інших хронічних станів проконсультуйтеся з лікарем і попередьте адміністратора під час запису."],
    ],
  },
  "spa-dlya-odnogo-kyiv": {
    group: "spa1",
    crumb: "SPA для одного",
    h1: "SPA для одного у Києві",
    title: "SPA для одного у Києві — SPA-ритуали, фітобочка, стоун-масаж | Oliva",
    description: "SPA для одного у Києві: SPA-ритуал «Фіто-оновлення тіла», масаж гарячим камінням, фітобочка на травах. Індивідуальний релакс у студії Oliva. Ціни з актуального прайсу, онлайн-запис.",
    tagline: "Час, присвячений тільки собі",
    intro: [
      "SPA для одного — це індивідуальні програми, коли вся увага майстра належить лише вам. Тепло фітобочки на травах, делікатне скрабування, масаж гарячим камінням і завершальний масаж послідовно знімають напругу й повертають відчуття легкості.",
      "Такі ритуали обирають після напруженого тижня, перед важливою подією або як регулярний спосіб відновитися. Нижче — усі SPA-програми для одного з актуальними цінами й тривалістю.",
    ],
    howTo: [
      ["Потрібне повне перезавантаження", "SPA-ритуал «Фіто-оновлення тіла»: фітобочка, скраб, душ і масаж в одному сеансі — 90 або 130 хвилин."],
      ["Хочеться глибокого тепла", "Масаж гарячим камінням прогріває м'язи й допомагає розслабитися навіть там, де звичайний масаж не дістає."],
      ["Мало часу", "Паріння у фітобочці можна взяти окремо або додати до будь-якого масажу."],
      ["Шукаєте подарунок", "Подарунковий сертифікат — на конкретний ритуал або на суму."],
    ],
    faq: [
      ["Що входить у SPA-ритуал «Фіто-оновлення тіла»?", "Паріння у фітобочці на травах, скрабування, душ і масаж. У варіанті 90 хвилин — 20 хвилин фітобочки, 10 хвилин скрабу й 60 хвилин масажу; у варіанті 130 хвилин — 30, 10 і 90 хвилин відповідно."],
      ["Чим SPA відрізняється від звичайного масажу?", "SPA-програма — це кілька етапів: прогрівання, догляд за шкірою й масаж. Тіло розслабляється поступово, тож ефект глибший і тримається довше."],
      ["Чи можна прийти вдвох?", "Так, для пар є окремі програми — дивіться сторінку «SPA для двох у Києві»."],
      ["Кому краще утриматися від прогрівання?", "За вагітності, підвищеної температури, гострих запалень, серцево-судинних захворювань чи інших хронічних станів проконсультуйтеся з лікарем і попередьте адміністратора під час запису."],
    ],
  },
};

/* Картки програм категорії — з живого прайсу, згруповані за базовою назвою. */
function categoryCards(group, services, branches, pagesByKey) {
  const byCat = {}, order = [];
  services.forEach(function (s) {
    const p = SG.parseName(s.name);
    if (!p.cat || SG.resolveGroup(s, p.cat) !== group) return;
    if (!byCat[p.cat]) { byCat[p.cat] = { key: p.cat, rows: [], image: null, description: "" }; order.push(p.cat); }
    const c = byCat[p.cat];
    c.rows.push({ id: s.id, dur: p.dur || s.duration_min, price: s.price });
    if (!c.image && s.image_url) c.image = s.image_url;
    if (!c.description && s.description) c.description = s.description;
  });
  return order.map(function (k) {
    const c = byCat[k];
    const page = pagesByKey[k];
    const durs = {};
    c.rows.forEach(function (r) { if (durs[r.dur] == null || r.price < durs[r.dur]) durs[r.dur] = r.price; });
    const ids = c.rows.map(function (r) { return r.id; });
    const where = branches.filter(function (b) {
      return !(b.service_ids || []).length || b.service_ids.some(function (id) { return ids.indexOf(id) !== -1; });
    }).map(SP.branchLabel);
    const cheapest = c.rows.slice().sort(function (a, b) { return a.price - b.price; })[0];
    return {
      key: k, title: page && page.hero_title ? page.hero_title : k,
      image: (page && page.hero_photo) || c.image,
      description: (page && page.hero_description) || c.description,
      durs: Object.keys(durs).map(Number).sort(function (a, b) { return a - b; }).map(function (d) { return { dur: d, price: durs[d] }; }),
      where: where,
      href: page ? "/service/" + page.slug : null,
      book: "/booking.html?service=" + cheapest.id,
    };
  });
}

function renderCategoryHtml(slug, services, branches, pagesByKey) {
  const cfg = CATEGORIES[slug];
  const cards = categoryCards(cfg.group, services, branches, pagesByKey);
  let html = "";
  html += '<section class="hero hero--compact"><div class="hero-bg-fallback"></div><div class="hero-overlay"></div>' +
    '<div class="wrap"><div class="hero-inner">' +
    '<div class="hero-eyebrow">Студія масажу Oliva · Київ</div>' +
    '<h1 class="hero-title">' + esc(cfg.h1) + "</h1>" +
    '<div class="hero-btns"><a href="/booking.html?group=' + cfg.group + '" class="btn btn-primary">Записатися онлайн →</a>' +
    '<a href="/certificate.html" class="btn btn-secondary">🎁 Подарувати сертифікат</a></div>' +
    "</div></div></section>";
  html += '<div class="hero-sub"><div class="hero-tagline">' + esc(cfg.tagline) + "</div></div>";
  html += '<nav class="crumbs" aria-label="Навігація"><div class="wrap"><a href="/">Головна</a><span>›</span><a href="/#services">Послуги</a><span>›</span><span class="crumbs-cur">' + esc(cfg.crumb) + "</span></div></nav>";
  html += '<section class="block"><div class="wrap">' + cfg.intro.map(function (p) { return '<p class="detail-desc" style="max-width:820px;">' + esc(p) + "</p>"; }).join("") + "</div></section>";

  html += '<section class="block"><div class="wrap"><h2 class="block-title">Програми та ціни</h2><div class="cat-grid">' +
    cards.map(function (c) {
      return '<article class="cat-card">' +
        (c.image ? '<div class="cat-card-img"><img src="' + esc(c.image) + '" alt="' + esc(c.title) + '" loading="lazy"></div>' : "") +
        '<div class="cat-card-body">' +
          '<h3 class="cat-card-title">' + (c.href ? '<a href="' + esc(c.href) + '">' + esc(c.title) + "</a>" : esc(c.title)) + "</h3>" +
          (c.description ? '<p class="cat-card-desc">' + esc(c.description) + "</p>" : "") +
          '<div class="cat-card-prices">' + c.durs.map(function (d) {
            return '<div class="detail-price-row"><span>' + esc(SP.fmtDur(d.dur)) + "</span><b>" + Math.round(d.price / 100) + " грн</b></div>";
          }).join("") + "</div>" +
          (c.where.length ? '<div class="cat-card-where">📍 ' + esc(c.where.join(" · ")) + "</div>" : "") +
          '<div class="cat-card-actions"><a href="' + c.book + '" class="btn btn-primary">Записатися →</a>' +
          (c.href ? '<a href="' + esc(c.href) + '" class="btn btn-secondary">Детальніше</a>' : "") + "</div>" +
        "</div></article>";
    }).join("") +
    '<article class="cat-card cat-card--cert"><div class="cat-card-body">' +
      '<h3 class="cat-card-title">Подарунковий сертифікат на SPA</h3>' +
      '<p class="cat-card-desc">Сертифікат на будь-яку програму зі списку або на суму — електронний чи паперовий, з отриманням у студії або доставкою.</p>' +
      '<div class="cat-card-actions"><a href="/certificate.html" class="btn btn-primary">🎁 Оформити</a></div>' +
    "</div></article>" +
    "</div></div></section>";

  html += '<section class="block"><div class="wrap"><h2 class="block-title">Як обрати програму</h2><div class="benefits-grid">' +
    cfg.howTo.map(function (h) { return '<div class="benefit-card"><h3 class="benefit-title">' + esc(h[0]) + '</h3><div class="benefit-text">' + esc(h[1]) + "</div></div>"; }).join("") +
    "</div></div></section>";

  html += '<section class="block"><div class="wrap"><h2 class="block-title">Часті питання</h2><div class="faq-list">' +
    cfg.faq.map(function (f) { return '<details class="faq-item"><summary>' + esc(f[0]) + "</summary><p>" + esc(f[1]) + "</p></details>"; }).join("") +
    "</div></div></section>";

  const other = Object.keys(CATEGORIES).filter(function (k) { return k !== slug; });
  html += '<section class="block"><div class="wrap"><div class="related-row">' +
    other.map(function (k) { return '<a class="related-link related-link--cat" href="/' + k + '">' + esc(CATEGORIES[k].h1) + " →</a>"; }).join("") +
    '<a class="related-link" href="/#services">Усі послуги студії →</a></div></div></section>';

  html += SP.contactsHtml();

  const jsonld = [
    {
      "@context": "https://schema.org", "@type": "ItemList", "name": cfg.h1, "url": BASE + "/" + slug,
      "itemListElement": cards.map(function (c, i) {
        const it = { "@type": "ListItem", "position": i + 1, "name": c.title };
        if (c.href) it.url = BASE + c.href;
        return it;
      })
    },
    {
      "@context": "https://schema.org", "@type": "FAQPage",
      "mainEntity": cfg.faq.map(function (f) { return { "@type": "Question", "name": f[0], "acceptedAnswer": { "@type": "Answer", "text": f[1] } }; })
    },
    {
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Головна", "item": BASE + "/" },
        { "@type": "ListItem", "position": 2, "name": "Послуги", "item": BASE + "/#services" },
        { "@type": "ListItem", "position": 3, "name": cfg.crumb, "item": BASE + "/" + slug }
      ]
    }
  ];
  return { html: html, seoTitle: cfg.title, description: cfg.description, jsonld: jsonld, ogImage: BASE + "/assets/img/og-image.jpg" };
}

/* ---- Обгортка в шаблон service.html (навігація, стилі, кнопки) ---- */
function wrap(r, canonicalPath, bootData, opts) {
  opts = opts || {};
  let tpl = fs.readFileSync(path.join(PUB, "service.html"), "utf8");
  const url = BASE + canonicalPath;
  tpl = tpl.replace(/<title>[^<]*<\/title>/, "<title>" + esc(r.seoTitle) + "</title>")
    .replace('<meta name="description" content="" />', '<meta name="description" content="' + esc(r.description) + '" />')
    .replace('<meta property="og:title" content="" />', '<meta property="og:title" content="' + esc(r.seoTitle) + '" />')
    .replace('<meta property="og:description" content="" />', '<meta property="og:description" content="' + esc(r.description) + '" />')
    .replace('<meta property="og:url" content="" />', '<meta property="og:url" content="' + url + '" />')
    .replace(/<meta property="og:image" content="[^"]*" \/>/, '<meta property="og:image" content="' + esc(r.ogImage) + '" />')
    .replace('<link rel="canonical" href="" />', '<link rel="canonical" href="' + url + '" />' +
      (opts.noindex ? '\n  <meta name="robots" content="noindex" />' : "") +
      (r.jsonld || []).map(function (j) {
        return '\n  <script type="application/ld+json">' + JSON.stringify(j).replace(/</g, "\\u003c") + "</script>";
      }).join(""));
  const boot = bootData
    ? "<script>window.__SVC_PAGE__=" + JSON.stringify(bootData).replace(/</g, "\\u003c") + ";</script>"
    : "<script>window.__SVC_STATIC__=true;</script>";
  tpl = tpl.replace('<div id="pageContent"><div class="loading">Завантаження…</div></div>',
    '<div id="pageContent">' + r.html + "</div>\n" + boot);
  return tpl;
}

function allPages() {
  return db.prepare("SELECT * FROM service_pages").all();
}
function pagesByKey(published) {
  const map = {};
  allPages().forEach(function (p) { if (!published || p.published) map[p.service_key] = p; });
  return map;
}
function categoryLinkFor(group) {
  const slug = Object.keys(CATEGORIES).filter(function (k) { return CATEGORIES[k].group === group; })[0];
  return slug ? { title: CATEGORIES[slug].crumb, href: "/" + slug } : null;
}

/* Сторінка послуги: page — рядок service_pages. */
function renderServicePage(page) {
  const services = publicServices();
  const branches = publicBranches();
  const group = groupOfKey(page.service_key, services);
  const others = allPages().filter(function (p) { return p.published && p.service_key !== page.service_key && p.slug; });
  const related = others.filter(function (p) { return groupOfKey(p.service_key, services) === group; })
    .slice(0, 6).map(function (p) { return { title: p.hero_title || p.service_key, href: "/service/" + p.slug }; });
  const pathname = "/service/" + page.slug;
  const data = { page: page, services: services, branches: branches, related: related, categoryLink: categoryLinkFor(group), path: pathname };
  const r = SP.build({ page: page, services: services, branches: branches, groups: SG, related: related, categoryLink: data.categoryLink, path: pathname });
  return wrap(r, pathname, data);
}

function renderCategory(slug) {
  if (!CATEGORIES[slug]) return null;
  const r = renderCategoryHtml(slug, publicServices(), publicBranches(), pagesByKey(true));
  return wrap(r, "/" + slug, null);
}

function renderNotFound() {
  return wrap({
    html: '<div class="loading">Сторінку не знайдено. <a href="/#services" style="color:var(--olive-light)">← До послуг</a></div>',
    seoTitle: "Сторінку не знайдено — Студія масажу Oliva", description: "", jsonld: [], ogImage: BASE + "/assets/img/og-image.jpg"
  }, "/", null, { noindex: true });
}

/* Унікальний slug для сторінки (якщо зайнятий — додаємо -2, -3…). */
function uniqueSlug(base, exceptKey) {
  let s = slugify(base) || "posluga", n = 1, cand = s;
  const taken = db.prepare("SELECT 1 FROM service_pages WHERE slug=? AND service_key<>?");
  while (taken.get(cand, exceptKey || "")) { n++; cand = s + "-" + n; }
  return cand;
}

/* ---- Міграція (раз при старті) ----
   1) нові колонки: slug (ЧПУ), seo_title, seo_description, faq_items;
   2) сторінки, у яких назву послуги набрано з помилкою (латинські «Р/А»
      замість кириличних, зайві лапки чи «т т» у кінці), не збігались із
      жодною послугою прайсу — на них не було цін і на головній не
      з'являлась кнопка «Про цей масаж». Прив'язуємо до правильної назви;
   3) кожній сторінці — slug;
   4) для «Фіто-оновлення тіла» — SEO-заголовок, опис, текст і FAQ
      (лише якщо поля порожні — тексти власника не перезаписуємо). */
function normKey(s) {
  const LAT = { "а":"a","р":"p","с":"c","е":"e","о":"o","х":"x","і":"i","в":"b","к":"k","м":"m","н":"h","т":"t" };
  return String(s || "").toLowerCase().replace(/[арсеохівкмнт]/g, function (c) { return LAT[c]; })
    .replace(/[«»"'()\[\]“”„]/g, " ").replace(/[^a-zа-яіїєґ0-9]+/gi, " ").replace(/\s+/g, " ").trim();
}
const EXPLICIT_SLUGS = {
  'SPA Ритуал "Фіто-оновлення тіла"': "fito-onovlennya-tila",
  'SPA Ритуал "Фіто-оновлення тіла"(для двох)': "fito-onovlennya-tila-dlya-dvoh",
  'Тепловий SPA-ритуал "Глибоке прогрівання для двох"': "glyboke-progrivannya-dlya-dvoh",
};
function migrate() {
  ["slug", "seo_title", "seo_description", "faq_items"].forEach(function (c) {
    try { db.exec("ALTER TABLE service_pages ADD COLUMN " + c + " TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  });
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_pages_slug ON service_pages(slug) WHERE slug<>''"); } catch (e) { console.error("[seo] slug index:", e.message); }

  const baseNames = {};
  publicServices().forEach(function (s) { const c = SG.parseName(s.name).cat; if (c) baseNames[c] = true; });
  const names = Object.keys(baseNames);
  allPages().forEach(function (p) {
    if (baseNames[p.service_key]) return;
    const nk = normKey(p.service_key);
    const hit = names.filter(function (n) {
      const nn = normKey(n);
      return nn === nk || (nk.indexOf(nn) === 0 && nk.length - nn.length <= 4);
    });
    if (hit.length !== 1) return;
    if (db.prepare("SELECT 1 FROM service_pages WHERE service_key=?").get(hit[0])) return;
    db.prepare("UPDATE service_pages SET service_key=? WHERE service_key=?").run(hit[0], p.service_key);
    console.log("[seo] сторінку «" + p.service_key + "» прив'язано до послуги «" + hit[0] + "»");
  });

  allPages().forEach(function (p) {
    if (p.slug) return;
    const want = EXPLICIT_SLUGS[p.service_key];
    const slug = want && !db.prepare("SELECT 1 FROM service_pages WHERE slug=?").get(want) ? want : uniqueSlug(p.service_key, p.service_key);
    db.prepare("UPDATE service_pages SET slug=? WHERE service_key=?").run(slug, p.service_key);
  });

  const FLAG = "migr_seo_fito_content";
  if (!db.prepare("SELECT 1 FROM app_settings WHERE key=?").get(FLAG)) {
    const key = 'SPA Ритуал "Фіто-оновлення тіла"';
    const p = db.prepare("SELECT * FROM service_pages WHERE service_key=?").get(key);
    if (p) {
      const set = {};
      if (!p.seo_title) set.seo_title = "SPA у Києві «Фіто-оновлення тіла» | Фітобочка + масаж | Oliva";
      if (!p.seo_description) set.seo_description = "SPA-ритуал у Києві: фітобочка, скрабування та професійний масаж. 90 або 130 хвилин. Oliva Massage Studio, Шулявка. Онлайн-запис.";
      if (p.hero_title === "SPA Ритуал Фіто-оновлення тіла" || !p.hero_title) set.hero_title = "SPA «Фіто-оновлення тіла» у Києві";
      if (!p.detail_description) set.detail_description = FITO_TEXT;
      if (!p.faq_items) set.faq_items = FITO_FAQ;
      const cols = Object.keys(set);
      if (cols.length) {
        const upd = db.prepare("UPDATE service_pages SET " + cols.map(function (c) { return c + "=?"; }).join(",") + " WHERE service_key=?");
        upd.run.apply(upd, cols.map(function (c) { return set[c]; }).concat([key]));
        console.log("[seo] «Фіто-оновлення тіла»: заповнено " + cols.join(", "));
      }
      db.prepare("INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,'1')").run(FLAG);
    }
  }
}

const FITO_TEXT = [
  "«Фіто-оновлення тіла» — це SPA у Києві, яке поєднує три етапи догляду в одному сеансі: паріння у фітобочці на травах, скрабування тіла та професійний масаж. Кожен етап готує тіло до наступного, тож розслаблення приходить поступово й тримається довше, ніж після звичайного масажу.",
  "Що входить у SPA. Спершу — фітобочка: м'яке тепло й пара з цілющими травами прогрівають м'язи, розкривають пори й допомагають відпустити напругу. Далі — скрабування: шкіра очищується від ороговілих клітин і стає гладкою та м'якою. Після душу — масаж, під час якого майстер працює з уже прогрітими, піддатливими м'язами.",
  "Тривалість і ціна. Ритуал триває 90 або 130 хвилин. У варіанті на 90 хвилин — 20 хвилин фітобочки, 10 хвилин скрабу й 60 хвилин масажу. У варіанті на 130 хвилин — 30 хвилин фітобочки, 10 хвилин скрабу й 90 хвилин масажу, тож на кожну зону тіла вистачає часу. Актуальну ціну обох варіантів видно в блоці «Ціна за візит» вище.",
  "Кому підійде. Цей SPA для одного обирають, коли звичайного масажу вже замало: після напружених тижнів, перед відпусткою чи важливою подією, у холодний сезон, коли хочеться як слід прогрітися, або просто як спосіб приділити час собі. Якщо хочете прийти разом — є окрема програма «Фіто-оновлення тіла» для двох.",
  "Де проходить. Фітобочка встановлена в студії Oliva на вул. Борщагівській, 145 — Солом'янський район, поруч із метро «Шулявська» та Індустріальним мостом. Записатися можна онлайн: оберіть тривалість, майстра й зручний час — адміністратор підтвердить запис.",
  "Подарунковий сертифікат. SPA-ритуал — один із найпопулярніших подарунків у студії. Сертифікат можна оформити саме на «Фіто-оновлення тіла» або на суму, щоб отримувач обрав процедуру сам.",
].join("\n");
const FITO_FAQ = [
  "Чим відрізняються варіанти 90 і 130 хвилин? :: Складом ритуалу: у 90-хвилинному — 20 хвилин фітобочки й 60 хвилин масажу, у 130-хвилинному — 30 хвилин фітобочки й 90 хвилин масажу. Скрабування в обох варіантах триває 10 хвилин.",
  "Чи можна пройти SPA удвох? :: Так, для пар є окрема програма «Фіто-оновлення тіла» для двох, а всі парні програми зібрані на сторінці «SPA для двох у Києві».",
  "Кому краще утриматися від фітобочки? :: Прогрівання не рекомендоване за вагітності, підвищеної температури, гострих запалень, серцево-судинних захворювань та деяких хронічних станів. Якщо сумніваєтесь — порадьтеся з лікарем і попередьте адміністратора під час запису.",
  "Чи можна подарувати цей ритуал? :: Так, оформіть подарунковий сертифікат на «Фіто-оновлення тіла» або на суму — електронний чи паперовий; паперовий можна забрати в студії або замовити доставку.",
].join("\n");

module.exports = {
  migrate,
  slugify, uniqueSlug, renderServicePage, renderCategory, renderNotFound,
  CATEGORY_SLUGS: Object.keys(CATEGORIES), categoryLinkFor, SG,
};
