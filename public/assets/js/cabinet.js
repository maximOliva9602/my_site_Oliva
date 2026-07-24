/* ============================================================
   cabinet.js — кабінет CRM Oliva (власник + майстер).
   Логіка вкладок, списків і модалок. Усі дані через /api/crm/*.
   ============================================================ */
(function () {
  "use strict";

  var ME = { role: null, masterId: null, can_see_phones: false };
  var DOW = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  var STATUS_LABEL = { pending: "Очікує", confirmed: "Підтверджено", completed: "Завершено", cancelled: "Скасовано", no_show: "Не прийшов" };
  var MARKER_COLORS = ["#4f86f7","#8b5cf6","#ec4899","#10b981","#f59e0b","#f97316","#ef4444","#06b6d4"];
  var DEFAULT_MARKER = "#4f86f7"; // якщо маркер не встановлений

  /* Будує рядок кольорових маркерів. selected — поточний hex або ''.
     onChange(hex|null) викликається при виборі. */
  function markerPicker(selected, onChange) {
    var wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0 10px;";
    // "без маркера"
    var noBtn = document.createElement("div");
    noBtn.title = "Без маркера";
    noBtn.style.cssText = "width:22px;height:22px;border-radius:50%;border:2px solid #ccc;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;color:#aaa;flex-shrink:0;" + (!selected ? "border-color:#333;" : "");
    noBtn.textContent = "✕";
    noBtn.addEventListener("click", function() {
      wrap.querySelectorAll("[data-mc]").forEach(function(d) { d.style.boxShadow = ""; d.style.outline = ""; });
      noBtn.style.borderColor = "#333";
      onChange(null);
    });
    wrap.appendChild(noBtn);
    MARKER_COLORS.forEach(function(c) {
      var dot = document.createElement("div");
      dot.setAttribute("data-mc", c);
      dot.style.cssText = "width:22px;height:22px;border-radius:50%;background:" + c + ";cursor:pointer;flex-shrink:0;transition:transform .1s;" + (selected === c ? "box-shadow:0 0 0 3px #fff,0 0 0 5px " + c + ";" : "");
      dot.addEventListener("click", function() {
        wrap.querySelectorAll("[data-mc]").forEach(function(d) { d.style.boxShadow = ""; });
        noBtn.style.borderColor = "#ccc";
        dot.style.boxShadow = "0 0 0 3px #fff,0 0 0 5px " + c;
        onChange(c);
      });
      wrap.appendChild(dot);
    });
    return wrap;
  }

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
  function openModal(html, wide) { $("modalCard").innerHTML = html; $("modalCard").className = "modal-card" + (wide ? " wide" : ""); $("modal").classList.add("on"); }
  function closeModal() { $("modal").classList.remove("on"); $("modalCard").innerHTML = ""; $("modalCard").className = "modal-card"; }
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
  function doLogout() {
    api("POST", "/api/admin/logout").then(function () { location.reload(); });
  }
  $("logoutBtn").addEventListener("click", function () {
    openModal(
      '<h3>Вийти з кабінету?</h3>' +
      '<div style="display:flex;gap:8px;margin-top:18px;">' +
        '<button class="btn btn-ghost" id="logoutCancel" style="flex:1;">Скасувати</button>' +
        '<button class="btn btn-primary" id="logoutYes" style="flex:1;">Вийти</button>' +
      '</div>'
    );
    document.getElementById("logoutCancel").addEventListener("click", closeModal);
    document.getElementById("logoutYes").addEventListener("click", doLogout);
  });

  // авто-вхід якщо є cookie
  api("GET", "/api/admin/me").then(function (res) { if (res.j && res.j.ok) boot(res.j); });

  /* ── PWA Push підписка ── */
  function subscribePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission !== "granted") return;
    navigator.serviceWorker.ready.then(function(reg) {
      api("GET", "/api/push/vapid-public-key").then(function(r) {
        if (!r.j || !r.j.publicKey) { console.warn("[push] VAPID ключ не налаштований на сервері"); return; }
        var key = r.j.publicKey;
        var raw = atob(key.replace(/-/g,"+").replace(/_/g,"/"));
        var arr = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);

        function doSubscribe() {
          reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: arr
          }).then(function(sub) {
            console.log("[push] підписка створена:", sub.endpoint.slice(0, 60) + "…");
            return api("POST", "/api/push/subscribe", { subscription: sub.toJSON() }).then(function(r2) {
              console.log("[push] збережено на сервері:", r2.j);
            });
          }).catch(function(e) { console.error("[push] subscribe помилка:", e); });
        }

        // Спочатку скасовуємо стару підписку (могла бути з іншим ключем)
        reg.pushManager.getSubscription().then(function(existing) {
          if (existing) {
            console.log("[push] скасовуємо стару підписку…");
            existing.unsubscribe().then(doSubscribe).catch(doSubscribe);
          } else {
            doSubscribe();
          }
        }).catch(doSubscribe);
      });
    }).catch(function(e) { console.error("[push] SW ready error:", e); });
  }

  /* ── Ініціалізація push: тихо якщо вже дозволено, тост якщо ні ── */
  function initPush() {
    if (!("Notification" in window) || !("PushManager" in window)) return;
    if (Notification.permission === "granted") {
      setTimeout(subscribePush, 1200);
      return;
    }
    if (Notification.permission === "denied") return;
    // Показуємо тост один раз на сесію
    if (sessionStorage.getItem("push_asked")) return;
    showPushToast();
  }

  function showPushToast() {
    if (document.getElementById("push-toast")) return;
    var t = document.createElement("div"); t.id = "push-toast";
    t.innerHTML =
      '<div class="pt-msg">🔔 Отримувати сповіщення про нові записи на цей телефон?</div>' +
      '<div class="pt-btns">' +
        '<button class="btn btn-primary btn-sm" id="pt-allow">Дозволити</button>' +
        '<button class="btn btn-ghost btn-sm" id="pt-later">Пізніше</button>' +
      '</div>';
    document.body.appendChild(t);

    document.getElementById("pt-allow").addEventListener("click", function() {
      // Виклик тут — це жест користувача, iOS дозволяє requestPermission()
      Notification.requestPermission().then(function(p) {
        t.remove(); sessionStorage.setItem("push_asked", "1");
        if (p === "granted") subscribePush();
      }).catch(function() { t.remove(); });
    });
    document.getElementById("pt-later").addEventListener("click", function() {
      t.remove(); sessionStorage.setItem("push_asked", "1");
    });
  }

  /* ============================================================
     BOOT + TABS
     ============================================================ */
  var TABS = [];
  function boot(me) {
    ME.role = me.role; ME.masterId = me.masterId; ME.can_see_phones = !!me.can_see_phones;
    $("login").style.display = "none";
    $("app").classList.add("on");
    $("roleTag").textContent = me.role === "owner" ? "Власник" : "Майстер";

    TABS = [];
    if (me.role === "owner") {
      TABS.push({ id: "dashboard", name: "📊 Дашборд", render: renderDashboard });
    }
    TABS.push({ id: "rozklad",  name: "📅 Розклад",       render: renderRozkladTab });
    TABS.push({ id: "grafik",   name: "🗓 Графік роботи", render: renderScheduleTab });
    TABS.push({ id: "clients",  name: "Клієнти",          render: renderClients });
    if (me.role === "owner") {
      TABS.push({ id: "analytics", name: "📈 Аналітика", render: renderAnalytics });
      TABS.push({ id: "traffic",   name: "🌐 Трафік",   render: renderTraffic });
      TABS.push({ id: "reviews",   name: "⭐ Відгуки",  render: renderReviews });
      TABS.push({ id: "services",  name: "Послуги",     render: renderServices });
      TABS.push({ id: "masters",   name: "Майстри",     render: renderMasters });
      TABS.push({ id: "users",     name: "Доступи",     render: renderUsers });
      TABS.push({ id: "notif",     name: "Сповіщення",  render: renderNotif });
      TABS.push({ id: "filiyi",    name: "🏢 Філії",    render: renderBranchesTab });
    }
    /* ── Іконки і короткі назви для мобільного nav ── */
    var TAB_ICOS  = { dashboard:"📊", rozklad:"📅", grafik:"🗓", clients:"👤", analytics:"📈", traffic:"🌐", reviews:"⭐", services:"💆", masters:"👥", users:"🔐", notif:"🔔", filiyi:"🏢" };
    var TAB_SHORT = { dashboard:"Дашборд", rozklad:"Розклад", grafik:"Графік", clients:"Клієнти", analytics:"Аналітика", traffic:"Трафік", reviews:"Відгуки", services:"Послуги", masters:"Майстри", users:"Доступи", notif:"Сповіщення", filiyi:"Філії" };
    var BOTTOM_COUNT = Math.min(3, TABS.length);
    var hasDrawer    = TABS.length > BOTTOM_COUNT;

    var tabsEl       = $("tabs");        tabsEl.innerHTML = "";
    var mobNav       = document.getElementById("mob-nav");       mobNav.innerHTML = "";
    var mobSheetList = document.getElementById("mob-sheet-list"); mobSheetList.innerHTML = "";
    var mobBackdrop  = document.getElementById("mob-backdrop");
    var mobSheet     = document.getElementById("mob-sheet");

    function clearOverlay() {
      var ov = document.getElementById("cal-overlay"); if (ov) ov.remove();
      var ws = document.getElementById("cal-week-strip"); if (ws) ws.remove();
      document.body.style.overflow = "";
      document.body.style.overscrollBehavior = "";
      var ae = $("app"); if (ae) ae.style.cssText = "";
    }
    function closeMobSheet() { mobBackdrop.classList.remove("open"); mobSheet.classList.remove("open"); }
    function openMobSheet()  { mobBackdrop.classList.add("open");    mobSheet.classList.add("open"); }

    function activateTab(i) {
      clearOverlay();
      // Desktop вкладки
      tabsEl.querySelectorAll(".tab").forEach(function(b, j) { b.classList.toggle("on", j === i); });
      // Мобільна нижня панель
      var mBtns = mobNav.querySelectorAll(".mob-tab");
      mBtns.forEach(function(b) { b.classList.remove("on"); });
      if (i < BOTTOM_COUNT) {
        if (mBtns[i]) mBtns[i].classList.add("on");
      } else {
        var moreBtn = document.getElementById("mob-more-btn");
        if (moreBtn) moreBtn.classList.add("on");
      }
      // Елементи drawer
      mobSheetList.querySelectorAll(".mob-sheet-item").forEach(function(b, j) {
        b.classList.toggle("on", (j + BOTTOM_COUNT) === i);
      });
      closeMobSheet();
      TABS[i].render();
    }

    /* Desktop вкладки */
    TABS.forEach(function(t, i) {
      var b = el("button", "tab" + (i === 0 ? " on" : ""), t.name);
      b.addEventListener("click", function() { activateTab(i); });
      tabsEl.appendChild(b);
    });

    /* Мобільна нижня панель — перші BOTTOM_COUNT вкладок */
    TABS.slice(0, BOTTOM_COUNT).forEach(function(t, i) {
      var b = document.createElement("button");
      b.className = "mob-tab" + (i === 0 ? " on" : "");
      b.innerHTML = '<span class="mico">' + (TAB_ICOS[t.id] || "📋") + '</span><span>' + (TAB_SHORT[t.id] || t.name) + '</span>';
      b.addEventListener("click", function() { activateTab(i); });
      mobNav.appendChild(b);
    });

    if (hasDrawer) {
      /* Кнопка "Ще" відкриває drawer */
      var moreB = document.createElement("button");
      moreB.id = "mob-more-btn";
      moreB.className = "mob-tab";
      moreB.innerHTML = '<span class="mico">☰</span><span>Ще</span>';
      moreB.addEventListener("click", openMobSheet);
      mobNav.appendChild(moreB);

      /* Елементи drawer (решта вкладок) */
      TABS.slice(BOTTOM_COUNT).forEach(function(t, j) {
        var i = j + BOTTOM_COUNT;
        var b = document.createElement("button");
        b.className = "mob-sheet-item";
        b.innerHTML = (TAB_ICOS[t.id] || "📋") + "&nbsp;&nbsp;" + (TAB_SHORT[t.id] || t.name);
        b.addEventListener("click", function() { activateTab(i); });
        mobSheetList.appendChild(b);
      });
    } else {
      /* Для майстра (2 вкладки) — кнопка виходу в нижній панелі */
      var logB = document.createElement("button");
      logB.className = "mob-tab";
      logB.innerHTML = '<span class="mico">🚪</span><span>Вийти</span>';
      logB.addEventListener("click", function() { $("logoutBtn").click(); });
      mobNav.appendChild(logB);
    }

    /* Backdrop і кнопка виходу в drawer */
    mobBackdrop.onclick = closeMobSheet;
    var mobSheetLogout = document.getElementById("mob-sheet-logout");
    mobSheetLogout.onclick = function() { closeMobSheet(); $("logoutBtn").click(); };

    var rozkladIdx = TABS.findIndex(function(t) { return t.id === "rozklad"; });
    activateTab(rozkladIdx >= 0 ? rozkladIdx : 0);
    initPush();     // тост або тиха підписка
    // Авто-оновлення коли повертаємось у додаток (напр. із фону)
    document.addEventListener("visibilitychange", function() {
      if (!document.hidden && window.__reloadAppts) {
        try { window.__reloadAppts(); } catch(e) {}
      }
    });
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
      /* Обгортка зі скролом: на телефоні широкі таблиці інакше
         обрізаються по правому краю (остання колонка не видна). */
      function tbl(heads, rows) {
        var t = '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">';
        t += '<table style="width:100%;min-width:max-content;border-collapse:collapse;font-size:.82rem;white-space:nowrap;">';
        t += '<tr>' + heads.map(function(h) { return '<th style="text-align:left;color:var(--text-dim);padding:4px 6px;font-weight:500;border-bottom:1px solid var(--line);">' + h + '</th>'; }).join("") + '</tr>';
        rows.forEach(function(r) {
          t += '<tr>' + r.map(function(c) { return '<td style="padding:6px 6px;border-bottom:1px solid rgba(122,145,86,.08);color:var(--cream);">' + c + '</td>'; }).join("") + '</tr>';
        });
        t += '</table></div>'; return t;
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
      /* Підпис обов'язковий: цей ряд рахується за місяць, а стоїть одразу
         під рядом Сьогодні/Тиждень/Місяць — без нього читається як «сьогодні». */
      var stHead = el("div", ""); stHead.style.cssText = "font-size:.78rem;color:var(--text-dim);margin:4px 0 6px;";
      stHead.textContent = "Статуси за місяць";
      apptCard.querySelector("div:last-child").appendChild(stHead);
      apptCard.querySelector("div:last-child").appendChild(s2);
      var upHead = el("div",""); upHead.style.cssText = "font-size:.78rem;color:var(--text-dim);margin:10px 0 6px;";
      upHead.textContent = "Найближчі записи сьогодні"; apptCard.querySelector("div:last-child").appendChild(upHead);
      apptCard.querySelector("div:last-child").insertAdjacentHTML("beforeend", upcomingHtml);
      main.appendChild(apptCard);

      /* ---- 2. Майстри ----
         Картками, а не таблицею: шість колонок не влазять у 375px і
         вимагали скролу вбік, через що остання губилась з очей. */
      var mHtml = d.masters.map(function(m) {
        var pct  = m.workload_pct || 0;
        var free = m.free_today_h == null ? "вихідний" : m.free_today_h + " год";
        function cell(label, val) {
          return '<div>' +
            '<div style="font-size:.7rem;color:var(--text-dim);margin-bottom:2px;">' + label + '</div>' +
            '<div style="color:var(--cream);font-size:.88rem;font-weight:600;">' + val + '</div>' +
          '</div>';
        }
        return '<div style="border:1px solid var(--line);border-radius:10px;padding:11px 12px;margin-bottom:8px;background:rgba(46,61,34,.14);">' +
          '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:9px;">' +
            '<span style="color:var(--cream);font-weight:600;font-size:.95rem;">' + m.name + '</span>' +
            '<span style="font-size:.72rem;color:var(--text-dim);">' + (m.level || "—") + '</span>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:9px;">' +
            cell("Записів", m.bookings || 0) +
            cell("Дохід", grn(m.revenue)) +
            cell("Вільно сьогодні", free) +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span style="font-size:.7rem;color:var(--text-dim);flex-shrink:0;">Завант.</span>' +
            '<div style="flex:1;background:rgba(46,61,34,.35);border-radius:4px;height:6px;overflow:hidden;">' +
              '<div style="background:var(--olive-light);height:100%;width:' + pct + '%"></div>' +
            '</div>' +
            '<span style="font-size:.75rem;color:var(--cream);flex-shrink:0;">' + pct + '%</span>' +
          '</div>' +
        '</div>';
      }).join("");
      main.appendChild(card("2. Майстри (місяць)", mHtml));

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
      /* Було: forecast(сьогодні)+forecast(тиждень)+forecast(місяць) — періоди
         вкладені один в одного, тому сьогоднішні записи рахувались тричі.
         Місячний прогноз уже включає і тиждень, і сьогодні. */
      var f2 = row3([
        { label: "Прогноз (місяць)", val: grn(f.month.forecast || 0) },
        { label: "Середній чек",     val: grn(f.avg_check) },
        { label: "",                 val: "" },
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
  var apptViewMode = "month"; // "month" | "calendar" | "list"
  var apptMonth = todayStr().slice(0, 7); // "YYYY-MM"
  var calSlotH = 22; // px per 10-min slot, adjustable by zoom
  var calScroller = null; // shared scroller ref for zoom-only reload
  var calBody = null;     // shared body ref for pinch transform

  var MONTH_UA = ["Січень","Лютий","Березень","Квітень","Травень","Червень","Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"];
  var DOW_UA = ["Пн","Вт","Ср","Чт","Пт","Сб","Нд"];

  // ── Вкладка "Розклад" з перемикачем Записи / Календар ─────────
  function renderRozkladTab() {
    apptViewMode = "calendar";
    renderAppts({ keepMode: true, title: "Розклад", showToggle: true });
  }

  function renderAppts(opts) {
    var tabTitle = (opts && opts.title) || "Розклад";
    var showToggle = !!(opts && opts.showToggle);
    if (!opts || !opts.keepMode) apptViewMode = "month";
    var main = $("main"); main.innerHTML = "";
    var bar = el("div", "bar");
    bar.appendChild(el("h2", null, tabTitle));
    var newBtn = el("button", "btn btn-primary", "+ Новий запис");
    newBtn.addEventListener("click", function () { apptModal(); });
    bar.appendChild(newBtn);
    main.appendChild(bar);

    // Перемикач Записи / Розклад (день)
    if (showToggle) {
      var toggleBar = document.createElement("div");
      toggleBar.style.cssText = "display:flex;gap:0;background:var(--panel-2);border-radius:10px;padding:3px;margin:0 0 8px;";
      var btnList = document.createElement("button");
      var btnCal  = document.createElement("button");
      var btnStyle = "flex:1;padding:7px 0;border:none;border-radius:8px;font-size:.82rem;font-weight:600;cursor:pointer;transition:background .15s,color .15s;";
      btnList.style.cssText = btnStyle;
      btnCal.style.cssText  = btnStyle;
      btnList.textContent = "📋 Записи";
      btnCal.textContent  = "📅 Календар";
      function updateToggle() {
        var isMonth = apptViewMode === "month" || apptViewMode === "list";
        btnList.style.background = isMonth  ? "var(--olive-light)" : "transparent";
        btnList.style.color      = isMonth  ? "#fff" : "var(--text-dim)";
        btnCal.style.background  = !isMonth ? "var(--olive-light)" : "transparent";
        btnCal.style.color       = !isMonth ? "#fff" : "var(--text-dim)";
      }
      updateToggle();
      btnList.addEventListener("click", function() {
        if (apptViewMode !== "month") { apptViewMode = "month"; updateToggle(); reloadView(); }
      });
      btnCal.addEventListener("click", function() {
        if (apptViewMode !== "calendar") { apptViewMode = "calendar"; updateToggle(); reloadView(); }
      });
      toggleBar.appendChild(btnList);
      toggleBar.appendChild(btnCal);
      var toggleWrap = el("div");
      toggleWrap.style.cssText = "padding:4px 0 0;";
      toggleWrap.appendChild(toggleBar);
      main.appendChild(toggleWrap);
    }

    var masterFilterWrap = el("div", "bar");
    main.appendChild(masterFilterWrap);
    var contentEl = el("div"); contentEl.id = "apptContent"; main.appendChild(contentEl);

    var activeMasterFilter = "";

    if (ME.role === "owner") {
      api("GET", "/api/crm/masters").then(function (res) {
        var sel = el("select");
        sel.appendChild(new Option("Усі майстри", ""));
        (res.j.masters || []).forEach(function (m) { sel.appendChild(new Option(m.name, m.id)); });
        sel.addEventListener("change", function () { activeMasterFilter = sel.value; reloadView(sel.value); });
        masterFilterWrap.appendChild(el("span", "muted", "Майстер:"));
        masterFilterWrap.appendChild(sel);
        reloadView();
      });
    } else {
      reloadView();
    }

    function reloadView(masterId) {
      if (masterId !== undefined) activeMasterFilter = masterId;
      if (apptViewMode === "month") {
        loadMonthView();
      } else if (apptViewMode === "calendar") {
        loadCalendar(activeMasterFilter);
      } else {
        loadAppts(activeMasterFilter);
      }
    }

    function loadMonthView() {
      document.body.style.overflow = "";
      document.body.style.overscrollBehavior = "";
      var ae = $("app"); if (ae) ae.style.cssText = "";
      var ov = document.getElementById("cal-overlay"); if (ov) ov.remove();
      var ws0 = document.getElementById("cal-week-strip"); if (ws0) ws0.remove();
      var ce = $("apptContent"); ce.innerHTML = "";

      // ── Шапка місяця ───────────────────────────────────────────
      var hdr = document.createElement("div");
      hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:8px 0 12px;";
      var yr = parseInt(apptMonth.slice(0,4)), mo = parseInt(apptMonth.slice(5,7)) - 1;
      var prevBtn = el("button","btn btn-ghost btn-sm","‹");
      var nextBtn = el("button","btn btn-ghost btn-sm","›");
      prevBtn.style.cssText = nextBtn.style.cssText = "font-size:1.3rem;padding:4px 10px;";
      var titleEl = document.createElement("div");
      titleEl.style.cssText = "font-size:1rem;font-weight:700;color:var(--cream);";
      titleEl.textContent = MONTH_UA[mo] + " " + yr;
      hdr.appendChild(prevBtn); hdr.appendChild(titleEl); hdr.appendChild(nextBtn);
      ce.appendChild(hdr);

      prevBtn.addEventListener("click", function() {
        var d = new Date(yr, mo - 1, 1);
        apptMonth = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0");
        loadMonthView();
      });
      nextBtn.addEventListener("click", function() {
        var d = new Date(yr, mo + 1, 1);
        apptMonth = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0");
        loadMonthView();
      });

      // ── Дні тижня ──────────────────────────────────────────────
      var grid = document.createElement("div");
      grid.style.cssText = "display:grid;grid-template-columns:repeat(7,1fr);gap:2px;";
      DOW_UA.forEach(function(d) {
        var cell = document.createElement("div");
        cell.style.cssText = "text-align:center;font-size:.7rem;color:var(--text-dim);font-weight:600;padding-bottom:6px;";
        cell.textContent = d; grid.appendChild(cell);
      });

      // Завантажити к-ть записів і відрендерити
      api("GET", "/api/crm/appointments/month-counts?month=" + apptMonth).then(function(res) {
        var counts = (res.j && res.j.counts) || {};
        var today = todayStr();

        // Перший день місяця (0=Нд..6=Сб → конвертуємо в Пн=0)
        var firstDay = new Date(yr, mo, 1);
        var startDow = (firstDay.getDay() + 6) % 7; // 0=Пн
        var daysInMonth = new Date(yr, mo + 1, 0).getDate();

        // Порожні клітинки на початку
        for (var i = 0; i < startDow; i++) {
          var empty = document.createElement("div"); grid.appendChild(empty);
        }

        for (var d2 = 1; d2 <= daysInMonth; d2++) {
          var dateStr = yr + "-" + String(mo+1).padStart(2,"0") + "-" + String(d2).padStart(2,"0");
          var cnt = counts[dateStr] || 0;
          var isToday = dateStr === today;
          var isSelected = dateStr === apptDate && apptViewMode !== "month";

          var cell = document.createElement("div");
          cell.style.cssText = "display:flex;flex-direction:column;align-items:center;padding:6px 2px;border-radius:10px;cursor:pointer;position:relative;" +
            (isToday ? "background:var(--olive-light);color:#fff;" : "");
          cell.addEventListener("click", (function(ds) {
            return function() {
              apptDate = ds;
              apptMonth = ds.slice(0,7);
              apptViewMode = "calendar";
              reloadView();
            };
          })(dateStr));

          var numEl = document.createElement("div");
          numEl.style.cssText = "font-size:.95rem;font-weight:" + (isToday ? "700" : "500") + ";color:" + (isToday ? "#fff" : "var(--cream)") + ";line-height:1.4;";
          numEl.textContent = d2;
          cell.appendChild(numEl);

          if (cnt > 0) {
            var badge = document.createElement("div");
            badge.style.cssText = "width:20px;height:20px;border-radius:50%;background:" +
              (isToday ? "rgba(255,255,255,.3)" : "#1a2016") +
              ";color:#fff;font-size:.62rem;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:2px;";
            badge.textContent = cnt;
            cell.appendChild(badge);
          } else {
            var spacer = document.createElement("div");
            spacer.style.height = "22px";
            cell.appendChild(spacer);
          }
          grid.appendChild(cell);
        }
        ce.appendChild(grid);
      });
    }

    function loadAppts(masterId) {
      document.body.style.overflow = "";
      document.body.style.overscrollBehavior = "";
      var ae = $("app"); if (ae) ae.style.cssText = "";
      contentEl.innerHTML = '<div class="empty">Завантаження…</div>';
      var url = ME.role === "owner"
        ? "/api/crm/appointments?date=" + apptDate + (masterId ? "&master=" + masterId : "")
        : "/api/crm/me/appointments?from=" + apptDate + "&to=" + apptDate;
      api("GET", url).then(function (res) {
        /* Скасовані ховаємо зі списку — вони й так порахуються в
           дашборді (окремий запит до БД, цього фільтра не бачить). */
        var list = (res.j.appointments || []).filter(function (a) { return a.status !== "cancelled"; });
        contentEl.innerHTML = "";
        var listEl = el("div", "list"); contentEl.appendChild(listEl);
        if (!list.length) { listEl.appendChild(el("div", "empty", "На " + ddmm(apptDate) + " записів немає")); return; }
        list.forEach(function (a) { listEl.appendChild(apptItem(a)); });
      });
    }

    function loadCalendar(masterFilter, opts) {
      var zoomOnly = !!(opts && opts.zoomOnly);
      var HOUR_START = 8, HOUR_END = 22;
      var STEP = 10;
      var TIME_COL_W = 44;
      var MASTER_COL_W = window.innerWidth < 600 ? 160 : 170;
      var HEADER_H = 70;
      var TOTAL_MIN = (HOUR_END - HOUR_START) * 60;
      var WEEK_STRIP_H = 90;
      var DAY_UA = ["неділя","понеділок","вівторок","середа","четвер","п'ятниця","субота"];
      var MON_SHORT = ["січ","лют","бер","квіт","трав","черв","лип","серп","вер","жовт","лист","груд"];

      var overlay, scroller;

      if (!zoomOnly) {
        // ── Повна перебудова фрейму ──────────────────────────────
        // Фіксуємо #app щоб PWA-header не міг прокрутитися
        var appEl = $("app");
        appEl.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;overflow:hidden;";
        document.body.style.overscrollBehavior = "none";

        contentEl.innerHTML = "";
        var old = document.getElementById("cal-overlay"); if (old) old.remove();
        var oldWkStrip = document.getElementById("cal-week-strip"); if (oldWkStrip) oldWkStrip.remove();
        var navEl = document.getElementById("mob-nav");
        var navH = navEl ? Math.ceil(navEl.getBoundingClientRect().height) : 0;

        // ── Тижнева стрічка з заголовком місяця + свайп-навігація ──
        var curDay = new Date(apptDate + "T00:00:00");
        var dow0 = (curDay.getDay() + 6) % 7;
        var weekStart = new Date(curDay); weekStart.setDate(curDay.getDate() - dow0);
        var today0 = todayStr();
        var DOW_STRIP = ["Пн","Вт","Ср","Чт","Пт","Сб","Нд"];
        var MON_UA = ["Січень","Лютий","Березень","Квітень","Травень","Червень","Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"];
        var MON_SHORT2 = ["Січ","Лют","Бер","Квіт","Трав","Черв","Лип","Серп","Вер","Жовт","Лист","Груд"];

        var wkStrip = document.createElement("div");
        wkStrip.id = "cal-week-strip";
        wkStrip.style.cssText = "position:fixed;left:0;right:0;bottom:" + navH + "px;height:" + WEEK_STRIP_H + "px;z-index:10;" +
          "background:#fff;border-top:1px solid #d8ddd4;display:flex;flex-direction:column;-webkit-user-select:none;user-select:none;overflow:hidden;";

        // Заголовок місяця
        var midDay = new Date(weekStart); midDay.setDate(weekStart.getDate() + 3);
        var stripMonthHdr = document.createElement("div");
        stripMonthHdr.style.cssText = "text-align:center;font-size:.68rem;font-weight:600;color:#888;padding:5px 0 2px;flex-shrink:0;letter-spacing:.04em;";
        stripMonthHdr.textContent = MON_UA[midDay.getMonth()] + " " + midDay.getFullYear();
        wkStrip.appendChild(stripMonthHdr);

        // Ряд днів
        var daysRow = document.createElement("div");
        daysRow.style.cssText = "display:flex;flex:1;align-items:stretch;";
        for (var wi = 0; wi < 7; wi++) {
          var wd2 = new Date(weekStart); wd2.setDate(weekStart.getDate() + wi);
          var wds = wd2.getFullYear() + "-" + String(wd2.getMonth()+1).padStart(2,"0") + "-" + String(wd2.getDate()).padStart(2,"0");
          var isToday2 = wds === today0;
          var isSel = wds === apptDate;
          var wBtn = document.createElement("button");
          wBtn.style.cssText = "flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:none;cursor:pointer;padding:2px 0 6px;background:transparent;";
          var wDayLbl = document.createElement("span");
          wDayLbl.style.cssText = "font-size:.62rem;font-weight:600;color:" + (isSel ? "#6e9145" : isToday2 ? "#5a7a48" : "#aaa") + ";letter-spacing:.02em;line-height:1;";
          wDayLbl.textContent = DOW_STRIP[wi];
          var wPill = document.createElement("span");
          wPill.style.cssText = "width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;" +
            "font-size:.95rem;font-weight:" + (isSel||isToday2 ? "700" : "500") + ";line-height:1;" +
            "background:" + (isSel ? "#6e9145" : isToday2 ? "#e8f0e0" : "transparent") + ";" +
            "color:" + (isSel ? "#fff" : isToday2 ? "#3d5430" : "#222") + ";";
          wPill.textContent = wd2.getDate();
          wBtn.appendChild(wDayLbl); wBtn.appendChild(wPill);
          (function(ds) {
            wBtn.addEventListener("click", function() {
              if (swMoved) return;
              apptDate = ds; apptMonth = ds.slice(0,7);
              loadCalendar(activeMasterFilter);
            });
          })(wds);
          daysRow.appendChild(wBtn);
        }
        wkStrip.appendChild(daysRow);

        // Панель-прев'ю наступного/попереднього тижня при свайпі
        var swipePreview = document.createElement("div");
        swipePreview.style.cssText = "position:absolute;top:0;bottom:0;left:0;width:100%;background:rgba(18,22,14,.88);display:flex;align-items:center;justify-content:center;z-index:2;transform:translateX(100%);will-change:transform;";
        var swipeLabel = document.createElement("span");
        swipeLabel.style.cssText = "white-space:nowrap;color:#fff;font-size:.82rem;font-weight:700;padding:0 16px;";
        swipePreview.appendChild(swipeLabel);
        wkStrip.appendChild(swipePreview);

        var swTouchX = 0, swTouching = false, swMoved = false;
        wkStrip.addEventListener("touchstart", function(e) {
          if (e.touches.length !== 1) return;
          swTouchX = e.touches[0].clientX; swTouching = true; swMoved = false;
          daysRow.style.transition = "none";
          swipePreview.style.transition = "none";
          // позиціонуємо preview поза екраном (справа) на старті
          var sw0 = wkStrip.offsetWidth || 375;
          swipePreview.style.left = "0";
          swipePreview.style.width = sw0 + "px";
          swipePreview.style.transform = "translateX(" + sw0 + "px)";
        }, { passive: true });
        wkStrip.addEventListener("touchmove", function(e) {
          if (!swTouching) return;
          var dx = e.touches[0].clientX - swTouchX;
          if (Math.abs(dx) > 12) swMoved = true;
          if (!swMoved) return;
          var goLeft = dx < 0;
          var sw1 = wkStrip.offsetWidth || 375;
          // daysRow ковзає разом з пальцем
          daysRow.style.transform = "translateX(" + dx + "px)";
          // preview slide in from the opposite side
          var previewOffset = goLeft ? (sw1 + dx) : (-sw1 + dx);
          swipePreview.style.transform = "translateX(" + previewOffset + "px)";
          // оновлюємо лейбл тижня
          var delta  = goLeft ? 7 : -7;
          var ns = new Date(weekStart); ns.setDate(weekStart.getDate() + delta);
          var ne = new Date(ns); ne.setDate(ns.getDate() + 6);
          swipeLabel.textContent = ns.getDate() + " " + MON_SHORT2[ns.getMonth()] + " – " + ne.getDate() + " " + MON_SHORT2[ne.getMonth()];
        }, { passive: true });
        wkStrip.addEventListener("touchend", function(e) {
          if (!swTouching) return;
          swTouching = false;
          var dx = e.changedTouches[0].clientX - swTouchX;
          if (!swMoved || Math.abs(dx) < 55) {
            // Snap back
            daysRow.style.transition = "transform .2s";
            daysRow.style.transform = "translateX(0)";
            swipePreview.style.transition = "transform .2s";
            var sw2 = wkStrip.offsetWidth || 375;
            swipePreview.style.transform = "translateX(" + (dx < 0 ? sw2 : -sw2) + "px)";
            return;
          }
          var delta2 = dx < 0 ? 7 : -7;
          var d2 = new Date(apptDate + "T00:00:00"); d2.setDate(d2.getDate() + delta2);
          apptDate = d2.getFullYear() + "-" + String(d2.getMonth()+1).padStart(2,"0") + "-" + String(d2.getDate()).padStart(2,"0");
          apptMonth = apptDate.slice(0,7);
          loadCalendar(activeMasterFilter);
        });
        wkStrip.addEventListener("touchcancel", function() {
          swTouching = false;
          daysRow.style.transition = "transform .2s";
          daysRow.style.transform = "translateX(0)";
          var sw3 = wkStrip.offsetWidth || 375;
          swipePreview.style.transition = "transform .2s";
          swipePreview.style.transform = "translateX(" + sw3 + "px)";
        });

        document.body.appendChild(wkStrip);

        // overlay стартує одразу під masterFilterWrap (contentEl порожній)
        var overlayTop = Math.ceil(contentEl.getBoundingClientRect().top);
        overlay = document.createElement("div");
        overlay.id = "cal-overlay";
        overlay.style.cssText = "position:fixed;top:" + overlayTop + "px;left:0;right:0;bottom:" + (navH + WEEK_STRIP_H) + "px;z-index:10;background:#f0f2ee;display:flex;flex-direction:column;-webkit-user-select:none;user-select:none;";
        document.body.appendChild(overlay);

        // ── Pinch-to-zoom ─────────────────────────────────────────
        var pinchStartDist = 0, pinchStartH = calSlotH;
        overlay.addEventListener("touchstart", function(e) {
          if (e.touches.length === 2) {
            var dx = e.touches[0].clientX - e.touches[1].clientX;
            var dy = e.touches[0].clientY - e.touches[1].clientY;
            pinchStartDist = Math.sqrt(dx*dx + dy*dy);
            pinchStartH = calSlotH;
          }
        }, { passive: true });
        overlay.addEventListener("touchmove", function(e) {
          if (e.touches.length === 2 && pinchStartDist > 0) {
            e.preventDefault();
            var dx = e.touches[0].clientX - e.touches[1].clientX;
            var dy = e.touches[0].clientY - e.touches[1].clientY;
            var dist = Math.sqrt(dx*dx + dy*dy);
            var newH = Math.round(Math.min(50, Math.max(14, pinchStartH * dist / pinchStartDist)));
            calSlotH = newH;
            // масштабуємо лише сітку (body), НЕ header
            if (calBody) {
              calBody.style.transform = "scaleY(" + (newH / pinchStartH) + ")";
              calBody.style.transformOrigin = "top left";
            }
          }
        }, { passive: false });
        overlay.addEventListener("touchend", function() {
          if (pinchStartDist > 0) {
            pinchStartDist = 0;
            if (calBody) { calBody.style.transform = ""; calBody.style.transformOrigin = ""; }
            loadCalendar(activeMasterFilter, { zoomOnly: true });
          }
        });

        // ── Прокручуваний контейнер ───────────────────────────────
        scroller = document.createElement("div");
        scroller.style.cssText = "overflow-x:auto;overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;width:100%;touch-action:pan-x pan-y;overscroll-behavior:none;";
        overlay.appendChild(scroller);
        calScroller = scroller;
      } else {
        // Zoom-only: reuse existing overlay/scroller
        overlay = document.getElementById("cal-overlay");
        scroller = calScroller;
        if (!scroller || !overlay) { loadCalendar(masterFilter); return; }
      }

      // Очищаємо попередній inner (якщо є)
      var prevInner = scroller.querySelector("[data-cal-inner]");
      if (prevInner) prevInner.remove();
      calBody = null;

      var SLOT_H = calSlotH;
      var TOTAL_H = (TOTAL_MIN / STEP) * SLOT_H;
      var wd = new Date(apptDate + "T00:00:00").getDay();
      var apptUrl = ME.role === "owner"
        ? "/api/crm/appointments?date=" + apptDate + (masterFilter ? "&master=" + masterFilter : "")
        : "/api/crm/schedule?date=" + apptDate;

      Promise.all([
        api("GET", "/api/crm/masters"),
        api("GET", apptUrl),
        api("GET", "/api/crm/day-schedules?weekday=" + wd),
        api("GET", "/api/crm/day-blocks?date=" + apptDate),
        api("GET", "/api/crm/masters-overrides?from=" + apptDate + "&to=" + apptDate)
      ]).then(function(rs) {
        var allMasters = rs[0].j.masters || [];
        var appts = (rs[1].j.appointments || []).filter(function(a) { return a.status !== "cancelled"; });
        var dayScheds = rs[2].j.schedules || [];
        var dayBreaks = rs[2].j.breaks || [];
        var dayBlocksArr = (rs[3].j && rs[3].j.blocks) || [];
        var dayOvs = (rs[4].j && rs[4].j.overrides) || [];

        var masters = masterFilter
          ? allMasters.filter(function(m) { return String(m.id) === String(masterFilter); })
          : allMasters;

        var schedMap = {};
        dayScheds.forEach(function(s) { schedMap[s.master_id] = { ws: s.work_start, we: s.work_end, bks: [] }; });
        dayBreaks.forEach(function(b) { if (schedMap[b.master_id]) schedMap[b.master_id].bks.push({ s: b.break_start, e: b.break_end }); });

        // Застосовуємо day overrides: is_off=1 → видаляємо з schedMap; is_off=0 → оновлюємо години
        var offIds = {};
        dayOvs.forEach(function(ov) {
          if (ov.is_off) {
            delete schedMap[ov.master_id];
            offIds[ov.master_id] = true;
          } else if (ov.work_start != null && ov.work_end != null) {
            schedMap[ov.master_id] = { ws: ov.work_start, we: ov.work_end, bks: (schedMap[ov.master_id] || {}).bks || [] };
          }
        });
        // Приховуємо майстрів з вихідним якщо у них немає записів на цей день
        masters = masters.filter(function(m) {
          if (!offIds[m.id]) return true;
          return appts.some(function(a) { return a.master_id === m.id; });
        });

        var dayBlocksMap = {};
        dayBlocksArr.forEach(function(blk) {
          if (!dayBlocksMap[blk.master_id]) dayBlocksMap[blk.master_id] = [];
          dayBlocksMap[blk.master_id].push(blk);
        });

        function isUnavail(mid, absMin) {
          var s = schedMap[mid];
          if (!s) return true;
          if (absMin < s.ws || absMin >= s.we) return true;
          for (var i = 0; i < s.bks.length; i++) { if (absMin >= s.bks[i].s && absMin < s.bks[i].e) return true; }
          var dbs = dayBlocksMap[mid] || [];
          for (var j = 0; j < dbs.length; j++) { if (absMin >= dbs[j].start_min && absMin < dbs[j].end_min) return true; }
          return false;
        }

        // Стан touch/long-press для всіх колонок
        var calTouchMoved = false, calTX = 0, calTY = 0, calLpHandled = false;
        var lpActive = false, lpTimer = null, lpInd = null, lpAbsMin = 0, lpMasterRef = null;
        var dragState = { active: false, ghost: null, dropZone: null, apptId: null, origMasterId: null, targetMasterId: null, targetMasterName: null, targetStartMin: null };

        function removeLpInd() { if (lpInd) { lpInd.remove(); lpInd = null; } }

        function showLpInd(col, absMin) {
          removeLpInd();
          var yt = ((absMin - HOUR_START * 60) / STEP) * SLOT_H;
          var d = document.createElement("div");
          d.style.cssText = "position:absolute;left:3px;right:3px;top:" + yt + "px;height:" + (SLOT_H * 1) + "px;" +
            "border:2px dashed #6e9145;border-radius:8px;background:rgba(110,145,69,.07);z-index:15;pointer-events:none;" +
            "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;";
          d.innerHTML =
            '<div style="width:30px;height:30px;border-radius:50%;background:#6e9145;color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.5rem;line-height:1;font-weight:300;">+</div>' +
            '<div id="lp-time-label" style="background:#6e9145;color:#fff;font-size:.65rem;font-weight:700;padding:2px 7px;border-radius:10px;">' + fmtMin(absMin) + '</div>';
          col.appendChild(d);
          lpInd = d;
        }

        function moveLpInd(absMin) {
          if (!lpInd) return;
          var yt = ((absMin - HOUR_START * 60) / STEP) * SLOT_H;
          lpInd.style.top = yt + "px";
          var lbl = document.getElementById("lp-time-label");
          if (lbl) lbl.textContent = fmtMin(absMin);
        }

        // Вміст контекстного меню (спільний для click і long-press)
        function openCalCtx(master, absMin, screenX, screenY) {
          var oldCtx = document.getElementById("cal-ctx");
          if (oldCtx) { oldCtx.remove(); return; }
          // Майстер може взаємодіяти тільки з власною колонкою
          if (ME.role !== "owner" && master.id !== ME.masterId) return;
          var unavail = isUnavail(master.id, absMin);
          var ctx = document.createElement("div");
          ctx.id = "cal-ctx";
          ctx.style.cssText = "position:fixed;left:" + (screenX + 8) + "px;top:" + (screenY - 10) + "px;" +
            "background:#fff;border:1px solid #d8ddd4;border-radius:10px;padding:6px;z-index:200;" +
            "box-shadow:0 6px 24px rgba(0,0,0,.15);min-width:180px;";
          ctx.innerHTML =
            '<div style="font-size:.68rem;color:#888;padding:4px 8px 6px;border-bottom:1px solid #eee;font-weight:500;">' +
            fmtMin(absMin) + ' · ' + (master.name || '') + '</div>' +
            (!unavail ? '<button id="ctx-appt" style="display:block;width:100%;text-align:left;background:none;border:none;padding:10px 10px;font-size:.9rem;cursor:pointer;border-radius:6px;">📅 Новий запис</button>' : '') +
            '<button id="ctx-break" style="display:block;width:100%;text-align:left;background:none;border:none;padding:10px 10px;font-size:.9rem;cursor:pointer;border-radius:6px;">⏸ Перерва</button>';
          document.body.appendChild(ctx);

          var ctxR = ctx.getBoundingClientRect();
          if (ctxR.right > window.innerWidth - 8) ctx.style.left = (screenX - ctxR.width - 8) + "px";
          if (ctxR.bottom > window.innerHeight - 8) ctx.style.top = (screenY - ctxR.height + 10) + "px";

          function closeCtx() { var c = document.getElementById("cal-ctx"); if (c) c.remove(); }

          if (document.getElementById("ctx-appt")) {
            document.getElementById("ctx-appt").addEventListener("click", function() {
              closeCtx();
              apptModal({ prefill: { masterId: master.id, date: apptDate, startMin: absMin } });
            });
          }
          document.getElementById("ctx-break").addEventListener("click", function() {
            closeCtx();
            var endMin = Math.min(absMin + 60, HOUR_END * 60);
            var html = '<h3>⏸ Перерва — ' + (master.name || '') + '</h3>' +
              '<div class="grid2"><div><label>Від</label><input type="time" id="bkFrom" value="' + fmtMin(absMin) + '"></div>' +
              '<div><label>До</label><input type="time" id="bkTo" value="' + fmtMin(endMin) + '"></div></div>' +
              '<label style="margin-top:10px;display:block;">Нотатка</label>' +
              '<input type="text" id="bkNote" placeholder="Необов\'язково">' +
              '<div class="err" id="bkErr"></div>' +
              '<div class="modal-foot">' +
              '<button class="btn btn-primary" id="bkSave">Зберегти</button>' +
              '<button class="btn btn-ghost" id="bkClose">Скасувати</button></div>';
            openModal(html);
            $("bkSave").addEventListener("click", function() {
              var f = $("bkFrom").value.split(":"), t2 = $("bkTo").value.split(":");
              var sm = parseInt(f[0]) * 60 + parseInt(f[1]);
              var em = parseInt(t2[0]) * 60 + parseInt(t2[1]);
              if (em <= sm) { $("bkErr").textContent = "«До» має бути пізніше «Від»"; return; }
              api("POST", "/api/crm/day-blocks", {
                master_id: master.id, date: apptDate, start_min: sm, end_min: em,
                note: $("bkNote").value.trim() || null
              }).then(function(res) {
                if (!res.j.ok) { $("bkErr").textContent = "Помилка"; return; }
                closeModal(); loadCalendar(activeMasterFilter);
              });
            });
            $("bkClose").addEventListener("click", closeModal);
          });

          setTimeout(function() {
            document.addEventListener("click", function onDoc() {
              closeCtx(); document.removeEventListener("click", onDoc);
            });
          }, 50);
        }

        var inner = document.createElement("div");
        inner.setAttribute("data-cal-inner", "1");
        inner.style.cssText = "display:inline-flex;flex-direction:column;min-width:" + (TIME_COL_W + masters.length * MASTER_COL_W) + "px;width:100%;";
        scroller.appendChild(inner);

        // ── Липкий заголовок ──
        var header = document.createElement("div");
        header.style.cssText = "display:flex;position:sticky;top:0;z-index:20;background:#ffffff;border-bottom:2px solid #d8ddd4;flex-shrink:0;";
        inner.appendChild(header);

        var corner = document.createElement("div");
        corner.style.cssText = "flex:0 0 " + TIME_COL_W + "px;height:" + HEADER_H + "px;border-right:1px solid #d8ddd4;background:#f8f8f6;position:sticky;left:0;z-index:25;display:flex;align-items:center;justify-content:center;";
        // Кнопка "← місяць" тільки з вкладки "Записи" (не Розклад)
        if (tabTitle === "Записи") {
          var backToMonth = document.createElement("button");
          backToMonth.title = "Місяць";
          backToMonth.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
          backToMonth.style.cssText = "background:none;border:none;cursor:pointer;padding:6px;border-radius:8px;color:#5a7a48;display:flex;align-items:center;justify-content:center;";
          backToMonth.addEventListener("click", function() {
            clearOverlay();
            apptViewMode = "month";
            apptMonth = apptDate.slice(0,7);
            reloadView();
          });
          corner.appendChild(backToMonth);
        }
        header.appendChild(corner);

        masters.forEach(function(m) {
          var hCell = document.createElement("div");
          hCell.style.cssText = "flex:1;min-width:" + MASTER_COL_W + "px;height:" + HEADER_H + "px;border-right:1px solid #d8ddd4;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px 4px;overflow:hidden;background:#fff;cursor:pointer;";
          var initials = (m.name||'?').charAt(0).toUpperCase() + (m.last_name ? m.last_name.charAt(0).toUpperCase() : '');
          var avHtml = m.photo
            ? '<img src="' + m.photo + '" style="width:34px;height:34px;border-radius:50%;object-fit:cover;border:2px solid #8aA462;flex-shrink:0;" alt="">'
            : '<div style="width:34px;height:34px;border-radius:50%;background:#3d5430;display:flex;align-items:center;justify-content:center;color:#8aA462;font-weight:700;font-size:.78rem;flex-shrink:0;">' + initials + '</div>';
          hCell.innerHTML = avHtml +
            '<div style="text-align:center;line-height:1.2;">' +
            '<div style="font-size:.73rem;font-weight:600;color:#1a2016;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px;">' + (m.name||'') + (m.last_name ? ' ' + m.last_name : '') + '</div>' +
            '<div style="font-size:.6rem;color:#5a7a48;margin-top:1px;">' + (m.level||'') + '</div>' +
            '</div>';
          header.appendChild(hCell);
        });

        // ── Тіло: колонка часу + колонки майстрів ──
        var body = document.createElement("div");
        body.style.cssText = "display:flex;flex:1;";
        inner.appendChild(body);
        calBody = body;

        // Колонка часу
        var tCol = document.createElement("div");
        tCol.style.cssText = "flex:0 0 " + TIME_COL_W + "px;border-right:1px solid #d8ddd4;position:sticky;left:0;z-index:11;height:" + TOTAL_H + "px;background:#f8f8f6;";
        for (var tm = HOUR_START * 60; tm <= HOUR_END * 60; tm += STEP) {
          var ty = ((tm - HOUR_START * 60) / STEP) * SLOT_H;
          var isHour = (tm % 60 === 0);
          var sep = document.createElement("div");
          sep.style.cssText = "position:absolute;top:" + ty + "px;left:0;right:0;border-top:1px solid " + (isHour ? "#c8cfc4" : "#e2e6de") + ";pointer-events:none;";
          tCol.appendChild(sep);
          if (tm < HOUR_END * 60) {
            var lbl = document.createElement("div");
            var hPart = Math.floor(tm / 60), mPart = tm % 60;
            lbl.style.cssText = "position:absolute;top:" + (ty + 2) + "px;left:0;right:2px;text-align:right;font-size:.55rem;pointer-events:none;" +
              (isHour ? "color:#444;font-weight:600;" : "color:#aaa;");
            lbl.textContent = String(hPart).padStart(2,"0") + ":" + String(mPart).padStart(2,"0");
            tCol.appendChild(lbl);
          }
        }
        body.appendChild(tCol);

        // Колонки майстрів
        masters.forEach(function(master) {
          var mCol = document.createElement("div");
          mCol.style.cssText = "flex:1;min-width:" + MASTER_COL_W + "px;border-right:1px solid #d8ddd4;position:relative;height:" + TOTAL_H + "px;background:#fff;touch-action:pan-x pan-y;";
          mCol.dataset.masterId = master.id;
          mCol.dataset.masterName = master.name || "";

          // Лінії кожні 10 хвилин
          for (var tm2 = (HOUR_START + 1) * 60; tm2 <= HOUR_END * 60; tm2 += STEP) {
            var isHour2 = (tm2 % 60 === 0);
            var hl = document.createElement("div");
            hl.style.cssText = "position:absolute;top:" + (((tm2 - HOUR_START * 60) / STEP) * SLOT_H) + "px;left:0;right:0;" +
              "border-top:1px solid " + (isHour2 ? "#d8ddd4" : "#eeefec") + ";pointer-events:none;z-index:1;";
            mCol.appendChild(hl);
          }

          // Штрихування для неробочих проміжків
          var sched = schedMap[master.id];
          var unavRanges = [];
          if (!sched) {
            unavRanges.push({ s: HOUR_START * 60, e: HOUR_END * 60 });
          } else {
            if (sched.ws > HOUR_START * 60) unavRanges.push({ s: HOUR_START * 60, e: sched.ws });
            sched.bks.forEach(function(b) { unavRanges.push({ s: b.s, e: b.e }); });
            if (sched.we < HOUR_END * 60) unavRanges.push({ s: sched.we, e: HOUR_END * 60 });
          }
          unavRanges.forEach(function(r) {
            var yt = ((r.s - HOUR_START * 60) / STEP) * SLOT_H;
            var yh = ((r.e - r.s) / STEP) * SLOT_H;
            var stripe = document.createElement("div");
            stripe.style.cssText = "position:absolute;left:0;right:0;top:" + yt + "px;height:" + yh + "px;" +
              "background-color:#ebebea;background-image:repeating-linear-gradient(-45deg,rgba(0,0,0,.04) 0,rgba(0,0,0,.04) 3px,transparent 3px,transparent 9px);pointer-events:none;z-index:1;";
            mCol.appendChild(stripe);
          });

          // Перерви на конкретну дату (day_blocks)
          (dayBlocksMap[master.id] || []).forEach(function(blk) {
            var yt = ((blk.start_min - HOUR_START * 60) / STEP) * SLOT_H;
            var yh = ((blk.end_min - blk.start_min) / STEP) * SLOT_H;
            var blkDiv = document.createElement("div");
            blkDiv.style.cssText = "position:absolute;left:0;right:0;top:" + yt + "px;height:" + yh + "px;" +
              "background:#fff8ee;border-left:3px solid #e8a020;z-index:2;" +
              "display:flex;align-items:flex-start;justify-content:space-between;padding:3px 5px 2px;overflow:hidden;";
            var lbl = fmtMin(blk.start_min) + "–" + fmtMin(blk.end_min) + (blk.note ? " · " + blk.note : "");
            blkDiv.innerHTML =
              '<span style="font-size:.6rem;color:#a06010;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">⏸ ' + lbl + '</span>' +
              '<button style="background:none;border:none;cursor:pointer;font-size:.7rem;color:#a06010;padding:0;flex-shrink:0;line-height:1;">✕</button>';
            blkDiv.querySelector("button").addEventListener("click", function(e) {
              e.stopPropagation();
              api("DELETE", "/api/crm/day-blocks/" + blk.id).then(function(res) {
                if (res.j.ok) loadCalendar(activeMasterFilter);
              });
            });
            mCol.appendChild(blkDiv);
          });

          // ── Touch: long-press → індикатор + drag ──────────────────
          mCol.addEventListener("touchstart", function(e) {
            var t = e.touches[0];
            calTX = t.clientX; calTY = t.clientY; calTouchMoved = false;
            var rect = mCol.getBoundingClientRect();
            var relMin = Math.floor((t.clientY - rect.top) / SLOT_H) * STEP;
            lpAbsMin = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - STEP, HOUR_START * 60 + relMin));
            lpMasterRef = master;
            clearTimeout(lpTimer);
            lpTimer = setTimeout(function() {
              lpActive = true;
              if (navigator.vibrate) navigator.vibrate(30);
              showLpInd(mCol, lpAbsMin);
            }, 380);
          }, { passive: true });

          mCol.addEventListener("touchmove", function(e) {
            if (lpActive) {
              e.preventDefault();
              var t = e.touches[0];
              var rect = mCol.getBoundingClientRect();
              var relMin = Math.round((t.clientY - rect.top) / SLOT_H) * STEP;
              var newMin = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - STEP, HOUR_START * 60 + relMin));
              if (newMin !== lpAbsMin) { lpAbsMin = newMin; moveLpInd(newMin); }
            } else {
              var moved = Math.abs(e.touches[0].clientX - calTX) > 6 || Math.abs(e.touches[0].clientY - calTY) > 6;
              if (moved) { clearTimeout(lpTimer); lpTimer = null; calTouchMoved = true; }
            }
          }, { passive: false });

          mCol.addEventListener("touchend", function(e) {
            clearTimeout(lpTimer); lpTimer = null;
            if (lpActive) {
              lpActive = false; removeLpInd();
              calLpHandled = true;
              setTimeout(function() { calLpHandled = false; }, 600);
              var t = e.changedTouches[0];
              openCalCtx(master, lpAbsMin, t.clientX, t.clientY);
            }
          });

          mCol.addEventListener("touchcancel", function() {
            clearTimeout(lpTimer); lpTimer = null;
            lpActive = false; removeLpInd();
          });

          // ── Клік мишею (десктоп) ──────────────────────────────────
          mCol.addEventListener("click", function(e) {
            if (calTouchMoved || calLpHandled) { calTouchMoved = false; return; }
            var rect = mCol.getBoundingClientRect();
            var relMin = Math.floor((e.clientY - rect.top) / SLOT_H) * STEP;
            var clickAbsMin = HOUR_START * 60 + relMin;
            openCalCtx(master, clickAbsMin, e.clientX, e.clientY);
          });

          // Блоки записів — lane-assignment для відображення записів що накладаються
          var masterAppts = appts.filter(function(a) { return a.master_id === master.id; })
            .sort(function(a, b) { return a.start_min - b.start_min; });
          var laneEnd = [];
          var laneMap = {};
          masterAppts.forEach(function(a) {
            var aEnd = a.end_min || (a.start_min + a.duration_min);
            var lane = -1;
            for (var li = 0; li < laneEnd.length; li++) { if (laneEnd[li] <= a.start_min) { lane = li; laneEnd[li] = aEnd; break; } }
            if (lane === -1) { lane = laneEnd.length; laneEnd.push(aEnd); }
            laneMap[a.id] = lane;
          });
          masterAppts.forEach(function(a) {
            var aEnd = a.end_min || (a.start_min + a.duration_min);
            var maxLane = laneMap[a.id];
            masterAppts.forEach(function(b) {
              var bEnd = b.end_min || (b.start_min + b.duration_min);
              if (b.start_min < aEnd && bEnd > a.start_min) maxLane = Math.max(maxLane, laneMap[b.id]);
            });
            laneMap["_n" + a.id] = maxLane + 1;
          });

          masterAppts.forEach(function(a) {
            var startRel = a.start_min - HOUR_START * 60;
            if (startRel < 0 || startRel >= TOTAL_MIN) return;
            var topPx = (startRel / STEP) * SLOT_H + 1;
            var heightPx = Math.max((a.duration_min / STEP) * SLOT_H - 2, SLOT_H * 2 - 2);
            var aLane = laneMap[a.id] || 0;
            var nLanes = laneMap["_n" + a.id] || 1;
            var pct = 100 / nLanes;
            var leftPct = aLane * pct;

            var markerHex = a.color_marker || DEFAULT_MARKER;
            var timeStr = fmtMin(a.start_min) + " – " + fmtMin(a.end_min || (a.start_min + a.duration_min));
            var svcName = (a.service_name||'').replace(/\s*\([^)]*\)\s*/g,'').trim();
            var hasNote = !!(a.comment && a.comment.trim());

            var block = document.createElement("div");
            block.id = "cal-block-" + a.id;
            block.style.cssText = "position:absolute;left:calc(" + leftPct + "% + 2px);width:calc(" + pct + "% - 4px);top:" + topPx + "px;height:" + heightPx + "px;" +
              "background:" + markerHex + ";border-radius:5px;" +
              "padding:3px 5px 2px 5px;overflow:hidden;cursor:pointer;z-index:3;";

            var html = "";
            if (heightPx >= 22) {
              html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:2px;margin-bottom:1px;">' +
                '<span style="font-size:.58rem;font-weight:700;color:rgba(255,255,255,.95);white-space:nowrap;">' + timeStr + '</span>' +
                (hasNote ? '<span style="font-size:.58rem;opacity:.8;flex-shrink:0;line-height:1;">💬</span>' : '') +
                '</div>';
            }
            html += '<div style="font-size:.68rem;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">' + a.client_name + '</div>';
            if (heightPx >= 44) html += '<div style="font-size:.58rem;color:rgba(255,255,255,.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + svcName + '</div>';
            if (heightPx >= 60 && a.price) html += '<div style="font-size:.58rem;color:rgba(255,255,255,.8);margin-top:1px;">' + a.duration_min + ' хв · ' + Math.round(a.price/100) + ' ₴</div>';
            block.innerHTML = html;

            // ── Drag block: long-press → drag to new master or new time ──
            var blkDragX = 0, blkDragY = 0, blkDragRect = null, blkLpTimer = null, blkReady = false;

            function blkCancelLp() {
              clearTimeout(blkLpTimer); blkLpTimer = null; blkReady = false;
              block.style.transform = ""; block.style.transition = "";
            }

            function finishBlockDrag() {
              blkCancelLp();
              if (dragState.ghost) { dragState.ghost.remove(); dragState.ghost = null; }
              if (dragState.dropZone) { dragState.dropZone.remove(); dragState.dropZone = null; }
              block.style.opacity = "";
              var prevHl = document.querySelector(".cal-drag-hl");
              if (prevHl) { prevHl.classList.remove("cal-drag-hl"); prevHl.style.background = ""; }
            }

            block.addEventListener("touchstart", function(e) {
              var t = e.touches[0];
              blkDragX = t.clientX; blkDragY = t.clientY;
              blkDragRect = block.getBoundingClientRect();
              blkReady = false;
              dragState.apptId = a.id;
              dragState.targetStartMin = a.start_min;
              blkLpTimer = setTimeout(function() {
                blkReady = true;
                if (navigator.vibrate) navigator.vibrate(40);
                block.style.transition = "transform .12s";
                block.style.transform  = "scale(1.06)";
                calTouchMoved = true;
              }, 400);
            }, { passive: true });

            block.addEventListener("touchmove", function(e) {
              if (dragState.apptId !== a.id) return;
              var t = e.touches[0];
              var dx = t.clientX - blkDragX;
              var dy = t.clientY - blkDragY;

              if (!blkReady) {
                if (Math.abs(dx) > 8 || Math.abs(dy) > 8) blkCancelLp();
                return;
              }

              if (!dragState.active) {
                dragState.active = true;
                clearTimeout(lpTimer); lpTimer = null; lpActive = false; removeLpInd();
                block.style.transform = ""; block.style.transition = "";
                var ghost = block.cloneNode(true);
                ghost.style.cssText = block.style.cssText +
                  ";position:fixed;left:" + blkDragRect.left + "px;top:" + blkDragRect.top + "px;width:" + blkDragRect.width + "px;height:" + blkDragRect.height + "px;z-index:500;opacity:.88;pointer-events:none;box-shadow:0 8px 28px rgba(0,0,0,.28);transform:scale(1.05);";
                // mark first span so we can update time text
                var firstSpan = ghost.querySelector("span");
                if (firstSpan) firstSpan.dataset.dragTime = "1";
                document.body.appendChild(ghost);
                dragState.ghost = ghost;
                block.style.opacity = "0.3";
              }

              e.preventDefault();
              dragState.ghost.style.left = (blkDragRect.left + dx) + "px";
              dragState.ghost.style.top  = (blkDragRect.top  + dy) + "px";

              var prevHl = document.querySelector(".cal-drag-hl");
              if (prevHl) { prevHl.classList.remove("cal-drag-hl"); prevHl.style.background = ""; }

              dragState.ghost.style.visibility = "hidden";
              var elUnder = document.elementFromPoint(t.clientX, t.clientY);
              dragState.ghost.style.visibility = "";
              var el2 = elUnder;
              while (el2 && !el2.dataset.masterId && el2 !== document.body) el2 = el2.parentElement;

              if (el2 && el2.dataset.masterId) {
                dragState.targetMasterId   = el2.dataset.masterId;
                dragState.targetMasterName = el2.dataset.masterName;
                // calc new start time from ghost vertical position within column
                var mColR = el2.getBoundingClientRect();
                var blockTopInCol = (blkDragRect.top + dy) - mColR.top;
                var rawMin = Math.round(blockTopInCol / SLOT_H) * STEP + HOUR_START * 60;
                var snapped = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - a.duration_min, rawMin));
                dragState.targetStartMin = snapped;
                // update time label in ghost
                var tLbl = dragState.ghost.querySelector("[data-drag-time]");
                if (tLbl) tLbl.textContent = fmtMin(snapped) + " – " + fmtMin(snapped + a.duration_min);
                if (String(el2.dataset.masterId) !== String(master.id)) {
                  el2.classList.add("cal-drag-hl");
                  el2.style.background = "rgba(110,145,69,.12)";
                }
                // drop-zone shadow inside target column
                var dzTopPx = ((snapped - HOUR_START * 60) / STEP) * SLOT_H + 1;
                var dzH     = Math.max((a.duration_min / STEP) * SLOT_H - 2, SLOT_H * 2 - 2);
                if (!dragState.dropZone || dragState.dropZone.parentElement !== el2) {
                  if (dragState.dropZone) dragState.dropZone.remove();
                  var dz = document.createElement("div");
                  dz.style.cssText = "position:absolute;left:2px;right:2px;border-radius:5px;pointer-events:none;z-index:4;box-sizing:border-box;" +
                    "display:flex;align-items:center;justify-content:center;font-size:.6rem;font-weight:700;";
                  el2.appendChild(dz);
                  dragState.dropZone = dz;
                }
                dragState.dropZone.style.top        = dzTopPx + "px";
                dragState.dropZone.style.height     = dzH + "px";
                dragState.dropZone.style.background = markerHex;
                dragState.dropZone.style.opacity    = ".35";
                dragState.dropZone.style.border     = "2px dashed rgba(255,255,255,.7)";
                dragState.dropZone.textContent      = "";
              } else {
                dragState.targetMasterId = null;
                dragState.targetMasterName = null;
                dragState.targetStartMin = a.start_min;
                if (dragState.dropZone) { dragState.dropZone.remove(); dragState.dropZone = null; }
              }
            }, { passive: false });

            block.addEventListener("touchend", function() {
              if (dragState.apptId !== a.id || !dragState.active) {
                finishBlockDrag();
                dragState = { active: false, ghost: null, dropZone: null, apptId: null, targetMasterId: null, targetMasterName: null, targetStartMin: null };
                return;
              }
              var targetId      = dragState.targetMasterId;
              var targetName    = dragState.targetMasterName;
              var newStartMin   = dragState.targetStartMin != null ? dragState.targetStartMin : a.start_min;
              finishBlockDrag();
              dragState = { active: false, ghost: null, dropZone: null, apptId: null, targetMasterId: null, targetMasterName: null, targetStartMin: null };

              var masterChanged = targetId && String(targetId) !== String(a.master_id);
              var timeChanged   = newStartMin !== a.start_min;
              if (!targetId || (!masterChanged && !timeChanged)) return;

              openModal(
                '<h3 style="margin:0 0 10px;">Перенести запис?</h3>' +
                '<div style="font-size:.92rem;color:#222;font-weight:600;margin-bottom:6px;">' + a.client_name + '</div>' +
                (masterChanged ? '<div style="font-size:.85rem;color:#555;margin-bottom:4px;">Майстер: <strong>' + targetName + '</strong></div>' : '') +
                '<div style="font-size:.85rem;color:#555;margin-bottom:18px;">Час: <strong>' + fmtMin(newStartMin) + ' – ' + fmtMin(newStartMin + a.duration_min) + '</strong></div>' +
                '<div class="modal-foot">' +
                '<button id="dragConfirmBtn" class="btn btn-primary">Перенести</button>' +
                '<button id="dragCancelBtn" class="btn btn-ghost">Скасувати</button>' +
                '</div>'
              );
              document.getElementById("dragCancelBtn").addEventListener("click", closeModal);
              document.getElementById("dragConfirmBtn").addEventListener("click", function() {
                api("PATCH", "/api/crm/appointments/" + a.id, { master: parseInt(targetId, 10), date: apptDate, start_min: newStartMin })
                  .then(function(r) { closeModal(); if (r.j && r.j.ok) loadCalendar(activeMasterFilter, { zoomOnly: true }); });
              });
            });

            block.addEventListener("touchcancel", function() {
              finishBlockDrag();
              dragState = { active: false, ghost: null, dropZone: null, apptId: null, targetMasterId: null, targetMasterName: null, targetStartMin: null };
            });

            block.addEventListener("click", function(e) {
              if (dragState.active) { e.stopPropagation(); return; }
              e.stopPropagation();
              var oldP = document.getElementById("cal-popup");
              if (oldP) oldP.remove();
              var popup = document.createElement("div");
              popup.id = "cal-popup";
              var ts2 = fmtMin(a.start_min) + "–" + fmtMin(a.end_min || (a.start_min + a.duration_min));
              var popMarker = a.color_marker || DEFAULT_MARKER;
              popup.innerHTML =
                '<div style="font-size:.95rem;font-weight:600;color:#111;margin-bottom:6px;">' + a.client_name + '</div>' +
                '<div style="font-size:.8rem;color:#555;margin-bottom:3px;">🕐 ' + ts2 + '</div>' +
                '<div style="font-size:.8rem;color:#555;margin-bottom:3px;">💆 ' + svcName + '</div>' +
                '<div style="font-size:.8rem;color:#555;margin-bottom:8px;">👤 ' + (a.master_name||'') + '</div>' +
                (a.price ? '<div style="font-size:.82rem;color:#3d6b28;margin-bottom:8px;">' + Math.round(a.price/100) + ' ₴' + (a.paid ? ' ✓' : '') + '</div>' : '') +
                '<div style="margin-bottom:' + (hasNote ? '8' : '10') + 'px;"><span class="badge b-' + a.status + '" style="font-size:.7rem;">' + (STATUS_LABEL[a.status]||a.status) + '</span></div>' +
                (hasNote ? '<div style="font-size:.78rem;color:#555;margin-bottom:10px;">💬 ' + a.comment + '</div>' : '') +
                '<div style="display:flex;gap:6px;">' +
                '<button id="cal-popup-detail" style="flex:1;background:' + popMarker + ';color:#fff;border:none;border-radius:7px;padding:6px 10px;font-size:.78rem;font-weight:600;cursor:pointer;">Детальніше</button>' +
                '<button id="cal-popup-close" style="background:none;border:1px solid #ccc;color:#555;border-radius:7px;padding:6px 10px;font-size:.78rem;cursor:pointer;">✕</button>' +
                '</div>';
              var rect2 = block.getBoundingClientRect();
              var popW = 230;
              var left = rect2.right + 8;
              if (left + popW > window.innerWidth - 10) left = rect2.left - popW - 8;
              if (left < 8) left = 8;
              var top = Math.min(Math.max(10, rect2.top), window.innerHeight - 320);
              popup.style.cssText = "position:fixed;left:" + left + "px;top:" + top + "px;width:" + popW + "px;background:#fff;border:1px solid " + popMarker + ";border-radius:12px;padding:14px;z-index:200;box-shadow:0 4px 20px rgba(0,0,0,.18);";
              document.body.appendChild(popup);
              document.getElementById("cal-popup-close").addEventListener("click", function(ev) { ev.stopPropagation(); popup.remove(); });
              document.getElementById("cal-popup-detail").addEventListener("click", function(ev) { ev.stopPropagation(); popup.remove(); window.apptDetailModal(a); });
              setTimeout(function() {
                document.addEventListener("click", function onDocClick() {
                  var p = document.getElementById("cal-popup"); if (p) p.remove();
                  document.removeEventListener("click", onDocClick);
                });
              }, 10);
            });
            mCol.appendChild(block);
          });

          body.appendChild(mCol);
        });

        // Авто-прокрутка: сьогодні → поточний час - 30 хв, інші дні → 9:00
        var scrollMin;
        if (apptDate === todayStr()) {
          var now = new Date();
          scrollMin = Math.max(0, now.getHours() * 60 + now.getMinutes() - 30 - HOUR_START * 60);
        } else {
          scrollMin = Math.max(0, 9 * 60 - HOUR_START * 60);
        }
        scroller.scrollTop = (scrollMin / STEP) * SLOT_H;
      });
    }

    function restoreMain() {
      var ov = document.getElementById("cal-overlay"); if (ov) ov.remove();
      var ws = document.getElementById("cal-week-strip"); if (ws) ws.remove();
    }

    window.__reloadAppts = function () {
      if (apptViewMode === "calendar") loadCalendar(activeMasterFilter);
      else { restoreMain(); loadAppts(activeMasterFilter); }
    };
    // початкове завантаження (без фільтру майстра) для майстра
    if (ME.role !== "owner") reloadView();
  }

  /* ---- Детальна картка запису (для календаря) ---- */
  window.apptDetailModal = function apptDetailModal(a) {
    var html = '<h3>' + a.client_name + '</h3>' +
      '<div class="sub" style="margin-bottom:12px;">' + a.service_name + ' · ' + fmtMin(a.start_min) + '–' + fmtMin(a.end_min || (a.start_min + a.duration_min)) + ' · ' + a.master_name + '</div>' +
      '<div class="sub">' + (a.client_phone || '<span style="color:#aaa;">🔒 телефон приховано</span>') + '</div>' +
      (a.comment ? '<div class="sub" style="margin-top:8px;">💬 ' + a.comment + '</div>' : '') +
      '<div style="margin-top:14px;"><span class="badge b-' + a.status + '">' + (STATUS_LABEL[a.status]||a.status) + '</span></div>' +
      '<label style="margin-top:14px;display:block;">Колір маркеру</label><div id="dMarkerWrap"></div>';

    // Оцінка (лише для завершених)
    if (a.status === "completed") {
      html += '<label style="margin-top:14px;display:block;">Оцінка візиту</label>' +
        '<div id="dStarsWrap" style="display:flex;gap:4px;margin-top:4px;"></div>' +
        '<div id="dReviewCommentWrap" style="margin-top:6px;display:none;">' +
        '<textarea id="dReviewComment" placeholder="Коментар (необов\'язково)" rows="2" style="width:100%;font-size:.85rem;"></textarea></div>';
    }

    html += '<div id="dSubInfo"></div>';
    html += '<div class="err" id="dErr"></div><div class="modal-foot">';

    if (a.status === "pending") html += '<button class="btn btn-primary btn-sm" id="dConfirm">Підтвердити</button>';
    if (a.status === "pending" || a.status === "confirmed") {
      html += '<button class="btn btn-ghost btn-sm" id="dComplete">Завершити</button>';
      html += '<button class="btn btn-ghost btn-sm" id="dCancel">Скасувати</button>';
    }
    html += '<button class="btn btn-ghost btn-sm" id="dEdit">✏️ Редагувати</button>';
    html += '<button class="btn btn-ghost" id="dClose">Закрити</button></div>';

    openModal(html);

    $("dMarkerWrap").appendChild(markerPicker(a.color_marker || null, function(c) {
      api("PATCH", "/api/crm/appointments/" + a.id + "/color-marker", { color_marker: c });
      a.color_marker = c;
      var blk = document.getElementById("cal-block-" + a.id);
      if (blk) { blk.style.background = c; }
    }));

    // Абонемент
    if (a.client_id && a.service_id) {
      api("GET", "/api/crm/subscriptions/check?client_id=" + a.client_id + "&service_id=" + a.service_id).then(function(r) {
        var sub = r.j && r.j.active;
        var box = $("dSubInfo"); if (!box) return;
        if (sub) {
          var used = sub.used_sessions, total = sub.total_sessions, rem = total - used;
          box.innerHTML = '<div style="margin-top:10px;background:' + (rem>0?"#e8f5e9":"#fde8e8") + ';border:1px solid ' + (rem>0?"#a5d6a7":"#ef9a9a") + ';border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:.82rem;">' +
            '<span>🎟</span>' +
            '<div><div style="font-weight:600;color:' + (rem>0?"#2e7d32":"#c04040") + ';">Абонемент: сеанс ' + (used) + ' з ' + total + '</div>' +
            '<div style="font-size:.72rem;color:#888;">Залишилось ' + rem + ' сеанс' + (rem===1?'':'ів') + '</div></div></div>';
        }
      });
    }

    // Редагування
    document.getElementById("dEdit").addEventListener("click", function() {
      closeModal();
      apptEditModal(a);
    });

    // Зірки оцінки
    if (a.status === "completed" && $("dStarsWrap")) {
      var currentRating = a.review_rating || 0;
      function renderStars(val) {
        var wrap = $("dStarsWrap"); wrap.innerHTML = "";
        for (var s = 1; s <= 5; s++) {
          (function(star) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = star <= val ? "★" : "☆";
            btn.style.cssText = "background:none;border:none;font-size:1.6rem;cursor:pointer;padding:0 2px;color:" + (star <= val ? "#f5a623" : "#ccc") + ";line-height:1;";
            btn.addEventListener("mouseenter", function() { renderStars(star); });
            btn.addEventListener("mouseleave", function() { renderStars(currentRating); });
            btn.addEventListener("click", function() {
              currentRating = star;
              renderStars(star);
              var commentWrap = $("dReviewCommentWrap");
              if (commentWrap) commentWrap.style.display = "block";
              var comment = $("dReviewComment") ? $("dReviewComment").value.trim() : "";
              api("POST", "/api/crm/reviews", { appointment_id: a.id, rating: star, comment: comment });
              a.review_rating = star;
            });
            wrap.appendChild(btn);
          })(s);
        }
      }
      renderStars(currentRating);
      if (currentRating > 0 && $("dReviewCommentWrap")) {
        $("dReviewCommentWrap").style.display = "block";
        if ($("dReviewComment") && a.review_comment) $("dReviewComment").value = a.review_comment;
      }
      // Зберігати коментар при зміні
      if ($("dReviewComment")) {
        $("dReviewComment").addEventListener("change", function() {
          if (currentRating > 0) {
            api("POST", "/api/crm/reviews", { appointment_id: a.id, rating: currentRating, comment: this.value.trim() });
          }
        });
      }
    }

    function setStatus(status) {
      api("PATCH", "/api/crm/appointments/" + a.id + "/status", { status: status }).then(function(res) {
        if (!res.j.ok) { $("dErr").textContent = "Помилка"; return; }
        // Зберегти оплату
        var paid = $("dPaid") && $("dPaid").checked ? 1 : 0;
        var method = $("dPayMethod") ? $("dPayMethod").value : "";
        if (paid || method) {
          api("PATCH", "/api/crm/appointments/" + a.id + "/payment", { paid: paid, pay_method: method });
        }
        closeModal(); if (window.__reloadAppts) window.__reloadAppts();
      });
    }
    if ($("dConfirm")) $("dConfirm").addEventListener("click", function() { setStatus("confirmed"); });
    if ($("dComplete")) $("dComplete").addEventListener("click", function() { setStatus("completed"); });
    if ($("dNoShow")) $("dNoShow").addEventListener("click", function() { setStatus("no_show"); });
    if ($("dCancel")) $("dCancel").addEventListener("click", function() { setStatus("cancelled"); });
    $("dClose").addEventListener("click", function() {
      // Зберегти оплату без зміни статусу
      var paid = $("dPaid") && $("dPaid").checked ? 1 : 0;
      var method = $("dPayMethod") ? $("dPayMethod").value : "";
      api("PATCH", "/api/crm/appointments/" + a.id + "/payment", { paid: paid, pay_method: method });
      closeModal();
    });
  }

  function apptEditModal(a) {
    var M_UA2 = ["","січ","лют","бер","квіт","трав","черв","лип","серп","вер","жовт","лист","груд"];
    var svcName = (a.service_name||'').replace(/\s*\([^)]*\)\s*/g,'').trim();
    openModal(
      '<h3>Редагування запису</h3>' +
      // Клієнт (тільки відображення)
      '<div style="background:var(--panel-2);border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;align-items:center;gap:10px;">' +
        '<div style="width:36px;height:36px;border-radius:50%;background:var(--olive-light);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;flex-shrink:0;">' +
          (a.client_name||'?').split(' ').map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase() +
        '</div>' +
        '<div><div style="font-weight:600;font-size:.9rem;color:var(--cream);">' + (a.client_name||'') + '</div>' +
        '<div style="font-size:.75rem;color:var(--text-dim);">' + (a.client_phone || '<span style="color:#aaa;">🔒 приховано</span>') + '</div></div>' +
      '</div>' +
      // Майстер
      '<div id="eMasterRow"><label>Майстер</label><select id="eMaster"></select></div>' +
      // Дата
      '<label>Дата</label>' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<input type="date" id="eDate" style="flex:1;" />' +
        '<div id="eDateLabel" style="font-size:.85rem;color:var(--text-dim);white-space:nowrap;"></div>' +
      '</div>' +
      // Час
      '<label style="margin-top:10px;display:block;">Час</label>' +
      '<div id="eSlots" class="muted">Завантаження…</div>' +
      '<div id="eChosenTime" style="display:none;margin-top:4px;padding:6px 10px;background:var(--panel-2);border-radius:8px;font-size:.85rem;font-weight:600;color:var(--cream);"></div>' +
      // Послуга (display only)
      '<label style="margin-top:10px;display:block;">Послуга</label>' +
      '<div style="padding:8px 12px;background:var(--panel-2);border-radius:8px;font-size:.88rem;color:var(--cream);font-weight:500;">' + svcName + ' · ' + (a.duration_min||60) + ' хв</div>' +
      // Коментар
      '<label style="margin-top:10px;display:block;">Коментар</label>' +
      '<textarea id="eComment" maxlength="500" rows="2">' + (a.comment||'') + '</textarea>' +
      '<div class="err" id="eErr"></div>' +
      '<div class="modal-foot">' +
        '<button class="btn btn-ghost" id="eCancel">Скасувати</button>' +
        '<button class="btn btn-primary" id="eSave">Зберегти</button>' +
      '</div>'
    );

    var chosenMin = a.start_min;
    var M_UA3 = ["","січ","лют","бер","квіт","трав","черв","лип","серп","вер","жовт","лист","груд"];
    var DOW_UA3 = ["нд","пн","вт","ср","чт","пт","сб"];

    function updateDateLbl(val) {
      var lbl = $("eDateLabel"); if (!lbl||!val) return;
      var d = new Date(val+"T00:00:00");
      lbl.textContent = d.getDate() + " " + M_UA3[d.getMonth()+1] + " · " + DOW_UA3[d.getDay()];
    }

    $("eCancel").addEventListener("click", closeModal);
    $("eDate").value = a.date; $("eDate").min = todayStr();
    updateDateLbl(a.date);
    $("eDate").addEventListener("change", function() { updateDateLbl(this.value); loadESlots(); });

    // Показати поточний час одразу
    var ct = $("eChosenTime");
    ct.style.display = "block";
    ct.textContent = "⏰ Час: " + fmtMin(a.start_min);

    function loadESlots() {
      var mid = $("eMaster").value, date = $("eDate").value;
      if (!mid || !date || !a.service_id) return;
      var box = $("eSlots"); box.innerHTML = "Завантаження…"; box.className = "";
      api("GET", "/api/public/slots?service=" + a.service_id + "&master=" + mid + "&date=" + date).then(function(r) {
        var slots = r.j.slots || [];
        box.innerHTML = "";
        if (!slots.length) { box.className = "muted"; box.textContent = "Вільних віконець немає"; return; }
        var grid = el("div","slots");
        slots.forEach(function(s) {
          var c = el("div","slot",s.time);
          if (s.start_min === chosenMin) c.classList.add("sel");
          c.addEventListener("click", (function(sl){ return function() {
            grid.querySelectorAll(".slot").forEach(function(x){x.classList.remove("sel");});
            c.classList.add("sel"); chosenMin = sl.start_min;
            var ct2 = $("eChosenTime");
            ct2.style.display="block"; ct2.textContent="⏰ Час: " + sl.time;
          }; })(s));
          grid.appendChild(c);
        });
        box.appendChild(grid);
      });
    }

    api("GET", "/api/crm/masters").then(function(res) {
      var sel = $("eMaster");
      (res.j.masters||[]).forEach(function(m) {
        if (ME.role !== "owner" && m.id !== ME.masterId) return;
        var o = new Option(m.name + (m.last_name?" "+m.last_name:""), m.id);
        sel.appendChild(o);
      });
      sel.value = String(a.master_id);
      if (ME.role !== "owner") $("eMasterRow").style.display = "none";
      sel.addEventListener("change", loadESlots);
      loadESlots();
    });

    $("eSave").addEventListener("click", function() {
      var err = $("eErr"); err.textContent = "";
      api("PATCH", "/api/crm/appointments/" + a.id, {
        master: $("eMaster").value,
        date: $("eDate").value,
        start_min: chosenMin,
        comment: $("eComment").value.trim()
      }).then(function(r) {
        if (r.code === 409) { err.textContent = "Це віконце вже зайняте"; return; }
        if (!r.j.ok) { err.textContent = "Помилка: " + (r.j.error||""); return; }
        closeModal();
        if (window.__reloadAppts) window.__reloadAppts();
      });
    });
  }

  function apptItem(a) {
    var item = el("div", "item");
    var row = el("div", "row1");
    row.appendChild(el("span", "t", fmtMin(a.start_min)));
    var info = el("div");
    info.appendChild(el("div", "t", a.client_name + " · " + a.service_name));
    var subParts = [a.master_name, a.client_phone, a.duration_min + " хв"];
    if (a.price) subParts.push(money(a.price));
    if (a.paid) subParts.push("✅ " + (a.pay_method || "оплачено"));
    info.appendChild(el("div", "sub", subParts.join(" · ")));
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
    // Кнопка оплати (якщо завершено але не оплачено)
    if (a.status === "completed" && !a.paid) {
      var payB = el("button", "btn btn-sm btn-ghost", "💳 Оплата");
      payB.addEventListener("click", function () { paymentModal(a); });
      acts.appendChild(payB);
    }
    item.appendChild(acts);
    return item;
  }

  /* ---- Модалка оплати ---- */
  function paymentModal(a) {
    openModal(
      '<h3>Оплата запису</h3>' +
      '<div class="muted">' + a.client_name + ' · ' + a.service_name + ' · ' + money(a.price) + '</div>' +
      '<label>Спосіб оплати</label>' +
      '<select id="pmMethod"><option value="Готівка">Готівка</option><option value="Картка">Картка</option><option value="Переказ">Переказ</option></select>' +
      '<div class="modal-foot"><button class="btn btn-ghost" id="pmCancel">Скасувати</button><button class="btn btn-primary" id="pmSave">Позначити оплаченим</button></div>'
    );
    $("pmCancel").addEventListener("click", closeModal);
    $("pmSave").addEventListener("click", function () {
      api("PATCH", "/api/crm/appointments/" + a.id + "/payment", { paid: 1, pay_method: $("pmMethod").value })
        .then(function () { closeModal(); if (window.__reloadAppts) window.__reloadAppts(); });
    });
  }

  /* ---- модалка нового запису ---- */
  function apptModal(opts) {
    var prefill = (opts && opts.prefill) || {};
    openModal(
      '<h3>Новий запис</h3>' +

      // 1. КЛІЄНТ
      '<label>Клієнт</label>' +
      '<div id="mClientSearch" style="position:relative;">' +
        '<input type="text" id="mClientQ" placeholder="Пошук за іменем або телефоном…" autocomplete="off">' +
        '<div id="mClientDrop" style="display:none;position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:300;max-height:220px;overflow-y:auto;margin-top:3px;"></div>' +
      '</div>' +
      '<div id="mClientChip" style="display:none;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;align-items:center;gap:10px;">' +
        '<div style="flex:1;min-width:0;">' +
          '<div id="mChipName" style="font-weight:600;font-size:.9rem;color:var(--cream);"></div>' +
          '<div id="mChipPhone" style="font-size:.78rem;color:var(--text-dim);"></div>' +
        '</div>' +
        '<button id="mClientClear" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:1rem;padding:4px;">✕</button>' +
      '</div>' +
      '<div id="mClientNew" style="display:none;">' +
        '<div class="grid2"><div><label>Ім\'я</label><input type="text" id="mName" placeholder="Олена" maxlength="60"/></div>' +
        '<div><label>Прізвище</label><input type="text" id="mSurname" placeholder="Коваленко" maxlength="60"/></div></div>' +
        '<label style="margin-top:8px;display:block;">Телефон</label><input type="tel" id="mPhone" maxlength="30"/>' +
      '</div>' +

      // 2. ПОСЛУГА
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;margin-bottom:4px;">' +
        '<label style="margin:0;">Послуга</label>' +
        '<span id="mTotalInfo" style="font-size:.78rem;color:var(--text-dim);"></span>' +
      '</div>' +
      // Список обраних послуг
      '<div id="mSvcList"></div>' +
      // Пошук послуги
      '<div id="mSvcWrap" style="position:relative;margin-top:4px;">' +
        '<input type="text" id="mSvcQ" placeholder="Пошук послуги…" autocomplete="off">' +
        '<div id="mSvcDrop" style="display:none;position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:300;max-height:200px;overflow-y:auto;margin-top:3px;"></div>' +
      '</div>' +
      // Кнопка додати ще (з'являється після вибору 1-ї послуги)
      '<div id="mAddSvcWrap" style="display:none;margin-top:4px;">' +
        '<button type="button" id="mAddSvcBtn" style="width:100%;padding:8px;border-radius:8px;border:1.5px dashed var(--line);background:transparent;color:var(--text-dim);font-size:.85rem;cursor:pointer;">+ Додати послугу</button>' +
        '<div id="mAddSvcSearch" style="display:none;position:relative;margin-top:4px;">' +
          '<input type="text" id="mAddSvcQ" placeholder="Пошук…" autocomplete="off">' +
          '<div id="mAddSvcDrop" style="display:none;position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:300;max-height:180px;overflow-y:auto;margin-top:3px;"></div>' +
        '</div>' +
      '</div>' +
      '<select id="mService" style="display:none;"></select>' +

      // Секція абонементу (з'являється після вибору послуги)
      '<div id="mSubSection" style="display:none;margin-top:8px;">' +
        '<div id="mSubBadge"></div>' +
        '<div id="mSubCreateWrap" style="display:none;">' +
          '<button type="button" id="mSubToggleBtn" style="width:100%;padding:9px 14px;border-radius:10px;border:1.5px dashed #6e9145;background:transparent;color:#5a7a48;font-size:.85rem;font-weight:600;cursor:pointer;text-align:left;margin-top:6px;">🎟 Оформити абонемент</button>' +
          '<div id="mSubForm" style="display:none;background:#f0f7ee;border:1px solid #b8d4a8;border-radius:10px;padding:12px;margin-top:6px;">' +
            '<div style="font-size:.8rem;font-weight:600;color:#3d5430;margin-bottom:8px;">К-ть сеансів</div>' +
            '<div id="mSubPresets" style="display:flex;gap:6px;margin-bottom:10px;">' +
              '<button type="button" class="sub-preset" data-n="5" style="flex:1;padding:8px 0;border-radius:8px;border:1.5px solid #6e9145;background:#fff;color:#3d5430;font-weight:700;cursor:pointer;">5</button>' +
              '<button type="button" class="sub-preset" data-n="10" style="flex:1;padding:8px 0;border-radius:8px;border:1.5px solid #6e9145;background:#fff;color:#3d5430;font-weight:700;cursor:pointer;">10</button>' +
              '<button type="button" class="sub-preset" data-n="15" style="flex:1;padding:8px 0;border-radius:8px;border:1.5px solid #6e9145;background:#fff;color:#3d5430;font-weight:700;cursor:pointer;">15</button>' +
            '</div>' +
            '<label>Сума оплати (грн)</label>' +
            '<input type="number" id="mSubPrice" value="0" min="0" style="margin-bottom:6px;">' +
            '<div style="font-size:.73rem;color:#5a7a48;">✓ Перше відвідування зараховується одразу</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // 3. МАЙСТЕР + ДАТА + ЧАС
      '<div id="mMasterRow"><label style="margin-top:14px;display:block;">Майстер</label><select id="mMaster"></select></div>' +
      '<label>Дата</label>' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<input type="date" id="mDate" style="flex:1;" />' +
        '<div id="mDateLabel" style="font-size:.85rem;color:var(--text-dim);white-space:nowrap;"></div>' +
      '</div>' +
      '<div id="mChosenTime" style="display:none;margin-top:4px;padding:6px 10px;background:var(--panel-2);border-radius:8px;font-size:.85rem;font-weight:600;color:var(--cream);"></div>' +
      '<label style="margin-top:10px;display:block;">Вільний час</label><div id="mSlots" class="muted">Оберіть послугу, майстра й дату</div>' +

      '<label style="margin-top:10px;display:block;">Коментар</label><textarea id="mComment" maxlength="500"></textarea>' +
      '<label>Колір маркеру</label><div id="mMarkerWrap"></div>' +
      '<div class="err" id="mErr"></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" id="mCancel">Скасувати</button>' +
      '<button class="btn btn-primary" id="mSave">Створити</button></div>'
    );

    var chosen = { start_min: null, color_marker: null, subSessions: 0 };
    var selectedClient = null;
    var allServices = [];
    var selectedServices = []; // [{id, name, duration_min, price}, ...]

    function renderSvcList() {
      var listEl = $("mSvcList"); if (!listEl) return;
      listEl.innerHTML = "";
      var totalDur = 0, totalPrice = 0;
      selectedServices.forEach(function(s, i) {
        totalDur += s.duration_min; totalPrice += s.price;
        var row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin-bottom:4px;";
        var nameSpan = document.createElement("span");
        nameSpan.style.cssText = "flex:1;font-size:.88rem;font-weight:600;color:var(--cream);";
        nameSpan.textContent = s.name + " · " + s.duration_min + " хв";
        var priceSpan = document.createElement("span");
        priceSpan.style.cssText = "font-size:.85rem;color:var(--text-dim);white-space:nowrap;";
        priceSpan.textContent = money(s.price);
        var delBtn = document.createElement("button");
        delBtn.style.cssText = "background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:.9rem;padding:2px 4px;";
        delBtn.textContent = "✕";
        (function(idx) {
          delBtn.addEventListener("click", function() {
            selectedServices.splice(idx, 1);
            if (idx === 0) { $("mService").value = ""; refreshSubSection(); }
            renderSvcList();
            loadSlots();
          });
        })(i);
        row.appendChild(nameSpan); row.appendChild(priceSpan); row.appendChild(delBtn);
        listEl.appendChild(row);
      });
      var infoEl = $("mTotalInfo"); if (infoEl) {
        infoEl.textContent = selectedServices.length > 1
          ? totalDur + " хв · " + money(totalPrice)
          : "";
      }
      var addWrap = $("mAddSvcWrap");
      if (addWrap) addWrap.style.display = selectedServices.length > 0 ? "block" : "none";
    }

    $("mCancel").addEventListener("click", closeModal);
    $("mMarkerWrap").appendChild(markerPicker(null, function(c) { chosen.color_marker = c; }));

    var M_UA = ["січня","лютого","березня","квітня","травня","червня","липня","серпня","вересня","жовтня","листопада","грудня"];
    var DOW_UA_G = ["нд","пн","вт","ср","чт","пт","сб"];
    function updateDateLabel(val) {
      var lbl = $("mDateLabel"); if (!lbl || !val) return;
      var d = new Date(val + "T00:00:00");
      lbl.textContent = d.getDate() + " " + M_UA[d.getMonth()] + " · " + DOW_UA_G[d.getDay()];
    }
    $("mDate").value = prefill.date || apptDate; $("mDate").min = todayStr();
    updateDateLabel($("mDate").value);
    $("mDate").addEventListener("change", function() { updateDateLabel(this.value); });

    // ── Абонемент — преsети ──────────────────────────────────────────
    function selectSubPreset(n) {
      chosen.subSessions = n;
      document.querySelectorAll(".sub-preset").forEach(function(b) {
        var active = parseInt(b.dataset.n, 10) === n;
        b.style.background = active ? "#6e9145" : "#fff";
        b.style.color      = active ? "#fff"    : "#3d5430";
      });
    }
    document.querySelectorAll(".sub-preset").forEach(function(b) {
      b.addEventListener("click", function() { selectSubPreset(parseInt(b.dataset.n, 10)); });
    });
    selectSubPreset(10);

    $("mSubToggleBtn") && $("mSubToggleBtn").addEventListener("click", function() {
      var form = $("mSubForm");
      if (!form) return;
      var open = form.style.display !== "none";
      form.style.display = open ? "none" : "block";
      this.style.background = open ? "transparent" : "#e8f5e0";
      this.style.borderStyle = open ? "dashed" : "solid";
    });

    // ── Оновлення секції абонементу ──────────────────────────────────
    function refreshSubSection() {
      var section = $("mSubSection");
      var badge   = $("mSubBadge");
      var createW = $("mSubCreateWrap");
      if (!section || !badge || !createW) return;
      badge.innerHTML = ""; createW.style.display = "none";
      var svcId = $("mService").value;
      if (!svcId) { section.style.display = "none"; return; }
      section.style.display = "block";
      // Для нового клієнта — одразу показуємо кнопку абонементу
      if (!selectedClient || !selectedClient.id) {
        createW.style.display = "block"; return;
      }
      api("GET", "/api/crm/subscriptions/check?client_id=" + selectedClient.id + "&service_id=" + svcId).then(function(r) {
        var sub = r.j.active;
        if (sub) {
          var rem = sub.total_sessions - sub.used_sessions;
          badge.innerHTML =
            '<div style="background:' + (rem > 0 ? "#e8f5e9" : "#fde8e8") + ';border:1px solid ' + (rem > 0 ? "#a5d6a7" : "#ef9a9a") + ';' +
            'border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:.82rem;margin-bottom:4px;">' +
            '<span>🎟</span>' +
            '<span style="color:' + (rem > 0 ? "#2e7d32" : "#c04040") + ';font-weight:600;">' +
              (rem > 0 ? 'Абонемент: ' + rem + ' сеанс' + (rem===1?'':'ів') + ' залишилось' : 'Абонемент вичерпано') +
            '</span>' +
            '<span style="color:var(--text-dim);font-size:.75rem;">(' + sub.used_sessions + '/' + sub.total_sessions + ')</span>' +
            '</div>';
          // Якщо вичерпано — дати змогу оформити новий
          if (rem <= 0) createW.style.display = "block";
        } else {
          createW.style.display = "block";
        }
      });
    }

    // ── Пошук послуги ────────────────────────────────────────────────
    function selectService(s) {
      // Перша послуга — стає primary
      if (selectedServices.length === 0) {
        $("mService").value = s.id;
        $("mSvcWrap").style.display = "none";
        refreshSubSection();
      }
      selectedServices.push({ id: s.id, name: s.name, duration_min: s.duration_min, price: s.price });
      $("mSvcQ").value = "";
      renderSvcList();
      if ($("mMaster").options.length > 0) { loadSlots(); } else { loadMasters(); }
    }

    function buildSvcDropRows(drop, filtered, onPick) {
      drop.innerHTML = "";
      filtered.forEach(function(s) {
        var row = document.createElement("div");
        row.style.cssText = "padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--line);font-size:.88rem;color:var(--cream);";
        row.innerHTML = '<span style="font-weight:600;">' + s.name + '</span>' +
          '<span style="color:var(--text-dim);font-size:.78rem;margin-left:8px;">' + s.duration_min + ' хв · ' + money(s.price) + '</span>';
        row.addEventListener("mousedown", function(e) { e.preventDefault(); onPick(s); drop.style.display = "none"; });
        drop.appendChild(row);
      });
      drop.style.display = filtered.length ? "block" : "none";
    }

    function renderSvcDrop(q) {
      var drop = $("mSvcDrop");
      var filtered = allServices.filter(function(s) { return !q || s.name.toLowerCase().indexOf(q.toLowerCase()) > -1; });
      buildSvcDropRows(drop, filtered, function(s) { selectService(s); });
    }

    $("mSvcQ").addEventListener("input", function() { renderSvcDrop(this.value.trim()); });
    $("mSvcQ").addEventListener("focus", function() { renderSvcDrop(this.value.trim()); });
    $("mSvcQ").addEventListener("blur", function() {
      setTimeout(function() { var d = $("mSvcDrop"); if (d) d.style.display = "none"; }, 150);
    });

    // ── Додати ще одну послугу ──────────────────────────────────────
    $("mAddSvcBtn") && $("mAddSvcBtn").addEventListener("click", function() {
      var srch = $("mAddSvcSearch");
      if (!srch) return;
      var open = srch.style.display !== "none";
      srch.style.display = open ? "none" : "block";
      if (!open) { $("mAddSvcQ").value = ""; $("mAddSvcQ").focus(); }
    });
    $("mAddSvcQ") && $("mAddSvcQ").addEventListener("input", function() {
      var q = this.value.trim();
      var drop = $("mAddSvcDrop");
      var filtered = allServices.filter(function(s) { return !q || s.name.toLowerCase().indexOf(q.toLowerCase()) > -1; });
      buildSvcDropRows(drop, filtered, function(s) {
        selectedServices.push({ id: s.id, name: s.name, duration_min: s.duration_min, price: s.price });
        $("mAddSvcQ").value = ""; $("mAddSvcSearch").style.display = "none";
        renderSvcList(); loadSlots();
      });
    });
    $("mAddSvcQ") && $("mAddSvcQ").addEventListener("focus", function() {
      var drop = $("mAddSvcDrop");
      buildSvcDropRows(drop, allServices, function(s) {
        selectedServices.push({ id: s.id, name: s.name, duration_min: s.duration_min, price: s.price });
        $("mAddSvcQ").value = ""; $("mAddSvcSearch").style.display = "none";
        renderSvcList(); loadSlots();
      });
    });
    $("mAddSvcQ") && $("mAddSvcQ").addEventListener("blur", function() {
      setTimeout(function() { var d = $("mAddSvcDrop"); if (d) d.style.display = "none"; }, 150);
    });

    // ── Пошук клієнта ────────────────────────────────────────────────
    function showChip(c) {
      selectedClient = c;
      $("mClientSearch").style.display = "none";
      $("mClientNew").style.display = "none";
      var chip = $("mClientChip");
      chip.style.display = "flex";
      $("mChipName").textContent = c.name;
      $("mChipPhone").textContent = c.phone || (ME.can_see_phones ? "" : "🔒 приховано");
      refreshSubSection();
    }

    function showNewForm(nameVal) {
      selectedClient = null;
      $("mClientSearch").style.display = "none";
      $("mClientChip").style.display = "none";
      $("mClientNew").style.display = "block";
      if (nameVal) {
        var parts = nameVal.trim().split(" ");
        $("mName").value = parts[0] || "";
        $("mSurname").value = parts.slice(1).join(" ") || "";
      }
      refreshSubSection();
      setTimeout(function() { $("mName").focus(); }, 50);
    }

    function resetToSearch() {
      selectedClient = null;
      $("mClientChip").style.display = "none";
      $("mClientNew").style.display = "none";
      $("mClientSearch").style.display = "block";
      $("mClientQ").value = "";
      $("mClientQ").focus();
      refreshSubSection();
    }

    $("mClientClear").addEventListener("click", resetToSearch);

    var searchTimer = null;
    $("mClientQ").addEventListener("input", function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      var drop = $("mClientDrop");
      if (!q) { drop.style.display = "none"; return; }
      searchTimer = setTimeout(function() {
        api("GET", "/api/crm/clients?q=" + encodeURIComponent(q)).then(function(res) {
          var list = (res.j.clients || []).slice(0, 8);
          drop.innerHTML = "";
          list.forEach(function(c) {
            var row = document.createElement("div");
            row.style.cssText = "padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;";
            var initials = (c.name||"").split(" ").map(function(w){return w[0]||"";}).join("").slice(0,2).toUpperCase();
            row.innerHTML =
              '<div style="width:32px;height:32px;border-radius:50%;background:var(--olive-light);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;flex-shrink:0;">' + (initials||"?") + '</div>' +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:.88rem;font-weight:600;color:var(--cream);">' + c.name + '</div>' +
                '<div style="font-size:.75rem;color:var(--text-dim);">' + (c.phone ? c.phone : (ME.can_see_phones ? "" : '<span style="color:#aaa;">🔒 приховано</span>')) + ' · візитів: ' + (c.visit_count||0) + '</div>' +
              '</div>';
            row.addEventListener("mousedown", function(e) { e.preventDefault(); showChip(c); drop.style.display = "none"; });
            drop.appendChild(row);
          });
          var newRow = document.createElement("div");
          newRow.style.cssText = "padding:10px 14px;cursor:pointer;color:var(--olive-light);font-size:.88rem;font-weight:600;display:flex;align-items:center;gap:8px;";
          newRow.innerHTML = '<span style="font-size:1.1rem;">＋</span> Новий клієнт «' + q + '»';
          newRow.addEventListener("mousedown", function(e) { e.preventDefault(); drop.style.display = "none"; showNewForm(q); });
          drop.appendChild(newRow);
          drop.style.display = list.length || q ? "block" : "none";
        });
      }, 220);
    });

    $("mClientQ").addEventListener("blur", function() {
      setTimeout(function() { var d = $("mClientDrop"); if (d) d.style.display = "none"; }, 150);
    });
    $("mClientQ").addEventListener("keydown", function(e) {
      if (e.key === "Escape") { $("mClientDrop").style.display = "none"; }
    });

    if (prefill.clientName || prefill.clientPhone) {
      showNewForm(prefill.clientName || "");
      if (prefill.clientPhone) $("mPhone").value = prefill.clientPhone;
    }

    // ── Послуги і майстри ────────────────────────────────────────────
    api("GET", "/api/crm/services").then(function (res) {
      var sel = $("mService");
      allServices = (res.j.services || []);
      allServices.forEach(function (s) {
        var o = new Option(s.name + " (" + s.duration_min + " хв)", s.id);
        o.dataset.dur = s.duration_min; sel.appendChild(o);
      });
      if (prefill.serviceId) {
        var found = allServices.find(function(s) { return String(s.id) === String(prefill.serviceId); });
        if (found) { selectService(found); }
      }
      loadMasters();
    });

    function loadMasters() {
      api("GET", "/api/crm/masters").then(function (res) {
        var sel = $("mMaster");
        (res.j.masters || []).forEach(function (m) {
          if (ME.role !== "owner" && m.id !== ME.masterId) return;
          sel.appendChild(new Option(m.name, m.id));
        });
        if (ME.role !== "owner") {
          // Worker: force own masterId, hide the selector
          sel.value = String(ME.masterId);
          var row = $("mMasterRow"); if (row) row.style.display = "none";
        } else if (prefill.masterId) {
          sel.value = String(prefill.masterId);
        }
        loadSlots();
      });
    }

    $("mService").addEventListener("change", function() { loadSlots(); refreshSubSection(); });
    $("mMaster").addEventListener("change", loadSlots);
    $("mDate").addEventListener("change", loadSlots);

    function loadSlots() {
      chosen.start_min = null;
      var sid = $("mService").value, mid = $("mMaster").value, date = $("mDate").value;
      if (!sid || !mid || !date) return;
      var wantStartMin = prefill.startMin;
      prefill.startMin = null;
      var box = $("mSlots"); box.className = ""; box.innerHTML = "Завантаження…";
      // Підрахуємо загальну тривалість усіх послуг для коректних слотів
      var totalDur = selectedServices.reduce(function(s, x) { return s + x.duration_min; }, 0);
      var slotsUrl = "/api/public/slots?service=" + sid + "&master=" + mid + "&date=" + date;
      if (totalDur > 0) slotsUrl += "&duration=" + totalDur;
      api("GET", slotsUrl).then(function (res) {
        var slots = res.j.slots || [];
        box.innerHTML = "";
        if (!slots.length) { box.className = "muted"; box.textContent = "Вільних віконець немає"; return; }
        var grid = el("div", "slots");
        slots.forEach(function (s) {
          var c = el("div", "slot", s.time);
          c.addEventListener("click", (function(slot) { return function () {
            grid.querySelectorAll(".slot").forEach(function (x) { x.classList.remove("sel"); });
            c.classList.add("sel"); chosen.start_min = slot.start_min;
            var ct = $("mChosenTime");
            if (ct) { ct.style.display = "block"; ct.textContent = "⏰ Час: " + slot.time; }
          }; })(s));
          grid.appendChild(c);
          if (wantStartMin != null && s.start_min === wantStartMin) c.click();
        });
        box.appendChild(grid);
      });
    }

    $("mSave").addEventListener("click", function () {
      var err = $("mErr"); err.textContent = "";
      if (chosen.start_min == null) { err.textContent = "Оберіть час"; return; }
      var name, phone;
      if (selectedClient) {
        name = selectedClient.name; phone = selectedClient.phone;
      } else {
        var firstName = ($("mName") ? $("mName").value.trim() : "");
        var lastName  = ($("mSurname") ? $("mSurname").value.trim() : "");
        phone = ($("mPhone") ? $("mPhone").value.trim() : "");
        if (!firstName || phone.replace(/\D/g, "").length < 9) { err.textContent = "Вкажіть ім'я і телефон"; return; }
        name = lastName ? firstName + " " + lastName : firstName;
      }
      if (!name) { err.textContent = "Оберіть або введіть клієнта"; return; }
      var url = ME.role === "owner" ? "/api/crm/appointments" : "/api/crm/me/appointments";
      var extras = selectedServices.slice(1);
      api("POST", url, {
        service: $("mService").value, master: $("mMaster").value, date: $("mDate").value,
        start_min: chosen.start_min, name: name, phone: phone,
        comment: $("mComment").value.trim(), color_marker: chosen.color_marker || null,
        extra_services: extras.length ? JSON.stringify(extras) : null
      }).then(function (res) {
        if (res.code === 409) { err.textContent = "Це віконце вже зайняте"; return; }
        if (!res.j.ok) { err.textContent = "Помилка: " + (res.j.error || ""); return; }

        var clientId = res.j.appointment && res.j.appointment.client_id;
        var subForm = $("mSubForm");
        var subOpen = subForm && subForm.style.display !== "none";

        function done() { closeModal(); if (window.__reloadAppts) window.__reloadAppts(); }

        if (subOpen && clientId && chosen.subSessions > 0) {
          var price = Math.round(parseFloat($("mSubPrice") ? $("mSubPrice").value : 0) * 100);
          api("POST", "/api/crm/subscriptions", {
            client_id: clientId,
            service_id: $("mService").value,
            total_sessions: chosen.subSessions,
            used_sessions: 1,
            price: price,
            note: null
          }).then(done);
        } else {
          done();
        }
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
     РОЗКЛАД (день) — відкриває денний вид одразу
     ============================================================ */
  // ── Тижневий графік роботи (Bookon-style) ─────────────────────
  function renderScheduleTab() {
    var main = $("main"); main.innerHTML = "";
    var bar = el("div", "bar");
    bar.appendChild(el("h2", null, "Графік роботи"));
    main.appendChild(bar);

    var DOW_SHORT = ["Нд","Пн","Вт","Ср","Чт","Пт","Сб"];
    var MON_UA = ["Січень","Лютий","Березень","Квітень","Травень","Червень","Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"];
    var now = new Date();
    var viewYear = now.getFullYear();
    var viewMonth = now.getMonth();
    var wrap = el("div"); wrap.id = "schedWeekWrap"; main.appendChild(wrap);

    function renderMonth() {
      wrap.innerHTML = "";
      var nav = document.createElement("div");
      nav.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:4px 12px 8px;";
      var prevM = el("button","btn btn-ghost btn-sm","‹"); prevM.style.cssText = "font-size:1.4rem;padding:2px 10px;";
      var nextM = el("button","btn btn-ghost btn-sm","›"); nextM.style.cssText = "font-size:1.4rem;padding:2px 10px;";
      var mLbl = document.createElement("div");
      mLbl.style.cssText = "font-size:.88rem;font-weight:600;color:var(--cream);";
      mLbl.textContent = MON_UA[viewMonth] + " " + viewYear;
      prevM.addEventListener("click", function() { viewMonth--; if (viewMonth < 0) { viewMonth=11; viewYear--; } renderMonth(); });
      nextM.addEventListener("click", function() { viewMonth++; if (viewMonth > 11) { viewMonth=0; viewYear++; } renderMonth(); });
      nav.appendChild(prevM); nav.appendChild(mLbl); nav.appendChild(nextM);
      wrap.appendChild(nav);

      var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      var days = [];
      for (var i = 1; i <= daysInMonth; i++) {
        var d = new Date(viewYear, viewMonth, i);
        days.push({ date: d, dateStr: viewYear + "-" + String(viewMonth+1).padStart(2,"0") + "-" + String(i).padStart(2,"0"), jsDay: d.getDay() });
      }

      var tableWrap = document.createElement("div");
      tableWrap.style.cssText = "overflow-x:auto;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;";
      var table = document.createElement("table");
      table.style.cssText = "border-collapse:collapse;font-size:.78rem;";

      // Заголовок
      var thead = document.createElement("thead");
      var hrow = document.createElement("tr");
      var thEmpty = document.createElement("th");
      thEmpty.style.cssText = "width:68px;min-width:68px;padding:6px 4px;background:#f8f8f6;position:sticky;left:0;z-index:2;border-bottom:2px solid #d8ddd4;";
      hrow.appendChild(thEmpty);
      var today3 = todayStr();
      days.forEach(function(day) {
        var isToday = day.dateStr === today3;
        var isWeekend = day.jsDay === 0 || day.jsDay === 6;
        var th = document.createElement("th");
        th.style.cssText = "padding:6px 4px;text-align:center;border-bottom:2px solid #d8ddd4;min-width:50px;" + (isToday ? "background:#e8f5e0;" : "background:#f8f8f6;");
        th.innerHTML = '<div style="font-weight:700;font-size:.7rem;color:' + (isToday ? "#3d5430" : isWeekend ? "#b03020" : "#555") + ';">' + DOW_SHORT[day.jsDay] + '</div>' +
          '<div style="font-size:.72rem;color:' + (isToday ? "#5a7a48" : "#999") + ';">' + day.date.getDate() + '</div>';
        hrow.appendChild(th);
      });
      thead.appendChild(hrow); table.appendChild(thead);

      var tbody = document.createElement("tbody");

      function sectionRow(label, colspan) {
        var tr = document.createElement("tr");
        var td = document.createElement("td");
        td.colSpan = colspan;
        td.style.cssText = "background:#f0f2ed;padding:5px 8px;font-size:.7rem;font-weight:700;color:#6a7a60;letter-spacing:.06em;position:sticky;left:0;";
        td.textContent = label;
        tr.appendChild(td); return tr;
      }

      function schedCellHtml(s) {
        if (!s) return '<div style="background:#f4f5f2;border-radius:8px;min-height:38px;"></div>';
        return '<div style="background:#e8f5e0;border-radius:8px;padding:4px 2px;">' +
          '<div style="font-weight:600;color:#3d5430;font-size:.7rem;">' + fmtMin(s.work_start) + '</div>' +
          '<div style="color:#5a7a48;font-size:.7rem;">' + fmtMin(s.work_end) + '</div></div>';
      }

      // Завантажуємо філії + майстрів + overrides
      var fromDate = days[0].dateStr;
      var toDate   = days[days.length - 1].dateStr;
      Promise.all([
        api("GET", "/api/crm/branches"),
        api("GET", "/api/crm/masters"),
        api("GET", "/api/crm/masters-overrides?from=" + fromDate + "&to=" + toDate)
      ]).then(function(results) {
        var branches  = results[0].j.branches  || [];
        var masters   = results[1].j.masters   || [];
        var rawOvs    = results[2].j.overrides || [];
        // overrideMap[masterId][date] = { is_off, work_start, work_end }
        var overrideMap = {};
        rawOvs.forEach(function(ov) {
          if (!overrideMap[ov.master_id]) overrideMap[ov.master_id] = {};
          overrideMap[ov.master_id][ov.date] = ov;
        });

        return Promise.all(masters.map(function(m) {
          return api("GET", "/api/crm/masters/" + m.id + "/schedule").then(function(r) {
            return { master: m, sched: r.j.schedule || [] };
          });
        })).then(function(masterRows) {
          var masterSchedMap = {};
          masterRows.forEach(function(row) {
            var sm = {};
            row.sched.forEach(function(s) { sm[s.weekday] = s; });
            masterSchedMap[row.master.id] = sm;
          });

          var totalCols = days.length + 1;

          // ── Секція ФІЛІЇ (якщо є)
          if (branches.length > 0) {
            tbody.appendChild(sectionRow("ФІЛІЯ", totalCols));
            branches.forEach(function(branch) {
              var bSchedMap = {};
              (branch.schedule || []).forEach(function(s) { bSchedMap[s.weekday] = s; });

              var tr = document.createElement("tr");
              tr.style.cssText = "border-bottom:1px solid #e8ece4;";
              var tdAv = document.createElement("td");
              tdAv.style.cssText = "padding:6px 4px;text-align:center;position:sticky;left:0;background:#fff;z-index:1;min-width:68px;cursor:pointer;";
              tdAv.innerHTML = (branch.photo
                ? '<img src="' + branch.photo + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:1.5px solid #8aA462;" alt="">'
                : '<div style="width:32px;height:32px;border-radius:50%;background:#5a7a48;color:#fff;display:flex;align-items:center;justify-content:center;font-size:.8rem;margin:0 auto;">🏢</div>') +
                '<div style="font-size:.58rem;color:#1a2016;font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;max-width:66px;text-overflow:ellipsis;">' + (branch.name||'') + '</div>';
              if (ME.role === "owner") {
                tdAv.addEventListener("click", (function(b2) { return function() {
                  var gi = TABS.findIndex(function(t){return t.id==="grafik";});
                  branchEditPage(b2, "grafik");
                }; })(branch));
              }
              tr.appendChild(tdAv);
              days.forEach(function(day) {
                var td = document.createElement("td");
                td.style.cssText = "padding:3px;text-align:center;" + (ME.role === "owner" ? "cursor:pointer;" : "");
                td.innerHTML = schedCellHtml(bSchedMap[day.jsDay]);
                if (ME.role === "owner") {
                  td.addEventListener("click", (function(b2) { return function() {
                    branchEditPage(b2, "grafik");
                  }; })(branch));
                }
                tr.appendChild(td);
              });
              tbody.appendChild(tr);
            });
          }

          // ── Секція ФАХІВЦІ
          tbody.appendChild(sectionRow("ФАХІВЦІ", totalCols));
          masterRows.forEach(function(row) {
            var m = row.master;
            var schedMap = masterSchedMap[m.id] || {};
            var tr = document.createElement("tr");
            tr.style.cssText = "border-bottom:1px solid #e8ece4;";
            var tdAv = document.createElement("td");
            tdAv.style.cssText = "padding:6px 4px;text-align:center;position:sticky;left:0;background:#fff;z-index:1;min-width:68px;cursor:pointer;";
            var initials = (m.name||'?')[0].toUpperCase() + (m.last_name ? m.last_name[0].toUpperCase() : '');
            tdAv.innerHTML = (m.photo
              ? '<img src="' + m.photo + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:1.5px solid #8aA462;" alt="">'
              : '<div style="width:32px;height:32px;border-radius:50%;background:#3d5430;color:#8aA462;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;margin:0 auto;">' + initials + '</div>') +
              '<div style="font-size:.62rem;color:#1a2016;font-weight:600;margin-top:2px;white-space:nowrap;">' + (m.name||'') + '</div>';
            tdAv.addEventListener("click", (function(master) { return function() {
              scheduleEditPage(master, todayStr(), "grafik");
            }; })(m));
            tr.appendChild(tdAv);
            days.forEach(function(day) {
              var ov = (overrideMap[m.id] || {})[day.dateStr];
              var s;
              if (ov) {
                s = ov.is_off ? null : { work_start: ov.work_start, work_end: ov.work_end };
              } else {
                s = schedMap[day.jsDay] || null;
              }
              var td = document.createElement("td");
              td.style.cssText = "padding:3px;text-align:center;cursor:pointer;";
              td.innerHTML = schedCellHtml(s);
              td.addEventListener("click", (function(master2, ds2) { return function() {
                scheduleEditPage(master2, ds2, "grafik", "day");
              }; })(m, day.dateStr));
              tr.appendChild(td);
            });
            tbody.appendChild(tr);
          });

          table.appendChild(tbody);
          tableWrap.appendChild(table);
          wrap.appendChild(tableWrap);
          setTimeout(function() {
            var todayIdx = -1;
            for (var i2 = 0; i2 < days.length; i2++) { if (days[i2].dateStr === today3) { todayIdx = i2; break; } }
            if (todayIdx > 0) tableWrap.scrollLeft = Math.max(0, todayIdx * 50 - 68);
          }, 60);
        });
      });
    }

    renderMonth();
  }

  /* ============================================================
     ФІЛІЇ — список + редагування
     ============================================================ */
  function renderBranchesTab() {
    var main = $("main"); main.innerHTML = "";
    var bar = el("div", "bar");
    bar.appendChild(el("h2", null, "Філії"));
    if (ME.role === "owner") {
      var addBtn = el("button", "btn btn-sm btn-primary", "+ Філія");
      addBtn.addEventListener("click", function() {
        branchEditPage(null, "filiyi");
      });
      bar.appendChild(addBtn);
    }
    main.appendChild(bar);

    var listEl = el("div", "list"); main.appendChild(listEl);

    function load() {
      listEl.innerHTML = '<div class="empty">Завантаження…</div>';
      api("GET", "/api/crm/branches").then(function(res) {
        var branches = res.j.branches || [];
        listEl.innerHTML = "";
        if (!branches.length) { listEl.innerHTML = '<div class="empty">Філій ще немає. Натисніть + Філія</div>'; return; }
        branches.forEach(function(b) {
          var item = el("div", "item");
          var row = el("div", "row1");
          var ava = document.createElement("div");
          ava.style.cssText = "width:42px;height:42px;border-radius:50%;background:#5a7a48;color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;overflow:hidden;";
          ava.innerHTML = b.photo ? '<img src="' + b.photo + '" style="width:100%;height:100%;object-fit:cover;">' : '🏢';
          var info = el("div");
          info.style.cssText = "flex:1;min-width:0;";
          info.appendChild(el("div", "t", b.name));
          info.appendChild(el("div", "sub", (b.masters||[]).length + " майстрів · " + (b.schedule||[]).length + " днів у розкладі"));
          row.appendChild(ava); row.appendChild(info);
          if (ME.role === "owner") {
            var editBtn = el("button", "btn btn-sm btn-ghost", "Редагувати");
            editBtn.addEventListener("click", function() {
              branchEditPage(b, "filiyi");
            });
            row.appendChild(editBtn);
          }
          item.appendChild(row); listEl.appendChild(item);
        });
      });
    }
    load();
  }

  function branchEditPage(branch, backTabId) {
    var isNew = !branch;
    var main2 = $("main"); main2.innerHTML = "";
    var _topbarH = (document.querySelector(".topbar") || {offsetHeight:0}).offsetHeight || 0;
    main2.style.cssText = "padding:0;";

    function toMin(v) { if (!v) return null; var p = v.split(":"); return parseInt(p[0],10)*60+parseInt(p[1],10); }

    function goBack() {
      var os = document.getElementById("branchSaveBtn"); if (os) os.remove();
      var oh = document.getElementById("branchEditHdr"); if (oh) oh.remove();
      main2.style.cssText = "";
      main2.innerHTML = "";
      var destId = backTabId || "filiyi";
      var gi = TABS.findIndex(function(t){ return t.id === destId; });
      if (gi < 0) gi = 0;
      var mBtns = document.getElementById("mob-nav").querySelectorAll(".mob-tab");
      if (mBtns[gi]) {
        mBtns[gi].click();
      } else {
        activateTab(gi);
      }
    }

    var hdr = document.createElement("div");
    hdr.id = "branchEditHdr";
    hdr.style.cssText = "position:fixed;top:" + _topbarH + "px;left:0;right:0;display:flex;align-items:center;padding:10px 12px;background:#f0f2ed;border-bottom:1px solid #d8ddd4;gap:8px;z-index:25;";
    var backBtn = document.createElement("button");
    backBtn.innerHTML = "&#8249;";
    backBtn.style.cssText = "background:none;border:none;font-size:1.8rem;line-height:1;color:#1a2016;padding:8px 12px 8px 4px;cursor:pointer;flex-shrink:0;min-width:44px;min-height:44px;display:flex;align-items:center;";
    var hdrTitle = document.createElement("div");
    hdrTitle.textContent = isNew ? "Нова філія" : "Редагувати філію";
    hdrTitle.style.cssText = "flex:1;font-size:.95rem;font-weight:600;color:#1a2016;text-align:center;";

    backBtn.onclick = goBack;
    hdr.appendChild(backBtn); hdr.appendChild(hdrTitle);
    document.body.appendChild(hdr);

    var content = document.createElement("div");
    content.style.cssText = "padding:64px 16px 120px;";
    main2.appendChild(content);

    var navEl2 = document.getElementById("mob-nav");
    var navH2 = navEl2 ? navEl2.offsetHeight : 56;

    // ── Назва
    var nameLbl = document.createElement("div"); nameLbl.textContent = "Назва філії";
    nameLbl.style.cssText = "font-size:.75rem;color:#6a7a60;margin-bottom:4px;";
    content.appendChild(nameLbl);
    var nameInput = document.createElement("input"); nameInput.type = "text";
    nameInput.value = branch ? branch.name : "";
    nameInput.placeholder = "Наприклад: Студія Oliva";
    nameInput.style.cssText = "font-size:.92rem;padding:10px 12px;border:1.5px solid #d8ddd4;border-radius:10px;width:100%;box-sizing:border-box;margin-bottom:20px;";
    content.appendChild(nameInput);

    // ── Тижневий розклад
    var schedLbl = document.createElement("div"); schedLbl.textContent = "Розклад (тижневий)";
    schedLbl.style.cssText = "font-size:.75rem;color:#6a7a60;margin-bottom:10px;font-weight:600;";
    content.appendChild(schedLbl);
    var schedErr = document.createElement("div");
    schedErr.style.cssText = "display:none;color:#e05050;font-size:.8rem;margin-bottom:8px;padding:8px 12px;background:#fff0f0;border-radius:8px;border:1px solid #f5c0c0;";
    content.appendChild(schedErr);

    var DOW_NAMES = ["Нд","Пн","Вт","Ср","Чт","Пт","Сб"];
    var schedRows = {}; // weekday → {ws, we}
    var existSched = branch ? (branch.schedule || []) : [];
    existSched.forEach(function(s) { schedRows[s.weekday] = { ws: fmtMin(s.work_start), we: fmtMin(s.work_end) }; });

    var schedGrid = document.createElement("div");
    schedGrid.style.cssText = "margin-bottom:24px;";
    [1,2,3,4,5,6,0].forEach(function(wd) {
      var row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;";
      var dowLbl = document.createElement("div");
      dowLbl.textContent = DOW_NAMES[wd];
      dowLbl.style.cssText = "width:28px;font-size:.8rem;color:#555;font-weight:600;flex-shrink:0;";
      var wsI = document.createElement("input"); wsI.type = "time"; wsI.value = (schedRows[wd] || {}).ws || "";
      wsI.style.cssText = "flex:1;padding:8px;border:1.5px solid #d8ddd4;border-radius:8px;font-size:.88rem;";
      var sep = document.createElement("span"); sep.textContent = "–"; sep.style.cssText = "color:#aaa;";
      var weI = document.createElement("input"); weI.type = "time"; weI.value = (schedRows[wd] || {}).we || "";
      weI.style.cssText = "flex:1;padding:8px;border:1.5px solid #d8ddd4;border-radius:8px;font-size:.88rem;";
      row.appendChild(dowLbl); row.appendChild(wsI); row.appendChild(sep); row.appendChild(weI);
      row.dataset.wd = wd;
      row._wsI = wsI; row._weI = weI;
      schedGrid.appendChild(row);
    });
    content.appendChild(schedGrid);

    // ── Призначити майстрів
    var mastersLbl = document.createElement("div"); mastersLbl.textContent = "Майстри філії";
    mastersLbl.style.cssText = "font-size:.75rem;color:#6a7a60;margin-bottom:10px;font-weight:600;";
    content.appendChild(mastersLbl);

    var mastersGrid = document.createElement("div");
    mastersGrid.style.cssText = "margin-bottom:24px;";
    mastersGrid.innerHTML = '<div style="color:#aaa;font-size:.82rem;">Завантаження…</div>';
    content.appendChild(mastersGrid);

    var selectedMasterIds = branch ? (branch.masters || []).map(function(m) { return m.id; }) : [];

    api("GET", "/api/crm/masters").then(function(res) {
      var masters = res.j.masters || [];
      mastersGrid.innerHTML = "";
      masters.forEach(function(m) {
        var row2 = document.createElement("label");
        row2.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0f2ee;cursor:pointer;";
        var cb = document.createElement("input"); cb.type = "checkbox";
        cb.style.cssText = "width:18px;height:18px;accent-color:#3d5430;flex-shrink:0;";
        if (selectedMasterIds.indexOf(m.id) !== -1) cb.checked = true;
        cb.addEventListener("change", function() {
          if (cb.checked) { if (selectedMasterIds.indexOf(m.id) === -1) selectedMasterIds.push(m.id); }
          else { selectedMasterIds = selectedMasterIds.filter(function(id) { return id !== m.id; }); }
        });
        var initials = (m.name||'?')[0].toUpperCase() + (m.last_name ? m.last_name[0].toUpperCase() : '');
        var ava2 = document.createElement("div");
        ava2.style.cssText = "width:32px;height:32px;border-radius:50%;background:#3d5430;color:#8aA462;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;flex-shrink:0;overflow:hidden;";
        ava2.innerHTML = m.photo ? '<img src="' + m.photo + '" style="width:100%;height:100%;object-fit:cover;">' : initials;
        var mName = document.createElement("div");
        mName.textContent = m.name + (m.last_name ? ' '+m.last_name : '') + (m.level ? ' · ' + m.level : '');
        mName.style.cssText = "font-size:.88rem;color:#1a2016;";
        row2.appendChild(cb); row2.appendChild(ava2); row2.appendChild(mName);
        mastersGrid.appendChild(row2);
      });
    });

    // Видалити (тільки для існуючих)
    if (!isNew) {
      var delBtn = document.createElement("button");
      delBtn.textContent = "Видалити філію";
      delBtn.style.cssText = "width:100%;padding:12px;background:none;border:1.5px solid #e05050;color:#e05050;border-radius:10px;font-size:.9rem;cursor:pointer;margin-bottom:16px;";
      delBtn.addEventListener("click", function() {
        if (!confirm("Видалити філію \"" + branch.name + "\"?")) return;
        api("DELETE", "/api/crm/branches/" + branch.id).then(function() { goBack(); });
      });
      content.appendChild(delBtn);
    }

    // Save btn (fixed)
    var saveBtn = document.createElement("button");
    saveBtn.id = "branchSaveBtn";
    saveBtn.textContent = "Зберегти";
    saveBtn.style.cssText = "position:fixed;bottom:" + (navH2 + 8) + "px;left:16px;right:16px;padding:16px;background:#1a2016;color:#fff;border:none;border-radius:16px;font-size:1rem;font-weight:600;cursor:pointer;z-index:20;";
    document.body.appendChild(saveBtn);

    saveBtn.addEventListener("click", function() {
      var name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }

      var schedule = [];
      var validErr = null;
      var DOW_LABELS = ["Нд","Пн","Вт","Ср","Чт","Пт","Сб"];
      schedGrid.querySelectorAll("div[data-wd]").forEach(function(row3) {
        if (validErr) return;
        var wd2 = parseInt(row3.dataset.wd, 10);
        var ws2 = toMin(row3._wsI.value), we2 = toMin(row3._weI.value);
        var hasStart = row3._wsI.value !== "";
        var hasEnd   = row3._weI.value !== "";
        if (hasStart && !hasEnd) { validErr = DOW_LABELS[wd2] + ": вкажіть час кінця роботи"; return; }
        if (!hasStart && hasEnd) { validErr = DOW_LABELS[wd2] + ": вкажіть час початку роботи"; return; }
        if (ws2 != null && we2 != null) {
          if (we2 <= ws2) { validErr = DOW_LABELS[wd2] + ": час кінця має бути пізніше початку"; return; }
          schedule.push({ weekday: wd2, work_start: ws2, work_end: we2 });
        }
      });
      if (validErr) {
        schedErr.textContent = validErr;
        schedErr.style.display = "block";
        schedErr.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      schedErr.style.display = "none";

      saveBtn.textContent = "Збереження…"; saveBtn.disabled = true;

      var p = isNew
        ? api("POST", "/api/crm/branches", { name: name, master_ids: selectedMasterIds })
        : api("PUT", "/api/crm/branches/" + branch.id, { name: name, master_ids: selectedMasterIds });

      p.then(function(r) {
        var bId = isNew ? r.j.id : branch.id;
        return api("PUT", "/api/crm/branches/" + bId + "/schedule", { schedule: schedule });
      }).then(function() {
        saveBtn.disabled = false;
        saveBtn.textContent = "Збережено ✓"; saveBtn.style.background = "#3d5430";
        setTimeout(function() { goBack(); }, 800);
      }).catch(function() { saveBtn.disabled = false; saveBtn.textContent = "Помилка"; });
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
      var url = "/api/crm/clients" + (q ? "?q=" + encodeURIComponent(q) : "");
      api("GET", url).then(function (res) {
        var list = res.j.clients || [];
        listEl.innerHTML = "";
        if (!list.length) { listEl.appendChild(el("div", "empty", "Клієнтів не знайдено")); return; }
        list.forEach(function (c) {
          var item = el("div", "item");
          item.style.cursor = "pointer";
          item.addEventListener("click", function () { renderClientCard(c.id); });
          var row = el("div", "row1");
          var initials = (c.name || "").split(" ").map(function(w){return w[0]||"";}).join("").slice(0,2).toUpperCase();
          var ava = document.createElement("div");
          ava.style.cssText = "width:38px;height:38px;border-radius:50%;background:var(--olive-light);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;flex-shrink:0;margin-right:10px;";
          ava.textContent = initials || "?";
          row.appendChild(ava);
          var info = el("div");
          info.appendChild(el("div", "t", c.name + (c.blacklisted ? " 🚫" : "")));
          info.appendChild(el("div", "sub", c.phone + " · візитів: " + (c.visit_count || 0) +
            (c.last_visit_at ? " · " + new Date(c.last_visit_at).toLocaleDateString("uk-UA") : "")));
          row.appendChild(info); row.appendChild(el("span", "sp"));
          row.appendChild(el("span", null, "›"));
          item.appendChild(row);
          if (c.note) item.appendChild(el("div", "sub", "📝 " + c.note));
          listEl.appendChild(item);
        });
      });
    }
    load("");
  }

  function renderClientCard(id) {
    var main = $("main"); main.innerHTML = '<div class="empty">Завантаження…</div>';
    api("GET", "/api/crm/clients/" + id).then(function (res) {
      if (!res.j.ok) { main.innerHTML = '<div class="empty">Не знайдено</div>'; return; }
      var c = res.j.client, h = res.j.history || [];
      main.innerHTML = "";

      // ── Шапка ──────────────────────────────────────────────────────
      var topBar = document.createElement("div");
      topBar.style.cssText = "display:flex;align-items:center;gap:8px;padding:12px 0 8px;";
      var backBtn = el("button", "btn btn-ghost btn-sm", "← Клієнти");
      backBtn.style.cssText = "padding:6px 10px;font-size:.82rem;";
      backBtn.addEventListener("click", renderClients);
      topBar.appendChild(backBtn);
      topBar.appendChild(el("span", "sp"));

      // Three-dot menu
      var menuBtn = document.createElement("button");
      menuBtn.className = "btn btn-ghost btn-sm";
      menuBtn.style.cssText = "font-size:1.2rem;padding:4px 8px;";
      menuBtn.textContent = "⋮";
      menuBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        var old = document.getElementById("client-ctx"); if (old) { old.remove(); return; }
        var ctx = document.createElement("div");
        ctx.id = "client-ctx";
        ctx.style.cssText = "position:fixed;right:16px;top:56px;background:#fff;border:1px solid var(--line);border-radius:12px;" +
          "box-shadow:0 4px 20px rgba(0,0,0,.12);min-width:200px;z-index:200;overflow:hidden;";
        ctx.innerHTML =
          '<div style="padding:10px 16px 8px;font-size:.72rem;color:var(--text-dim);font-weight:500;border-bottom:1px solid var(--line);">Додаткові дії</div>' +
          '<button id="cc-edit"   style="display:block;width:100%;text-align:left;background:none;border:none;padding:13px 16px;font-size:.9rem;cursor:pointer;border-bottom:1px solid var(--line);">Редагувати</button>' +
          '<button id="cc-black"  style="display:block;width:100%;text-align:left;background:none;border:none;padding:13px 16px;font-size:.9rem;cursor:pointer;border-bottom:1px solid var(--line);">' + (c.blacklisted ? 'Прибрати з чорного списку' : 'Додати до чорного списку') + '</button>' +
          (ME.role === "owner" ? '<button id="cc-del" style="display:block;width:100%;text-align:left;background:none;border:none;padding:13px 16px;font-size:.9rem;color:#c04040;cursor:pointer;">Видалити</button>' : '');
        document.body.appendChild(ctx);

        function closeCtx() { var x=document.getElementById("client-ctx"); if(x) x.remove(); }

        document.getElementById("cc-edit").addEventListener("click", function() {
          closeCtx();
          var html = '<h3>Редагувати клієнта</h3>' +
            '<label>Ім\'я</label><input type="text" id="ceN" value="' + (c.name||"").replace(/"/g,"&quot;") + '" maxlength="100">' +
            '<label style="margin-top:10px;display:block;">Телефон</label><input type="tel" id="cePh" value="' + (c.phone||"") + '" maxlength="30">' +
            '<label style="margin-top:10px;display:block;">Коментар</label><textarea id="ceNote" maxlength="1000">' + (c.note||"") + '</textarea>' +
            '<div class="err" id="ceErr"></div>' +
            '<div class="modal-foot"><button class="btn btn-primary" id="ceSave">Зберегти</button><button class="btn btn-ghost" id="ceClose">Скасувати</button></div>';
          openModal(html);
          $("ceSave").addEventListener("click", function() {
            var name = $("ceN").value.trim(), phone = $("cePh").value.trim();
            if (!name) { $("ceErr").textContent = "Вкажи ім\'я"; return; }
            api("PATCH", "/api/crm/clients/" + id, { name: name, phone: phone, note: $("ceNote").value.trim() }).then(function(r) {
              if (!r.j.ok) { $("ceErr").textContent = "Помилка"; return; }
              closeModal(); renderClientCard(id);
            });
          });
          $("ceClose").addEventListener("click", closeModal);
        });

        document.getElementById("cc-black").addEventListener("click", function() {
          closeCtx();
          api("PATCH", "/api/crm/clients/" + id, { blacklisted: c.blacklisted ? 0 : 1 }).then(function() { renderClientCard(id); });
        });

        if (ME.role === "owner") {
          document.getElementById("cc-del").addEventListener("click", function() {
            closeCtx();
            var html = '<h3>Видалити клієнта?</h3>' +
              '<p class="muted">Буде видалено клієнта <b>' + c.name + '</b> та всі його записи. Цю дію неможливо скасувати.</p>' +
              '<div class="modal-foot"><button class="btn btn-primary" id="cdDel" style="background:#c04040;border-color:#c04040;">Видалити</button>' +
              '<button class="btn btn-ghost" id="cdNo">Скасувати</button></div>';
            openModal(html);
            $("cdDel").addEventListener("click", function() {
              api("DELETE", "/api/crm/clients/" + id).then(function(r) {
                if (!r.j.ok) return;
                closeModal(); renderClients();
              });
            });
            $("cdNo").addEventListener("click", closeModal);
          });
        }

        setTimeout(function() {
          document.addEventListener("click", function onD() { closeCtx(); document.removeEventListener("click", onD); });
        }, 50);
      });
      topBar.appendChild(menuBtn);
      main.appendChild(topBar);

      // ── Аватар + ім'я ───────────────────────────────────────────────
      var heroDiv = document.createElement("div");
      heroDiv.style.cssText = "display:flex;flex-direction:column;align-items:center;padding:20px 0 16px;";
      var initials = (c.name || "").split(" ").map(function(w){return w[0]||"";}).join("").slice(0,2).toUpperCase();
      var ava = document.createElement("div");
      ava.style.cssText = "width:80px;height:80px;border-radius:50%;background:var(--olive-light);color:#fff;display:flex;" +
        "align-items:center;justify-content:center;font-size:1.6rem;font-weight:700;margin-bottom:12px;" +
        (c.blacklisted ? "opacity:.5;" : "");
      ava.textContent = initials || "?";
      heroDiv.appendChild(ava);
      var nameEl = document.createElement("div");
      nameEl.style.cssText = "font-size:1.25rem;font-weight:700;color:var(--cream);text-align:center;" + (c.blacklisted ? "opacity:.6;" : "");
      nameEl.textContent = c.name + (c.blacklisted ? " 🚫" : "");
      heroDiv.appendChild(nameEl);
      main.appendChild(heroDiv);

      // ── Телефон ─────────────────────────────────────────────────────
      if (c.phone) {
        var phCard = document.createElement("div");
        phCard.style.cssText = "background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 16px;" +
          "display:flex;align-items:center;gap:10px;margin-bottom:12px;";
        var phIcon = document.createElement("div");
        phIcon.style.cssText = "color:var(--text-dim);font-size:1rem;flex-shrink:0;";
        phIcon.textContent = "📞";
        var phInfo = document.createElement("div");
        phInfo.style.cssText = "flex:1;min-width:0;";
        phInfo.innerHTML = '<div style="font-size:.68rem;color:var(--text-dim);">Номер телефону</div><div style="font-size:.9rem;font-weight:500;color:var(--cream);">' + c.phone + '</div>';
        phCard.appendChild(phIcon);
        phCard.appendChild(phInfo);
        // Copy
        var copyBtn = document.createElement("button");
        copyBtn.className = "btn btn-ghost btn-sm";
        copyBtn.style.cssText = "padding:6px;font-size:.9rem;";
        copyBtn.title = "Скопіювати";
        copyBtn.textContent = "⎘";
        copyBtn.addEventListener("click", function() {
          navigator.clipboard.writeText(c.phone);
          copyBtn.textContent = "✓";
          setTimeout(function() { copyBtn.textContent = "⎘"; }, 1500);
        });
        // Call
        var callBtn = document.createElement("a");
        callBtn.className = "btn btn-ghost btn-sm";
        callBtn.style.cssText = "padding:6px;font-size:.9rem;text-decoration:none;";
        callBtn.title = "Зателефонувати";
        callBtn.textContent = "📲";
        callBtn.href = "tel:" + c.phone.replace(/\s/g, "");
        phCard.appendChild(copyBtn);
        phCard.appendChild(callBtn);
        main.appendChild(phCard);
      }

      // ── Кнопки дій ──────────────────────────────────────────────────
      var actRow = document.createElement("div");
      actRow.style.cssText = "display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:14px;";
      var newAppt = el("button", "btn btn-primary", "📅 Новий запис");
      newAppt.addEventListener("click", function() {
        var lastCompleted = h.find(function(a) { return a.status === "completed"; });
        apptModal({ prefill: {
          clientName: c.name, clientPhone: c.phone,
          serviceId: lastCompleted ? lastCompleted.service_id : undefined,
          masterId: ME.role !== "owner" ? ME.masterId : (lastCompleted ? lastCompleted.master_id : undefined)
        }});
      });
      actRow.appendChild(newAppt);
      main.appendChild(actRow);

      // ── Статистика ──────────────────────────────────────────────────
      var statsRow = document.createElement("div");
      statsRow.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;";
      function statCard(lbl, val) {
        var d = document.createElement("div");
        d.style.cssText = "background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;";
        d.innerHTML = '<div style="font-size:.68rem;color:var(--text-dim);">' + lbl + '</div>' +
          '<div style="font-size:1.1rem;font-weight:700;color:var(--cream);margin-top:2px;">' + val + '</div>';
        return d;
      }
      var lastVisitStr = c.last_visit_at ? new Date(c.last_visit_at).toLocaleDateString("uk-UA") : "—";
      statsRow.appendChild(statCard("Кількість візитів", c.visit_count || 0));
      statsRow.appendChild(statCard("Останній візит", lastVisitStr));
      main.appendChild(statsRow);

      // ── Нотатка ─────────────────────────────────────────────────────
      if (c.note) {
        var noteDiv = document.createElement("div");
        noteDiv.style.cssText = "background:#fffde7;border:1px solid #f0e060;border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:.85rem;color:#6a5800;";
        noteDiv.innerHTML = '📝 ' + c.note;
        main.appendChild(noteDiv);
      }

      // ── Розділ «Візити та продажі» ──────────────────────────────────
      var histSection = document.createElement("div");
      histSection.style.cssText = "background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:14px;";
      var histHead = document.createElement("div");
      histHead.style.cssText = "padding:14px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px;cursor:pointer;";
      histHead.innerHTML = '<span style="font-size:1rem;">📋</span>' +
        '<span style="font-weight:600;color:var(--cream);font-size:.9rem;">Візити та продажі</span>' +
        '<span style="margin-left:auto;color:var(--text-dim);font-size:.8rem;">' + h.length + '</span>' +
        '<span style="color:var(--text-dim);">›</span>';
      var histBody = document.createElement("div");
      var histOpen = false;
      histHead.addEventListener("click", function() {
        histOpen = !histOpen;
        histBody.style.display = histOpen ? "block" : "none";
        histHead.querySelector("span:last-child").textContent = histOpen ? "∨" : "›";
      });
      if (!h.length) {
        histBody.appendChild(el("div", "empty", "Записів поки немає"));
      } else {
        h.forEach(function (a) {
          var it = document.createElement("div");
          it.style.cssText = "padding:10px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;";
          it.innerHTML =
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:.82rem;font-weight:600;color:var(--cream);">' + ddmm(a.date) + ' ' + a.time + '</div>' +
              '<div style="font-size:.75rem;color:var(--text-dim);">' + a.service_name + ' · ' + a.master_name + '</div>' +
            '</div>' +
            '<span class="badge b-' + a.status + '">' + (STATUS_LABEL[a.status] || a.status) + '</span>';
          histBody.appendChild(it);
        });
      }
      histBody.style.display = "none";
      histSection.appendChild(histHead);
      histSection.appendChild(histBody);
      main.appendChild(histSection);

      // ── Абонементи клієнта ──────────────────────────────────────────
      var subsSection = document.createElement("div");
      subsSection.style.cssText = "margin-bottom:14px;";

      function renderSubs() {
        subsSection.innerHTML = "";
        api("GET", "/api/crm/subscriptions?client_id=" + id).then(function(res) {
          var subs = res.j.subscriptions || [];
          var wrap = document.createElement("div");
          wrap.style.cssText = "background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;";

          var head = document.createElement("div");
          head.style.cssText = "padding:14px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px;";
          head.innerHTML = '<span style="font-size:1rem;">🎟</span>' +
            '<span style="font-weight:600;color:var(--cream);font-size:.9rem;">Абонементи</span>' +
            '<span style="margin-left:auto;color:var(--text-dim);font-size:.8rem;">' + subs.length + '</span>';

          if (ME.role === "owner") {
            var addBtn = el("button", "btn btn-sm btn-primary", "+ Новий");
            addBtn.style.marginLeft = "8px";
            addBtn.addEventListener("click", function() {
              api("GET", "/api/crm/services").then(function(sr) {
                var opts = (sr.j.services||[]).map(function(s) {
                  return '<option value="' + s.id + '">' + s.name + '</option>';
                }).join("");
                var html = '<h3>🎟 Новий абонемент</h3>' +
                  '<div class="muted" style="margin-bottom:10px;">' + c.name + '</div>' +
                  '<label>Послуга</label><select id="sbSvc">' + opts + '</select>' +
                  '<label style="margin-top:10px;display:block;">К-ть сеансів</label>' +
                  '<input type="number" id="sbSess" value="10" min="1" max="100">' +
                  '<label style="margin-top:10px;display:block;">Сума оплати (грн)</label>' +
                  '<input type="number" id="sbPrice" value="0" min="0">' +
                  '<label style="margin-top:10px;display:block;">Нотатка</label>' +
                  '<input type="text" id="sbNote" placeholder="Необов\'язково" maxlength="300">' +
                  '<div class="err" id="sbErr"></div>' +
                  '<div class="modal-foot"><button class="btn btn-primary" id="sbSave">Зберегти</button>' +
                  '<button class="btn btn-ghost" id="sbClose">Скасувати</button></div>';
                openModal(html);
                $("sbSave").addEventListener("click", function() {
                  var sess = parseInt($("sbSess").value, 10);
                  if (!sess || sess < 1) { $("sbErr").textContent = "Вкажи к-ть сеансів"; return; }
                  var priceKop = Math.round(parseFloat($("sbPrice").value || 0) * 100);
                  api("POST", "/api/crm/subscriptions", {
                    client_id: id, service_id: $("sbSvc").value,
                    total_sessions: sess, price: priceKop,
                    note: $("sbNote").value.trim() || null
                  }).then(function(r) {
                    if (!r.j.ok) { $("sbErr").textContent = "Помилка"; return; }
                    closeModal(); renderSubs();
                  });
                });
                $("sbClose").addEventListener("click", closeModal);
              });
            });
            head.appendChild(addBtn);
          }
          wrap.appendChild(head);

          if (!subs.length) {
            var empty = el("div", "empty", "Абонементів немає");
            empty.style.padding = "14px 16px";
            wrap.appendChild(empty);
          } else {
            subs.forEach(function(sub) {
              var rem = sub.total_sessions - sub.used_sessions;
              var pct = Math.round((sub.used_sessions / sub.total_sessions) * 100);
              var isExpired = rem <= 0;
              var row = document.createElement("div");
              row.style.cssText = "padding:12px 16px;border-bottom:1px solid var(--line);";
              row.innerHTML =
                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
                  '<span style="font-size:.88rem;font-weight:600;color:var(--cream);flex:1;">' + sub.service_name + '</span>' +
                  '<span style="font-size:.78rem;font-weight:700;padding:2px 8px;border-radius:20px;' +
                    (isExpired ? 'background:#fde8e8;color:#c04040;' : 'background:#e8f5e9;color:#2e7d32;') + '">' +
                    (isExpired ? 'Вичерпано' : 'Залишилось: ' + rem) + '</span>' +
                '</div>' +
                '<div style="background:#e8ebe4;border-radius:4px;height:6px;overflow:hidden;margin-bottom:6px;">' +
                  '<div style="width:' + pct + '%;height:100%;background:' + (isExpired ? '#c04040' : '#6e9145') + ';border-radius:4px;transition:width .3s;"></div>' +
                '</div>' +
                '<div style="display:flex;gap:12px;font-size:.75rem;color:var(--text-dim);">' +
                  '<span>Використано: ' + sub.used_sessions + ' / ' + sub.total_sessions + '</span>' +
                  (sub.price ? '<span>Оплачено: ' + Math.round(sub.price/100).toLocaleString("uk-UA") + ' грн</span>' : '') +
                  (sub.note ? '<span>📝 ' + sub.note + '</span>' : '') +
                '</div>' +
                '<div class="acts" style="margin-top:8px;" id="sub-acts-' + sub.id + '"></div>';
              var actsDiv = row.querySelector("#sub-acts-" + sub.id);
              if (!isExpired) {
                var useBtn = el("button", "btn btn-sm btn-primary", "✓ Списати сеанс");
                useBtn.addEventListener("click", function() {
                  api("PATCH", "/api/crm/subscriptions/" + sub.id + "/use").then(function(r) {
                    if (!r.j.ok) return;
                    renderSubs();
                  });
                });
                actsDiv.appendChild(useBtn);
              }
              if (ME.role === "owner") {
                var delBtn = el("button", "btn btn-sm btn-ghost", "Видалити");
                delBtn.style.color = "#c04040";
                delBtn.addEventListener("click", function() {
                  if (!confirm("Видалити абонемент?")) return;
                  api("DELETE", "/api/crm/subscriptions/" + sub.id).then(function() { renderSubs(); });
                });
                actsDiv.appendChild(delBtn);
              }
              wrap.appendChild(row);
            });
          }
          subsSection.appendChild(wrap);
        });
      }
      renderSubs();
      main.appendChild(subsSection);
    });
  }

  /* ============================================================
     АНАЛІТИКА (власник)
     ============================================================ */
  function renderAnalytics() {
    var main = $("main");
    var today = new Date().toISOString().slice(0,10);
    var defaultFrom = today.slice(0,7) + "-01";

    // ── Шапка з фільтром дат ──────────────────────────────────────
    main.innerHTML = "";
    var filterBar = document.createElement("div");
    filterBar.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px;";
    filterBar.innerHTML =
      '<span style="font-size:.82rem;color:var(--text-dim);flex-shrink:0;">Статистика за:</span>' +
      '<input type="date" id="aFrom" value="' + defaultFrom + '" style="width:140px;">' +
      '<span style="color:var(--text-dim);font-size:.85rem;">—</span>' +
      '<input type="date" id="aTo" value="' + today + '" style="width:140px;">' +
      '<button class="btn btn-primary btn-sm" id="aApply">Застосувати</button>';
    main.appendChild(filterBar);

    var statsArea = document.createElement("div");
    main.appendChild(statsArea);

    function loadStats(from, to) {
      statsArea.innerHTML = '<div class="empty">Завантаження…</div>';
      api("GET", "/api/crm/dashboard/analytics?from=" + from + "&to=" + to).then(function(res) {
        if (!res.j.ok) { statsArea.innerHTML = '<div class="empty">Помилка</div>'; return; }
        var d = res.j;
        statsArea.innerHTML = "";

      var MONTHNAMES = ["Січ","Лют","Бер","Кві","Тра","Чер","Лип","Сер","Вер","Жов","Лис","Гру"];
      var currentMonth = new Date().toISOString().slice(0,7);

      function grn(kop) { return kop ? Math.round(kop/100).toLocaleString("uk-UA") + " грн" : "0 грн"; }
      function grnShort(kop) {
        var g = Math.round((kop||0)/100);
        if (g >= 1000) return (g/1000).toFixed(1).replace(/\.0$/,"") + "к";
        return g + "";
      }
      function section(html) {
        var d = document.createElement("div");
        d.style.cssText = "background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:14px;";
        d.innerHTML = html; return d;
      }
      function title(t) {
        return '<div style="font-family:\'Playfair Display\',serif;color:var(--cream);font-size:1rem;font-weight:500;margin-bottom:14px;">' + t + '</div>';
      }

      /* ---- KPI картки за період ---- */
      var kpiRow = document.createElement("div");
      kpiRow.style.cssText = "display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:14px;";
      [
        { icon:"💰", val: grn(d.period_revenue||0),   lbl:"Всього доходу" },
        { icon:"👤", val: (d.period_clients||0)+"",    lbl:"К-ть клієнтів" },
        { icon:"🧑‍🤝‍🧑", val: (d.total_clients||0)+"",  lbl:"Всього клієнтів" },
        { icon:"⭐", val: (d.period_reviews||0)+"",    lbl:"Відгуків" },
      ].forEach(function(k) {
        var c = document.createElement("div");
        c.style.cssText = "background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 14px;";
        c.innerHTML = '<div style="font-size:1.4rem;margin-bottom:6px;">'+k.icon+'</div>'+
          '<div style="font-size:1.4rem;font-weight:700;color:var(--cream);font-family:\'Playfair Display\',serif;line-height:1.1;">'+k.val+'</div>'+
          '<div style="font-size:.72rem;color:var(--text-dim);margin-top:5px;">'+k.lbl+'</div>';
        kpiRow.appendChild(c);
      });
      statsArea.appendChild(kpiRow);

      /* ---- Area chart: дохід за 30 днів ---- */
      var days = d.revenue_by_day || [];
      if (days.length > 1) {
        var W=860, H=130, PL=52, PR=10, PT=12, PB=22;
        var pw=W-PL-PR, ph=H-PT-PB;
        var maxRev = Math.max.apply(null, days.map(function(x){return x.revenue||0;})) || 1;
        var n = days.length;
        var pts = days.map(function(day,i){ return [PL+i/(n-1)*pw, PT+ph-(day.revenue||0)/maxRev*ph, day]; });

        // Area
        var aPath = "M "+pts[0][0]+","+(PT+ph);
        pts.forEach(function(p){ aPath+=" L "+p[0]+","+p[1]; });
        aPath+=" L "+pts[n-1][0]+","+(PT+ph)+" Z";
        // Smooth line
        var lPath = "M "+pts[0][0]+","+pts[0][1];
        for (var i=1;i<pts.length;i++){
          var cpx=(pts[i][0]-pts[i-1][0])*0.4;
          lPath+=" C "+(pts[i-1][0]+cpx)+","+pts[i-1][1]+" "+(pts[i][0]-cpx)+","+pts[i][1]+" "+pts[i][0]+","+pts[i][1];
        }
        // Y grid
        var yg=""; for(var yi=0;yi<=4;yi++){
          var yv=maxRev*yi/4, yp=PT+ph-ph*yi/4;
          yg+='<line x1="'+PL+'" y1="'+yp+'" x2="'+(W-PR)+'" y2="'+yp+'" stroke="rgba(122,145,86,.07)"/>';
          yg+='<text x="'+(PL-5)+'" y="'+(yp+4)+'" text-anchor="end" font-size="9" fill="var(--text-dim)">'+grnShort(yv)+'к</text>';
        }
        // X labels
        var xl=""; pts.forEach(function(p,i){
          if(i===0||i===n-1||i%5===0){
            var lbl=(p[2].date||"").slice(5).replace("-",".");
            xl+='<text x="'+p[0]+'" y="'+(H-5)+'" text-anchor="middle" font-size="9" fill="var(--text-dim)">'+lbl+'</text>';
          }
        });
        // Dots
        var dots=pts.map(function(p){
          return '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="3" fill="var(--olive-light)" opacity=".8"><title>'+(p[2].date||"")+': '+grn(p[2].revenue)+'</title></circle>';
        }).join("");

        var svg='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;overflow:visible;">'+
          '<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">'+
          '<stop offset="0%" stop-color="var(--olive-light)" stop-opacity=".3"/>'+
          '<stop offset="100%" stop-color="var(--olive-light)" stop-opacity=".02"/></linearGradient></defs>'+
          yg+xl+
          '<path d="'+aPath+'" fill="url(#ag)"/>'+
          '<path d="'+lPath+'" fill="none" stroke="var(--olive-light)" stroke-width="2"/>'+
          dots+'</svg>';
        statsArea.appendChild(section(title("📈 Дохід за обраний період")+svg));
      }

      /* ---- Клієнти за обраний період ---- */
      var cp = d.clients_period || {}, co = d.clients_overall || {};
      function clientKpi(items) {
        var h = '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;">';
        items.forEach(function(k) {
          h += '<div style="text-align:center;min-width:0;">' +
            '<div style="font-size:1.5rem;font-weight:700;color:'+(k.col||"var(--cream)")+';font-family:\'Playfair Display\',serif;">'+k.val+'</div>' +
            '<div style="font-size:.7rem;color:var(--text-dim);margin-top:3px;">'+k.lbl+'</div></div>';
        });
        return h + '</div>';
      }
      var clientsRow = document.createElement("div");
      clientsRow.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-bottom:14px;";
      clientsRow.appendChild(section(
        title("👤 Клієнти за період") +
        clientKpi([
          { val: cp.total||0, lbl: "Всього записів" },
          { val: cp.returning||0, lbl: "Повторних", col: "var(--olive-light)" },
          { val: cp.new||0, lbl: "Нових" },
        ])
      ));
      clientsRow.appendChild(section(
        title("📊 Загальна база") +
        clientKpi([
          { val: co.total||0, lbl: "Всього клієнтів" },
          { val: (co.returning_pct||0)+"%", lbl: "Повернулись", col: "var(--olive-light)" },
          { val: co.one_time||0, lbl: "Разові", col: co.one_time ? "var(--err)" : "var(--cream)" },
        ])
      ));
      statsArea.appendChild(clientsRow);

      // Клієнти, що не повернулись
      var notReturned = d.clients_not_returned || [];
      if (notReturned.length) {
        var nrHtml = title("⚠️ Не повернулись — варто нагадати про себе");
        nrHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">';
        notReturned.forEach(function(c) {
          var daysAgo = c.last_visit_at ? Math.round((Date.now()-c.last_visit_at)/86400000) : null;
          nrHtml += '<div style="background:var(--panel-2);border:1px solid var(--line);border-radius:9px;padding:10px 12px;">' +
            '<div style="font-size:.85rem;color:var(--cream);font-weight:500;">'+c.name+'</div>' +
            '<div style="font-size:.75rem;color:var(--text-dim);margin-top:2px;">'+(c.phone||"")+'</div>' +
            (daysAgo!=null ? '<div style="font-size:.7rem;color:var(--err);margin-top:3px;">'+daysAgo+' дн. тому</div>' : '') +
            '</div>';
        });
        nrHtml += '</div>';
        statsArea.appendChild(section(nrHtml));
      }

      /* ---- Майстри ---- */
      var loyalty = d.master_loyalty || [];
      if (loyalty.length) {
        var mHtml = title("👥 Ефективність майстрів");
        mHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;">';
        loyalty.forEach(function(m){
          var col = m.loyalty_pct>=50?"var(--olive-light)":m.loyalty_pct>=25?"var(--warn)":"var(--text-dim)";
          mHtml+='<div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:14px;text-align:center;">'+
            '<div style="font-size:.88rem;font-weight:600;color:var(--cream);margin-bottom:6px;">'+m.name+'</div>'+
            '<div style="font-size:1.7rem;font-weight:700;color:'+col+';font-family:\'Playfair Display\',serif;line-height:1;">'+m.loyalty_pct+'%</div>'+
            '<div style="font-size:.65rem;color:var(--text-dim);margin:3px 0 8px;">повторних</div>'+
            '<div style="background:rgba(0,0,0,.08);border-radius:3px;height:4px;margin-bottom:8px;">'+
            '<div style="width:'+m.loyalty_pct+'%;height:100%;background:'+col+';border-radius:3px;"></div></div>'+
            '<div style="font-size:.7rem;color:var(--text-dim);">'+m.returning+' з '+m.total_clients+'</div></div>';
        });
        mHtml += '</div>';
        statsArea.appendChild(section(mHtml));
      }

      /* ---- Місячна динаміка (бари) ---- */
      var byMonth = d.avg_by_month || [];
      if (byMonth.length > 0) {
        var MW=860,MH=110,ML=52,MR=10,MT=14,MB=22;
        var mpw=MW-ML-MR, mph=MH-MT-MB;
        var MN=byMonth.length;
        var maxMRev=Math.max.apply(null,byMonth.map(function(m){return m.revenue||0;}))||1;
        var barW=Math.max(20, Math.floor(mpw/MN*0.55));
        var mBars="", mLbls="";
        byMonth.forEach(function(m,i){
          var x=ML+(i+0.5)*mpw/MN-barW/2;
          var bh=Math.max(2,Math.round((m.revenue||0)/maxMRev*mph));
          var by=MT+mph-bh;
          var isCur=m.month===currentMonth;
          mBars+='<rect x="'+x+'" y="'+by+'" width="'+barW+'" height="'+bh+'" fill="'+(isCur?"var(--olive-light)":"rgba(110,145,69,.4)")+'" rx="3">'+
            '<title>'+m.month+': '+grn(m.revenue)+' / '+m.cnt+' зап.</title></rect>';
          if(m.revenue){mBars+='<text x="'+(x+barW/2)+'" y="'+(by-4)+'" text-anchor="middle" font-size="8" fill="var(--text-dim)">'+grnShort(m.revenue)+'к</text>';}
          var mn=parseInt(m.month.slice(5))-1;
          mLbls+='<text x="'+(x+barW/2)+'" y="'+(MH-5)+'" text-anchor="middle" font-size="9" fill="'+(isCur?"var(--olive-light)":"var(--text-dim)")+'">'+(MONTHNAMES[mn]||m.month.slice(5))+'</text>';
        });
        var myg=""; for(var yi=0;yi<=3;yi++){
          var yv2=maxMRev*yi/3, yp2=MT+mph-mph*yi/3;
          myg+='<line x1="'+ML+'" y1="'+yp2+'" x2="'+(MW-MR)+'" y2="'+yp2+'" stroke="rgba(0,0,0,.05)"/>';
          myg+='<text x="'+(ML-5)+'" y="'+(yp2+4)+'" text-anchor="end" font-size="8" fill="var(--text-dim)">'+grnShort(yv2)+'к</text>';
        }
        var mSvg='<svg viewBox="0 0 '+MW+' '+MH+'" style="width:100%;height:auto;">'+myg+mBars+mLbls+'</svg>';
        statsArea.appendChild(section(title("📅 Динаміка по місяцях")+mSvg));
      }

      /* ---- Відгуки за період ---- */
      var reviews = d.reviews || [];
      if (reviews.length) {
        var rHtml = title("⭐ Відгуки за період");
        rHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;">';
        reviews.forEach(function(r){
          var col=r.rating>=4?"var(--olive-light)":r.rating>=3?"var(--warn)":"var(--err)";
          rHtml+='<div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px;">'+
            '<div style="color:'+col+';font-size:.95rem;margin-bottom:4px;">'+"★".repeat(r.rating)+"☆".repeat(5-r.rating)+'</div>'+
            '<div style="font-size:.82rem;font-weight:600;color:var(--cream);margin-bottom:2px;">'+(r.client_name||"Клієнт")+'</div>'+
            '<div style="font-size:.7rem;color:var(--text-dim);margin-bottom:6px;">'+r.master_name+' · '+new Date(r.created_at).toLocaleDateString("uk-UA")+'</div>'+
            (r.comment?'<div style="font-size:.78rem;color:var(--text-dim);font-style:italic;">"'+r.comment+'"</div>':'')+
            '</div>';
        });
        rHtml += '</div>';
        statsArea.appendChild(section(rHtml));
      } else {
        statsArea.appendChild(section(title("⭐ Відгуки за період") +
          '<div style="color:var(--text-dim);font-size:.88rem;">Відгуків за цей період немає</div>'));
      }

      }); // end api call
    } // end loadStats

    $("aApply").addEventListener("click", function() {
      var f = $("aFrom").value, t = $("aTo").value;
      if (f && t && f <= t) loadStats(f, t);
    });

    loadStats(defaultFrom, today);
  }

  /* ============================================================
     ТРАФІК САЙТУ (власник)
     ============================================================ */
  function renderTraffic() {
    var main = $("main");

    function load() {
      // Показуємо спінер лише якщо контент ще не завантажений
      if (!main.dataset.loaded) main.innerHTML = '<div class="empty">Завантаження…</div>';
      var btn = document.getElementById("traffic-refresh");
      if (btn) { btn.textContent = "⟳"; btn.disabled = true; }

      api("GET", "/api/crm/analytics/visits").then(function(res) {
        if (!res.j.ok) { main.innerHTML = '<div class="empty">Помилка завантаження</div>'; return; }
        main.dataset.loaded = "1";
        var d = res.j;
        main.innerHTML = "";

      function sec(html) {
        var s = document.createElement("div");
        s.style.cssText = "background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:14px;";
        s.innerHTML = html; return s;
      }
      function ttl(t) { return '<div style="font-family:\'Playfair Display\',serif;color:var(--cream);font-size:1rem;font-weight:500;margin-bottom:14px;">'+t+'</div>'; }

      /* ---- KPI ---- */
      var kpi = d.kpi || {};
      var kpiRow = document.createElement("div");
      kpiRow.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px;";
      [
        { icon:"👁",  label:"Сьогодні",     v: (kpi.today||{}).n||0, u: (kpi.today||{}).u||0 },
        { icon:"📅", label:"Тиждень",       v: (kpi.week||{}).n||0,  u: (kpi.week||{}).u||0  },
        { icon:"📆", label:"Місяць (30 дн)",v: (kpi.month||{}).n||0, u: (kpi.month||{}).u||0 },
      ].forEach(function(k) {
        var c = document.createElement("div");
        c.style.cssText = "background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 14px;";
        c.innerHTML = '<div style="font-size:1.4rem;margin-bottom:6px;">'+k.icon+'</div>'+
          '<div style="font-size:1.3rem;font-weight:700;color:var(--cream);font-family:\'Playfair Display\',serif;">'+k.v+'</div>'+
          '<div style="font-size:.72rem;color:var(--text-dim);margin-top:3px;">'+k.u+' унікальних · '+k.label+'</div>';
        kpiRow.appendChild(c);
      });
      main.appendChild(kpiRow);

      /* ---- Відвідування по днях (area chart) ---- */
      var vdays = d.visits_by_day || [];
      if (vdays.length > 1) {
        var W=860,H=120,PL=42,PR=10,PT=10,PB=20;
        var pw=W-PL-PR, ph=H-PT-PB;
        var maxV = Math.max.apply(null, vdays.map(function(x){return x.total||0;})) || 1;
        var n = vdays.length;
        var pts  = vdays.map(function(v,i){ return [PL+i/(n-1)*pw, PT+ph-(v.total||0)/maxV*ph, v]; });
        var ptsU = vdays.map(function(v,i){ return [PL+i/(n-1)*pw, PT+ph-(v.uniq||0)/maxV*ph,  v]; });

        function areaPath(ps, bot) {
          var p="M "+ps[0][0]+","+bot;
          ps.forEach(function(pt){ p+=" L "+pt[0]+","+pt[1]; });
          return p+" L "+ps[ps.length-1][0]+","+bot+" Z";
        }
        function linePath(ps) {
          var p="M "+ps[0][0]+","+ps[0][1];
          for(var i=1;i<ps.length;i++){
            var dx=(ps[i][0]-ps[i-1][0])*0.4;
            p+=" C "+(ps[i-1][0]+dx)+","+ps[i-1][1]+" "+(ps[i][0]-dx)+","+ps[i][1]+" "+ps[i][0]+","+ps[i][1];
          }
          return p;
        }
        // Y grid
        var yg=""; for(var yi=0;yi<=3;yi++){
          var yv=Math.round(maxV*yi/3), yp=PT+ph-ph*yi/3;
          yg+='<line x1="'+PL+'" y1="'+yp+'" x2="'+(W-PR)+'" y2="'+yp+'" stroke="rgba(122,145,86,.07)"/>';
          yg+='<text x="'+(PL-4)+'" y="'+(yp+4)+'" text-anchor="end" font-size="9" fill="var(--text-dim)">'+yv+'</text>';
        }
        // X labels
        var xl=""; pts.forEach(function(p,i){
          if(i===0||i===n-1||i%5===0){
            var lbl=(p[2].day||"").slice(5).replace("-",".");
            xl+='<text x="'+p[0]+'" y="'+(H-3)+'" text-anchor="middle" font-size="9" fill="var(--text-dim)">'+lbl+'</text>';
          }
        });
        // Dots with tooltip
        var dots=pts.map(function(p){
          return '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="3" fill="var(--olive-light)" opacity=".8"><title>'+(p[2].day||"")+': '+p[2].total+' / '+p[2].uniq+' унікальних</title></circle>';
        }).join("");

        var svg='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;overflow:visible;">'+
          '<defs>'+
          '<linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--olive-light)" stop-opacity=".28"/><stop offset="100%" stop-color="var(--olive-light)" stop-opacity=".02"/></linearGradient>'+
          '<linearGradient id="ug" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7A9156" stop-opacity=".18"/><stop offset="100%" stop-color="#7A9156" stop-opacity=".01"/></linearGradient>'+
          '</defs>'+
          yg+xl+
          '<path d="'+areaPath(pts, PT+ph)+'" fill="url(#vg)"/>'+
          '<path d="'+areaPath(ptsU,PT+ph)+'" fill="url(#ug)"/>'+
          '<path d="'+linePath(pts)+'"  fill="none" stroke="var(--olive-light)" stroke-width="2"/>'+
          '<path d="'+linePath(ptsU)+'" fill="none" stroke="rgba(122,145,86,.5)" stroke-width="1.5" stroke-dasharray="4 3"/>'+
          dots+
          '</svg>';
        var legend='<div style="display:flex;gap:16px;margin-bottom:10px;font-size:.75rem;">'+
          '<span style="color:var(--olive-light);">─── Всього</span>'+
          '<span style="color:rgba(122,145,86,.7);">- - - Унікальних</span></div>';
        main.appendChild(sec(ttl("👁 Відвідування за 30 днів")+legend+svg));
      } else {
        main.appendChild(sec(ttl("👁 Відвідування за 30 днів")+'<div class="empty" style="padding:20px 0;">Даних поки немає — дочекайтесь перших відвідувачів після деплою</div>'));
      }

      /* ---- Середній рядок: сторінки + джерела ---- */
      var midRow = document.createElement("div");
      midRow.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;";

      // Топ сторінок
      var topPages = d.top_pages || [];
      var maxP = Math.max.apply(null, topPages.map(function(p){return p.total||0;})) || 1;
      var pgHtml = ttl("📄 Топ сторінок (30 дн)");
      var PAGE_NAMES = { "/": "Головна", "/booking.html": "Запис", "/blog.html": "Блог",
        "/shop.html": "Магазин", "/training.html": "Навчання", "/tips.html": "Чайові",
        "/certificate.html": "Сертифікати", "/share.html": "Поділитись" };
      topPages.forEach(function(p) {
        var nm = PAGE_NAMES[p.path] || p.path;
        var pct = Math.round((p.total||0)/maxP*100);
        pgHtml += '<div style="margin-bottom:9px;">'+
          '<div style="display:flex;justify-content:space-between;margin-bottom:3px;">'+
          '<span style="font-size:.82rem;color:var(--cream);">'+nm+'</span>'+
          '<span style="font-size:.75rem;color:var(--olive-light);">'+p.total+' / '+p.uniq+' uniq</span></div>'+
          '<div style="background:rgba(46,61,34,.4);border-radius:4px;height:7px;">'+
          '<div style="width:'+pct+'%;height:100%;background:rgba(122,145,86,.7);border-radius:4px;"></div></div></div>';
      });
      if (!topPages.length) pgHtml += '<div class="empty" style="padding:16px 0;">Даних ще немає</div>';
      midRow.appendChild(sec(pgHtml));

      // Джерела трафіку
      var sources = d.sources || [];
      var maxS = Math.max.apply(null, sources.map(function(s){return s.n||0;})) || 1;
      var totalSrc = sources.reduce(function(a,s){return a+(s.n||0);},0)||1;
      var SRC_ICONS = { direct:"🔗", google:"🔍", instagram:"📸", facebook:"👍", telegram:"✈️", other:"🌐" };
      var srcHtml = ttl("📡 Джерела трафіку (30 дн)");
      sources.forEach(function(s) {
        var pct = Math.round((s.n||0)/maxS*100);
        var share = Math.round((s.n||0)/totalSrc*100);
        var icon = SRC_ICONS[s.src] || "🌐";
        srcHtml += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">'+
          '<span style="font-size:1rem;width:20px;">'+icon+'</span>'+
          '<span style="font-size:.82rem;color:var(--cream);width:80px;flex-shrink:0;">'+s.src+'</span>'+
          '<div style="flex:1;background:rgba(46,61,34,.4);border-radius:4px;height:8px;">'+
          '<div style="width:'+pct+'%;height:100%;background:rgba(122,145,86,.7);border-radius:4px;"></div></div>'+
          '<span style="font-size:.72rem;color:var(--text-dim);width:46px;text-align:right;">'+s.n+' ('+share+'%)</span></div>';
      });
      if (!sources.length) srcHtml += '<div class="empty" style="padding:16px 0;">Даних ще немає</div>';
      midRow.appendChild(sec(srcHtml));
      main.appendChild(midRow);

      /* ---- Нижній рядок: пристрої + кліки + пік годин ---- */
      var botRow = document.createElement("div");
      botRow.style.cssText = "display:grid;grid-template-columns:1fr 1.2fr 1.4fr;gap:14px;margin-bottom:14px;";

      // Пристрої (donut-like)
      var devices = d.devices || [];
      var totalDev = devices.reduce(function(a,x){return a+(x.n||0);},0)||1;
      var devHtml = ttl("📱 Пристрої");
      var DEV_ICONS = { mobile:"📱", desktop:"🖥" };
      devices.forEach(function(dv) {
        var pct = Math.round((dv.n||0)/totalDev*100);
        devHtml += '<div style="margin-bottom:12px;">'+
          '<div style="display:flex;justify-content:space-between;margin-bottom:5px;">'+
          '<span style="font-size:.85rem;color:var(--cream);">'+(DEV_ICONS[dv.ua_type]||"💻")+' '+(dv.ua_type==="mobile"?"Мобільні":"Десктоп")+'</span>'+
          '<span style="font-size:.82rem;color:var(--olive-light);font-weight:600;">'+pct+'%</span></div>'+
          '<div style="background:rgba(46,61,34,.4);border-radius:6px;height:10px;">'+
          '<div style="width:'+pct+'%;height:100%;background:rgba(122,145,86,.'+(dv.ua_type==="mobile"?"8":"5")+');border-radius:6px;"></div></div>'+
          '<div style="font-size:.7rem;color:var(--text-dim);margin-top:3px;">'+dv.n+' сесій</div></div>';
      });
      if (!devices.length) devHtml += '<div class="empty" style="padding:16px 0;">—</div>';
      botRow.appendChild(sec(devHtml));

      // Топ кліків
      var clicks = d.clicks || [];
      var maxC = Math.max.apply(null, clicks.map(function(c){return c.n||0;})) || 1;
      var clkHtml = ttl("🖱 Кліки по CTA");
      clicks.forEach(function(c) {
        var pct = Math.round((c.n||0)/maxC*100);
        clkHtml += '<div style="margin-bottom:8px;">'+
          '<div style="display:flex;justify-content:space-between;margin-bottom:3px;">'+
          '<span style="font-size:.8rem;color:var(--cream);">'+(c.label||"—")+'</span>'+
          '<span style="font-size:.75rem;color:var(--olive-light);">'+c.n+'</span></div>'+
          '<div style="background:rgba(46,61,34,.4);border-radius:4px;height:6px;">'+
          '<div style="width:'+pct+'%;height:100%;background:rgba(122,145,86,.75);border-radius:4px;"></div></div></div>';
      });
      if (!clicks.length) clkHtml += '<div class="empty" style="padding:16px 0;">Кліків ще немає</div>';
      botRow.appendChild(sec(clkHtml));

      // Пік годин (тиждень)
      var byHour = d.by_hour || [];
      var maxH = Math.max.apply(null, byHour.map(function(x){return x.n||0;})) || 1;
      var hourHtml = ttl("🕐 Активність по годинах");
      hourHtml += '<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:3px;">';
      for (var hh=8;hh<=23;hh++){
        var hf=byHour.filter(function(x){return x.hour===hh;})[0];
        var hCnt=hf?hf.n:0;
        var al=0.07+hCnt/maxH*0.9;
        hourHtml+='<div style="background:rgba(122,145,86,'+al.toFixed(2)+');border-radius:5px;padding:5px 2px;text-align:center;" title="'+String(hh).padStart(2,"0")+':00 — '+hCnt+'">'+
          '<div style="font-size:.7rem;font-weight:600;color:var(--cream);">'+hCnt+'</div>'+
          '<div style="font-size:.58rem;color:rgba(212,207,198,.5);margin-top:1px;">'+String(hh).padStart(2,"0")+'</div></div>';
      }
      hourHtml += '</div>';
      hourHtml += '<div style="display:flex;align-items:center;gap:5px;margin-top:8px;font-size:.67rem;color:var(--text-dim);">'+
        '<span>Менше</span><div style="flex:1;height:4px;border-radius:2px;background:linear-gradient(to right,rgba(122,145,86,.07),rgba(122,145,86,.97));"></div><span>Більше</span></div>';
      botRow.appendChild(sec(hourHtml));
      main.appendChild(botRow);

      // Кнопка оновлення — додаємо після завантаження
      var refreshRow = document.createElement("div");
      refreshRow.style.cssText = "display:flex;justify-content:flex-end;margin-bottom:14px;";
      var refreshBtn = document.createElement("button");
      refreshBtn.id = "traffic-refresh";
      refreshBtn.className = "btn btn-ghost";
      refreshBtn.style.cssText = "font-size:.82rem;gap:6px;display:flex;align-items:center;";
      refreshBtn.innerHTML = "🔄 Оновити";
      refreshBtn.addEventListener("click", function() { load(); });
      refreshRow.appendChild(refreshBtn);
      main.insertBefore(refreshRow, main.firstChild);
    });
    }

    load();
  }

  /* ============================================================
     ВІДГУКИ (власник)
     ============================================================ */
  function renderReviews() {
    var main = $("main"); main.innerHTML = "";
    var bar = el("div","bar"); bar.appendChild(el("h2",null,"Відгуки клієнтів"));
    main.appendChild(bar);
    var listEl = el("div","list"); main.appendChild(listEl);
    listEl.innerHTML = '<div class="empty">Завантаження…</div>';
    api("GET","/api/crm/reviews").then(function(res) {
      var list = res.j.reviews || [];
      listEl.innerHTML = "";
      if (!list.length) { listEl.appendChild(el("div","empty","Відгуків ще немає")); return; }
      list.forEach(function(r) {
        var item = el("div","item");
        var row = el("div","row1");
        var stars = "★".repeat(r.rating) + "☆".repeat(5-r.rating);
        var info = el("div");
        info.appendChild(el("div","t", stars + "  " + (r.client_name||"Клієнт")));
        info.appendChild(el("div","sub", r.master_name + " · " + new Date(r.created_at).toLocaleDateString("uk-UA")));
        if (r.comment) info.appendChild(el("div","sub","💬 " + r.comment));
        row.appendChild(info);
        item.appendChild(row);
        listEl.appendChild(item);
      });
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
      api("GET", "/api/crm/masters").then(function (res) {
        var masters = res.j.masters || [];
        listEl.innerHTML = "";
        masters.forEach(function (m) {
          var item = el("div", "item"); var row = el("div", "row1");
          var info = el("div");
          var svcCount = (m.service_ids || []).length;
          info.appendChild(el("div", "t", m.name + (m.last_name ? " " + m.last_name : "")));
          info.appendChild(el("div", "sub", (m.level || "Майстер") + " · " + (m.phone || "—") + " · " + svcCount + " послуг"));
          row.appendChild(info); row.appendChild(el("span", "sp"));
          var prof = el("button", "btn btn-sm btn-ghost", "Профіль"); prof.addEventListener("click", function () { masterModal(m); });
          var sch = el("button", "btn btn-sm btn-ghost", "Графік"); sch.addEventListener("click", function () {
            var mastersTabIdx = TABS.findIndex(function(t){return t.id==="masters";});
            scheduleEditPage(m, todayStr(), "masters");
          });
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

  /* Послуги майстра більше не обираються вручну — прайс підставляється
     сервером за посадою (Майстер/Топ Майстер), див. autoAssignServicesByLevel
     у crm/routes.crm.js. Тут лишається тільки ім'я, прізвище, ім'я для
     додатку (публічне) і посада. */
  function masterModal(m) {
    openModal(
      '<h3>' + (m ? "Профіль майстра" : "Новий майстер") + '</h3>' +
      '<label>Ім\'я</label><input type="text" id="mmFirstName" maxlength="60" placeholder="Максим" />' +
      '<label>Прізвище</label><input type="text" id="mmLastName" maxlength="60" placeholder="необов\'язково" />' +
      '<label>Ім\'я для додатку</label><input type="text" id="mmDisplayName" maxlength="100" placeholder="Як бачитимуть клієнти" />' +
      '<label>Посада</label><select id="mmLevel"><option value="Майстер">Майстер</option><option value="Майстриня">Майстриня</option><option value="Топ Майстер">Топ Майстер</option></select>' +
      '<label>Телефон</label><input type="text" id="mmPhone" maxlength="30" />' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid #f0f2ee;margin-top:8px;">' +
        '<div><div style="font-size:.88rem;font-weight:600;color:#1a2016;">Бачити номери телефонів клієнтів</div>' +
        '<div style="font-size:.75rem;color:#6a7a60;">Майстер зможе бачити телефони у своїх записах</div></div>' +
        '<label style="position:relative;display:inline-flex;width:44px;height:24px;flex-shrink:0;">' +
          '<input type="checkbox" id="mmCanSeePhones" style="opacity:0;width:0;height:0;position:absolute;" />' +
          '<span id="mmCspTrack" style="position:absolute;inset:0;border-radius:12px;background:#ccc;transition:.2s;cursor:pointer;"></span>' +
          '<span id="mmCspThumb" style="position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.3);pointer-events:none;"></span>' +
        '</label>' +
      '</div>' +
      '<div class="err" id="mmErr"></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" id="mmCancel">Скасувати</button><button class="btn btn-primary" id="mmSave">Зберегти</button></div>'
    );
    if (m) {
      $("mmFirstName").value = m.name || "";
      $("mmLastName").value = m.last_name || "";
      $("mmDisplayName").value = m.name || "";
      $("mmLevel").value = m.level || "Майстер";
      $("mmPhone").value = m.phone || "";
      $("mmCanSeePhones").checked = !!m.can_see_phones;
      if (m.can_see_phones) { $("mmCspTrack").style.background = "#3d5430"; $("mmCspThumb").style.left = "23px"; }
    }
    $("mmCanSeePhones").addEventListener("change", function() {
      $("mmCspTrack").style.background = this.checked ? "#3d5430" : "#ccc";
      $("mmCspThumb").style.left = this.checked ? "23px" : "3px";
    });
    // Ім'я для додатку саме підтягується за ім'ям, поки його не зміняли вручну.
    var displayTouched = false;
    $("mmDisplayName").addEventListener("input", function () { displayTouched = true; });
    $("mmFirstName").addEventListener("input", function () {
      if (!displayTouched) $("mmDisplayName").value = $("mmFirstName").value;
    });
    $("mmCancel").addEventListener("click", closeModal);
    $("mmSave").addEventListener("click", function () {
      var firstName = $("mmFirstName").value.trim();
      var displayName = $("mmDisplayName").value.trim() || firstName;
      if (!firstName) { $("mmErr").textContent = "Вкажіть ім'я"; return; }
      var body = {
        name: displayName,
        last_name: $("mmLastName").value.trim(),
        level: $("mmLevel").value,
        phone: $("mmPhone").value.trim(),
        can_see_phones: $("mmCanSeePhones").checked ? 1 : 0
      };
      var p = m ? api("PUT", "/api/crm/masters/" + m.id, body) : api("POST", "/api/crm/masters", body);
      p.then(function (res) {
        if (!res.j.ok) { $("mmErr").textContent = "Помилка: " + (res.j.error || ""); return; }
        closeModal(); window.__reloadMasters();
      });
    });
  }

  function renderMasterProfile(masterId) {
    // Переходимо на вкладку Майстри (тільки owner)
    var idx = TABS.findIndex ? TABS.findIndex(function(t){ return t.id === "masters"; }) : -1;
    if (idx === -1) { for (var i=0;i<TABS.length;i++){ if(TABS[i].id==="masters"){idx=i;break;} } }
    if (idx === -1) return;
    var tabBtns = document.querySelectorAll(".tab");
    if (tabBtns[idx]) tabBtns[idx].click();
    // Після рендеру знаходимо картку майстра
    setTimeout(function() {
      var card = document.querySelector("[data-master-id='" + masterId + "']");
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
  }

  function scheduleModal(m) { scheduleEditPage(m, todayStr(), "masters"); }

  function scheduleEditPage(m, startDate, backTabId, defaultTab) {
    var main2 = $("main"); main2.innerHTML = "";
    var _topbarH = (document.querySelector(".topbar") || {offsetHeight:0}).offsetHeight || 0;
    main2.style.cssText = "padding:50px 0 0;";

    function toMin(v) { if (!v) return null; var p = v.split(":"); return parseInt(p[0],10)*60+parseInt(p[1],10); }

    // Header — position:fixed so iOS tap events always work
    var hdr = document.createElement("div");
    hdr.id = "scheEditHdr";
    hdr.style.cssText = "position:fixed;top:" + _topbarH + "px;left:0;right:0;display:flex;align-items:center;padding:10px 12px;background:#f0f2ed;border-bottom:1px solid #d8ddd4;gap:8px;z-index:25;";
    var backBtn = document.createElement("button");
    backBtn.innerHTML = "&#8249;";
    backBtn.style.cssText = "background:none;border:none;font-size:1.8rem;line-height:1;color:#1a2016;padding:8px 12px 8px 4px;cursor:pointer;flex-shrink:0;min-width:44px;min-height:44px;display:flex;align-items:center;";
    backBtn.onclick = function() {
      var os = document.getElementById("scheEditSave"); if (os) os.remove();
      var oh = document.getElementById("scheEditHdr"); if (oh) oh.remove();
      main2.style.cssText = "";
      main2.innerHTML = "";
      var targetId = backTabId || "grafik";
      var gi = TABS.findIndex(function(t){ return t.id === targetId; });
      if (gi < 0) gi = 0;
      var mBtns = document.getElementById("mob-nav").querySelectorAll(".mob-tab");
      if (mBtns[gi]) {
        mBtns[gi].click();
      } else {
        activateTab(gi);
      }
    };
    var hdrTitle = document.createElement("div");
    hdrTitle.textContent = "Налаштування графіку роботи";
    hdrTitle.style.cssText = "flex:1;font-size:.95rem;font-weight:600;color:#1a2016;text-align:center;";
    hdr.appendChild(backBtn); hdr.appendChild(hdrTitle);
    document.body.appendChild(hdr);

    // Master info
    var mInfo = document.createElement("div");
    mInfo.style.cssText = "display:flex;align-items:center;padding:14px 16px;gap:12px;border-bottom:1px solid #e8ece4;";
    var initials = (m.name||'?')[0].toUpperCase() + (m.last_name ? m.last_name[0].toUpperCase() : '');
    mInfo.innerHTML = (m.photo
      ? '<img src="' + m.photo + '" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid #8aA462;flex-shrink:0;" alt="">'
      : '<div style="width:48px;height:48px;border-radius:50%;background:#3d5430;color:#8aA462;display:flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:700;flex-shrink:0;">' + initials + '</div>') +
      '<div><div style="font-size:.95rem;font-weight:600;color:#1a2016;">' + (m.name||'') + (m.last_name ? ' '+m.last_name : '') + '</div>' +
      '<div style="font-size:.8rem;color:#6a7a60;">' + (m.level||'') + '</div></div>';
    main2.appendChild(mInfo);

    // Tab bar
    var tabBar = document.createElement("div");
    tabBar.style.cssText = "display:flex;border-bottom:1.5px solid #e8ece4;background:#fff;";
    var tWeekly = document.createElement("button");
    tWeekly.textContent = "ТИЖНЕВИЙ";
    tWeekly.style.cssText = "flex:1;padding:12px;background:none;border:none;border-bottom:2.5px solid #1a2016;font-size:.75rem;font-weight:700;letter-spacing:.05em;cursor:pointer;color:#1a2016;";
    var tDay = document.createElement("button");
    tDay.textContent = "НА ДЕНЬ";
    tDay.style.cssText = "flex:1;padding:12px;background:none;border:none;border-bottom:2.5px solid transparent;font-size:.75rem;font-weight:700;letter-spacing:.05em;cursor:pointer;color:#9aaa90;";
    var tPeriod = document.createElement("button");
    tPeriod.textContent = "НА ПЕРІОД";
    tPeriod.style.cssText = "flex:1;padding:12px;background:none;border:none;border-bottom:2.5px solid transparent;font-size:.75rem;font-weight:700;letter-spacing:.05em;cursor:pointer;color:#9aaa90;";
    tabBar.appendChild(tWeekly); tabBar.appendChild(tDay); tabBar.appendChild(tPeriod);
    main2.appendChild(tabBar);

    var content = document.createElement("div");
    content.style.cssText = "padding:18px 16px 120px;";
    main2.appendChild(content);

    var navEl2 = document.getElementById("mob-nav");
    var navH2 = navEl2 ? navEl2.offsetHeight : 56;

    function makeSaveBtn(label) {
      var btn = document.createElement("button");
      btn.textContent = label;
      btn.style.cssText = "position:fixed;bottom:" + (navH2 + 8) + "px;left:16px;right:16px;padding:16px;background:#1a2016;color:#fff;border:none;border-radius:16px;font-size:1rem;font-weight:600;cursor:pointer;z-index:20;transition:background .2s;";
      return btn;
    }

    // ── ТИЖНЕВИЙ ──────────────────────────────────────
    function renderWeeklyTab() {
      tWeekly.style.borderBottomColor = "#1a2016"; tWeekly.style.color = "#1a2016";
      tDay.style.borderBottomColor = "transparent"; tDay.style.color = "#9aaa90";
      tPeriod.style.borderBottomColor = "transparent"; tPeriod.style.color = "#9aaa90";
      var oldSave = document.getElementById("scheEditSave");
      if (oldSave) oldSave.remove();
      content.innerHTML = '<div style="color:#aaa;font-size:.85rem;padding:8px 0;">Завантаження…</div>';
      api("GET", "/api/crm/masters/" + m.id + "/schedule").then(function(r) {
        var existSched = r.j.schedule || [];
        content.innerHTML = "";
        var DOW_NAMES = ["Нд","Пн","Вт","Ср","Чт","Пт","Сб"];
        var schedRows = {};
        existSched.forEach(function(s) { schedRows[s.weekday] = { ws: fmtMin(s.work_start), we: fmtMin(s.work_end) }; });
        var infoLbl = document.createElement("div");
        infoLbl.textContent = "Базовий тижневий графік. Якщо поля порожні — вихідний.";
        infoLbl.style.cssText = "font-size:.75rem;color:#6a7a60;margin-bottom:14px;line-height:1.4;";
        content.appendChild(infoLbl);
        var schedGrid = document.createElement("div");
        schedGrid.style.cssText = "margin-bottom:24px;";
        [1,2,3,4,5,6,0].forEach(function(wd) {
          var row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;";
          var dowLbl = document.createElement("div");
          dowLbl.textContent = DOW_NAMES[wd];
          dowLbl.style.cssText = "width:28px;font-size:.8rem;color:#555;font-weight:600;flex-shrink:0;";
          var wsI = document.createElement("input"); wsI.type = "time"; wsI.value = (schedRows[wd] || {}).ws || "";
          wsI.style.cssText = "flex:1;padding:8px;border:1.5px solid #d8ddd4;border-radius:8px;font-size:.88rem;";
          var sep = document.createElement("span"); sep.textContent = "–"; sep.style.cssText = "color:#aaa;";
          var weI = document.createElement("input"); weI.type = "time"; weI.value = (schedRows[wd] || {}).we || "";
          weI.style.cssText = "flex:1;padding:8px;border:1.5px solid #d8ddd4;border-radius:8px;font-size:.88rem;";
          row.appendChild(dowLbl); row.appendChild(wsI); row.appendChild(sep); row.appendChild(weI);
          row.dataset.wd = wd;
          row._wsI = wsI; row._weI = weI;
          schedGrid.appendChild(row);
        });
        content.appendChild(schedGrid);
        var saveBtn = makeSaveBtn("Зберегти");
        saveBtn.id = "scheEditSave";
        document.body.appendChild(saveBtn);
        saveBtn.addEventListener("click", function() {
          var schedule = [];
          schedGrid.querySelectorAll("div[data-wd]").forEach(function(row3) {
            var wd2 = parseInt(row3.dataset.wd, 10);
            var ws2 = toMin(row3._wsI.value), we2 = toMin(row3._weI.value);
            if (ws2 != null && we2 != null && we2 > ws2) schedule.push({ weekday: wd2, work_start: ws2, work_end: we2 });
          });
          saveBtn.textContent = "Збереження…"; saveBtn.disabled = true;
          api("PUT", "/api/crm/masters/" + m.id + "/schedule", { schedule: schedule }).then(function(r2) {
            saveBtn.disabled = false;
            if (r2.j && r2.j.ok) {
              saveBtn.textContent = "Збережено ✓"; saveBtn.style.background = "#3d5430";
              setTimeout(function() { saveBtn.textContent = "Зберегти"; saveBtn.style.background = "#1a2016"; }, 1500);
            } else { saveBtn.textContent = "Помилка"; }
          });
        });
      });
    }

    // ── НА ДЕНЬ ──────────────────────────────────────
    var currentDate = startDate || todayStr();
    var dayStateArea;

    function renderDayTab() {
      tWeekly.style.borderBottomColor = "transparent"; tWeekly.style.color = "#9aaa90";
      tDay.style.borderBottomColor = "#1a2016"; tDay.style.color = "#1a2016";
      tPeriod.style.borderBottomColor = "transparent"; tPeriod.style.color = "#9aaa90";
      content.innerHTML = "";

      var dateLbl = document.createElement("div");
      dateLbl.style.cssText = "font-size:.75rem;color:#6a7a60;margin-bottom:4px;";
      dateLbl.textContent = "Дата";
      content.appendChild(dateLbl);

      var dateInput = document.createElement("input");
      dateInput.type = "date"; dateInput.value = currentDate;
      dateInput.style.cssText = "font-size:.92rem;padding:10px 12px;border:1.5px solid #d8ddd4;border-radius:10px;width:100%;box-sizing:border-box;margin-bottom:20px;";
      content.appendChild(dateInput);

      dayStateArea = document.createElement("div");
      content.appendChild(dayStateArea);

      function loadDay(date) {
        dayStateArea.innerHTML = '<div style="color:#aaa;font-size:.85rem;padding:8px 0;">Завантаження…</div>';
        api("GET", "/api/crm/masters/" + m.id + "/day-override?date=" + date).then(function(r) {
          renderDayState(date, r.j.override, r.j.weekly);
        });
      }

      function renderDayState(date, override, weekly) {
        // Remove old save btn if any
        var oldSave = document.getElementById("scheEditSave");
        if (oldSave) oldSave.remove();
        dayStateArea.innerHTML = "";

        var isOff  = override ? !!override.is_off : !weekly;
        var wStart = (override && !override.is_off) ? override.work_start : (weekly ? weekly.work_start : 540);
        var wEnd   = (override && !override.is_off) ? override.work_end   : (weekly ? weekly.work_end   : 1290);

        // Radio row
        var radioRow = document.createElement("div");
        radioRow.style.cssText = "display:flex;gap:20px;margin-bottom:20px;align-items:center;";

        function radioLabel(val, txt, checked) {
          var lbl = document.createElement("label");
          lbl.style.cssText = "display:flex;align-items:center;gap:10px;cursor:pointer;font-size:.9rem;color:#1a2016;";
          var rb = document.createElement("input"); rb.type = "radio"; rb.name = "seDay"; rb.value = val;
          rb.style.cssText = "width:20px;height:20px;accent-color:#3d5430;cursor:pointer;";
          if (checked) rb.checked = true;
          lbl.appendChild(rb); lbl.appendChild(document.createTextNode(txt));
          return { label: lbl, rb: rb };
        }
        var rWork = radioLabel("work", "Робочий день", !isOff);
        var rOff  = radioLabel("off",  "Вихідний день", isOff);
        rOff.label.style.color = "#6a7a60";
        radioRow.appendChild(rWork.label); radioRow.appendChild(rOff.label);
        dayStateArea.appendChild(radioRow);

        // Time block
        var timeBlock = document.createElement("div");
        timeBlock.style.cssText = "background:#f0f2ed;border-radius:14px;padding:16px 20px;display:flex;align-items:center;gap:10px;margin-bottom:16px;" + (isOff ? "opacity:.4;pointer-events:none;" : "");
        var wsL = document.createElement("span"); wsL.textContent = "з"; wsL.style.cssText = "font-size:.78rem;color:#6a7a60;";
        var wsI = document.createElement("input"); wsI.type = "time"; wsI.value = fmtMin(wStart);
        wsI.style.cssText = "font-size:1.25rem;font-weight:700;color:#1a2016;background:none;border:none;outline:none;min-width:80px;";
        var vSep = document.createElement("div"); vSep.style.cssText = "width:1px;height:28px;background:#d0d5cb;margin:0 6px;";
        var weL = document.createElement("span"); weL.textContent = "до"; weL.style.cssText = "font-size:.78rem;color:#6a7a60;";
        var weI = document.createElement("input"); weI.type = "time"; weI.value = fmtMin(wEnd);
        weI.style.cssText = "font-size:1.25rem;font-weight:700;color:#1a2016;background:none;border:none;outline:none;min-width:80px;";
        timeBlock.appendChild(wsL); timeBlock.appendChild(wsI);
        timeBlock.appendChild(vSep);
        timeBlock.appendChild(weL); timeBlock.appendChild(weI);
        dayStateArea.appendChild(timeBlock);

        function syncTimeBlock() {
          timeBlock.style.opacity = rOff.rb.checked ? ".4" : "1";
          timeBlock.style.pointerEvents = rOff.rb.checked ? "none" : "auto";
        }
        rWork.rb.addEventListener("change", syncTimeBlock);
        rOff.rb.addEventListener("change", syncTimeBlock);

        // Скинути до тижневого
        if (override) {
          var resetBtn = document.createElement("button");
          resetBtn.textContent = "Скинути до тижневого графіку";
          resetBtn.style.cssText = "background:none;border:1.5px solid #d8ddd4;color:#6a7a60;border-radius:10px;padding:8px 14px;font-size:.8rem;cursor:pointer;margin-bottom:10px;";
          resetBtn.addEventListener("click", function() {
            api("DELETE", "/api/crm/masters/" + m.id + "/day-override?date=" + date).then(function() { loadDay(date); });
          });
          dayStateArea.appendChild(resetBtn);
        }

        // Save btn
        var saveBtn = makeSaveBtn("Зберегти");
        saveBtn.id = "scheEditSave";
        document.body.appendChild(saveBtn);
        saveBtn.addEventListener("click", function() {
          var isOffNow = rOff.rb.checked;
          api("PUT", "/api/crm/masters/" + m.id + "/day-override", {
            date: date, is_off: isOffNow ? 1 : 0,
            work_start: isOffNow ? null : toMin(wsI.value),
            work_end:   isOffNow ? null : toMin(weI.value)
          }).then(function(r) {
            if (r.j && r.j.ok) {
              saveBtn.textContent = "Збережено ✓"; saveBtn.style.background = "#3d5430";
              setTimeout(function() { saveBtn.textContent = "Зберегти"; saveBtn.style.background = "#1a2016"; }, 1500);
            }
          });
        });
      }

      dateInput.addEventListener("change", function() { currentDate = dateInput.value; loadDay(currentDate); });
      loadDay(currentDate);
    }

    // ── НА ПЕРІОД ──────────────────────────────────────
    function renderPeriodTab() {
      tWeekly.style.borderBottomColor = "transparent"; tWeekly.style.color = "#9aaa90";
      tPeriod.style.borderBottomColor = "#1a2016"; tPeriod.style.color = "#1a2016";
      tDay.style.borderBottomColor = "transparent"; tDay.style.color = "#9aaa90";
      var oldSave2 = document.getElementById("scheEditSave");
      if (oldSave2) oldSave2.remove();
      content.innerHTML = "";

      var DOW2 = ["Нд","Пн","Вт","Ср","Чт","Пт","Сб"];
      var now2 = new Date();
      var mS = now2.getFullYear() + "-" + String(now2.getMonth()+1).padStart(2,"0") + "-01";
      var lastD = new Date(now2.getFullYear(), now2.getMonth()+1, 0);
      var mE = lastD.getFullYear() + "-" + String(lastD.getMonth()+1).padStart(2,"0") + "-" + String(lastD.getDate()).padStart(2,"0");

      // Date range
      var rngWrap = document.createElement("div");
      rngWrap.style.cssText = "background:#f0f2ed;border-radius:14px;padding:14px 18px;display:flex;align-items:center;gap:8px;margin-bottom:20px;";
      var rfL = document.createElement("span"); rfL.textContent = "з"; rfL.style.cssText = "font-size:.78rem;color:#6a7a60;";
      var rfI = document.createElement("input"); rfI.type = "date"; rfI.value = mS;
      rfI.style.cssText = "font-size:.95rem;font-weight:700;color:#1a2016;background:none;border:none;outline:none;";
      var reL = document.createElement("span"); reL.textContent = "до"; reL.style.cssText = "font-size:.78rem;color:#6a7a60;margin-left:8px;";
      var reI = document.createElement("input"); reI.type = "date"; reI.value = mE;
      reI.style.cssText = "font-size:.95rem;font-weight:700;color:#1a2016;background:none;border:none;outline:none;";
      rngWrap.appendChild(rfL); rngWrap.appendChild(rfI); rngWrap.appendChild(reL); rngWrap.appendChild(reI);
      content.appendChild(rngWrap);

      // Method
      var mthLbl = document.createElement("div"); mthLbl.textContent = "Виберіть спосіб";
      mthLbl.style.cssText = "font-size:.75rem;color:#6a7a60;margin-bottom:4px;";
      content.appendChild(mthLbl);
      var mSel = document.createElement("select");
      mSel.style.cssText = "width:100%;padding:10px 0;border:none;border-bottom:1.5px solid #d8ddd4;background:transparent;font-size:.9rem;color:#1a2016;margin-bottom:20px;-webkit-appearance:auto;";
      [
        { v:"by_weekday", t:"По днях тижня" },
        { v:"all_days",   t:"День за днем" },
        { v:"day_off",    t:"Скидання (зробити вихідний)" },
        { v:"reset",      t:"Скинути до тижневого графіку" }
      ].forEach(function(o) { var opt = document.createElement("option"); opt.value = o.v; opt.textContent = o.t; mSel.appendChild(opt); });
      content.appendChild(mSel);

      // Weekday pills
      var selDays = [1,2,3,4,5];
      var daysRow = document.createElement("div");
      daysRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;";
      for (var dw = 0; dw < 7; dw++) {
        (function(d) {
          var btn2 = document.createElement("button");
          btn2.textContent = DOW2[d];
          var sel2 = selDays.indexOf(d) !== -1;
          btn2.style.cssText = "width:40px;height:40px;border-radius:50%;border:1.5px solid " + (sel2 ? "#3d5430" : "#d8ddd4") + ";background:" + (sel2 ? "#3d5430" : "transparent") + ";color:" + (sel2 ? "#fff" : "#1a2016") + ";font-size:.82rem;font-weight:600;cursor:pointer;";
          btn2.addEventListener("click", function() {
            var ix = selDays.indexOf(d);
            if (ix !== -1) selDays.splice(ix, 1); else selDays.push(d);
            var s2 = selDays.indexOf(d) !== -1;
            btn2.style.background = s2 ? "#3d5430" : "transparent";
            btn2.style.color = s2 ? "#fff" : "#1a2016";
            btn2.style.borderColor = s2 ? "#3d5430" : "#d8ddd4";
          });
          daysRow.appendChild(btn2);
        })(dw);
      }
      content.appendChild(daysRow);

      // Time range
      var tBlk = document.createElement("div");
      tBlk.style.cssText = "background:#f0f2ed;border-radius:14px;padding:16px 20px;display:flex;align-items:center;gap:10px;margin-bottom:16px;";
      var wsL2 = document.createElement("span"); wsL2.textContent = "з"; wsL2.style.cssText = "font-size:.78rem;color:#6a7a60;";
      var wsI2 = document.createElement("input"); wsI2.type = "time"; wsI2.value = "09:00";
      wsI2.style.cssText = "font-size:1.25rem;font-weight:700;color:#1a2016;background:none;border:none;outline:none;min-width:80px;";
      var vS2 = document.createElement("div"); vS2.style.cssText = "width:1px;height:28px;background:#d0d5cb;margin:0 6px;";
      var weL2 = document.createElement("span"); weL2.textContent = "до"; weL2.style.cssText = "font-size:.78rem;color:#6a7a60;";
      var weI2 = document.createElement("input"); weI2.type = "time"; weI2.value = "21:00";
      weI2.style.cssText = "font-size:1.25rem;font-weight:700;color:#1a2016;background:none;border:none;outline:none;min-width:80px;";
      tBlk.appendChild(wsL2); tBlk.appendChild(wsI2); tBlk.appendChild(vS2); tBlk.appendChild(weL2); tBlk.appendChild(weI2);
      content.appendChild(tBlk);

      function syncModeUI() {
        var mode2 = mSel.value;
        daysRow.style.display = (mode2 === "by_weekday") ? "flex" : "none";
        tBlk.style.display = (mode2 === "day_off" || mode2 === "reset") ? "none" : "flex";
      }
      mSel.addEventListener("change", syncModeUI);
      syncModeUI();

      var saveBtn2 = makeSaveBtn("Зберегти");
      saveBtn2.id = "scheEditSave";
      document.body.appendChild(saveBtn2);
      saveBtn2.addEventListener("click", function() {
        var mode3 = mSel.value;
        saveBtn2.textContent = "Збереження…"; saveBtn2.disabled = true;
        api("POST", "/api/crm/masters/" + m.id + "/schedule-period", {
          date_from: rfI.value, date_to: reI.value, mode: mode3,
          weekdays: selDays,
          work_start: toMin(wsI2.value), work_end: toMin(weI2.value)
        }).then(function(r) {
          saveBtn2.disabled = false;
          if (r.j && r.j.ok) {
            saveBtn2.textContent = "Збережено ✓"; saveBtn2.style.background = "#3d5430";
            setTimeout(function() { saveBtn2.textContent = "Зберегти"; saveBtn2.style.background = "#1a2016"; }, 1800);
          } else { saveBtn2.textContent = "Помилка"; }
        });
      });
    }

    tWeekly.addEventListener("click", function() { var oldS = document.getElementById("scheEditSave"); if (oldS) oldS.remove(); renderWeeklyTab(); });
    tDay.addEventListener("click", function() { var oldS = document.getElementById("scheEditSave"); if (oldS) oldS.remove(); renderDayTab(); });
    tPeriod.addEventListener("click", function() { var oldS = document.getElementById("scheEditSave"); if (oldS) oldS.remove(); renderPeriodTab(); });

    if (defaultTab === "day") { renderDayTab(); }
    else if (defaultTab === "period") { renderPeriodTab(); }
    else { renderWeeklyTab(); }
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
        '<div class="pass-wrap"><input type="password" id="uPass" /><button type="button" class="pass-eye" id="uPassEye" title="Показати/сховати пароль"><svg id="uPassIcon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg></button></div>' +
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
        var icon = $("uPassIcon");
        icon.innerHTML = show
          ? '<path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a9.97 9.97 0 012.04-3.6m2.88-2.516A9.96 9.96 0 0112 5c4.477 0 8.268 2.943 9.542 7a9.97 9.97 0 01-1.372 2.607M15 12a3 3 0 11-4.243-4.243M3 3l18 18"/>'
          : '<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>';
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

    /* ── Push-сповіщення на телефон ── */
    var pushCard = el("div", "item"); pushCard.style.marginBottom = "16px";
    var pushTitle = el("div", "t"); pushTitle.textContent = "🔔 Push-сповіщення на телефон";
    pushCard.appendChild(pushTitle);
    var pushStatus = el("div", "sub"); pushStatus.style.margin = "6px 0 10px";
    pushCard.appendChild(pushStatus);
    var pushActs = el("div", "acts");

    // Кнопка підписки
    var subBtn = el("button", "btn btn-primary btn-sm", "Підписати цей пристрій");
    subBtn.addEventListener("click", function() {
      subBtn.disabled = true; subBtn.textContent = "…";
      if (!("Notification" in window) || !("PushManager" in window)) {
        pushStatus.textContent = "❌ Цей браузер не підтримує push"; subBtn.disabled = false; subBtn.textContent = "Підписати цей пристрій"; return;
      }
      Notification.requestPermission().then(function(p) {
        if (p !== "granted") { pushStatus.textContent = "❌ Дозвіл відхилено — дозвольте в налаштуваннях браузера"; subBtn.disabled = false; subBtn.textContent = "Підписати цей пристрій"; return; }
        subscribePush();
        setTimeout(function() { pushStatus.textContent = "✅ Підписку надіслано — натисніть «Тест» щоб перевірити"; subBtn.disabled = false; subBtn.textContent = "Підписати цей пристрій"; }, 2000);
      });
    });
    pushActs.appendChild(subBtn);

    // Кнопка тест
    var testBtn = el("button", "btn btn-ghost btn-sm", "📨 Надіслати тест");
    testBtn.addEventListener("click", function() {
      testBtn.disabled = true; testBtn.textContent = "Надсилаємо…";
      api("POST", "/api/push/test").then(function(r) {
        if (r.j.ok) {
          pushStatus.textContent = "✅ Тест надіслано на " + r.j.count + " пристрій(ів) — перевір телефон";
        } else if (r.j.error === "no_subscriptions") {
          pushStatus.textContent = "❌ Немає підписок — спочатку натисни «Підписати цей пристрій»";
        } else {
          pushStatus.textContent = "❌ Помилка: " + (r.j.error || "невідома");
        }
        testBtn.disabled = false; testBtn.textContent = "📨 Надіслати тест";
      });
    });
    pushActs.appendChild(testBtn);
    pushCard.appendChild(pushActs);
    main.appendChild(pushCard);

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
