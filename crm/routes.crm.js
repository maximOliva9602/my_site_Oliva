/* ============================================================
   crm/routes.crm.js — кабінети власника й майстра.
   requireAuth() — будь-яка сесія; requireAuth('owner') — лише власник.
   Майстер бачить/керує лише своїми записами (scope на master_id).
   ============================================================ */

const crypto = require("crypto");
const express = require("express");
const db = require("./db");
const tz = require("./tz");
const slots = require("./slots");
const auth = require("./auth");

const router = express.Router();
const owner = auth.requireAuth("owner");
const any = auth.requireAuth();

const clean = function (s, max) { return String(s == null ? "" : s).slice(0, max || 200).trim(); };
const STATUSES = ["pending", "confirmed", "cancelled", "completed", "no_show"];

/* ---------- спільне: повна картка запису ---------- */
function apptRow(id) {
  return db.prepare(
    `SELECT a.*, c.name AS client_name, c.phone AS client_phone,
            s.name AS service_name, m.name AS master_name
       FROM appointments a
       JOIN clients c  ON c.id = a.client_id
       JOIN services s ON s.id = a.service_id
       JOIN masters  m ON m.id = a.master_id
      WHERE a.id = ?`
  ).get(id);
}
function viewAppt(a) {
  return a && Object.assign({}, a, { time: tz.fmtMin(a.start_min), end_time: tz.fmtMin(a.end_min) });
}

/* Перерахунок візитів клієнта за завершеними записами. */
function recomputeClient(clientId) {
  const r = db.prepare(
    "SELECT COUNT(*) n, MAX(date) d FROM appointments WHERE client_id = ? AND status = 'completed'"
  ).get(clientId);
  let lastVisitAt = null;
  if (r.d) {
    const a = db.prepare(
      "SELECT start_min FROM appointments WHERE client_id=? AND status='completed' AND date=? ORDER BY start_min DESC LIMIT 1"
    ).get(clientId, r.d);
    lastVisitAt = tz.apptInstant(r.d, a ? a.start_min : 0);
  }
  db.prepare("UPDATE clients SET visit_count=?, last_visit_at=? WHERE id=?").run(r.n, lastVisitAt, clientId);
}

/* ---------- створення запису персоналом (owner або master) ---------- */
function createAppointment(d, session) {
  const serviceId = parseInt(d.service, 10);
  let masterId = parseInt(d.master, 10);
  const date = clean(d.date, 10);
  const startMin = parseInt(d.start_min, 10);
  const name = clean(d.name, 100);
  const phone = tz.normPhone(clean(d.phone, 30));
  const comment = clean(d.comment, 500);

  // майстер може створювати лише собі
  if (session.role !== "owner") masterId = session.masterId;

  if (!serviceId || !masterId || !tz.isDate(date) || !(startMin >= 0) || !name || phone.length < 7) {
    return { status: 400, body: { ok: false, error: "missing fields" } };
  }
  const svc = db.prepare("SELECT duration_min, price FROM services WHERE id=? AND active=1").get(serviceId);
  if (!svc) return { status: 404, body: { ok: false, error: "service not found" } };
  const m = db.prepare("SELECT id FROM masters WHERE id=? AND active=1").get(masterId);
  if (!m) return { status: 404, body: { ok: false, error: "master not found" } };

  const now = Date.now();
  let publicId, appointmentId;
  try {
    db.transaction(function () {
      if (!slots.isSlotFree(masterId, date, startMin, svc.duration_min)) {
        const e = new Error("SLOT_TAKEN"); e.code = "SLOT_TAKEN"; throw e;
      }
      let client = db.prepare("SELECT id FROM clients WHERE phone=?").get(phone);
      if (!client) {
        const info = db.prepare("INSERT INTO clients (phone,name,visit_count,created_at) VALUES (?,?,0,?)").run(phone, name, now);
        client = { id: info.lastInsertRowid };
      } else {
        db.prepare("UPDATE clients SET name=COALESCE(NULLIF(?,''),name) WHERE id=?").run(name, client.id);
      }
      publicId = crypto.randomBytes(8).toString("hex");
      const info = db.prepare(
        `INSERT INTO appointments (public_id,client_id,master_id,service_id,date,start_min,end_min,duration_min,price,status,source,comment,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?, 'confirmed','staff',?,?,?)`
      ).run(publicId, client.id, masterId, serviceId, date, startMin, startMin + svc.duration_min, svc.duration_min, svc.price, comment, now, now);
      appointmentId = info.lastInsertRowid;
    })();
  } catch (e) {
    if (e.code === "SLOT_TAKEN") return { status: 409, body: { ok: false, error: "SLOT_TAKEN" } };
    return { status: 500, body: { ok: false, error: e.message } };
  }
  return { status: 200, body: { ok: true, public_id: publicId, appointment: viewAppt(apptRow(appointmentId)) } };
}

