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

/* Перевірити, чи сесія має право бачити телефони клієнтів */
function canSeePhones(session) {
  if (!session) return false;
  if (session.role === "owner") return true;
  if (!session.masterId) return false;
  const m = db.prepare("SELECT can_see_phones FROM masters WHERE id=?").get(session.masterId);
  return !!(m && m.can_see_phones);
}
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
  if (!a) return a;
  const out = Object.assign({}, a, { time: tz.fmtMin(a.start_min), end_time: tz.fmtMin(a.end_min) });
  // Абонемент клієнта за цією послугою (для позначки «по абонементу» + лічильника в календарі)
  try {
    const sub = db.prepare(
      "SELECT used_sessions, total_sessions, created_at FROM subscriptions WHERE client_id=? AND service_id=? ORDER BY (used_sessions < total_sessions) DESC, id DESC LIMIT 1"
    ).get(a.client_id, a.service_id);
    if (sub) {
      out.sub_used = sub.used_sessions;
      out.sub_total = sub.total_sessions;
      /* Порядковий номер саме цього візиту в абонементі. Сам used_sessions
         росте лише коли запис позначають «виконано», тому на картках усіх
         майбутніх візитів світилося б однакове число — виглядало як «не
         рахується». Рахуємо позицію запису серед візитів клієнта за цією
         послугою, починаючи з дня купівлі абонемента (минулі візити до
         покупки не враховуємо). */
      const subDate = tz.nowKyiv(undefined, sub.created_at).date;
      out.sub_index = db.prepare(
        `SELECT COUNT(*) c FROM appointments
          WHERE client_id=? AND service_id=? AND status<>'cancelled' AND date>=?
            AND (date < ? OR (date = ? AND start_min <= ?))`
      ).get(a.client_id, a.service_id, subDate, a.date, a.date, a.start_min).c;
    }
  } catch (e) { /* абонементів може не бути */ }
  return out;
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
  const colorMarker = clean(d.color_marker, 20) || null;

  // майстер може створювати лише собі
  if (session.role !== "owner") masterId = session.masterId;

  if (!serviceId || !masterId || !tz.isDate(date) || !(startMin >= 0) || !name || phone.length < 7) {
    return { status: 400, body: { ok: false, error: "missing fields" } };
  }
  const svc = db.prepare("SELECT duration_min, price FROM services WHERE id=? AND active=1").get(serviceId);
  if (!svc) return { status: 404, body: { ok: false, error: "service not found" } };
  const m = db.prepare("SELECT id FROM masters WHERE id=? AND active=1").get(masterId);
  if (!m) return { status: 404, body: { ok: false, error: "master not found" } };

  // Додаткові послуги: [{id, name, duration_min, price}]
  let extraServices = null;
  let totalDuration = svc.duration_min;
  let totalPrice = svc.price;
  try {
    const extras = d.extra_services ? JSON.parse(d.extra_services) : null;
    if (Array.isArray(extras) && extras.length) {
      extraServices = JSON.stringify(extras);
      extras.forEach(function(ex) {
        totalDuration += (parseInt(ex.duration_min, 10) || 0);
        totalPrice    += (parseInt(ex.price, 10) || 0);
      });
    }
  } catch(e) { /* ignore bad JSON */ }

  const now = Date.now();
  let publicId, appointmentId;
  try {
    db.transaction(function () {
      let client = db.prepare("SELECT id FROM clients WHERE phone=?").get(phone);
      if (!client) {
        const info = db.prepare("INSERT INTO clients (phone,name,visit_count,created_at) VALUES (?,?,0,?)").run(phone, name, now);
        client = { id: info.lastInsertRowid };
      } else {
        db.prepare("UPDATE clients SET name=COALESCE(NULLIF(?,''),name) WHERE id=?").run(name, client.id);
      }
      publicId = crypto.randomBytes(8).toString("hex");
      const info = db.prepare(
        `INSERT INTO appointments (public_id,client_id,master_id,service_id,date,start_min,end_min,duration_min,price,status,source,comment,color_marker,extra_services,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?, 'confirmed','staff',?,?,?,?,?)`
      ).run(publicId, client.id, masterId, serviceId, date, startMin, startMin + totalDuration, totalDuration, totalPrice, comment, colorMarker, extraServices, now, now);
      appointmentId = info.lastInsertRowid;
    })();
  } catch (e) {
    if (e.code === "SLOT_TAKEN") return { status: 409, body: { ok: false, error: "SLOT_TAKEN" } };
    return { status: 500, body: { ok: false, error: e.message } };
  }
  // Сповіщення адміну в Telegram + PWA push
  try {
    const adminNotify = require("./admin-notify");
    adminNotify.notifyNewAppt(appointmentId, "crm");
  } catch (e) { console.error("[routes.crm] adminNotify error:", e.message); }

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
  if (status === "confirmed") {
    /* SMS клієнту «Ваш запис … підтверджений» — саме в момент, коли майстер
       підтвердив запис у CRM (а не при створенні онлайн-запису).
       UNIQUE(appointment_id, kind) робить це ідемпотентним: повторне
       підтвердження того ж запису другу SMS не надішле. */
    try {
      const notify = require("./notify");
      const q = notify.queueNotification(id, "confirmation");
      if (q && q.ok && !q.duplicate) {
        setImmediate(function () {
          notify.flushQueued().catch(function (e) { console.error("[confirm] flush:", e.message); });
        });
      }
    } catch (e) { console.error("[confirm] queue:", e.message); }
  }
  if (status === "completed") {
    // Автоматично списуємо сеанс абонементу (якщо ще не списали)
    const full = db.prepare("SELECT client_id, service_id, subscription_used FROM appointments WHERE id=?").get(id);
    if (full && !full.subscription_used && full.client_id && full.service_id) {
      const sub = db.prepare(
        "SELECT id, used_sessions, total_sessions FROM subscriptions WHERE client_id=? AND service_id=? AND used_sessions < total_sessions ORDER BY id LIMIT 1"
      ).get(full.client_id, full.service_id);
      if (sub) {
        db.prepare("UPDATE subscriptions SET used_sessions=used_sessions+1 WHERE id=?").run(sub.id);
        db.prepare("UPDATE appointments SET subscription_used=1 WHERE id=?").run(id);
      }
    }
    try {
      const notify = require("./notify");
      notify.queueNotification(id, "review_request");
    } catch(e) { /* review_request — необов'язково */ }
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
  const showPhone = canSeePhones(s);
  res.json({ ok: true, appointments: stmt.all.apply(stmt, args).map(function(a) {
    if (!showPhone) a = Object.assign({}, a, { client_phone: null });
    return viewAppt(a);
  }) });
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
  const showPhone = canSeePhones(s);
  if (!showPhone) rows = rows.map(function(c) { return Object.assign({}, c, { phone: null }); });
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

  if (date !== a.date || startMin !== a.start_min || masterId !== a.master_id) {
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

router.patch("/appointments/:id/color-marker", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const a = db.prepare("SELECT id, master_id FROM appointments WHERE id=?").get(id);
  if (!a) return res.status(404).json({ ok: false });
  if (req.session.role !== "owner" && a.master_id !== req.session.masterId)
    return res.status(403).json({ ok: false });
  const color = clean((req.body || {}).color_marker, 20) || null;
  db.prepare("UPDATE appointments SET color_marker=?, updated_at=? WHERE id=?").run(color, Date.now(), id);
  res.json({ ok: true });
});

/* ============================================================
   ВЛАСНИК: записи (усі), майстри, послуги, клієнти, користувачі
   ============================================================ */
router.get("/appointments/month-counts", any, function (req, res) {
  const ym = clean(req.query.month, 7); // "2026-07"
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ ok: false });
  const from = ym + "-01", to = ym + "-31";
  const rows = req.session.role === "owner"
    ? db.prepare("SELECT date, COUNT(*) n FROM appointments WHERE date>=? AND date<=? AND status NOT IN ('cancelled') GROUP BY date").all(from, to)
    : db.prepare("SELECT date, COUNT(*) n FROM appointments WHERE date>=? AND date<=? AND status NOT IN ('cancelled') AND master_id=? GROUP BY date").all(from, to, req.session.masterId);
  const counts = {};
  rows.forEach(function(r) { counts[r.date] = r.n; });
  res.json({ ok: true, counts: counts });
});

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

