/* ============================================================
   Студія масажу Oliva — сервер (Railway-ready)
   - роздає статичний сайт із /public;
   - живий онлайн-чат на Socket.IO:
       • відвідувач пише у віджеті на сайті;
       • менеджер відповідає зі сторінки /admin (логін + пароль).
   Сховище діалогів — у памʼяті (скидається при перезапуску).
   Для збереження історії між деплоями — підключити БД (див. README).
   ============================================================ */

const path = require("path");
const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const express = require("express");
const { Server } = require("socket.io");

/* ---------------- CRM-модулі ---------------- */
const db = require("./crm/db");
const auth = require("./crm/auth");
const requireAdmin = auth.requireAuth();
const notify = require("./crm/notify");
const scheduler = require("./crm/scheduler");
const publicRoutes = require("./crm/routes.public");
const crmRoutes = require("./crm/routes.crm");
const webhookRoutes = require("./crm/routes.webhook");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "oliva-admin";
const IS_PROD = process.env.NODE_ENV === "production";
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const OWNER_VIBER_PHONE = process.env.OWNER_VIBER_PHONE || "";
const PRIMARY_SITE_URL = "https://massage-oliva.com";
const LEGACY_SITE_HOST = "massage-solomyanskyi.com.ua";

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[chat] УВАГА: ADMIN_PASSWORD не задано — використовується типовий "oliva-admin". Задайте у Railway → Variables.');
}
if (!TG_TOKEN || !TG_CHAT_ID) {
  console.warn('[telegram] TELEGRAM_BOT_TOKEN або TELEGRAM_CHAT_ID не задано — сповіщення в Telegram вимкнено.');
}

/* ---------------- Telegram-сповіщення ---------------- */
/* Повертає true/false (а не кидає), щоб виклик міг зреагувати на
   недоступність Telegram — напр. переслати те саме повідомлення
   резервним каналом (див. sendOwnerViberFallback нижче). */
async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) return false;
  try {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: text, parse_mode: "HTML" });
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!res.ok) { console.error("[telegram] Помилка:", await res.text()); return false; }
    return true;
  } catch (e) {
    console.error("[telegram] fetch error:", e.message);
    return false;
  }
}

/* Резервний канал, коли Telegram недоступний (бот заблокований, немає
   мережі тощо) — той самий turbosms-драйвер, що й нагадування клієнтам
   (каскад Viber → SMS), лише адресований власнику на OWNER_VIBER_PHONE.
   Без TURBOSMS_TOKEN/OWNER_VIBER_PHONE просто нічого не робить — щоб не
   ламати проєкти, де ще немає TurboSMS-акаунта. */
async function sendOwnerViberFallback(text) {
  if (!OWNER_VIBER_PHONE) { console.warn("[review] OWNER_VIBER_PHONE не задано — Viber-фолбек пропущено."); return false; }
  try {
    const turbosms = require("./crm/drivers/turbosms");
    await turbosms.sendMessage({ phone: OWNER_VIBER_PHONE, text: text, transactional: true });
    return true;
  } catch (e) {
    console.error("[review] Viber-фолбек не вдався:", e.message);
    return false;
  }
}

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: false, limit: "15mb" }));
/* API — завжди динамічний контент (сесія, права доступу, дані). Без
   явного no-store браузер чи Cloudflare (тут "Cache Everything" на
   весь домен) можуть кешувати відповідь і віддавати її наступному
   користувачу/сесії — саме так власник міг раптом отримати застарілий
   can_see_phones:false з чужої кешованої відповіді /api/admin/me. */
app.use("/api", function (req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  next();
});
/* Старий домен ще може бути у закладках, Google або повідомленнях.
   Поки він підключений до сервісу, постійно переводимо весь трафік на
   новий домен зі збереженням шляху та параметрів. */
app.use(function (req, res, next) {
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = (forwardedHost || req.hostname || "").split(":")[0].toLowerCase();
  if (host === LEGACY_SITE_HOST) return res.redirect(301, PRIMARY_SITE_URL + req.originalUrl);
  next();
});
/* Явні заголовки кешу. Без них Cloudflare підставляє свій max-age=14400,
   і правки в js/css доїжджають до користувачів лише через 4 години.
   Код і розмітку віддаємо з обов'язковою ревалідацією (ETag все одно
   поверне 304, якщо файл не змінився), медіа — кешуємо надовго. */
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: function (res, filePath) {
    if (/\.(js|css|html|json)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    } else {
      res.setHeader("Cache-Control", "public, max-age=2592000"); // 30 днів
    }
  },
}));

/* ---------------- In-memory сховище ---------------- */
// conversations: visitorId -> { id, name, messages:[{from,text,ts}], lastTs, unread }
const conversations = new Map();
// Сесії адміна/CRM живуть у crm/auth.js (спільні для чату, блогу й CRM)
const SESSION_TTL = auth.SESSION_TTL;
const MAX_LEN = 2000;

