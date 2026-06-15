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

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[chat] УВАГА: ADMIN_PASSWORD не задано — використовується типовий "oliva-admin". Задайте у Railway → Variables.');
}
if (!TG_TOKEN || !TG_CHAT_ID) {
  console.warn('[telegram] TELEGRAM_BOT_TOKEN або TELEGRAM_CHAT_ID не задано — сповіщення в Telegram вимкнено.');
}

/* ---------------- Telegram-сповіщення ---------------- */
async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  try {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: text, parse_mode: "HTML" });
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!res.ok) console.error("[telegram] Помилка:", await res.text());
  } catch (e) {
    console.error("[telegram] fetch error:", e.message);
  }
}

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: false, limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));

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
  res.json({ ok: true, role: s.role, masterId: s.masterId });
});

/* ---------------- CRM-роути ----------------
   Монтуються ДО catch-all. Публічні — без авторизації; /api/crm —
   усередині перевіряє requireAuth; вебхук — спільний секрет. */
app.use("/api/public", publicRoutes);
app.use("/api/crm", crmRoutes);
app.use("/api/webhooks", webhookRoutes);

app.get("/cabinet", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "cabinet.html"));
});
app.get("/booking", function (req, res) {
  return res.redirect(301, "https://bookon.ua/s/oliva_massage_studio");
  res.sendFile(path.join(__dirname, "public", "booking.html"));
});

app.get("/admin", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/share", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "share.html"));
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

  var totalPrice = d.totalPrice ? `${d.totalPrice} грн` : `${price} грн`;

  var text = `🎁 <b>Нове замовлення сертифіката!</b>\n\n` +
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
    res.json({ ok: true });
  } catch (e) {
    console.error("[certificate]", e.message);
    res.status(500).json({ ok: false });
  }
});

/* ---------------- API: Анонімний відгук ---------------- */
app.post("/api/review", async function (req, res) {
  var d = req.body || {};
  var rating  = parseInt(d.rating)  || 0;
  var master  = String(d.master  || "").slice(0, 100).trim();
  var text    = String(d.text    || "").slice(0, 1000).trim();
  if (!text || rating < 1 || rating > 5) {
    return res.status(400).json({ ok: false, error: "missing fields" });
  }
  var stars = "⭐".repeat(rating);
  var msg = `✍️ <b>Новий анонімний відгук</b> #відгук\n\n${stars}\n` +
    (master ? `💆 <b>Майстер:</b> ${master}\n` : "") +
    `📝 ${text}`;
  try {
    await sendTelegram(msg);
    res.json({ ok: true });
  } catch (e) {
    console.error("[review]", e.message);
    res.status(500).json({ ok: false });
  }
});

app.get("/review", function (req, res) {
  res.redirect(301, "/share");
});

/* ============================================================
   BLOG
   Файл posts.json зберігається у /data/posts.json
   На Railway: підключи Volume і змонтуй на /app/data
   ============================================================ */
const POSTS_FILE = process.env.POSTS_FILE || path.join(__dirname, "data", "posts.json");

