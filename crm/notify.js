/* ============================================================
   crm/notify.js — сповіщення клієнтам.
   Драйвер обирається через NOTIFY_DRIVER (console|telegram|turbosms).
   Текст рендериться при постановці в чергу (знімок). Відправка й
   запис статусу — драйвер-агностичні.
   ============================================================ */

const db = require("./db");
const tz = require("./tz");

const DRIVER_NAME = process.env.NOTIFY_DRIVER || "console";
const STUDIO_ADDRESS = process.env.STUDIO_ADDRESS || "м. Київ, вул. Борщагівська, 145";

let driver;
try {
  driver = require("./drivers/" + DRIVER_NAME);
} catch (e) {
  console.warn(`[notify] невідомий NOTIFY_DRIVER="${DRIVER_NAME}", використовую console.`);
  driver = require("./drivers/console");
}
console.log(`[notify] драйвер: ${driver.name}`);

/* Дані запису для шаблону (join з клієнтом, послугою, майстром). */
function apptView(appointmentId) {
  return db.prepare(
    `SELECT a.*, c.name AS client_name, c.phone AS client_phone,
            s.name AS service_name, m.name AS master_name
       FROM appointments a
       JOIN clients c  ON c.id = a.client_id
       JOIN services s ON s.id = a.service_id
       JOIN masters m  ON m.id = a.master_id
      WHERE a.id = ?`
  ).get(appointmentId);
}

function ddmm(date) { const p = date.split("-"); return p[2] + "." + p[1]; }

function renderTemplate(kind, v) {
  const when = `Дата: ${ddmm(v.date)}\nЧас: ${tz.fmtMin(v.start_min)}`;
  if (kind === "confirmation") {
    return `Ваш запис у масажну студію Oliva прийнято ✅\n` +
      `Послуга: ${v.service_name}\nМайстер: ${v.master_name}\n${when}\n` +
      `Адреса: ${STUDIO_ADDRESS}\nЯкщо плани зміняться — зателефонуйте нам.`;
  }
  // reminder_24h / reminder_2h
  return `Нагадуємо про ваш запис у масажну студію.\n` +
    `Послуга: ${v.service_name}\nМайстер: ${v.master_name}\n${when}\n` +
    `Адреса: ${STUDIO_ADDRESS}`;
}

/* Ставить сповіщення в чергу (status='queued'). Ідемпотентно завдяки
   UNIQUE(appointment_id, kind) — повторний виклик не дублює. */
function queueNotification(appointmentId, kind) {
  const v = apptView(appointmentId);
  if (!v || !v.client_phone) return { ok: false, error: "no appt/phone" };
  const text = renderTemplate(kind, v);
  try {
    const info = db.prepare(
      `INSERT INTO notifications (appointment_id, kind, phone, text, provider, status, created_at)
       VALUES (?,?,?,?,?, 'queued', ?)`
    ).run(appointmentId, kind, v.client_phone, text, driver.name, Date.now());
    return { ok: true, id: info.lastInsertRowid };
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return { ok: true, duplicate: true };
    return { ok: false, error: e.message };
  }
}

/* Надсилає всі queued (і повторює недавні failed). */
async function flushQueued() {
  const rows = db.prepare(
    "SELECT * FROM notifications WHERE status IN ('queued','failed') ORDER BY id LIMIT 50"
  ).all();
  for (const n of rows) {
    try {
      const r = await driver.sendMessage({ phone: n.phone, text: n.text });
      db.prepare(
        "UPDATE notifications SET status='sent', provider=?, provider_msg_id=?, final_channel=?, sent_at=? WHERE id=?"
      ).run(driver.name, r.providerMsgId, r.channel || null, Date.now(), n.id);
    } catch (e) {
      console.error(`[notify] помилка відправки #${n.id}:`, e.message);
      db.prepare("UPDATE notifications SET status='failed' WHERE id=?").run(n.id);
    }
  }
  return rows.length;
}

/* Записати статус від вебхука/опитування за provider_msg_id. */
function recordStatus(providerMsgId, status, channel) {
  if (!providerMsgId) return false;
  const allowed = ["sent", "delivered", "undelivered", "failed"];
  if (allowed.indexOf(status) === -1) return false;
  const info = db.prepare(
    "UPDATE notifications SET status=?, final_channel=COALESCE(?, final_channel), status_at=? WHERE provider_msg_id=?"
  ).run(status, channel || null, Date.now(), String(providerMsgId));
  return info.changes > 0;
}

/* Опитати фінальний статус для відправлених без статусу (фолбек до вебхука). */
async function pollStatuses() {
  if (typeof driver.pollStatus !== "function") return 0;
  const rows = db.prepare(
    "SELECT provider_msg_id FROM notifications WHERE status='sent' AND status_at IS NULL AND provider_msg_id IS NOT NULL LIMIT 100"
  ).all();
  if (!rows.length) return 0;
  const ids = rows.map(function (r) { return r.provider_msg_id; });
  try {
    const results = await driver.pollStatus(ids);
    for (const r of results) recordStatus(r.providerMsgId, r.status, r.channel);
    return results.length;
  } catch (e) {
    console.error("[notify] poll error:", e.message);
    return 0;
  }
}

/* Прямо надіслати довільний текст на телефон (для майстра, без черги). */
async function sendDirect(phone, text) {
  if (typeof driver.sendMessage !== "function") return;
  await driver.sendMessage({ phone, text });
}

module.exports = {
  driver, DRIVER_NAME, STUDIO_ADDRESS,
  apptView, renderTemplate, queueNotification,
  flushQueued, recordStatus, pollStatuses, sendDirect,
};
