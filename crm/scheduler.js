/* ============================================================
   crm/scheduler.js — нагадування без зовнішнього cron.
   setInterval(60с): для вікон 24h і 2h ставить у чергу нагадування
   записам, час яких настає у вікні, ще без сповіщення цього виду
   (NOT EXISTS + UNIQUE => без дублів навіть після рестарту).
   Далі flushQueued() надсилає, періодично pollStatuses() трекає.
   ============================================================ */

const db = require("./db");
const tz = require("./tz");
const notify = require("./notify");

const TICK_MS = 60 * 1000;
const REMINDER2_HOURS = parseFloat(process.env.REMINDER2_HOURS || "0"); // env-фолбек для 2-го нагадування
let ticking = false;
let lastPoll = 0;

/* Час нагадувань редагується у CRM (вкладка Сповіщення) і зберігається в
   app_settings; env — лише початкове значення. Читаємо щотіка (раз на
   хвилину, для SQLite це дрібниця), тому зміни діють одразу без рестарту. */
function getSetting(key, dflt) {
  try {
    const r = db.prepare("SELECT value FROM app_settings WHERE key=?").get(key);
    return r ? r.value : dflt;
  } catch (e) { return dflt; }
}

function dueWindows() {
  const h1 = parseFloat(getSetting("reminder1_hours", "24")) || 0;
  const h2 = parseFloat(getSetting("reminder2_hours", process.env.REMINDER2_HOURS || "0")) || 0;
  const w = [];
  if (h1 > 0) w.push({ kind: "reminder_24h", leadMs: h1 * 60 * 60 * 1000 });
  if (h2 > 0) w.push({ kind: "reminder_2h", leadMs: h2 * 60 * 60 * 1000 });
  return w;
}

/* Знаходить записи, момент яких у (now, now+lead], і ставить нагадування.
   Правила (щоб клієнт не отримував зайвого одразу після запису):
   1. ЛИШЕ підтверджені записи — доки майстер не підтвердив, клієнту тиша.
   2. Якщо клієнт записався вже всередині вікна нагадування (напр. за 3 год
      до візиту при нагадуванні «за 24 год») — це нагадування пропускається:
      він щойно записався і все пам'ятає.
   3. Протухлі нагадування (момент минув понад 3 год тому, бо запис довго
      висів непідтвердженим) не надолужуються.
   4. Якщо підтвердження надіслано щойно (<30 хв) — нагадування чекає,
      щоб клієнт не отримав дві SMS підряд. */
function queueDueReminders(now) {
  let queued = 0;
  const appts = db.prepare(
    `SELECT id, date, start_min, created_at FROM appointments WHERE status='confirmed'`
  ).all();
  const windows = dueWindows();
  const confStmt = db.prepare(
    "SELECT sent_at FROM notifications WHERE appointment_id=? AND kind='confirmation' AND sent_at IS NOT NULL"
  );
  for (const a of appts) {
    const instant = tz.apptInstant(a.date, a.start_min);
    if (instant <= now) continue;
    const untilMs = instant - now;
    for (const win of windows) {
      if (untilMs > win.leadMs) continue; // ще рано для цього вікна
      const momentMs = instant - win.leadMs; // коли мало піти це нагадування
      if (momentMs < (a.created_at || 0) + 2 * 3600 * 1000) continue; // (2)
      if (now - momentMs > 3 * 3600 * 1000) continue;                 // (3)
      const conf = confStmt.get(a.id);
      if (conf && now - conf.sent_at < 30 * 60 * 1000) continue;      // (4)
      const exists = db.prepare(
        "SELECT 1 FROM notifications WHERE appointment_id=? AND kind=?"
      ).get(a.id, win.kind);
      if (exists) continue;
      const r = notify.queueNotification(a.id, win.kind);
      if (r.ok && !r.duplicate) queued++;
    }
  }
  return queued;
}

/* Привітання з днем народження: раз на рік на клієнта, о 10:00–19:59 за
   Києвом (нічні SMS заборонені операторами), лише клієнтам із датою
   народження в картці, не з чорного списку і без відмови від розсилок.
   Позначаємо надісланим ДО відправки: повтор при збої (спам + витрати)
   гірший за одне пропущене привітання. */
function sendBirthdaysDue() {
  try {
    if (getSetting("notif_birthday", "1") !== "1") return;
    const nowK = tz.nowKyiv();
    if (nowK.min < 10 * 60 || nowK.min >= 20 * 60) return;
    const md = nowK.date.slice(5); // 'MM-DD'
    const year = parseInt(nowK.date.slice(0, 4), 10);
    const rows = db.prepare(
      `SELECT id, phone FROM clients
        WHERE birthday IS NOT NULL AND length(birthday) >= 10 AND substr(birthday, 6, 5) = ?
          AND phone IS NOT NULL AND COALESCE(blacklisted, 0) = 0 AND COALESCE(no_marketing, 0) = 0`
    ).all(md);
    for (const c of rows) {
      const dup = db.prepare("SELECT 1 FROM birthday_greetings WHERE client_id=? AND year=?").get(c.id, year);
      if (dup) continue;
      db.prepare("INSERT INTO birthday_greetings (client_id, year, sent_at) VALUES (?,?,?)").run(c.id, year, Date.now());
      notify.sendDirect(c.phone, notify.birthdayText())
        .then(function () { console.log(`[birthday] привітання клієнту #${c.id} надіслано`); })
        .catch(function (e) { console.error("[birthday] send:", e.message); });
    }
  } catch (e) { console.error("[birthday]", e.message); }
}

/* Автозавершення підтверджених візитів: коли минула половина тривалості
   запису (start_min + duration_min/2), позначаємо статус «Завершено» —
   персоналу не треба клацати вручну для кожного візиту. Лише
   status='confirmed' (неприйняті pending-записи не чіпаємо — може, клієнт
   узагалі не прийде і майстер скасує). setStatus сам подбає про списання
   абонементу й запит відгуку — та сама логіка, що й при ручному кліку. */
function autoCompleteDue(now) {
  let completed = 0;
  try {
    const routes = require("./routes.crm");
    const rows = db.prepare(
      "SELECT id, date, start_min, duration_min FROM appointments WHERE status='confirmed'"
    ).all();
    for (const a of rows) {
      const startMs = tz.apptInstant(a.date, a.start_min);
      const midMs = startMs + (a.duration_min / 2) * 60000;
      if (now < midMs) continue;
      const r = routes.setStatus(a.id, "completed", { role: "owner" });
      if (r && r.status === 200) completed++;
    }
  } catch (e) { console.error("[auto-complete]", e.message); }
  return completed;
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    queueDueReminders(now);
    autoCompleteDue(now);
    sendBirthdaysDue();
    await notify.flushQueued();
    await notify.flushBroadcasts();
    if (now - lastPoll > 5 * 60 * 1000) { // опитування статусів ~раз на 5 хв
      lastPoll = now;
      await notify.pollStatuses();
    }
  } catch (e) {
    console.error("[scheduler] tick error:", e.message);
  } finally {
    ticking = false;
  }
}

function start() {
  console.log(`[scheduler] старт (tick ${TICK_MS / 1000}с, reminder_2h=${REMINDER2_HOURS || "вимк"})`);
  tick(); // одразу
  return setInterval(tick, TICK_MS);
}

module.exports = { start, tick, queueDueReminders, autoCompleteDue, REMINDER2_HOURS };
