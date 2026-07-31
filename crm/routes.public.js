/* ============================================================
   crm/routes.public.js — публічний онлайн-запис (без авторизації).
   Потік: послуга -> майстер(або «будь-який») -> дата -> вільні
   слоти -> ім'я+телефон -> підтвердження. Бронь у транзакції з
   повторною перевіркою накладок (захист від подвійного запису).
   ============================================================ */

const crypto = require("crypto");
const express = require("express");
const db = require("./db");
const tz = require("./tz");
const slots = require("./slots");
const notify = require("./notify");

const router = express.Router();
const clean = function (s, max) { return String(s == null ? "" : s).slice(0, max || 200).trim(); };

/* Рейтинг (середній) і к-ть відгуків майстра за таблицею reviews */
const ratingStmt = db.prepare(
  "SELECT ROUND(AVG(rating),1) AS avg, COUNT(*) AS cnt FROM reviews WHERE master_id = ?"
);
function attachStats(m) {
  const r = ratingStmt.get(m.id);
  m.reviews_count = (r && r.cnt) || 0;
  m.rating = m.reviews_count ? r.avg : null;
  return m;
}

/* Всі активні майстри з фото та рівнем */
router.get("/all-masters", function (req, res) {
  const masters = db.prepare(
    "SELECT id, name, photo, level, experience_years, branch_id FROM masters WHERE active = 1 ORDER BY sort_order, id"
  ).all();
  const svcStmt = db.prepare("SELECT service_id FROM master_services WHERE master_id = ?");
  const branchStmt = db.prepare("SELECT branch_id FROM branch_masters WHERE master_id=? ORDER BY branch_id");
  masters.forEach(function (m) {
    m.service_ids = svcStmt.all(m.id).map(function (r) { return r.service_id; });
    m.branch_ids = branchStmt.all(m.id).map(function (r) { return r.branch_id; });
    attachStats(m);
  });
  res.json({ ok: true, masters: masters });
});

/* Філії — для кроку "Оберіть філію" в онлайн-записі (лише коли власник
   увімкнув перемикач "booking_branch_step" у CRM і філій більше однієї —
   з однією філією цей крок для клієнта не має сенсу). */
router.get("/branches", function (req, res) {
  const setting = db.prepare("SELECT value FROM app_settings WHERE key='booking_branch_step'").get();
  const enabled = !!setting && setting.value === "1";
  const branches = db.prepare(
    "SELECT id, name, photo FROM branches WHERE active=1 ORDER BY sort_order, id"
  ).all();
  res.json({ ok: true, enabled: enabled && branches.length > 1, branches: branches });
});

/* Активні послуги */
router.get("/services", function (req, res) {
  const rows = db.prepare(
    "SELECT id, name, duration_min, price, image_url, category, featured FROM services WHERE active = 1 ORDER BY sort_order, id"
  ).all();
  res.json({ ok: true, services: rows });
});

/* Активні майстри, доступні на конкретну дату (враховує overrides + тижневий) */
router.get("/available-masters", function (req, res) {
  const date = clean(req.query.date, 10);
  if (!tz.isDate(date)) return res.status(400).json({ ok: false, error: "bad date" });
  const weekday = tz.weekdayOf(date);
  const masters = db.prepare(
    "SELECT id, name, photo, level, experience_years FROM masters WHERE active=1 ORDER BY sort_order, id"
  ).all();
  const svcStmt = db.prepare("SELECT service_id FROM master_services WHERE master_id=?");
  const ovStmt  = db.prepare("SELECT is_off FROM master_day_overrides WHERE master_id=? AND date=?");
  const schStmt = db.prepare("SELECT 1 FROM master_schedule WHERE master_id=? AND weekday=?");
  const available = masters.filter(function (m) {
    const ov = ovStmt.get(m.id, date);
    if (ov != null) return !ov.is_off;       // override beats weekly
    return !!schStmt.get(m.id, weekday);     // no override → weekly schedule
  });
  available.forEach(function (m) {
    m.service_ids = svcStmt.all(m.id).map(function (r) { return r.service_id; });
    attachStats(m);
  });
  res.json({ ok: true, masters: available });
});

