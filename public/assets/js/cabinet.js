/* ============================================================
   cabinet.js — кабінет CRM Oliva (власник + майстер).
   Логіка вкладок, списків і модалок. Усі дані через /api/crm/*.
   ============================================================ */
(function () {
  "use strict";

  var ME = { role: null, masterId: null };
  var DOW = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  var STATUS_LABEL = { pending: "Очікує", confirmed: "Підтверджено", completed: "Завершено", cancelled: "Скасовано", no_show: "Не прийшов" };

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function money(kop) { return kop ? (kop / 100).toFixed(0) + " грн" : "—"; }
  function fmtMin(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  function ddmm(d) { var p = d.split("-"); return p[2] + "." + p[1]; }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function dowOf(d) { return DOW[new Date(d + "T00:00:00").getDay()]; }

  function api(method, url, body) {
    var opts = { method: method, headers: {} };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { code: r.status, j: j }; });
    });
  }

  /* ---------- modal ---------- */
  function openModal(html) { $("modalCard").innerHTML = html; $("modal").classList.add("on"); }
  function closeModal() { $("modal").classList.remove("on"); $("modalCard").innerHTML = ""; }
  $("modal").addEventListener("click", function (e) { if (e.target === $("modal")) closeModal(); });

  /* ============================================================
     LOGIN
     ============================================================ */
  function doLogin() {
    var user = $("loginUser").value.trim();
    var pass = $("loginPass").value;
    var body = user ? { username: user, password: pass } : { password: pass };
    api("POST", "/api/admin/login", body).then(function (res) {
      if (res.code === 200 && res.j.ok) boot(res.j);
      else $("loginErr").textContent = "Невірний логін або пароль";
    }).catch(function () { $("loginErr").textContent = "Помилка зʼєднання"; });
  }
  $("loginBtn").addEventListener("click", doLogin);
  $("loginPass").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
  $("logoutBtn").addEventListener("click", function () {
    api("POST", "/api/admin/logout").then(function () { location.reload(); });
  });

  // авто-вхід якщо є cookie
  api("GET", "/api/admin/me").then(function (res) { if (res.j && res.j.ok) boot(res.j); });

  /* ============================================================
     BOOT + TABS
     ============================================================ */
  var TABS = [];
  function boot(me) {
    ME.role = me.role; ME.masterId = me.masterId;
    $("login").style.display = "none";
    $("app").classList.add("on");
    $("roleTag").textContent = me.role === "owner" ? "Власник" : "Майстер";

    TABS = [];
    if (me.role === "owner") {
      TABS.push({ id: "dashboard", name: "📊 Дашборд", render: renderDashboard });
    }
    TABS.push({ id: "appts", name: "Записи", render: renderAppts });
    TABS.push({ id: "clients", name: "Клієнти", render: renderClients });
    if (me.role === "owner") {
      TABS.push({ id: "services", name: "Послуги", render: renderServices });
      TABS.push({ id: "masters", name: "Майстри", render: renderMasters });
      TABS.push({ id: "users", name: "Доступи", render: renderUsers });
      TABS.push({ id: "notif", name: "Сповіщення", render: renderNotif });
    }
    var tabsEl = $("tabs"); tabsEl.innerHTML = "";
    TABS.forEach(function (t, i) {
      var b = el("button", "tab" + (i === 0 ? " on" : ""), t.name);
      b.addEventListener("click", function () {
        tabsEl.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on"); t.render();
      });
      tabsEl.appendChild(b);
    });
    TABS[0].render();
  }

  /* ============================================================
     ЗАПИСИ
     ============================================================ */
  /* ============================================================
     ДАШБОРД
     ============================================================ */
  function renderDashboard() {
    var main = $("main"); main.innerHTML = '<div class="empty">Завантаження…</div>';
    api("GET", "/api/crm/dashboard").then(function (res) {
      if (!res.j.ok) { main.innerHTML = '<div class="empty">Помилка завантаження</div>'; return; }
      var d = res.j;
      main.innerHTML = "";

      // helper
      function grn(kop) { return kop ? Math.round(kop / 100).toLocaleString("uk-UA") + " грн" : "0 грн"; }
      function card(title, content) {
        var w = el("div", "item"); w.style.marginBottom = "14px";
        var h = el("div", ""); h.style.cssText = "font-family:'Playfair Display',serif;color:var(--cream);font-size:1rem;font-weight:500;margin-bottom:12px;";
        h.textContent = title; w.appendChild(h);
        var c = el("div", ""); c.innerHTML = content; w.appendChild(c);
        return w;
      }
      function row3(items) {
        var g = el("div", ""); g.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;";
        items.forEach(function(it) {
          var b = el("div", ""); b.style.cssText = "background:rgba(46,61,34,.22);border:1px solid var(--line);border-radius:10px;padding:10px 12px;text-align:center;";
          b.innerHTML = '<div style="font-size:.72rem;color:var(--text-dim);margin-bottom:3px;">' + it.label + '</div><div style="color:var(--cream);font-weight:600;font-size:1rem;">' + it.val + '</div>';
          g.appendChild(b);
        });
        return g;
      }
      function tbl(heads, rows) {
        var t = '<table style="width:100%;border-collapse:collapse;font-size:.82rem;">';
        t += '<tr>' + heads.map(function(h) { return '<th style="text-align:left;color:var(--text-dim);padding:4px 6px;font-weight:500;border-bottom:1px solid var(--line);">' + h + '</th>'; }).join("") + '</tr>';
        rows.forEach(function(r) {
          t += '<tr>' + r.map(function(c) { return '<td style="padding:6px 6px;border-bottom:1px solid rgba(122,145,86,.08);color:var(--cream);">' + c + '</td>'; }).join("") + '</tr>';
        });
        t += '</table>'; return t;
      }

      /* ---- 1. Записи ---- */
      var a = d.appointments;
      var s1 = row3([
        { label: "Сьогодні",  val: a.today.total  || 0 },
        { label: "Тиждень",   val: a.week.total   || 0 },
        { label: "Місяць",    val: a.month.total  || 0 },
      ]);
      var s2 = row3([
        { label: "Виконано",    val: a.month.completed || 0 },
        { label: "Скасовано",   val: a.month.cancelled || 0 },
        { label: "Не прийшли",  val: a.month.no_show   || 0 },
      ]);
      var upcomingHtml = "";
      if (a.upcoming_today.length) {
        upcomingHtml = tbl(["Час","Клієнт","Послуга","Майстер"],
          a.upcoming_today.map(function(u) { return [u.time, u.client_name, u.service_name.split("(")[0].trim(), u.master_name]; }));
      } else {
        upcomingHtml = '<div style="color:var(--text-dim);font-size:.84rem;padding:8px 0;">Записів на сьогодні немає</div>';
      }
      var apptCard = card("1. Записи", "");
      apptCard.querySelector("div:last-child").appendChild(s1);
      apptCard.querySelector("div:last-child").appendChild(s2);
      var upHead = el("div",""); upHead.style.cssText = "font-size:.78rem;color:var(--text-dim);margin:10px 0 6px;";
      upHead.textContent = "Найближчі записи сьогодні"; apptCard.querySelector("div:last-child").appendChild(upHead);
      apptCard.querySelector("div:last-child").insertAdjacentHTML("beforeend", upcomingHtml);
      main.appendChild(apptCard);

      /* ---- 2. Майстри ---- */
      var mRows = d.masters.map(function(m) {
        return [m.name,
          '<span style="font-size:.72rem;color:var(--text-dim);">' + (m.level || "—") + '</span>',
          m.bookings || 0,
          '<div style="display:flex;align-items:center;gap:6px;"><div style="background:rgba(46,61,34,.3);border-radius:4px;height:6px;width:60px;overflow:hidden;"><div style="background:var(--olive-light);height:100%;width:' + (m.workload_pct||0) + '%"></div></div><span>' + (m.workload_pct||0) + '%</span></div>',
          grn(m.revenue),
          (m.free_today_h || 0) + " год",
        ];
      });
      main.appendChild(card("2. Майстри",
        tbl(["Ім'я","Рівень","Записів","Завант.","Дохід","Вільно сьогодні"], mRows)
      ));

      /* ---- 3. Послуги ---- */
      var svcRows = d.services.slice(0,10).map(function(s) {
        var shortName = s.name.length > 35 ? s.name.slice(0,35) + "…" : s.name;
        return [shortName, s.bookings||0, grn(s.revenue), grn(Math.round(s.avg_price||0))];
      });
      main.appendChild(card("3. Послуги (місяць)",
        tbl(["Послуга","Записів","Дохід","Сер. чек"], svcRows)
      ));

      /* ---- 4. Клієнти ---- */
      var cl = d.clients;
      var c1 = row3([
        { label: "Всього",          val: cl.total || 0 },
        { label: "Нових (місяць)",  val: cl.new_month || 0 },
        { label: "Повторних",       val: cl.returning_total || 0 },
      ]);
      var topRows = (cl.top||[]).map(function(c,i) {
        return ["#"+(i+1), c.name, c.phone, c.visit_count + " візитів"];
      });
      var inactiveRows = (cl.inactive||[]).map(function(c) {
        var days = c.last_visit_at ? Math.round((Date.now()-c.last_visit_at)/86400000) : "?";
        return [c.name, c.phone, days + " дн. тому"];
      });
      var clCard = card("4. Клієнти", "");
      var clBox = clCard.querySelector("div:last-child");
      clBox.appendChild(c1);
      clBox.insertAdjacentHTML("beforeend", '<div style="font-size:.78rem;color:var(--text-dim);margin:10px 0 5px;">Топ за візитами</div>');
      clBox.insertAdjacentHTML("beforeend", tbl(["#","Ім'я","Телефон","Візити"], topRows));
      if (inactiveRows.length) {
        clBox.insertAdjacentHTML("beforeend", '<div style="font-size:.78rem;color:var(--text-dim);margin:10px 0 5px;">Давно не були (&gt;30 днів)</div>');
        clBox.insertAdjacentHTML("beforeend", tbl(["Ім'я","Телефон","Остання поява"], inactiveRows));
      }
      main.appendChild(clCard);

      /* ---- 5. Фінанси ---- */
      var f = d.finance;
      var f1 = row3([
        { label: "Дохід сьогодні",  val: grn(f.today.actual) },
        { label: "Дохід тиждень",   val: grn(f.week.actual) },
        { label: "Дохід місяць",    val: grn(f.month.actual) },
      ]);
      var f2 = row3([
        { label: "Прогноз (є записи)", val: grn((f.today.forecast||0)+(f.week.forecast||0)+(f.month.forecast||0)) },
        { label: "Середній чек",        val: grn(f.avg_check) },
        { label: "",                    val: "" },
      ]);
      var byMasterRows = (f.by_master||[]).map(function(m) { return [m.name, grn(m.revenue)]; });
      var bySvcRows    = (f.by_service||[]).map(function(s) {
        var n = s.name.length > 35 ? s.name.slice(0,35)+"…" : s.name;
        return [n, s.cnt||0, grn(s.revenue)];
      });
      var fCard = card("5. Фінанси", "");
      var fBox = fCard.querySelector("div:last-child");
      fBox.appendChild(f1); fBox.appendChild(f2);
      fBox.insertAdjacentHTML("beforeend", '<div style="font-size:.78rem;color:var(--text-dim);margin:10px 0 5px;">По майстрах</div>');
      fBox.insertAdjacentHTML("beforeend", tbl(["Майстер","Дохід"], byMasterRows));
      fBox.insertAdjacentHTML("beforeend", '<div style="font-size:.78rem;color:var(--text-dim);margin:10px 0 5px;">По послугах</div>');
      fBox.insertAdjacentHTML("beforeend", tbl(["Послуга","Записів","Дохід"], bySvcRows));
      main.appendChild(fCard);
    });
  }

  var apptDate = todayStr();
  function renderAppts() {
    var main = $("main"); main.innerHTML = "";
    var bar = el("div", "bar");
    bar.appendChild(el("h2", null, "Записи"));
    var dateInp = el("input"); dateInp.type = "date"; dateInp.value = apptDate;
    dateInp.addEventListener("change", function () { apptDate = dateInp.value; loadAppts(); });
    bar.appendChild(dateInp);
    var newBtn = el("button", "btn btn-primary", "+ Новий запис");
    newBtn.addEventListener("click", function () { apptModal(); });
    bar.appendChild(newBtn);
    main.appendChild(bar);

    var masterFilterWrap = el("div", "bar");
    main.appendChild(masterFilterWrap);
    var listEl = el("div", "list"); main.appendChild(listEl);

    // фільтр по майстрах (тільки власник)
    if (ME.role === "owner") {
      api("GET", "/api/crm/masters").then(function (res) {
        var sel = el("select");
        sel.appendChild(new Option("Усі майстри", ""));
        (res.j.masters || []).forEach(function (m) { sel.appendChild(new Option(m.name, m.id)); });
        sel.addEventListener("change", function () { loadAppts(sel.value); });
        masterFilterWrap.appendChild(el("span", "muted", "Майстер:"));
        masterFilterWrap.appendChild(sel);
      });
    }

    function loadAppts(masterId) {
      listEl.innerHTML = '<div class="empty">Завантаження…</div>';
      var url = ME.role === "owner"
        ? "/api/crm/appointments?date=" + apptDate + (masterId ? "&master=" + masterId : "")
        : "/api/crm/me/appointments?from=" + apptDate + "&to=" + apptDate;
      api("GET", url).then(function (res) {
        var list = res.j.appointments || [];
        listEl.innerHTML = "";
        if (!list.length) { listEl.appendChild(el("div", "empty", "На " + ddmm(apptDate) + " записів немає")); return; }
        list.forEach(function (a) { listEl.appendChild(apptItem(a)); });
      });
    }
    window.__reloadAppts = function () { loadAppts(); };
    loadAppts();
  }

  function apptItem(a) {
    var item = el("div", "item");
    var row = el("div", "row1");
    row.appendChild(el("span", "t", fmtMin(a.start_min)));
    var info = el("div");
    info.appendChild(el("div", "t", a.client_name + " · " + a.service_name));
    info.appendChild(el("div", "sub", a.master_name + " · " + a.client_phone + " · " + a.duration_min + " хв"));
    info.style.marginLeft = "4px";
    row.appendChild(info);
    row.appendChild(el("span", "sp"));
    row.appendChild(el("span", "badge b-" + a.status, STATUS_LABEL[a.status] || a.status));
    item.appendChild(row);
    if (a.comment) item.appendChild(el("div", "sub", "💬 " + a.comment));

    var acts = el("div", "acts");
    function actBtn(label, status, cls) {
      var b = el("button", "btn btn-sm " + (cls || "btn-ghost"), label);
      b.addEventListener("click", function () {
        api("PATCH", "/api/crm/appointments/" + a.id + "/status", { status: status }).then(window.__reloadAppts);
      });
      return b;
    }
    if (a.status === "pending") acts.appendChild(actBtn("Підтвердити", "confirmed", "btn-primary"));
    if (a.status === "pending" || a.status === "confirmed") {
      acts.appendChild(actBtn("Завершити", "completed"));
      acts.appendChild(actBtn("Не прийшов", "no_show"));
      acts.appendChild(actBtn("Скасувати", "cancelled"));
      var resB = el("button", "btn btn-sm btn-ghost", "Перенести");
      resB.addEventListener("click", function () { rescheduleModal(a); });
      acts.appendChild(resB);
    }
    item.appendChild(acts);
    return item;
  }

  /* ---- модалка нового запису ---- */
  function apptModal() {
    openModal(
      '<h3>Новий запис</h3>' +
      '<label>Послуга</label><select id="mService"></select>' +
      '<label>Майстер</label><select id="mMaster"></select>' +
      '<label>Дата</label><input type="date" id="mDate" />' +
      '<label>Вільний час</label><div id="mSlots" class="muted">Оберіть послугу, майстра й дату</div>' +
      '<div class="grid2"><div><label>Ім\'я</label><input type="text" id="mName" maxlength="100"/></div>' +
      '<div><label>Телефон</label><input type="tel" id="mPhone" maxlength="30"/></div></div>' +
      '<label>Коментар</label><textarea id="mComment" maxlength="500"></textarea>' +
      '<div class="err" id="mErr"></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" id="mCancel">Скасувати</button>' +
      '<button class="btn btn-primary" id="mSave">Створити</button></div>'
    );
    var chosen = { start_min: null };
    $("mCancel").addEventListener("click", closeModal);
    $("mDate").value = apptDate; $("mDate").min = todayStr();

    // послуги
    api("GET", "/api/crm/services").then(function (res) {
      var sel = $("mService");
      (res.j.services || []).forEach(function (s) {
        var o = new Option(s.name + " (" + s.duration_min + " хв)", s.id); o.dataset.dur = s.duration_min; sel.appendChild(o);
      });
      loadMasters();
    });
    // майстри (власник — усі; майстер — лише себе фіксовано)
    function loadMasters() {
      api("GET", "/api/crm/masters").then(function (res) {
        var sel = $("mMaster");
        (res.j.masters || []).forEach(function (m) {
          if (ME.role !== "owner" && m.id !== ME.masterId) return;
          sel.appendChild(new Option(m.name, m.id));
        });
        loadSlots();
      });
    }
    $("mService").addEventListener("change", loadSlots);
    $("mMaster").addEventListener("change", loadSlots);
    $("mDate").addEventListener("change", loadSlots);

    function loadSlots() {
      chosen.start_min = null;
      var sid = $("mService").value, mid = $("mMaster").value, date = $("mDate").value;
      if (!sid || !mid || !date) return;
      var box = $("mSlots"); box.className = ""; box.innerHTML = "Завантаження…";
      api("GET", "/api/public/slots?service=" + sid + "&master=" + mid + "&date=" + date).then(function (res) {
        var slots = res.j.slots || [];
        box.innerHTML = "";
        if (!slots.length) { box.className = "muted"; box.textContent = "Вільних віконець немає"; return; }
        var grid = el("div", "slots");
        slots.forEach(function (s) {
          var c = el("div", "slot", s.time);
          c.addEventListener("click", function () {
            grid.querySelectorAll(".slot").forEach(function (x) { x.classList.remove("sel"); });
            c.classList.add("sel"); chosen.start_min = s.start_min;
          });
          grid.appendChild(c);
        });
        box.appendChild(grid);
      });
    }

    $("mSave").addEventListener("click", function () {
      var err = $("mErr"); err.textContent = "";
      if (chosen.start_min == null) { err.textContent = "Оберіть час"; return; }
      if (!$("mName").value.trim() || $("mPhone").value.replace(/\D/g, "").length < 9) { err.textContent = "Вкажіть ім'я і телефон"; return; }
      var url = ME.role === "owner" ? "/api/crm/appointments" : "/api/crm/me/appointments";
      api("POST", url, {
        service: $("mService").value, master: $("mMaster").value, date: $("mDate").value,
        start_min: chosen.start_min, name: $("mName").value.trim(), phone: $("mPhone").value.trim(),
        comment: $("mComment").value.trim()
      }).then(function (res) {
        if (res.code === 409) { err.textContent = "Це віконце вже зайняте"; return; }
        if (!res.j.ok) { err.textContent = "Помилка: " + (res.j.error || ""); return; }
        closeModal(); if (window.__reloadAppts) window.__reloadAppts();
      });
    });
  }

  /* ---- перенесення ---- */
  function rescheduleModal(a) {
    openModal(
      '<h3>Перенести запис</h3><div class="muted">' + a.client_name + " · " + a.service_name + " (" + a.duration_min + ' хв)</div>' +
      '<label>Дата</label><input type="date" id="rDate" />' +
      '<label>Вільний час</label><div id="rSlots" class="muted">Оберіть дату</div>' +
      '<div class="err" id="rErr"></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" id="rCancel">Скасувати</button>' +
      '<button class="btn btn-primary" id="rSave">Перенести</button></div>'
    );
    var chosen = { start_min: null };
    $("rCancel").addEventListener("click", closeModal);
    $("rDate").value = a.date; $("rDate").min = todayStr();
    $("rDate").addEventListener("change", loadSlots);
    function loadSlots() {
      chosen.start_min = null;
      var box = $("rSlots"); box.className = ""; box.innerHTML = "Завантаження…";
      api("GET", "/api/public/slots?service=" + a.service_id + "&master=" + a.master_id + "&date=" + $("rDate").value).then(function (res) {
        var slots = res.j.slots || []; box.innerHTML = "";
        if (!slots.length) { box.className = "muted"; box.textContent = "Вільних віконець немає"; return; }
        var grid = el("div", "slots");
        slots.forEach(function (s) {
          var c = el("div", "slot", s.time);
          c.addEventListener("click", function () { grid.querySelectorAll(".slot").forEach(function (x) { x.classList.remove("sel"); }); c.classList.add("sel"); chosen.start_min = s.start_min; });
          grid.appendChild(c);
        });
        box.appendChild(grid);
      });
    }
    loadSlots();
    $("rSave").addEventListener("click", function () {
      if (chosen.start_min == null) { $("rErr").textContent = "Оберіть час"; return; }
      api("PATCH", "/api/crm/appointments/" + a.id, { date: $("rDate").value, start_min: chosen.start_min }).then(function (res) {
        if (res.code === 409) { $("rErr").textContent = "Це віконце зайняте"; return; }
        if (!res.j.ok) { $("rErr").textContent = "Помилка"; return; }
        closeModal(); if (window.__reloadAppts) window.__reloadAppts();
      });
    });
  }

  /* ============================================================
     КЛІЄНТИ
     ============================================================ */
  function renderClients() {
    var main = $("main"); main.innerHTML = "";
    var bar = el("div", "bar"); bar.appendChild(el("h2", null, "Клієнти"));
    var search = el("input"); search.type = "text"; search.placeholder = "Пошук за іменем/телефоном";
    bar.appendChild(search); main.appendChild(bar);
    var listEl = el("div", "list"); main.appendChild(listEl);

    var t = null;
    search.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { load(search.value.trim()); }, 250); });

    function load(q) {
      listEl.innerHTML = '<div class="empty">Завантаження…</div>';
      var url = ME.role === "owner" ? "/api/crm/clients" + (q ? "?q=" + encodeURIComponent(q) : "") : "/api/crm/me/clients";
      api("GET", url).then(function (res) {
        var list = res.j.clients || [];
        if (q && ME.role !== "owner") list = list.filter(function (c) { return (c.name + c.phone).toLowerCase().indexOf(q.toLowerCase()) > -1; });
        listEl.innerHTML = "";
        if (!list.length) { listEl.appendChild(el("div", "empty", "Клієнтів не знайдено")); return; }
        list.forEach(function (c) {
          var item = el("div", "item");
          var row = el("div", "row1");
          var info = el("div");
          info.appendChild(el("div", "t", c.name));
          info.appendChild(el("div", "sub", c.phone + " · візитів: " + c.visit_count +
            (c.last_visit_at ? " · останній: " + new Date(c.last_visit_at).toLocaleDateString("uk-UA") : "")));
          row.appendChild(info); row.appendChild(el("span", "sp"));
          var open = el("button", "btn btn-sm btn-ghost", "Картка");
          open.addEventListener("click", function () { clientModal(c.id); });
          row.appendChild(open);
          item.appendChild(row);
          if (c.note) item.appendChild(el("div", "sub", "📝 " + c.note));
          listEl.appendChild(item);
        });
      });
    }
    load("");
  }

  function clientModal(id) {
    openModal('<h3>Картка клієнта</h3><div id="cBody" class="muted">Завантаження…</div>');
    api("GET", "/api/crm/clients/" + id).then(function (res) {
      if (!res.j.ok) { $("cBody").textContent = "Не знайдено"; return; }
      var c = res.j.client, h = res.j.history || [];
      var box = $("cBody"); box.className = ""; box.innerHTML = "";
      box.appendChild(el("div", "t", c.name));
      box.appendChild(el("div", "sub", c.phone + " · візитів: " + c.visit_count));
      box.appendChild(el("label", null, "Коментар по клієнту"));
      var note = el("textarea"); note.value = c.note || ""; note.maxLength = 1000; box.appendChild(note);
      var saveNote = el("button", "btn btn-sm btn-primary", "Зберегти коментар");
      saveNote.style.marginTop = "6px";
      saveNote.addEventListener("click", function () {
        api("PATCH", "/api/crm/clients/" + id, { note: note.value.trim() }).then(function () { saveNote.textContent = "Збережено ✓"; });
      });
      box.appendChild(saveNote);
      box.appendChild(el("label", null, "Історія записів (" + h.length + ")"));
      var hist = el("div", "list");
      if (!h.length) hist.appendChild(el("div", "muted", "Поки порожньо"));
      h.forEach(function (a) {
        var it = el("div", "item");
        var r = el("div", "row1");
        r.appendChild(el("span", "t", ddmm(a.date) + " " + a.time));
        var inf = el("div"); inf.style.marginLeft = "6px";
        inf.appendChild(el("div", "sub", a.service_name + " · " + a.master_name));
        r.appendChild(inf); r.appendChild(el("span", "sp"));
        r.appendChild(el("span", "badge b-" + a.status, STATUS_LABEL[a.status] || a.status));
        it.appendChild(r); hist.appendChild(it);
      });
      box.appendChild(hist);
      var foot = el("div", "modal-foot");
      var close = el("button", "btn btn-ghost", "Закрити"); close.addEventListener("click", closeModal);
      foot.appendChild(close); box.appendChild(foot);
    });
  }

  /* ============================================================
     ПОСЛУГИ (власник)
     ============================================================ */
  function renderServices() {
    var main = $("main"); main.innerHTML = "";
    var bar = el("div", "bar"); bar.appendChild(el("h2", null, "Послуги"));
    var add = el("button", "btn btn-primary", "+ Послуга");
    add.addEventListener("click", function () { serviceModal(null); });
    bar.appendChild(add); main.appendChild(bar);
    var listEl = el("div", "list"); main.appendChild(listEl);
    function load() {
      listEl.innerHTML = '<div class="empty">Завантаження…</div>';
      api("GET", "/api/crm/services").then(function (res) {
        listEl.innerHTML = "";
        (res.j.services || []).forEach(function (s) {
          var item = el("div", "item"); var row = el("div", "row1");
          var info = el("div");
          info.appendChild(el("div", "t", s.name));
          info.appendChild(el("div", "sub", s.duration_min + " хв · " + money(s.price)));
          row.appendChild(info); row.appendChild(el("span", "sp"));
          var ed = el("button", "btn btn-sm btn-ghost", "Змінити"); ed.addEventListener("click", function () { serviceModal(s); });
          var del = el("button", "btn btn-sm btn-ghost", "Видалити");
          del.addEventListener("click", function () { if (confirm("Видалити послугу?")) api("DELETE", "/api/crm/services/" + s.id).then(load); });
          row.appendChild(ed); row.appendChild(del); item.appendChild(row); listEl.appendChild(item);
        });
        if (!listEl.children.length) listEl.appendChild(el("div", "empty", "Послуг ще немає"));
      });
    }
    window.__reloadServices = load; load();
  }
  function serviceModal(s) {
    openModal(
      '<h3>' + (s ? "Редагувати послугу" : "Нова послуга") + '</h3>' +
      '<label>Назва</label><input type="text" id="sName" maxlength="150" />' +
      '<div class="grid2"><div><label>Тривалість (хв)</label><input type="number" id="sDur" min="5" step="5" /></div>' +
      '<div><label>Ціна (грн)</label><input type="number" id="sPrice" min="0" step="10" /></div></div>' +
      '<div class="err" id="sErr"></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" id="sCancel">Скасувати</button><button class="btn btn-primary" id="sSave">Зберегти</button></div>'
    );
    if (s) { $("sName").value = s.name; $("sDur").value = s.duration_min; $("sPrice").value = (s.price / 100) || 0; }
    $("sCancel").addEventListener("click", closeModal);
    $("sSave").addEventListener("click", function () {
      var name = $("sName").value.trim(), dur = parseInt($("sDur").value, 10), price = Math.round(parseFloat($("sPrice").value || 0) * 100);
      if (!name || !(dur > 0)) { $("sErr").textContent = "Вкажіть назву й тривалість"; return; }
      var body = { name: name, duration_min: dur, price: price };
      var p = s ? api("PUT", "/api/crm/services/" + s.id, body) : api("POST", "/api/crm/services", body);
      p.then(function () { closeModal(); window.__reloadServices(); });
    });
  }

  /* ============================================================
     МАЙСТРИ (власник) — профіль, послуги, графік, вихідні
     ============================================================ */
  function renderMasters() {
    var main = $("main"); main.innerHTML = "";
    var bar = el("div", "bar"); bar.appendChild(el("h2", null, "Майстри"));
    var add = el("button", "btn btn-primary", "+ Майстер");
    add.addEventListener("click", function () { masterModal(null); });
    bar.appendChild(add); main.appendChild(bar);
    var listEl = el("div", "list"); main.appendChild(listEl);
    function load() {
      listEl.innerHTML = '<div class="empty">Завантаження…</div>';
      Promise.all([api("GET", "/api/crm/masters"), api("GET", "/api/crm/services")]).then(function (rs) {
        var masters = rs[0].j.masters || [], services = rs[1].j.services || [];
        listEl.innerHTML = "";
        masters.forEach(function (m) {
          var item = el("div", "item"); var row = el("div", "row1");
          var info = el("div");
          var svcNames = (m.service_ids || []).map(function (id) { var s = services.find(function (x) { return x.id === id; }); return s ? s.name : null; }).filter(Boolean);
          info.appendChild(el("div", "t", m.name));
          info.appendChild(el("div", "sub", (m.phone || "—") + " · послуги: " + (svcNames.join(", ") || "не задано")));
          row.appendChild(info); row.appendChild(el("span", "sp"));
          var prof = el("button", "btn btn-sm btn-ghost", "Профіль"); prof.addEventListener("click", function () { masterModal(m, services); });
          var sch = el("button", "btn btn-sm btn-ghost", "Графік"); sch.addEventListener("click", function () { scheduleModal(m); });
          var off = el("button", "btn btn-sm btn-ghost", "Вихідні"); off.addEventListener("click", function () { timeoffModal(m); });
          var del = el("button", "btn btn-sm btn-ghost", "Видалити");
          del.addEventListener("click", function () { if (confirm("Видалити майстра?")) api("DELETE", "/api/crm/masters/" + m.id).then(load); });
          row.appendChild(prof); row.appendChild(sch); row.appendChild(off); row.appendChild(del);
          item.appendChild(row); listEl.appendChild(item);
        });
        if (!masters.length) listEl.appendChild(el("div", "empty", "Майстрів ще немає"));
      });
    }
    window.__reloadMasters = load; load();
  }

  function masterModal(m, services) {
    var svcP = services ? Promise.resolve(services) : api("GET", "/api/crm/services").then(function (r) { return r.j.services || []; });
    Promise.resolve(svcP).then(function (svcs) {
      openModal(
        '<h3>' + (m ? "Профіль майстра" : "Новий майстер") + '</h3>' +
        '<label>Ім\'я</label><input type="text" id="mmName" maxlength="100" />' +
        '<label>Телефон</label><input type="text" id="mmPhone" maxlength="30" />' +
        '<label>Послуги майстра</label><div class="chips" id="mmChips"></div>' +
        '<div class="err" id="mmErr"></div>' +
        '<div class="modal-foot"><button class="btn btn-ghost" id="mmCancel">Скасувати</button><button class="btn btn-primary" id="mmSave">Зберегти</button></div>'
      );
      if (m) { $("mmName").value = m.name; $("mmPhone").value = m.phone || ""; }
      var sel = new Set(m && m.service_ids ? m.service_ids : []);
      var chips = $("mmChips");
      svcs.forEach(function (s) {
        var c = el("span", "chip" + (sel.has(s.id) ? " on" : ""), s.name);
        c.addEventListener("click", function () { if (sel.has(s.id)) { sel.delete(s.id); c.classList.remove("on"); } else { sel.add(s.id); c.classList.add("on"); } });
        chips.appendChild(c);
      });
      $("mmCancel").addEventListener("click", closeModal);
      $("mmSave").addEventListener("click", function () {
        var name = $("mmName").value.trim();
        if (!name) { $("mmErr").textContent = "Вкажіть ім'я"; return; }
        var ids = Array.from(sel);
        if (m) {
          api("PUT", "/api/crm/masters/" + m.id, { name: name, phone: $("mmPhone").value.trim(), service_ids: ids })
            .then(function () { closeModal(); window.__reloadMasters(); });
        } else {
          api("POST", "/api/crm/masters", { name: name, phone: $("mmPhone").value.trim() }).then(function (res) {
            var id = res.j.id;
            api("PUT", "/api/crm/masters/" + id + "/services", { service_ids: ids }).then(function () { closeModal(); window.__reloadMasters(); });
          });
        }
      });
    });
  }

  function scheduleModal(m) {
    openModal('<h3>Графік: ' + m.name + '</h3><div id="schBody" class="muted">Завантаження…</div>');
    api("GET", "/api/crm/masters/" + m.id + "/schedule").then(function (res) {
      var sched = {}, brk = {};
      (res.j.schedule || []).forEach(function (r) { sched[r.weekday] = r; });
      (res.j.breaks || []).forEach(function (r) { brk[r.weekday] = r; }); // одна перерва/день у UI
      var box = $("schBody"); box.className = ""; box.innerHTML = "";
      box.appendChild(el("div", "muted", "Порожні поля = вихідний. Час у форматі ГГ:ХХ."));
      var rows = [];
      for (var wd = 1; wd <= 6; wd++) rows.push(wd); rows.push(0); // Пн..Сб, Нд
      rows.forEach(function (wd) {
        var r = el("div", "sched-row");
        r.appendChild(el("span", "wd", DOW[wd]));
        var ws = el("input"); ws.type = "time"; ws.dataset.wd = wd; ws.dataset.k = "ws";
        var we = el("input"); we.type = "time"; we.dataset.wd = wd; we.dataset.k = "we";
        if (sched[wd]) { ws.value = fmtMin(sched[wd].work_start); we.value = fmtMin(sched[wd].work_end); }
        r.appendChild(ws); r.appendChild(el("span", "muted", "–")); r.appendChild(we);
        r.appendChild(el("span", "muted", "перерва"));
        var bs = el("input"); bs.type = "time"; bs.dataset.wd = wd; bs.dataset.k = "bs";
        var be = el("input"); be.type = "time"; be.dataset.wd = wd; be.dataset.k = "be";
        if (brk[wd]) { bs.value = fmtMin(brk[wd].break_start); be.value = fmtMin(brk[wd].break_end); }
        r.appendChild(bs); r.appendChild(el("span", "muted", "–")); r.appendChild(be);
        box.appendChild(r);
      });
      var foot = el("div", "modal-foot");
      var cancel = el("button", "btn btn-ghost", "Скасувати"); cancel.addEventListener("click", closeModal);
      var save = el("button", "btn btn-primary", "Зберегти");
      save.addEventListener("click", function () {
        function toMin(v) { if (!v) return null; var p = v.split(":"); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
        var vals = {};
        box.querySelectorAll("input").forEach(function (i) { vals[i.dataset.wd + i.dataset.k] = toMin(i.value); });
        var schedule = [], breaks = [];
        [1, 2, 3, 4, 5, 6, 0].forEach(function (wd) {
          var ws = vals[wd + "ws"], we = vals[wd + "we"];
          if (ws != null && we != null && we > ws) {
            schedule.push({ weekday: wd, work_start: ws, work_end: we });
            var bs = vals[wd + "bs"], be = vals[wd + "be"];
            if (bs != null && be != null && be > bs) breaks.push({ weekday: wd, break_start: bs, break_end: be });
          }
        });
        api("PUT", "/api/crm/masters/" + m.id + "/schedule", { schedule: schedule, breaks: breaks }).then(closeModal);
      });
      foot.appendChild(cancel); foot.appendChild(save); box.appendChild(foot);
    });
  }

  function timeoffModal(m) {
    openModal('<h3>Вихідні: ' + m.name + '</h3>' +
      '<div class="bar"><input type="date" id="offDate" /><button class="btn btn-sm btn-primary" id="offAdd">Додати вихідний</button></div>' +
      '<div id="offList" class="list"></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" id="offClose">Закрити</button></div>');
    $("offDate").min = todayStr();
    $("offClose").addEventListener("click", closeModal);
    function load() {
      api("GET", "/api/crm/masters/" + m.id + "/timeoff").then(function (res) {
        var list = $("offList"); list.innerHTML = "";
        (res.j.timeoff || []).forEach(function (o) {
          var it = el("div", "item"); var r = el("div", "row1");
          r.appendChild(el("span", "t", ddmm(o.date) + " " + dowOf(o.date)));
          r.appendChild(el("span", "sub", o.full_day ? "весь день" : fmtMin(o.off_start) + "–" + fmtMin(o.off_end)));
          r.appendChild(el("span", "sp"));
          var del = el("button", "btn btn-sm btn-ghost", "✕");
          del.addEventListener("click", function () { api("DELETE", "/api/crm/masters/" + m.id + "/timeoff/" + o.id).then(load); });
          r.appendChild(del); it.appendChild(r); list.appendChild(it);
        });
        if (!list.children.length) list.appendChild(el("div", "muted", "Немає"));
      });
    }
    $("offAdd").addEventListener("click", function () {
      if (!$("offDate").value) return;
      api("POST", "/api/crm/masters/" + m.id + "/timeoff", { date: $("offDate").value, full_day: true }).then(load);
    });
    load();
  }

  /* ============================================================
     ДОСТУПИ (користувачі-майстри)
     ============================================================ */
  function renderUsers() {
    var main = $("main"); main.innerHTML = "";
    var bar = el("div", "bar"); bar.appendChild(el("h2", null, "Доступи майстрів"));
    var add = el("button", "btn btn-primary", "+ Акаунт");
    add.addEventListener("click", function () { userModal(null); });
    bar.appendChild(add); main.appendChild(bar);
    main.appendChild(el("div", "muted", "Власник входить без логіна — лише паролем. Майстри входять за логіном і паролем."));
    var listEl = el("div", "list"); listEl.style.marginTop = "12px"; main.appendChild(listEl);
    function load() {
      Promise.all([api("GET", "/api/crm/users"), api("GET", "/api/crm/masters")]).then(function (rs) {
        var users = rs[0].j.users || [], masters = rs[1].j.masters || [];
        listEl.innerHTML = "";
        users.forEach(function (u) {
          var it = el("div", "item"); var r = el("div", "row1");
          var mn = masters.find(function (x) { return x.id === u.master_id; });
          var info = el("div");
          info.appendChild(el("div", "t", u.username + (u.active ? "" : " (вимкнено)")));
          info.appendChild(el("div", "sub", (u.role === "owner" ? "власник" : "майстер") + (mn ? " · " + mn.name : "")));
          r.appendChild(info); r.appendChild(el("span", "sp"));
          var ed = el("button", "btn btn-sm btn-ghost", "Змінити"); ed.addEventListener("click", function () { userModal(u, masters); });
          var del = el("button", "btn btn-sm btn-ghost", "Вимкнути");
          del.addEventListener("click", function () { if (confirm("Вимкнути доступ?")) api("DELETE", "/api/crm/users/" + u.id).then(load); });
          r.appendChild(ed); r.appendChild(del); it.appendChild(r); listEl.appendChild(it);
        });
        if (!users.length) listEl.appendChild(el("div", "empty", "Акаунтів ще немає"));
      });
    }
    window.__reloadUsers = load; load();
  }
  function userModal(u, masters) {
    var mP = masters ? Promise.resolve(masters) : api("GET", "/api/crm/masters").then(function (r) { return r.j.masters || []; });
    Promise.resolve(mP).then(function (ms) {
      openModal(
        '<h3>' + (u ? "Акаунт майстра" : "Новий акаунт") + '</h3>' +
        '<label>Логін</label><input type="text" id="uName" maxlength="40" />' +
        '<label>' + (u ? "Новий пароль (порожньо = без змін)" : "Пароль") + '</label>' +
        '<div class="pass-wrap"><input type="password" id="uPass" /><button type="button" class="pass-eye" id="uPassEye" title="Показати/сховати пароль">👁</button></div>' +
        '<label>Майстер</label><select id="uMaster"></select>' +
        '<div class="err" id="uErr"></div>' +
        '<div class="modal-foot"><button class="btn btn-ghost" id="uCancel">Скасувати</button><button class="btn btn-primary" id="uSave">Зберегти</button></div>'
      );
      var sel = $("uMaster"); sel.appendChild(new Option("— без прив'язки —", ""));
      ms.forEach(function (m) { sel.appendChild(new Option(m.name, m.id)); });
      if (u) { $("uName").value = u.username; if (u.master_id) sel.value = u.master_id; }
      $("uPassEye").addEventListener("click", function () {
        var inp = $("uPass");
        var show = inp.type === "password";
        inp.type = show ? "text" : "password";
        this.textContent = show ? "🙈" : "👁";
        inp.focus();
      });
      $("uCancel").addEventListener("click", closeModal);
      $("uSave").addEventListener("click", function () {
        var name = $("uName").value.trim(), pass = $("uPass").value, mid = sel.value ? parseInt(sel.value, 10) : null;
        if (!name) { $("uErr").textContent = "Вкажіть логін"; return; }
        var body = { username: name, role: "worker", masterId: mid };
        if (pass) body.password = pass;
        var p;
        if (u) p = api("PUT", "/api/crm/users/" + u.id, body);
        else { if (!pass || pass.length < 4) { $("uErr").textContent = "Пароль від 4 символів"; return; } p = api("POST", "/api/crm/users", body); }
        p.then(function (res) {
          if (!res.j.ok) { $("uErr").textContent = res.j.error === "username taken" ? "Логін зайнятий" : "Помилка"; return; }
          closeModal(); window.__reloadUsers();
        });
      });
    });
  }

  /* ============================================================
     СПОВІЩЕННЯ (журнал)
     ============================================================ */
  function renderNotif() {
    var main = $("main"); main.innerHTML = "";
    var bar = el("div", "bar"); bar.appendChild(el("h2", null, "Журнал сповіщень"));
    main.appendChild(bar);
    var listEl = el("div", "list"); main.appendChild(listEl);
    var KIND = { confirmation: "Підтвердження", reminder_24h: "Нагадування 24г", reminder_2h: "Нагадування 2г" };
    var ST = { queued: "у черзі", sent: "відправлено", delivered: "доставлено", undelivered: "не доставлено", failed: "помилка" };
    listEl.innerHTML = '<div class="empty">Завантаження…</div>';
    api("GET", "/api/crm/notifications").then(function (res) {
      var list = res.j.notifications || []; listEl.innerHTML = "";
      if (!list.length) { listEl.appendChild(el("div", "empty", "Поки немає сповіщень")); return; }
      list.forEach(function (n) {
        var it = el("div", "item"); var r = el("div", "row1");
        var info = el("div");
        info.appendChild(el("div", "t", (KIND[n.kind] || n.kind) + (n.client_name ? " · " + n.client_name : "")));
        info.appendChild(el("div", "sub", n.phone + (n.final_channel ? " · " + n.final_channel : "") + (n.provider ? " · " + n.provider : "")));
        r.appendChild(info); r.appendChild(el("span", "sp"));
        r.appendChild(el("span", "badge b-" + n.status, ST[n.status] || n.status));
        it.appendChild(r); listEl.appendChild(it);
      });
    });
  }
})();