/* ---- Розклад (для майстрів — загальний вигляд) ---- */
router.get("/schedule", any, function (req, res) {
  const date = clean(req.query.date, 10) || new Date().toISOString().slice(0, 10);
  const sql = "SELECT a.id, a.date, a.start_min, a.end_min, a.duration_min, a.status, a.master_id, a.service_id, a.price, a.paid, a.color_marker, a.comment, " +
              "c.name client_name, c.phone client_phone, s.name service_name, m.name master_name, " +
              "r.rating review_rating, r.comment review_comment " +
              "FROM appointments a JOIN clients c ON c.id=a.client_id JOIN services s ON s.id=a.service_id JOIN masters m ON m.id=a.master_id " +
              "LEFT JOIN reviews r ON r.appointment_id=a.id " +
              "WHERE a.date=? AND a.status NOT IN ('cancelled','no_show') ORDER BY a.start_min";
  const showPhone = canSeePhones(req.session);
  res.json({ ok: true, appointments: db.prepare(sql).all(date).map(function(a) {
    if (!showPhone) a = Object.assign({}, a, { client_phone: null });
    return viewAppt(a);
  }) });
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
  const level = clean(d.level, 50) || 'Майстер';
  const info = db.prepare("INSERT INTO masters (name,last_name,phone,color,active,sort_order,created_at,photo,level,mono_link) VALUES (?,?,?,?,1,?,?,?,?,?)")
    .run(name, clean(d.last_name, 100) || null, clean(d.phone, 30), clean(d.color, 20), parseInt(d.sort_order, 10) || 0, Date.now(),
      clean(d.photo, 500) || null, level, clean(d.mono_link, 500) || null);
  autoAssignServicesByLevel(info.lastInsertRowid, level);
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.put("/masters/:id", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const m = db.prepare("SELECT * FROM masters WHERE id=?").get(id);
  if (!m) return res.status(404).json({ ok: false });
  const d = req.body || {};
  db.prepare("UPDATE masters SET name=?, last_name=?, phone=?, color=?, sort_order=?, photo=?, level=?, mono_link=?, can_see_phones=? WHERE id=?").run(
    d.name           !== undefined ? clean(d.name, 100)      : m.name,
    d.last_name      !== undefined ? clean(d.last_name, 100) : m.last_name,
    d.phone          !== undefined ? clean(d.phone, 30)      : m.phone,
    d.color          !== undefined ? clean(d.color, 20)      : m.color,
    d.sort_order     !== undefined ? parseInt(d.sort_order, 10) || 0 : m.sort_order,
    d.photo          !== undefined ? clean(d.photo, 500)     : m.photo,
    d.level          !== undefined ? clean(d.level, 50)      : m.level,
    d.mono_link      !== undefined ? clean(d.mono_link, 500) : m.mono_link,
    d.can_see_phones !== undefined ? (d.can_see_phones ? 1 : 0) : (m.can_see_phones || 0),
    id
  );
  // Посада визначає прайс — міняється рівень, перерахувати список послуг.
  if (d.level !== undefined && clean(d.level, 50) !== m.level) autoAssignServicesByLevel(id, clean(d.level, 50));
  if (Array.isArray(d.service_ids)) setMasterServices(id, d.service_ids);
  res.json({ ok: true });
});
router.delete("/masters/:id", owner, function (req, res) {
  db.prepare("UPDATE masters SET active=0 WHERE id=?").run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

/* ========== ФІЛІЇ ========== */
router.get("/branches", any, function (req, res) {
  const rows = db.prepare("SELECT * FROM branches WHERE active=1 ORDER BY sort_order,id").all();
  rows.forEach(function (b) {
    b.schedule = db.prepare("SELECT weekday,work_start,work_end FROM branch_schedule WHERE branch_id=? ORDER BY weekday").all(b.id);
    b.masters  = db.prepare("SELECT id,name,last_name,photo,level FROM masters WHERE branch_id=? AND active=1").all(b.id);
  });
  res.json({ ok: true, branches: rows });
});

router.post("/branches", owner, function (req, res) {
  const d = req.body || {};
  const name = (d.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ ok: false, error: "name required" });
  const info = db.prepare("INSERT INTO branches (name,photo,active,sort_order,created_at) VALUES (?,?,1,?,?)")
    .run(name, d.photo ? d.photo.slice(0, 500) : null, parseInt(d.sort_order, 10) || 0, Date.now());
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put("/branches/:id", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const b = db.prepare("SELECT * FROM branches WHERE id=?").get(id);
  if (!b) return res.status(404).json({ ok: false });
  const d = req.body || {};
  db.prepare("UPDATE branches SET name=?,photo=?,sort_order=? WHERE id=?")
    .run(d.name !== undefined ? d.name.slice(0, 100) : b.name,
         d.photo !== undefined ? (d.photo ? d.photo.slice(0, 500) : null) : b.photo,
         d.sort_order !== undefined ? parseInt(d.sort_order, 10) || 0 : b.sort_order, id);
  // Оновити список майстрів філії
  if (Array.isArray(d.master_ids)) {
    db.prepare("UPDATE masters SET branch_id=NULL WHERE branch_id=?").run(id);
    const stmt = db.prepare("UPDATE masters SET branch_id=? WHERE id=?");
    d.master_ids.forEach(function (mid) { stmt.run(id, parseInt(mid, 10)); });
  }
  res.json({ ok: true });
});

router.delete("/branches/:id", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  db.prepare("UPDATE masters SET branch_id=NULL WHERE branch_id=?").run(id);
  db.prepare("UPDATE branches SET active=0 WHERE id=?").run(id);
  res.json({ ok: true });
});

router.get("/branches/:id/schedule", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  res.json({ ok: true, schedule: db.prepare("SELECT weekday,work_start,work_end FROM branch_schedule WHERE branch_id=? ORDER BY weekday").all(id) });
});

router.put("/branches/:id/schedule", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const sched = (req.body && req.body.schedule) || [];
  db.transaction(function () {
    db.prepare("DELETE FROM branch_schedule WHERE branch_id=?").run(id);
    const ins = db.prepare("INSERT INTO branch_schedule (branch_id,weekday,work_start,work_end) VALUES (?,?,?,?)");
    sched.forEach(function (s) {
      if (s.weekday != null && s.work_start != null && s.work_end != null)
        ins.run(id, parseInt(s.weekday,10), parseInt(s.work_start,10), parseInt(s.work_end,10));
    });
  })();
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

/* Прайс визначається посадою: майстер отримує всі послуги з позначкою
   "(Майстер)" у назві, топ-майстер — з "(Топ Майстер)", а спільні послуги
   без позначки рівня (SPA-ритуали, обгортання тощо) йдуть усім однаково.
   Викликається при створенні майстра і при зміні його посади — вручну
   послуги більше не обираються. */
function autoAssignServicesByLevel(masterId, level) {
  const isTop = level === "Топ Майстер";
  const tagged = db.prepare(
    "SELECT id FROM services WHERE active=1 AND name LIKE ?" + (isTop ? "" : " AND name NOT LIKE '%(Топ Майстер)%'")
  ).all(isTop ? "%(Топ Майстер)%" : "%(Майстер)%");
  const shared = db.prepare(
    "SELECT id FROM services WHERE active=1 AND name NOT LIKE '%(Майстер)%' AND name NOT LIKE '%(Топ Майстер)%'"
  ).all();
  setMasterServices(masterId, tagged.concat(shared).map(function (r) { return r.id; }));
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
/* Всі графіки+перерви для конкретного дня тижня — одним запитом (для календаря) */
router.get("/day-schedules", any, function (req, res) {
  const wd = parseInt(req.query.weekday, 10);
  if (isNaN(wd) || wd < 0 || wd > 6) return res.status(400).json({ ok: false });
  const schedules = db.prepare(
    "SELECT ms.master_id, ms.work_start, ms.work_end FROM master_schedule ms JOIN masters m ON m.id=ms.master_id WHERE ms.weekday=? AND m.active=1"
  ).all(wd);
  const breaks = db.prepare(
    "SELECT mb.master_id, mb.break_start, mb.break_end FROM master_breaks mb JOIN masters m ON m.id=mb.master_id WHERE mb.weekday=? AND m.active=1"
  ).all(wd);
  res.json({ ok: true, schedules, breaks });
});

/* ---- Денні override-и графіку (per-date) ---- */
router.get("/masters/:id/day-override", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const date = req.query.date;
  if (!tz.isDate(date)) return res.status(400).json({ ok: false, error: "bad date" });
  const override = db.prepare("SELECT * FROM master_day_overrides WHERE master_id=? AND date=?").get(id, date);
  const d = new Date(date + "T00:00:00");
  const weekday = d.getDay(); // 0=Sun..6=Sat
  const weekly = db.prepare("SELECT work_start, work_end FROM master_schedule WHERE master_id=? AND weekday=?").get(id, weekday);
  res.json({ ok: true, override: override || null, weekly: weekly || null });
});

router.put("/masters/:id/day-override", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  const date = b.date;
  if (!tz.isDate(date)) return res.status(400).json({ ok: false, error: "bad date" });
  const isOff = b.is_off ? 1 : 0;
  const ws = (!isOff && b.work_start != null) ? parseInt(b.work_start, 10) : null;
  const we = (!isOff && b.work_end   != null) ? parseInt(b.work_end,   10) : null;
  db.prepare("INSERT OR REPLACE INTO master_day_overrides (master_id,date,is_off,work_start,work_end) VALUES (?,?,?,?,?)")
    .run(id, date, isOff, ws, we);
  res.json({ ok: true });
});

router.delete("/masters/:id/day-override", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const date = req.query.date;
  if (!tz.isDate(date)) return res.status(400).json({ ok: false, error: "bad date" });
  db.prepare("DELETE FROM master_day_overrides WHERE master_id=? AND date=?").run(id, date);
  res.json({ ok: true });
});