/* Майстри, що надають послугу (+ прапорець «будь-який» на фронті) */
router.get("/masters", function (req, res) {
  const serviceId = parseInt(req.query.service, 10);
  if (!serviceId) return res.status(400).json({ ok: false, error: "service required" });
  const rows = db.prepare(
    `SELECT m.id, m.name FROM masters m
       JOIN master_services ms ON ms.master_id = m.id
      WHERE ms.service_id = ? AND m.active = 1
      ORDER BY m.sort_order, m.id`
  ).all(serviceId);
  res.json({ ok: true, masters: rows });
});

/* Вільні слоти. master=ID або 'any'. */
router.get("/slots", function (req, res) {
  const serviceId = parseInt(req.query.service, 10);
  const date = clean(req.query.date, 10);
  const master = clean(req.query.master, 10);
  if (!serviceId || !tz.isDate(date)) return res.status(400).json({ ok: false, error: "bad params" });
  const svc = db.prepare("SELECT duration_min FROM services WHERE id = ? AND active = 1").get(serviceId);
  if (!svc) return res.status(404).json({ ok: false, error: "service not found" });
  // Додатковий час обраних add-on'ів (щоб вільні слоти враховували повну тривалість)
  const extraMin = Math.max(0, Math.min(600, parseInt(req.query.extra, 10) || 0));
  const totalDur = svc.duration_min + extraMin;

  if (!master || master === "any") {
    const list = slots.freeSlotsAny(serviceId, date, totalDur);
    return res.json({
      ok: true, any: true,
      slots: list.map(function (s) { return { start_min: s.start_min, time: tz.fmtMin(s.start_min), masterIds: s.masterIds }; }),
    });
  }
  const masterId = parseInt(master, 10);
  const list = slots.freeSlots(masterId, date, totalDur);
  res.json({
    ok: true, any: false,
    slots: list.map(function (m) { return { start_min: m, time: tz.fmtMin(m) }; }),
  });
});

/* Найближчі вільні віконця кожного майстра (прев'ю на кроці вибору майстра).
   services=CSV id послуг категорії; для кожного майстра беремо найкоротшу
   тривалість серед його послуг категорії й скануємо до 14 днів наперед. */
router.get("/next-slots", function (req, res) {
  const ids = String(req.query.services || "")
    .split(",").map(function (x) { return parseInt(x, 10); })
    .filter(function (x) { return x > 0; }).slice(0, 60);
  const extra = Math.max(0, Math.min(600, parseInt(req.query.extra, 10) || 0));
  if (!ids.length) return res.json({ ok: true, masters: {} });

  const ph = ids.map(function () { return "?"; }).join(",");
  const svcRows = db.prepare("SELECT id, duration_min FROM services WHERE active=1 AND id IN (" + ph + ")").all.apply(
    db.prepare("SELECT id, duration_min FROM services WHERE active=1 AND id IN (" + ph + ")"), ids);
  if (!svcRows.length) return res.json({ ok: true, masters: {} });
  const durById = {}; svcRows.forEach(function (s) { durById[s.id] = s.duration_min; });
  const vids = svcRows.map(function (s) { return s.id; });
  const vph = vids.map(function () { return "?"; }).join(",");

  const provStmt = db.prepare("SELECT ms.master_id, ms.service_id FROM master_services ms JOIN masters m ON m.id=ms.master_id WHERE m.active=1 AND ms.service_id IN (" + vph + ")");
  const provRows = provStmt.all.apply(provStmt, vids);
  const masterDur = {};
  provRows.forEach(function (r) {
    const d = durById[r.service_id]; if (!d) return;
    if (masterDur[r.master_id] == null || d < masterDur[r.master_id]) masterDur[r.master_id] = d;
  });

  function addDays(dateStr, n) {
    const p = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }
  const today = tz.nowKyiv().date;
  const out = {};
  Object.keys(masterDur).forEach(function (midStr) {
    const mid = parseInt(midStr, 10);
    const dur = masterDur[mid] + extra;
    for (let i = 0; i < 14; i++) {
      const date = addDays(today, i);
      const free = slots.freeSlots(mid, date, dur);
      if (free.length) {
        out[mid] = { date: date, today: i === 0, times: free.slice(0, 6).map(function (m) { return tz.fmtMin(m); }) };
        break;
      }
    }
  });
  res.json({ ok: true, masters: out });
});

