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
    "SELECT id, name, photo, level, experience_years FROM masters WHERE active = 1 ORDER BY sort_order, id"
  ).all();
  const svcStmt = db.prepare("SELECT service_id FROM master_services WHERE master_id = ?");
  masters.forEach(function (m) {
    m.service_ids = svcStmt.all(m.id).map(function (r) { return r.service_id; });
    attachStats(m);
  });
  res.json({ ok: true, masters: masters });
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

/* Створити запис (status=pending). */
router.post("/book", function (req, res) {
  const d = req.body || {};
  const serviceId = parseInt(d.service, 10);
  const date = clean(d.date, 10);
  const startMin = parseInt(d.start_min, 10);
  const name = clean(d.name, 100);
  const phoneRaw = clean(d.phone, 30);
  const comment = clean(d.comment, 500);
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
    const m = db.prepare("SELECT id FROM masters WHERE id = ? AND active = 1").get(masterId);
    if (!m) return res.status(404).json({ ok: false, error: "master not found" });
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
           (public_id, client_id, master_id, service_id, date, start_min, end_min, duration_min, price, status, source, comment, extra_services, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?, 'pending', 'public', ?, ?, ?, ?)`
      ).run(publicId, client.id, masterId, serviceId, date, startMin, endMin, totalDur, totalPrice, comment, extraServices, now, now);
      appointmentId = ai.lastInsertRowid;
      notify.queueNotification(appointmentId, "confirmation");
    });
    txn();
  } catch (e) {
    if (e.code === "SLOT_TAKEN") return res.status(409).json({ ok: false, error: "SLOT_TAKEN" });
    console.error("[book]", e.message);
    return res.status(500).json({ ok: false, error: "server error" });
  }

  // Одразу надсилаємо підтвердження клієнту (не чекаємо scheduler)
  notify.flushQueued().catch(function(e) { console.warn("[book] flush err:", e.message); });

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