function getConv(id) {
  let c = conversations.get(id);
  if (!c) {
    c = { id: id, name: "Гість", messages: [], lastTs: Date.now(), unread: 0 };
    conversations.set(id, c);
  }
  return c;
}
function summary() {
  return Array.from(conversations.values())
    .sort(function (a, b) { return b.lastTs - a.lastTs; })
    .map(function (c) {
      var last = c.messages.length ? c.messages[c.messages.length - 1] : null;
      return { id: c.id, name: c.name, last: last ? last.text : "", lastFrom: last ? last.from : "", lastTs: c.lastTs, unread: c.unread };
    });
}
function clean(s, max) { return String(s == null ? "" : s).slice(0, max || MAX_LEN); }
function parseCookies(header) {
  var out = {};
  (header || "").split(";").forEach(function (p) {
    var i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function validToken(token) { return auth.validToken(token); }

/* ---------------- Авторизація адміна / CRM ----------------
   Підтримує власника ({password} = ADMIN_PASSWORD) і майстрів
   ({username,password} з таблиці users). Повертає role + masterId. */
app.post("/api/admin/login", function (req, res) {
  var r = auth.login(req.body || {});
  if (!r.ok) return res.status(401).json({ ok: false });
  res.cookie("oliva_admin", r.token, {
    httpOnly: true, sameSite: "lax", secure: IS_PROD, maxAge: SESSION_TTL, path: "/"
  });
  res.json({ ok: true, role: r.role, masterId: r.masterId });
});
app.post("/api/admin/logout", function (req, res) {
  var token = parseCookies(req.headers.cookie).oliva_admin;
  auth.destroySession(token);
  res.clearCookie("oliva_admin", { path: "/" });
  res.json({ ok: true });
});
app.get("/api/admin/me", function (req, res) {
  var token = parseCookies(req.headers.cookie).oliva_admin;
  var s = auth.getSession(token);
  if (!s) return res.json({ ok: false });
  var canSeePhones = s.role === "owner";
  if (!canSeePhones && s.masterId) {
    var db = require("./crm/db");
    var m = db.prepare("SELECT can_see_phones FROM masters WHERE id=?").get(s.masterId);
    canSeePhones = !!(m && m.can_see_phones);
  }
  res.json({ ok: true, role: s.role, masterId: s.masterId, can_see_phones: canSeePhones });
});

/* ---------------- CRM-роути ----------------
   Монтуються ДО catch-all. Публічні — без авторизації; /api/crm —
   усередині перевіряє requireAuth; вебхук — спільний секрет. */
app.use("/api/public", publicRoutes);
app.use("/api/crm", crmRoutes);
app.use("/api/webhooks", webhookRoutes);

/* ---------------- Web Push API ---------------- */
const adminNotify = require("./crm/admin-notify");

/* Публічний ключ VAPID (для клієнта) */
app.get("/api/push/vapid-public-key", function (req, res) {
  res.json({ ok: true, publicKey: adminNotify.VAPID_PUBLIC || "" });
});

/* Підписатися на push (тільки залогінені) */
app.post("/api/push/subscribe", function (req, res) {
  var token = auth.parseCookies(req.headers.cookie).oliva_admin;
  var session = auth.getSession(token);
  if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });
  var sub = req.body && req.body.subscription;
  if (!sub) return res.status(400).json({ ok: false, error: "no subscription" });
  try {
    var json = JSON.stringify(sub);
    /* UPSERT, а не INSERT OR IGNORE: subscription_json — UNIQUE, і той самий
       endpoint лишається за пристроєм. Якщо на пристрої раніше логінився
       інший акаунт, рядок зберігав ЙОГО user_id, а нова підписка мовчки
       ігнорувалась — і майстер не отримував сповіщень про власні записи.
       Тепер підписка завжди належить тому, хто залогінений зараз. */
    /* Роль і майстра пишемо явно: за user_id відрізнити власника від
       майстра не можна (у bootstrap-власника він NULL, і такий самий NULL
       лишався на телефоні майстра після чужого логіну). */
    db.prepare(
      "INSERT INTO push_subscriptions (subscription_json, user_id, role, master_id, created_at) VALUES (?,?,?,?,?) " +
      "ON CONFLICT(subscription_json) DO UPDATE SET " +
      "user_id=excluded.user_id, role=excluded.role, master_id=excluded.master_id"
    ).run(json, session.userId || null, session.role || "worker", session.masterId || null, Date.now());
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* Тест push — повертає кількість підписок і надсилає тестове сповіщення */
app.post("/api/push/test", function (req, res) {
  var token = auth.parseCookies(req.headers.cookie).oliva_admin;
  var session = auth.getSession(token);
  if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });
  var subs = [];
  try { subs = db.prepare("SELECT id, created_at FROM push_subscriptions").all(); } catch(e) {}
  if (subs.length === 0) {
    return res.json({ ok: false, error: "no_subscriptions", count: 0 });
  }
  adminNotify.sendPushToAll("🔔 Тест сповіщення Oliva CRM — працює!")
    .then(function(stats) { res.json({ ok: true, count: subs.length, sent: stats.sent, removed: stats.removed, failed: stats.failed }); })
    .catch(function(e) { res.status(500).json({ ok: false, error: e.message, count: subs.length }); });
});

/* Відписатися */
app.post("/api/push/unsubscribe", function (req, res) {
  var sub = req.body && req.body.subscription;
  if (!sub) return res.status(400).json({ ok: false, error: "no subscription" });
  try {
    db.prepare("DELETE FROM push_subscriptions WHERE subscription_json=?").run(JSON.stringify(sub));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------------- Трекінг відвідувань сайту ---------------- */
var trackRateMap = new Map(); // ip -> [timestamps]
app.post("/api/track", function (req, res) {
  res.json({ ok: true }); // відповідаємо одразу — не блокуємо браузер

  try {
    var b = req.body || {};
    var ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    // Rate limit: не більше 60 подій з однієї IP за хвилину
    var now = Date.now();
    var times = (trackRateMap.get(ip) || []).filter(function(t){ return now - t < 60000; });
    if (times.length >= 60) return;
    times.push(now);
    trackRateMap.set(ip, times);

    var ipHash = require("crypto").createHash("sha256").update(ip + (process.env.TRACK_SALT||"oliva")).digest("hex").slice(0,16);
    var ua = (req.headers["user-agent"] || "").toLowerCase();
    var uaType = /mobile|android|iphone|ipad/.test(ua) ? "mobile" : "desktop";

    /* 200 було затісно: довша кирилична назва послуги ("Вогняний масаж
       бамбуковими банками" → /service/...) у URL-кодуванні вже сама по
       собі під 200+ символів (кожна кирилична літера — 6 символів
       "%XX%XX"), тож обрізка регулярно падала прямо всередину %XX-послідовності
       — виходив непридатний для decodeURIComponent рядок. */
    var path    = String(b.path    || "/").slice(0, 400);
    var referrer= String(b.referrer|| "").slice(0, 500);
    var utmSrc  = String(b.utm_source  || "").slice(0, 100);
    var utmMed  = String(b.utm_medium  || "").slice(0, 100);
    var utmCamp = String(b.utm_campaign|| "").slice(0, 100);
    var event   = /^[a-z_]{1,30}$/.test(b.event||"") ? b.event : "pageview";
    var label   = String(b.label || "").slice(0, 100);
    var sid     = String(b.session_id || "").slice(0, 40);

    db.prepare(
      "INSERT INTO page_visits (path,referrer,utm_source,utm_medium,utm_campaign,event,label,session_id,ip_hash,ua_type,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).run(path, referrer||null, utmSrc||null, utmMed||null, utmCamp||null, event, label||null, sid||null, ipHash, uaType, now);
  } catch(e) {
    console.error("[track]", e.message);
  }
});
// Очищення старих записів з rate-map кожні 5 хв
setInterval(function(){ trackRateMap.clear(); }, 5*60*1000);

/* ---- Публічний відгук (без авторизації) ---- */
app.get("/api/review/:public_id", function (req, res) {
  const a = db.prepare(
    `SELECT a.public_id, a.date, a.status, s.name service_name, m.name master_name, m.id master_id,
            c.name client_name
       FROM appointments a JOIN services s ON s.id=a.service_id
       JOIN masters m ON m.id=a.master_id JOIN clients c ON c.id=a.client_id
      WHERE a.public_id=?`
  ).get(req.params.public_id);
  if (!a) return res.status(404).json({ ok: false });
  const already = db.prepare("SELECT id FROM reviews WHERE appointment_id=(SELECT id FROM appointments WHERE public_id=?)").get(req.params.public_id);
  res.json({ ok: true, appointment: a, already_reviewed: !!already });
});

app.post("/api/review/:public_id", function (req, res) {
  const a = db.prepare(
    "SELECT id, master_id, client_id, status FROM appointments WHERE public_id=?"
  ).get(req.params.public_id);
  if (!a) return res.status(404).json({ ok: false, error: "not found" });
  if (a.status !== "completed") return res.status(400).json({ ok: false, error: "appointment not completed" });
  const d = req.body || {};
  const rating = parseInt(d.rating, 10);
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ ok: false, error: "invalid rating" });
  const comment = String(d.comment || "").slice(0, 1000).trim();
  try {
    db.prepare(
      "INSERT INTO reviews (appointment_id, master_id, client_id, rating, comment, created_at) VALUES (?,?,?,?,?,?)"
    ).run(a.id, a.master_id, a.client_id, rating, comment || null, Date.now());
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ ok: false, error: "already reviewed" });
  }
});

app.get("/cabinet", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "cabinet.html"));
});
app.get("/booking", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "booking.html"));
});
app.get("/master", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "master.html"));
});