/* Максимальна тривалість, яку можна вписати від обраного старту (для гейту
   додаткових послуг: показуємо/дозволяємо лише ті, що влазять у вільний час). */
router.get("/max-duration", function (req, res) {
  const masterId = parseInt(req.query.master, 10);
  const date = clean(req.query.date, 10);
  const start = parseInt(req.query.start, 10);
  if (!masterId || !tz.isDate(date) || !(start >= 0)) {
    return res.status(400).json({ ok: false, error: "bad params" });
  }
  const max = slots.maxDurationFrom(masterId, date, start);
  res.json({ ok: true, max: max });
});

/* Створити запис (status=pending). */
router.post("/book", function (req, res) {
  const d = req.body || {};
  const serviceId = parseInt(d.service, 10);
  const date = clean(d.date, 10);
  const startMin = parseInt(d.start_min, 10);
  const name = clean(d.name, 100);
  const phoneRaw = clean(d.phone, 30);
  const comment = clean(d.comment, 500);
  let branchId = parseInt(d.branch, 10) || null;
  let master = clean(d.master, 10);

  if (!serviceId || !tz.isDate(date) || !(startMin >= 0) || !name || !phoneRaw) {
    return res.status(400).json({ ok: false, error: "missing fields" });
  }
  const phone = tz.normPhone(phoneRaw);
  if (phone.length < 7) return res.status(400).json({ ok: false, error: "bad phone" });

  const svc = db.prepare("SELECT id, duration_min, price FROM services WHERE id = ? AND active = 1").get(serviceId);
  if (!svc) return res.status(404).json({ ok: false, error: "service not found" });

  // Додаткові послуги (add-on'и): [{name, duration_min, price(коп)}] — додають час і ціну
  let extraServices = null, extraMin = 0, extraPrice = 0;
  try {
    const extras = d.extra_services ? JSON.parse(d.extra_services) : null;
    if (Array.isArray(extras) && extras.length) {
      const list = extras.slice(0, 20).map(function (ex) {
        return {
          name: clean(String(ex && ex.name != null ? ex.name : ""), 120),
          duration_min: Math.max(0, Math.min(600, parseInt(ex && ex.duration_min, 10) || 0)),
          price: Math.max(0, parseInt(ex && ex.price, 10) || 0),
        };
      });
      extraServices = JSON.stringify(list);
      list.forEach(function (ex) { extraMin += ex.duration_min; extraPrice += ex.price; });
    }
  } catch (e) { /* ignore bad JSON */ }
  const totalDur = svc.duration_min + extraMin;
  const totalPrice = svc.price + extraPrice;

  // Обрати майстра: конкретний або найперший вільний серед «будь-яких»
  let masterId;
  if (!master || master === "any") {
    const cand = slots.freeSlotsAny(serviceId, date, totalDur)
      .find(function (s) { return s.start_min === startMin; });
    if (!cand) return res.status(409).json({ ok: false, error: "SLOT_TAKEN" });
    masterId = cand.masterIds[0];
  } else {
    masterId = parseInt(master, 10);
    const m = db.prepare("SELECT id,branch_id FROM masters WHERE id = ? AND active = 1").get(masterId);
    if (!m) return res.status(404).json({ ok: false, error: "master not found" });
    if (!branchId) branchId = m.branch_id || null;
  }

  // Обрана філія повинна бути однією з філій цього майстра.
  if (branchId) {
    const membership = db.prepare(
      `SELECT 1
         FROM branch_masters bm
         JOIN branches b ON b.id=bm.branch_id
        WHERE bm.master_id=? AND bm.branch_id=? AND b.active=1`
    ).get(masterId, branchId);
    if (!membership) return res.status(400).json({ ok: false, error: "master not in branch" });
  }

  const now = Date.now();
  let appointmentId, publicId;
  try {
    const txn = db.transaction(function () {
      // повторна перевірка накладок усередині транзакції
      if (!slots.isSlotFree(masterId, date, startMin, totalDur)) {
        const err = new Error("SLOT_TAKEN"); err.code = "SLOT_TAKEN"; throw err;
      }
      // upsert клієнта за телефоном
      let client = db.prepare("SELECT id FROM clients WHERE phone = ?").get(phone);
      if (!client) {
        /* У базі трапляються обидва формати номера (097… і +380…) —
           точний збіг не знаходить стару картку і плодив би дублі.
           Фолбек: порівнюємо нормалізовані номери. */
        const hit = db.prepare("SELECT id, phone FROM clients").all()
          .find(function (c) { return tz.normPhone(c.phone) === phone; });
        if (hit) client = { id: hit.id };
      }
      if (!client) {
        const info = db.prepare(
          "INSERT INTO clients (phone, name, visit_count, created_at) VALUES (?,?,0,?)"
        ).run(phone, name, now);
        client = { id: info.lastInsertRowid };
      } else {
        db.prepare("UPDATE clients SET name = COALESCE(NULLIF(?,''), name) WHERE id = ?").run(name, client.id);
      }
      publicId = crypto.randomBytes(8).toString("hex");
      const endMin = startMin + totalDur;
      const ai = db.prepare(
        `INSERT INTO appointments
           (public_id, client_id, master_id, branch_id, service_id, date, start_min, end_min, duration_min, price, status, source, comment, extra_services, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', 'public', ?, ?, ?, ?)`
      ).run(publicId, client.id, masterId, branchId, serviceId, date, startMin, endMin, totalDur, totalPrice, comment, extraServices, now, now);
      appointmentId = ai.lastInsertRowid;
      /* SMS-підтвердження клієнту тут НЕ ставимо: запис створюється як
         'pending', і повідомлення «підтверджений» піде лише коли майстер
         підтвердить його в CRM (див. setStatus у routes.crm.js). */
    });
    txn();
  } catch (e) {
    if (e.code === "SLOT_TAKEN") return res.status(409).json({ ok: false, error: "SLOT_TAKEN" });
    console.error("[book]", e.message);
    return res.status(500).json({ ok: false, error: "server error" });
  }

  // Push + Telegram сповіщення адміну про новий запис із сайту
  try {
    const adminNotify = require("./admin-notify");
    adminNotify.notifyNewAppt(appointmentId, "site");
  } catch (e) { console.warn("[book] adminNotify error:", e.message); }

  // Повідомлення майстру (SMS/Viber на його телефон)
  try {
    const masterRow = db.prepare("SELECT name, phone FROM masters WHERE id=?").get(masterId);
    if (masterRow && masterRow.phone) {
      const d = date.split("-").reverse().slice(0,2).join(".");
      const h = Math.floor(startMin/60), m = startMin%60;
      const t = String(h).padStart(2,"0")+":"+String(m).padStart(2,"0");
      const svcRow = db.prepare("SELECT name FROM services WHERE id=?").get(serviceId);
      let masterExtras = "";
      try {
        const mex = extraServices ? JSON.parse(extraServices) : null;
        if (Array.isArray(mex) && mex.length) {
          masterExtras = "Додатково:\n" + mex.map(function (e) {
            const u = Math.round((parseInt(e.price, 10) || 0) / 100);
            return "• " + e.name + (u ? " (+" + u + " грн)" : "");
          }).join("\n") + "\n";
        }
      } catch (_) {}
      const masterText = "Oliva: новий запис!\n" +
        "Клієнт: " + name + " " + phone + "\n" +
        "Послуга: " + (svcRow ? svcRow.name : "") + "\n" +
        masterExtras +
        "Дата: " + d + " о " + t;
      notify.sendDirect(masterRow.phone, masterText).catch(function(e) {
        console.warn("[book] master notify failed:", e.message);
      });
    }
  } catch(e) { console.warn("[book] master notify err:", e.message); }

  res.json({ ok: true, public_id: publicId });
});

/* Статус брони за public_id (для сторінки підтвердження). */
router.get("/booking/:publicId", function (req, res) {
  const v = db.prepare(
    `SELECT a.public_id, a.date, a.start_min, a.status, a.duration_min,
            s.name AS service, m.name AS master
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN masters  m ON m.id = a.master_id
      WHERE a.public_id = ?`
  ).get(clean(req.params.publicId, 40));
  if (!v) return res.status(404).json({ ok: false });
  res.json({ ok: true, booking: { ...v, time: tz.fmtMin(v.start_min) } });
});

module.exports = router;
