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

const STEP = parseInt(process.env.SLOT_STEP || "5", 10); // крок стартів, хв
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

  /* ЗАВЕРШЕНІ візити теж займають час. Раніше їх тут не було, а
     планувальник переводить запис у "completed" уже на СЕРЕДИНІ візиту
     (start + duration/2) — тож друга половина кожного візиту ставала
     "вільною", і клієнт міг записатися в зайнятий час.
     Скасовані та неявки не блокують: майстер справді вільний.

     Другий майстер парної процедури теж зайнятий — його час раніше
     не блокувався взагалі, тож його можна було записати двічі. */
  const appts = db.prepare(
    `SELECT start_min, end_min FROM appointments
      WHERE date = ? AND status IN ('pending','confirmed','completed')
        AND (master_id = ? OR second_master_id = ?)`
  ).all(date, masterId, masterId);
  for (const a of appts) blocked.push([a.start_min, a.end_min + BUFFER_MIN]);

  /* Разові перерви на конкретну дату (кнопка "⏸ Перерва" в календарі
     CRM) — окрема таблиця day_blocks, її досі ніхто тут не враховував,
     тож онлайн-запис пропонував час, заблокований у CRM. */
  const dayBlocks = db.prepare(
    "SELECT start_min, end_min FROM day_blocks WHERE master_id = ? AND date = ?"
  ).all(masterId, date);
  for (const b of dayBlocks) blocked.push([b.start_min, b.end_min]);

  return blocked;
}

/* Робочі години майстра на дату з урахуванням філії.
   Порядок пошуку: день-override цієї філії -> день-override «усі філії»
   -> тижневий графік цієї філії -> тижневий «усі філії».
   branch_id = 0 = «усі філії»: таким лишається графік, заведений до
   появи філій, тож старі дані працюють без міграції.
   Повертає {start, end} або null (вихідний / графіка немає). */
function workWindow(masterId, date, branchId) {
  const b = parseInt(branchId, 10) || 0;
  const ovStmt = db.prepare(
    "SELECT is_off, work_start, work_end FROM master_day_overrides WHERE master_id=? AND date=? AND branch_id=?"
  );
  let ov = b ? ovStmt.get(masterId, date, b) : null;
  if (!ov) ov = ovStmt.get(masterId, date, 0);
  if (ov) {
    if (ov.is_off) return null;
    return { start: ov.work_start, end: ov.work_end };
  }
  const weekday = tz.weekdayOf(date);
  const schStmt = db.prepare(
    "SELECT work_start, work_end FROM master_schedule WHERE master_id=? AND weekday=? AND branch_id=?"
  );
  let sch = b ? schStmt.get(masterId, weekday, b) : null;
  if (!sch) sch = schStmt.get(masterId, weekday, 0);
  if (!sch) return null;
  return { start: sch.work_start, end: sch.work_end };
}

/* Вільні старти для конкретного майстра. nowMs — для тестів. */
function freeSlots(masterId, date, durationMin, nowMs, branchId) {
  if (!tz.isDate(date) || !(durationMin > 0)) return [];
  const now = tz.nowKyiv(undefined, nowMs);
  if (date < now.date) return [];                 // минула дата

  const win = workWindow(masterId, date, branchId);
  if (!win) return [];                            // вихідний або графіка немає
  const workStart = win.start, workEnd = win.end;

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
function freeSlotsAny(serviceId, date, durationMin, nowMs, branchId) {
  /* branchId звужує і список майстрів (лише ті, хто працює у філії),
     і їхні робочі години — інакше «будь-який майстер» пропонував би час
     колеги з іншої адреси. */
  let ids = mastersForService(serviceId);
  const b = parseInt(branchId, 10) || 0;
  if (b) {
    const inBranch = db.prepare("SELECT master_id FROM branch_masters WHERE branch_id=?")
      .all(b).map(function (r) { return r.master_id; });
    if (inBranch.length) ids = ids.filter(function (id) { return inBranch.indexOf(id) !== -1; });
  }
  const map = new Map(); // start_min -> Set(masterId)
  for (const id of ids) {
    for (const s of freeSlots(id, date, durationMin, nowMs, branchId)) {
      if (!map.has(s)) map.set(s, []);
      map.get(s).push(id);
    }
  }
  return Array.from(map.keys()).sort(function (a, b) { return a - b; })
    .map(function (s) { return { start_min: s, masterIds: map.get(s) }; });
}

/* Чи вільний конкретний старт у майстра (для повторної перевірки при броні). */
function isSlotFree(masterId, date, startMin, durationMin, nowMs, branchId) {
  return freeSlots(masterId, date, durationMin, nowMs, branchId).indexOf(startMin) !== -1;
}

/* Максимальна тривалість (хв), яку можна вписати від startMin у майстра на дату:
   від startMin до найближчого заблокованого інтервалу або кінця зміни.
   Використовується, щоб дозволяти додаткові послуги лише якщо вони влазять. */
function maxDurationFrom(masterId, date, startMin, branchId) {
  if (!tz.isDate(date)) return 0;
  const win = workWindow(masterId, date, branchId);
  if (!win) return 0;
  const workStart = win.start, workEnd = win.end;
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
  workWindow, freeSlots, freeSlotsAny, mastersForService, isSlotFree, maxDurationFrom,
};
