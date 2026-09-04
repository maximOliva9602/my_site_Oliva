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
const phonePrivacy = require("./phone-privacy");

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
/* Право редагувати графік роботи: власник — завжди; майстер — лише
   СВІЙ графік (masterId у сесії = :id у роуті) і лише якщо власник
   явно надав право у профілі майстра (can_edit_own_schedule). */
function canEditSchedule(session, masterId) {
  if (!session) return false;
  if (session.role === "owner") return true;
  if (session.masterId !== masterId) return false;
  const m = db.prepare("SELECT can_edit_own_schedule FROM masters WHERE id=?").get(masterId);
  return !!(m && m.can_edit_own_schedule);
}
function protectAppointmentPhone(a, sessionOrAccess) {
  if (!a) return a;
  const showFull = typeof sessionOrAccess === "boolean" ? sessionOrAccess : canSeePhones(sessionOrAccess);
  return Object.assign({}, a, {
    client_phone: phonePrivacy.visiblePhone(a.client_phone, showFull),
  });
}
function protectClientPhone(client, sessionOrAccess) {
  if (!client) return client;
  const showFull = typeof sessionOrAccess === "boolean" ? sessionOrAccess : canSeePhones(sessionOrAccess);
  return Object.assign({}, client, {
    phone: phonePrivacy.visiblePhone(client.phone, showFull),
  });
}
const STATUSES = ["pending", "confirmed", "cancelled", "completed", "no_show"];
const MASTER_LEVELS = ["Майстер", "Топ Майстер", "Експерт"];

/* Кожна послуга існує у кількох тарифних варіантах — окремий service_id
   для "(Майстер)", "(Топ Майстер)" і "(Експерт)" (та сама процедура й
   тривалість, різна ціна залежно від рівня майстра). Абонемент купують
   під один тариф, але клієнта далі міг обслуговувати майстер іншого
   рівня — тоді service_id візиту вже інший, хоча послуга фізично та сама,
   і списання по точному service_id мовчки не спрацьовувало (лічильник
   абонементу не зменшувався). Тому підбір/списання абонементу йде по
   "групі" тарифів однієї послуги (та сама назва без рівня й тривалості),
   а не по точному service_id. */
function baseServiceKey(name) {
  const cat = String(name || "")
    .replace(/\s*\((Топ Майстер|Майстер|Експерт)\)/, "")
    .replace(/\s+\d+\s*хв$/, "")
    .replace(/\s+\d+\s*год.*$/, "")
    .trim().toLowerCase();
  const durM = String(name || "").match(/(\d+)\s*хв/);
  const durH = String(name || "").match(/(\d+)\s*год/);
  const dur = durM ? parseInt(durM[1], 10) : (durH ? parseInt(durH[1], 10) * 60 : null);
  return cat + "|" + (dur || "");
}
function subServiceIds(serviceId) {
  const svc = db.prepare("SELECT name FROM services WHERE id=?").get(serviceId);
  if (!svc) return [serviceId];
  const key = baseServiceKey(svc.name);
  const rows = db.prepare("SELECT id, name FROM services").all();
  const ids = rows.filter(function (r) { return baseServiceKey(r.name) === key; }).map(function (r) { return r.id; });
  return ids.length ? ids : [serviceId];
}
function inList(n) { return new Array(n).fill("?").join(","); }
function serviceMatchesMasterLevel(serviceName, masterLevel) {
  const name = String(serviceName || "");
  const isExpert = name.includes("(Експерт)");
  const isTop = !isExpert && name.includes("(Топ Майстер)");
  const isMaster = !isExpert && !isTop && name.includes("(Майстер)");
  if (!isExpert && !isTop && !isMaster) return true; // спільна послуга без рівня
  if (isExpert) return masterLevel === "Експерт";
  if (isTop) return masterLevel === "Топ Майстер";
  return masterLevel === "Майстер";
}
/* Рівень, зашитий у назву послуги ("" — спільна, без рівня). Використовується,
   щоб при перейменуванні заборонити випадково стерти чи підмінити позначку
   рівня — від неї залежить, кому з master_services ця послуга дістанеться. */
function serviceLevelTag(serviceName) {
  const name = String(serviceName || "");
  if (name.includes("(Експерт)")) return "Експерт";
  if (name.includes("(Топ Майстер)")) return "Топ Майстер";
  if (name.includes("(Майстер)")) return "Майстер";
  return "";
}

