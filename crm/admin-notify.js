/* ============================================================
   crm/admin-notify.js — сповіщення адміністратора (Telegram)
   при нових записах через CRM.
   ============================================================ */

const db = require("./db");
const tz = require("./tz");

const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN  || "";
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID    || "";

async function sendTg(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: "HTML" }),
      }
    );
    if (!res.ok) console.error("[admin-notify] TG error:", await res.text());
  } catch (e) {
    console.error("[admin-notify] TG fetch error:", e.message);
  }
}

function fmtMin(m) {
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}
function ddmm(d) { const p = d.split("-"); return p[2] + "." + p[1]; }

/* Викликається після успішного створення запису в CRM (через адмін-панель). */
async function notifyNewAppt(appointmentId, source) {
  try {
    const a = db.prepare(`
      SELECT a.date, a.start_min, a.duration_min, a.comment,
             c.name client_name, c.phone client_phone,
             s.name service_name,
             m.name master_name
      FROM appointments a
      JOIN clients  c ON c.id = a.client_id
      JOIN services s ON s.id = a.service_id
      JOIN masters  m ON m.id = a.master_id
      WHERE a.id = ?
    `).get(appointmentId);
    if (!a) return;

    const who   = source === "site" ? "🌐 Сайт" : "📋 CRM";
    const text  =
      `📅 <b>Новий запис!</b> ${who}\n\n` +
      `👤 <b>Клієнт:</b> ${a.client_name}\n` +
      `📞 <b>Телефон:</b> ${a.client_phone}\n` +
      `💆 <b>Послуга:</b> ${a.service_name}\n` +
      `👩‍🔧 <b>Майстер:</b> ${a.master_name}\n` +
      `📆 <b>Дата:</b> ${ddmm(a.date)}, ${fmtMin(a.start_min)}–${fmtMin(a.start_min + a.duration_min)}` +
      (a.comment ? `\n💬 <b>Коментар:</b> ${a.comment}` : "");

    await sendTg(text);
    sendPushToAll(text.replace(/<[^>]+>/g, ""));   // push без HTML тегів
  } catch (e) {
    console.error("[admin-notify] notifyNewAppt error:", e.message);
  }
}

/* ---- Web Push ---- */
let webpush;
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT     || "mailto:admin@massage-solomyanskyi.com.ua";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush = require("web-push");
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    console.log("[admin-notify] web-push initialized");
  } catch (e) {
    console.warn("[admin-notify] web-push not available:", e.message);
  }
}

async function sendPushToAll(body) {
  if (!webpush) return;
  let subs;
  try {
    subs = db.prepare("SELECT * FROM push_subscriptions").all();
  } catch (e) { return; }

  const payload = JSON.stringify({
    title: "Oliva CRM",
    body,
    icon: "/assets/img/logo.png",
    badge: "/assets/img/logo.png",
    tag: "new-appt",
  });

  for (const sub of subs) {
    try {
      const subscription = JSON.parse(sub.subscription_json);
      await webpush.sendNotification(subscription, payload);
    } catch (e) {
      // 410 Gone — підписка прострочена, видаляємо
      if (e.statusCode === 410 || e.statusCode === 404) {
        try { db.prepare("DELETE FROM push_subscriptions WHERE id=?").run(sub.id); } catch (_) {}
      } else {
        console.error("[admin-notify] push error:", e.message);
      }
    }
  }
}

module.exports = { notifyNewAppt, sendPushToAll, VAPID_PUBLIC };