/* ---------- зміна статусу ---------- */
function setStatus(id, status, session) {
  if (STATUSES.indexOf(status) === -1) return { status: 400, body: { ok: false, error: "bad status" } };
  const a = db.prepare("SELECT id, master_id, client_id, public_id FROM appointments WHERE id=?").get(id);
  if (!a) return { status: 404, body: { ok: false, error: "not found" } };
  if (session.role !== "owner" && a.master_id !== session.masterId) {
    return { status: 403, body: { ok: false, error: "forbidden" } };
  }
  db.prepare("UPDATE appointments SET status=?, updated_at=? WHERE id=?").run(status, Date.now(), id);
  recomputeClient(a.client_id);
  // Після завершення — ставимо в чергу запит на відгук
  if (status === "completed") {
    try {
      const notify = require("./notify");
      notify.queueNotification(id, "review_request");
    } catch(e) { /* notify може не підтримувати review_request — OK */ }
  }
  return { status: 200, body: { ok: true, appointment: viewAppt(apptRow(id)) } };
}

/* ============================================================
   МАЙСТЕР (і власник): свої записи/клієнти
   ============================================================ */
router.get("/me/appointments", any, function (req, res) {
  const s = req.session;
  const from = clean(req.query.from, 10), to = clean(req.query.to, 10);
  let sql = "SELECT a.*, c.name client_name, c.phone client_phone, s.name service_name, m.name master_name FROM appointments a JOIN clients c ON c.id=a.client_id JOIN services s ON s.id=a.service_id JOIN masters m ON m.id=a.master_id WHERE 1=1";
  const args = [];
  if (s.role !== "owner") { sql += " AND a.master_id=?"; args.push(s.masterId); }
  if (tz.isDate(from)) { sql += " AND a.date>=?"; args.push(from); }
  if (tz.isDate(to)) { sql += " AND a.date<=?"; args.push(to); }
  sql += " ORDER BY a.date, a.start_min";
  const stmt = db.prepare(sql);
  res.json({ ok: true, appointments: stmt.all.apply(stmt, args).map(viewAppt) });
});

router.post("/me/appointments", any, function (req, res) {
  const r = createAppointment(req.body || {}, req.session);
  res.status(r.status).json(r.body);
});

router.get("/me/clients", any, function (req, res) {
  const s = req.session;
  let rows;
  if (s.role === "owner") {
    rows = db.prepare("SELECT * FROM clients ORDER BY last_visit_at DESC NULLS LAST, id DESC").all();
  } else {
    rows = db.prepare(
      `SELECT DISTINCT c.* FROM clients c JOIN appointments a ON a.client_id=c.id
        WHERE a.master_id=? ORDER BY c.last_visit_at DESC`
    ).all(s.masterId);
  }
  res.json({ ok: true, clients: rows });
});

/* спільні дії над записом (scope перевіряється всередині) */
router.patch("/appointments/:id/status", any, function (req, res) {
  const r = setStatus(parseInt(req.params.id, 10), clean((req.body || {}).status, 20), req.session);
  res.status(r.status).json(r.body);
});

router.patch("/appointments/:id", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const a = db.prepare("SELECT * FROM appointments WHERE id=?").get(id);
  if (!a) return res.status(404).json({ ok: false, error: "not found" });
  if (req.session.role !== "owner" && a.master_id !== req.session.masterId) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const d = req.body || {};
  const date = d.date !== undefined ? clean(d.date, 10) : a.date;
  const startMin = d.start_min !== undefined ? parseInt(d.start_min, 10) : a.start_min;
  const masterId = (d.master !== undefined && req.session.role === "owner") ? parseInt(d.master, 10) : a.master_id;
  const comment = d.comment !== undefined ? clean(d.comment, 500) : a.comment;
  if (!tz.isDate(date) || !(startMin >= 0)) return res.status(400).json({ ok: false, error: "bad params" });

  // перевірка накладок при перенесенні (виключаючи сам запис)
  if (date !== a.date || startMin !== a.start_min || masterId !== a.master_id) {
    const others = db.prepare(
      "SELECT start_min,end_min FROM appointments WHERE master_id=? AND date=? AND id<>? AND status IN ('pending','confirmed')"
    ).all(masterId, date, id);
    const endMin = startMin + a.duration_min;
    const clash = others.some(function (o) { return startMin < o.end_min && endMin > o.start_min; });
    if (clash) return res.status(409).json({ ok: false, error: "SLOT_TAKEN" });
    db.prepare("UPDATE appointments SET date=?, start_min=?, end_min=?, master_id=?, comment=?, updated_at=? WHERE id=?")
      .run(date, startMin, startMin + a.duration_min, masterId, comment, Date.now(), id);
  } else {
    db.prepare("UPDATE appointments SET comment=?, updated_at=? WHERE id=?").run(comment, Date.now(), id);
  }
  res.json({ ok: true, appointment: viewAppt(apptRow(id)) });
});