// API для майстра — розклад
app.get("/api/master/schedule", requireAdmin, function (req, res) {
  var db = require("./crm/db");
  var masterId = parseInt(req.query.master_id, 10);
  if (!masterId) return res.status(400).json({ ok: false, error: "master_id required" });

  var rows;
  if (req.query.date) {
    // один день
    rows = db.prepare(`
      SELECT a.id, a.date, a.start_min, a.end_min, a.duration_min, a.status, a.comment,
             s.name service_name, c.name client_name, c.phone client_phone
      FROM appointments a
      JOIN services s ON s.id = a.service_id
      JOIN clients  c ON c.id = a.client_id
      WHERE a.master_id = ? AND a.date = ? AND a.status NOT IN ('cancelled')
      ORDER BY a.start_min
    `).all(masterId, req.query.date);
  } else {
    // діапазон for dots
    var from = req.query.from || new Date().toISOString().slice(0,10);
    var to   = req.query.to   || from;
    rows = db.prepare(`
      SELECT a.id, a.date, a.start_min, a.status
      FROM appointments a
      WHERE a.master_id = ? AND a.date >= ? AND a.date <= ? AND a.status NOT IN ('cancelled')
      ORDER BY a.date, a.start_min
    `).all(masterId, from, to);
  }
  res.json({ ok: true, appointments: rows });
});

app.get("/admin", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/share", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "share.html"));
});
app.get("/google-review", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "google-review.html"));
});
app.get("/tips", function (req, res) {
  res.redirect(301, "/share?tab=tips");
});

app.get("/certificate", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "certificate.html"));
});

app.get("/shop", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "shop.html"));
});

app.get("/training", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "training.html"));
});