/* Всі overrides усіх майстрів у діапазоні дат (для таблиці графіку) */
router.get("/masters-overrides", any, function (req, res) {
  const from = (req.query.from || "").slice(0, 10);
  const to   = (req.query.to   || "").slice(0, 10);
  if (!tz.isDate(from) || !tz.isDate(to)) return res.status(400).json({ ok: false, error: "bad dates" });
  const overrides = db.prepare(
    "SELECT master_id, date, is_off, work_start, work_end FROM master_day_overrides WHERE date >= ? AND date <= ? ORDER BY master_id, date"
  ).all(from, to);
  res.json({ ok: true, overrides });
});

/* bulk: POST {date_from,date_to,mode,weekdays[],work_start,work_end} */
router.post("/masters/:id/schedule-period", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  const { date_from, date_to, mode } = b;
  const weekdays = Array.isArray(b.weekdays) ? b.weekdays.map(Number) : [];
  const work_start = parseInt(b.work_start, 10);
  const work_end   = parseInt(b.work_end,   10);
  if (!tz.isDate(date_from) || !tz.isDate(date_to)) return res.status(400).json({ ok: false, error: "bad dates" });
  const upsert = db.prepare("INSERT OR REPLACE INTO master_day_overrides (master_id,date,is_off,work_start,work_end) VALUES (?,?,?,?,?)");
  const del    = db.prepare("DELETE FROM master_day_overrides WHERE master_id=? AND date=?");
  db.transaction(function () {
    const end = new Date(date_to + "T00:00:00");
    for (let d = new Date(date_from + "T00:00:00"); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      const jsDay = d.getDay();
      if (mode === "reset")       { del.run(id, ds); }
      else if (mode === "day_off"){ upsert.run(id, ds, 1, null, null); }
      else if (mode === "by_weekday" && weekdays.indexOf(jsDay) !== -1) { upsert.run(id, ds, 0, work_start, work_end); }
      else if (mode === "all_days") { upsert.run(id, ds, 0, work_start, work_end); }
    }
  })();
  res.json({ ok: true });
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
router.get("/clients", any, function (req, res) {
  const q = clean(req.query.q, 60);
  let rows;
  if (q) {
    const like = "%" + q + "%";
    rows = db.prepare("SELECT * FROM clients WHERE name LIKE ? OR phone LIKE ? ORDER BY last_visit_at DESC NULLS LAST LIMIT 200").all(like, like);
  } else {
    rows = db.prepare("SELECT * FROM clients ORDER BY last_visit_at DESC NULLS LAST, id DESC LIMIT 200").all();
  }
  const showPhone = canSeePhones(req.session);
  if (!showPhone) rows = rows.map(function(c) { return Object.assign({}, c, { phone: null }); });
  res.json({ ok: true, clients: rows });
});
/* Чи належить номер уже наявному клієнту. Порівнюємо нормалізовані
   номери, бо в базі трапляються обидва формати (0XX… і +380XX…), а
   createAppointment шукає за нормалізованим — саме так і зникає
   «новий» клієнт: запис тихо чіпляється до старої картки. */
router.get("/clients/by-phone", any, function (req, res) {
  const norm = tz.normPhone(clean(req.query.phone, 30));
  if (!norm || norm.length < 8) return res.json({ ok: true, client: null });
  const rows = db.prepare("SELECT id, name, phone FROM clients").all();
  const hit = rows.find(function (c) { return tz.normPhone(c.phone) === norm; });
  res.json({ ok: true, client: hit ? { id: hit.id, name: hit.name } : null });
});

router.get("/clients/:id", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  let client = db.prepare("SELECT * FROM clients WHERE id=?").get(id);
  if (!client) return res.status(404).json({ ok: false });
  const history = db.prepare(
    `SELECT a.id, a.date, a.start_min, a.status, a.service_id, a.master_id,
            s.name service_name, m.name master_name
       FROM appointments a JOIN services s ON s.id=a.service_id JOIN masters m ON m.id=a.master_id
      WHERE a.client_id=? ORDER BY a.date DESC, a.start_min DESC`
  ).all(id).map(viewAppt);
  if (!canSeePhones(req.session)) client = Object.assign({}, client, { phone: null });
  res.json({ ok: true, client: client, history: history });
});
router.patch("/clients/:id", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const d = req.body || {};
  const c = db.prepare("SELECT * FROM clients WHERE id=?").get(id);
  if (!c) return res.status(404).json({ ok: false });
  db.prepare("UPDATE clients SET name=?, phone=?, note=?, blacklisted=? WHERE id=?").run(
    d.name        !== undefined ? clean(d.name,  100)  : c.name,
    d.phone       !== undefined ? clean(d.phone,  30)  : c.phone,
    d.note        !== undefined ? clean(d.note, 1000)  : c.note,
    d.blacklisted !== undefined ? (d.blacklisted ? 1 : 0) : (c.blacklisted || 0),
    id
  );
  res.json({ ok: true });
});

