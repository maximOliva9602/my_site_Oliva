/* ============================================================
   crm/auth.js — авторизація CRM.
   Власник: bootstrap-логін через ADMIN_PASSWORD (env) АБО рядок
   users з role='owner'. Майстри: рядки users з role='worker' і
   master_id. Хеш паролів — scrypt (стандартний crypto, без нових
   залежностей). Спільне сховище сесій (cookie oliva_admin) для
   CRM, блогу й чату.
   ============================================================ */

const crypto = require("crypto");
const db = require("./db");

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 год
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "oliva-admin";

// token -> { createdAt, userId, role, masterId }
const sessions = new Map();

/* ---------------- Паролі (scrypt) ---------------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return "scrypt$" + salt + "$" + hash;
}
function verifyPassword(password, stored) {
  try {
    const parts = String(stored || "").split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const salt = parts[1];
    const expected = Buffer.from(parts[2], "hex");
    const actual = crypto.scryptSync(String(password), salt, 64);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (e) { return false; }
}

/* ---------------- Сесії ---------------- */
function newToken() { return crypto.randomBytes(24).toString("hex"); }

function createSession(data) {
  const token = newToken();
  sessions.set(token, {
    createdAt: Date.now(),
    userId: data.userId || null,
    role: data.role || "worker",
    masterId: data.masterId == null ? null : data.masterId,
  });
  return token;
}
function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) { sessions.delete(token); return null; }
  return s;
}
function destroySession(token) { if (token) sessions.delete(token); }

/* Зворотна сумісність із чатом/блогом: будь-яка валідна сесія = адмін. */
function validToken(token) { return !!getSession(token); }

/* ---------------- Логін ---------------- */
/* Повертає { ok, role, masterId } або { ok:false }.
   - {username,password} -> перевірка по таблиці users
   - {password} без username -> bootstrap-власник через ADMIN_PASSWORD */
function login(body) {
  const username = String((body && body.username) || "").trim();
  const password = String((body && body.password) || "");

  if (username) {
    const u = db.prepare("SELECT * FROM users WHERE username = ? AND active = 1").get(username);
    if (!u || !verifyPassword(password, u.password_hash)) return { ok: false };
    const token = createSession({ userId: u.id, role: u.role, masterId: u.master_id });
    return { ok: true, token, role: u.role, masterId: u.master_id };
  }

  // bootstrap-власник
  if (password && password === ADMIN_PASSWORD) {
    const token = createSession({ userId: null, role: "owner", masterId: null });
    return { ok: true, token, role: "owner", masterId: null };
  }
  return { ok: false };
}

/* ---------------- Middleware ---------------- */
function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach(function (p) {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function sessionFromReq(req) {
  const token = parseCookies(req.headers.cookie).oliva_admin;
  return getSession(token);
}
/* requireAuth() -> будь-яка сесія; requireAuth('owner') -> лише власник. */
function requireAuth(role) {
  return function (req, res, next) {
    const s = sessionFromReq(req);
    if (!s) return res.status(401).json({ ok: false, error: "unauthorized" });
    if (role && s.role !== role) return res.status(403).json({ ok: false, error: "forbidden" });
    req.session = s;
    next();
  };
}

/* ---------------- Користувачі (CRUD для власника) ---------------- */
function listUsers() {
  return db.prepare(
    "SELECT id, username, role, master_id, active, created_at FROM users ORDER BY id"
  ).all();
}
function createUser(d) {
  const username = String(d.username || "").trim();
  const password = String(d.password || "");
  const role = d.role === "owner" ? "owner" : "worker";
  const masterId = d.masterId == null ? null : Number(d.masterId);
  if (!username || password.length < 4) return { ok: false, error: "bad input" };
  try {
    const info = db.prepare(
      "INSERT INTO users (username, password_hash, role, master_id, active, created_at) VALUES (?,?,?,?,1,?)"
    ).run(username, hashPassword(password), role, masterId, Date.now());
    return { ok: true, id: info.lastInsertRowid };
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return { ok: false, error: "username taken" };
    return { ok: false, error: "db error" };
  }
}
function updateUser(id, d) {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!u) return { ok: false, error: "not found" };
  const username = d.username !== undefined ? String(d.username).trim() : u.username;
  const role = d.role !== undefined ? (d.role === "owner" ? "owner" : "worker") : u.role;
  const masterId = d.masterId !== undefined ? (d.masterId == null ? null : Number(d.masterId)) : u.master_id;
  const active = d.active !== undefined ? (d.active ? 1 : 0) : u.active;
  try {
    db.prepare("UPDATE users SET username=?, role=?, master_id=?, active=? WHERE id=?")
      .run(username, role, masterId, active, id);
    if (d.password) {
      db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(d.password), id);
    }
    return { ok: true };
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return { ok: false, error: "username taken" };
    return { ok: false, error: "db error" };
  }
}
function deleteUser(id) {
  db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(id);
  return { ok: true };
}

module.exports = {
  SESSION_TTL, ADMIN_PASSWORD,
  hashPassword, verifyPassword,
  createSession, getSession, destroySession, validToken,
  login, parseCookies, sessionFromReq, requireAuth,
  listUsers, createUser, updateUser, deleteUser,
};