/* ---------------- API: Замовлення сертифіката ---------------- */
app.post("/api/certificate", async function (req, res) {
  var d = req.body || {};
  var name      = String(d.name      || "").slice(0, 100).trim();
  var phone     = String(d.phone     || "").slice(0, 30).trim();
  var recipient = String(d.recipient || "").slice(0, 100).trim();
  var service   = String(d.service   || "").slice(0, 150).trim();
  var price     = String(d.price     || "").slice(0, 20).trim();
  var service2  = String(d.service2  || "").slice(0, 150).trim();
  var price2    = String(d.price2    || "").slice(0, 20).trim();
  var certType  = String(d.certType  || "").slice(0, 30).trim();
  var delivery  = String(d.delivery  || "").slice(0, 50).trim();
  var address   = String(d.address   || "").slice(0, 200).trim();
  var wishes    = String(d.wishes    || "").slice(0, 500).trim();

  if (!name || !phone || !recipient || !service || !price || !certType || !delivery) {
    return res.status(400).json({ ok: false, error: "missing fields" });
  }

  var deliveryLine = delivery === "Отримаю у студії"
    ? `🏠 <b>Отримання:</b> У студії`
    : `📦 <b>Доставка:</b> ${delivery}` + (address ? ` — ${address}` : "");

  var serviceLine = service2
    ? `💆 <b>Послуга 1:</b> ${service} — ${price} грн\n💆 <b>Послуга 2:</b> ${service2} — ${price2} грн`
    : `💆 <b>Послуга:</b> ${service}`;

  var totalPriceNum = parseFloat(d.totalPrice) || parseFloat(price) || 0;
  var totalPrice = `${totalPriceNum || price} грн`;

  /* Порядковий номер замовлення — щоб власник бачив його і в CRM
     (вкладка "Сертифікати"), і в Telegram, і щоб самому написати той
     самий номер на сертифікаті. Зберігаємо як наступне число після
     останнього виданого (лічильник у app_settings, старт з 1000 —
     виглядає як реальний номер бланка, а не порядковий індекс 1,2,3).
     Записуємо синхронно (better-sqlite3), без await між читанням і
     інкрементом — паралельні запити не можуть отримати той самий номер. */
  var certCode;
  var now = Date.now();
  var TWO_MONTHS_MS = 61 * 24 * 60 * 60 * 1000;
  try {
    var txn = db.transaction(function () {
      var row = db.prepare("SELECT value FROM app_settings WHERE key='cert_order_seq'").get();
      var next = (row ? parseInt(row.value, 10) : 999) + 1;
      db.prepare("INSERT INTO app_settings (key,value) VALUES ('cert_order_seq',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(String(next));
      certCode = String(next);
      db.prepare(
        `INSERT INTO certificates
           (code, buyer_name, buyer_phone, recipient, service_label, amount, cert_type, delivery, address, wishes, status, created_at, expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'ordered', ?, ?)`
      ).run(
        certCode, name, phone, recipient,
        service2 ? `${service} + ${service2}` : service,
        Math.round(totalPriceNum * 100), certType, delivery, address || null, wishes || null,
        now, now + TWO_MONTHS_MS
      );
    });
    txn();
  } catch (e) {
    console.error("[certificate] db insert error:", e.message);
    return res.status(500).json({ ok: false });
  }

  var text = `🎁 <b>Нове замовлення сертифіката!</b>\n\n` +
    `🔖 <b>№:</b> ${certCode}\n` +
    `👤 <b>Замовник:</b> ${name}\n` +
    `📞 <b>Телефон:</b> ${phone}\n` +
    `🎀 <b>Сертифікат для:</b> ${recipient}\n` +
    serviceLine + `\n` +
    `💰 <b>Вартість:</b> ${totalPrice}\n` +
    `📄 <b>Тип:</b> ${certType}\n` +
    deliveryLine +
    (wishes ? `\n📝 <b>Побажання:</b> ${wishes}` : "");

  try {
    await sendTelegram(text);
  } catch (e) {
    console.error("[certificate] telegram error:", e.message);
    // Замовлення вже в базі — відсутність Telegram-сповіщення не має
    // ламати клієнту сам процес оформлення.
  }
  res.json({ ok: true });
});

/* ---------------- API: Анонімний відгук ---------------- */
app.post("/api/review", async function (req, res) {
  var d = req.body || {};
  var rating  = parseInt(d.rating)  || 0;
  var master  = String(d.master  || "").slice(0, 100).trim();
  var text    = String(d.text    || "").slice(0, 1000).trim();
  var channel = String(d.channel || "").slice(0, 20).trim();
  var branch  = String(d.branch  || "").slice(0, 40).trim();
  if (!text || rating < 1 || rating > 5) {
    return res.status(400).json({ ok: false, error: "missing fields" });
  }
  var stars = "⭐".repeat(rating);
  var isGoogle = channel === "google";
  var branchLabel = branch === "teremky" || branch === "uspishna" ? "Успішна, 8" : "Борщагівська, 145";
  var msg = (isGoogle
    ? `✍️ <b>Новий відгук (${branchLabel}, публікує в Google)</b> #відгук\n\n`
    : `✍️ <b>Новий внутрішній відгук (${branchLabel})</b> #відгук\n\n`) + `${stars}\n` +
    (master ? `💆 <b>Майстер:</b> ${master}\n` : "") +
    `📝 ${text}`;
  var tgOk = await sendTelegram(msg);
  // Telegram недоступний (бот заблокований / не налаштований) — той самий
  // текст, без HTML-тегів, пробуємо резервним каналом.
  var viberOk = tgOk ? true : await sendOwnerViberFallback(msg.replace(/<[^>]+>/g, ""));
  if (!tgOk && !viberOk) {
    console.error("[review] відгук не надіслано жодним каналом (Telegram і Viber)");
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true });
});

app.get("/review", function (req, res) {
  res.redirect(301, "/share");
});

/* ============================================================
   BLOG
   Статті зберігаються в SQLite (та сама DB що і CRM) — на Railway Volume.
   ============================================================ */
