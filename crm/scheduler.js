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
const ACTIVE = ["pending", "confirmed"];

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

/* Знаходить записи, момент яких у (now, now+lead], і ставить нагадування. */
function queueDueReminders(now) {
  let queued = 0;
  const appts = db.prepare(
    `SELECT id, date, start_min FROM appointments WHERE status IN ('pending','confirmed')`
  ).all();
  const windows = dueWindows();
  for (const a of appts) {
    const instant = tz.apptInstant(a.date, a.start_min);
    if (instant <= now) continue;
    const untilMs = instant - now;
    for (const win of windows) {
      if (untilMs > win.leadMs) continue; // ще рано для цього вікна
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

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    queueDueReminders(now);
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

module.exports = { start, tick, queueDueReminders, REMINDER2_HOURS };
