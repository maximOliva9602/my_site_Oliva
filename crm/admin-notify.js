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
      SELECT a.date, a.start_min, a.duration_min, a.comment, a.extra_services, a.master_id,
             c.name client_name, c.phone client_phone,
             s.name service_name,
             m.name master_name, b.name branch_name
      FROM appointments a
      JOIN clients  c ON c.id = a.client_id
      JOIN services s ON s.id = a.service_id
      JOIN masters  m ON m.id = a.master_id
      LEFT JOIN branches b ON b.id = COALESCE(a.branch_id, m.branch_id)
      WHERE a.id = ?
    `).get(appointmentId);
    if (!a) return;

    // Додаткові послуги (add-on'и) — показати переліком, якщо є
    let extrasLine = "";
    try {
      const ex = a.extra_services ? JSON.parse(a.extra_services) : null;
      if (Array.isArray(ex) && ex.length) {
        extrasLine = `\n➕ <b>Додатково:</b>\n` + ex.map(function (e) {
          const uah = Math.round((parseInt(e.price, 10) || 0) / 100);
          return `• ${e.name}` + (uah ? ` (+${uah} грн)` : "");
        }).join("\n");
      }
    } catch (_) {}

    // Філія — лише коли власник увімкнув крок вибору філії в онлайн-записі
    // (той самий перемикач, що й на сайті) і майстер до неї прив'язаний.
    let branchLine = "";
    try {
      const setting = db.prepare("SELECT value FROM app_settings WHERE key='booking_branch_step'").get();
      if (setting && setting.value === "1" && a.branch_name) {
        branchLine = `\n🏢 <b>Філія:</b> ${a.branch_name}`;
      }
    } catch (_) {}

    const who   = source === "site" ? "🌐 Сайт" : "📋 CRM";
    const text  =
      `📅 <b>Новий запис!</b> ${who}\n\n` +
      `👤 <b>Клієнт:</b> ${a.client_name}\n` +
      `📞 <b>Телефон:</b> ${a.client_phone}\n` +
      `💆 <b>Послуга:</b> ${a.service_name}\n` +
      `👩‍🔧 <b>Майстер:</b> ${a.master_name}` +
      branchLine + `\n` +
      `📆 <b>Дата:</b> ${ddmm(a.date)}, ${fmtMin(a.start_min)}–${fmtMin(a.start_min + a.duration_min)}` +
      extrasLine +
      (a.comment ? `\n💬 <b>Коментар:</b> ${a.comment}` : "");

    await sendTg(text);
    // push без HTML тегів + пряме посилання на картку запису; лише
    // власнику (бачить усе) і тому самому майстру, чий це запис —
    // інші майстри більше не отримують чужі сповіщення.
    sendPushToAll(
      text.replace(/<[^>]+>/g, ""),
      `/cabinet?appointment=${appointmentId}`,
      `new-appt-${appointmentId}`,
      a.master_id
    );
  } catch (e) {
    console.error("[admin-notify] notifyNewAppt error:", e.message);
  }
}

/* ---- Web Push ---- */
let webpush;
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || "mailto:admin@massage-oliva.com")
  .replace("massage-solomyanskyi.com.ua", "massage-oliva.com");

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush = require("web-push");
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    console.log("[admin-notify] web-push initialized");
  } catch (e) {
    console.warn("[admin-notify] web-push not available:", e.message);
  }
}

/* Повертає статистику доставки {total, sent, removed, failed}, щоб
   "Надіслати тест" у CRM показував реальну картину, а не просто
   кількість рядків у push_subscriptions (частина з яких може бути
   давно мертвою — стара сесія, вимкнені сповіщення на телефоні тощо). */
async function sendPushToAll(body, url, tag, masterId) {
  const stats = { total: 0, sent: 0, removed: 0, failed: 0 };
  if (!webpush) return stats;
  let subs;
  try {
    if (masterId) {
      // Власник (у т.ч. bootstrap-логін без users.id — user_id тоді NULL)
      // бачить усе; майстер — лише сповіщення про СВІЙ запис.
      subs = db.prepare(
        `SELECT ps.* FROM push_subscriptions ps
           LEFT JOIN users u ON u.id = ps.user_id
          WHERE ps.user_id IS NULL OR u.role = 'owner' OR u.master_id = ?`
      ).all(masterId);
    } else {
      subs = db.prepare("SELECT * FROM push_subscriptions").all();
    }
  } catch (e) { return stats; }
  stats.total = subs.length;

  const payload = JSON.stringify({
    title: "Oliva CRM",
    body,
    icon: "/assets/img/logo.png",
    badge: "/assets/img/logo.png",
    tag: tag || "oliva-notif",
    url: url || "/cabinet",
  });

  for (const sub of subs) {
    try {
      const subscription = JSON.parse(sub.subscription_json);
      await webpush.sendNotification(subscription, payload);
      stats.sent++;
    } catch (e) {
      // 410 Gone — підписка прострочена, видаляємо
      if (e.statusCode === 410 || e.statusCode === 404) {
        try { db.prepare("DELETE FROM push_subscriptions WHERE id=?").run(sub.id); } catch (_) {}
        stats.removed++;
      } else {
        console.error("[admin-notify] push error:", e.statusCode, e.message);
        stats.failed++;
      }
    }
  }
  return stats;
}

module.exports = { notifyNewAppt, sendPushToAll, VAPID_PUBLIC };