function slugify(text) {
  return text.toLowerCase()
    .replace(/[іїєґ]/g, function(c){ return {і:'i',ї:'i',є:'e',ґ:'g'}[c]||c; })
    .replace(/[а-яёА-ЯЁ]/g, function(c){ var m='аáбвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'.split('');var t='aabvgdeyezhziyklmnoprstufhcchshschyieya'.split('');var i=m.indexOf(c);return i>=0?t[i]||'':c;})
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* Підготовлені запити для блогу */
var stmtAllPosts      = db.prepare("SELECT * FROM blog_posts ORDER BY date DESC, rowid DESC");
/* Статті-описи послуг (service_key != NULL) ховаємо із загального списку блогу */
var stmtPublicPosts   = db.prepare("SELECT id,slug,title,excerpt,cover,date FROM blog_posts WHERE published=1 AND (service_key IS NULL OR service_key='') ORDER BY date DESC, rowid DESC");
var stmtPostBySlug    = db.prepare("SELECT * FROM blog_posts WHERE slug=? AND published=1");
var stmtPostById      = db.prepare("SELECT * FROM blog_posts WHERE id=?");
var stmtInsertPost    = db.prepare("INSERT INTO blog_posts (id,slug,title,excerpt,body,cover,date,published,service_key) VALUES (?,?,?,?,?,?,?,?,?)");
var stmtUpdatePost    = db.prepare("UPDATE blog_posts SET title=?,excerpt=?,body=?,cover=?,published=?,service_key=? WHERE id=?");
var stmtServiceArticles = db.prepare("SELECT service_key, slug FROM blog_posts WHERE published=1 AND service_key IS NOT NULL AND service_key != ''");
var stmtDeletePost    = db.prepare("DELETE FROM blog_posts WHERE id=?");
var stmtSlugExists    = db.prepare("SELECT 1 FROM blog_posts WHERE slug=?");

/* Публічні ендпоінти */
app.get("/api/posts", function (req, res) {
  res.json(stmtPublicPosts.all());
});

app.get("/api/posts/:slug", function (req, res) {
  var post = stmtPostBySlug.get(req.params.slug);
  if (!post) return res.status(404).json({ ok: false });
  res.json(post);
});

/* Мапа «послуга → slug статті» для лінків «Читати повний опис» на головній */
app.get("/api/service-articles", function (req, res) {
  var map = {};
  stmtServiceArticles.all().forEach(function (r) { map[r.service_key] = r.slug; });
  res.json({ ok: true, map: map });
});

/* Адмін ендпоінти (захищені токеном) */

app.get("/api/admin/posts", requireAdmin, function (req, res) {
  res.json(stmtAllPosts.all());
});

app.post("/api/admin/posts", requireAdmin, function (req, res) {
  var d = req.body || {};
  var title = String(d.title || "").slice(0, 200).trim();
  if (!title) return res.status(400).json({ ok: false, error: "title required" });
  var id = crypto.randomBytes(8).toString("hex");
  var baseSlug = slugify(title) || id;
  var slug = baseSlug;
  var n = 1;
  while (stmtSlugExists.get(slug)) { slug = baseSlug + '-' + (n++); }
  var post = {
    id: id, slug: slug,
    title: title,
    excerpt: String(d.excerpt || "").slice(0, 500).trim(),
    body: String(d.body || "").slice(0, 200000).trim(),
    cover: String(d.cover || "").slice(0, 500).trim(),
    date: new Date().toISOString().slice(0, 10),
    published: d.published ? 1 : 0,
    service_key: String(d.service_key == null ? "" : d.service_key).slice(0, 120).trim() || null
  };
  stmtInsertPost.run(post.id, post.slug, post.title, post.excerpt, post.body, post.cover, post.date, post.published, post.service_key);
  res.json({ ok: true, post: post });
});

app.put("/api/admin/posts/:id", requireAdmin, function (req, res) {
  var d = req.body || {};
  var existing = stmtPostById.get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false });
  var title    = d.title     !== undefined ? String(d.title).slice(0, 200).trim()   : existing.title;
  var excerpt  = d.excerpt   !== undefined ? String(d.excerpt).slice(0, 500).trim() : existing.excerpt;
  var body     = d.body      !== undefined ? String(d.body).slice(0, 200000).trim() : existing.body;
  var cover    = d.cover     !== undefined ? String(d.cover).slice(0, 500).trim()   : existing.cover;
  var published = d.published !== undefined ? (d.published ? 1 : 0)                 : existing.published;
  var serviceKey = d.service_key !== undefined
    ? (String(d.service_key == null ? "" : d.service_key).slice(0, 120).trim() || null)
    : existing.service_key;
  stmtUpdatePost.run(title, excerpt, body, cover, published, serviceKey, req.params.id);
  res.json({ ok: true, post: { id: req.params.id, slug: existing.slug, title, excerpt, body, cover, date: existing.date, published, service_key: serviceKey } });
});