/* ---------- спільне: повна картка запису ---------- */
function apptRow(id) {
  return db.prepare(
    `SELECT a.*, c.name AS client_name, c.phone AS client_phone,
            s.name AS service_name, m.name AS master_name,
            m2.name AS second_master_name,
            cert.code AS cert_code
       FROM appointments a
       JOIN clients c  ON c.id = a.client_id
       JOIN services s ON s.id = a.service_id
       JOIN masters  m ON m.id = a.master_id
       LEFT JOIN masters m2 ON m2.id = a.second_master_id
       LEFT JOIN certificates cert ON cert.used_by_appointment_id = a.id
      WHERE a.id = ?`
  ).get(id);
}
function viewAppt(a) {
  if (!a) return a;
  const out = Object.assign({}, a, { time: tz.fmtMin(a.start_min), end_time: tz.fmtMin(a.end_min) });
  // "Новий клієнт" — бейдж NEW у календарі. Мало жодного ЗАВЕРШЕНОГО візиту
  // (visit_count рахує саме completed, див. recomputeClient) — цього замало:
  // клієнт може записатися вдруге ще до того, як перший візит позначили
  // «виконано». Тому NEW лишається тільки на найпершому записі клієнта.
  if (a.client_visit_count != null) {
    let isNew = a.client_visit_count === 0;
    if (isNew) {
      try {
        const prior = db.prepare(
          `SELECT COUNT(*) c FROM appointments
            WHERE client_id = ? AND id <> ? AND status <> 'cancelled'
              AND (date < ? OR (date = ? AND start_min < ?))`
        ).get(a.client_id, a.id, a.date, a.date, a.start_min).c;
        isNew = prior === 0;
      } catch (e) { /* не критично — лишаємо як є */ }
    }
    out.is_new_client = isNew;
  }
  // Абонемент клієнта за цією послугою (для позначки «по абонементу» + лічильника в календарі)
  try {
    /* Скасований візит і неявка сеанс не займають — не даємо їм номера,
       інакше поруч із наступним активним записом світився б той самий. */
    if (a.status === "cancelled" || a.status === "no_show") return out;
    /* Завершений візит, за яким сеанс НЕ списувався (був до оформлення
       абонемента або вже після його вичерпання), теж не нумеруємо. */
    if (a.status === "completed" && !a.subscription_used) return out;
    const svcIds = subServiceIds(a.service_id);
    const sub = db.prepare(
      `SELECT id, used_sessions, total_sessions, created_at FROM subscriptions
        WHERE client_id=? AND service_id IN (${inList(svcIds.length)})
        ORDER BY (used_sessions < total_sessions) DESC, id DESC LIMIT 1`
    ).get(a.client_id, ...svcIds);
    if (sub) {
      /* Номер сеансу рахуємо ЗА ХРОНОЛОГІЄЮ візитів, а не за порядком, у
         якому їх позначали «Завершено».

         Раніше було два різні механізми: завершеним візитам номер
         ЗАМОРОЖУВАВСЯ (used_sessions+1 у момент завершення), а незавершеним
         рахувався від дати. Щойно візит завершували не по порядку (напр.
         спершу клацнули той, що 27-го, а запис на 25-те ще висів
         підтвердженим), нумерація перекидалась: ранішому візиту діставався
         БІЛЬШИЙ номер (25-те → 3/5, 27-ме → 2/5). Ті самі заморожені номери
         могли й дублюватись: при знятті «Завершено» лічильник відкочувався,
         а номери інших візитів лишались старими.

         Тепер номер — це просто позиція візиту в часі серед візитів, які
         абонемент покриває, тож він завжди узгоджений, без дублів і
         сам виправляється після скасування чи перенесення. */

      /* Візит "покритий" абонементом, якщо сеанс за ним уже списано
         (subscription_used=1) або він ще попереду (pending/confirmed).
         Скасовані, неявки та завершені ДО оформлення абонемента (за ними
         нічого не списувалось) у нумерацію не потрапляють.

         Але pending/confirmed сам собою не доказ зв'язку з АБОНЕМЕНТОМ —
         це може бути стара зависла pending-бронь тієї ж послуги, заведена
         ще ДО того, як абонемент оформили (напр. онлайн-запис, який ніхто
         не підтвердив і не скасував). Така бронь не мала жодного стосунку
         до абонемента, але рахувалась "попередньою" й зсувала нумерацію
         наступних сеансів на 1 (сеанс 1/10 показувало як 2/10). Тому
         pending/confirmed рахуємо покритими лише від моменту створення
         абонемента — раніші такі візити ігноруємо. */
      const subCreatedWall = tz.nowKyiv(null, sub.created_at);
      const COVERED = `(a2.subscription_used = 1 OR (a2.status IN ('pending','confirmed') AND (a2.date > ? OR (a2.date = ? AND a2.start_min >= ?))))`;

      /* Скільки сеансів списано без прив'язки до візиту — кнопкою
         «✓ Списати сеанс» на картці клієнта або перенесено зі старого
         абонемента (used_sessions на старті). Такі сеанси реальних записів
         не мають, тож зсувають нумерацію решти. */
      const withAppt = db.prepare(
        `SELECT COUNT(*) c FROM appointments a2
          WHERE a2.client_id=? AND a2.service_id IN (${inList(svcIds.length)})
            AND a2.subscription_used = 1`
      ).get(a.client_id, ...svcIds).c;
      const phantom = Math.max(0, sub.used_sessions - withAppt);

      /* Позиція цього візиту серед покритих — строго за датою/часом,
         id як стабільний тайбрейкер для двох записів в одну хвилину. */
      const before = db.prepare(
        `SELECT COUNT(*) c FROM appointments a2
          WHERE a2.client_id=? AND a2.service_id IN (${inList(svcIds.length)})
            AND ${COVERED} AND a2.id <> ?
            AND (a2.date < ?
              OR (a2.date = ? AND a2.start_min < ?)
              OR (a2.date = ? AND a2.start_min = ? AND a2.id < ?))`
      ).get(
        a.client_id, ...svcIds,
        subCreatedWall.date, subCreatedWall.date, subCreatedWall.min,
        a.id, a.date, a.date, a.start_min, a.date, a.start_min, a.id
      ).c;

      const subIndex = phantom + before + 1;
      /* Візити понад обсяг абонемента (6-й із 5) до нього не належать —
         номера не показуємо взагалі, щоб не було «сеанс 6 з 5». */
      if (subIndex <= sub.total_sessions) {
        out.sub_used = sub.used_sessions;
        out.sub_total = sub.total_sessions;
        out.sub_index = subIndex;
      }
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
/* Спільна картка-заглушка для записів "без контактних даних" (за
   прикладом Bookon: майстер бронює собі час — під сервіс, ремонт,
   особисту справу тощо — без реального клієнта). clients.phone
   UNIQUE NOT NULL, тому не створюємо нову картку на кожен такий запис —
   всі вони діляться однією "Гість". */
function getOrCreateGuestClient() {
  let c = db.prepare("SELECT id FROM clients WHERE phone='guest'").get();
  if (!c) {
    const info = db.prepare("INSERT INTO clients (phone,name,visit_count,created_at) VALUES ('guest','Гість',0,?)").run(Date.now());
    c = { id: info.lastInsertRowid };
  }
  return c.id;
}

/* Філія для запису, який CRM створює сама (кнопка "+ Новий запис" не
   питає філію — на відміну від публічного /booking, де клієнт її
   обирає). Раніше тут просто брали masters.branch_id — застаріле поле
   "одна філія на майстра за замовчуванням", яке для майстра з кількома
   реальними філіями (branch_masters) могло вказувати не туди, де він
   того дня фактично працює (саме так тестовий запис пішов у
   Борщагівську замість Успішної). Тепер дивимось у РЕАЛЬНИЙ графік на
   цю дату — той самий пріоритет override→графік дня тижня, що й у
   "Графік роботи" та в слотах бронювання (crm/slots.js workWindow). */
function resolveBranchForNewAppt(masterId, date, masterBranchIdColumn) {
  const weekday = tz.weekdayOf(date);
  const ovRows = db.prepare(
    "SELECT branch_id FROM master_day_overrides WHERE master_id=? AND date=? AND is_off=0 AND branch_id!=0"
  ).all(masterId, date);
  let ids = ovRows.map(function (r) { return r.branch_id; });
  if (!ids.length) {
    const schRows = db.prepare(
      "SELECT DISTINCT branch_id FROM master_schedule WHERE master_id=? AND weekday=? AND branch_id!=0"
    ).all(masterId, weekday);
    ids = schRows.map(function (r) { return r.branch_id; });
  }
  const uniq = Array.from(new Set(ids));
  if (uniq.length === 1) return uniq[0];
  if (uniq.length > 1) return null; // конфлікт — не вгадуємо, лишаємо "без філії"
  // Немає даних на цю дату: якщо майстер узагалі лише в одній філії — це вона.
  const ownBranches = db.prepare("SELECT branch_id FROM branch_masters WHERE master_id=?").all(masterId);
  if (ownBranches.length === 1) return ownBranches[0].branch_id;
  return masterBranchIdColumn || null;
}

function createAppointment(d, session) {
  const serviceId = parseInt(d.service, 10);
  let masterId = parseInt(d.master, 10);
  const date = clean(d.date, 10);
  const startMin = parseInt(d.start_min, 10);
  const isGuest = !!d.guest;
  const name = isGuest ? "Гість" : clean(d.name, 100);
  const phone = isGuest ? "" : tz.normPhone(clean(d.phone, 30));
  // Клієнт, обраний зі списку (пошук), може мати прихований телефон
  // (немає can_see_phones) — тоді d.phone порожній, але client_id є.
  const clientId = isGuest ? null : (parseInt(d.client_id, 10) || null);
  const comment = clean(d.comment, 500);
  const colorMarker = clean(d.color_marker, 20) || null;
  // Явно обрана філія з форми (потрібна, коли графік майстра того дня
  // конфліктний і resolveBranchForNewAppt() не може вгадати сам).
  const explicitBranch = d.branch !== undefined && d.branch !== "" ? (parseInt(d.branch, 10) || null) : null;

  // майстер може створювати лише собі
  if (session.role !== "owner") masterId = session.masterId;

  if (!serviceId || !masterId || !tz.isDate(date) || !(startMin >= 0) || !name) {
    return { status: 400, body: { ok: false, error: "missing fields" } };
  }
  const svc = db.prepare("SELECT name, duration_min, price FROM services WHERE id=? AND active=1").get(serviceId);
  if (!svc) return { status: 404, body: { ok: false, error: "service not found" } };
  const m = db.prepare("SELECT id, level, branch_id FROM masters WHERE id=? AND active=1").get(masterId);
  if (!m) return { status: 404, body: { ok: false, error: "master not found" } };
  // У власному акаунті майстер не може створити запис за прайсом іншого рівня.
  if (session.role !== "owner" && !serviceMatchesMasterLevel(svc.name, m.level)) {
    return { status: 403, body: { ok: false, error: "service_level_forbidden" } };
  }

  // Додаткові послуги: [{id, name, duration_min, price}]
  let extraServices = null;
  let totalDuration = svc.duration_min;
  let totalPrice = svc.price;
  try {
    const extras = d.extra_services ? JSON.parse(d.extra_services) : null;
    if (Array.isArray(extras) && extras.length) {
      /* За наявності id тривалість/ціну беремо з бази — щоб запис не
         зберіг застарілий прайс, якщо власник змінив його в адмінці. */
      const stmtEx = db.prepare("SELECT id, name, duration_min, price FROM services WHERE id=? AND active=1");
      const list = extras.map(function(ex) {
        const row = (parseInt(ex && ex.id, 10) || 0) ? stmtEx.get(parseInt(ex.id, 10)) : null;
        if (!row) return ex;
        return { id: row.id, name: ex.name || row.name, duration_min: row.duration_min, price: row.price };
      });
      extraServices = JSON.stringify(list);
      list.forEach(function(ex) {
        totalDuration += (parseInt(ex.duration_min, 10) || 0);
        totalPrice    += (parseInt(ex.price, 10) || 0);
      });
    }
  } catch(e) { /* ignore bad JSON */ }

  const now = Date.now();
  let publicId, appointmentId;
  try {
    db.transaction(function () {
      let client = null;
      if (isGuest) client = { id: getOrCreateGuestClient() };
      if (!client && clientId) client = db.prepare("SELECT id FROM clients WHERE id=?").get(clientId);
      if (!client && phone.length >= 7) {
        client = db.prepare("SELECT id FROM clients WHERE phone=?").get(phone);
        if (!client) {
          /* Фолбек для двох форматів номера в базі (097… і +380…) —
             шукаємо за нормалізованим, щоб не плодити дублі карток. */
          const hit = db.prepare("SELECT id, phone FROM clients").all()
            .find(function (c) { return tz.normPhone(c.phone) === phone; });
          if (hit) client = { id: hit.id };
        }
      }
      if (!client) {
        // Без телефону (і без вибору картки зі списку) — заводимо нового
        // клієнта лише з іменем; phone=NULL (дозволено, UNIQUE не заважає).
        const info = db.prepare("INSERT INTO clients (phone,name,visit_count,created_at) VALUES (?,?,0,?)").run(phone.length ? phone : null, name, now);
        client = { id: info.lastInsertRowid };
      } else {
        db.prepare("UPDATE clients SET name=COALESCE(NULLIF(?,''),name) WHERE id=?").run(name, client.id);
      }
      publicId = crypto.randomBytes(8).toString("hex");
      const info = db.prepare(
        /* Запис із CRM створює власник або сам майстер — підтверджувати
           нема кого й нема чого, тож одразу 'confirmed'. Онлайн-запис із
           сайту лишається 'pending': його підтверджують вручну. */
        `INSERT INTO appointments (public_id,client_id,master_id,branch_id,service_id,date,start_min,end_min,duration_min,price,status,source,comment,color_marker,extra_services,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'confirmed','staff',?,?,?,?,?)`
      ).run(publicId, client.id, masterId, explicitBranch || resolveBranchForNewAppt(masterId, date, m.branch_id), serviceId, date, startMin, startMin + totalDuration, totalDuration, totalPrice, comment, colorMarker, extraServices, now, now);
      appointmentId = info.lastInsertRowid;
    })();
  } catch (e) {
    if (e.code === "SLOT_TAKEN") return { status: 409, body: { ok: false, error: "SLOT_TAKEN" } };
    if (e.code === "CLIENT_NOT_FOUND") return { status: 404, body: { ok: false, error: "CLIENT_NOT_FOUND" } };
    return { status: 500, body: { ok: false, error: e.message } };
  }
  // Сповіщення адміну в Telegram + PWA push
  try {
    const adminNotify = require("./admin-notify");
    adminNotify.notifyNewAppt(appointmentId, "crm");
  } catch (e) { console.error("[routes.crm] adminNotify error:", e.message); }

  /* Запис одразу підтверджений, тож клієнту йде те саме SMS «запис
     підтверджено», що й при ручному натисканні «Підтвердити» — інакше при
     записі через CRM клієнт не отримав би підтвердження взагалі.
     Той самий прапорець notif_confirm вимикає це, якщо не потрібно. */
  if (settingOn("notif_confirm", true)) {
    try {
      const notify = require("./notify");
      const q = notify.queueNotification(appointmentId, "confirmation");
      if (q && q.ok && !q.duplicate) {
        setImmediate(function () {
          notify.flushQueued().catch(function (e) { console.error("[create] flush:", e.message); });
        });
      }
    } catch (e) { console.error("[create] queue confirmation:", e.message); }
  }

  return { status: 200, body: { ok: true, public_id: publicId, appointment: viewAppt(protectAppointmentPhone(apptRow(appointmentId), session)) } };
}

/* ---- Оплата праці майстра ----
   Ставка на послугу: персональна (master_service_pay: % або фікс. копійки),
   інакше типовий відсоток майстра (masters.pay_percent), інакше 0.
   НОВИЙ vs ПОВТОРНИЙ клієнт: повторний — той, хто вже має завершений візит
   у ЦЬОГО Ж майстра раніше за поточний. Для повторного беруться
   value_return / pay_percent_return, якщо задані (інакше — як для нового).
   АБОНЕМЕНТ: якщо візит зарахований з абонементу (subscription_used) —
   майстер отримує окрему (типово вищу) ставку з master_subscription_pay /
   pay_percent_subscription замість нової/повторної; завжди у % (без fixed).
   Заробіток = сума ставок по завершених візитах за період. */
function masterEarnings(masterId, from, to) {
  const m = db.prepare("SELECT pay_percent, pay_percent_return, pay_percent_subscription FROM masters WHERE id=?").get(masterId);
  const defNew = (m && m.pay_percent) || 0;
  const defRet = (m && m.pay_percent_return != null) ? m.pay_percent_return : defNew;
  const defSub = (m && m.pay_percent_subscription != null) ? m.pay_percent_subscription : defNew;
  const overrides = {};
  db.prepare("SELECT service_id, mode, value, value_return FROM master_service_pay WHERE master_id=?")
    .all(masterId).forEach(function (r) { overrides[r.service_id] = r; });
  const subOverrides = {};
  db.prepare("SELECT service_id, value FROM master_subscription_pay WHERE master_id=?")
    .all(masterId).forEach(function (r) { subOverrides[r.service_id] = r.value; });
  const rows = db.prepare(
    `SELECT id, client_id, service_id, price, date, start_min, subscription_used
       FROM appointments WHERE master_id=? AND status='completed' AND date>=? AND date<=?`
  ).all(masterId, from, to);
  const isRetStmt = db.prepare(
    `SELECT 1 FROM appointments
      WHERE client_id=? AND master_id=? AND status='completed' AND id != ?
        AND (date < ? OR (date = ? AND start_min < ?)) LIMIT 1`
  );
  let total = 0;
  for (const a of rows) {
    const o = overrides[a.service_id];
    if (a.subscription_used) {
      const pct = subOverrides[a.service_id] != null ? subOverrides[a.service_id] : defSub;
      if (pct) total += Math.round((a.price || 0) * pct / 100);
      continue;
    }
    const isReturn = !!isRetStmt.get(a.client_id, masterId, a.id, a.date, a.date, a.start_min);
    if (o) {
      const val = (isReturn && o.value_return != null) ? o.value_return : o.value;
      total += o.mode === "fixed" ? Math.round(val) : Math.round((a.price || 0) * val / 100);
    } else {
      const pct = isReturn ? defRet : defNew;
      if (pct) total += Math.round((a.price || 0) * pct / 100);
    }
  }
  return total; // копійки
}

/* Перемикачі SMS-сповіщень із app_settings ("1"/"0"; dfltOn — типове значення). */
function settingOn(key, dfltOn) {
  try {
    const r = db.prepare("SELECT value FROM app_settings WHERE key=?").get(key);
    if (!r) return !!dfltOn;
    return r.value === "1" || r.value === "true";
  } catch (e) { return !!dfltOn; }
}

/* ---------- зміна статусу ---------- */
function setStatus(id, status, session, options) {
  options = options || {};
  if (STATUSES.indexOf(status) === -1) return { status: 400, body: { ok: false, error: "bad status" } };
  const a = db.prepare("SELECT id, master_id, client_id, public_id, status, service_id, subscription_used FROM appointments WHERE id=?").get(id);
  if (!a) return { status: 404, body: { ok: false, error: "not found" } };
  if (session.role !== "owner" && a.master_id !== session.masterId) {
    return { status: 403, body: { ok: false, error: "forbidden" } };
  }
  const wasCompleted = a.status === "completed";
  db.prepare("UPDATE appointments SET status=?, updated_at=? WHERE id=?").run(status, Date.now(), id);
  recomputeClient(a.client_id);

  /* Знімаємо «Завершено» (вручну чи це був помилковий автозавершений
     запис) — повертаємо сеанс абонементу, якщо його вже списали.
     Немає FK на конкретний subscription_id, тому шукаємо евристично:
     останній (за id) абонемент клієнта на цю послугу, з used_sessions>0. */
  if (wasCompleted && status !== "completed" && a.subscription_used && a.client_id && a.service_id) {
    const refundIds = subServiceIds(a.service_id);
    const sub = db.prepare(
      `SELECT id FROM subscriptions WHERE client_id=? AND service_id IN (${inList(refundIds.length)}) AND used_sessions>0 ORDER BY id DESC LIMIT 1`
    ).get(a.client_id, ...refundIds);
    if (sub) {
      db.prepare("UPDATE subscriptions SET used_sessions=used_sessions-1 WHERE id=?").run(sub.id);
      db.prepare("UPDATE appointments SET subscription_used=0, subscription_session_no=NULL, subscription_session_total=NULL WHERE id=?").run(id);
    }
  }
  if (status === "confirmed" && settingOn("notif_confirm", true)) {
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
  if (status === "cancelled" && settingOn("notif_cancel", false)) {
    /* SMS про скасування (типово вимкнено — вмикається у Сповіщеннях). */
    try {
      const notify = require("./notify");
      const q = notify.queueNotification(id, "cancellation");
      if (q && q.ok && !q.duplicate) {
        setImmediate(function () {
          notify.flushQueued().catch(function (e) { console.error("[cancel-sms] flush:", e.message); });
        });
      }
    } catch (e) { console.error("[cancel-sms] queue:", e.message); }
  }
  /* Сповіщення про скасування власнику й майстру (Telegram + push).
     Окремо від SMS клієнту вище: та керується notif_cancel і типово
     вимкнена, а студія має знати про скасування завжди — час звільнився,
     і його ще можна комусь запропонувати.
     Не шлемо, якщо запис і так уже був скасований: setStatus викликають
     повторно (напр. подвійний клік), і летіли б дублі. */
  if (status === "cancelled" && a.status !== "cancelled") {
    try {
      const who = session && session.role === "owner"
        ? "власник"
        : (db.prepare("SELECT name FROM masters WHERE id=?").get(session && session.masterId) || {}).name || "майстер";
      require("./admin-notify").notifyCancelled(id, who);
    } catch (e) { console.error("[cancel-notify]", e.message); }
    /* Клієнт не скористався послугою — сертифікат, яким платили за цей
       запис, повертаємо в стан "не використаний", щоб можна було
       прийняти його ще раз (наприклад, на перенесений запис). */
    try {
      db.prepare(
        "UPDATE certificates SET status='ordered', used_at=NULL, used_by_appointment_id=NULL, used_note=NULL WHERE used_by_appointment_id=? AND status='used'"
      ).run(id);
    } catch (e) { console.error("[cancel-cert-revert]", e.message); }
  }
  if (status === "completed") {
    // Автоматично списуємо сеанс абонементу (якщо ще не списали)
    if (!a.subscription_used && a.client_id && a.service_id) {
      const consumeIds = subServiceIds(a.service_id);
      const sub = db.prepare(
        `SELECT id, used_sessions, total_sessions FROM subscriptions WHERE client_id=? AND service_id IN (${inList(consumeIds.length)}) AND used_sessions < total_sessions ORDER BY id LIMIT 1`
      ).get(a.client_id, ...consumeIds);
      if (sub) {
        db.prepare("UPDATE subscriptions SET used_sessions=used_sessions+1 WHERE id=?").run(sub.id);
        // Фіксуємо номер сеансу назавжди — щоб бейдж на цій картці більше
        // не "їхав" услід за подальшими візитами клієнта по цьому абонементу.
        db.prepare("UPDATE appointments SET subscription_used=1, subscription_session_no=?, subscription_session_total=? WHERE id=?")
          .run(sub.used_sessions + 1, sub.total_sessions, id);
      }
    }
    /* Запит відгуку йде клієнту в Telegram, а не через SMS-драйвер.
       Черга сама дочекається кінця запланованого сеансу та збереженого
       chat_id. UNIQUE по appointment_id захищає від повторних повідомлень. */
    try {
      const clientTelegram = require("./client-telegram");
      const sendNow = !options.automated;
      const q = clientTelegram.queueReviewRequest(id, { sendNow: sendNow });
      /* При ручному завершенні flush потрібен і для вже наявного запису:
         queueReviewRequest переносить його send_after на поточний час. */
      if (q && q.ok && (!q.duplicate || sendNow)) {
        setImmediate(function () {
          clientTelegram.flushQueued().catch(function (e) {
            console.error("[review-telegram] flush:", e.message);
          });
        });
      }
    } catch(e) { console.error("[review-telegram] queue:", e.message); }
  }
  return { status: 200, body: { ok: true, appointment: viewAppt(protectAppointmentPhone(apptRow(id), session)) } };
}

/* ============================================================
   МАЙСТЕР (і власник): свої записи/клієнти
   ============================================================ */
router.get("/me/appointments", any, function (req, res) {
  const s = req.session;
  const from = clean(req.query.from, 10), to = clean(req.query.to, 10);
  const masterParam = clean(req.query.master, 20);
  let sql = "SELECT a.*, c.name client_name, c.phone client_phone, c.visit_count client_visit_count, s.name service_name, m.name master_name, m2.name second_master_name, cert.code cert_code FROM appointments a JOIN clients c ON c.id=a.client_id JOIN services s ON s.id=a.service_id JOIN masters m ON m.id=a.master_id LEFT JOIN masters m2 ON m2.id=a.second_master_id LEFT JOIN certificates cert ON cert.used_by_appointment_id=a.id WHERE 1=1";
  const args = [];
  // master=<id> — явний фільтр на конкретного майстра (доступно всім,
  // календар і так показує розклад усіх майстрів). master=all — явно
  // прибрати фільтр і показати записи всіх майстрів. Без параметра —
  // стара поведінка: власник бачить усіх, майстер лише себе.
  if (masterParam && masterParam !== "all") {
    sql += " AND a.master_id=?"; args.push(parseInt(masterParam, 10));
  } else if (masterParam !== "all" && s.role !== "owner") {
    sql += " AND a.master_id=?"; args.push(s.masterId);
  }
  if (tz.isDate(from)) { sql += " AND a.date>=?"; args.push(from); }
  if (tz.isDate(to)) { sql += " AND a.date<=?"; args.push(to); }
  sql += " ORDER BY a.date, a.start_min";
  const stmt = db.prepare(sql);
  const showPhone = canSeePhones(s);
  res.json({ ok: true, appointments: stmt.all.apply(stmt, args).map(function(a) {
    return viewAppt(protectAppointmentPhone(a, showPhone));
  }) });
});

router.post("/me/appointments", any, function (req, res) {
  const r = createAppointment(req.body || {}, req.session);
  res.status(r.status).json(r.body);
});

/* Один запис для прямого переходу з push-сповіщення. Майстер може
   відкрити лише власний запис, власник — будь-який. */
router.get("/appointments/:id(\\d+)", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const a = id ? apptRow(id) : null;
  if (!a) return res.status(404).json({ ok: false, error: "not found" });
  if (req.session.role !== "owner" && a.master_id !== req.session.masterId) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const out = protectAppointmentPhone(a, req.session);
  res.json({ ok: true, appointment: viewAppt(out) });
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
  rows = rows.map(function(c) { return protectClientPhone(c, showPhone); });
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
  // Ручний вибір філії (форма показує це поле, лише коли в майстра їх
  // кілька) — інакше лишаємо, що вже було збережено.
  const branchId = d.branch !== undefined ? (parseInt(d.branch, 10) || null) : a.branch_id;
  if (!tz.isDate(date) || !(startMin >= 0)) return res.status(400).json({ ok: false, error: "bad params" });

  // Зміна послуги — перераховуємо базову тривалість і ціну під нову послугу.
  let serviceId = a.service_id;
  if (d.service !== undefined) {
    const newServiceId = parseInt(d.service, 10);
    if (newServiceId && newServiceId !== a.service_id) serviceId = newServiceId;
  }
  const baseSvc = db.prepare("SELECT name, duration_min, price FROM services WHERE id=?").get(serviceId);
  if (!baseSvc) return res.status(404).json({ ok: false, error: "service not found" });

  /* Додаткові послуги: можна явно передати новий список (JSON-рядок
     масиву [{id,name,duration_min,price}] або null/""  щоб очистити) —
     інакше лишаємо, що вже було. appointments.duration_min/price завжди
     зберігають ПОВНУ суму (база + extras), бо саме так рахує createAppointment. */
  let extraServicesJson = d.extra_services !== undefined ? (d.extra_services || null) : a.extra_services;
  let extraDur = 0, extraPrice = 0;
  try {
    const extras = extraServicesJson ? JSON.parse(extraServicesJson) : null;
    if (Array.isArray(extras)) {
      extras.forEach(function (ex) { extraDur += parseInt(ex.duration_min, 10) || 0; extraPrice += parseInt(ex.price, 10) || 0; });
    } else {
      extraServicesJson = null;
    }
  } catch (e) { extraServicesJson = a.extra_services; }

  const durationMin = baseSvc.duration_min + extraDur;
  const price = baseSvc.price + extraPrice;

  const timeChanged = (date !== a.date || startMin !== a.start_min);
  const serviceChanged = serviceId !== a.service_id;
  const totalsChanged = durationMin !== a.duration_min || price !== a.price || extraServicesJson !== a.extra_services;
  if (req.session.role !== "owner" && serviceChanged) {
    const master = db.prepare("SELECT level FROM masters WHERE id=?").get(masterId);
    if (!master || !serviceMatchesMasterLevel(baseSvc.name, master.level)) {
      return res.status(403).json({ ok: false, error: "service_level_forbidden" });
    }
  }
  if (timeChanged || masterId !== a.master_id || serviceChanged || totalsChanged || branchId !== a.branch_id) {
    db.prepare("UPDATE appointments SET date=?, start_min=?, end_min=?, master_id=?, branch_id=?, service_id=?, duration_min=?, price=?, extra_services=?, comment=?, updated_at=? WHERE id=?")
      .run(date, startMin, startMin + durationMin, masterId, branchId, serviceId, durationMin, price, extraServicesJson, comment, Date.now(), id);
    /* SMS про перенесення (типово вимкнено; вмикається у Сповіщеннях).
       Лише коли реально змінились дата/час активного запису. Попереднє
       reschedule-сповіщення видаляємо, щоб UNIQUE не блокував повторне
       перенесення того ж запису. */
    if (timeChanged && (a.status === "pending" || a.status === "confirmed") && settingOn("notif_reschedule", false)) {
      try {
        const notify = require("./notify");
        db.prepare("DELETE FROM notifications WHERE appointment_id=? AND kind='reschedule'").run(id);
        const q = notify.queueNotification(id, "reschedule");
        if (q && q.ok) {
          setImmediate(function () {
            notify.flushQueued().catch(function (e) { console.error("[resched] flush:", e.message); });
          });
        }
      } catch (e) { console.error("[resched]", e.message); }
    }
  } else {
    db.prepare("UPDATE appointments SET comment=?, updated_at=? WHERE id=?").run(comment, Date.now(), id);
  }

  // Ручна відмітка «використати абонемент за цей візит» (лише unset → set).
  if (d.subscription_used === true && !a.subscription_used) {
    const markIds = subServiceIds(serviceId);
    const sub = db.prepare(
      `SELECT id, used_sessions, total_sessions FROM subscriptions WHERE client_id=? AND service_id IN (${inList(markIds.length)}) AND used_sessions < total_sessions ORDER BY id LIMIT 1`
    ).get(a.client_id, ...markIds);
    if (sub) {
      db.prepare("UPDATE subscriptions SET used_sessions=used_sessions+1 WHERE id=?").run(sub.id);
      db.prepare("UPDATE appointments SET subscription_used=1, subscription_session_no=?, subscription_session_total=? WHERE id=?")
        .run(sub.used_sessions + 1, sub.total_sessions, id);
    }
  }

  res.json({ ok: true, appointment: viewAppt(protectAppointmentPhone(apptRow(id), req.session)) });
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

/* Другий майстер на парну процедуру ("SPA для двох" тощо) — запис і
   оплата лишаються одним, але клієнта фактично обслуговують два майстри.
   Клієнт при онлайн-записі обирає лише "свого", другого власник додає
   тут вручну; будь-якого активного майстра, навіть якщо той раніше цю
   послугу не надавав — у такому разі його одразу прив'язуємо до послуги,
   щоб надалі він теж траплявся в переліку виконавців. */
router.patch("/appointments/:id/second-master", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const a = db.prepare("SELECT id, service_id, master_id, date, start_min, end_min, second_master_id FROM appointments WHERE id=?").get(id);
  if (!a) return res.status(404).json({ ok: false });

  const raw = (req.body || {}).master_id;
  let masterId = null;
  if (raw !== null && raw !== undefined && raw !== "") {
    masterId = parseInt(raw, 10);
    if (!masterId) return res.status(400).json({ ok: false, error: "bad master_id" });
    if (masterId === a.master_id) return res.status(400).json({ ok: false, error: "same as primary master" });
    const m = db.prepare("SELECT id FROM masters WHERE id=? AND active=1").get(masterId);
    if (!m) return res.status(404).json({ ok: false, error: "master not found" });
    db.prepare("INSERT OR IGNORE INTO master_services (master_id,service_id) VALUES (?,?)").run(masterId, a.service_id);
  }

  db.prepare("UPDATE appointments SET second_master_id=?, updated_at=? WHERE id=?").run(masterId, Date.now(), id);

  if (masterId && masterId !== a.second_master_id) {
    try { require("./admin-notify").notifySecondMaster(id); } catch (e) { console.error("[second-master-notify]", e.message); }
  }

  res.json({ ok: true, appointment: viewAppt(apptRow(id)) });
});

/* ============================================================
   ВЛАСНИК: записи (усі), майстри, послуги, клієнти, користувачі
   ============================================================ */
router.get("/appointments/month-counts", any, function (req, res) {
  const ym = clean(req.query.month, 7); // "2026-07"
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ ok: false });
  const from = ym + "-01", to = ym + "-31";
  // Власник може обрати конкретного майстра у фільтрі («Майстер: …») —
  // бейджі кількості записів у календарі мають рахувати саме його,
  // а не всіх, інакше цифри не змінюються при перемиканні фільтра.
  const filterMasterId = req.session.role === "owner" ? parseInt(req.query.master, 10) || null : req.session.masterId;
  // Власник також може обрати філію («Філія: …») — бейджі мають рахувати
  // лише записи цієї філії, незалежно від фільтра майстра.
  const filterBranchId = req.session.role === "owner" ? parseInt(req.query.branch, 10) || null : null;
  let sql = "SELECT date, COUNT(*) n FROM appointments WHERE date>=? AND date<=? AND status NOT IN ('cancelled')";
  const args = [from, to];
  if (filterMasterId) { sql += " AND master_id=?"; args.push(filterMasterId); }
  if (filterBranchId) { sql += " AND branch_id=?"; args.push(filterBranchId); }
  sql += " GROUP BY date";
  const stmtMc = db.prepare(sql);
  const rows = stmtMc.all.apply(stmtMc, args);
  const counts = {};
  rows.forEach(function(r) { counts[r.date] = r.n; });
  res.json({ ok: true, counts: counts });
});

router.get("/appointments", owner, function (req, res) {
  const date = clean(req.query.date, 10), from = clean(req.query.from, 10), to = clean(req.query.to, 10);
  const master = parseInt(req.query.master, 10);
  const branch = parseInt(req.query.branch, 10);
  let sql = "SELECT a.*, c.name client_name, c.phone client_phone, c.visit_count client_visit_count, s.name service_name, m.name master_name, m2.name second_master_name, cert.code cert_code FROM appointments a JOIN clients c ON c.id=a.client_id JOIN services s ON s.id=a.service_id JOIN masters m ON m.id=a.master_id LEFT JOIN masters m2 ON m2.id=a.second_master_id LEFT JOIN certificates cert ON cert.used_by_appointment_id=a.id WHERE 1=1";
  const args = [];
  if (tz.isDate(date)) { sql += " AND a.date=?"; args.push(date); }
  if (tz.isDate(from)) { sql += " AND a.date>=?"; args.push(from); }
  if (tz.isDate(to)) { sql += " AND a.date<=?"; args.push(to); }
  if (master) { sql += " AND a.master_id=?"; args.push(master); }
  if (branch) { sql += " AND a.branch_id=?"; args.push(branch); }
  sql += " ORDER BY a.date, a.start_min";
  const stmt = db.prepare(sql);
  res.json({ ok: true, appointments: stmt.all.apply(stmt, args).map(viewAppt) });
});

router.post("/appointments", owner, function (req, res) {
  const r = createAppointment(req.body || {}, req.session);
  res.status(r.status).json(r.body);
});

/* ---- Разовий масовий імпорт записів (напр. перенесення з іншої CRM) ----
   На відміну від createAppointment: НЕ шле сповіщення власнику/майстрам
   (Telegram+push) — при імпорті десятків історичних записів це був би
   спам "Новий запис!" по кожному. SMS клієнту так само не йде, бо ми не
   викликаємо setStatus() — просто пишемо status у базу напряму. */
router.post("/appointments/bulk-import", owner, function (req, res) {
  const items = Array.isArray(req.body && req.body.appointments) ? req.body.appointments : [];
  if (!items.length) return res.status(400).json({ ok: false, error: "empty" });
  const now = Date.now();
  const results = [];
  items.forEach(function (d, idx) {
    try {
      const serviceId = parseInt(d.service_id, 10);
      const masterId = parseInt(d.master_id, 10);
      const date = clean(d.date, 10);
      const startMin = parseInt(d.start_min, 10);
      const name = clean(d.name, 100);
      const phone = tz.normPhone(clean(d.phone, 30));
      const status = STATUSES.indexOf(d.status) !== -1 ? d.status : "pending";
      const comment = clean(d.comment, 500);
      if (!serviceId || !masterId || !tz.isDate(date) || !(startMin >= 0) || !name) {
        results.push({ idx, ok: false, error: "missing fields" }); return;
      }
      const svc = db.prepare("SELECT duration_min, price FROM services WHERE id=? AND active=1").get(serviceId);
      if (!svc) { results.push({ idx, ok: false, error: "service not found" }); return; }
      const m = db.prepare("SELECT id, branch_id FROM masters WHERE id=? AND active=1").get(masterId);
      if (!m) { results.push({ idx, ok: false, error: "master not found" }); return; }

      let client = null;
      if (phone.length >= 7) {
        client = db.prepare("SELECT id FROM clients WHERE phone=?").get(phone);
        if (!client) {
          const hit = db.prepare("SELECT id, phone FROM clients").all()
            .find(function (c) { return tz.normPhone(c.phone) === phone; });
          if (hit) client = { id: hit.id };
        }
      }
      if (!client) {
        const info = db.prepare("INSERT INTO clients (phone,name,visit_count,created_at) VALUES (?,?,0,?)").run(phone.length ? phone : null, name, now);
        client = { id: info.lastInsertRowid };
      } else {
        db.prepare("UPDATE clients SET name=COALESCE(NULLIF(?,''),name) WHERE id=?").run(name, client.id);
      }
      const publicId = crypto.randomBytes(8).toString("hex");
      const info = db.prepare(
        `INSERT INTO appointments (public_id,client_id,master_id,branch_id,service_id,date,start_min,end_min,duration_min,price,status,source,comment,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, 'staff',?,?,?)`
      ).run(publicId, client.id, masterId, resolveBranchForNewAppt(masterId, date, m.branch_id), serviceId, date, startMin, startMin + svc.duration_min, svc.duration_min, svc.price, status, comment, now, now);
      results.push({ idx, ok: true, id: info.lastInsertRowid, client_id: client.id });
    } catch (e) {
      results.push({ idx, ok: false, error: e.message });
    }
  });
  res.json({ ok: true, results, created: results.filter(function (r) { return r.ok; }).length, total: items.length });
});

/* ---- Розклад (для майстрів — загальний вигляд) ---- */
router.get("/schedule", any, function (req, res) {
  const date = clean(req.query.date, 10) || new Date().toISOString().slice(0, 10);
  const sql = "SELECT a.id, a.date, a.start_min, a.end_min, a.duration_min, a.status, a.master_id, a.service_id, a.client_id, a.price, a.paid, a.color_marker, a.comment, a.extra_services, " +
              "a.subscription_used, a.subscription_session_no, a.subscription_session_total, " +
              "c.name client_name, c.phone client_phone, c.visit_count client_visit_count, s.name service_name, m.name master_name, " +
              "r.rating review_rating, r.comment review_comment " +
              "FROM appointments a JOIN clients c ON c.id=a.client_id JOIN services s ON s.id=a.service_id JOIN masters m ON m.id=a.master_id " +
              "LEFT JOIN reviews r ON r.appointment_id=a.id " +
              "WHERE a.date=? AND a.status NOT IN ('cancelled','no_show') ORDER BY a.start_min";
  const showPhone = canSeePhones(req.session);
  res.json({ ok: true, appointments: db.prepare(sql).all(date).map(function(a) {
    return viewAppt(protectAppointmentPhone(a, showPhone));
  }) });
});

/* ---- Майстри ---- */
router.get("/masters", any, function (req, res) {
  const rows = db.prepare("SELECT * FROM masters WHERE active=1 ORDER BY sort_order, id").all();
  // приклеїти services-ids
  rows.forEach(function (m) {
    m.service_ids = db.prepare("SELECT service_id FROM master_services WHERE master_id=?").all(m.id).map(function (r) { return r.service_id; });
    m.branch_ids = db.prepare("SELECT branch_id FROM branch_masters WHERE master_id=? ORDER BY branch_id").all(m.id).map(function (r) { return r.branch_id; });
  });
  res.json({ ok: true, masters: rows });
});
router.post("/masters", owner, function (req, res) {
  const d = req.body || {};
  const name = clean(d.name, 100);
  if (!name) return res.status(400).json({ ok: false, error: "name required" });
  const level = clean(d.level, 50) || 'Майстер';
  if (MASTER_LEVELS.indexOf(level) === -1) return res.status(400).json({ ok: false, error: "bad master level" });
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
  if (d.level !== undefined && MASTER_LEVELS.indexOf(clean(d.level, 50)) === -1) {
    return res.status(400).json({ ok: false, error: "bad master level" });
  }
  db.prepare("UPDATE masters SET name=?, last_name=?, phone=?, color=?, sort_order=?, photo=?, level=?, mono_link=?, can_see_phones=?, show_on_site=?, can_edit_own_schedule=? WHERE id=?").run(
    d.name           !== undefined ? clean(d.name, 100)      : m.name,
    d.last_name      !== undefined ? clean(d.last_name, 100) : m.last_name,
    d.phone          !== undefined ? clean(d.phone, 30)      : m.phone,
    d.color          !== undefined ? clean(d.color, 20)      : m.color,
    d.sort_order     !== undefined ? parseInt(d.sort_order, 10) || 0 : m.sort_order,
    d.photo          !== undefined ? clean(d.photo, 500)     : m.photo,
    d.level          !== undefined ? clean(d.level, 50)      : m.level,
    d.mono_link      !== undefined ? clean(d.mono_link, 500) : m.mono_link,
    d.can_see_phones !== undefined ? (d.can_see_phones ? 1 : 0) : (m.can_see_phones || 0),
    d.show_on_site   !== undefined ? (d.show_on_site ? 1 : 0) : (m.show_on_site != null ? m.show_on_site : 1),
    d.can_edit_own_schedule !== undefined ? (d.can_edit_own_schedule ? 1 : 0) : (m.can_edit_own_schedule || 0),
    id
  );
  // Посада визначає прайс — міняється рівень, перерахувати список послуг.
  if (d.level !== undefined && clean(d.level, 50) !== m.level) autoAssignServicesByLevel(id, clean(d.level, 50));
  res.json({ ok: true });
});
router.delete("/masters/:id", owner, function (req, res) {
  db.prepare("UPDATE masters SET active=0 WHERE id=?").run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

/* ========== ФІЛІЇ ========== */
/* Галерея філії зберігається JSON-масивом у branches.photos. Обрізаємо
   до 12 фото — більше в картці все одно ніхто не догортає. */
function normPhotos(v) {
  if (!Array.isArray(v)) return [];
  return v.map(function (x) { return String(x || "").trim().slice(0, 500); })
          .filter(Boolean).slice(0, 12);
}
/* Старі філії мають лише photo — віддаємо його як галерею з одного фото. */
function parsePhotos(raw, single) {
  if (raw) { try { const a = JSON.parse(raw); if (Array.isArray(a) && a.length) return a; } catch (e) {} }
  return single ? [single] : [];
}

/* Перезаписує список послуг філії. Порожній масив = «всі послуги»
   (рядки просто видаляються), тож філію завжди можна повернути в
   типовий стан, знявши всі галочки. */
function setBranchServices(branchId, ids) {
  db.transaction(function () {
    db.prepare("DELETE FROM branch_services WHERE branch_id=?").run(branchId);
    const add = db.prepare("INSERT OR IGNORE INTO branch_services (branch_id,service_id) VALUES (?,?)");
    ids.forEach(function (sid) {
      const n = parseInt(sid, 10);
      if (n) add.run(branchId, n);
    });
  })();
}

router.get("/branches", any, function (req, res) {
  const rows = db.prepare("SELECT * FROM branches WHERE active=1 ORDER BY sort_order,id").all();
  rows.forEach(function (b) {
    b.schedule = db.prepare("SELECT weekday,work_start,work_end FROM branch_schedule WHERE branch_id=? ORDER BY weekday").all(b.id);
    b.masters  = db.prepare(
      `SELECT m.id,m.name,m.last_name,m.photo,m.level,m.branch_id
         FROM masters m
         JOIN branch_masters bm ON bm.master_id=m.id
        WHERE bm.branch_id=? AND m.active=1
        ORDER BY m.sort_order,m.id`
    ).all(b.id);
    /* Порожній список = філія надає всі послуги (див. міграцію
       branch_services). Віддаємо як є, а CRM у такому разі показує
       всі галочки поставленими. */
    b.service_ids = db.prepare("SELECT service_id FROM branch_services WHERE branch_id=?")
      .all(b.id).map(function (r) { return r.service_id; });
    b.photos = parsePhotos(b.photos, b.photo);
  });
  res.json({ ok: true, branches: rows, booking_branch_step: settingOn("booking_branch_step", false) });
});

/* Перемикач "показувати крок вибору філії в онлайн-записі" — має сенс
   лише коли філій більше однієї (перевіряється на публічній стороні). */
router.patch("/settings/booking-branch-step", owner, function (req, res) {
  const enabled = !!(req.body || {}).enabled;
  db.prepare("INSERT INTO app_settings (key,value) VALUES ('booking_branch_step',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(enabled ? "1" : "0");
  res.json({ ok: true, enabled: enabled });
});

router.post("/branches", owner, function (req, res) {
  const d = req.body || {};
  const name = (d.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ ok: false, error: "name required" });
  let branchId;
  db.transaction(function () {
    const photos = normPhotos(d.photos);
    const info = db.prepare("INSERT INTO branches (name,photo,active,sort_order,created_at,address,subtitle,nearby,photos) VALUES (?,?,1,?,?,?,?,?,?)")
      .run(name, photos[0] || (d.photo ? d.photo.slice(0, 500) : null), parseInt(d.sort_order, 10) || 0, Date.now(),
           d.address ? String(d.address).trim().slice(0, 200) : null,
           d.subtitle ? String(d.subtitle).trim().slice(0, 120) : null,
           d.nearby ? String(d.nearby).trim().slice(0, 200) : null,
           photos.length ? JSON.stringify(photos) : null);
    branchId = info.lastInsertRowid;
    if (Array.isArray(d.service_ids)) setBranchServices(branchId, d.service_ids);
    if (Array.isArray(d.master_ids)) {
      const add = db.prepare("INSERT OR IGNORE INTO branch_masters (branch_id,master_id) VALUES (?,?)");
      const setPrimary = db.prepare("UPDATE masters SET branch_id=? WHERE id=? AND branch_id IS NULL");
      d.master_ids.forEach(function (mid) {
        const masterId = parseInt(mid, 10);
        if (!masterId) return;
        add.run(branchId, masterId);
        setPrimary.run(branchId, masterId);
      });
    }
  })();
  res.json({ ok: true, id: branchId });
});

router.put("/branches/:id", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const b = db.prepare("SELECT * FROM branches WHERE id=?").get(id);
  if (!b) return res.status(404).json({ ok: false });
  const d = req.body || {};
  const newPhotos = d.photos !== undefined ? normPhotos(d.photos) : null;
  db.prepare("UPDATE branches SET name=?,photo=?,sort_order=?,address=?,subtitle=?,nearby=?,photos=? WHERE id=?")
    .run(d.name !== undefined ? d.name.slice(0, 100) : b.name,
         newPhotos ? (newPhotos[0] || null)
                   : (d.photo !== undefined ? (d.photo ? d.photo.slice(0, 500) : null) : b.photo),
         d.sort_order !== undefined ? parseInt(d.sort_order, 10) || 0 : b.sort_order,
         d.address !== undefined ? (String(d.address).trim().slice(0, 200) || null) : b.address,
         d.subtitle !== undefined ? (String(d.subtitle).trim().slice(0, 120) || null) : b.subtitle,
         d.nearby !== undefined ? (String(d.nearby).trim().slice(0, 200) || null) : b.nearby,
         newPhotos ? (newPhotos.length ? JSON.stringify(newPhotos) : null) : b.photos, id);
  if (Array.isArray(d.service_ids)) setBranchServices(id, d.service_ids);
  // Оновити список майстрів філії
  if (Array.isArray(d.master_ids)) {
    db.transaction(function () {
      /* Прибираємо лише додаткові прив'язки. Майстри, для яких ця філія
         основна, завжди залишаються в ній. */
      db.prepare(
        "DELETE FROM branch_masters WHERE branch_id=? AND master_id NOT IN (SELECT id FROM masters WHERE branch_id=?)"
      ).run(id, id);
      const add = db.prepare("INSERT OR IGNORE INTO branch_masters (branch_id,master_id) VALUES (?,?)");
      const setPrimary = db.prepare("UPDATE masters SET branch_id=? WHERE id=? AND branch_id IS NULL");
      d.master_ids.forEach(function (mid) {
        const masterId = parseInt(mid, 10);
        if (!masterId) return;
        add.run(id, masterId);
        setPrimary.run(id, masterId);
      });
      db.prepare(
        "INSERT OR IGNORE INTO branch_masters (branch_id,master_id) SELECT branch_id,id FROM masters WHERE branch_id=?"
      ).run(id);
    })();
  }
  res.json({ ok: true });
});

router.delete("/branches/:id", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  db.transaction(function () {
    db.prepare("DELETE FROM branch_masters WHERE branch_id=?").run(id);
    db.prepare(
      `UPDATE masters
          SET branch_id=(SELECT MIN(bm.branch_id) FROM branch_masters bm JOIN branches b ON b.id=bm.branch_id WHERE bm.master_id=masters.id AND b.active=1)
        WHERE branch_id=?`
    ).run(id);
    db.prepare("UPDATE branches SET active=0 WHERE id=?").run(id);
  })();
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
  const tag = level === "Топ Майстер" ? "(Топ Майстер)" : level === "Експерт" ? "(Експерт)" : "(Майстер)";
  const tagged = db.prepare("SELECT id FROM services WHERE active=1 AND name LIKE ?").all("%" + tag + "%");
  const shared = db.prepare(
    "SELECT id FROM services WHERE active=1 AND name NOT LIKE '%(Майстер)%' AND name NOT LIKE '%(Топ Майстер)%' AND name NOT LIKE '%(Експерт)%'"
  ).all();
  setMasterServices(masterId, tagged.concat(shared).map(function (r) { return r.id; }));
}
/* ---- Графік + перерви ---- */
router.get("/masters/:id/schedule", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  /* Без ?branch — старий режим: усі рядки майстра одразу (потрібно
     календарю-огляду, де графік будується одним запитом на всі філії).
     З ?branch=N — рядки саме цієї філії, а якщо для неї ще нічого не
     задавали персонально, повертаємо спільний (branch_id=0) графік —
     той самий фолбек, що й у day-override та в crm/slots.js. */
  let schedule;
  if (req.query.branch !== undefined) {
    const br = parseInt(req.query.branch, 10) || 0;
    schedule = br
      ? db.prepare("SELECT weekday, work_start, work_end, branch_id FROM master_schedule WHERE master_id=? AND branch_id=? ORDER BY weekday").all(id, br)
      : [];
    if (!schedule.length) {
      schedule = db.prepare("SELECT weekday, work_start, work_end, branch_id FROM master_schedule WHERE master_id=? AND branch_id=0 ORDER BY weekday").all(id);
    }
  } else {
    schedule = db.prepare("SELECT weekday, work_start, work_end, branch_id FROM master_schedule WHERE master_id=? ORDER BY weekday").all(id);
  }
  res.json({
    ok: true,
    schedule: schedule,
    breaks: db.prepare("SELECT id, weekday, break_start, break_end FROM master_breaks WHERE master_id=? ORDER BY weekday, break_start").all(id),
  });
});
/* Всі графіки+перерви для конкретного дня тижня — одним запитом (для календаря) */
router.get("/day-schedules", any, function (req, res) {
  const wd = parseInt(req.query.weekday, 10);
  if (isNaN(wd) || wd < 0 || wd > 6) return res.status(400).json({ ok: false });
  /* branch_id тут потрібен клієнту, щоб визначити, у якій саме філії
     майстер працює цього дня (для позначки філії в шапці розкладу) —
     раніше поле не віддавалось, і клієнт не міг відрізнити філію. */
  const schedules = db.prepare(
    "SELECT ms.master_id, ms.branch_id, ms.work_start, ms.work_end FROM master_schedule ms JOIN masters m ON m.id=ms.master_id WHERE ms.weekday=? AND m.active=1"
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
  /* branch=0 (або без параметра) — «усі філії»: так поводиться графік,
     заведений до появи філій. */
  const br = parseInt(req.query.branch, 10) || 0;
  const ovStmt = db.prepare("SELECT * FROM master_day_overrides WHERE master_id=? AND date=? AND branch_id=?");
  let override = br ? ovStmt.get(id, date, br) : null;
  if (!override) override = ovStmt.get(id, date, 0);
  const d = new Date(date + "T00:00:00");
  const weekday = d.getDay(); // 0=Sun..6=Sat
  const wkStmt = db.prepare("SELECT work_start, work_end FROM master_schedule WHERE master_id=? AND weekday=? AND branch_id=?");
  let weekly = br ? wkStmt.get(id, weekday, br) : null;
  if (!weekly) weekly = wkStmt.get(id, weekday, 0);
  res.json({ ok: true, override: override || null, weekly: weekly || null });
});

router.put("/masters/:id/day-override", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  if (!canEditSchedule(req.session, id)) return res.status(403).json({ ok: false, error: "forbidden" });
  const b = req.body || {};
  const date = b.date;
  if (!tz.isDate(date)) return res.status(400).json({ ok: false, error: "bad date" });
  const isOff = b.is_off ? 1 : 0;
  const ws = (!isOff && b.work_start != null) ? parseInt(b.work_start, 10) : null;
  const we = (!isOff && b.work_end   != null) ? parseInt(b.work_end,   10) : null;
  const br = parseInt(b.branch, 10) || 0;
  db.transaction(function () {
    /* Щойно день виставили для конкретної філії, спільний запис
       «усі філії» на цю дату більше не діє — інакше той самий день
       світився б і в решті філій (це й був баг із дублюванням). */
    if (br) db.prepare("DELETE FROM master_day_overrides WHERE master_id=? AND date=? AND branch_id=0").run(id, date);
    db.prepare("INSERT OR REPLACE INTO master_day_overrides (master_id,date,branch_id,is_off,work_start,work_end) VALUES (?,?,?,?,?,?)")
      .run(id, date, br, isOff, ws, we);
  })();
  res.json({ ok: true });
});

router.delete("/masters/:id/day-override", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  if (!canEditSchedule(req.session, id)) return res.status(403).json({ ok: false, error: "forbidden" });
  const date = req.query.date;
  if (!tz.isDate(date)) return res.status(400).json({ ok: false, error: "bad date" });
  const brDel = parseInt(req.query.branch, 10) || 0;
  db.prepare("DELETE FROM master_day_overrides WHERE master_id=? AND date=? AND branch_id=?").run(id, date, brDel);
  res.json({ ok: true });
});

/* Всі overrides усіх майстрів у діапазоні дат (для таблиці графіку) */
router.get("/masters-overrides", any, function (req, res) {
  const from = (req.query.from || "").slice(0, 10);
  const to   = (req.query.to   || "").slice(0, 10);
  if (!tz.isDate(from) || !tz.isDate(to)) return res.status(400).json({ ok: false, error: "bad dates" });
  const overrides = db.prepare(
    "SELECT master_id, branch_id, date, is_off, work_start, work_end FROM master_day_overrides WHERE date >= ? AND date <= ? ORDER BY master_id, date"
  ).all(from, to);
  res.json({ ok: true, overrides });
});

/* bulk: POST {date_from,date_to,mode,weekdays[],work_start,work_end} */
router.post("/masters/:id/schedule-period", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  if (!canEditSchedule(req.session, id)) return res.status(403).json({ ok: false, error: "forbidden" });
  const b = req.body || {};
  const { date_from, date_to, mode } = b;
  const weekdays = Array.isArray(b.weekdays) ? b.weekdays.map(Number) : [];
  const work_start = parseInt(b.work_start, 10);
  const work_end   = parseInt(b.work_end,   10);
  const br = parseInt(b.branch, 10) || 0;
  if (!tz.isDate(date_from) || !tz.isDate(date_to)) return res.status(400).json({ ok: false, error: "bad dates" });
  const upsert = db.prepare("INSERT OR REPLACE INTO master_day_overrides (master_id,date,branch_id,is_off,work_start,work_end) VALUES (?,?,?,?,?,?)");
  const del    = db.prepare("DELETE FROM master_day_overrides WHERE master_id=? AND date=? AND branch_id=?");
  const del0   = db.prepare("DELETE FROM master_day_overrides WHERE master_id=? AND date=? AND branch_id=0");
  db.transaction(function () {
    /* Дати рахуємо через Date.UTC (не new Date(date+"T00:00:00")) — сервер
       працює в Europe/Kyiv (UTC+3 влітку), тому локальний парсинг опівночі
       й наступний toISOString() зсували весь діапазон на добу назад
       (10–16 серпня насправді записувалось як 9–15). */
    const [fy, fm, fd] = date_from.split("-").map(Number);
    const [ty, tm, td] = date_to.split("-").map(Number);
    const endUtc = Date.UTC(ty, tm - 1, td);
    for (let dUtc = Date.UTC(fy, fm - 1, fd); dUtc <= endUtc; dUtc += 24 * 3600 * 1000) {
      const dObj = new Date(dUtc);
      const ds = dObj.getUTCFullYear() + "-" + String(dObj.getUTCMonth() + 1).padStart(2, "0") + "-" + String(dObj.getUTCDate()).padStart(2, "0");
      const jsDay = dObj.getUTCDay();
      /* Щойно діапазон виставили для конкретної філії, спільний запис
         «усі філії» на ці дати більше не діє — той самий принцип, що й
         у одноденному day-override вище (інакше день і далі світився б
         по фолбеку в інших філіях). */
      if (br) del0.run(id, ds);
      if (mode === "reset")       { del.run(id, ds, br); }
      else if (mode === "day_off"){ upsert.run(id, ds, br, 1, null, null); }
      else if (mode === "by_weekday") {
        // Позначені пігулки — робочі дні; решта днів тижня в діапазоні —
        // вихідні. Раніше невибрані дні просто пропускались (жодного
        // запису в базу), тому зняття всіх позначок нічого не зберігало.
        if (weekdays.indexOf(jsDay) !== -1) upsert.run(id, ds, br, 0, work_start, work_end);
        else upsert.run(id, ds, br, 1, null, null);
      }
      else if (mode === "all_days") { upsert.run(id, ds, br, 0, work_start, work_end); }
    }
  })();
  res.json({ ok: true });
});

