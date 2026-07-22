#!/usr/bin/env node
// Імпорт клієнтів з Bookon CSV → Oliva CRM
// Запуск: node scripts/import-bookon-clients.js
// Потребує: RAILWAY_URL у .env або env-змінній

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// ── Конфігурація ──────────────────────────────────────────────────────────────
const CSV_PATH = path.resolve(__dirname, "../Bookon MyClients Export Jul 22 2026.Csv") ||
  process.argv[2] || "/Users/roman/Downloads/Bookon MyClients Export Jul 22 2026.Csv";

// URL проду на Railway
const API_BASE = process.env.CRM_URL || "https://massage-solomyanskyi.com.ua";
const ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_PASS) { console.error("Вкажи пароль: ADMIN_PASS=... node scripts/import-bookon-clients.js"); process.exit(1); }

// ── Утиліти ───────────────────────────────────────────────────────────────────
function normalizePhone(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/[\s\-()]/g, "");
  // Явно фейкові
  if (/^0{7,}/.test(s) || /^8{6,}/.test(s) || /^3{7,}/.test(s) || s.length < 9) return null;
  // Вже міжнародний з +
  if (s.startsWith("+380")) return s.slice(0, 13);
  // 380XXXXXXXXX (12 цифр)
  if (s.startsWith("380") && s.length === 12) return "+" + s;
  // 0XXXXXXXXX (10 цифр)
  if (s.startsWith("0") && s.length === 10) return "+38" + s;
  // Іноземні або нестандартні — зберегти як є якщо довгі
  if (s.length >= 10) return "+" + s;
  return null;
}

function parseDate(str) {
  // "DD.MM.YYYY" → timestamp ms
  if (!str || str === "-") return null;
  const parts = str.split(".");
  if (parts.length !== 3) return null;
  const d = parseInt(parts[0], 10), m = parseInt(parts[1], 10), y = parseInt(parts[2], 10);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d).getTime();
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0];
  const cols = header.split(",").map(c => c.replace(/^"|"$/g, "").trim());
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = [];
    let cur = "", inQ = false;
    for (let j = 0; j < lines[i].length; j++) {
      const ch = lines[i][j];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { parts.push(cur); cur = ""; }
      else cur += ch;
    }
    parts.push(cur);
    const rec = {};
    cols.forEach((c, idx) => { rec[c] = (parts[idx] || "").replace(/^"|"$/g, "").trim(); });
    records.push(rec);
  }
  return records;
}

// ── Парсинг CSV ───────────────────────────────────────────────────────────────
const csvText = fs.existsSync(CSV_PATH)
  ? fs.readFileSync(CSV_PATH, "utf8")
  : fs.readFileSync("/Users/roman/Downloads/Bookon MyClients Export Jul 22 2026.Csv", "utf8");

const raw = parseCSV(csvText);
console.log(`Зчитано ${raw.length} рядків з CSV`);

const clients = [];
const skipped = [];

raw.forEach(r => {
  const name = r["Ім'я"] || r["Имя"] || "";
  const phone = normalizePhone(r["Телефон"]);
  if (!name.trim()) { skipped.push({ reason: "no name", row: r }); return; }
  if (!phone) { skipped.push({ reason: "invalid phone: " + r["Телефон"], name }); return; }

  const lastVisit = parseDate(r["Дата останнього візиту"]);
  const firstVisit = parseDate(r["Дата першого візиту"]);
  const visitCount = parseInt(r["Кількість візитів"], 10) || 0;
  const group = r["Група"] || "";

  clients.push({
    phone,
    name: name.trim(),
    note: group && group !== "Без визначення" ? "Bookon: " + group : null,
    visit_count: visitCount,
    last_visit_at: lastVisit,
    created_at: firstVisit || Date.now(),
  });
});

console.log(`Підготовлено до імпорту: ${clients.length} клієнтів`);
console.log(`Пропущено: ${skipped.length} (${skipped.filter(s => s.reason.startsWith("invalid")).length} з некоректним телефоном, ${skipped.filter(s => s.reason === "no name").length} без імені)`);
if (skipped.filter(s => s.reason.startsWith("invalid")).slice(0, 5).length) {
  console.log("Приклади пропущених телефонів:");
  skipped.filter(s => s.reason.startsWith("invalid")).slice(0, 5).forEach(s => console.log("  ", s.name, "→", s.reason));
}

// ── HTTP запит ────────────────────────────────────────────────────────────────
function postJSON(urlStr, body, cookieStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === "https:" ? https : http;
    const data = JSON.stringify(body);
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        ...(cookieStr ? { Cookie: cookieStr } : {}),
      },
    };
    const req = lib.request(opts, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        const setCookie = res.headers["set-cookie"];
        try { resolve({ status: res.statusCode, body: JSON.parse(buf), setCookie }); }
        catch { resolve({ status: res.statusCode, body: buf, setCookie }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  // Логін
  console.log("\nВхід в систему...");
  const loginRes = await postJSON(`${API_BASE}/api/admin/login`, { password: ADMIN_PASS });
  if (!loginRes.body || !loginRes.body.ok) {
    console.error("Помилка входу:", loginRes.body);
    process.exit(1);
  }
  const cookie = (loginRes.setCookie || []).map(c => c.split(";")[0]).join("; ");
  console.log("Успішний вхід. Cookie отримано.");

  // Імпорт пачками по 100
  const BATCH = 100;
  let totalInserted = 0;
  for (let i = 0; i < clients.length; i += BATCH) {
    const batch = clients.slice(i, i + BATCH);
    const res = await postJSON(`${API_BASE}/api/crm/clients/import`, batch, cookie);
    if (res.body && res.body.ok) {
      totalInserted += res.body.inserted;
      process.stdout.write(`\rВставлено ${totalInserted} / відправлено ${i + batch.length}...`);
    } else {
      console.error("\nПомилка батчу", i, ":", res.body);
    }
  }
  console.log(`\n\nГотово! Вставлено нових клієнтів: ${totalInserted} з ${clients.length} підготовлених.`);
}

main().catch(err => { console.error("Помилка:", err); process.exit(1); });
