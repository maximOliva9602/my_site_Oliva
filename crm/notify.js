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
/* Телефон у SMS — завжди компактно (+380XXXXXXXXX, без дужок/пробілів):
   кожен зайвий символ наближає текст до межі 70 символів (2-га частина =
   подвійна ціна). Тому стискаємо незалежно від того, як записано в env. */
const STUDIO_PHONE = (process.env.STUDIO_PHONE || "+380974340112").replace(/[^\d+]/g, "");

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
            c.no_reminders AS client_no_reminders,
            s.name AS service_name, m.name AS master_name
       FROM appointments a
       JOIN clients c  ON c.id = a.client_id
       JOIN services s ON s.id = a.service_id
       JOIN masters m  ON m.id = a.master_id
      WHERE a.id = ?`
  ).get(appointmentId);
}

function ddmm(date) { const p = date.split("-"); return p[2] + "." + p[1]; }
function ddmmyyyy(date) { const p = date.split("-"); return p[2] + "." + p[1] + "." + p[0]; }

function renderTemplate(kind, v) {
  if (kind === "confirmation") {
    /* Коротко і в 1 SMS-частину (кирилиця: ліміт 70 символів — цей текст
       рівно вкладається). Надсилається ПІСЛЯ підтвердження майстром у CRM. */
    return `Ваш запис ${ddmmyyyy(v.date)} о ${tz.fmtMin(v.start_min)} підтверджений. До зустрічі!\n${STUDIO_PHONE}`;
  }
  if (kind === "reschedule") {
    /* Перенесення візиту (66 символів = 1 SMS-частина). */
    return `Ваш візит перенесено на ${ddmmyyyy(v.date)} о ${tz.fmtMin(v.start_min)}. Чекаємо!\n${STUDIO_PHONE}`;
  }
  if (kind === "cancellation") {
    /* Скасування візиту (51 символ = 1 SMS-частина). */
    return `Відміна запису. А ми так чекали вас :( До зустрічі!`;
  }
  if (kind === "review_request") {
    /* Окремого шаблону поки немає (і публічної сторінки відгуку теж).
       Раніше цей kind провалювався в гілку нагадування і слав клієнту
       ХИБНИЙ текст після кожного завершеного візиту (зайві витрати).
       null = не ставити в чергу взагалі. */
    return null;
  }
  // reminder_24h / reminder_2h
  return `Нагадування від Oliva 💆\n` +
    `Майстер: ${v.master_name}\n` +
    `Дата: ${ddmm(v.date)}\nЧас: ${tz.fmtMin(v.start_min)}\n` +
    `Адреса: ${STUDIO_ADDRESS}\n` +
    `Питання? ${STUDIO_PHONE}`;
}

/* Ставить сповіщення в чергу (status='queued'). Ідемпотентно завдяки
   UNIQUE(appointment_id, kind) — повторний виклик не дублює. */
function queueNotification(appointmentId, kind) {
  const v = apptView(appointmentId);
  if (!v || !v.client_phone) return { ok: false, error: "no appt/phone" };
  /* Персональне вимкнення нагадувань (картка клієнта, меню ⋮).
     Стосується лише нагадувань — підтвердження запису йде завжди. */
  if ((kind === "reminder_24h" || kind === "reminder_2h") && v.client_no_reminders) {
    return { ok: false, error: "reminders disabled for client" };
  }
  const text = renderTemplate(kind, v);
  if (!text) return { ok: false, error: "no template for kind " + kind };
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
  if (!rows.length) return 0;

  /* ── Захист від «протухлого» хвоста ──────────────────────────────
     failed-рядки повторюються щохвилини. Поки на рахунку провайдера
     нема грошей — вони висять, а одразу після поповнення ВЕСЬ хвіст
     вилітає одним залпом і з'їдає баланс (27.07: 7 повідомлень пішли
     в нікуди на ~46 грн). Тому перед відправкою скасовуємо те, що
     надсилати вже безглуздо: старше 24 год; запис видалений,
     скасований, завершений або його час уже минув. */
  const nowK = tz.nowKyiv();
  const cancelStmt = db.prepare("UPDATE notifications SET status='cancelled', status_at=? WHERE id=?");
  const live = [];
  for (const n of rows) {
    let reason = null;
    if (Date.now() - n.created_at > 24 * 3600 * 1000) {
      reason = "старше 24 год";
    } else {
      const a = db.prepare("SELECT date, start_min, status FROM appointments WHERE id=?").get(n.appointment_id);
      if (!a) reason = "запис видалено";
      /* Для kind='cancellation' статус cancelled — очікуваний (це і є SMS про
         скасування), тому цей kind не відсіюємо за статусом. */
      else if (a.status === "cancelled" && n.kind !== "cancellation") reason = "запис має статус cancelled";
      else if (a.status === "no_show" || a.status === "completed") reason = "запис має статус " + a.status;
      else if (a.date < nowK.date || (a.date === nowK.date && a.start_min <= nowK.min)) reason = "час запису минув";
    }
    if (reason) {
      cancelStmt.run(Date.now(), n.id);
      console.log(`[notify] сповіщення #${n.id} скасовано (${reason})`);
      continue;
    }
    live.push(n);
  }

  for (const n of live) {
    try {
      const r = await driver.sendMessage({ phone: n.phone, text: n.text });
      db.prepare(
        "UPDATE notifications SET status='sent', provider=?, provider_msg_id=?, final_channel=?, sent_at=? WHERE id=?"
      ).run(driver.name, r.providerMsgId, r.channel || null, Date.now(), n.id);
    } catch (e) {
      console.error(`[notify] помилка відправки #${n.id}:`, e.message);
      /* «Некоректний номер» не вилікується повтором — одразу скасовуємо,
         інакше рядок ретраїться щохвилини й засмічує логи. */
      if (String(e.message || "").includes("некоректний номер")) {
        db.prepare("UPDATE notifications SET status='cancelled', status_at=? WHERE id=?").run(Date.now(), n.id);
      } else {
        db.prepare("UPDATE notifications SET status='failed' WHERE id=?").run(n.id);
      }
    }
  }
  return live.length;
}

