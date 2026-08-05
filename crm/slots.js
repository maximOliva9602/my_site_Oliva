/* ============================================================
   crm/slots.js — логіка вільних віконець.
   Вхід: майстер (або "any"), послуга (тривалість), дата.
   Вихід: відсортований список стартів (хвилини від півночі),
   у які послугу можна вписати цілком, з урахуванням графіку,
   перерв, вихідних, наявних записів і приховування минулого.
   Ядро computeSlots — чиста функція (легко тестувати).
   ============================================================ */

const db = require("./db");
const tz = require("./tz");

const STEP = 15;                                  // крок стартів, хв
const LEAD_MIN   = parseInt(process.env.LEAD_MIN   || "30", 10); // мін. запас від «зараз», хв
const BUFFER_MIN = parseInt(process.env.BUFFER_MIN || "10", 10); // буфер між записами, хв

function ceilToStep(min, step) { return Math.ceil(min / step) * step; }
function overlaps(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && aEnd > bStart; }
function overlapsAny(start, end, blocked) {
  for (const b of blocked) if (overlaps(start, end, b[0], b[1])) return true;
  return false;
}

/* Чисте ядро: за межами зміни, заблокованими інтервалами і тривалістю
   повертає валідні старти. blocked — масив [startMin, endMin]. */
function computeSlots(workStart, workEnd, blocked, durationMin, earliest) {
  const out = [];
  let t = ceilToStep(Math.max(workStart, earliest), STEP);
  for (; t + durationMin <= workEnd; t += STEP) {
    if (!overlapsAny(t, t + durationMin, blocked)) out.push(t);
  }
  return out;
}

/* Заблоковані інтервали майстра на дату: перерви (за днем тижня),
   time-off (повний день або діапазон) і активні записи. */
function blockedIntervals(masterId, date) {
  const weekday = tz.weekdayOf(date);
  const blocked = [];

  const breaks = db.prepare(
    "SELECT break_start, break_end FROM master_breaks WHERE master_id = ? AND weekday = ?"
  ).all(masterId, weekday);
  for (const b of breaks) blocked.push([b.break_start, b.break_end]);

  const offs = db.prepare(
    "SELECT full_day, off_start, off_end FROM master_time_off WHERE master_id = ? AND date = ?"
  ).all(masterId, date);
  for (const o of offs) {
    if (o.full_day || o.off_start == null || o.off_end == null) blocked.push([0, 24 * 60]);
    else blocked.push([o.off_start, o.off_end]);
  }

  const appts = db.prepare(
    "SELECT start_min, end_min FROM appointments WHERE master_id = ? AND date = ? AND status IN ('pending','confirmed')"
  ).all(masterId, date);
  for (const a of appts) blocked.push([a.start_min, a.end_min + BUFFER_MIN]);

  return blocked;
}

/* Вільні старти для конкретного майстра. nowMs — для тестів. */
function freeSlots(masterId, date, durationMin, nowMs) {
  if (!tz.isDate(date) || !(durationMin > 0)) return [];
  const now = tz.nowKyiv(undefined, nowMs);
  if (date < now.date) return [];                 // минула дата

  // День-override має пріоритет над тижневим графіком
  const override = db.prepare(
    "SELECT is_off, work_start, work_end FROM master_day_overrides WHERE master_id=? AND date=?"
  ).get(masterId, date);

  let workStart, workEnd;
  if (override) {
    if (override.is_off) return [];               // явний вихідний
    workStart = override.work_start;
    workEnd   = override.work_end;
  } else {
    const weekday = tz.weekdayOf(date);
    const sched = db.prepare(
      "SELECT work_start, work_end FROM master_schedule WHERE master_id=? AND weekday=?"
    ).get(masterId, weekday);
    if (!sched) return [];                        // тижневий вихідний
    workStart = sched.work_start;
    workEnd   = sched.work_end;
  }

  let earliest = workStart;
  if (date === now.date) earliest = Math.max(workStart, now.min + LEAD_MIN);

  const blocked = blockedIntervals(masterId, date);
  return computeSlots(workStart, workEnd, blocked, durationMin, earliest);
}

/* Майстри (активні), що надають послугу. show_on_site тут НЕ враховуємо —
   він ховає майстра лише з лендінгу (команда на головній), а онлайн-запис
   (у т.ч. "будь-який майстер") і далі має його пропонувати. */
function mastersForService(serviceId) {
  return db.prepare(
    `SELECT m.id FROM masters m
       JOIN master_services ms ON ms.master_id = m.id
      WHERE ms.service_id = ? AND m.active = 1
      ORDER BY m.sort_order, m.id`
  ).all(serviceId).map(function (r) { return r.id; });
}

/* "Будь-який майстер": об'єднання стартів. Повертає
   [{ start_min, masterIds:[...] }] відсортовано за часом. */
function freeSlotsAny(serviceId, date, durationMin, nowMs) {
  const ids = mastersForService(serviceId);
  const map = new Map(); // start_min -> Set(masterId)
  for (const id of ids) {
    for (const s of freeSlots(id, date, durationMin, nowMs)) {
      if (!map.has(s)) map.set(s, []);
      map.get(s).push(id);
    }
  }
  return Array.from(map.keys()).sort(function (a, b) { return a - b; })
    .map(function (s) { return { start_min: s, masterIds: map.get(s) }; });
}

/* Чи вільний конкретний старт у майстра (для повторної перевірки при броні). */
function isSlotFree(masterId, date, startMin, durationMin, nowMs) {
  return freeSlots(masterId, date, durationMin, nowMs).indexOf(startMin) !== -1;
}

/* Максимальна тривалість (хв), яку можна вписати від startMin у майстра на дату:
   від startMin до найближчого заблокованого інтервалу або кінця зміни.
   Використовується, щоб дозволяти додаткові послуги лише якщо вони влазять. */
function maxDurationFrom(masterId, date, startMin) {
  if (!tz.isDate(date)) return 0;
  const override = db.prepare(
    "SELECT is_off, work_start, work_end FROM master_day_overrides WHERE master_id=? AND date=?"
  ).get(masterId, date);
  let workStart, workEnd;
  if (override) {
    if (override.is_off) return 0;
    workStart = override.work_start; workEnd = override.work_end;
  } else {
    const weekday = tz.weekdayOf(date);
    const sched = db.prepare(
      "SELECT work_start, work_end FROM master_schedule WHERE master_id=? AND weekday=?"
    ).get(masterId, weekday);
    if (!sched) return 0;
    workStart = sched.work_start; workEnd = sched.work_end;
  }
  if (startMin < workStart || startMin >= workEnd) return 0;
  let limit = workEnd;
  const blocked = blockedIntervals(masterId, date);
  for (const b of blocked) {
    const bs = b[0], be = b[1];
    if (bs <= startMin && be > startMin) return 0;   // старт усередині зайнятого інтервалу
    if (bs > startMin && bs < limit) limit = bs;     // найближчий блок після старту
  }
  return Math.max(0, limit - startMin);
}

module.exports = {
  STEP, LEAD_MIN, BUFFER_MIN,
  computeSlots, blockedIntervals,
  freeSlots, freeSlotsAny, mastersForService, isSlotFree, maxDurationFrom,
};