router.delete("/clients/:id", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const c = db.prepare("SELECT id FROM clients WHERE id=?").get(id);
  if (!c) return res.status(404).json({ ok: false });
  db.prepare("DELETE FROM appointments WHERE client_id=?").run(id);
  db.prepare("DELETE FROM clients WHERE id=?").run(id);
  res.json({ ok: true });
});

/* ---- Імпорт клієнтів (bulk, owner only) ---- */
router.post("/clients/import", owner, function (req, res) {
  const rows = Array.isArray(req.body) ? req.body : (req.body && Array.isArray(req.body.clients) ? req.body.clients : []);
  if (!rows.length) return res.status(400).json({ ok: false, error: "empty" });
  const ins = db.prepare("INSERT OR IGNORE INTO clients (phone, name, note, visit_count, last_visit_at, created_at) VALUES (?,?,?,?,?,?)");
  const txn = db.transaction(function () {
    let inserted = 0;
    rows.forEach(function (r) {
      const phone = String(r.phone || "").trim();
      const name = String(r.name || "").trim();
      if (!phone || !name) return;
      const result = ins.run(phone, name, r.note || null, r.visit_count || 0, r.last_visit_at || null, r.created_at || Date.now());
      if (result.changes) inserted++;
    });
    return inserted;
  });
  const inserted = txn();
  res.json({ ok: true, inserted, total: rows.length });
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

  // --- 2. Майстри ---
  /* Записи — за той самий період, що й картка «1. Записи»: з початку
     місяця по сьогодні включно, без скасованих. Інакше числа майстрів
     не сходяться з підсумком по записах. */
  const masters = db.prepare(
    `SELECT m.id, m.name, m.photo, m.level,
            COUNT(a.id) bookings,
            SUM(CASE WHEN a.status='completed' THEN a.price ELSE 0 END) revenue
       FROM masters m
       LEFT JOIN appointments a ON a.master_id=m.id
                               AND a.date>=? AND a.date<=?
                               AND a.status<>'cancelled'
      WHERE m.active=1
      GROUP BY m.id ORDER BY bookings DESC`
  ).all(mStart, today);

  /* Ємність рахуємо з реального графіка майстра (master_schedule) за
     дні, що вже минули цього місяця, а не з умовних 12.5 год × 6/7 днів. */
  const elapsedWeekdays = [];   // список weekday для кожного дня з mStart по today
  for (let d = new Date(mStart + "T00:00:00"); d <= dt; d.setDate(d.getDate() + 1)) {
    elapsedWeekdays.push(d.getDay());
  }
  const todayWeekday = dt.getDay();

  masters.forEach(function (m) {
    const sched = db.prepare(
      "SELECT weekday, work_start, work_end FROM master_schedule WHERE master_id=?"
    ).all(m.id);
    const minByWeekday = {};
    sched.forEach(function (s) { minByWeekday[s.weekday] = (s.work_end - s.work_start); });

    const capacityMin = elapsedWeekdays.reduce(function (sum, wd) {
      return sum + (minByWeekday[wd] || 0);
    }, 0);

    const usedMin = db.prepare(
      `SELECT COALESCE(SUM(duration_min),0) s FROM appointments
        WHERE master_id=? AND date>=? AND date<=? AND status IN ('pending','confirmed','completed')`
    ).get(m.id, mStart, today).s;

    m.workload_pct = capacityMin > 0 ? Math.min(100, Math.round(usedMin / capacityMin * 100)) : 0;

    /* Вільно сьогодні = зміна мінус уже зайняте сьогодні.
       Раніше сюди йшла вся довжина зміни, тому в усіх майстрів
       світилось однакове число незалежно від записів. */
    const shiftMin = minByWeekday[todayWeekday] || 0;
    if (!shiftMin) {
      m.free_today_h = null;   // сьогодні не працює
    } else {
      const busyToday = db.prepare(
        `SELECT COALESCE(SUM(duration_min),0) s FROM appointments
          WHERE master_id=? AND date=? AND status IN ('pending','confirmed','completed')`
      ).get(m.id, today).s;
      m.free_today_h = Math.max(0, Math.round((shiftMin - busyToday) / 60 * 10) / 10);
    }
  });

  // --- 3. Клієнти ---
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

  // --- Детальна аналітика (клієнти + якість) ---
  const _now = Date.now();
  const _d30 = _now - 30 * 24 * 3600 * 1000;
  const _d60 = _now - 60 * 24 * 3600 * 1000;
  const _date30 = new Date(_d30).toISOString().slice(0, 10);
  const _date60 = new Date(_d60).toISOString().slice(0, 10);
  // База для відсотків повернень — клієнти, що відвідали хоча б раз
  const baseClients = db.prepare(`SELECT COUNT(*) c FROM clients WHERE visit_count >= 1`).get().c;
  const daNew     = db.prepare(`SELECT COUNT(*) c FROM clients WHERE created_at >= ?`).get(_d30).c;
  const daRetEver = db.prepare(`SELECT COUNT(*) c FROM clients WHERE visit_count > 1`).get().c;
  const daRet30   = db.prepare(`SELECT COUNT(*) c FROM clients WHERE visit_count > 1 AND last_visit_at >= ?`).get(_d30).c;
  const daLost    = db.prepare(`SELECT COUNT(*) c FROM clients WHERE visit_count >= 2 AND last_visit_at IS NOT NULL AND last_visit_at < ?`).get(_d60).c;
  const daRev     = db.prepare(`SELECT AVG(rating) avg, COUNT(*) cnt FROM reviews`).get();
  const daCancels = db.prepare(`SELECT COUNT(*) c FROM appointments WHERE status='cancelled' AND date >= ?`).get(_date30).c;
  const _pct = function (n, base) { return base > 0 ? Math.round((n / base) * 100) : 0; };
  const detailed = {
    new_clients: daNew,
    returned_30d: daRet30, returned_30d_pct: _pct(daRet30, baseClients),
    returned_ever: daRetEver, returned_ever_pct: _pct(daRetEver, baseClients),
    lost: daLost,
    avg_rating: daRev.avg != null ? Math.round(daRev.avg * 100) / 100 : null,
    reviews_count: daRev.cnt || 0,
    cancellations_30d: daCancels,
    base_clients: baseClients,
  };

  /* --- Детальна аналітика в розрізі майстра ---
     Глобальні числа беруться з clients.visit_count / last_visit_at, але це
     «клієнт салону». Для майстра ті самі поняття рахуються тільки за його
     завершеними записами: клієнт може бути повторним у салоні й водночас
     первинним у конкретного майстра. */
  const mcRows = db.prepare(
    `SELECT master_id, client_id, COUNT(*) n, MIN(date) first_date, MAX(date) last_date
       FROM appointments WHERE status='completed' GROUP BY master_id, client_id`
  ).all();
  const mcByMaster = {};
  mcRows.forEach(function (r) {
    const acc = mcByMaster[r.master_id] || (mcByMaster[r.master_id] = {
      base: 0, new_clients: 0, returned_ever: 0, returned_30d: 0, lost: 0,
    });
    acc.base++;
    if (r.first_date >= _date30) acc.new_clients++;
    if (r.n > 1) {
      acc.returned_ever++;
      if (r.last_date >= _date30) acc.returned_30d++;
      if (r.last_date < _date60) acc.lost++;
    }
  });
  const mRevRows = db.prepare(
    `SELECT master_id, AVG(rating) avg, COUNT(*) cnt FROM reviews GROUP BY master_id`
  ).all();
  const mRevByMaster = {};
  mRevRows.forEach(function (r) { mRevByMaster[r.master_id] = r; });
  const mCancelRows = db.prepare(
    `SELECT master_id, COUNT(*) c FROM appointments
      WHERE status='cancelled' AND date >= ? GROUP BY master_id`
  ).all(_date30);
  const mCancelByMaster = {};
  mCancelRows.forEach(function (r) { mCancelByMaster[r.master_id] = r.c; });

  masters.forEach(function (m) {
    const acc = mcByMaster[m.id] || { base: 0, new_clients: 0, returned_ever: 0, returned_30d: 0, lost: 0 };
    const rev = mRevByMaster[m.id];
    m.detailed = {
      new_clients: acc.new_clients,
      returned_30d: acc.returned_30d, returned_30d_pct: _pct(acc.returned_30d, acc.base),
      returned_ever: acc.returned_ever, returned_ever_pct: _pct(acc.returned_ever, acc.base),
      lost: acc.lost,
      avg_rating: rev && rev.avg != null ? Math.round(rev.avg * 100) / 100 : null,
      reviews_count: rev ? rev.cnt : 0,
      cancellations_30d: mCancelByMaster[m.id] || 0,
      base_clients: acc.base,
    };
  });

  res.json({
    ok: true,
    appointments: { today: apptToday, week: apptWeek, month: apptMonth },
    masters: masters,
    detailed: detailed,
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
  const mStart = today.slice(0, 7) + "-01";

  const from = clean(req.query.from, 10) || mStart;
  const to   = clean(req.query.to,   10) || today;

  // ── Статистика за вибраний період ──────────────────────────────
  const periodRevenue = db.prepare(
    `SELECT COALESCE(SUM(price),0) v FROM appointments WHERE status='completed' AND date>=? AND date<=?`
  ).get(from, to).v;

  const periodClients = db.prepare(
    `SELECT COUNT(DISTINCT client_id) v FROM appointments WHERE status='completed' AND date>=? AND date<=?`
  ).get(from, to).v;

  const periodReviews = db.prepare(
    `SELECT COUNT(*) v FROM reviews r
       JOIN appointments a ON a.id=r.appointment_id WHERE a.date>=? AND a.date<=?`
  ).get(from, to).v;

  const totalClients = db.prepare("SELECT COUNT(*) v FROM clients").get().v;

  // Дохід по днях за вибраний період
  const revenueByDay = db.prepare(
    `SELECT date, SUM(price) revenue FROM appointments
      WHERE status='completed' AND date>=? AND date<=? GROUP BY date ORDER BY date`
  ).all(from, to);

  // ── Повернення клієнтів: загальна аналітика (весь час) ─────────
  const clientsReturning = db.prepare("SELECT COUNT(*) v FROM clients WHERE visit_count>1").get().v;
  const clientsOverall = {
    total: totalClients,
    returning: clientsReturning,
    one_time: totalClients - clientsReturning,
    returning_pct: totalClients ? Math.round(clientsReturning / totalClients * 100) : 0,
  };

  const clientsNotReturned = db.prepare(
    `SELECT name, phone, last_visit_at FROM clients
      WHERE visit_count=1 AND last_visit_at IS NOT NULL
      ORDER BY last_visit_at ASC LIMIT 30`
  ).all();

  // ── Клієнти за вибраний період (нові vs повторні) ───────────────
  const periodClientFlags = db.prepare(
    `SELECT a.client_id,
            EXISTS(SELECT 1 FROM appointments a2 WHERE a2.client_id=a.client_id AND a2.status='completed' AND a2.date<?) is_returning
       FROM appointments a WHERE a.status='completed' AND a.date>=? AND a.date<=?
      GROUP BY a.client_id`
  ).all(from, from, to);
  const periodReturning = periodClientFlags.filter(function(r) { return r.is_returning; }).length;
  const clientsPeriod = {
    total: periodClientFlags.length,
    returning: periodReturning,
    new: periodClientFlags.length - periodReturning,
  };

  // ── Лояльність до майстра ────────────────────────────────────────
  const masters = db.prepare("SELECT id, name FROM masters WHERE active=1").all();
  const masterLoyalty = masters.map(function(m) {
    const total = db.prepare(
      `SELECT COUNT(DISTINCT client_id) v FROM appointments WHERE master_id=? AND status='completed'`
    ).get(m.id).v;
    const returning = db.prepare(
      `SELECT COUNT(*) v FROM (
         SELECT client_id FROM appointments
          WHERE master_id=? AND status='completed'
          GROUP BY client_id HAVING COUNT(*)>1
       )`
    ).get(m.id).v;
    return { id: m.id, name: m.name, total_clients: total, returning: returning,
             loyalty_pct: total > 0 ? Math.round(returning / total * 100) : 0 };
  });

  // ── Динаміка по місяцях (останні 6) ─────────────────────────────
  const avgByMonth = db.prepare(
    `SELECT substr(date,1,7) month, AVG(price) avg_check, SUM(price) revenue, COUNT(*) cnt
       FROM appointments WHERE status='completed' AND date>=date('now','-6 months')
       GROUP BY month ORDER BY month`
  ).all();

  // ── Відгуки за вибраний період ───────────────────────────────────
  const reviews = db.prepare(
    `SELECT r.rating, r.comment, r.created_at, c.name client_name, m.name master_name
       FROM reviews r
       JOIN appointments a ON a.id=r.appointment_id
       JOIN clients c ON c.id=r.client_id
       JOIN masters m ON m.id=r.master_id
      WHERE a.date>=? AND a.date<=?
      ORDER BY r.created_at DESC LIMIT 20`
  ).all(from, to);

  res.json({
    ok: true,
    period: { from, to },
    period_revenue:  periodRevenue,
    period_clients:  periodClients,
    period_reviews:  periodReviews,
    total_clients:   totalClients,
    clients_period:  clientsPeriod,
    revenue_by_day:  revenueByDay,
    master_loyalty:  masterLoyalty,
    avg_by_month:    avgByMonth,
    reviews:         reviews,
    clients_overall: clientsOverall,
    clients_not_returned: clientsNotReturned,
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

/* ---- Разові блокування (перерви на конкретну дату) ---- */
router.get("/day-blocks", any, function (req, res) {
  const date = clean(req.query.date, 10);
  if (!date) return res.status(400).json({ ok: false });
  const rows = req.session.role === "owner"
    ? db.prepare("SELECT * FROM day_blocks WHERE date=? ORDER BY master_id, start_min").all(date)
    : db.prepare("SELECT * FROM day_blocks WHERE date=? AND master_id=? ORDER BY start_min").all(date, req.session.masterId);
  res.json({ ok: true, blocks: rows });
});

router.post("/day-blocks", any, function (req, res) {
  const b = req.body || {};
  const masterId = req.session.role === "owner" ? parseInt(b.master_id, 10) : req.session.masterId;
  const date = clean(b.date, 10);
  const startMin = parseInt(b.start_min, 10);
  const endMin   = parseInt(b.end_min,   10);
  if (!masterId || !date || isNaN(startMin) || isNaN(endMin) || endMin <= startMin)
    return res.status(400).json({ ok: false });
  const note = clean(b.note, 200) || null;
  const info = db.prepare(
    "INSERT INTO day_blocks (master_id,date,start_min,end_min,note,created_at) VALUES (?,?,?,?,?,?)"
  ).run(masterId, date, startMin, endMin, note, Date.now());
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.delete("/day-blocks/:id", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const blk = db.prepare("SELECT id, master_id FROM day_blocks WHERE id=?").get(id);
  if (!blk) return res.status(404).json({ ok: false });
  if (req.session.role !== "owner" && blk.master_id !== req.session.masterId)
    return res.status(403).json({ ok: false });
  db.prepare("DELETE FROM day_blocks WHERE id=?").run(id);
  res.json({ ok: true });
});

/* ---- Абонементи ---- */
router.get("/subscriptions", any, function (req, res) {
  const clientId = parseInt(req.query.client_id, 10);
  if (!clientId) return res.status(400).json({ ok: false });
  const rows = db.prepare(
    `SELECT sub.*, s.name service_name, s.duration_min
       FROM subscriptions sub JOIN services s ON s.id=sub.service_id
      WHERE sub.client_id=? ORDER BY sub.created_at DESC`
  ).all(clientId);
  res.json({ ok: true, subscriptions: rows });
});

router.get("/subscriptions/check", any, function (req, res) {
  const clientId  = parseInt(req.query.client_id,  10);
  const serviceId = parseInt(req.query.service_id, 10);
  if (!clientId || !serviceId) return res.json({ ok: true, active: null });
  const row = db.prepare(
    `SELECT sub.*, s.name service_name FROM subscriptions sub JOIN services s ON s.id=sub.service_id
      WHERE sub.client_id=? AND sub.service_id=? AND sub.used_sessions < sub.total_sessions
      ORDER BY sub.created_at ASC LIMIT 1`
  ).get(clientId, serviceId);
  res.json({ ok: true, active: row || null });
});

router.post("/subscriptions", any, function (req, res) {
  const b = req.body || {};
  const clientId  = parseInt(b.client_id,  10);
  const serviceId = parseInt(b.service_id, 10);
  const total     = parseInt(b.total_sessions, 10);
  const price     = parseInt(b.price || 0, 10);
  const note      = clean(b.note, 300) || null;
  if (!clientId || !serviceId || !total || total < 1)
    return res.status(400).json({ ok: false, error: "missing fields" });
  const usedInit = Math.min(parseInt(b.used_sessions || 0, 10) || 0, total);
  const info = db.prepare(
    "INSERT INTO subscriptions (client_id,service_id,total_sessions,used_sessions,price,note,created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(clientId, serviceId, total, usedInit, price, note, Date.now());
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.patch("/subscriptions/:id/use", any, function (req, res) {
  const id  = parseInt(req.params.id, 10);
  const sub = db.prepare("SELECT * FROM subscriptions WHERE id=?").get(id);
  if (!sub) return res.status(404).json({ ok: false });
  if (sub.used_sessions >= sub.total_sessions) return res.status(400).json({ ok: false, error: "exhausted" });
  db.prepare("UPDATE subscriptions SET used_sessions=used_sessions+1 WHERE id=?").run(id);
  res.json({ ok: true, remaining: sub.total_sessions - sub.used_sessions - 1 });
});

router.delete("/subscriptions/:id", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  db.prepare("DELETE FROM subscriptions WHERE id=?").run(id);
  res.json({ ok: true });
});

/* ---- Масові розсилки ---------------------------------------------
   Відправка не миттєва: складаємо чергу, а розсилає планувальник
   порціями (notify.flushBroadcasts). Так довгий список не блокує
   запит і не б'є по провайдеру залпом. */

const BROADCAST_MAX_LEN = 500;

/* Отримувачі: клієнти з телефоном, без відмови від розсилок і не в
   чорному списку. Дублікати за нормалізованим номером прибирає UNIQUE
   у broadcast_messages. */
function broadcastRecipients(all, clientIds) {
  let rows;
  if (all) {
    rows = db.prepare(
      "SELECT id, name, phone FROM clients WHERE phone IS NOT NULL AND phone <> '' AND no_marketing=0 AND blacklisted=0 ORDER BY id"
    ).all();
  } else {
    const ids = (clientIds || []).map(function (x) { return parseInt(x, 10); }).filter(Boolean);
    if (!ids.length) return [];
    rows = db.prepare(
      `SELECT id, name, phone FROM clients
        WHERE id IN (${ids.map(function () { return "?"; }).join(",")})
          AND phone IS NOT NULL AND phone <> '' AND no_marketing=0 AND blacklisted=0`
    ).all(...ids);
  }
  return rows;
}

/* Список для ручного вибору отримувачів. Окремо від GET /clients: там
   LIMIT 200 і сортування за останнім візитом, через що щойно доданий
   клієнт (візитів ще нема, last_visit_at IS NULL) опинявся в кінці й
   не потрапляв у список узагалі. Тут без ліміту й новіші згори. */
router.get("/broadcasts/clients", owner, function (req, res) {
  const rows = db.prepare(
    `SELECT id, name, phone, no_marketing, blacklisted FROM clients ORDER BY id DESC`
  ).all();
  res.json({ ok: true, clients: rows });
});

/* Скільки отримає повідомлення — щоб показати число до відправки.
   Разом із розкладкою, чому решта не потрапила: інакше «457» нічим не
   пояснити й незрозуміло, куди подівся щойно доданий клієнт. */
router.post("/broadcasts/preview", owner, function (req, res) {
  const b = req.body || {};
  const rows = broadcastRecipients(!!b.all, b.client_ids);
  const phones = new Set(rows.map(function (r) { return tz.normPhone(r.phone); }));
  const out = { ok: true, recipients: phones.size, duplicates: rows.length - phones.size };
  if (b.all) {
    const x = db.prepare(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN phone IS NULL OR phone='' THEN 1 ELSE 0 END) no_phone,
              SUM(CASE WHEN blacklisted=1 THEN 1 ELSE 0 END) blacklisted,
              SUM(CASE WHEN no_marketing=1 THEN 1 ELSE 0 END) opted_out
         FROM clients`
    ).get();
    out.total = x.total;
    out.no_phone = x.no_phone || 0;
    out.blacklisted = x.blacklisted || 0;
    out.opted_out = x.opted_out || 0;
    // Останній доданий клієнт — щоб одразу було видно, чи він у розсилці
    const last = db.prepare("SELECT id, name, phone, no_marketing, blacklisted FROM clients ORDER BY id DESC LIMIT 1").get();
    if (last) {
      out.last_client = {
        name: last.name,
        phone: last.phone || "",
        included: !!(last.phone && !last.no_marketing && !last.blacklisted),
      };
    }
  }
  res.json(out);
});

/* Тестова SMS РІВНО на один номер — повз чергу й повз список клієнтів.
   Використовується, щоб перевірити налаштування, нікого більше не зачепивши. */
router.post("/broadcasts/test", owner, function (req, res) {
  const b = req.body || {};
  const phone = tz.normPhone(clean(b.phone, 30));
  const text = clean(b.text, BROADCAST_MAX_LEN) || "Тестове повідомлення від Oliva. Якщо ви це бачите — SMS працює.";
  if (!phone || phone.replace(/\D/g, "").length < 11) {
    return res.json({ ok: false, error: "Некоректний номер (очікується формат 0XX… або +380XX…)" });
  }
  require("./notify").sendDirect(phone, text)
    .then(function () { res.json({ ok: true, phone: phone }); })
    .catch(function (e) { res.json({ ok: false, error: String((e && e.message) || e) }); });
});

router.post("/broadcasts", owner, function (req, res) {
  const b = req.body || {};
  const text = clean(b.text, BROADCAST_MAX_LEN);
  if (!text) return res.status(400).json({ ok: false, error: "empty text" });
  const rows = broadcastRecipients(!!b.all, b.client_ids);
  if (!rows.length) return res.status(400).json({ ok: false, error: "no recipients" });

  const now = Date.now();
  let id, queued = 0;
  db.transaction(function () {
    id = db.prepare("INSERT INTO broadcasts (text,total,created_at) VALUES (?,0,?)").run(text, now).lastInsertRowid;
    const ins = db.prepare(
      "INSERT OR IGNORE INTO broadcast_messages (broadcast_id,client_id,phone,status,created_at) VALUES (?,?,?, 'queued', ?)"
    );
    for (const r of rows) {
      const phone = tz.normPhone(r.phone);
      if (!phone || phone.length < 7) continue;
      if (ins.run(id, r.id, phone, now).changes) queued++;
    }
    db.prepare("UPDATE broadcasts SET total=? WHERE id=?").run(queued, id);
  })();
  res.json({ ok: true, id: id, queued: queued, skipped: rows.length - queued });
  /* Перша порція — одразу, не чекаючи хвилинного тіка планувальника.
     Далі добиває планувальник. Fire-and-forget після відповіді. */
  setImmediate(function () {
    try {
      require("./notify").flushBroadcasts().catch(function (e) {
        console.error("[broadcasts] flush:", e.message);
      });
    } catch (e) { console.error("[broadcasts] flush:", e.message); }
  });
});

/* Історія розсилок зі зведенням по статусах.
   driver — щоб інтерфейс бачив, куди реально йдуть повідомлення:
   console/telegram означає «на телефони клієнтів не піде нічого». */
router.get("/broadcasts", owner, function (req, res) {
  const rows = db.prepare("SELECT * FROM broadcasts ORDER BY id DESC LIMIT 30").all();
  const stat = db.prepare(
    `SELECT status, COUNT(*) c FROM broadcast_messages WHERE broadcast_id=? GROUP BY status`
  );
  const errQ = db.prepare(
    `SELECT error, COUNT(*) c FROM broadcast_messages
      WHERE broadcast_id=? AND error IS NOT NULL GROUP BY error ORDER BY c DESC LIMIT 2`
  );
  rows.forEach(function (b) {
    b.stats = {};
    stat.all(b.id).forEach(function (s) { b.stats[s.status] = s.c; });
    /* Текст помилки від провайдера — без нього «помилка 1» ні про що:
       не видно, чи це токен, чи непогоджений відправник, чи баланс. */
    b.errors = errQ.all(b.id).map(function (e) { return e.error + (e.c > 1 ? " (×" + e.c + ")" : ""); });
  });
  res.json({ ok: true, broadcasts: rows, driver: require("./notify").DRIVER_NAME });
});

/* Повторити невдалі повідомлення розсилки (після виправлення токена,
   відправника чи поповнення балансу). */
router.post("/broadcasts/:id/retry", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const info = db.prepare(
    "UPDATE broadcast_messages SET status='queued', error=NULL WHERE broadcast_id=? AND status='failed'"
  ).run(id);
  res.json({ ok: true, requeued: info.changes });
  if (info.changes) setImmediate(function () {
    try {
      require("./notify").flushBroadcasts().catch(function (e) { console.error("[broadcasts] retry flush:", e.message); });
    } catch (e) { console.error("[broadcasts] retry flush:", e.message); }
  });
});

/* Перемикач «не надсилати розсилки» для клієнта. */
router.patch("/clients/:id/no-marketing", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const v = (req.body && req.body.no_marketing) ? 1 : 0;
  db.prepare("UPDATE clients SET no_marketing=? WHERE id=?").run(v, id);
  res.json({ ok: true, no_marketing: v });
});

/* Вимк/увімк SMS-нагадування ОКРЕМОМУ клієнту (типово увімкнені всім).
   Стосується лише нагадувань про візит; підтвердження запису йде завжди. */
router.patch("/clients/:id/no-reminders", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const v = (req.body && req.body.no_reminders) ? 1 : 0;
  db.prepare("UPDATE clients SET no_reminders=? WHERE id=?").run(v, id);
  res.json({ ok: true, no_reminders: v });
});

/* ---- Налаштування нагадувань (час) ---- */
router.get("/notify-settings", owner, function (req, res) {
  function get(k, dflt) {
    const r = db.prepare("SELECT value FROM app_settings WHERE key=?").get(k);
    return r ? r.value : dflt;
  }
  res.json({
    ok: true,
    reminder1_hours: parseFloat(get("reminder1_hours", "24")) || 0,
    reminder2_hours: parseFloat(get("reminder2_hours", process.env.REMINDER2_HOURS || "0")) || 0,
  });
});
router.patch("/notify-settings", owner, function (req, res) {
  const d = req.body || {};
  function num(x) { const v = parseFloat(x); return isFinite(v) && v >= 0 && v <= 240 ? v : null; }
  const h1 = num(d.reminder1_hours), h2 = num(d.reminder2_hours);
  if (h1 === null || h2 === null) return res.status(400).json({ ok: false, error: "Години: число від 0 до 240" });
  const up = db.prepare("INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  up.run("reminder1_hours", String(h1));
  up.run("reminder2_hours", String(h2));
  res.json({ ok: true, reminder1_hours: h1, reminder2_hours: h2 });
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

router.post("/reviews", any, function (req, res) {
  const b = req.body || {};
  const apptId = parseInt(b.appointment_id, 10);
  const rating = parseInt(b.rating, 10);
  if (!apptId || !rating || rating < 1 || rating > 5)
    return res.status(400).json({ ok: false, err: "bad params" });

  const a = db.prepare("SELECT id, master_id, client_id, status FROM appointments WHERE id=?").get(apptId);
  if (!a || a.status !== "completed") return res.status(400).json({ ok: false, err: "not completed" });
  if (req.session.role !== "owner" && a.master_id !== req.session.masterId)
    return res.status(403).json({ ok: false });

  const comment = clean(b.comment, 500) || null;
  try {
    db.prepare(
      `INSERT INTO reviews (appointment_id, master_id, client_id, rating, comment, created_at)
       VALUES (?,?,?,?,?,?)`
    ).run(apptId, a.master_id, a.client_id, rating, comment, Date.now());
  } catch (e) {
    db.prepare(
      `UPDATE reviews SET rating=?, comment=?, created_at=? WHERE appointment_id=?`
    ).run(rating, comment, Date.now(), apptId);
  }
  res.json({ ok: true });
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
