/* ============================================================
   crm/admin-notify.js — сповіщення адміністратора (Telegram)
   при нових записах через CRM.
   ============================================================ */

const db = require("./db");
const tz = require("./tz");

const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN  || "";
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID    || "";

/* chatId не задано — шлемо власнику (TELEGRAM_CHAT_ID), як і раніше.
   Повертає true/false, щоб викликач міг зреагувати на блокування бота. */
async function sendTg(text, chatId) {
  const to = chatId || TG_CHAT_ID;
  if (!TG_TOKEN || !to) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: to, text, parse_mode: "HTML" }),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      console.error("[admin-notify] TG error:", body);
      /* 403 — майстер заблокував бота або видалив чат. Гасимо прив'язку,
         щоб у CRM було видно «не підключено», а не мовчазна тиша. */
      if (res.status === 403 && chatId) {
        try {
          db.prepare("UPDATE masters SET tg_chat_id=NULL, tg_linked_at=NULL WHERE tg_chat_id=?").run(String(chatId));
          console.warn("[admin-notify] TG: прив'язку знято, бота заблоковано, chat", chatId);
        } catch (_) {}
      }
      return false;
    }
    return true;
  } catch (e) {
    console.error("[admin-notify] TG fetch error:", e.message);
    return false;
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
             m.name master_name, m.tg_chat_id master_tg, m.can_see_phones master_can_see_phones,
             b.name branch_name
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
    /* Один шаблон на двох адресатів. Різниця лише в телефоні клієнта:
       майстру без can_see_phones його не показуємо — інакше Telegram став
       би обходом обмеження, яке вже діє в CRM (див. phone-privacy.js). */
    const build = (showPhone, forMaster) =>
      `📅 <b>Новий запис!</b> ${who}\n\n` +
      `👤 <b>Клієнт:</b> ${a.client_name}\n` +
      (showPhone
        ? `📞 <b>Телефон:</b> ${a.client_phone}\n`
        : `📞 <b>Телефон:</b> прихований\n`) +
      `💆 <b>Послуга:</b> ${a.service_name}\n` +
      (forMaster ? "" : `👩‍🔧 <b>Майстер:</b> ${a.master_name}`) +
      branchLine + `\n` +
      `📆 <b>Дата:</b> ${ddmm(a.date)}, ${fmtMin(a.start_min)}–${fmtMin(a.start_min + a.duration_min)}` +
      extrasLine +
      (a.comment ? `\n💬 <b>Коментар:</b> ${a.comment}` : "");

    const text = build(true, false);

    await sendTg(text);
    /* Майстру — в його власний чат із тим самим ботом (окремий діалог,
       чужих записів він там не побачить). Мовчки пропускаємо, якщо
       Telegram не підключено — у нього лишається web-push. */
    if (a.master_tg) {
      await sendTg(build(!!a.master_can_see_phones, true), a.master_tg);
    }
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
      /* Власник бачить усе; майстер — ЛИШЕ свій запис. Орієнтуємось на
         явні role/master_id підписки, а не на user_id: раніше умова
         `user_id IS NULL` вважала власником будь-який пристрій, де колись
         логінився власник, і майстер на такому телефоні отримував push
         про чужі записи. */
      subs = db.prepare(
        `SELECT ps.* FROM push_subscriptions ps
          WHERE ps.role = 'owner'
             OR (ps.master_id IS NOT NULL AND ps.master_id = ?)`
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

module.exports = { notifyNewAppt, sendPushToAll, sendTg, VAPID_PUBLIC };