router.put("/masters/:id/schedule", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  if (!canEditSchedule(req.session, id)) return res.status(403).json({ ok: false, error: "forbidden" });
  const sched = (req.body && req.body.schedule) || []; // [{weekday,work_start,work_end}]
  const breaks = (req.body && req.body.breaks) || [];   // [{weekday,break_start,break_end}]
  /* branch=0 — старий спільний графік («усі філії»). branch=N — власний
     тижневий графік саме цієї філії: пишемо/чистимо лише рядки з
     branch_id=N, не чіпаючи branch_id=0 чи графіки інших філій — та лишає
     їм чинним спільний фолбек, доки для них теж не задали окремий графік
     (той самий принцип, що й у crm/slots.js workWindow()). */
  const br = parseInt((req.body && req.body.branch), 10) || 0;
  const txn = db.transaction(function () {
    db.prepare("DELETE FROM master_schedule WHERE master_id=? AND branch_id=?").run(id, br);
    db.prepare("DELETE FROM master_breaks WHERE master_id=?").run(id);
    const si = db.prepare("INSERT INTO master_schedule (master_id,weekday,work_start,work_end,branch_id) VALUES (?,?,?,?,?)");
    sched.forEach(function (r) {
      const wd = parseInt(r.weekday, 10), ws = parseInt(r.work_start, 10), we = parseInt(r.work_end, 10);
      if (wd >= 0 && wd <= 6 && ws >= 0 && we > ws) si.run(id, wd, ws, we, br);
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
  const info = db.prepare("INSERT INTO services (name,duration_min,price,active,sort_order,created_at,description) VALUES (?,?,?,1,?,?,?)")
    .run(name, dur, parseInt(d.price, 10) || 0, parseInt(d.sort_order, 10) || 0, Date.now(), clean(d.description, 500) || null);
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.put("/services/:id", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const s = db.prepare("SELECT * FROM services WHERE id=?").get(id);
  if (!s) return res.status(404).json({ ok: false });
  const d = req.body || {};
  const newName = d.name !== undefined ? clean(d.name, 150) : s.name;
  /* Ця вкладка — вільне текстове поле для назви, на відміну від матриці в
     адмінці, де рівень дописується автоматично. Випадкове стирання чи
     спотворення "(Топ Майстер)"/"(Майстер)"/"(Експерт)" в назві миттєво
     й непомітно перетворює послугу зі свого рівня на "спільну" — саме
     цей рядок прив'язує майстра до ціни через master_services. */
  if (serviceLevelTag(newName) !== serviceLevelTag(s.name)) {
    return res.status(400).json({ ok: false, error: "level_tag_mismatch" });
  }
  db.prepare("UPDATE services SET name=?, duration_min=?, price=?, sort_order=?, description=? WHERE id=?").run(
    newName,
    d.duration_min !== undefined ? (parseInt(d.duration_min, 10) || s.duration_min) : s.duration_min,
    d.price !== undefined ? (parseInt(d.price, 10) || 0) : s.price,
    d.sort_order !== undefined ? parseInt(d.sort_order, 10) || 0 : s.sort_order,
    d.description !== undefined ? (clean(d.description, 500) || null) : s.description,
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
    const prefix = q + "%";
    /* LOWERU (не вбудований LOWER) — щоб пошук по імені не залежав від
       регістру й для кириличних імен теж (LOWER() в SQLite опускає лише ASCII).

       Сортуємо за релевантністю, а не лише за датою останнього візиту:
       точний збіг → початок імені → решта. Раніше все впорядковувалось за
       last_visit_at, тож НОВИЙ клієнт (візитів ще немає → NULL) опинявся в
       самому кінці. Клієнтку на ім'я просто «Валерія» серед дев'яти
       «…Валерія» відкидало на 9-те місце, а список у формі запису показує
       лише 8 — і за іменем її було не знайти, лише за телефоном. */
    rows = db.prepare(
      `SELECT * FROM clients
        WHERE LOWERU(name) LIKE LOWERU(?) OR phone LIKE ?
        ORDER BY
          CASE WHEN LOWERU(name) = LOWERU(?) THEN 0
               WHEN LOWERU(name) LIKE LOWERU(?) THEN 1
               ELSE 2 END,
          last_visit_at DESC NULLS LAST
        LIMIT 200`
    ).all(like, like, q, prefix);
  } else {
    rows = db.prepare("SELECT * FROM clients ORDER BY last_visit_at DESC NULLS LAST, id DESC LIMIT 200").all();
  }
  /* visit_count рахує лише ЗАВЕРШЕНІ візити, тому в клієнта з активним
     записом там чесний 0 — і це збивало з пантелику («запис же є, а
     візитів 0»). Додаємо кількість актуальних записів, щоб у списку було
     видно, що клієнт не «порожній». */
  if (rows.length) {
    const cnt = db.prepare(
      `SELECT COUNT(*) c FROM appointments
        WHERE client_id=? AND status IN ('pending','confirmed')`
    );
    rows = rows.map(function (c) {
      let n = 0;
      try { n = cnt.get(c.id).c; } catch (e) {}
      return Object.assign({}, c, { active_appointments: n });
    });
  }
  const showPhone = canSeePhones(req.session);
  rows = rows.map(function(c) { return protectClientPhone(c, showPhone); });
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
    `SELECT a.id, a.date, a.start_min, a.end_min, a.status, a.service_id, a.master_id,
            a.duration_min, a.price, a.extra_services,
            s.name service_name, m.name master_name
       FROM appointments a JOIN services s ON s.id=a.service_id JOIN masters m ON m.id=a.master_id
      WHERE a.client_id=? ORDER BY a.date DESC, a.start_min DESC`
  ).all(id).map(viewAppt);
  client = protectClientPhone(client, req.session);
  res.json({ ok: true, client: client, history: history });
});
router.patch("/clients/:id", any, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const d = req.body || {};
  const c = db.prepare("SELECT * FROM clients WHERE id=?").get(id);
  if (!c) return res.status(404).json({ ok: false });
  const canEditPhone = canSeePhones(req.session);
  db.prepare("UPDATE clients SET name=?, phone=?, note=?, blacklisted=?, birthday=? WHERE id=?").run(
    d.name        !== undefined ? clean(d.name,  100)  : c.name,
    d.phone       !== undefined && canEditPhone ? (clean(d.phone, 30) || null) : c.phone,
    d.note        !== undefined ? clean(d.note, 1000)  : c.note,
    d.blacklisted !== undefined ? (d.blacklisted ? 1 : 0) : (c.blacklisted || 0),
    /* День народження: 'YYYY-MM-DD' або порожньо (null) — для SMS-привітання */
    d.birthday    !== undefined ? (tz.isDate(String(d.birthday || "")) ? String(d.birthday) : null) : (c.birthday || null),
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
  /* Порівнюємо за НОРМАЛІЗОВАНИМ номером (як createAppointment/by-phone) —
     у базі трапляються обидва формати (097… і +380…), тож звичайний
     INSERT OR IGNORE (точний збіг рядка) пропустив би дублі й наплодив би
     other-format картки для вже наявних клієнтів. */
  const existingPhones = new Set(
    db.prepare("SELECT phone FROM clients WHERE phone IS NOT NULL").all()
      .map(function (r) { return tz.normPhone(r.phone); })
  );
  const ins = db.prepare("INSERT INTO clients (phone, name, note, visit_count, last_visit_at, created_at) VALUES (?,?,?,?,?,?)");
  const txn = db.transaction(function () {
    let inserted = 0, skipped = 0;
    rows.forEach(function (r) {
      const rawPhone = String(r.phone || "").trim();
      const name = String(r.name || "").trim();
      if (!rawPhone || !name) return;
      const phone = tz.normPhone(rawPhone) || rawPhone;
      if (existingPhones.has(phone)) { skipped++; return; }
      existingPhones.add(phone); // дублі всередині самого файлу теж не плодимо
      ins.run(phone, name, r.note || null, r.visit_count || 0, r.last_visit_at || null, r.created_at || Date.now());
      inserted++;
    });
    return { inserted, skipped };
  });
  const result = txn();
  res.json({ ok: true, inserted: result.inserted, skipped: result.skipped, total: rows.length });
});

/* ---- Telegram-сповіщення майстру ----
   Майстер керує лише своєю прив'язкою, власник — будь-чиєю (щоб міг
   підключити майстра, який сам не впорався).
   Юзернейм бота — не секрет (він і так видимий у посиланні t.me/…), тому
   тримаємо робоче значення тут: інакше фіча мовчки не працює, доки хтось
   не додасть змінну на Railway. Змінною можна перевизначити. */
const TG_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "oliva_massage_bot";
function tgTargetMaster(req) {
  if (req.session.role === "owner") {
    const id = parseInt(req.query.master || req.body.master, 10);
    return id || null;
  }
  return req.session.masterId || null;
}

router.get("/telegram/status", any, function (req, res) {
  const id = tgTargetMaster(req);
  if (!id) return res.status(400).json({ ok: false, error: "no_master" });
  const m = db.prepare("SELECT name, tg_chat_id, tg_linked_at FROM masters WHERE id=?").get(id);
  if (!m) return res.status(404).json({ ok: false, error: "not_found" });
  res.json({
    ok: true,
    master: m.name,
    linked: !!m.tg_chat_id,
    linked_at: m.tg_linked_at || null,
    bot: TG_BOT_USERNAME,
  });
});

router.post("/telegram/link-code", any, function (req, res) {
  const id = tgTargetMaster(req);
  if (!id) return res.status(400).json({ ok: false, error: "no_master" });
  const bot = TG_BOT_USERNAME;
  if (!bot) return res.status(503).json({ ok: false, error: "bot_not_configured" });
  /* Код одноразовий і живе 15 хв — його видно на екрані й у посиланні,
     тож він не має лишатись дійсним назавжди. */
  const code = crypto.randomBytes(6).toString("hex");
  const expires = Date.now() + 15 * 60 * 1000;
  db.prepare("UPDATE masters SET tg_link_code=?, tg_code_expires=? WHERE id=?").run(code, expires, id);
  res.json({ ok: true, url: `https://t.me/${bot}?start=${code}`, expires_at: expires });
});

router.post("/telegram/unlink", any, function (req, res) {
  const id = tgTargetMaster(req);
  if (!id) return res.status(400).json({ ok: false, error: "no_master" });
  db.prepare("UPDATE masters SET tg_chat_id=NULL, tg_link_code=NULL, tg_code_expires=NULL, tg_linked_at=NULL WHERE id=?").run(id);
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
    /* total не враховує скасовані — так само, як бейджі кількості записів
       у місячному календарі (GET /appointments/month-counts). Раніше total
       рахував і скасовані, тому «Сьогодні/Тиждень/Місяць» на дашборді не
       збігалося з тим, що власник бачить у календарі. */
    const r = db.prepare(
      `SELECT
         SUM(CASE WHEN status<>'cancelled' THEN 1 ELSE 0 END) total,
         SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,
         SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled,
         SUM(CASE WHEN status='no_show'   THEN 1 ELSE 0 END) no_show,
         SUM(CASE WHEN status IN ('pending','confirmed') THEN 1 ELSE 0 END) active
       FROM appointments WHERE date >= ? AND date <= ?`
    ).get(from, to);
    r.total = r.total || 0;
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

    /* Заробіток майстра за місяць (ставки: % або фікс на послугу) */
    m.earnings = masterEarnings(m.id, mStart, today);
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

  // ── Лояльність до майстра (у межах вибраного періоду, як і решта
  //    показників на цій вкладці — інакше цифри не збігаються з іншими
  //    картками при зміні дат) ─────────────────────────────────────
  const masters = db.prepare("SELECT id, name FROM masters WHERE active=1").all();
  const masterLoyalty = masters.map(function(m) {
    const total = db.prepare(
      `SELECT COUNT(DISTINCT client_id) v FROM appointments WHERE master_id=? AND status='completed' AND date>=? AND date<=?`
    ).get(m.id, from, to).v;
    const returning = db.prepare(
      `SELECT COUNT(*) v FROM (
         SELECT client_id FROM appointments
          WHERE master_id=? AND status='completed' AND date>=? AND date<=?
          GROUP BY client_id HAVING COUNT(*)>1
       )`
    ).get(m.id, from, to).v;
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
  const today = tz.todayKyiv();
  const from = clean(req.query.from, 10) || (function() {
    const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 29);
    return d.toISOString().slice(0, 10);
  })();
  const to = clean(req.query.to, 10) || today;
  if (!tz.isDate(from) || !tz.isDate(to) || from > to) {
    return res.status(400).json({ ok: false, error: "bad period" });
  }
  const end = new Date(to + "T12:00:00Z"); end.setUTCDate(end.getUTCDate() + 1);
  const fromMs = tz.apptInstant(from, 0);
  const toMs = tz.apptInstant(end.toISOString().slice(0, 10), 0);
  const range = "created_at>=? AND created_at<?";

  // Відвідування по днях за обраний період
  const visitsByDay = db.prepare(`
    SELECT substr(datetime(created_at/1000,'unixepoch','localtime'),1,10) day,
           COUNT(*) total,
           COUNT(DISTINCT ip_hash) uniq
    FROM page_visits WHERE event='pageview' AND ${range}
    GROUP BY day ORDER BY day
  `).all(fromMs, toMs);

  const kPeriod = db.prepare(
    "SELECT COUNT(*) n, COUNT(DISTINCT ip_hash) u FROM page_visits WHERE event='pageview' AND " + range
  ).get(fromMs, toMs);

  // Топ сторінок
  const topPages = db.prepare(`
    SELECT path, COUNT(*) total, COUNT(DISTINCT ip_hash) uniq
    FROM page_visits WHERE event='pageview' AND ${range}
    GROUP BY path ORDER BY total DESC LIMIT 10
  `).all(fromMs, toMs);

  // Пристрої
  const devices = db.prepare(`
    SELECT ua_type, COUNT(*) n FROM page_visits WHERE event='pageview' AND ${range} GROUP BY ua_type
  `).all(fromMs, toMs);

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
    FROM page_visits WHERE event='pageview' AND ${range}
    GROUP BY src ORDER BY n DESC LIMIT 8
  `).all(fromMs, toMs);

  // Кліки (кнопки/посилання)
  const clicks = db.prepare(`
    SELECT label, COUNT(*) n
    FROM page_visits WHERE event='click' AND ${range}
    GROUP BY label ORDER BY n DESC LIMIT 10
  `).all(fromMs, toMs);

  // Години активності
  const byHour = db.prepare(`
    SELECT CAST(strftime('%H', datetime(created_at/1000,'unixepoch','localtime')) AS INTEGER) hour,
           COUNT(*) n
    FROM page_visits WHERE event='pageview' AND ${range}
    GROUP BY hour ORDER BY hour
  `).all(fromMs, toMs);

  res.json({
    ok: true,
    period: { from, to },
    kpi: { period: kPeriod },
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
  const checkIds = subServiceIds(serviceId);
  const row = db.prepare(
    `SELECT sub.*, s.name service_name FROM subscriptions sub JOIN services s ON s.id=sub.service_id
      WHERE sub.client_id=? AND sub.service_id IN (${inList(checkIds.length)}) AND sub.used_sessions < sub.total_sessions
      ORDER BY sub.created_at ASC LIMIT 1`
  ).get(clientId, ...checkIds);
  res.json({ ok: true, active: row || null });
});

router.post("/subscriptions", any, function (req, res) {
  const b = req.body || {};
  const clientId  = parseInt(b.client_id,  10);
  const serviceId = parseInt(b.service_id, 10);
  const total     = parseInt(b.total_sessions, 10);
  const price     = parseInt(b.price || 0, 10);
  const note      = clean(b.note, 300) || null;
  // Якщо абонемент оформлюють одразу при створенні запису (перший сеанс
  // уже зараховано через used_sessions) — цей самий візит слід позначити
  // subscription_used, інакше при завершенні візиту автосписання
  // спише ще один сеанс за той самий прийом (подвійне списання).
  const appointmentId = parseInt(b.appointment_id, 10) || null;
  if (!clientId || !serviceId || !total || total < 1)
    return res.status(400).json({ ok: false, error: "missing fields" });
  const usedInit = Math.min(parseInt(b.used_sessions || 0, 10) || 0, total);
  let subId;
  db.transaction(function () {
    const info = db.prepare(
      "INSERT INTO subscriptions (client_id,service_id,total_sessions,used_sessions,price,note,created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(clientId, serviceId, total, usedInit, price, note, Date.now());
    subId = info.lastInsertRowid;
    if (appointmentId && usedInit > 0) {
      const appt = db.prepare("SELECT id, client_id FROM appointments WHERE id=?").get(appointmentId);
      if (appt && appt.client_id === clientId) {
        db.prepare("UPDATE appointments SET subscription_used=1, subscription_session_no=?, subscription_session_total=? WHERE id=?")
          .run(usedInit, total, appointmentId);
      }
    }
  })();
  res.json({ ok: true, id: subId });
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

/* ---- Зарплата майстра: ставки і заробіток ---- */
router.get("/masters/:id/pay", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  const m = db.prepare("SELECT id, name, last_name, pay_percent, pay_percent_return, pay_percent_subscription FROM masters WHERE id=?").get(id);
  if (!m) return res.status(404).json({ ok: false });
  const services = db.prepare(
    `SELECT s.id, s.name, s.price FROM master_services ms
       JOIN services s ON s.id = ms.service_id
      WHERE ms.master_id=? AND s.active=1 ORDER BY s.name`
  ).all(id);
  const overrides = db.prepare(
    "SELECT service_id, mode, value, value_return FROM master_service_pay WHERE master_id=?"
  ).all(id);
  const subOverrides = db.prepare(
    "SELECT service_id, value FROM master_subscription_pay WHERE master_id=?"
  ).all(id);
  const today = tz.nowKyiv().date;
  const dt = new Date(today + "T00:00:00");
  const dow = dt.getDay() === 0 ? 6 : dt.getDay() - 1;
  const ws = new Date(dt); ws.setDate(dt.getDate() - dow);
  const wStart = ws.toISOString().slice(0, 10);
  const mStart = today.slice(0, 7) + "-01";
  res.json({
    ok: true, master: m, services: services, overrides: overrides, sub_overrides: subOverrides,
    earnings: {
      today: masterEarnings(id, today, today),
      week:  masterEarnings(id, wStart, today),
      month: masterEarnings(id, mStart, today),
    },
  });
});

router.patch("/masters/:id/pay", owner, function (req, res) {
  const id = parseInt(req.params.id, 10);
  if (!db.prepare("SELECT id FROM masters WHERE id=?").get(id)) return res.status(404).json({ ok: false });
  const d = req.body || {};
  function pct(x, label) {
    if (x === undefined || x === null || x === "") return null;
    const v = parseFloat(x);
    if (!isFinite(v) || v < 0 || v > 100) throw new Error(label + ": число 0–100");
    return v;
  }
  let pp, ppRet, ppSub;
  try {
    pp    = pct(d.pay_percent, "Відсоток (новий клієнт)");
    ppRet = pct(d.pay_percent_return, "Відсоток (повторний клієнт)");
    ppSub = pct(d.pay_percent_subscription, "Відсоток (абонемент)");
  } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  const list = Array.isArray(d.overrides) ? d.overrides : [];
  for (const o of list) {
    const sid = parseInt(o.service_id, 10);
    const mode = o.mode === "fixed" ? "fixed" : "percent";
    const val = parseFloat(o.value);
    if (!sid || !isFinite(val) || val < 0) return res.status(400).json({ ok: false, error: "Некоректна ставка" });
    if (mode === "percent" && val > 100) return res.status(400).json({ ok: false, error: "Відсоток: 0–100" });
    if (o.value_return !== undefined && o.value_return !== null && o.value_return !== "") {
      const vr = parseFloat(o.value_return);
      if (!isFinite(vr) || vr < 0) return res.status(400).json({ ok: false, error: "Некоректна ставка (повторний)" });
      if (mode === "percent" && vr > 100) return res.status(400).json({ ok: false, error: "Відсоток (повторний): 0–100" });
    }
  }
  const subList = Array.isArray(d.sub_overrides) ? d.sub_overrides : [];
  for (const o of subList) {
    const sid = parseInt(o.service_id, 10);
    const val = parseFloat(o.value);
    if (!sid || !isFinite(val) || val < 0 || val > 100) return res.status(400).json({ ok: false, error: "Відсоток (абонемент): 0–100" });
  }
  db.transaction(function () {
    db.prepare("UPDATE masters SET pay_percent=?, pay_percent_return=?, pay_percent_subscription=? WHERE id=?").run(pp, ppRet, ppSub, id);
    db.prepare("DELETE FROM master_service_pay WHERE master_id=?").run(id);
    const ins = db.prepare("INSERT INTO master_service_pay (master_id, service_id, mode, value, value_return) VALUES (?,?,?,?,?)");
    for (const o of list) {
      const vr = (o.value_return === undefined || o.value_return === null || o.value_return === "") ? null : parseFloat(o.value_return);
      ins.run(id, parseInt(o.service_id, 10), o.mode === "fixed" ? "fixed" : "percent", parseFloat(o.value), vr);
    }
    db.prepare("DELETE FROM master_subscription_pay WHERE master_id=?").run(id);
    const insSub = db.prepare("INSERT INTO master_subscription_pay (master_id, service_id, value) VALUES (?,?,?)");
    for (const o of subList) {
      insSub.run(id, parseInt(o.service_id, 10), parseFloat(o.value));
    }
  })();
  res.json({ ok: true });
});

/* ---- Налаштування SMS-сповіщень (перемикачі + час нагадувань) ---- */
/* Баланс SMS-провайдера (лише alphasms — інші драйвери не мають такого API).
   Саме поповнення робиться на стороні AlphaSMS (alphasms.ua/panel/) —
   провайдер не дає API для оплати, лише для перевірки балансу. */
router.get("/notify-balance", owner, async function (req, res) {
  const notify = require("./notify");
  if (notify.DRIVER_NAME !== "alphasms" || typeof notify.driver.getBalance !== "function") {
    return res.json({ ok: true, supported: false });
  }
  try {
    const b = await notify.driver.getBalance();
    res.json({ ok: true, supported: true, amount: b.amount, currency: b.currency });
  } catch (e) {
    res.json({ ok: false, supported: true, error: e.message });
  }
});

/* Ключі текстів шаблонів SMS (app_settings, "tpl_"+kind) — власник може
   переписати їх у CRM → Сповіщення; порожньо/не задано = типовий текст,
   зашитий у crm/notify.js (renderTemplate). Той самий список тут і там. */
const TEMPLATE_KINDS = ["confirmation", "reschedule", "cancellation", "birthday", "reminder"];

router.get("/notify-settings", owner, function (req, res) {
  function get(k, dflt) {
    const r = db.prepare("SELECT value FROM app_settings WHERE key=?").get(k);
    return r ? r.value : dflt;
  }
  const templates = {};
  TEMPLATE_KINDS.forEach(function (k) { templates[k] = get("tpl_" + k, "") || null; });
  res.json({
    ok: true,
    reminder1_hours: parseFloat(get("reminder1_hours", "24")) || 0,
    reminder2_hours: parseFloat(get("reminder2_hours", process.env.REMINDER2_HOURS || "0")) || 0,
    notif_confirm:       get("notif_confirm", "1") === "1",
    notif_confirm_staff: get("notif_confirm_staff", "1") === "1",
    notif_reschedule:    get("notif_reschedule", "0") === "1",
    notif_cancel:        get("notif_cancel", "0") === "1",
    notif_birthday:      get("notif_birthday", "1") === "1",
    templates: templates,
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
  ["notif_confirm", "notif_confirm_staff", "notif_reschedule", "notif_cancel", "notif_birthday"].forEach(function (k) {
    if (d[k] !== undefined) up.run(k, d[k] ? "1" : "0");
  });
  /* Тексти шаблонів — порожній рядок від клієнта означає "скинути на
     типовий", тому видаляємо ключ замість запису порожнього значення
     (інакше customTemplate() у notify.js сплутав би "" з переписаним
     текстом і однаково повернув би порожню SMS). Ліміт 1 SMS-частини —
     280 симв. з запасом (кирилиця йде по 70 симв./частину, довший
     текст просто піде кількома частинами, але без обмеження хтось міг
     би випадково вставити цілий абзац). */
  if (d.templates && typeof d.templates === "object") {
    const del = db.prepare("DELETE FROM app_settings WHERE key=?");
    TEMPLATE_KINDS.forEach(function (k) {
      if (!(k in d.templates)) return;
      const text = String(d.templates[k] || "").slice(0, 280).trim();
      if (text) up.run("tpl_" + k, text); else del.run("tpl_" + k);
    });
  }
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

/* ---- Медіа головного екрану сайту (фото-заставка + відео) ----
   Файли пишемо на Railway Volume (поруч із базою), бо public/ живе лише
   до наступного деплою. У app_settings зберігаємо готовий URL; порожній
   рядок = повернутись до типового файлу з репозиторію. */
const fsMedia = require("fs");
const pathMedia = require("path");
const SITE_MEDIA_DIR = pathMedia.join(
  pathMedia.dirname(process.env.DB_FILE || pathMedia.join(__dirname, "..", "data", "oliva.db")),
  "media", "site"
);
const HERO_KEYS = { photo: "hero_photo_url", video: "hero_video_url" };
const HERO_EXT = {
  photo: { jpg: 1, jpeg: 1, png: 1, webp: 1 },
  video: { mp4: 1, webm: 1, mov: 1 },
};
const HERO_MAX = { photo: 12 * 1024 * 1024, video: 60 * 1024 * 1024 };

function heroGet(key) {
  const r = db.prepare("SELECT value FROM app_settings WHERE key=?").get(key);
  return r && r.value ? r.value : "";
}
function heroSet(key, value) {
  db.prepare("INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, value || "");
}
/* Старий файл прибираємо одразу — інакше том поступово забʼється
   відеофайлами, які вже ніде не показуються. Видаляємо лише те, що
   лежить у нашій теці (типові файли з /assets не чіпаємо). */
function heroDropOld(url) {
  if (!url || url.indexOf("/api/site-media/") !== 0) return;
  try { fsMedia.unlinkSync(pathMedia.join(SITE_MEDIA_DIR, pathMedia.basename(url))); } catch (_) {}
}

router.get("/hero-media", owner, function (req, res) {
  res.json({ ok: true, photo: heroGet(HERO_KEYS.photo), video: heroGet(HERO_KEYS.video) });
});

/* Тіло приходить бінарно (application/octet-stream), а не base64: відео
   на 40 МБ у dataURL роздулось би до ~54 МБ і не пролізло б у ліміт JSON. */
router.post(
  "/hero-media/:kind",
  owner,
  express.raw({ type: "*/*", limit: "64mb" }),
  function (req, res) {
    const kind = req.params.kind === "video" ? "video" : "photo";
    const ext = String(req.query.ext || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
    if (!HERO_EXT[kind][ext]) {
      return res.status(400).json({ ok: false, error: "Формат не підтримується" });
    }
    const buf = req.body;
    if (!buf || !buf.length) return res.status(400).json({ ok: false, error: "Порожній файл" });
    if (buf.length > HERO_MAX[kind]) {
      return res.status(413).json({ ok: false, error: "Файл завеликий (макс " + Math.round(HERO_MAX[kind] / 1048576) + " МБ)" });
    }
    const filename = "hero-" + kind + "-" + crypto.randomBytes(8).toString("hex") + "." + ext;
    try {
      fsMedia.mkdirSync(SITE_MEDIA_DIR, { recursive: true });
      fsMedia.writeFileSync(pathMedia.join(SITE_MEDIA_DIR, filename), buf);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
    const prev = heroGet(HERO_KEYS[kind]);
    const url = "/api/site-media/" + filename;
    heroSet(HERO_KEYS[kind], url);
    heroDropOld(prev);
    res.json({ ok: true, kind: kind, url: url });
  }
);

/* Повернути типове (те, що в репозиторії) */
router.delete("/hero-media/:kind", owner, function (req, res) {
  const kind = req.params.kind === "video" ? "video" : "photo";
  const prev = heroGet(HERO_KEYS[kind]);
  heroSet(HERO_KEYS[kind], "");
  heroDropOld(prev);
  res.json({ ok: true, kind: kind, url: "" });
});

/* ============================================================
   Подарункові сертифікати — паперові, продані офлайн. Онлайн-купівлі
   на сайті (public/certificate.html) до цього журналу не мають
   стосунку — то лише заявка в Telegram, ніякої перевірки чи номера.
   Тут майстер/власник при записі клієнта, що платить сертифікатом,
   вручну вписує порядковий номер із самого паперового сертифіката —
   просто щоб власник бачив, скільки сертифікатів відпрацьовано.
   Жодної перевірки дійсності — номер лише фіксується в журналі. */
/* Перевірка "чи вже занесено такий номер" — і для майстра теж (він сам
   вписує номер), тому лише true/false, без деталей чужого запису. */
/* Статус номера сертифіката — без деталей чужого запису (лише для
   майстра, що вводить номер, чи можна ним розрахуватись):
     free      — такого номера ще немає, можна занести як новий
     available — є замовлення з сайту на цей номер, ще не використане — можна прийняти
     used      — уже використаний раніше, прийняти не можна
     cancelled — скасований, прийняти не можна */
router.get("/certificates/exists", any, function (req, res) {
  const code = clean(req.query.code, 50);
  if (!code) return res.json({ ok: true, exists: false, state: "free" });
  const row = db.prepare("SELECT status FROM certificates WHERE code=?").get(code);
  let state = "free";
  if (row) state = row.status === "ordered" ? "available" : row.status;
  res.json({ ok: true, exists: !!row, state: state });
});

/* Ручне додавання сертифіката — напр. продали офлайн, не через форму
   на сайті, або майстер заносить номер із паперового бланка. Номер
   обов'язковий (це і є сертифікат — без нього нема що заносити);
   решта полів (покупець, отримувач, послуга, сума) необов'язкові —
   майстер міг просто не мати цієї інформації. */
router.post("/certificates", any, function (req, res) {
  const b = req.body || {};
  const code = clean(b.code, 50);
  if (!code) return res.status(400).json({ ok: false, error: "code required" });
  const buyerName = clean(b.buyer_name, 100) || "—";
  const buyerPhone = clean(b.buyer_phone, 30);
  const recipient = clean(b.recipient, 100) || null;
  const serviceLabel = clean(b.service_label, 200) || null;
  const amount = Math.round((parseFloat(b.amount) || 0) * 100);
  const certType = clean(b.cert_type, 30) || null;
  const delivery = clean(b.delivery, 50) || null;
  const address = clean(b.address, 200) || null;
  const wishes = clean(b.wishes, 500) || null;
  const now = Date.now();
  const TWO_MONTHS_MS = 61 * 24 * 60 * 60 * 1000;
  try {
    const txn = db.transaction(function () {
      db.prepare(
        `INSERT INTO certificates
           (code, buyer_name, buyer_phone, recipient, service_label, amount, cert_type, delivery, address, wishes, status, created_at, expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'ordered', ?, ?)`
      ).run(code, buyerName, buyerPhone, recipient, serviceLabel, amount, certType, delivery, address, wishes, now, now + TWO_MONTHS_MS);
    });
    txn();
    res.json({ ok: true, code: code });
  } catch (e) {
    if (String(e.message).indexOf("UNIQUE") !== -1) return res.status(409).json({ ok: false, error: "duplicate" });
    console.error("[certificates create]", e.message);
    res.status(500).json({ ok: false });
  }
});

router.get("/certificates", any, function (req, res) {
  const q = clean(req.query.q, 100);
  let sql = "SELECT * FROM certificates WHERE 1=1";
  const args = [];
  if (q) {
    sql += " AND (code LIKE ? OR buyer_phone LIKE ? OR buyer_name LIKE ? OR recipient LIKE ?)";
    const like = "%" + q + "%";
    args.push(like, like, like, like);
  }
  sql += " ORDER BY created_at DESC LIMIT 300";
  const stmt = db.prepare(sql);
  res.json({ ok: true, certificates: stmt.all.apply(stmt, args) });
});

/* Записати в журнал номер сертифіката, яким клієнт розрахувався за
   appointment_id. Дані клієнта/послуги підтягуємо із самого запису —
   майстру не треба нічого вводити, крім номера. */
router.post("/certificates/log", any, function (req, res) {
  const b = req.body || {};
  const code = clean(b.code, 50);
  const appointmentId = parseInt(b.appointment_id, 10) || null;
  if (!code) return res.status(400).json({ ok: false, error: "code required" });

  const a = appointmentId ? db.prepare(
    `SELECT a.price, c.name client_name, c.phone client_phone, s.name service_name
       FROM appointments a JOIN clients c ON c.id=a.client_id JOIN services s ON s.id=a.service_id
      WHERE a.id=?`
  ).get(appointmentId) : null;

  const who = req.session.role === "owner" ? "власник"
    : (db.prepare("SELECT name FROM masters WHERE id=?").get(req.session.masterId) || {}).name || "майстер";
  const now = Date.now();
  try {
    const existing = db.prepare("SELECT id, status FROM certificates WHERE code=?").get(code);
    if (existing) {
      // Замовлення з сайту (ще не використане) — позначаємо використаним
      // саме цей рядок, а не заводимо дублікат номера.
      if (existing.status !== "ordered") {
        return res.status(409).json({ ok: false, error: existing.status === "used" ? "used" : "cancelled" });
      }
      db.prepare(
        "UPDATE certificates SET status='used', used_at=?, used_by_appointment_id=?, used_note=? WHERE id=?"
      ).run(now, appointmentId, who, existing.id);
      return res.json({ ok: true, id: existing.id });
    }
    const info = db.prepare(
      `INSERT INTO certificates
         (code, buyer_name, buyer_phone, service_label, amount, status, used_at, used_by_appointment_id, used_note, created_at, expires_at)
       VALUES (?,?,?,?,?, 'used', ?, ?, ?, ?, ?)`
    ).run(
      code,
      a ? a.client_name : "—",
      a ? a.client_phone : "",
      a ? a.service_name : null,
      a ? a.price : 0,
      now, appointmentId, who, now, now
    );
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).indexOf("UNIQUE") !== -1) {
      return res.status(409).json({ ok: false, error: "duplicate" });
    }
    console.error("[certificates/log]", e.message);
    res.status(500).json({ ok: false });
  }
});

/* Прибрати помилковий запис у журналі — власник. */
router.delete("/certificates/:id", owner, function (req, res) {
  db.prepare("DELETE FROM certificates WHERE id=?").run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

module.exports = router;
module.exports.setStatus = setStatus;
module.exports.viewAppt = viewAppt;