/* ---- Оплата запису ---- */
router.patch("/appointments/:id/payment", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const a = db.prepare("SELECT id, master_id FROM appointments WHERE id=?").get(id);
  if (!a) return res.status(404).json({ ok: false });
  if (req.session.role !== "owner" && a.master_id !== req.session.masterId)
    return res.status(403).json({ ok: false });
  const d = req.body || {};
  const paid = d.paid !== undefined ? (d.paid ? 1 : 0) : 0;
  const method = d.pay_method ? String(d.pay_method).slice(0, 30) : null;
  db.prepare("UPDATE appointments SET paid=?, pay_method=?, updated_at=? WHERE id=?")
    .run(paid, method, Date.now(), id);
  res.json({ ok: true });
});

/* ============================================================
   ВЛАСНИК: записи (усі), майстри, послуги, клієнти, користувачі
   ============================================================ */
router.get("/appointments", owner, function (req, res) {
  const date = clean(req.query.date, 10), from = clean(req.query.from, 10), to = clean(req.query.to, 10);
  const master = parseInt(req.query.master, 10);
  let sql = "SELECT a.*, c.name client_name, c.phone client_phone, s.name service_name, m.name master_name FROM appointments a JOIN clients c ON c.id=a.client_id JOIN services s ON s.id=a.service_id JOIN masters m ON m.id=a.master_id WHERE 1=1";
  const args = [];
  if (tz.isDate(date)) { sql += " AND a.date=?"; args.push(date); }
  if (tz.isDate(from)) { sql += " AND a.date>=?"; args.push(from); }
  if (tz.isDate(to)) { sql += " AND a.date<=?"; args.push(to); }
  if (master) { sql += " AND a.master_id=?"; args.push(master); }
  sql += " ORDER BY a.date, a.start_min";
  const stmt = db.prepare(sql);
  res.json({ ok: true, appointments: stmt.all.apply(stmt, args).map(viewAppt) });
});

router.post("/appointments", owner, function (req, res) {
  const r = createAppointment(req.body || {}, req.session);
  res.status(r.status).json(r.body);
});