app.delete("/api/admin/posts/:id", requireAdmin, function (req, res) {
  stmtDeletePost.run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- Сторінки послуг ("Про цей масаж") ---------------- */
var SVC_PAGE_FIELDS = [
  "hero_title", "hero_tagline", "hero_description", "hero_photo", "hero_photo_size", "hero_text_align",
  "symptoms_title", "symptoms_items", "symptoms_photo", "symptoms_photo_size", "symptoms_quote",
  "benefits_title", "benefits_items", "steps_title", "steps_items",
  "detail_description", "suitable_items", "abonement_items",
];
var stmtSvcPageGet   = db.prepare("SELECT * FROM service_pages WHERE service_key=?");
var stmtSvcPageAll   = db.prepare("SELECT service_key, hero_title, published, updated_at FROM service_pages ORDER BY updated_at DESC");
var stmtSvcPageKeys  = db.prepare("SELECT service_key FROM service_pages WHERE published=1");
var stmtSvcPageDel   = db.prepare("DELETE FROM service_pages WHERE service_key=?");

/* Публічно: чи є опублікована сторінка для кожної послуги — щоб на
   головній показувати кнопку "Про цей масаж →" лише там, де є що показати. */
app.get("/api/service-pages/keys", function (req, res) {
  res.json({ ok: true, keys: stmtSvcPageKeys.all().map(function (r) { return r.service_key; }) });
});

/* Публічно: повна сторінка для service.html */
app.get("/api/service-pages/:key", function (req, res) {
  var row = stmtSvcPageGet.get(req.params.key);
  if (!row || !row.published) return res.status(404).json({ ok: false });
  res.json({ ok: true, page: row });
});

/* Адмін: список для панелі керування */
app.get("/api/admin/service-pages", requireAdmin, function (req, res) {
  res.json({ ok: true, pages: stmtSvcPageAll.all() });
});

/* Адмін: одна сторінка (для редагування) — 200 з порожніми полями,
   якщо ще не створювали, щоб форма завжди мала що показати. */
app.get("/api/admin/service-pages/:key", requireAdmin, function (req, res) {
  var row = stmtSvcPageGet.get(req.params.key);
  if (row) return res.json({ ok: true, page: row });
  var blank = { service_key: req.params.key, published: 0, updated_at: 0 };
  SVC_PAGE_FIELDS.forEach(function (f) { blank[f] = ""; });
  res.json({ ok: true, page: blank });
});

/* Адмін: створити/оновити (upsert) */
app.put("/api/admin/service-pages/:key", requireAdmin, function (req, res) {
  var key = String(req.params.key || "").slice(0, 120).trim();
  if (!key) return res.status(400).json({ ok: false, error: "key required" });
  var d = req.body || {};
  var vals = {};
  SVC_PAGE_FIELDS.forEach(function (f) {
    var max = f.indexOf("photo") !== -1 ? 500 : (f.indexOf("items") !== -1 || f === "detail_description" ? 4000 : 300);
    vals[f] = String(d[f] == null ? "" : d[f]).slice(0, max).trim();
  });
  var published = d.published ? 1 : 0;
  var now = Date.now();
  var stmt = db.prepare(
    `INSERT INTO service_pages (service_key,${SVC_PAGE_FIELDS.join(",")},published,updated_at)
     VALUES (?,${SVC_PAGE_FIELDS.map(function () { return "?"; }).join(",")},?,?)
     ON CONFLICT(service_key) DO UPDATE SET
       ${SVC_PAGE_FIELDS.map(function (f) { return f + "=excluded." + f; }).join(",\n       ")},
       published=excluded.published, updated_at=excluded.updated_at`
  );
  stmt.run.apply(stmt, [key].concat(SVC_PAGE_FIELDS.map(function (f) { return vals[f]; })).concat([published, now]));
  res.json({ ok: true });
});

app.delete("/api/admin/service-pages/:key", requireAdmin, function (req, res) {
  stmtSvcPageDel.run(req.params.key);
  res.json({ ok: true });
});

/* Фото для блогу — зберігається поруч з SQLite DB на Railway Volume */
var IMG_DIR = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, "data", "oliva.db")), "img", "blog");

app.post("/api/admin/upload-image", requireAdmin, function (req, res) {
  var d = req.body || {};
  var dataUrl = String(d.dataUrl || "");
  var ext = String(d.ext || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
  var match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  if (!match) return res.status(400).json({ ok: false, error: "invalid dataUrl" });
  var buf = Buffer.from(match[1], "base64");
  if (buf.length > 10 * 1024 * 1024) return res.status(413).json({ ok: false, error: "too large" });
  var filename = crypto.randomBytes(12).toString("hex") + "." + ext;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.writeFileSync(path.join(IMG_DIR, filename), buf);
  res.json({ ok: true, url: "/api/blog-img/" + filename });
});

/* ---- Публічний список майстрів (для сайту) ---- */
app.get("/api/masters", function (req, res) {
  var rows = db.prepare(
    "SELECT id, name, level, photo, mono_link FROM masters WHERE active=1 AND show_on_site=1 ORDER BY sort_order, id"
  ).all();
  res.json({ ok: true, masters: rows });
});

/* ---- Завантаження фото майстра (адмін) ---- */
var MASTER_IMG_DIR = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, "data", "oliva.db")), "img", "masters");
app.post("/api/admin/upload-master-photo", requireAdmin, function (req, res) {
  var d = req.body || {};
  var dataUrl = String(d.dataUrl || "");
  var ext = String(d.ext || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
  var match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  if (!match) return res.status(400).json({ ok: false, error: "invalid dataUrl" });
  var buf = Buffer.from(match[1], "base64");
  if (buf.length > 10 * 1024 * 1024) return res.status(413).json({ ok: false, error: "too large" });
  var filename = crypto.randomBytes(12).toString("hex") + "." + ext;
  fs.mkdirSync(MASTER_IMG_DIR, { recursive: true });
  fs.writeFileSync(path.join(MASTER_IMG_DIR, filename), buf);
  res.json({ ok: true, url: "/api/master-img/" + filename });
});
app.get("/api/master-img/:file", function (req, res) {
  var f = path.basename(req.params.file);
  var fp = path.join(MASTER_IMG_DIR, f);
  if (!fs.existsSync(fp)) return res.status(404).end();
  res.sendFile(fp);
});

/* ---- Медіа головного екрану сайту (фото-заставка + відео) ----
   Файли лежать поруч із SQLite на Railway Volume: усе в public/ зникає
   при кожному деплої, а том — ні. Порожнє значення в app_settings
   означає «типовий файл із public/assets», щоб можна було відкотитись. */
var SITE_MEDIA_DIR = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, "data", "oliva.db")), "media", "site");