/* Масова розсилка: надсилає порцію queued-повідомлень.
   Ліміт на тік свідомо невеликий — провайдер не любить залпи, та й при
   помилці ми не спалимо всю базу номерів однією ітерацією. */
const BROADCAST_PER_TICK = parseInt(process.env.BROADCAST_PER_TICK || "20", 10);

async function flushBroadcasts() {
  const rows = db.prepare(
    "SELECT * FROM broadcast_messages WHERE status='queued' ORDER BY id LIMIT ?"
  ).all(BROADCAST_PER_TICK);
  for (const m of rows) {
    const text = db.prepare("SELECT text FROM broadcasts WHERE id=?").get(m.broadcast_id);
    if (!text) { db.prepare("UPDATE broadcast_messages SET status='failed', error=? WHERE id=?").run("no broadcast", m.id); continue; }
    try {
      const r = await driver.sendMessage({ phone: m.phone, text: text.text, transactional: false });
      db.prepare(
        "UPDATE broadcast_messages SET status='sent', provider=?, provider_msg_id=?, final_channel=?, sent_at=? WHERE id=?"
      ).run(driver.name, r.providerMsgId, r.channel || null, Date.now(), m.id);
    } catch (e) {
      console.error(`[notify] розсилка #${m.id}:`, e.message);
      db.prepare("UPDATE broadcast_messages SET status='failed', error=? WHERE id=?").run(String(e.message).slice(0, 300), m.id);
    }
  }
  return rows.length;
}

/* Записати статус від вебхука/опитування за provider_msg_id. */
function recordStatus(providerMsgId, status, channel) {
  if (!providerMsgId) return false;
  const allowed = ["sent", "delivered", "undelivered", "failed"];
  if (allowed.indexOf(status) === -1) return false;
  const now = Date.now();
  const info = db.prepare(
    "UPDATE notifications SET status=?, final_channel=COALESCE(?, final_channel), status_at=? WHERE provider_msg_id=?"
  ).run(status, channel || null, now, String(providerMsgId));
  // Той самий вебхук обслуговує й розсилки — id повідомлень від провайдера спільні
  const info2 = db.prepare(
    "UPDATE broadcast_messages SET status=?, final_channel=COALESCE(?, final_channel), status_at=? WHERE provider_msg_id=?"
  ).run(status, channel || null, now, String(providerMsgId));
  return info.changes > 0 || info2.changes > 0;
}

/* Опитати фінальний статус для відправлених без статусу (фолбек до вебхука). */
async function pollStatuses() {
  if (typeof driver.pollStatus !== "function") return 0;
  const rows = db.prepare(
    `SELECT provider_msg_id FROM notifications
      WHERE status='sent' AND status_at IS NULL AND provider_msg_id IS NOT NULL
     UNION
     SELECT provider_msg_id FROM broadcast_messages
      WHERE status='sent' AND status_at IS NULL AND provider_msg_id IS NOT NULL
     LIMIT 100`
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

/* Текст SMS-привітання з днем народження (48 символів = 1 частина). */
function birthdayText() {
  return `З Днем народження! Чекаємо на вас.\n${STUDIO_PHONE}`;
}

module.exports = {
  driver, DRIVER_NAME, STUDIO_ADDRESS,
  apptView, renderTemplate, queueNotification,
  flushQueued, flushBroadcasts, recordStatus, pollStatuses, sendDirect,
  birthdayText,
};