function readPosts() {
  try {
    if (!fs.existsSync(POSTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(POSTS_FILE, "utf8")) || [];
  } catch (e) { return []; }
}
function writePosts(posts) {
  fs.mkdirSync(path.dirname(POSTS_FILE), { recursive: true });
  fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2), "utf8");
}
function slugify(text) {
  return text.toLowerCase()
    .replace(/[іїєґ]/g, function(c){ return {і:'i',ї:'i',є:'e',ґ:'g'}[c]||c; })
    .replace(/[а-яёА-ЯЁ]/g, function(c){ var m='аáбвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'.split('');var t='aabvgdeyezhziyklmnoprstufhcchshschyieya'.split('');var i=m.indexOf(c);return i>=0?t[i]||'':c;})
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* Публічні ендпоінти */
app.get("/api/posts", function (req, res) {
  var posts = readPosts().filter(function(p){ return p.published; });
  res.json(posts.map(function(p){ return { id: p.id, slug: p.slug, title: p.title, excerpt: p.excerpt, cover: p.cover, date: p.date }; }));
});

app.get("/api/posts/:slug", function (req, res) {
  var posts = readPosts();
  var post = posts.find(function(p){ return p.slug === req.params.slug && p.published; });
  if (!post) return res.status(404).json({ ok: false });
  res.json(post);
});

/* Адмін ендпоінти (захищені токеном) */
const requireAdmin = auth.requireAuth();

app.get("/api/admin/posts", requireAdmin, function (req, res) {
  res.json(readPosts());
});

app.post("/api/admin/posts", requireAdmin, function (req, res) {
  var d = req.body || {};
  var title = String(d.title || "").slice(0, 200).trim();
  if (!title) return res.status(400).json({ ok: false, error: "title required" });
  var posts = readPosts();
  var id = crypto.randomBytes(8).toString("hex");
  var baseSlug = slugify(title) || id;
  var slug = baseSlug;
  var n = 1;
  while (posts.find(function(p){ return p.slug === slug; })) { slug = baseSlug + '-' + (n++); }
  var post = {
    id: id, slug: slug,
    title: title,
    excerpt: String(d.excerpt || "").slice(0, 500).trim(),
    body: String(d.body || "").slice(0, 20000).trim(),
    cover: String(d.cover || "").slice(0, 500).trim(),
    date: new Date().toISOString().slice(0, 10),
    published: !!d.published
  };
  posts.unshift(post);
  writePosts(posts);
  res.json({ ok: true, post: post });
});

app.put("/api/admin/posts/:id", requireAdmin, function (req, res) {
  var d = req.body || {};
  var posts = readPosts();
  var idx = posts.findIndex(function(p){ return p.id === req.params.id; });
  if (idx < 0) return res.status(404).json({ ok: false });
  var p = posts[idx];
  if (d.title !== undefined) p.title = String(d.title).slice(0, 200).trim();
  if (d.excerpt !== undefined) p.excerpt = String(d.excerpt).slice(0, 500).trim();
  if (d.body !== undefined) p.body = String(d.body).slice(0, 20000).trim();
  if (d.cover !== undefined) p.cover = String(d.cover).slice(0, 500).trim();
  if (d.published !== undefined) p.published = !!d.published;
  writePosts(posts);
  res.json({ ok: true, post: p });
});

app.delete("/api/admin/posts/:id", requireAdmin, function (req, res) {
  var posts = readPosts();
  var newPosts = posts.filter(function(p){ return p.id !== req.params.id; });
  writePosts(newPosts);
  res.json({ ok: true });
});

/* Завантаження фото — зберігається поруч з posts.json у persistent volume */
var IMG_DIR = path.join(path.dirname(POSTS_FILE), "img", "blog");

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
    "UPDATE services SET name=?,duration_min=?,price=?,category=?,description=?,image_url=?,sort_order=? WHERE id=?"
  ).run(
    d.name !== undefined ? (cleanSvc(d.name, 150) || s.name) : s.name,
    d.duration_min !== undefined ? (parseInt(d.duration_min, 10) || s.duration_min) : s.duration_min,
    d.price !== undefined ? (parseInt(d.price, 10) || 0) : s.price,
    d.category !== undefined ? cleanSvc(d.category, 100) : s.category,
    d.description !== undefined ? cleanSvc(d.description, 1000) : s.description,
    d.image_url !== undefined ? cleanSvc(d.image_url, 500) : s.image_url,
    d.sort_order !== undefined ? (parseInt(d.sort_order, 10) || 0) : s.sort_order,
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
    const adminUrl = process.env.SITE_URL ? `${process.env.SITE_URL}/admin` : "https://site-oliva-production.up.railway.app/admin";
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

/* ---------------- Fallback ---------------- */
app.get("*", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, function () {
  console.log("Oliva site running on http://localhost:" + PORT);
  console.log("Адмін-чат:  http://localhost:" + PORT + "/admin");
  console.log("Кабінет CRM: http://localhost:" + PORT + "/cabinet");
  console.log("Онлайн-запис: http://localhost:" + PORT + "/booking");
  scheduler.start(); // нагадування Viber/SMS
});