app.get("/api/site-media/:file", function (req, res) {
  var f = path.basename(req.params.file);
  var fp = path.join(SITE_MEDIA_DIR, f);
  if (!fs.existsSync(fp)) return res.status(404).end();
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(fp);
});

/* Публічно: що саме показувати на головному екрані. */
app.get("/api/hero-media", function (req, res) {
  function get(k) {
    try {
      var r = db.prepare("SELECT value FROM app_settings WHERE key=?").get(k);
      return r && r.value ? r.value : "";
    } catch (e) { return ""; }
  }
  res.json({ ok: true, photo: get("hero_photo_url"), video: get("hero_video_url") });
});

/* ---- Публічний список активних послуг (для сайту) ---- */
app.get("/api/services", function (req, res) {
  var rows = db.prepare(
    "SELECT id, name, duration_min, price, category, description, image_url, featured, in_carousel FROM services WHERE active=1 ORDER BY sort_order, id"
  ).all();
  res.json({ ok: true, services: rows });
});

/* ---- Послуги (адмін) ---- */
function cleanSvc(s, max) { return String(s == null ? "" : s).slice(0, max || 200).trim() || null; }

app.get("/api/admin/services", requireAdmin, function (req, res) {
  var rows = db.prepare("SELECT * FROM services WHERE active=1 ORDER BY sort_order, id").all();
  res.json({ ok: true, services: rows });
});
app.post("/api/admin/services", requireAdmin, function (req, res) {
  var d = req.body || {};
  var name = cleanSvc(d.name, 150);
  var dur = parseInt(d.duration_min, 10);
  if (!name || !(dur > 0)) return res.status(400).json({ ok: false, error: "name+duration required" });
  var info = db.prepare(
    "INSERT INTO services (name,duration_min,price,category,description,image_url,active,sort_order,created_at) VALUES (?,?,?,?,?,?,1,?,?)"
  ).run(name, dur, parseInt(d.price, 10) || 0, cleanSvc(d.category, 100), cleanSvc(d.description, 1000), cleanSvc(d.image_url, 500), parseInt(d.sort_order, 10) || 0, Date.now());
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.put("/api/admin/services/:id", requireAdmin, function (req, res) {
  var id = parseInt(req.params.id, 10);
  var s = db.prepare("SELECT * FROM services WHERE id=?").get(id);
  if (!s) return res.status(404).json({ ok: false });
  var d = req.body || {};
  db.prepare(
    "UPDATE services SET name=?,duration_min=?,price=?,category=?,description=?,image_url=?,sort_order=?,featured=?,in_carousel=? WHERE id=?"
  ).run(
    d.name !== undefined ? (cleanSvc(d.name, 150) || s.name) : s.name,
    d.duration_min !== undefined ? (parseInt(d.duration_min, 10) || s.duration_min) : s.duration_min,
    d.price !== undefined ? (parseInt(d.price, 10) || 0) : s.price,
    d.category !== undefined ? cleanSvc(d.category, 100) : s.category,
    d.description !== undefined ? cleanSvc(d.description, 1000) : s.description,
    d.image_url !== undefined ? cleanSvc(d.image_url, 500) : s.image_url,
    d.sort_order !== undefined ? (parseInt(d.sort_order, 10) || 0) : s.sort_order,
    d.featured !== undefined ? (parseInt(d.featured, 10) ? 1 : 0) : (s.featured || 0),
    d.in_carousel !== undefined ? (parseInt(d.in_carousel, 10) ? 1 : 0) : (s.in_carousel || 0),
    id
  );
  res.json({ ok: true });
});
app.delete("/api/admin/services/:id", requireAdmin, function (req, res) {
  db.prepare("UPDATE services SET active=0 WHERE id=?").run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

/* Роздача фото з persistent volume */
app.get("/api/blog-img/:filename", function (req, res) {
  var filename = path.basename(req.params.filename);
  var filepath = path.join(IMG_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).send("Not found");
  res.sendFile(filepath);
});

/* Маршрути сторінок */
app.get("/blog", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "blog.html"));
});
app.get("/blog/:slug", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "blog-post.html"));
});
app.get("/service/:key", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "service.html"));
});

