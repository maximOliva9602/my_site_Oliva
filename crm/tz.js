/* ============================================================
   crm/tz.js — робота з часом і телефонами.
   Студія працює в Europe/Kyiv. Ключове рішення архітектури:
   настінний час (дата + хвилини від півночі) зберігаємо як є,
   а в UTC-мілісекунди конвертуємо лише коли треба «момент»
   (нагадування, сортування). Конвертація DST-aware через Intl —
   без хардкоду ±02:00/03:00.
   ============================================================ */

const TZ = process.env.TZ || "Europe/Kyiv";

/* Зсув часового поясу (у хвилинах) для конкретного UTC-моменту.
   Додатний для Києва (UTC+2/+3). Рахуємо через Intl, тому DST враховано. */
function tzOffsetMinutes(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0; // деякі рантайми віддають "24" для опівночі
  // Локальний настінний час як «псевдо-UTC»
  const asUTC = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    hour,
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10)
  );
  return Math.round((asUTC - utcMs) / 60000);
}

/* Перетворює настінний час студії (date 'YYYY-MM-DD' + хвилини від півночі)
   у UTC epoch ms. Враховує DST: спершу пробне UTC, тоді корекція за зсувом. */
function apptInstant(date, startMin, timeZone) {
  const tz = timeZone || TZ;
  const [y, m, d] = date.split("-").map(Number);
  const hh = Math.floor(startMin / 60);
  const mm = startMin % 60;
  // Перше наближення: трактуємо настінний час як UTC
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Зсув у цей момент і віднімаємо його (щоб з настінного отримати справжній UTC)
  const off = tzOffsetMinutes(guess, tz);
  let utc = guess - off * 60000;
  // Один уточнюючий прохід (на межі переходу DST зсув міг змінитися)
  const off2 = tzOffsetMinutes(utc, tz);
  if (off2 !== off) utc = guess - off2 * 60000;
  return utc;
}

/* Поточний настінний час студії як { date, min, weekday }.
   weekday: 0=Нд .. 6=Сб (як у master_schedule). */
function nowKyiv(timeZone, nowMs) {
  const tz = timeZone || TZ;
  const ms = nowMs == null ? Date.now() : nowMs;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  const parts = {};
  for (const p of dtf.formatToParts(new Date(ms))) parts[p.type] = p.value;
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;
  const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: parts.year + "-" + parts.month + "-" + parts.day,
    min: hour * 60 + parseInt(parts.minute, 10),
    weekday: wdMap[parts.weekday],
  };
}

function todayKyiv(timeZone, nowMs) { return nowKyiv(timeZone, nowMs).date; }

/* weekday для довільної дати 'YYYY-MM-DD' (0=Нд..6=Сб), стабільно через UTC-полудень. */
function weekdayOf(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

/* Нормалізація телефону до ключа +380XXXXXXXXX (де можливо).
   Прибираємо все крім цифр і '+', зводимо укр. формати до +380. */
function normPhone(raw) {
  let s = String(raw == null ? "" : raw).replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) {
    s = "+" + s.slice(1).replace(/\+/g, "");
  } else {
    // 0XXXXXXXXX -> +380XXXXXXXXX ; 380... -> +380... ; інакше лишаємо як є з +
    if (s.startsWith("380")) s = "+" + s;
    else if (s.startsWith("0") && s.length === 10) s = "+38" + s;
    else s = "+" + s;
  }
  return s;
}

/* Хвилини від півночі -> 'HH:MM' */
function fmtMin(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/* 'HH:MM' -> хвилини від півночі (null якщо неформат) */
function parseMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/* Перевірка формату 'YYYY-MM-DD' */
function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }

module.exports = {
  TZ, tzOffsetMinutes, apptInstant, nowKyiv, todayKyiv, weekdayOf,
  normPhone, fmtMin, parseMin, isDate,
};