/* ---- Майстри ---- */
router.get("/masters", any, function (req, res) {
  const rows = db.prepare("SELECT * FROM masters WHERE active=1 ORDER BY sort_order, id").all();
  // приклеїти services-ids
  rows.forEach(function (m) {
    m.service_ids = db.prepare("SELECT service_id FROM master_services WHERE master_id=?").all(m.id).map(function (r) { return r.service_id; });
  });
  res.json({ ok: true, masters: rows });
});
router.post("/masters", owner, function (req, res) {
  const d = req.body || {};
  const name = clean(d.name, 100);
  if (!name) return res.status(400).json({ ok: false, error: "name required" });
  const info = db.prepare("INSERT INTO masters (name,phone,color,active,sort_order,created_at) VALUES (?,?,?,1,?,?)")
    .run(name, clean(d.phone, 30), clean(d.color, 20), parseInt(d.sort_order, 10) || 0, Date.now());
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.put("/masters/:id", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const m = db.prepare("SELECT * FROM masters WHERE id=?").get(id);
  if (!m) return res.status(404).json({ ok: false });
  const d = req.body || {};
  db.prepare("UPDATE masters SET name=?, phone=?, color=?, sort_order=? WHERE id=?").run(
    d.name !== undefined ? clean(d.name, 100) : m.name,
    d.phone !== undefined ? clean(d.phone, 30) : m.phone,
    d.color !== undefined ? clean(d.color, 20) : m.color,
    d.sort_order !== undefined ? parseInt(d.sort_order, 10) || 0 : m.sort_order,
    id
  );
  if (Array.isArray(d.service_ids)) setMasterServices(id, d.service_ids);
  res.json({ ok: true });
});
router.delete("/masters/:id", owner, function (req, res) {
  db.prepare("UPDATE masters SET active=0 WHERE id=?").run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

function setMasterServices(masterId, ids) {
  const txn = db.transaction(function () {
    db.prepare("DELETE FROM master_services WHERE master_id=?").run(masterId);
    const ins = db.prepare("INSERT OR IGNORE INTO master_services (master_id,service_id) VALUES (?,?)");
    ids.forEach(function (sid) { const n = parseInt(sid, 10); if (n) ins.run(masterId, n); });
  });
  txn();
}
router.put("/masters/:id/services", owner, function (req, res) {
  const ids = (req.body && req.body.service_ids) || [];
  setMasterServices(parseInt(req.params.id, 10), Array.isArray(ids) ? ids : []);
  res.json({ ok: true });
});

/* ---- Графік + перерви ---- */
router.get("/masters/:id/schedule", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  res.json({
    ok: true,
    schedule: db.prepare("SELECT weekday, work_start, work_end FROM master_schedule WHERE master_id=? ORDER BY weekday").all(id),
    breaks: db.prepare("SELECT id, weekday, break_start, break_end FROM master_breaks WHERE master_id=? ORDER BY weekday, break_start").all(id),
  });
});
router.put("/masters/:id/schedule", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const sched = (req.body && req.body.schedule) || []; // [{weekday,work_start,work_end}]
  const breaks = (req.body && req.body.breaks) || [];   // [{weekday,break_start,break_end}]
  const txn = db.transaction(function () {
    db.prepare("DELETE FROM master_schedule WHERE master_id=?").run(id);
    db.prepare("DELETE FROM master_breaks WHERE master_id=?").run(id);
    const si = db.prepare("INSERT INTO master_schedule (master_id,weekday,work_start,work_end) VALUES (?,?,?,?)");
    sched.forEach(function (r) {
      const wd = parseInt(r.weekday, 10), ws = parseInt(r.work_start, 10), we = parseInt(r.work_end, 10);
      if (wd >= 0 && wd <= 6 && ws >= 0 && we > ws) si.run(id, wd, ws, we);
    });
    const bi = db.prepare("INSERT INTO master_breaks (master_id,weekday,break_start,break_end) VALUES (?,?,?,?)");
    breaks.forEach(function (r) {
      const wd = parseInt(r.weekday, 10), bs = parseInt(r.break_start, 10), be = parseInt(r.break_end, 10);
      if (wd >= 0 && wd <= 6 && bs >= 0 && be > bs) bi.run(id, wd, bs, be);
    });
  });
  txn();
  res.json({ ok: true });
});

/* ---- Time-off (відпустки/вихідні разові) ---- */
router.get("/masters/:id/timeoff", any, function (req, res) {
  res.json({ ok: true, timeoff: db.prepare("SELECT * FROM master_time_off WHERE master_id=? ORDER BY date").all(parseInt(req.params.id, 10)) });
});
router.post("/masters/:id/timeoff", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const d = req.body || {};
  if (!tz.isDate(clean(d.date, 10))) return res.status(400).json({ ok: false, error: "bad date" });
  const fullDay = d.full_day === false ? 0 : 1;
  const info = db.prepare("INSERT INTO master_time_off (master_id,date,full_day,off_start,off_end) VALUES (?,?,?,?,?)")
    .run(id, clean(d.date, 10), fullDay, fullDay ? null : parseInt(d.off_start, 10), fullDay ? null : parseInt(d.off_end, 10));
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.delete("/masters/:id/timeoff/:offId", owner, function (req, res) {
  db.prepare("DELETE FROM master_time_off WHERE id=? AND master_id=?").run(parseInt(req.params.offId, 10), parseInt(req.params.id, 10));
  res.json({ ok: true });
});

/* ---- Послуги ---- */
router.get("/services", any, function (req, res) {
  res.json({ ok: true, services: db.prepare("SELECT * FROM services WHERE active=1 ORDER BY sort_order, id").all() });
});
router.post("/services", owner, function (req, res) {
  const d = req.body || {};
  const name = clean(d.name, 150);
  const dur = parseInt(d.duration_min, 10);
  if (!name || !(dur > 0)) return res.status(400).json({ ok: false, error: "name+duration required" });
  const info = db.prepare("INSERT INTO services (name,duration_min,price,active,sort_order,created_at) VALUES (?,?,?,1,?,?)")
    .run(name, dur, parseInt(d.price, 10) || 0, parseInt(d.sort_order, 10) || 0, Date.now());
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.put("/services/:id", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const s = db.prepare("SELECT * FROM services WHERE id=?").get(id);
  if (!s) return res.status(404).json({ ok: false });
  const d = req.body || {};
  db.prepare("UPDATE services SET name=?, duration_min=?, price=?, sort_order=? WHERE id=?").run(
    d.name !== undefined ? clean(d.name, 150) : s.name,
    d.duration_min !== undefined ? (parseInt(d.duration_min, 10) || s.duration_min) : s.duration_min,
    d.price !== undefined ? (parseInt(d.price, 10) || 0) : s.price,
    d.sort_order !== undefined ? parseInt(d.sort_order, 10) || 0 : s.sort_order,
    id
  );
  res.json({ ok: true });
});
router.delete("/services/:id", owner, function (req, res) {
  db.prepare("UPDATE services SET active=0 WHERE id=?").run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

/* ---- Клієнти ---- */
router.get("/clients", owner, function (req, res) {
  const q = clean(req.query.q, 60);
  let rows;
  if (q) {
    const like = "%" + q + "%";
    rows = db.prepare("SELECT * FROM clients WHERE name LIKE ? OR phone LIKE ? ORDER BY last_visit_at DESC NULLS LAST LIMIT 200").all(like, like);
  } else {
    rows = db.prepare("SELECT * FROM clients ORDER BY last_visit_at DESC NULLS LAST, id DESC LIMIT 200").all();
  }
  res.json({ ok: true, clients: rows });
});
router.get("/clients/:id", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const client = db.prepare("SELECT * FROM clients WHERE id=?").get(id);
  if (!client) return res.status(404).json({ ok: false });
  const history = db.prepare(
    `SELECT a.id, a.date, a.start_min, a.status, a.service_id, a.master_id,
            s.name service_name, m.name master_name
       FROM appointments a JOIN services s ON s.id=a.service_id JOIN masters m ON m.id=a.master_id
      WHERE a.client_id=? ORDER BY a.date DESC, a.start_min DESC`
  ).all(id).map(viewAppt);
  res.json({ ok: true, client: client, history: history });
});
router.patch("/clients/:id", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const d = req.body || {};
  const c = db.prepare("SELECT * FROM clients WHERE id=?").get(id);
  if (!c) return res.status(404).json({ ok: false });
  db.prepare("UPDATE clients SET name=?, note=? WHERE id=?").run(
    d.name !== undefined ? clean(d.name, 100) : c.name,
    d.note !== undefined ? clean(d.note, 1000) : c.note,
    id
  );
  res.json({ ok: true });
});

/* ---- Користувачі (акаунти майстрів) ---- */
router.get("/users", owner, function (req, res) { res.json({ ok: true, users: auth.listUsers() }); });
router.post("/users", owner, function (req, res) {
  const r = auth.createUser(req.body || {});
  res.status(r.ok ? 200 : 400).json(r);
});
router.put("/users/:id", owner, function (req, res) {
  const r = auth.updateUser(parseInt(req.params.id, 10), req.body || {});
  res.status(r.ok ? 200 : 400).json(r);
});
router.delete("/users/:id", owner, function (req, res) {
  res.json(auth.deleteUser(parseInt(req.params.id, 10)));
});

/* ================================================================
   ДАШБОРД — аналітика для власника
   ================================================================ */
router.get("/dashboard", owner, function (req, res) {
  const now = tz.nowKyiv();
  const today = now.date;

  // Межі тижня (Пн) і місяця
  const dt = new Date(today + "T00:00:00");
  const dow = dt.getDay() === 0 ? 6 : dt.getDay() - 1;
  const weekStart = new Date(dt); weekStart.setDate(dt.getDate() - dow);
  const wStart = weekStart.toISOString().slice(0, 10);
  const mStart = today.slice(0, 7) + "-01";

  function apptStats(from, to) {
    const r = db.prepare(
      `SELECT
         COUNT(*) total,
         SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,
         SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled,
         SUM(CASE WHEN status='no_show'   THEN 1 ELSE 0 END) no_show,
         SUM(CASE WHEN status IN ('pending','confirmed') THEN 1 ELSE 0 END) active
       FROM appointments WHERE date >= ? AND date <= ?`
    ).get(from, to);
    return r;
  }

  // --- 1. Записи ---
  const apptToday = apptStats(today, today);
  const apptWeek  = apptStats(wStart, today);
  const apptMonth = apptStats(mStart, today);

  const upcomingToday = db.prepare(
    `SELECT a.id, a.start_min, a.status, a.duration_min,
            c.name client_name, c.phone client_phone,
            s.name service_name, m.name master_name
       FROM appointments a
       JOIN clients c ON c.id=a.client_id
       JOIN services s ON s.id=a.service_id
       JOIN masters  m ON m.id=a.master_id
      WHERE a.date=? AND a.status IN ('pending','confirmed')
      ORDER BY a.start_min`
  ).all(today).map(function (a) {
    return Object.assign({}, a, { time: tz.fmtMin(a.start_min) });
  });

  // --- 2. Майстри ---
  const masters = db.prepare(
    `SELECT m.id, m.name, m.photo, m.level,
            COUNT(a.id) bookings,
            SUM(CASE WHEN a.status='completed' THEN a.price ELSE 0 END) revenue
       FROM masters m
       LEFT JOIN appointments a ON a.master_id=m.id AND a.date>=?
      WHERE m.active=1
      GROUP BY m.id ORDER BY bookings DESC`
  ).all(mStart);

  // Завантаженість: робочих годин на місяць (Пн-Сб, 12.5 год/день)
  const daysInMonth = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  const workdays = Math.round(daysInMonth * 6 / 7);
  const maxMinPerMaster = workdays * 750; // 12.5 год = 750 хв

  masters.forEach(function (m) {
    const usedMin = db.prepare(
      `SELECT COALESCE(SUM(duration_min),0) s FROM appointments
        WHERE master_id=? AND date>=? AND status IN ('pending','confirmed','completed')`
    ).get(m.id, mStart).s;
    m.workload_pct = maxMinPerMaster > 0 ? Math.min(100, Math.round(usedMin / maxMinPerMaster * 100)) : 0;
    // Вільні слоти сьогодні
    const sched = db.prepare(
      "SELECT work_start, work_end FROM master_schedule WHERE master_id=? AND weekday=?"
    ).get(m.id, dt.getDay() === 0 ? 0 : dt.getDay());
    m.free_today_h = sched ? Math.round((sched.work_end - sched.work_start) / 60 * 10) / 10 : 0;
  });

  // --- 3. Послуги ---
  const services = db.prepare(
    `SELECT s.name, COUNT(a.id) bookings,
            SUM(CASE WHEN a.status='completed' THEN a.price ELSE 0 END) revenue,
            AVG(CASE WHEN a.status='completed' THEN a.price ELSE NULL END) avg_price
       FROM services s
       LEFT JOIN appointments a ON a.service_id=s.id AND a.date>=?
      WHERE s.active=1
      GROUP BY s.id ORDER BY bookings DESC`
  ).all(mStart);

  // --- 4. Клієнти ---
  const clientStats = db.prepare(
    `SELECT
       COUNT(*) total,
       SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) new_month,
       SUM(CASE WHEN visit_count>1 THEN 1 ELSE 0 END) returning_total
     FROM clients`
  ).get(new Date(mStart + "T00:00:00").getTime());

  const topClients = db.prepare(
    `SELECT name, phone, visit_count, last_visit_at FROM clients ORDER BY visit_count DESC LIMIT 5`
  ).all();

  const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000;
  const inactiveClients = db.prepare(
    `SELECT name, phone, visit_count, last_visit_at FROM clients
      WHERE last_visit_at < ? AND last_visit_at IS NOT NULL ORDER BY last_visit_at ASC LIMIT 10`
  ).all(thirtyDaysAgo);

  // --- 5. Фінанси ---
  function revenue(from, to) {
    return db.prepare(
      `SELECT COALESCE(SUM(price),0) s FROM appointments WHERE status='completed' AND date>=? AND date<=?`
    ).get(from, to).s;
  }
  function forecast(from, to) {
    return db.prepare(
      `SELECT COALESCE(SUM(price),0) s FROM appointments WHERE status IN ('pending','confirmed') AND date>=? AND date<=?`
    ).get(from, to).s;
  }
  const avgCheck = db.prepare(
    `SELECT AVG(price) v FROM appointments WHERE status='completed' AND date>=?`
  ).get(mStart).v || 0;

  res.json({
    ok: true,
    appointments: { today: apptToday, week: apptWeek, month: apptMonth, upcoming_today: upcomingToday },
    masters: masters,
    services: services,
    clients: Object.assign({}, clientStats, { top: topClients, inactive: inactiveClients }),
    finance: {
      today:  { actual: revenue(today, today),  forecast: forecast(today, today) },
      week:   { actual: revenue(wStart, today),  forecast: forecast(wStart, today) },
      month:  { actual: revenue(mStart, today),  forecast: forecast(mStart, today) },
      by_master: db.prepare(
        `SELECT m.name, SUM(a.price) revenue FROM appointments a JOIN masters m ON m.id=a.master_id
          WHERE a.status='completed' AND a.date>=? GROUP BY a.master_id ORDER BY revenue DESC`
      ).all(mStart),
      by_service: db.prepare(
        `SELECT s.name, COUNT(*) cnt, SUM(a.price) revenue FROM appointments a JOIN services s ON s.id=a.service_id
          WHERE a.status='completed' AND a.date>=? GROUP BY a.service_id ORDER BY revenue DESC LIMIT 8`
      ).all(mStart),
      avg_check: Math.round(avgCheck),
    },
  });
});

/* ---- Розширена аналітика для дашборду ---- */
router.get("/dashboard/analytics", owner, function (req, res) {
  const now = tz.nowKyiv();
  const today = now.date;
  const dt = new Date(today + "T00:00:00");
  const dow = dt.getDay() === 0 ? 6 : dt.getDay() - 1;
  const weekStart = new Date(dt); weekStart.setDate(dt.getDate() - dow);
  const wStart = weekStart.toISOString().slice(0, 10);
  const mStart = today.slice(0, 7) + "-01";

  // Дохід по днях за останні 30 днів
  const thirtyAgo = new Date(dt); thirtyAgo.setDate(dt.getDate() - 29);
  const thirtyStart = thirtyAgo.toISOString().slice(0, 10);
  const revenueByDay = db.prepare(
    `SELECT date, SUM(price) revenue FROM appointments
      WHERE status='completed' AND date>=? AND date<=? GROUP BY date ORDER BY date`
  ).all(thirtyStart, today);

  // Завантаженість по годинах (кількість записів у кожній годині)
  const byHour = db.prepare(
    `SELECT (start_min/60) hour, COUNT(*) cnt FROM appointments
      WHERE status IN ('completed','confirmed','pending') AND date>=?
      GROUP BY hour ORDER BY hour`
  ).all(mStart);

  // Топ послуг місяця
  const topServices = db.prepare(
    `SELECT s.name, COUNT(*) cnt, SUM(a.price) revenue
       FROM appointments a JOIN services s ON s.id=a.service_id
      WHERE a.status='completed' AND a.date>=?
      GROUP BY a.service_id ORDER BY revenue DESC LIMIT 8`
  ).all(mStart);

  // Лояльність до майстра (клієнти що повернулися до ТОГО Ж майстра)
  const masters = db.prepare("SELECT id, name FROM masters WHERE active=1").all();
  const masterLoyalty = masters.map(function(m) {
    const total = db.prepare(
      `SELECT COUNT(DISTINCT client_id) n FROM appointments WHERE master_id=? AND status='completed'`
    ).get(m.id).n;
    const returning = db.prepare(
      `SELECT COUNT(*) n FROM (
         SELECT client_id FROM appointments
          WHERE master_id=? AND status='completed'
          GROUP BY client_id HAVING COUNT(*)>1
       )`
    ).get(m.id).n;
    return { id: m.id, name: m.name, total_clients: total, returning: returning,
             loyalty_pct: total > 0 ? Math.round(returning / total * 100) : 0 };
  });

  // Середній чек по місяцях (останні 6 місяців)
  const avgByMonth = db.prepare(
    `SELECT substr(date,1,7) month, AVG(price) avg_check, SUM(price) revenue, COUNT(*) cnt
       FROM appointments WHERE status='completed' AND date>=date('now','-6 months')
       GROUP BY month ORDER BY month`
  ).all();

  // Відгуки
  const reviews = db.prepare(
    `SELECT r.*, c.name client_name, m.name master_name
       FROM reviews r JOIN clients c ON c.id=r.client_id JOIN masters m ON m.id=r.master_id
      ORDER BY r.created_at DESC LIMIT 20`
  ).all();
  const avgRating = db.prepare("SELECT AVG(rating) v FROM reviews").get().v || 0;

  res.json({
    ok: true,
    revenue_by_day: revenueByDay,
    by_hour: byHour,
    top_services: topServices,
    master_loyalty: masterLoyalty,
    avg_by_month: avgByMonth,
    reviews: reviews,
    avg_rating: Math.round(avgRating * 10) / 10,
  });
});

/* ---- Аналітика трафіку сайту ---- */
router.get("/analytics/visits", owner, function (req, res) {
  const now = Date.now();
  const dayMs  = 86400000;
  const t30    = now - 30 * dayMs;
  const t7     = now - 7  * dayMs;
  const t1     = now - 1  * dayMs;

  // Відвідування по днях (30 днів)
  const visitsByDay = db.prepare(`
    SELECT substr(datetime(created_at/1000,'unixepoch','localtime'),1,10) day,
           COUNT(*) total,
           COUNT(DISTINCT ip_hash) uniq
    FROM page_visits WHERE event='pageview' AND created_at>=?
    GROUP BY day ORDER BY day
  `).all(t30);

  // KPI
  const kToday = db.prepare("SELECT COUNT(*) n, COUNT(DISTINCT ip_hash) u FROM page_visits WHERE event='pageview' AND created_at>=?").get(t1);
  const kWeek  = db.prepare("SELECT COUNT(*) n, COUNT(DISTINCT ip_hash) u FROM page_visits WHERE event='pageview' AND created_at>=?").get(t7);
  const kMonth = db.prepare("SELECT COUNT(*) n, COUNT(DISTINCT ip_hash) u FROM page_visits WHERE event='pageview' AND created_at>=?").get(t30);

  // Топ сторінок
  const topPages = db.prepare(`
    SELECT path, COUNT(*) total, COUNT(DISTINCT ip_hash) uniq
    FROM page_visits WHERE event='pageview' AND created_at>=?
    GROUP BY path ORDER BY total DESC LIMIT 10
  `).all(t30);

  // Пристрої
  const devices = db.prepare(`
    SELECT ua_type, COUNT(*) n FROM page_visits WHERE event='pageview' AND created_at>=? GROUP BY ua_type
  `).all(t30);

  // Джерела трафіку (referrer domain)
  const sources = db.prepare(`
    SELECT COALESCE(utm_source,
      CASE WHEN referrer IS NULL OR referrer='' THEN 'direct'
           WHEN referrer LIKE '%google%' THEN 'google'
           WHEN referrer LIKE '%instagram%' THEN 'instagram'
           WHEN referrer LIKE '%facebook%' OR referrer LIKE '%fb.com%' THEN 'facebook'
           WHEN referrer LIKE '%telegram%' THEN 'telegram'
           ELSE 'other' END
    ) src, COUNT(*) n
    FROM page_visits WHERE event='pageview' AND created_at>=?
    GROUP BY src ORDER BY n DESC LIMIT 8
  `).all(t30);

  // Кліки (кнопки/посилання)
  const clicks = db.prepare(`
    SELECT label, COUNT(*) n
    FROM page_visits WHERE event='click' AND created_at>=?
    GROUP BY label ORDER BY n DESC LIMIT 10
  `).all(t30);

  // Години активності
  const byHour = db.prepare(`
    SELECT CAST(strftime('%H', datetime(created_at/1000,'unixepoch','localtime')) AS INTEGER) hour,
           COUNT(*) n
    FROM page_visits WHERE event='pageview' AND created_at>=?
    GROUP BY hour ORDER BY hour
  `).all(t7);

  res.json({
    ok: true,
    kpi: { today: kToday, week: kWeek, month: kMonth },
    visits_by_day: visitsByDay,
    top_pages: topPages,
    devices: devices,
    sources: sources,
    clicks: clicks,
    by_hour: byHour,
  });
});

/* ---- Відгуки ---- */
router.get("/reviews", owner, function (req, res) {
  const rows = db.prepare(
    `SELECT r.*, c.name client_name, m.name master_name
       FROM reviews r JOIN clients c ON c.id=r.client_id JOIN masters m ON m.id=r.master_id
      ORDER BY r.created_at DESC LIMIT 100`
  ).all();
  res.json({ ok: true, reviews: rows });
});

/* ---- Журнал сповіщень ---- */
router.get("/notifications", owner, function (req, res) {
  const appt = parseInt(req.query.appointment, 10);
  let rows;
  if (appt) {
    rows = db.prepare("SELECT * FROM notifications WHERE appointment_id=? ORDER BY id DESC").all(appt);
  } else {
    rows = db.prepare(
      `SELECT n.*, c.name client_name FROM notifications n
         JOIN appointments a ON a.id=n.appointment_id JOIN clients c ON c.id=a.client_id
        ORDER BY n.id DESC LIMIT 100`
    ).all();
  }
  res.json({ ok: true, notifications: rows });
});

module.exports = router;
