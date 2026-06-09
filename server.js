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
const express = require("express");
const { Server } = require("socket.io");

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

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- In-memory сховище ---------------- */
// conversations: visitorId -> { id, name, messages:[{from,text,ts}], lastTs, unread }
const conversations = new Map();
// adminSessions: token -> createdAt
const adminSessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 год
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
function validToken(token) {
  if (!token || !adminSessions.has(token)) return false;
  if (Date.now() - adminSessions.get(token) > SESSION_TTL) { adminSessions.delete(token); return false; }
  return true;
}

/* ---------------- Авторизація адміна ---------------- */
app.post("/api/admin/login", function (req, res) {
  var password = (req.body || {}).password;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ ok: false });
  var token = crypto.randomBytes(24).toString("hex");
  adminSessions.set(token, Date.now());
  res.cookie("oliva_admin", token, {
    httpOnly: true, sameSite: "lax", secure: IS_PROD, maxAge: SESSION_TTL, path: "/"
  });
  res.json({ ok: true });
});
app.post("/api/admin/logout", function (req, res) {
  var token = parseCookies(req.headers.cookie).oliva_admin;
  if (token) adminSessions.delete(token);
  res.clearCookie("oliva_admin", { path: "/" });
  res.json({ ok: true });
});
app.get("/api/admin/me", function (req, res) {
  var token = parseCookies(req.headers.cookie).oliva_admin;
  res.json({ ok: validToken(token) });
});

app.get("/admin", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

/* ---------------- Socket.IO ---------------- */
io.on("connection", function (socket) {
  var auth = socket.handshake.auth || {};

  /* ----- АДМІН ----- */
  if (auth.role === "admin") {
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
  var visitorId = clean(auth.visitorId, 40);
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
    sendTelegram(`💬 <b>Нове повідомлення з сайту</b>\n👤 ${conv.name}\n📝 ${text}`);
  });
});

/* ---------------- Fallback ---------------- */
app.get("*", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, function () {
  console.log("Oliva site running on http://localhost:" + PORT);
  console.log("Адмін-чат: http://localhost:" + PORT + "/admin");
});
