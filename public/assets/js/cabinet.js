/* ============================================================
   cabinet.js — кабінет CRM Oliva (власник + майстер).
   Логіка вкладок, списків і модалок. Усі дані через /api/crm/*.
   ============================================================ */
(function () {
  "use strict";

  var ME = { role: null, masterId: null };
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
    ME.role = me.role; ME.masterId = me.masterId;
    $("login").style.display = "none";
    $("app").classList.add("on");
    $("roleTag").textContent = me.role === "owner" ? "Власник" : "Майстер";

    TABS = [];
    if (me.role === "owner") {
      TABS.push({ id: "dashboard", name: "📊 Дашборд", render: renderDashboard });
    }
    TABS.push({ id: "appts", name: "📅 Записи", render: renderAppts });
    TABS.push({ id: "clients", name: "Клієнти", render: renderClients });
    if (me.role === "owner") {
      TABS.push({ id: "analytics", name: "📈 Аналітика", render: renderAnalytics });
      TABS.push({ id: "traffic",   name: "🌐 Трафік",   render: renderTraffic });
      TABS.push({ id: "reviews",   name: "⭐ Відгуки",  render: renderReviews });
      TABS.push({ id: "services", name: "Послуги", render: renderServices });
      TABS.push({ id: "masters", name: "Майстри", render: renderMasters });
      TABS.push({ id: "users", name: "Доступи", render: renderUsers });
      TABS.push({ id: "notif", name: "Сповіщення", render: renderNotif });
    }
    /* ── Іконки і короткі назви для мобільного nav ── */
    var TAB_ICOS  = { dashboard:"📊", appts:"📅", clients:"👤", analytics:"📈", traffic:"🌐", reviews:"⭐", services:"💆", masters:"👥", users:"🔐", notif:"🔔" };
    var TAB_SHORT = { dashboard:"Дашборд", appts:"Записи", clients:"Клієнти", analytics:"Аналітика", traffic:"Трафік", reviews:"Відгуки", services:"Послуги", masters:"Майстри", users:"Доступи", notif:"Сповіщення" };
    var BOTTOM_COUNT = Math.min(3, TABS.length);
    var hasDrawer    = TABS.length > BOTTOM_COUNT;

    var tabsEl       = $("tabs");        tabsEl.innerHTML = "";
    var mobNav       = document.getElementById("mob-nav");       mobNav.innerHTML = "";
    var mobSheetList = document.getElementById("mob-sheet-list"); mobSheetList.innerHTML = "";
    var mobBackdrop  = document.getElementById("mob-backdrop");
    var mobSheet     = document.getElementById("mob-sheet");

    function clearOverlay() { var ov = document.getElementById("cal-overlay"); if (ov) ov.remove(); }
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

    var apptTabIdx = TABS.findIndex(function(t) { return t.id === "appts"; });
    activateTab(apptTabIdx >= 0 ? apptTabIdx : 0);
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
  var apptViewMode = "calendar"; // "list" | "calendar"

  function renderAppts() {
    var main = $("main"); main.innerHTML = "";
    var bar = el("div", "bar");
    bar.appendChild(el("h2", null, "Записи"));
    var dateInp = el("input"); dateInp.type = "date"; dateInp.value = apptDate;
    dateInp.addEventListener("change", function () { apptDate = dateInp.value; reloadView(); });
    bar.appendChild(dateInp);

    // Перемикач вигляду (список / календар)
    var viewToggle = el("button", "btn btn-ghost", apptViewMode === "calendar" ? "📋 Список" : "📅 Календар");
    viewToggle.addEventListener("click", function () {
      if (apptViewMode === "calendar") {
        // Прибрати overlay календаря якщо є
        var ov = document.getElementById("cal-overlay");
        if (ov) ov.remove();
      }
      apptViewMode = apptViewMode === "calendar" ? "list" : "calendar";
      viewToggle.textContent = apptViewMode === "calendar" ? "📋 Список" : "📅 Календар";
      reloadView();
    });
    bar.appendChild(viewToggle);

    var newBtn = el("button", "btn btn-primary", "+ Новий запис");
    newBtn.addEventListener("click", function () { apptModal(); });
    bar.appendChild(newBtn);
    main.appendChild(bar);

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
      if (apptViewMode === "calendar") {
        loadCalendar(activeMasterFilter);
      } else {
        loadAppts(activeMasterFilter);
      }
    }

    function loadAppts(masterId) {
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

    function loadCalendar(masterFilter) {
      contentEl.innerHTML = "";
      var HOUR_START = 8, HOUR_END = 22;
      var STEP = 10;           // хв на слот
      var SLOT_H = 20;         // px на 10-хв слот
      var TIME_COL_W = 44;     // px для колонки з часом
      var MASTER_COL_W = 150;  // мін. px на колонку майстра
      var HEADER_H = 66;       // px для рядка заголовка
      var TOTAL_MIN = (HOUR_END - HOUR_START) * 60;
      var TOTAL_H = (TOTAL_MIN / STEP) * SLOT_H;

      var old = document.getElementById("cal-overlay");
      if (old) old.remove();
      var navEl = document.getElementById("mob-nav");
      var navH = navEl ? Math.ceil(navEl.getBoundingClientRect().height) : 0;
      var contentTop = Math.round(contentEl.getBoundingClientRect().top);

      var overlay = document.createElement("div");
      overlay.id = "cal-overlay";
      overlay.style.cssText = "position:fixed;top:" + contentTop + "px;left:0;right:0;bottom:" + navH + "px;z-index:10;background:#f0f2ee;";
      document.body.appendChild(overlay);

      var wd = new Date(apptDate + "T00:00:00").getDay();
      var apptUrl = ME.role === "owner"
        ? "/api/crm/appointments?date=" + apptDate + (masterFilter ? "&master=" + masterFilter : "")
        : "/api/crm/schedule?date=" + apptDate;

      Promise.all([
        api("GET", "/api/crm/masters"),
        api("GET", apptUrl),
        api("GET", "/api/crm/day-schedules?weekday=" + wd),
        api("GET", "/api/crm/day-blocks?date=" + apptDate)
      ]).then(function(rs) {
        var allMasters = rs[0].j.masters || [];
        var appts = (rs[1].j.appointments || []).filter(function(a) { return a.status !== "cancelled"; });
        var dayScheds = rs[2].j.schedules || [];
        var dayBreaks = rs[2].j.breaks || [];
        var dayBlocksArr = (rs[3].j && rs[3].j.blocks) || [];

        var masters = masterFilter
          ? allMasters.filter(function(m) { return String(m.id) === String(masterFilter); })
          : allMasters;

        // schedMap[mid] = { ws, we, bks:[{s,e}] }
        var schedMap = {};
        dayScheds.forEach(function(s) { schedMap[s.master_id] = { ws: s.work_start, we: s.work_end, bks: [] }; });
        dayBreaks.forEach(function(b) { if (schedMap[b.master_id]) schedMap[b.master_id].bks.push({ s: b.break_start, e: b.break_end }); });

        // dayBlocksMap[mid] = [{id, start_min, end_min, note}]
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

        // Прокручуваний контейнер
        var scroller = document.createElement("div");
        scroller.style.cssText = "overflow-x:auto;overflow-y:auto;-webkit-overflow-scrolling:touch;height:100%;width:100%;";
        overlay.appendChild(scroller);

        var inner = document.createElement("div");
        inner.style.cssText = "display:inline-flex;flex-direction:column;min-width:" + (TIME_COL_W + masters.length * MASTER_COL_W) + "px;width:100%;";
        scroller.appendChild(inner);

        // ── Липкий заголовок ──
        var header = document.createElement("div");
        header.style.cssText = "display:flex;position:sticky;top:0;z-index:20;background:#ffffff;border-bottom:2px solid #d8ddd4;flex-shrink:0;";
        inner.appendChild(header);

        var corner = document.createElement("div");
        corner.style.cssText = "flex:0 0 " + TIME_COL_W + "px;height:" + HEADER_H + "px;border-right:1px solid #d8ddd4;background:#f8f8f6;";
        header.appendChild(corner);

        masters.forEach(function(m) {
          var hCell = document.createElement("div");
          hCell.style.cssText = "flex:1;min-width:" + MASTER_COL_W + "px;height:" + HEADER_H + "px;border-right:1px solid #d8ddd4;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px 4px;overflow:hidden;background:#fff;";
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

        // Колонка часу
        var tCol = document.createElement("div");
        tCol.style.cssText = "flex:0 0 " + TIME_COL_W + "px;border-right:1px solid #d8ddd4;position:relative;height:" + TOTAL_H + "px;background:#f8f8f6;";
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
          mCol.style.cssText = "flex:1;min-width:" + MASTER_COL_W + "px;border-right:1px solid #d8ddd4;position:relative;height:" + TOTAL_H + "px;background:#fff;";

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

          // Клік по колонці — контекстне меню
          mCol.addEventListener("click", function(e) {
            var oldCtx = document.getElementById("cal-ctx");
            if (oldCtx) { oldCtx.remove(); return; }
            var rect = mCol.getBoundingClientRect();
            var relMin = Math.floor((e.clientY - rect.top) / SLOT_H) * STEP;
            var clickAbsMin = HOUR_START * 60 + relMin;
            var unavail = isUnavail(master.id, clickAbsMin);

            var ctx = document.createElement("div");
            ctx.id = "cal-ctx";
            ctx.style.cssText = "position:fixed;left:" + (e.clientX + 8) + "px;top:" + (e.clientY - 10) + "px;" +
              "background:#fff;border:1px solid #d8ddd4;border-radius:10px;padding:6px;z-index:200;" +
              "box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:164px;";
            ctx.innerHTML =
              '<div style="font-size:.68rem;color:#888;padding:4px 8px 6px;border-bottom:1px solid #eee;font-weight:500;">' +
              fmtMin(clickAbsMin) + ' · ' + (master.name || '') + '</div>' +
              (!unavail ? '<button id="ctx-appt" style="display:block;width:100%;text-align:left;background:none;border:none;padding:7px 10px;font-size:.85rem;cursor:pointer;border-radius:6px;">📅 Новий запис</button>' : '') +
              '<button id="ctx-break" style="display:block;width:100%;text-align:left;background:none;border:none;padding:7px 10px;font-size:.85rem;cursor:pointer;border-radius:6px;">⏸ Перерва</button>';
            document.body.appendChild(ctx);

            var ctxR = ctx.getBoundingClientRect();
            if (ctxR.right > window.innerWidth - 8) ctx.style.left = (e.clientX - ctxR.width - 8) + "px";
            if (ctxR.bottom > window.innerHeight - 8) ctx.style.top = (e.clientY - ctxR.height + 10) + "px";

            function closeCtx() { var c = document.getElementById("cal-ctx"); if (c) c.remove(); }

            if (document.getElementById("ctx-appt")) {
              document.getElementById("ctx-appt").addEventListener("click", function() {
                closeCtx();
                apptModal({ prefill: { masterId: master.id, date: apptDate, startMin: clickAbsMin } });
              });
            }
            document.getElementById("ctx-break").addEventListener("click", function() {
              closeCtx();
              var endMin = Math.min(clickAbsMin + 60, HOUR_END * 60);
              var html = '<h3>⏸ Перерва — ' + (master.name || '') + '</h3>' +
                '<div class="grid2"><div><label>Від</label><input type="time" id="bkFrom" value="' + fmtMin(clickAbsMin) + '"></div>' +
                '<div><label>До</label><input type="time" id="bkTo" value="' + fmtMin(endMin) + '"></div></div>' +
                '<label style="margin-top:10px;display:block;">Нотатка</label>' +
                '<input type="text" id="bkNote" placeholder="Необов\'язково">' +
                '<div class="err" id="bkErr"></div>' +
                '<div class="modal-foot">' +
                '<button class="btn btn-primary" id="bkSave">Зберегти</button>' +
                '<button class="btn btn-ghost" id="bkClose">Скасувати</button></div>';
              openModal(html);
              $("bkSave").addEventListener("click", function() {
                var f = $("bkFrom").value.split(":"), t = $("bkTo").value.split(":");
                var sm = parseInt(f[0]) * 60 + parseInt(f[1]);
                var em = parseInt(t[0]) * 60 + parseInt(t[1]);
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
          });

          // Блоки записів
          appts.filter(function(a) { return a.master_id === master.id; }).forEach(function(a) {
            var startRel = a.start_min - HOUR_START * 60;
            if (startRel < 0 || startRel >= TOTAL_MIN) return;
            var topPx = (startRel / STEP) * SLOT_H + 1;
            var heightPx = Math.max((a.duration_min / STEP) * SLOT_H - 2, SLOT_H * 2 - 2);

            var markerHex = a.color_marker || DEFAULT_MARKER;
            var bgColor = markerHex + "22";
            var timeStr = fmtMin(a.start_min) + " – " + fmtMin(a.end_min || (a.start_min + a.duration_min));
            var svcName = (a.service_name||'').replace(/\s*\([^)]*\)\s*/g,'').trim();
            var hasNote = !!(a.comment && a.comment.trim());

            var block = document.createElement("div");
            block.style.cssText = "position:absolute;left:2px;right:2px;top:" + topPx + "px;height:" + heightPx + "px;" +
              "background:" + bgColor + ";border-left:3px solid " + markerHex + ";border-radius:5px;" +
              "padding:3px 5px 2px 4px;overflow:hidden;cursor:pointer;z-index:3;";

            var html = "";
            if (heightPx >= 22) {
              html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:2px;margin-bottom:1px;">' +
                '<span style="font-size:.58rem;font-weight:600;color:' + markerHex + ';white-space:nowrap;">' + timeStr + '</span>' +
                (hasNote ? '<span style="font-size:.58rem;opacity:.6;flex-shrink:0;line-height:1;">💬</span>' : '') +
                '</div>';
            }
            html += '<div style="font-size:.68rem;font-weight:600;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">' + a.client_name + '</div>';
            if (heightPx >= 44) html += '<div style="font-size:.58rem;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + svcName + '</div>';
            if (heightPx >= 60 && a.price) html += '<div style="font-size:.58rem;color:#666;margin-top:1px;">' + a.duration_min + ' хв · ' + Math.round(a.price/100) + ' ₴</div>';
            block.innerHTML = html;

            block.addEventListener("click", function(e) {
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
      var ov = document.getElementById("cal-overlay");
      if (ov) ov.remove();
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
      '<div class="sub">' + a.client_phone + '</div>' +
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

    // Оплата
    html += '<div style="margin-top:14px;"><label style="font-size:.78rem;color:var(--text-dim);">Оплата</label>' +
      '<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">' +
      '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:.88rem;"><input type="checkbox" id="dPaid"' + (a.paid ? ' checked' : '') + '> Оплачено</label>' +
      '<select id="dPayMethod" style="flex:1;min-width:100px;">' +
      '<option value="">Спосіб</option>' +
      ['Готівка','Картка','Переказ'].map(function(m) { return '<option value="'+m+'"'+(a.pay_method===m?' selected':'')+'>'+m+'</option>'; }).join('') +
      '</select></div></div>';

    html += '<div class="err" id="dErr"></div><div class="modal-foot">';

    if (a.status === "pending") html += '<button class="btn btn-primary btn-sm" id="dConfirm">Підтвердити</button>';
    if (a.status === "pending" || a.status === "confirmed") {
      html += '<button class="btn btn-ghost btn-sm" id="dComplete">Завершити</button>';
      html += '<button class="btn btn-ghost btn-sm" id="dNoShow">Не прийшов</button>';
      html += '<button class="btn btn-ghost btn-sm" id="dCancel">Скасувати</button>';
    }
    html += '<button class="btn btn-ghost" id="dClose">Закрити</button></div>';

    openModal(html);

    $("dMarkerWrap").appendChild(markerPicker(a.color_marker || null, function(c) {
      api("PATCH", "/api/crm/appointments/" + a.id + "/color-marker", { color_marker: c });
      a.color_marker = c;
    }));

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
      '<label>Послуга</label><select id="mService"></select>' +
      '<label>Майстер</label><select id="mMaster"></select>' +
      '<label>Дата</label><input type="date" id="mDate" />' +
      '<label>Вільний час</label><div id="mSlots" class="muted">Оберіть послугу, майстра й дату</div>' +
      '<div class="grid2"><div><label>Ім\'я</label><input type="text" id="mName" placeholder="Олена" maxlength="60"/></div>' +
      '<div><label>Прізвище</label><input type="text" id="mSurname" placeholder="Коваленко" maxlength="60"/></div></div>' +
      '<div><label>Телефон</label><input type="tel" id="mPhone" maxlength="30"/></div>' +
      '<label>Коментар</label><textarea id="mComment" maxlength="500"></textarea>' +
      '<label>Колір маркеру</label><div id="mMarkerWrap"></div>' +
      '<div class="err" id="mErr"></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" id="mCancel">Скасувати</button>' +
      '<button class="btn btn-primary" id="mSave">Створити</button></div>'
    );
    var chosen = { start_min: null, color_marker: null };
    $("mCancel").addEventListener("click", closeModal);
    $("mMarkerWrap").appendChild(markerPicker(null, function(c) { chosen.color_marker = c; }));
    $("mDate").value = prefill.date || apptDate; $("mDate").min = todayStr();
    if (prefill.clientName) {
      var parts = prefill.clientName.split(" ");
      $("mName").value = parts[0] || "";
      $("mSurname").value = parts.slice(1).join(" ") || "";
    }
    if (prefill.clientPhone) $("mPhone").value = prefill.clientPhone;

    // послуги
    api("GET", "/api/crm/services").then(function (res) {
      var sel = $("mService");
      (res.j.services || []).forEach(function (s) {
        var o = new Option(s.name + " (" + s.duration_min + " хв)", s.id); o.dataset.dur = s.duration_min; sel.appendChild(o);
      });
      if (prefill.serviceId) sel.value = prefill.serviceId;
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
        if (prefill.masterId) sel.value = String(prefill.masterId);
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
      /* Клік по клітинці календаря передає бажаний час одноразово — після
         першого рендера слотів прибираємо, щоб зміна послуги/дати вручну
         не продовжувала мовчки тягнути за собою старий вибір. */
      var wantStartMin = prefill.startMin;
      prefill.startMin = null;
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
          if (wantStartMin != null && s.start_min === wantStartMin) c.click();
        });
        box.appendChild(grid);
      });
    }

    $("mSave").addEventListener("click", function () {
      var err = $("mErr"); err.textContent = "";
      if (chosen.start_min == null) { err.textContent = "Оберіть час"; return; }
      var firstName = $("mName").value.trim();
      var lastName  = $("mSurname").value.trim();
      if (!firstName || $("mPhone").value.replace(/\D/g, "").length < 9) { err.textContent = "Вкажіть ім'я і телефон"; return; }
      var fullName = lastName ? firstName + " " + lastName : firstName;
      var url = ME.role === "owner" ? "/api/crm/appointments" : "/api/crm/me/appointments";
      api("POST", url, {
        service: $("mService").value, master: $("mMaster").value, date: $("mDate").value,
        start_min: chosen.start_min, name: fullName, phone: $("mPhone").value.trim(),
        comment: $("mComment").value.trim(), color_marker: chosen.color_marker || null
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
          masterId:  lastCompleted ? lastCompleted.master_id  : undefined
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
      '<div class="err" id="mmErr"></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" id="mmCancel">Скасувати</button><button class="btn btn-primary" id="mmSave">Зберегти</button></div>'
    );
    if (m) {
      $("mmFirstName").value = m.name || "";
      $("mmLastName").value = m.last_name || "";
      $("mmDisplayName").value = m.name || "";
      $("mmLevel").value = m.level || "Майстер";
      $("mmPhone").value = m.phone || "";
    }
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
        phone: $("mmPhone").value.trim()
      };
      var p = m ? api("PUT", "/api/crm/masters/" + m.id, body) : api("POST", "/api/crm/masters", body);
      p.then(function (res) {
        if (!res.j.ok) { $("mmErr").textContent = "Помилка: " + (res.j.error || ""); return; }
        closeModal(); window.__reloadMasters();
      });
    });
  }

  function scheduleModal(m) {
    openModal('<h3>Графік: ' + m.name + '</h3><div id="schBody" class="muted">Завантаження…</div>', true);
    api("GET", "/api/crm/masters/" + m.id + "/schedule").then(function (res) {
      var sched = {}, brk = {};
      (res.j.schedule || []).forEach(function (r) { sched[r.weekday] = r; });
      (res.j.breaks || []).forEach(function (r) { brk[r.weekday] = r; }); // одна перерва/день у UI
      var box = $("schBody"); box.className = "sched-grid"; box.innerHTML = "";
      box.appendChild(el("div", "muted", "Порожні поля = вихідний."));
      var rows = [];
      for (var wd = 1; wd <= 6; wd++) rows.push(wd); rows.push(0);
      rows.forEach(function (wd) {
        var hasDay = !!sched[wd];
        var r = el("div", "sched-row" + (hasDay ? "" : " day-off"));
        r.appendChild(el("span", "wd", DOW[wd]));

        var ws = el("input"); ws.type = "time"; ws.dataset.wd = wd; ws.dataset.k = "ws";
        var we = el("input"); we.type = "time"; we.dataset.wd = wd; we.dataset.k = "we";
        if (sched[wd]) { ws.value = fmtMin(sched[wd].work_start); we.value = fmtMin(sched[wd].work_end); }

        var workGroup = el("div", "sched-group");
        workGroup.appendChild(ws);
        workGroup.appendChild(el("span", "sched-sep", "–"));
        workGroup.appendChild(we);
        r.appendChild(workGroup);

        var bs = el("input"); bs.type = "time"; bs.dataset.wd = wd; bs.dataset.k = "bs";
        var be = el("input"); be.type = "time"; be.dataset.wd = wd; be.dataset.k = "be";
        if (brk[wd]) { bs.value = fmtMin(brk[wd].break_start); be.value = fmtMin(brk[wd].break_end); }

        var breakGroup = el("div", "sched-group");
        breakGroup.appendChild(el("span", "sched-lbl", "перерва"));
        breakGroup.appendChild(bs);
        breakGroup.appendChild(el("span", "sched-sep", "–"));
        breakGroup.appendChild(be);
        r.appendChild(breakGroup);

        function refreshDayOff() { r.className = "sched-row" + (ws.value || we.value ? "" : " day-off"); }
        ws.addEventListener("change", refreshDayOff); we.addEventListener("change", refreshDayOff);

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