/* ---------------- Socket.IO ---------------- */
io.on("connection", function (socket) {
  var handshake = socket.handshake.auth || {};

  /* ----- АДМІН ----- */
  if (handshake.role === "admin") {
    var token = parseCookies(socket.handshake.headers.cookie).oliva_admin;
    if (!validToken(token)) { socket.emit("unauthorized"); return socket.disconnect(true); }

    socket.join("admins");
    socket.emit("conversations", summary());

    socket.on("open", function (visitorId) {
      var c = conversations.get(clean(visitorId, 40));
      if (!c) return;
      c.unread = 0;
      socket.emit("history", { id: c.id, name: c.name, messages: c.messages });
      io.to("admins").emit("conversations", summary());
    });

    socket.on("reply", function (data) {
      data = data || {};
      var visitorId = clean(data.visitorId, 40);
      var text = clean(data.text).trim();
      if (!visitorId || !text) return;
      var c = getConv(visitorId);
      var m = { from: "admin", text: text, ts: Date.now() };
      c.messages.push(m); c.lastTs = m.ts;
      io.to("visitor:" + visitorId).emit("message", m);
      io.to("admins").emit("admin:reply", { visitorId: visitorId, message: m });
      io.to("admins").emit("conversations", summary());
    });
    return;
  }

  /* ----- ВІДВІДУВАЧ ----- */
  var visitorId = clean(handshake.visitorId, 40);
  if (!visitorId) visitorId = "v_" + crypto.randomBytes(6).toString("hex");
  socket.join("visitor:" + visitorId);
  var conv = getConv(visitorId);
  socket.emit("ready", { visitorId: visitorId, messages: conv.messages });

  socket.on("message", function (data) {
    data = data || {};
    var text = clean(data.text).trim();
    if (!text) return;
    if (data.name && conv.name === "Гість") conv.name = clean(data.name, 60);
    var m = { from: "visitor", text: text, ts: Date.now() };
    conv.messages.push(m); conv.lastTs = m.ts; conv.unread = (conv.unread || 0) + 1;
    io.to("visitor:" + visitorId).emit("message", m);
    io.to("admins").emit("visitor:msg", { visitorId: visitorId, name: conv.name, message: m });
    io.to("admins").emit("conversations", summary());
    const configuredSiteUrl = String(process.env.SITE_URL || PRIMARY_SITE_URL)
      .replace(LEGACY_SITE_HOST, "massage-oliva.com").replace(/\/+$/, "");
    const adminUrl = `${configuredSiteUrl}/admin`;
    sendTelegram(`💬 <b>Нове повідомлення з сайту</b>\n👤 ${conv.name}\n📝 ${text}\n\n🔗 <a href="${adminUrl}">Відповісти в адмін-панелі</a>`);
  });
});

/* ---------------- Зворотній дзвінок ---------------- */
app.post("/api/callback", async function (req, res) {
  var phone = String((req.body || {}).phone || "").trim().slice(0, 30);
  if (!phone) return res.status(400).json({ ok: false, error: "phone required" });
  await sendTelegram(`📞 <b>Запит на зворотній дзвінок</b>\n☎️ ${phone}\n\nКлієнт залишив номер через форму на сайті.`);
  res.json({ ok: true });
});

/* ---------------- Заявка на масаж в офіс (B2B) ----------------
   Окремо від /api/callback: тут є компанія, кількість людей і формат,
   і власнику зручніше бачити це одним повідомленням, а не передзвонювати
   по голому номеру. Іде тільки власнику, як і решта сповіщень із сайту. */
app.post("/api/office-request", async function (req, res) {
  var d = req.body || {};
  var name    = String(d.name    || "").trim().slice(0, 80);
  var phone   = String(d.phone   || "").trim().slice(0, 30);
  var company = String(d.company || "").trim().slice(0, 100);
  var people  = String(d.people  || "").trim().slice(0, 10);
  var format  = String(d.format  || "").trim().slice(0, 60);
  var comment = String(d.comment || "").trim().slice(0, 500);
  if (!name || !phone) return res.status(400).json({ ok: false, error: "missing fields" });

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  var text =
    "🏢 <b>Заявка: масаж в офіс</b>\n\n" +
    "👤 <b>Контакт:</b> " + esc(name) + "\n" +
    "📞 <b>Телефон:</b> " + esc(phone) + "\n" +
    (company ? "🏛 <b>Компанія:</b> " + esc(company) + "\n" : "") +
    (people  ? "👥 <b>Співробітників:</b> " + esc(people) + "\n" : "") +
    (format  ? "⏱ <b>Формат:</b> " + esc(format) + "\n" : "") +
    (comment ? "\n📝 <b>Коментар:</b> " + esc(comment) : "");
  try {
    await sendTelegram(text);
    res.json({ ok: true });
  } catch (e) {
    console.error("[office-request]", e.message);
    res.status(500).json({ ok: false });
  }
});

/* ---------------- Fallback ---------------- */
app.get("*", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* Реєстрація Telegram-вебхука при старті.
   Раніше це була ручна curl-команда, і поки її не виконали, Telegram
   складав апдейти в чергу й прив'язка майстрів мовчки не працювала.
   Виклик ідемпотентний, тож просто робимо його на кожному старті.
   ЛИШЕ в проді: інакше локальний сервер перевів би вебхук бойового бота
   на localhost, і сповіщення зникли б у всіх. */
async function registerTelegramWebhook() {
  if (!IS_PROD || !TG_TOKEN) return;
  const base = String(process.env.SITE_URL || PRIMARY_SITE_URL).replace(/\/+$/, "");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (!secret) {
    console.warn("[telegram] TELEGRAM_WEBHOOK_SECRET не задано — вебхук реєструється без підпису.");
  }
  const body = {
    url: base + "/api/webhooks/telegram",
    allowed_updates: ["message"],
  };
  if (secret) body.secret_token = secret;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(function () { return {}; });
    if (j && j.ok) console.log("[telegram] вебхук зареєстровано:", body.url);
    else console.error("[telegram] не вдалось зареєструвати вебхук:", JSON.stringify(j));
  } catch (e) {
    console.error("[telegram] setWebhook error:", e.message);
  }
}

server.listen(PORT, function () {
  console.log("Oliva site running on http://localhost:" + PORT);
  console.log("Адмін-чат:  http://localhost:" + PORT + "/admin");
  console.log("Кабінет CRM: http://localhost:" + PORT + "/cabinet");
  console.log("Онлайн-запис: http://localhost:" + PORT + "/booking");
  scheduler.start(); // нагадування Viber/SMS
  registerTelegramWebhook();
});
