/* ============================================================
   cabinet.js — кабінет CRM Oliva (власник + майстер).
   Логіка вкладок, списків і модалок. Усі дані через /api/crm/*.
   ============================================================ */
(function () {
  "use strict";

  var ME = { role: null, masterId: null, can_see_phones: false };
  var DOW = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  var STATUS_LABEL = { pending: "Очікує", confirmed: "✓ Підтверджено", completed: "Завершено", cancelled: "Скасовано", no_show: "Не прийшов" };
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

  /* ---------- бейдж "непереглянуті" на вкладці "Події" ----------
     Локально на пристрої (localStorage): позначка "коли востаннє
     відкривали Події" — усе, що з'явилось (created_at) після неї,
     рахується непереглянутим. Окремий ключ на власника й на кожного
     майстра, щоб один спільний браузер (якщо таке буває) не плутав. */
  function podiiSeenKey() {
    return "oliva_podii_seen_" + (ME.role === "owner" ? "owner" : ("m" + ME.masterId));
  }
  function getPodiiSeenTs() {
    return parseInt(localStorage.getItem(podiiSeenKey()), 10) || 0;
  }
  function setPodiiBadge(n) {
    ["tabBadge-podii", "mobBadge-podii"].forEach(function (id) {
      var b = $(id); if (!b) return;
      if (n > 0) { b.textContent = n > 99 ? "99+" : String(n); b.style.display = "inline-flex"; }
      else b.style.display = "none";
    });
  }
  function markPodiiSeen() {
    localStorage.setItem(podiiSeenKey(), String(Date.now()));
    setPodiiBadge(0);
  }
  function refreshPodiiBadge() {
    if (!ME.role) return;
    var url = ME.role === "owner" ? "/api/crm/appointments?from=" + todayStr() : "/api/crm/me/appointments?from=" + todayStr();
    var seenTs = getPodiiSeenTs();
    api("GET", url).then(function (res) {
      var n = (res.j.appointments || []).filter(function (a) {
        return (a.status === "pending" || a.status === "confirmed") && (a.created_at || 0) > seenTs;
      }).length;
      setPodiiBadge(n);
    });
  }
  function money(kop) { return kop ? (kop / 100).toFixed(0) + " грн" : "—"; }
  // Знижка на абонемент залежно від к-ті сеансів: 5 → 5%, 10 → 10%, 15 → 13%.
  // Для проміжних значень береться найближчий нижній поріг.
  function subDiscountPct(n) {
    n = parseInt(n, 10) || 0;
    if (n >= 15) return 13;
    if (n >= 10) return 10;
    if (n >= 5)  return 5;
    return 0;
  }
  // Розрахунок суми абонемента в гривнях: ціна(грн) × сеанси × (1 − знижка).
  function subTotalUAH(priceUAH, sessions) {
    var d = subDiscountPct(sessions);
    return Math.round((priceUAH || 0) * (sessions || 0) * (1 - d / 100));
  }
  // Формат числа з пробілами між тисячами: 10800 → "10 800".
  function uahGroup(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  function fmtMin(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  function ddmm(d) { var p = d.split("-"); return p[2] + "." + p[1]; }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function dowOf(d) { return DOW[new Date(d + "T00:00:00").getDay()]; }
  function serviceMatchesMasterLevel(service, master) {
    var name = String((service && service.name) || "");
    var level = String((master && master.level) || "");
    var isTop = name.indexOf("(Топ Майстер)") !== -1;
    var isMaster = name.indexOf("(Майстер)") !== -1 && !isTop;
    if (!isTop && !isMaster) return true; // послуга без прив'язки до рівня
    return isTop ? level === "Топ Майстер" : level === "Майстер";
  }

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
  var topbarResizeObserver = null;

  function syncPinnedTopbar() {
    var topbar = document.querySelector(".topbar");
    if (!topbar) return;
    var height = Math.ceil(topbar.getBoundingClientRect().height);
    if (height > 0) document.documentElement.style.setProperty("--crm-topbar-h", height + "px");

    // Якщо календар уже відкритий, тримаємо його рівно під панеллю фільтрів.
    var overlay = document.getElementById("cal-overlay");
    var apptContent = document.getElementById("apptContent");
    if (overlay && apptContent) overlay.style.top = Math.ceil(apptContent.getBoundingClientRect().top) + "px";
  }

  function boot(me) {
    ME.role = me.role; ME.masterId = me.masterId; ME.can_see_phones = !!me.can_see_phones;
    $("login").style.display = "none";
    $("app").classList.add("on");
    $("roleTag").textContent = me.role === "owner" ? "Власник" : "Майстер";

    TABS = [];
    TABS.push({ id: "podii",    name: "📌 Події",         render: renderEventsTab });
    TABS.push({ id: "zapysy",   name: "📋 Записи",        render: renderZapysyTab });
    TABS.push({ id: "rozklad",  name: "📅 Розклад",       render: renderRozkladTab });
    TABS.push({ id: "grafik",   name: "🗓 Графік роботи", render: renderScheduleTab });
    TABS.push({ id: "clients",  name: "Клієнти",          render: renderClients });
    if (me.role === "owner") {
      TABS.push({ id: "dashboard", name: "📊 Дашборд",  render: renderDashboard });
      TABS.push({ id: "analytics", name: "📈 Аналітика", render: renderAnalytics });
      TABS.push({ id: "traffic",   name: "🌐 Трафік",   render: renderTraffic });
      TABS.push({ id: "reviews",   name: "⭐ Відгуки",  render: renderReviews });
      TABS.push({ id: "services",  name: "Послуги",     render: renderServices });
      TABS.push({ id: "masters",   name: "Майстри",     render: renderMasters });
      TABS.push({ id: "users",     name: "Доступи",     render: renderUsers });
      TABS.push({ id: "notif",     name: "Сповіщення",  render: renderNotif });
      TABS.push({ id: "broadcast", name: "📣 Розсилка", render: renderBroadcast });
      TABS.push({ id: "filiyi",    name: "🏢 Філії",    render: renderBranchesTab });
    }
    /* ── Іконки і короткі назви для мобільного nav ── */
    var TAB_ICOS  = { dashboard:"📊", podii:"📌", zapysy:"📋", rozklad:"📅", grafik:"🗓", clients:"👤", analytics:"📈", traffic:"🌐", reviews:"⭐", services:"💆", masters:"👥", users:"🔐", notif:"🔔", broadcast:"📣", filiyi:"🏢" };
    var TAB_SHORT = { dashboard:"Дашборд", podii:"Події", zapysy:"Записи", rozklad:"Розклад", grafik:"Графік", clients:"Клієнти", analytics:"Аналітика", traffic:"Трафік", reviews:"Відгуки", services:"Послуги", masters:"Майстри", users:"Доступи", notif:"Сповіщення", broadcast:"Розсилка", filiyi:"Філії" };
    var BOTTOM_COUNT = Math.min(4, TABS.length);
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
    var badgeHtml = '<span id="tabBadge-podii" style="display:none;margin-left:5px;background:#c0392b;color:#fff;font-size:.68rem;font-weight:700;border-radius:10px;padding:1px 6px;line-height:1.4;"></span>';
    TABS.forEach(function(t, i) {
      var b = document.createElement("button");
      b.className = "tab" + (i === 0 ? " on" : "");
      b.innerHTML = t.name + (t.id === "podii" ? badgeHtml : "");
      b.addEventListener("click", function() { activateTab(i); });
      tabsEl.appendChild(b);
    });

    /* Мобільна нижня панель — перші BOTTOM_COUNT вкладок */
    var mobBadgeHtml = '<span id="mobBadge-podii" style="display:none;position:absolute;top:2px;right:calc(50% - 22px);background:#c0392b;color:#fff;font-size:.62rem;font-weight:700;border-radius:9px;padding:1px 5px;line-height:1.4;"></span>';
    TABS.slice(0, BOTTOM_COUNT).forEach(function(t, i) {
      var b = document.createElement("button");
      b.className = "mob-tab" + (i === 0 ? " on" : "");
      b.style.position = "relative";
      b.innerHTML = '<span class="mico">' + (TAB_ICOS[t.id] || "📋") + '</span><span>' + (TAB_SHORT[t.id] || t.name) + '</span>' + (t.id === "podii" ? mobBadgeHtml : "");
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

    syncPinnedTopbar();
    if (window.ResizeObserver && !topbarResizeObserver) {
      topbarResizeObserver = new ResizeObserver(syncPinnedTopbar);
      topbarResizeObserver.observe(document.querySelector(".topbar"));
    }
    window.addEventListener("resize", syncPinnedTopbar);

    var rozkladIdx = TABS.findIndex(function(t) { return t.id === "rozklad"; });
    activateTab(rozkladIdx >= 0 ? rozkladIdx : 0);
    openAppointmentFromNotification();
    initPush();     // тост або тиха підписка
    refreshPodiiBadge();
    // Авто-оновлення коли повертаємось у додаток (напр. із фону)
    document.addEventListener("visibilitychange", function() {
      if (!document.hidden) {
        if (window.__reloadAppts) { try { window.__reloadAppts(); } catch(e) {} }
        refreshPodiiBadge();
      }
    });
  }

  /* Прямий перехід із push: /cabinet?appointment=123. Дані беремо
     окремим захищеним запитом, тому картка відкривається незалежно від
     поточного дня/тижня та вибраного у розкладі майстра. */
  function openAppointmentFromNotification() {
    var params = new URLSearchParams(window.location.search);
    var appointmentId = parseInt(params.get("appointment"), 10);
    if (!appointmentId) return;

    api("GET", "/api/crm/appointments/" + appointmentId).then(function(res) {
      if (!res.j || !res.j.ok || !res.j.appointment) return;
      var a = res.j.appointment;
      if (a.date) apptDate = a.date;
      window.apptDetailModal(a);

      // Картку вже відкрито — прибираємо службовий параметр, щоб звичайне
      // оновлення сторінки не відкривало її повторно.
      params.delete("appointment");
      var query = params.toString();
      history.replaceState(null, "", window.location.pathname + (query ? "?" + query : ""));
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
      var apptCard = card("1. Записи", "");
      apptCard.querySelector("div:last-child").appendChild(s1);
      /* Підпис обов'язковий: цей ряд рахується за місяць, а стоїть одразу
         під рядом Сьогодні/Тиждень/Місяць — без нього читається як «сьогодні». */
      var stHead = el("div", ""); stHead.style.cssText = "font-size:.78rem;color:var(--text-dim);margin:4px 0 6px;";
      stHead.textContent = "Статуси за місяць";
      apptCard.querySelector("div:last-child").appendChild(stHead);
      apptCard.querySelector("div:last-child").appendChild(s2);
      main.appendChild(apptCard);

      /* ---- 2. Детальна аналітика ---- */
      var da = d.detailed || {};
      function daTile(emoji, label, value, sub, accent) {
        return '<div style="background:rgba(46,61,34,.14);border:1px solid var(--line);border-radius:12px;padding:12px;">' +
          '<div style="font-size:.72rem;color:var(--text-dim);margin-bottom:6px;line-height:1.25;min-height:2.5em;">' + emoji + ' ' + label + '</div>' +
          '<div style="color:' + (accent || 'var(--cream)') + ';font-weight:700;font-size:1.3rem;line-height:1;">' + value + '</div>' +
          (sub ? '<div style="font-size:.66rem;color:var(--text-dim);margin-top:5px;">' + sub + '</div>' : '') +
        '</div>';
      }
      function daValPct(n, p) {
        return n + (p != null ? ' <span style="font-size:.8rem;color:var(--olive-light);font-weight:600;">(' + p + '%)</span>' : '');
      }
      /* Та сама сітка використовується і в картці кожного майстра (розділ 3),
         тому база для відсотків підписується параметром: у салону це всі
         клієнти, у майстра — тільки його власні. */
      function daGridHtml(x, pctBase) {
        x = x || {};
        return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          daTile('👤', 'Нові клієнти', (x.new_clients || 0), 'за 30 днів') +
          daTile('🔁', 'Повернулися за 30 днів', daValPct(x.returned_30d || 0, x.returned_30d_pct), pctBase) +
          daTile('✅', 'Повернулися взагалі', daValPct(x.returned_ever || 0, x.returned_ever_pct), pctBase) +
          daTile('❌', 'Втрачені', (x.lost || 0), 'не були 60+ днів', 'var(--err)') +
          daTile('⭐', 'Середня оцінка', (x.avg_rating != null ? Number(x.avg_rating).toFixed(2) : '—'), ((x.reviews_count || 0) + ' відгуків')) +
          daTile('❌', 'Скасування', (x.cancellations_30d || 0), 'за 30 днів', 'var(--err)') +
          '</div>';
      }
      main.appendChild(card("2. Детальна аналітика", daGridHtml(da, '% від усіх клієнтів')));

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
          '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:9px;">' +
            cell("Записів", m.bookings || 0) +
            cell("Дохід", grn(m.revenue)) +
            cell("Заробіток майстра", grn(m.earnings)) +
            cell("Вільно сьогодні", free) +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span style="font-size:.7rem;color:var(--text-dim);flex-shrink:0;">Завант.</span>' +
            '<div style="flex:1;background:rgba(46,61,34,.35);border-radius:4px;height:6px;overflow:hidden;">' +
              '<div style="background:var(--olive-light);height:100%;width:' + pct + '%"></div>' +
            '</div>' +
            '<span style="font-size:.75rem;color:var(--cream);flex-shrink:0;">' + pct + '%</span>' +
          '</div>' +
          /* Розкривний блок, а не одразу видима сітка: шість плиток × кожен
             майстер перетворили б дашборд на нескінченну прокрутку. */
          '<details class="da-more" style="margin-top:10px;">' +
            '<summary style="cursor:pointer;font-size:.75rem;color:var(--olive-light);">📈 Детальна аналітика <span class="da-caret">▾</span></summary>' +
            '<div style="margin-top:9px;">' +
              daGridHtml(m.detailed, '% від клієнтів майстра') +
              '<div style="font-size:.66rem;color:var(--text-dim);margin-top:7px;">Клієнтів у майстра: ' + ((m.detailed || {}).base_clients || 0) + '</div>' +
            '</div>' +
          '</details>' +
        '</div>';
      }).join("");
      main.appendChild(card("3. Майстри (місяць)", mHtml));

      /* ---- 4. Клієнти ---- */
      var cl = d.clients;
      var c1 = row3([
        { label: "Всього",          val: cl.total || 0 },
        { label: "Нових (місяць)",  val: cl.new_month || 0 },
        { label: "Повторних",       val: cl.returning_total || 0 },
      ]);
      var topRows = (cl.top||[]).map(function(c,i) {
        return ["#"+(i+1), c.name, c.phone || "—", c.visit_count + " візитів"];
      });
      var inactiveRows = (cl.inactive||[]).map(function(c) {
        var days = c.last_visit_at ? Math.round((Date.now()-c.last_visit_at)/86400000) : "?";
        return [c.name, c.phone || "—", days + " дн. тому"];
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
  var nowLineTimer = null; // інтервал оновлення лінії поточного часу
  /* Поза loadCalendar() — інакше кожен виклик loadCalendar() (у т.ч. з
     самого перемикання тижня колесом) створював би нову змінну cooldown,
     і серія wheel-подій одного руху трекпада перескакувала б одразу
     через кілька тижнів замість одного. */
  var calWheelBusy = false;

  var MONTH_UA = ["Січень","Лютий","Березень","Квітень","Травень","Червень","Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"];
  var DOW_UA = ["Пн","Вт","Ср","Чт","Пт","Сб","Нд"];

  // ── Вкладка "Події" — плоский список актуальних (pending/confirmed)
  //    записів, без прив'язки до конкретного дня. Майстер бачить лише
  //    свої (через /me/appointments без явного master= — сервер сам
  //    підставляє session.masterId), власник — усіх, з фільтром.
  function renderEventsTab() {
    markPodiiSeen();
    var main = $("main"); main.innerHTML = "";
    var bar = el("div", "bar");
    bar.appendChild(el("h2", null, "Події"));
    main.appendChild(bar);

    var filterWrap = el("div", "bar");
    filterWrap.style.flexWrap = "nowrap";
    var masterSel = null;
    if (ME.role === "owner") {
      masterSel = document.createElement("select");
      masterSel.style.cssText = "flex:1;";
      var optAll = document.createElement("option");
      optAll.value = ""; optAll.textContent = "Усі майстри";
      masterSel.appendChild(optAll);
      api("GET", "/api/crm/masters").then(function (res) {
        (res.j.masters || []).forEach(function (m) {
          var o = document.createElement("option");
          o.value = m.id; o.textContent = m.name;
          masterSel.appendChild(o);
        });
      });
      masterSel.addEventListener("change", load);
      filterWrap.appendChild(masterSel);
      main.appendChild(filterWrap);
    }

    var listEl = el("div", "list"); main.appendChild(listEl);
    var M_UA = ["січня","лютого","березня","квітня","травня","червня","липня","серпня","вересня","жовтня","листопада","грудня"];

    function load() {
      listEl.innerHTML = '<div class="empty">Завантаження…</div>';
      var url = ME.role === "owner"
        ? "/api/crm/appointments?from=" + todayStr() + (masterSel && masterSel.value ? "&master=" + masterSel.value : "")
        : "/api/crm/me/appointments?from=" + todayStr();
      api("GET", url).then(function (res) {
        var list = (res.j.appointments || []).filter(function (a) {
          return a.status === "pending" || a.status === "confirmed";
        }).sort(function (a, b) {
          if (a.date !== b.date) return a.date < b.date ? -1 : 1;
          return a.start_min - b.start_min;
        });
        listEl.innerHTML = "";
        if (!list.length) { listEl.appendChild(el("div", "empty", "Актуальних записів немає")); return; }
        var curDate = null, today3 = todayStr();
        list.forEach(function (a) {
          if (a.date !== curDate) {
            curDate = a.date;
            var d = new Date(a.date + "T00:00:00");
            var hdr = el("div", null, d.getDate() + " " + M_UA[d.getMonth()] + (a.date === today3 ? " · сьогодні" : ""));
            hdr.style.cssText = "font-size:.72rem;font-weight:700;color:var(--text-dim);letter-spacing:.06em;text-transform:uppercase;margin:14px 0 6px;";
            listEl.appendChild(hdr);
          }
          var item = el("div", "item");
          item.style.cursor = "pointer";
          item.addEventListener("click", (function (appt) { return function () { window.apptDetailModal(appt); }; })(a));
          var row = el("div", "row1");
          row.style.cssText = "display:flex;align-items:center;gap:10px;";
          var timeSpan = el("div", null, fmtMin(a.start_min));
          timeSpan.style.cssText = "font-weight:700;color:var(--olive-light);min-width:44px;flex-shrink:0;";
          row.appendChild(timeSpan);
          var info = el("div");
          info.appendChild(el("div", "t", a.client_name));
          info.appendChild(el("div", "sub", a.service_name + (ME.role === "owner" ? " · " + a.master_name : "")));
          row.appendChild(info); row.appendChild(el("span", "sp"));
          row.appendChild(el("span", "badge b-" + a.status, STATUS_LABEL[a.status] || a.status));
          item.appendChild(row);
          listEl.appendChild(item);
        });
      });
    }

    window.__reloadAppts = load;
    load();
  }

  // ── Вкладка "Розклад" з перемикачем Записи / Календар ─────────
  function renderZapysyTab() {
    apptViewMode = "month";
    renderAppts({ keepMode: true, title: "Записи", showToggle: false });
  }

  function renderRozkladTab() {
    apptViewMode = "calendar";
    renderAppts({ keepMode: true, title: "Розклад", showToggle: false });
  }

  function renderAppts(opts) {
    var tabTitle = (opts && opts.title) || "Розклад";
    var showToggle = !!(opts && opts.showToggle);
    if (!opts || !opts.keepMode) apptViewMode = "month";
    var main = $("main"); main.innerHTML = "";
    // Кнопку «Новий запис» додаємо праворуч у рядок фільтра майстра (нижче),
    // а окремий верхній рядок із заголовком прибрано — так розкладу видно більше.
    var newBtn = el("button", "btn btn-primary btn-sm", "+ Новий запис");
    newBtn.style.flexShrink = "0";
    newBtn.addEventListener("click", function () { apptModal(); });

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
    masterFilterWrap.style.flexWrap = "nowrap";
    main.appendChild(masterFilterWrap);
    var contentEl = el("div"); contentEl.id = "apptContent"; main.appendChild(contentEl);

    // Власник: "" = усі майстри (дефолт). Майстер: власний id = тільки свої
    // записи (дефолт), "all" = усі майстри (щоб бачити накладки).
    var activeMasterFilter = ME.role === "owner" ? "" : String(ME.masterId);

    if (ME.role === "owner") {
      api("GET", "/api/crm/masters").then(function (res) {
        var sel = el("select");
        sel.style.cssText = "flex:1 1 auto;min-width:0;";
        sel.appendChild(new Option("Усі майстри", ""));
        (res.j.masters || []).forEach(function (m) { sel.appendChild(new Option(m.name + (m.level ? " · " + m.level : ""), m.id)); });
        sel.addEventListener("change", function () { activeMasterFilter = sel.value; reloadView(sel.value); });
        var mLbl = el("span", "muted", "Майстер:");
        mLbl.style.flexShrink = "0";
        masterFilterWrap.appendChild(mLbl);
        masterFilterWrap.appendChild(sel);
        masterFilterWrap.appendChild(newBtn);
        reloadView();
      });
    } else {
      var selM = el("select");
      selM.style.cssText = "flex:1 1 auto;min-width:0;";
      selM.appendChild(new Option("Тільки я", String(ME.masterId)));
      selM.appendChild(new Option("Усі майстри", "all"));
      selM.value = activeMasterFilter;
      selM.addEventListener("change", function () { activeMasterFilter = selM.value; reloadView(selM.value); });
      var mLbl2 = el("span", "muted", "Перегляд:");
      mLbl2.style.flexShrink = "0";
      masterFilterWrap.appendChild(mLbl2);
      masterFilterWrap.appendChild(selM);
      newBtn.style.marginLeft = "auto";
      masterFilterWrap.appendChild(newBtn);
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

      // Завантажити к-ть записів і відрендерити (з урахуванням фільтра майстра)
      var mcUrl = "/api/crm/appointments/month-counts?month=" + apptMonth;
      if (activeMasterFilter && activeMasterFilter !== "all") mcUrl += "&master=" + activeMasterFilter;
      api("GET", mcUrl).then(function(res) {
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
        : "/api/crm/me/appointments?from=" + apptDate + "&to=" + apptDate + (masterId ? "&master=" + masterId : "");
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
      var HEADER_H = 48;
      var TOTAL_MIN = (HOUR_END - HOUR_START) * 60;
      var WEEK_STRIP_H = 66;
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
          "background:#fff;border-top:1px solid #d8ddd4;display:flex;flex-direction:column;-webkit-user-select:none;user-select:none;overflow:hidden;cursor:grab;";

        // Заголовок місяця
        var midDay = new Date(weekStart); midDay.setDate(weekStart.getDate() + 3);
        var stripMonthHdr = document.createElement("div");
        stripMonthHdr.style.cssText = "text-align:center;font-size:.63rem;font-weight:600;color:#888;padding:3px 0 1px;flex-shrink:0;letter-spacing:.04em;";
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
          wBtn.style.cssText = "flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:none;cursor:pointer;padding:1px 0 3px;background:transparent;";
          var wDayLbl = document.createElement("span");
          wDayLbl.style.cssText = "font-size:.58rem;font-weight:600;color:" + (isSel ? "#6e9145" : isToday2 ? "#5a7a48" : "#aaa") + ";letter-spacing:.02em;line-height:1;";
          wDayLbl.textContent = DOW_STRIP[wi];
          var wPill = document.createElement("span");
          wPill.style.cssText = "width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;" +
            "font-size:.85rem;font-weight:" + (isSel||isToday2 ? "700" : "500") + ";line-height:1;" +
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
        function positionWeekPreview(dx) {
          var goLeft = dx < 0;
          var width = wkStrip.offsetWidth || 375;
          daysRow.style.transform = "translateX(" + dx + "px)";
          swipePreview.style.transform = "translateX(" + (goLeft ? width + dx : -width + dx) + "px)";
          var delta = goLeft ? 7 : -7;
          var nextStart = new Date(weekStart); nextStart.setDate(weekStart.getDate() + delta);
          var nextEnd = new Date(nextStart); nextEnd.setDate(nextStart.getDate() + 6);
          swipeLabel.textContent = nextStart.getDate() + " " + MON_SHORT2[nextStart.getMonth()] + " – " + nextEnd.getDate() + " " + MON_SHORT2[nextEnd.getMonth()];
        }
        function finishWeekDrag(dx, moved) {
          if (!moved || Math.abs(dx) < 55) {
            daysRow.style.transition = "transform .2s";
            daysRow.style.transform = "translateX(0)";
            swipePreview.style.transition = "transform .2s";
            var width = wkStrip.offsetWidth || 375;
            swipePreview.style.transform = "translateX(" + (dx < 0 ? width : -width) + "px)";
            return;
          }
          /* Стаємо на понеділок тижня, на який перекинулись, а не зсуваємо
             дату на ±7 днів: інакше після свайпу з неділі відкривалась знову
             неділя, тобто кінець нового тижня замість його початку. */
          var delta = dx < 0 ? 7 : -7;
          var nextDay = new Date(weekStart); nextDay.setDate(weekStart.getDate() + delta);
          apptDate = nextDay.getFullYear() + "-" + String(nextDay.getMonth()+1).padStart(2,"0") + "-" + String(nextDay.getDate()).padStart(2,"0");
          apptMonth = apptDate.slice(0,7);
          loadCalendar(activeMasterFilter);
        }
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
          positionWeekPreview(dx);
        }, { passive: true });
        wkStrip.addEventListener("touchend", function(e) {
          if (!swTouching) return;
          swTouching = false;
          var dx = e.changedTouches[0].clientX - swTouchX;
          finishWeekDrag(dx, swMoved);
        });
        wkStrip.addEventListener("touchcancel", function() {
          swTouching = false;
          daysRow.style.transition = "transform .2s";
          daysRow.style.transform = "translateX(0)";
          var sw3 = wkStrip.offsetWidth || 375;
          swipePreview.style.transition = "transform .2s";
          swipePreview.style.transform = "translateX(" + sw3 + "px)";
        });

        // На ПК підтримуємо той самий жест затисканням лівої кнопки миші.
        var swMouseX = 0, swMouseDown = false;
        function endMouseWeekDrag(e) {
          if (!swMouseDown) return;
          swMouseDown = false;
          wkStrip.style.cursor = "grab";
          document.removeEventListener("mousemove", moveMouseWeekDrag);
          document.removeEventListener("mouseup", endMouseWeekDrag);
          finishWeekDrag(e.clientX - swMouseX, swMoved);
        }
        function moveMouseWeekDrag(e) {
          if (!swMouseDown) return;
          var dx = e.clientX - swMouseX;
          if (Math.abs(dx) > 12) swMoved = true;
          if (swMoved) positionWeekPreview(dx);
        }
        wkStrip.addEventListener("mousedown", function(e) {
          if (e.button !== 0) return;
          swMouseX = e.clientX; swMouseDown = true; swMoved = false;
          wkStrip.style.cursor = "grabbing";
          daysRow.style.transition = "none";
          swipePreview.style.transition = "none";
          var width = wkStrip.offsetWidth || 375;
          swipePreview.style.left = "0";
          swipePreview.style.width = width + "px";
          swipePreview.style.transform = "translateX(" + width + "px)";
          document.addEventListener("mousemove", moveMouseWeekDrag);
          document.addEventListener("mouseup", endMouseWeekDrag);
        });

        /* Перемикання тижня скролом (миша/трекпад) — той самий рух, що й
           свайп пальцем, лише на ПК немає дотику. Один "клац" колеса =
           один тиждень; невеликий cooldown, бо трекпад шле десятки wheel-
           подій за один рух і без нього перемикало б одразу на кілька тижнів. */
        wkStrip.addEventListener("wheel", function(e) {
          if (calWheelBusy) { e.preventDefault(); return; }
          var d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
          if (Math.abs(d) < 20) return; // дрібне тремтіння колеса ігноруємо
          e.preventDefault();
          calWheelBusy = true;
          setTimeout(function() { calWheelBusy = false; }, 450);
          var delta3 = d > 0 ? 7 : -7;
          var d4 = new Date(weekStart); d4.setDate(weekStart.getDate() + delta3);
          apptDate = d4.getFullYear() + "-" + String(d4.getMonth()+1).padStart(2,"0") + "-" + String(d4.getDate()).padStart(2,"0");
          apptMonth = apptDate.slice(0,7);
          loadCalendar(activeMasterFilter);
        }, { passive: false });

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

        var masters = (masterFilter && masterFilter !== "all")
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
        // Показуємо лише майстрів, що працюють цього дня за графіком
        // (schedMap заповнюється з денного графіка з урахуванням override'ів),
        // а також тих, у кого вже є записи цього дня — щоб не ховати наявні брони.
        masters = masters.filter(function(m) {
          return !!schedMap[m.id] || appts.some(function(a) { return a.master_id === m.id; });
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
        var desktopMouseDragEnabled = ME.role === "owner" && window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
        var desktopDragState = null;
        var desktopDragSuppressClick = false;

        function finishDesktopDrag(suppressClick) {
          document.querySelectorAll(".cal-desktop-drag-hl").forEach(function(col) {
            col.classList.remove("cal-desktop-drag-hl");
            col.style.boxShadow = "";
          });
          if (desktopDragState && desktopDragState.dropZone) desktopDragState.dropZone.remove();
          if (desktopDragState && desktopDragState.sourceBlock) desktopDragState.sourceBlock.style.opacity = "";
          desktopDragState = null;
          if (suppressClick) {
            desktopDragSuppressClick = true;
            setTimeout(function() { desktopDragSuppressClick = false; }, 250);
          }
        }

        function confirmDesktopAppointmentTransfer(appt, targetMaster, targetStartMin) {
          if (!appt || !targetMaster || targetStartMin == null) return;
          var masterChanged = String(appt.master_id) !== String(targetMaster.id);
          var timeChanged = targetStartMin !== appt.start_min;
          if (!masterChanged && !timeChanged) return;
          var targetEndMin = targetStartMin + appt.duration_min;
          openModal(
            '<h3 style="margin:0 0 10px;">Перенести запис?</h3>' +
            '<div style="font-size:.92rem;color:#222;font-weight:600;margin-bottom:6px;">' + appt.client_name + '</div>' +
            (masterChanged ? '<div style="font-size:.85rem;color:#555;margin-bottom:4px;">Новий майстер: <strong>' + (targetMaster.name || '') + '</strong></div>' : '') +
            '<div style="font-size:.85rem;color:#555;margin-bottom:18px;">Новий час: <strong>' + fmtMin(targetStartMin) + ' – ' + fmtMin(targetEndMin) + '</strong></div>' +
            '<div class="modal-foot">' +
            '<button id="desktopDragConfirmBtn" class="btn btn-primary">Перенести</button>' +
            '<button id="desktopDragCancelBtn" class="btn btn-ghost">Скасувати</button>' +
            '</div>'
          );
          document.getElementById("desktopDragCancelBtn").addEventListener("click", closeModal);
          document.getElementById("desktopDragConfirmBtn").addEventListener("click", function() {
            api("PATCH", "/api/crm/appointments/" + appt.id, {
              master: parseInt(targetMaster.id, 10),
              date: apptDate,
              start_min: targetStartMin
            }).then(function(r) {
              if (!r.j || !r.j.ok) return;
              closeModal();
              loadCalendar(activeMasterFilter, { zoomOnly: true });
            });
          });
        }

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
            /* Запис у перерву / поза графіком дозволений: персонал інколи
               мусить втиснути клієнта саме туди. Позначаємо це в пункті меню,
               щоб натиснути випадково було важче. */
            '<button id="ctx-appt" style="display:block;width:100%;text-align:left;background:none;border:none;padding:10px 10px;font-size:.9rem;cursor:pointer;border-radius:6px;">📅 Новий запис' +
              (unavail ? '<span style="display:block;font-size:.68rem;color:var(--warn);">поза вільними віконцями</span>' : '') +
            '</button>' +
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
          hCell.style.cssText = "flex:1;min-width:" + MASTER_COL_W + "px;height:" + HEADER_H + "px;border-right:1px solid #d8ddd4;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:7px;padding:4px 6px;overflow:hidden;background:#fff;cursor:pointer;";
          var initials = (m.name||'?').charAt(0).toUpperCase() + (m.last_name ? m.last_name.charAt(0).toUpperCase() : '');
          var avHtml = m.photo
            ? '<img src="' + m.photo + '" style="width:30px;height:30px;border-radius:50%;object-fit:cover;border:2px solid #8aA462;flex-shrink:0;" alt="">'
            : '<div style="width:30px;height:30px;border-radius:50%;background:#3d5430;display:flex;align-items:center;justify-content:center;color:#8aA462;font-weight:700;font-size:.72rem;flex-shrink:0;">' + initials + '</div>';
          hCell.innerHTML = avHtml +
            '<div style="text-align:left;line-height:1.15;min-width:0;">' +
            '<div style="font-size:.72rem;font-weight:600;color:#1a2016;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;">' + (m.name||'') + (m.last_name ? ' ' + m.last_name : '') + '</div>' +
            '<div style="font-size:.58rem;color:#5a7a48;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;">' + (m.level||'') + '</div>' +
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

          // ПК, кабінет власника: запис можна перетягнути в колонку іншого майстра.
          if (desktopMouseDragEnabled) {
            mCol.addEventListener("dragover", function(e) {
              if (!desktopDragState) return;
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
              var draggedAppointment = desktopDragState.appointment;
              document.querySelectorAll(".cal-desktop-drag-hl").forEach(function(col) {
                if (col !== mCol) {
                  col.classList.remove("cal-desktop-drag-hl");
                  col.style.boxShadow = "";
                }
              });
              if (String(draggedAppointment.master_id) !== String(master.id)) {
                mCol.classList.add("cal-desktop-drag-hl");
                mCol.style.boxShadow = "inset 0 0 0 3px rgba(110,145,69,.65)";
              }

              var colRect = mCol.getBoundingClientRect();
              var blockTopInColumn = e.clientY - colRect.top - (desktopDragState.grabOffsetPx || 0);
              var rawMin = Math.round(blockTopInColumn / SLOT_H) * STEP + HOUR_START * 60;
              var targetStartMin = Math.max(
                HOUR_START * 60,
                Math.min(HOUR_END * 60 - draggedAppointment.duration_min, rawMin)
              );
              desktopDragState.targetStartMin = targetStartMin;

              if (!desktopDragState.dropZone || desktopDragState.dropZone.parentElement !== mCol) {
                if (desktopDragState.dropZone) desktopDragState.dropZone.remove();
                var desktopDropZone = document.createElement("div");
                desktopDropZone.style.cssText = "position:absolute;left:2px;right:2px;border-radius:5px;pointer-events:none;z-index:5;" +
                  "border:2px dashed rgba(255,255,255,.9);box-sizing:border-box;display:flex;align-items:flex-start;justify-content:center;" +
                  "padding-top:4px;color:#fff;font-size:.68rem;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,.45);";
                mCol.appendChild(desktopDropZone);
                desktopDragState.dropZone = desktopDropZone;
              }
              var dropZoneTop = ((targetStartMin - HOUR_START * 60) / STEP) * SLOT_H + 1;
              var dropZoneHeight = Math.max((draggedAppointment.duration_min / STEP) * SLOT_H - 2, SLOT_H * 2 - 2);
              desktopDragState.dropZone.style.top = dropZoneTop + "px";
              desktopDragState.dropZone.style.height = dropZoneHeight + "px";
              desktopDragState.dropZone.style.background = draggedAppointment.color_marker || DEFAULT_MARKER;
              desktopDragState.dropZone.style.opacity = ".5";
              desktopDragState.dropZone.textContent = fmtMin(targetStartMin) + " – " + fmtMin(targetStartMin + draggedAppointment.duration_min);
            });

            mCol.addEventListener("dragleave", function(e) {
              if (e.relatedTarget && mCol.contains(e.relatedTarget)) return;
              mCol.classList.remove("cal-desktop-drag-hl");
              mCol.style.boxShadow = "";
            });

            mCol.addEventListener("drop", function(e) {
              if (!desktopDragState) return;
              e.preventDefault();
              e.stopPropagation();
              var droppedAppointment = desktopDragState.appointment;
              var droppedStartMin = desktopDragState.targetStartMin != null
                ? desktopDragState.targetStartMin
                : droppedAppointment.start_min;
              finishDesktopDrag(true);
              confirmDesktopAppointmentTransfer(droppedAppointment, master, droppedStartMin);
            });
          }

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
              "padding:3px 5px 2px 5px;overflow:hidden;cursor:pointer;z-index:3;" +
              (a.status === "confirmed"
                ? "border:2px solid #d9ff9f;box-shadow:0 0 0 1px #31531d,0 2px 7px rgba(49,83,29,.45);"
                : "border:2px solid transparent;");

            var cEsc = (a.comment||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            var html = "";
            if (heightPx >= 22) {
              html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:2px;margin-bottom:1px;">' +
                '<span style="font-size:.64rem;font-weight:700;color:rgba(255,255,255,.95);white-space:nowrap;">' + timeStr + '</span>' +
                '<span style="display:flex;gap:3px;align-items:center;flex-shrink:0;line-height:1;">' +
                  (a.is_new_client ? '<span title="Новий клієнт — ще не було завершених візитів" style="font-size:.56rem;font-weight:800;color:#1a3d0f;background:#d9ff9f;border-radius:6px;padding:1px 4px;letter-spacing:.02em;">NEW</span>' : '') +
                  (a.status === "confirmed" ? '<span title="Підтверджено" style="font-size:.68rem;font-weight:800;color:#e5ffb9;">✓</span>' : '') +
                  (hasNote ? '<span style="font-size:.64rem;opacity:.85;">💬</span>' : '') +
                '</span>' +
                '</div>';
            }
            html += '<div style="font-size:.76rem;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">' + a.client_name + '</div>';
            if (heightPx >= 44) html += '<div style="font-size:.66rem;color:rgba(255,255,255,.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + svcName + '</div>';
            /* sub_used/sub_total — реально списано в абонементі (росте лише
               при «Завершено»); sub_index — черговість цього візиту серед
               запланованих. Показуємо різні написи, щоб не виглядало, ніби
               незавершений візит уже списаний. */
            if (heightPx >= 44 && a.sub_total) {
              html += (a.status === "completed")
                ? '<div style="font-size:.62rem;color:#ffe08a;font-weight:600;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">🎟 Абонемент ' + a.sub_used + '/' + a.sub_total + '</div>'
                : '<div style="font-size:.62rem;color:#ffe08a;font-weight:600;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">🎟 ' + (a.sub_index || 1) + '-й в черзі · спожито ' + a.sub_used + '/' + a.sub_total + '</div>';
            }
            if (heightPx >= 60 && a.price) html += '<div style="font-size:.64rem;color:rgba(255,255,255,.82);margin-top:1px;">' + a.duration_min + ' хв · ' + Math.round(a.price/100) + ' ₴</div>';
            if (heightPx >= 72 && a.extra_services) {
              try {
                var _exs = JSON.parse(a.extra_services);
                if (Array.isArray(_exs) && _exs.length) {
                  html += '<div style="font-size:.62rem;color:rgba(255,255,255,.9);margin-top:2px;line-height:1.3;">' +
                    _exs.map(function(e){
                      var nm = String((e && e.name) || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                      return '＋ ' + nm + (e && e.duration_min ? ' (' + e.duration_min + ' хв)' : '');
                    }).join('<br>') + '</div>';
                }
              } catch (e) {}
            }
            if (heightPx >= 84 && hasNote) html += '<div style="font-size:.64rem;color:rgba(255,255,255,.92);margin-top:3px;line-height:1.25;overflow:hidden;">💬 ' + cEsc + '</div>';
            block.innerHTML = html;

            // Native mouse drag is enabled only for the owner on desktop.
            if (desktopMouseDragEnabled) {
              block.draggable = true;
              block.style.cursor = "grab";
              block.title = "Затисніть і перетягніть до іншого майстра";
              block.addEventListener("dragstart", function(e) {
                var oldP = document.getElementById("cal-popup");
                if (oldP) oldP.remove();
                var blockRect = block.getBoundingClientRect();
                desktopDragSuppressClick = false;
                desktopDragState = {
                  appointment: a,
                  sourceBlock: block,
                  dropZone: null,
                  targetStartMin: a.start_min,
                  grabOffsetPx: Math.max(0, e.clientY - blockRect.top)
                };
                if (e.dataTransfer) {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(a.id));
                }
                setTimeout(function() {
                  if (desktopDragState && desktopDragState.sourceBlock === block) block.style.opacity = ".35";
                }, 0);
              });
              block.addEventListener("dragend", function() {
                finishDesktopDrag(true);
              });
            }

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
              if (dragState.active || desktopDragSuppressClick) { e.stopPropagation(); return; }
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

        // ── Лінія поточного часу (тільки на сьогоднішньому дні) ──
        if (nowLineTimer) { clearInterval(nowLineTimer); nowLineTimer = null; }
        body.style.position = "relative";
        function drawNowLine() {
          var line = body.querySelector("[data-now-line]");
          if (apptDate !== todayStr()) { if (line) line.remove(); return; }
          var d = new Date();
          var nowMin = d.getHours() * 60 + d.getMinutes();
          if (nowMin < HOUR_START * 60 || nowMin > HOUR_END * 60) { if (line) line.remove(); return; }
          var topPx = ((nowMin - HOUR_START * 60) / STEP) * SLOT_H;
          if (!line) {
            line = document.createElement("div");
            line.setAttribute("data-now-line", "1");
            line.style.cssText = "position:absolute;left:0;right:0;height:0;z-index:15;pointer-events:none;";
            line.innerHTML =
              '<div style="position:absolute;left:0;right:0;top:0;border-top:2px solid #e05050;"></div>' +
              '<div style="position:absolute;left:0;top:-1px;width:8px;height:8px;border-radius:50%;background:#e05050;transform:translate(-3px,-3px);"></div>' +
              '<div data-now-bubble style="position:absolute;left:2px;top:-9px;background:#1a1a1a;color:#fff;font-size:.62rem;font-weight:700;padding:2px 7px;border-radius:9px;white-space:nowrap;"></div>';
            body.appendChild(line);
          }
          line.style.top = topPx + "px";
          var bubble = line.querySelector("[data-now-bubble]");
          if (bubble) bubble.textContent = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
        }
        drawNowLine();
        nowLineTimer = setInterval(drawNowLine, 30000);

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
    var extrasHtml = "";
    try {
      var _dex = a.extra_services ? JSON.parse(a.extra_services) : null;
      if (Array.isArray(_dex) && _dex.length) {
        extrasHtml = '<div class="sub" style="margin-top:6px;">➕ Додатково: ' + _dex.map(function(e){
          var nm = String((e && e.name) || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          return nm + (e && e.duration_min ? ' (' + e.duration_min + ' хв)' : '');
        }).join(', ') + '</div>';
      }
    } catch (e) {}
    var html = '<h3>' + a.client_name + '</h3>' +
      '<div class="sub" style="margin-bottom:12px;">' + a.service_name + ' · ' + fmtMin(a.start_min) + '–' + fmtMin(a.end_min || (a.start_min + a.duration_min)) + ' · ' + a.master_name + '</div>' +
      '<div class="sub">' + (a.client_phone || '<span style="color:#aaa;">🔒 телефон приховано</span>') + '</div>' +
      extrasHtml +
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
    }
    if (a.status === "completed") {
      /* Візит міг зарахуватись автоматично (минула половина тривалості) —
         дає змогу відкотити помилкове автозавершення назад у "Підтверджено". */
      html += '<button class="btn btn-ghost btn-sm" id="dUncomplete">↩️ Повернути в підтверджені</button>';
    }
    if (a.status !== "cancelled") {
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
    if ($("dUncomplete")) $("dUncomplete").addEventListener("click", function() { setStatus("confirmed"); });
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
      // Послуга (редагована)
      '<label style="margin-top:10px;display:block;">Послуга</label>' +
      '<select id="eService"></select>' +
      // Додаткові послуги
      '<div id="eExtraList" style="margin-top:8px;"></div>' +
      '<div id="eAddExtraWrap" style="margin-top:6px;">' +
        '<button type="button" id="eAddExtraBtn" style="width:100%;padding:8px;border-radius:8px;border:1.5px dashed var(--line);background:transparent;color:var(--text-dim);font-size:.85rem;cursor:pointer;">+ Додати послугу</button>' +
        '<div id="eAddExtraSearch" style="display:none;position:relative;margin-top:4px;">' +
          '<input type="text" id="eAddExtraQ" placeholder="Пошук послуги…" autocomplete="off">' +
          '<div id="eAddExtraDrop" style="display:none;position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:300;max-height:200px;overflow-y:auto;margin-top:3px;"></div>' +
        '</div>' +
      '</div>' +
      // Абонемент
      '<div id="eSubSection" style="display:none;margin-top:10px;"></div>' +
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
    var allMastersE = [], allServicesE = [];
    var markSubUsed = false; // локальний прапорець "списати сеанс абонементу" — надсилається лише при збереженні
    var newSubIntent = null; // { sessions, price } — новий абонемент, оформлюється лише при збереженні

    // ── Додаткові послуги ────────────────────────────────────────────
    var eExtras = [];
    try {
      var parsedEExtras = a.extra_services ? JSON.parse(a.extra_services) : null;
      if (Array.isArray(parsedEExtras)) eExtras = parsedEExtras.slice();
    } catch (e) {}

    function eExtrasMin() { return eExtras.reduce(function(s, x) { return s + (x.duration_min || 0); }, 0); }

    function renderEExtraList() {
      var listEl = $("eExtraList"); if (!listEl) return;
      listEl.innerHTML = "";
      eExtras.forEach(function(ex, i) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin-bottom:4px;";
        var nameSpan = document.createElement("span");
        nameSpan.style.cssText = "flex:1;font-size:.85rem;font-weight:600;color:var(--cream);";
        nameSpan.textContent = ex.name + (ex.duration_min ? " · " + ex.duration_min + " хв" : "");
        var priceSpan = document.createElement("span");
        priceSpan.style.cssText = "font-size:.82rem;color:var(--text-dim);white-space:nowrap;";
        priceSpan.textContent = money(ex.price);
        var delBtn = document.createElement("button");
        delBtn.style.cssText = "background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:.9rem;padding:2px 4px;";
        delBtn.textContent = "✕";
        (function(idx) {
          delBtn.addEventListener("click", function() {
            eExtras.splice(idx, 1);
            renderEExtraList();
            loadESlots();
          });
        })(i);
        row.appendChild(nameSpan); row.appendChild(priceSpan); row.appendChild(delBtn);
        listEl.appendChild(row);
      });
    }
    renderEExtraList();

    function renderEAddExtraDrop(q) {
      var drop = $("eAddExtraDrop"); if (!drop) return;
      var filtered = allServicesE.filter(function(s) { return !q || s.name.toLowerCase().indexOf(q.toLowerCase()) > -1; });
      drop.innerHTML = "";
      filtered.slice(0, 30).forEach(function(s) {
        var row = document.createElement("div");
        row.style.cssText = "padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--line);font-size:.88rem;color:var(--cream);";
        row.innerHTML = '<span style="font-weight:600;">' + s.name + '</span>' +
          '<span style="color:var(--text-dim);font-size:.78rem;margin-left:8px;">' + s.duration_min + ' хв · ' + money(s.price) + '</span>';
        row.addEventListener("mousedown", function(e) {
          e.preventDefault();
          eExtras.push({ id: s.id, name: s.name, duration_min: s.duration_min, price: s.price });
          $("eAddExtraQ").value = ""; $("eAddExtraSearch").style.display = "none";
          renderEExtraList(); loadESlots();
        });
        drop.appendChild(row);
      });
      drop.style.display = filtered.length ? "block" : "none";
    }
    if ($("eAddExtraBtn")) {
      $("eAddExtraBtn").addEventListener("click", function() {
        var srch = $("eAddExtraSearch");
        var open = srch.style.display !== "none";
        srch.style.display = open ? "none" : "block";
        if (!open) { $("eAddExtraQ").value = ""; $("eAddExtraQ").focus(); renderEAddExtraDrop(""); }
      });
      $("eAddExtraQ").addEventListener("input", function() { renderEAddExtraDrop(this.value.trim()); });
      $("eAddExtraQ").addEventListener("blur", function() {
        setTimeout(function() { var d = $("eAddExtraDrop"); if (d) d.style.display = "none"; }, 150);
      });
    }

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
      var mid = $("eMaster").value, date = $("eDate").value, sid = $("eService").value;
      if (!mid || !date || !sid) return;
      var box = $("eSlots"); box.innerHTML = "Завантаження…"; box.className = "";
      var url = "/api/public/slots?service=" + sid + "&master=" + mid + "&date=" + date;
      var extraDur = eExtrasMin();
      if (extraDur > 0) url += "&extra=" + extraDur;
      api("GET", url).then(function(r) {
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

    // ── Послуга: перебудова списку під обраного майстра ──────────────
    function rebuildEServiceOptions(preserveId) {
      var mid = $("eMaster").value;
      var master = allMastersE.find(function(m) { return String(m.id) === String(mid); });
      var svcIds = master ? (master.service_ids || []) : [];
      var opts = allServicesE.filter(function(s) {
        return svcIds.indexOf(s.id) !== -1 && (ME.role === "owner" || serviceMatchesMasterLevel(s, master));
      });
      // Поточна послуга запису могла бути деактивована чи не належати
      // майстру формально — все одно лишаємо її в списку, щоб не губити вибір.
      if (preserveId && !opts.some(function(s) { return String(s.id) === String(preserveId); })) {
        var cur = allServicesE.find(function(s) { return String(s.id) === String(preserveId); });
        if (cur) opts = [cur].concat(opts);
      }
      var sel = $("eService");
      sel.innerHTML = "";
      opts.forEach(function(s) {
        sel.appendChild(new Option(s.name + " · " + s.duration_min + " хв · " + money(s.price), s.id));
      });
      if (preserveId && opts.some(function(s) { return String(s.id) === String(preserveId); })) {
        sel.value = String(preserveId);
      } else if (opts.length) {
        sel.value = String(opts[0].id);
      }
    }

    // ── Абонемент ──────────────────────────────────────────────────
    function refreshSubSectionE() {
      var section = $("eSubSection");
      var svcId = $("eService").value;
      if (!a.client_id || !svcId) { section.style.display = "none"; return; }
      section.style.display = "block";

      if (a.subscription_used) {
        section.innerHTML = '<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:10px;padding:8px 12px;font-size:.82rem;color:#2e7d32;">🎟 За цей візит уже списано сеанс абонементу</div>';
        return;
      }
      if (markSubUsed) {
        section.innerHTML = '<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:10px;padding:8px 12px;font-size:.82rem;color:#2e7d32;">🎟 Сеанс буде списано при збереженні</div>';
        return;
      }
      if (newSubIntent) {
        section.innerHTML =
          '<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:10px;padding:8px 12px;font-size:.82rem;color:#2e7d32;">' +
            '🎟 Новий абонемент (' + newSubIntent.sessions + ' сеансів, ' + uahGroup(newSubIntent.price / 100) + ' грн) буде оформлено при збереженні — цей візит зарахується першим сеансом' +
          '</div>' +
          '<button type="button" id="eSubNewUndo" class="btn btn-sm btn-ghost" style="width:100%;margin-top:6px;">Скасувати</button>';
        $("eSubNewUndo").addEventListener("click", function() { newSubIntent = null; refreshSubSectionE(); });
        return;
      }
      section.innerHTML = '<div class="empty" style="padding:6px 0;">Перевірка абонементу…</div>';
      api("GET", "/api/crm/subscriptions/check?client_id=" + a.client_id + "&service_id=" + svcId).then(function(r) {
        var sub = r.j.active;
        if (sub) {
          var rem = sub.total_sessions - sub.used_sessions;
          section.innerHTML =
            '<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:.82rem;margin-bottom:6px;">' +
              '<span>🎟</span><span style="color:#2e7d32;font-weight:600;">Абонемент: ' + rem + ' сеанс' + (rem===1?'':'ів') + ' залишилось</span>' +
            '</div>' +
            '<button type="button" id="eSubUseBtn" class="btn btn-sm btn-ghost" style="width:100%;">Списати сеанс за цей візит</button>';
          $("eSubUseBtn").addEventListener("click", function() {
            markSubUsed = true;
            refreshSubSectionE();
          });
        } else {
          section.innerHTML =
            '<div class="empty" style="padding:6px 0;font-size:.8rem;">Активного абонементу на цю послугу немає</div>' +
            '<button type="button" id="eSubCreateBtn" style="width:100%;padding:9px 14px;border-radius:10px;border:1.5px dashed #6e9145;background:transparent;color:#5a7a48;font-size:.85rem;font-weight:600;cursor:pointer;text-align:left;">🎟 Оформити абонемент</button>';
          $("eSubCreateBtn").addEventListener("click", showCreateSubFormE);
        }
      });
    }

    // ── Оформлення нового абонементу прямо з редагування запису ─────
    function showCreateSubFormE() {
      var svcId = $("eService").value;
      var svc = allServicesE.find(function(s) { return String(s.id) === String(svcId); });
      var priceUAH = svc ? svc.price / 100 : 0;
      var sessions = 10;

      var html =
        '<div style="background:#f0f7ee;border:1px solid #b8d4a8;border-radius:10px;padding:12px;">' +
          '<div style="font-size:.8rem;font-weight:600;color:#3d5430;margin-bottom:8px;">К-ть сеансів</div>' +
          '<div id="eSubNewPresets" style="display:flex;gap:6px;margin-bottom:10px;">' +
            [5, 10, 15].map(function(n) {
              return '<button type="button" class="e-sub-preset" data-n="' + n + '" style="flex:1;padding:8px 0;border-radius:8px;border:1.5px solid #6e9145;background:' + (n === 10 ? "#6e9145" : "#fff") + ';color:' + (n === 10 ? "#fff" : "#3d5430") + ';font-weight:700;cursor:pointer;">' + n + '</button>';
            }).join("") +
          '</div>' +
          '<label>Сума оплати (грн)</label>' +
          '<input type="number" id="eSubNewPrice" min="0" style="margin-bottom:4px;">' +
          '<div id="eSubNewCalc" style="font-size:.73rem;color:#5a7a48;margin-bottom:6px;"></div>' +
          '<div style="font-size:.73rem;color:#5a7a48;margin-bottom:8px;">✓ Цей візит зараховується як перший сеанс</div>' +
          '<div style="display:flex;gap:8px;">' +
            '<button type="button" id="eSubNewCancel" class="btn btn-sm btn-ghost" style="flex:1;">Скасувати</button>' +
            '<button type="button" id="eSubNewConfirm" class="btn btn-sm btn-primary" style="flex:1;">Оформити</button>' +
          '</div>' +
        '</div>';
      $("eSubSection").innerHTML = html;

      function calc() {
        var pct = subDiscountPct(sessions);
        var total = subTotalUAH(priceUAH, sessions);
        $("eSubNewPrice").value = total;
        $("eSubNewCalc").textContent = (priceUAH > 0)
          ? uahGroup(priceUAH) + " грн × " + sessions + (pct > 0 ? " − " + pct + "%" : "") + " = " + uahGroup(total) + " грн"
          : "";
      }
      calc();

      document.querySelectorAll(".e-sub-preset").forEach(function(b) {
        b.addEventListener("click", function() {
          sessions = parseInt(b.dataset.n, 10);
          document.querySelectorAll(".e-sub-preset").forEach(function(x) {
            var active = x === b;
            x.style.background = active ? "#6e9145" : "#fff";
            x.style.color = active ? "#fff" : "#3d5430";
          });
          calc();
        });
      });
      $("eSubNewCancel").addEventListener("click", function() { refreshSubSectionE(); });
      $("eSubNewConfirm").addEventListener("click", function() {
        var price = Math.round(parseFloat($("eSubNewPrice").value || 0) * 100);
        newSubIntent = { sessions: sessions, price: price };
        refreshSubSectionE();
      });
    }

    Promise.all([
      api("GET", "/api/crm/masters"),
      api("GET", "/api/crm/services")
    ]).then(function(rs) {
      allMastersE = rs[0].j.masters || [];
      allServicesE = rs[1].j.services || [];
      if (ME.role !== "owner") {
        var ownMasterE = allMastersE.find(function(m) { return m.id === ME.masterId; });
        allServicesE = allServicesE.filter(function(s) { return serviceMatchesMasterLevel(s, ownMasterE); });
      }

      var sel = $("eMaster");
      allMastersE.forEach(function(m) {
        if (ME.role !== "owner" && m.id !== ME.masterId) return;
        var o = new Option(m.name + (m.last_name?" "+m.last_name:""), m.id);
        sel.appendChild(o);
      });
      sel.value = String(a.master_id);
      if (ME.role !== "owner") $("eMasterRow").style.display = "none";

      rebuildEServiceOptions(a.service_id);

      sel.addEventListener("change", function() { markSubUsed = false; newSubIntent = null; rebuildEServiceOptions($("eService").value); loadESlots(); refreshSubSectionE(); });
      $("eService").addEventListener("change", function() { markSubUsed = false; newSubIntent = null; loadESlots(); refreshSubSectionE(); });

      loadESlots();
      refreshSubSectionE();
    });

    $("eSave").addEventListener("click", function() {
      var err = $("eErr"); err.textContent = "";
      if (chosenMin == null) { err.textContent = "Оберіть час"; return; }
      api("PATCH", "/api/crm/appointments/" + a.id, {
        master: $("eMaster").value,
        service: $("eService").value,
        date: $("eDate").value,
        start_min: chosenMin,
        comment: $("eComment").value.trim(),
        extra_services: eExtras.length ? JSON.stringify(eExtras) : null,
        subscription_used: markSubUsed || undefined
      }).then(function(r) {
        if (r.code === 409) { err.textContent = "Це віконце вже зайняте"; return; }
        if (!r.j.ok) { err.textContent = "Помилка: " + (r.j.error||""); return; }

        function done() { closeModal(); if (window.__reloadAppts) window.__reloadAppts(); }

        if (newSubIntent && a.client_id) {
          api("POST", "/api/crm/subscriptions", {
            client_id: a.client_id,
            service_id: $("eService").value,
            total_sessions: newSubIntent.sessions,
            used_sessions: 1,
            price: newSubIntent.price,
            note: null,
            appointment_id: a.id
          }).then(done);
        } else {
          done();
        }
      });
    });
  }

  function apptItem(a) {
    var item = el("div", "item");
    if (a.status === "confirmed") {
      item.style.border = "2px solid rgba(110,145,69,.75)";
      item.style.boxShadow = "0 3px 12px rgba(61,84,48,.13)";
    }
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
    // Візит міг зарахуватись автоматично (минула половина тривалості) —
    // дає змогу відкотити помилкове автозавершення назад.
    if (a.status === "completed") acts.appendChild(actBtn("↩️ Повернути в підтверджені", "confirmed"));
    if (a.status !== "cancelled") acts.appendChild(actBtn("Скасувати", "cancelled"));
    var editB = el("button", "btn btn-sm btn-ghost", "✏️ Редагувати");
    editB.addEventListener("click", function () { apptEditModal(a); });
    acts.appendChild(editB);
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
      /* Швидкий блок без реального клієнта (як у Bookon) — майстер
         бронює собі час без імені й телефону. */
      '<button type="button" id="mGuestBtn" style="background:none;border:none;color:var(--olive-light);font-size:.8rem;padding:4px 0;cursor:pointer;text-align:left;">🚫 Без контактних даних (Гість)</button>' +
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
        '<label style="margin-top:8px;display:block;">Телефон <span style="color:var(--text-dim);font-weight:400;">(необов\'язково)</span></label><input type="tel" id="mPhone" maxlength="30"/>' +
        /* Підказка «номер уже в базі»: без неї запис тихо чіпляється до
           старої картки, і здається, що новий клієнт не створився. */
        '<div id="mPhoneHint" style="display:none;font-size:.74rem;color:var(--warn);margin-top:5px;line-height:1.4;"></div>' +
      '</div>' +

      // 2. МАЙСТЕР — його кваліфікація визначає доступний прайс
      '<div id="mMasterRow"><label style="margin-top:14px;display:block;">Майстер</label><select id="mMaster"></select></div>' +

      // 3. ПОСЛУГА
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;margin-bottom:4px;">' +
        '<label style="margin:0;">Послуга</label>' +
        '<span id="mTotalInfo" style="font-size:.78rem;color:var(--text-dim);"></span>' +
      '</div>' +
      // Список обраних послуг
      '<div id="mSvcList"></div>' +
      // Спочатку обираємо категорію, потім конкретну послугу — як в онлайн-записі.
      '<div id="mSvcCategories" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin-top:4px;"></div>' +
      '<div id="mSvcWrap" style="display:none;position:relative;margin-top:4px;">' +
        '<button type="button" id="mSvcGroupBack" class="btn btn-ghost btn-sm" style="margin-bottom:7px;">← Усі категорії</button>' +
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
            '<div id="mSubCalc" style="font-size:.73rem;color:#5a7a48;margin-bottom:6px;"></div>' +
            '<div style="font-size:.73rem;color:#5a7a48;">✓ Перше відвідування зараховується одразу</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // 4. ДАТА + ЧАС
      '<label>Дата</label>' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<input type="date" id="mDate" style="flex:1;" />' +
        '<div id="mDateLabel" style="font-size:.85rem;color:var(--text-dim);white-space:nowrap;"></div>' +
      '</div>' +
      '<div id="mChosenTime" style="display:none;margin-top:4px;padding:6px 10px;background:var(--panel-2);border-radius:8px;font-size:.85rem;font-weight:600;color:var(--cream);"></div>' +
      /* Сітка слотів у розкривному блоці: коли час уже обраний (клік по
         вільній клітинці календаря або вибір зі списку), решта віконець
         лише відсуває вниз коментар і кнопку «Створити». */
      '<details id="mSlotsBox" class="da-more" open style="margin-top:10px;">' +
        '<summary id="mSlotsSummary" style="cursor:pointer;font-size:.78rem;color:var(--text-dim);margin:10px 0 5px;">Вільний час <span class="da-caret">▾</span></summary>' +
        '<div id="mSlots" class="muted">Оберіть послугу, майстра й дату</div>' +
        /* Ручний час: у перерву чи поза графіком вільних віконець немає, а
           персоналу інколи треба поставити клієнта саме туди. */
        '<div style="display:flex;align-items:center;gap:6px;margin-top:10px;">' +
          '<input type="time" id="mCustomTime" step="300" style="flex:1;margin:0;" />' +
          '<button type="button" id="mCustomTimeBtn" class="btn btn-ghost" style="white-space:nowrap;padding:8px 12px;font-size:.82rem;">Свій час</button>' +
        '</div>' +
        '<div style="font-size:.68rem;color:var(--text-dim);margin-top:4px;">Для запису в перерву або поза графіком майстра</div>' +
      '</details>' +

      '<label style="margin-top:10px;display:block;">Коментар</label><textarea id="mComment" maxlength="500"></textarea>' +
      '<label>Колір маркеру</label><div id="mMarkerWrap"></div>' +
      '<div class="err" id="mErr"></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" id="mCancel">Скасувати</button>' +
      '<button class="btn btn-primary" id="mSave">Створити</button></div>'
    );

    var chosen = { start_min: null, color_marker: null, subSessions: 0 };
    var selectedClient = null;
    var isGuestBooking = false; // "Без контактних даних" — запис без реального клієнта
    var allServices = [];
    var appointmentMasters = [];
    var selectedServices = []; // [{id, name, duration_min, price}, ...]
    var activeServiceGroup = null;
    var SERVICE_GROUPS = [
      { key: "massage", icon: "💆", title: "Масажі", sub: "Оздоровлення та відновлення" },
      { key: "spa-two", icon: "👥", title: "SPA для двох", sub: "Парні процедури та релакс" },
      { key: "spa-one", icon: "🌿", title: "SPA для одного", sub: "Індивідуальний релакс" },
      { key: "body", icon: "✨", title: "Корекція фігури", sub: "Моделювання та догляд за тілом" },
      { key: "extra", icon: "➕", title: "Додаткові послуги", sub: "Додатковий догляд" }
    ];
    function serviceGroup(s) {
      // Категорія з бази має пріоритет над евристикою за назвою. Саме сюди
      // міграція переносить усі add-on'и з фінального кроку онлайн-запису.
      if (String((s && s.category) || "").trim().toLowerCase() === "додаткові послуги") return "extra";
      var name = String((s && s.name) || "").toLowerCase();
      if (/парний|чотири руки|для двох/.test(name)) return "spa-two";
      if (/фітобоч|spa[ -]?ритуал|гарячим камінням|тепловий spa/.test(name)) return "spa-one";
      if (/обличчя|кобідо|гуа-ша|букальн/.test(name)) return "massage";
      if (/антицелюліт|моделююч|моделюван|лімфодренаж|вакуум|обгортан|трансформац|сольове/.test(name)) return "body";
      if (/кінезіотейп/.test(name)) return "extra";
      return "massage";
    }
    function selectedAppointmentMaster() {
      var mid = $("mMaster") ? $("mMaster").value : "";
      return appointmentMasters.find(function(m) { return String(m.id) === String(mid); }) || null;
    }
    function availableAppointmentServices() {
      if (ME.role !== "owner") return allServices;
      var master = selectedAppointmentMaster();
      if (!master) return [];
      var ids = master.service_ids || [];
      return allServices.filter(function(s) {
        return ids.indexOf(s.id) !== -1 && serviceMatchesMasterLevel(s, master);
      });
    }

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
            if (idx === 0) {
              if (selectedServices.length) {
                // Наступна послуга в списку стає новою основною.
                $("mService").value = selectedServices[0].id;
              } else {
                // Послуг не лишилось — повертаємо поле пошуку, щоб
                // можна було обрати послугу заново без перезаходу в запис.
                $("mService").value = "";
                activeServiceGroup = null;
                $("mSvcWrap").style.display = "none";
                $("mSvcCategories").style.display = "grid";
                renderSvcCategories();
                $("mSvcQ").value = "";
              }
              refreshSubSection();
            }
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
    // Автоматичний розрахунок суми оплати абонемента з ціни послуги,
    // кількості сеансів і знижки (5 → 5%, 10 → 10%, 15 → 13%).
    function recalcSubPrice() {
      var priceInput = $("mSubPrice"); if (!priceInput) return;
      var priceUAH = selectedServices.length ? selectedServices[0].price / 100 : 0;
      var sessions = chosen.subSessions || 0;
      var pct   = subDiscountPct(sessions);
      var total = subTotalUAH(priceUAH, sessions);
      priceInput.value = total;
      var calc = $("mSubCalc");
      if (calc) {
        calc.textContent = (priceUAH > 0 && sessions > 0)
          ? uahGroup(priceUAH) + " грн × " + sessions + (pct > 0 ? " − " + pct + "%" : "") + " = " + uahGroup(total) + " грн"
          : "";
      }
    }
    function selectSubPreset(n) {
      chosen.subSessions = n;
      document.querySelectorAll(".sub-preset").forEach(function(b) {
        var active = parseInt(b.dataset.n, 10) === n;
        b.style.background = active ? "#6e9145" : "#fff";
        b.style.color      = active ? "#fff"    : "#3d5430";
      });
      recalcSubPrice();
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
      if (!open) recalcSubPrice(); // щойно відкрили — підставити суму
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
      recalcSubPrice(); // перерахувати суму під нову послугу
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
        $("mSvcCategories").style.display = "none";
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
      var filtered = availableAppointmentServices().filter(function(s) {
        return serviceGroup(s) === activeServiceGroup && (!q || s.name.toLowerCase().indexOf(q.toLowerCase()) > -1);
      });
      buildSvcDropRows(drop, filtered, function(s) { selectService(s); });
    }

    function renderSvcCategories() {
      var box = $("mSvcCategories"); if (!box) return;
      box.innerHTML = "";
      var services = availableAppointmentServices();
      if (ME.role === "owner" && !selectedAppointmentMaster()) {
        box.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:12px 0;">Спочатку оберіть майстра — покажемо його послуги та тариф.</div>';
        return;
      }
      SERVICE_GROUPS.forEach(function(group) {
        if (!services.some(function(s) { return serviceGroup(s) === group.key; })) return;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.style.cssText = "display:flex;align-items:center;gap:10px;text-align:left;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);cursor:pointer;color:var(--cream);";
        btn.innerHTML = '<span style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--panel);font-size:1.15rem;flex-shrink:0;">' + group.icon + '</span>' +
          '<span style="min-width:0;flex:1;"><span style="display:block;font-weight:700;font-size:.88rem;">' + group.title + '</span><span style="display:block;font-size:.72rem;color:var(--text-dim);margin-top:2px;">' + group.sub + '</span></span><span style="font-size:1.35rem;color:var(--olive-light);">›</span>';
        btn.addEventListener("click", function() {
          activeServiceGroup = group.key;
          box.style.display = "none";
          $("mSvcWrap").style.display = "block";
          $("mSvcQ").value = "";
          $("mSvcQ").placeholder = "Пошук у категорії «" + group.title + "»…";
          renderSvcDrop("");
          $("mSvcQ").focus();
        });
        box.appendChild(btn);
      });
    }

    $("mSvcGroupBack").addEventListener("click", function() {
      activeServiceGroup = null;
      $("mSvcWrap").style.display = "none";
      $("mSvcCategories").style.display = "grid";
      renderSvcCategories();
    });

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
      var filtered = availableAppointmentServices().filter(function(s) { return !q || s.name.toLowerCase().indexOf(q.toLowerCase()) > -1; });
      buildSvcDropRows(drop, filtered, function(s) {
        selectedServices.push({ id: s.id, name: s.name, duration_min: s.duration_min, price: s.price });
        $("mAddSvcQ").value = ""; $("mAddSvcSearch").style.display = "none";
        renderSvcList(); loadSlots();
      });
    });
    $("mAddSvcQ") && $("mAddSvcQ").addEventListener("focus", function() {
      var drop = $("mAddSvcDrop");
      buildSvcDropRows(drop, availableAppointmentServices(), function(s) {
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
      isGuestBooking = false;
      $("mClientSearch").style.display = "none";
      $("mGuestBtn").style.display = "none";
      $("mClientNew").style.display = "none";
      var chip = $("mClientChip");
      chip.style.display = "flex";
      $("mChipName").textContent = c.name;
      $("mChipPhone").textContent = c.phone || (ME.can_see_phones ? "" : "🔒 приховано");
      refreshSubSection();
    }

    function showNewForm(nameVal) {
      selectedClient = null;
      isGuestBooking = false;
      $("mClientSearch").style.display = "none";
      $("mGuestBtn").style.display = "none";
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
      isGuestBooking = false;
      $("mClientChip").style.display = "none";
      $("mClientNew").style.display = "none";
      $("mClientSearch").style.display = "block";
      $("mGuestBtn").style.display = "block";
      $("mClientQ").value = "";
      $("mClientQ").focus();
      refreshSubSection();
    }

    function selectGuest() {
      selectedClient = null;
      isGuestBooking = true;
      $("mClientSearch").style.display = "none";
      $("mGuestBtn").style.display = "none";
      $("mClientNew").style.display = "none";
      var chip = $("mClientChip");
      chip.style.display = "flex";
      $("mChipName").textContent = "Гість";
      $("mChipPhone").textContent = "Без контактних даних";
      // Абонемент прив'язаний до конкретного клієнта — гостю не пропонуємо.
      var sub = $("mSubSection"); if (sub) sub.style.display = "none";
    }

    $("mClientClear").addEventListener("click", resetToSearch);
    $("mGuestBtn").addEventListener("click", selectGuest);

    /* Живa перевірка номера у формі нового клієнта: якщо він уже в базі,
       новий клієнт НЕ створиться — запис піде на наявну картку. Кажемо це
       одразу, поки номер вводять, а не мовчки після збереження. */
    var phoneHintTimer = null;
    $("mPhone").addEventListener("input", function() {
      clearTimeout(phoneHintTimer);
      var v = this.value.trim();
      var hint = $("mPhoneHint");
      if (v.replace(/\D/g, "").length < 9) { hint.style.display = "none"; return; }
      phoneHintTimer = setTimeout(function() {
        api("GET", "/api/crm/clients/by-phone?phone=" + encodeURIComponent(v)).then(function(r) {
          var c = r.j && r.j.client;
          var cur = $("mPhone") ? $("mPhone").value.trim() : "";
          if (cur !== v || !$("mPhoneHint")) return; // номер уже змінили / модалку закрили
          if (c) {
            hint.style.display = "block";
            hint.textContent = "ℹ️ Цей номер уже є в базі: " + c.name +
              ". Новий клієнт не створиться — запис піде на цю картку (ім'я оновиться на введене).";
          } else {
            hint.style.display = "none";
          }
        });
      }, 300);
    });

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

    if (prefill.client && prefill.client.id) {
      showChip(prefill.client);
    } else if (prefill.clientName || prefill.clientPhone) {
      showNewForm(prefill.clientName || "");
      if (prefill.clientPhone) $("mPhone").value = prefill.clientPhone;
    }

    // ── Послуги і майстри ────────────────────────────────────────────
    // Майстер (не власник) обирає лише зі своїх послуг — інакше в
    // пошуку/списку висвічувались варіанти й "Майстер", і "Топ Майстер"
    // одразу, незалежно від власної кваліфікації.
    Promise.all([
      api("GET", "/api/crm/services"),
      api("GET", "/api/crm/masters")
    ]).then(function (results) {
      var svcRes = results[0], mstRes = results[1];
      var sel = $("mService");
      appointmentMasters = mstRes.j.masters || [];
      allServices = svcRes.j.services || [];
      if (ME.role !== "owner") {
        var me = (mstRes.j.masters || []).find(function (m) { return m.id === ME.masterId; });
        var ids = me ? (me.service_ids || []) : [];
        allServices = allServices.filter(function (s) {
          return ids.indexOf(s.id) !== -1 && serviceMatchesMasterLevel(s, me);
        });
      }
      allServices.forEach(function (s) {
        var o = new Option(s.name + " (" + s.duration_min + " хв)", s.id);
        o.dataset.dur = s.duration_min; sel.appendChild(o);
      });
      if (prefill.serviceId) {
        var found = allServices.find(function(s) { return String(s.id) === String(prefill.serviceId); });
        if (found) { selectService(found); }
      }
      loadMasters(mstRes);
    });

    function loadMasters(mstRes) {
      function apply(res) {
        var sel = $("mMaster");
        appointmentMasters = res.j.masters || [];
        (res.j.masters || []).forEach(function (m) {
          if (ME.role !== "owner" && m.id !== ME.masterId) return;
          var label = m.name + (m.level ? " · " + m.level : ""); // дописати кваліфікацію майстра
          sel.appendChild(new Option(label, m.id));
        });
        if (ME.role !== "owner") {
          // Worker: force own masterId, hide the selector
          sel.value = String(ME.masterId);
          var row = $("mMasterRow"); if (row) row.style.display = "none";
        } else if (prefill.masterId) {
          sel.value = String(prefill.masterId);
        }
        if (!prefill.serviceId) renderSvcCategories();
        loadSlots();
      }
      if (mstRes) { apply(mstRes); return; }
      api("GET", "/api/crm/masters").then(apply);
    }

    $("mService").addEventListener("change", function() { loadSlots(); refreshSubSection(); });
    $("mMaster").addEventListener("change", function() {
      if (ME.role === "owner" && selectedServices.length) {
        selectedServices = [];
        $("mService").value = "";
        refreshSubSection();
        renderSvcList();
      }
      activeServiceGroup = null;
      $("mSvcWrap").style.display = "none";
      $("mSvcCategories").style.display = "grid";
      renderSvcCategories();
      loadSlots();
    });
    $("mDate").addEventListener("change", loadSlots);

    /* Згорнуто = час уже обраний, і його видно в #mChosenTime; розгорнуто =
       обирати ще нема з чого, тож ховати сітку не можна. */
    function syncSlotsBox() {
      var boxEl = $("mSlotsBox"), sum = $("mSlotsSummary");
      if (!boxEl || !sum) return;
      var picked = chosen.start_min != null;
      boxEl.open = !picked;
      sum.innerHTML = (picked ? "Обрати інший час" : "Вільний час") + ' <span class="da-caret">▾</span>';
    }

    /* Показ обраного часу. manual = час поза вільними віконцями (перерва,
       поза графіком) — його підставив персонал кліком по календарю. */
    function showChosenTime(min, manual) {
      var ct = $("mChosenTime"); if (!ct) return;
      if (min == null) { ct.style.display = "none"; ct.textContent = ""; return; }
      ct.style.display = "block";
      ct.innerHTML = "⏰ Час: " + fmtMin(min) +
        (manual ? ' <span style="font-weight:500;color:var(--warn);">· поза вільними віконцями</span>' : "");
    }

    /* Старти, які сервер віддав як вільні, — щоб зрозуміти, чи введений
       вручну час є звичайним віконцем, чи перерва/поза графіком. */
    var freeStarts = [];

    /* Ручний час: працює незалежно від того, як відкрили модалку, тому
       запис у перерву можна зробити і через «+ Новий запис», а не лише
       кліком по клітинці календаря. */
    $("mCustomTimeBtn").addEventListener("click", function () {
      var err = $("mErr");
      var m = /^(\d{1,2}):(\d{2})$/.exec(($("mCustomTime").value || "").trim());
      if (!m) { err.textContent = "Вкажіть час у форматі ГГ:ХВ"; return; }
      var min = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      if (!(min >= 0 && min < 24 * 60)) { err.textContent = "Некоректний час"; return; }
      err.textContent = "";
      chosen.start_min = min;
      var free = freeStarts.indexOf(min) !== -1;
      $("mSlots").querySelectorAll(".slot").forEach(function (x) {
        x.classList.toggle("sel", free && x.textContent === fmtMin(min));
      });
      showChosenTime(min, !free);
      syncSlotsBox();
    });

    function loadSlots() {
      /* Скидаємо і підпис теж: без цього після зміни дати/майстра лишався
         старий «⏰ Час: …», хоча вибір уже злетів, і збереження вимагало
         обрати час, який нібито вже стоїть.
         Але сам вибір намагаємось відновити нижче (wantStartMin) — інакше
         додавання ще однієї послуги чи зміна тривалості скидає раніше
         обраний час без жодної причини. */
      var prevStartMin = chosen.start_min;
      chosen.start_min = null;
      freeStarts = [];
      showChosenTime(null);
      var sid = $("mService").value, mid = $("mMaster").value, date = $("mDate").value;
      if (!sid || !mid || !date) return;
      var wantStartMin = prefill.startMin != null ? prefill.startMin : prevStartMin;
      prefill.startMin = null;
      var box = $("mSlots"); box.className = ""; box.innerHTML = "Завантаження…";
      syncSlotsBox();
      // Підрахуємо загальну тривалість усіх послуг для коректних слотів
      var totalDur = selectedServices.reduce(function(s, x) { return s + x.duration_min; }, 0);
      var slotsUrl = "/api/public/slots?service=" + sid + "&master=" + mid + "&date=" + date;
      if (totalDur > 0) slotsUrl += "&duration=" + totalDur;
      api("GET", slotsUrl).then(function (res) {
        var slots = res.j.slots || [];
        freeStarts = slots.map(function (s) { return s.start_min; });
        box.innerHTML = "";
        if (!slots.length) {
          box.className = "muted"; box.textContent = "Вільних віконець немає";
          if (wantStartMin != null) { chosen.start_min = wantStartMin; showChosenTime(wantStartMin, true); }
          syncSlotsBox(); return;
        }
        var matched = false;
        var grid = el("div", "slots");
        slots.forEach(function (s) {
          var c = el("div", "slot", s.time);
          c.addEventListener("click", (function(slot) { return function () {
            grid.querySelectorAll(".slot").forEach(function (x) { x.classList.remove("sel"); });
            c.classList.add("sel"); chosen.start_min = slot.start_min;
            showChosenTime(slot.start_min);
            syncSlotsBox();
          }; })(s));
          grid.appendChild(c);
          if (wantStartMin != null && s.start_min === wantStartMin) { matched = true; c.click(); }
        });
        box.appendChild(grid);
        /* Клік по клітинці в перерві / поза графіком: такого старту серед
           вільних віконець нема, але персонал свідомо ставить запис туди —
           лишаємо час обраним і позначаємо його. */
        if (!matched && wantStartMin != null) { chosen.start_min = wantStartMin; showChosenTime(wantStartMin, true); }
        syncSlotsBox();
      });
    }

    $("mSave").addEventListener("click", function () {
      var err = $("mErr"); err.textContent = "";
      if (chosen.start_min == null) { err.textContent = "Оберіть час"; return; }
      var name, phone;
      if (isGuestBooking) {
        name = "Гість"; phone = "";
      } else if (selectedClient) {
        name = selectedClient.name; phone = selectedClient.phone;
      } else {
        var firstName = ($("mName") ? $("mName").value.trim() : "");
        var lastName  = ($("mSurname") ? $("mSurname").value.trim() : "");
        phone = ($("mPhone") ? $("mPhone").value.trim() : "");
        var phoneDigits = phone.replace(/\D/g, "");
        if (!firstName) { err.textContent = "Вкажіть ім'я"; return; }
        if (phoneDigits.length > 0 && phoneDigits.length < 9) { err.textContent = "Перевірте номер телефону"; return; }
        name = lastName ? firstName + " " + lastName : firstName;
      }
      if (!name) { err.textContent = "Оберіть або введіть клієнта"; return; }
      var url = ME.role === "owner" ? "/api/crm/appointments" : "/api/crm/me/appointments";
      var extras = selectedServices.slice(1);
      api("POST", url, {
        service: $("mService").value, master: $("mMaster").value, date: $("mDate").value,
        start_min: chosen.start_min, name: name, phone: phone,
        client_id: selectedClient ? selectedClient.id : null,
        guest: isGuestBooking || undefined,
        comment: $("mComment").value.trim(), color_marker: chosen.color_marker || null,
        extra_services: extras.length ? JSON.stringify(extras) : null
      }).then(function (res) {
        if (res.code === 409) { err.textContent = "Це віконце вже зайняте"; return; }
        if (res.code === 404 && res.j.error === "CLIENT_NOT_FOUND") { err.textContent = "Клієнта не знайдено. Спробуйте обрати ще раз."; return; }
        if (!res.j.ok) { err.textContent = "Помилка: " + (res.j.error || ""); return; }

        var clientId = res.j.appointment && res.j.appointment.client_id;
        var appointmentId = res.j.appointment && res.j.appointment.id;
        var subForm = $("mSubForm");
        var subOpen = !isGuestBooking && subForm && subForm.style.display !== "none";

        function done() { closeModal(); if (window.__reloadAppts) window.__reloadAppts(); }

        if (subOpen && clientId && chosen.subSessions > 0) {
          var price = Math.round(parseFloat($("mSubPrice") ? $("mSubPrice").value : 0) * 100);
          api("POST", "/api/crm/subscriptions", {
            client_id: clientId,
            service_id: $("mService").value,
            total_sessions: chosen.subSessions,
            used_sessions: 1,
            price: price,
            note: null,
            appointment_id: appointmentId
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

          function branchRow(branch) {
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
            return tr;
          }

          function masterRow(row) {
            var m = row.master;
            // Редагувати може власник, або сам майстер — лише свій рядок і
            // лише якщо власник надав право (can_edit_own_schedule).
            var canEdit = ME.role === "owner" || (m.id === ME.masterId && !!m.can_edit_own_schedule);
            var schedMap = masterSchedMap[m.id] || {};
            var tr = document.createElement("tr");
            tr.style.cssText = "border-bottom:1px solid #e8ece4;";
            var tdAv = document.createElement("td");
            tdAv.style.cssText = "padding:6px 4px;text-align:center;position:sticky;left:0;background:#fff;z-index:1;min-width:68px;" + (canEdit ? "cursor:pointer;" : "");
            var initials = (m.name||'?')[0].toUpperCase() + (m.last_name ? m.last_name[0].toUpperCase() : '');
            tdAv.innerHTML = (m.photo
              ? '<img src="' + m.photo + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:1.5px solid #8aA462;" alt="">'
              : '<div style="width:32px;height:32px;border-radius:50%;background:#3d5430;color:#8aA462;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;margin:0 auto;">' + initials + '</div>') +
              '<div style="font-size:.62rem;color:#1a2016;font-weight:600;margin-top:2px;white-space:nowrap;">' + (m.name||'') + '</div>';
            if (canEdit) {
              tdAv.addEventListener("click", (function(master) { return function() {
                scheduleEditPage(master, todayStr(), "grafik");
              }; })(m));
            }
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
              td.style.cssText = "padding:3px;text-align:center;" + (canEdit ? "cursor:pointer;" : "");
              td.innerHTML = schedCellHtml(s);
              if (canEdit) {
                td.addEventListener("click", (function(master2, ds2) { return function() {
                  scheduleEditPage(master2, ds2, "grafik", "day");
                }; })(m, day.dateStr));
              }
              tr.appendChild(td);
            });
            return tr;
          }

          // ── Філія, одразу під нею — її майстри. Один майстер може бути
          // показаний у кількох філіях, але це все ще один обліковий запис.
          var rowsByBranch = {};
          var unassigned = [];
          masterRows.forEach(function(row) {
            var branchIds = Array.isArray(row.master.branch_ids)
              ? row.master.branch_ids
              : (row.master.branch_id ? [row.master.branch_id] : []);
            var assigned = false;
            branchIds.forEach(function(bid) {
              if (branches.some(function(b) { return b.id === bid; })) {
                (rowsByBranch[bid] || (rowsByBranch[bid] = [])).push(row);
                assigned = true;
              }
            });
            if (!assigned) {
              unassigned.push(row);
            }
          });

          if (branches.length > 0) {
            branches.forEach(function(branch) {
              tbody.appendChild(sectionRow((branch.name || "ФІЛІЯ").toUpperCase(), totalCols));
              tbody.appendChild(branchRow(branch));
              (rowsByBranch[branch.id] || []).forEach(function(row) { tbody.appendChild(masterRow(row)); });
            });
            if (unassigned.length) {
              tbody.appendChild(sectionRow("БЕЗ ФІЛІЇ", totalCols));
              unassigned.forEach(function(row) { tbody.appendChild(masterRow(row)); });
            }
          } else {
            tbody.appendChild(sectionRow("ФАХІВЦІ", totalCols));
            masterRows.forEach(function(row) { tbody.appendChild(masterRow(row)); });
          }

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

    /* ── Перемикач кроку "Оберіть філію" в онлайн-записі ──
       Має сенс лише коли філій більше однієї — з однією клієнту нема
       з чого обирати, крок сам не показується навіть при увімкненому
       перемикачі (перевіряється на публічній стороні). */
    var togCard = el("div", "item"); togCard.style.marginBottom = "14px";
    var togRow = document.createElement("label");
    togRow.style.cssText = "display:flex;align-items:flex-start;gap:10px;cursor:pointer;";
    var togCb = document.createElement("input");
    togCb.type = "checkbox";
    togCb.style.cssText = "width:19px;height:19px;accent-color:var(--olive-light);flex-shrink:0;margin-top:2px;";
    var togTxt = el("div", "");
    togTxt.innerHTML = '<div style="font-size:.9rem;font-weight:600;color:var(--cream);">Крок "Оберіть філію" в онлайн-записі</div>' +
      '<div style="font-size:.72rem;color:var(--text-dim);margin-top:2px;">Клієнт спершу обирає філію, і вже потім бачить майстрів саме цієї філії. Працює лише коли філій більше однієї.</div>';
    togRow.appendChild(togCb); togRow.appendChild(togTxt);
    togCard.appendChild(togRow);
    var togMsg = el("div", "sub"); togMsg.style.margin = "6px 0 0 29px";
    togCard.appendChild(togMsg);
    main.appendChild(togCard);
    if (ME.role === "owner") {
      togCb.addEventListener("change", function() {
        togCb.disabled = true;
        api("PATCH", "/api/crm/settings/booking-branch-step", { enabled: togCb.checked }).then(function(r) {
          togCb.disabled = false;
          if (r.j && r.j.ok) { togMsg.style.color = "var(--ok)"; togMsg.textContent = "✓ Збережено"; }
          else { togCb.checked = !togCb.checked; togMsg.style.color = "var(--err)"; togMsg.textContent = "✗ Помилка збереження"; }
        });
      });
    } else {
      togCb.disabled = true;
    }

    var listEl = el("div", "list"); main.appendChild(listEl);

    function load() {
      listEl.innerHTML = '<div class="empty">Завантаження…</div>';
      api("GET", "/api/crm/branches").then(function(res) {
        var branches = res.j.branches || [];
        togCb.checked = !!res.j.booking_branch_step;
        if (branches.length < 2) {
          togMsg.style.color = "var(--text-dim)";
          togMsg.textContent = "Потрібно щонайменше 2 філії, щоб цей крок з'явився в онлайн-записі.";
        } else {
          togMsg.textContent = "";
        }
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
      if (mBtns[gi] && gi < mBtns.length - 1) {
        // не остання кнопка (⋯"Ще") — це справжня вкладка нижньої панелі
        mBtns[gi].click();
      } else {
        // вкладка живе лише в шторці "Ще" (desktop) — activateTab тут поза
        // областю видимості, тож клікаємо відповідну кнопку верхньої панелі
        // вкладок, яка завжди в DOM незалежно від мобільного/десктопного виду
        var topBtn = document.querySelectorAll(".tab")[gi];
        if (topBtn) topBtn.click();
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
    var mastersHint = document.createElement("div");
    mastersHint.textContent = "Майстер може працювати в кількох філіях. Додавання сюди не прибирає його з основної філії.";
    mastersHint.style.cssText = "font-size:.72rem;color:#7a8573;margin:-4px 0 10px;line-height:1.4;";
    content.appendChild(mastersHint);

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
        var isPrimaryHere = !!(branch && m.branch_id === branch.id);
        if (isPrimaryHere) {
          cb.checked = true;
          cb.disabled = true;
          cb.title = "Це основна філія майстра";
        }
        cb.addEventListener("change", function() {
          if (cb.checked) { if (selectedMasterIds.indexOf(m.id) === -1) selectedMasterIds.push(m.id); }
          else { selectedMasterIds = selectedMasterIds.filter(function(id) { return id !== m.id; }); }
        });
        var initials = (m.name||'?')[0].toUpperCase() + (m.last_name ? m.last_name[0].toUpperCase() : '');
        var ava2 = document.createElement("div");
        ava2.style.cssText = "width:32px;height:32px;border-radius:50%;background:#3d5430;color:#8aA462;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;flex-shrink:0;overflow:hidden;";
        ava2.innerHTML = m.photo ? '<img src="' + m.photo + '" style="width:100%;height:100%;object-fit:cover;">' : initials;
        var mName = document.createElement("div");
        mName.textContent = m.name + (m.last_name ? ' '+m.last_name : '') + (m.level ? ' · ' + m.level : '') + (isPrimaryHere ? ' · основна філія' : '');
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
  /* Мінімальний CSV-парсер (лапки, екрановані "" всередині лапок, коми
     всередині полів — напр. посилання на Instagram у MyBusiness-експорті). */
  function parseCsv(text) {
    var rows = [], row = [], field = "", inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
        else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          row.push(field); field = "";
          if (row.length > 1 || row[0] !== "") rows.push(row);
          row = [];
        } else field += c;
      }
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function csvDateToMs(s) {
    var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((s || "").trim());
    if (!m) return null;
    return Date.UTC(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10), 12, 0, 0);
  }

  function renderClients() {
    var main = $("main"); main.innerHTML = "";
    var bar = el("div", "bar"); bar.appendChild(el("h2", null, "Клієнти"));
    var search = el("input"); search.type = "text"; search.placeholder = "Пошук за іменем/телефоном";
    bar.appendChild(search);
    if (ME.role === "owner") {
      var importBtn = el("button", "btn btn-ghost btn-sm", "⬆️ Імпорт CSV");
      importBtn.style.cssText = "white-space:nowrap;";
      var fileInp = document.createElement("input");
      fileInp.type = "file"; fileInp.accept = ".csv"; fileInp.style.display = "none";
      importBtn.addEventListener("click", function () { fileInp.click(); });
      fileInp.addEventListener("change", function () {
        var file = fileInp.files[0]; if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          importBtn.disabled = true; importBtn.textContent = "Імпортуємо…";
          var text = String(reader.result || "").replace(/^﻿/, "");
          var rows = parseCsv(text);
          var header = rows[0] || [];
          var idx = {
            name: header.indexOf("Ім'я"), phone: header.indexOf("Телефон"),
            visits: header.indexOf("Кількість візитів"),
            lastVisit: header.indexOf("Дата останнього візиту"),
            firstVisit: header.indexOf("Дата першого візиту"),
          };
          if (idx.name === -1 || idx.phone === -1) {
            alert("Не знайдено колонки \"Ім'я\"/\"Телефон\" у файлі — перевір формат CSV.");
            importBtn.disabled = false; importBtn.textContent = "⬆️ Імпорт CSV"; return;
          }
          var todayStr2 = new Date().toISOString().slice(0, 10);
          var payload = rows.slice(1).filter(function (r) { return r.some(function (c) { return c !== ""; }); }).map(function (r) {
            var digits = (r[idx.phone] || "").replace(/\D/g, "");
            return {
              name: (r[idx.name] || "").trim(),
              phone: r[idx.phone] || "",
              digits: digits,
              visit_count: idx.visits > -1 ? (parseInt(r[idx.visits], 10) || 0) : 0,
              last_visit_at: idx.lastVisit > -1 ? csvDateToMs(r[idx.lastVisit]) : null,
              created_at: (idx.firstVisit > -1 ? csvDateToMs(r[idx.firstVisit]) : null) || Date.now(),
              note: "Імпортовано з CSV " + todayStr2,
            };
          }).filter(function (r) {
            // Відсіюємо явне сміття: короткі/однакові цифри, тестові записи.
            if (!r.name || r.name.toLowerCase() === "тест") return false;
            if (r.digits.length < 9) return false;
            if (/^(\d)\1+$/.test(r.digits)) return false;
            return true;
          }).map(function (r) { delete r.digits; return r; });
          if (!payload.length) {
            alert("У файлі не знайдено валідних рядків для імпорту.");
            importBtn.disabled = false; importBtn.textContent = "⬆️ Імпорт CSV"; return;
          }
          api("POST", "/api/crm/clients/import", { clients: payload }).then(function (res) {
            importBtn.disabled = false; importBtn.textContent = "⬆️ Імпорт CSV"; fileInp.value = "";
            if (res.j && res.j.ok) {
              alert("Готово: додано нових клієнтів — " + res.j.inserted + " з " + res.j.total + " (пропущено як уже наявні — " + (res.j.skipped || 0) + ").");
              load(search.value.trim());
            } else {
              alert("Помилка імпорту: " + (res.j && res.j.error || "невідома"));
            }
          });
        };
        reader.readAsText(file, "UTF-8");
      });
      bar.appendChild(importBtn); bar.appendChild(fileInp);
    }
    main.appendChild(bar);
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
          info.appendChild(el("div", "sub", (c.phone || "без телефону") + " · візитів: " + (c.visit_count || 0) +
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
          /* Відмова від розсилок — окремо від чорного списку: клієнт може
             й далі ходити, просто не хоче рекламних повідомлень. */
          (ME.role === "owner" ? '<button id="cc-nomark" style="display:block;width:100%;text-align:left;background:none;border:none;padding:13px 16px;font-size:.9rem;cursor:pointer;border-bottom:1px solid var(--line);">' + (c.no_marketing ? 'Дозволити розсилки' : 'Не надсилати розсилки') + '</button>' : '') +
          /* Персональний перемикач SMS-нагадувань про візит (типово всім увімкнено) */
          '<button id="cc-norem" style="display:block;width:100%;text-align:left;background:none;border:none;padding:13px 16px;font-size:.9rem;cursor:pointer;border-bottom:1px solid var(--line);">' + (c.no_reminders ? '🔔 Увімкнути SMS-нагадування' : '🔕 Вимкнути SMS-нагадування') + '</button>' +
          (ME.role === "owner" ? '<button id="cc-del" style="display:block;width:100%;text-align:left;background:none;border:none;padding:13px 16px;font-size:.9rem;color:#c04040;cursor:pointer;">Видалити</button>' : '');
        document.body.appendChild(ctx);

        function closeCtx() { var x=document.getElementById("client-ctx"); if(x) x.remove(); }

        document.getElementById("cc-edit").addEventListener("click", function() {
          closeCtx();
          var phoneReadOnly = ME.can_see_phones ? '' : ' readonly aria-readonly="true"';
          var phoneHelp = ME.can_see_phones ? '' : '<div style="font-size:.72rem;color:var(--text-dim);margin-top:4px;">Повний номер доступний лише з дозволу власника</div>';
          var html = '<h3>Редагувати клієнта</h3>' +
            '<label>Ім\'я</label><input type="text" id="ceN" value="' + (c.name||"").replace(/"/g,"&quot;") + '" maxlength="100">' +
            '<label style="margin-top:10px;display:block;">Телефон</label><input type="text" id="cePh" value="' + (c.phone||"") + '" maxlength="30"' + phoneReadOnly + '>' + phoneHelp +
            '<label style="margin-top:10px;display:block;">День народження <span style="color:var(--text-dim);font-weight:400;">(для SMS-привітання)</span></label><input type="date" id="ceBd" value="' + (c.birthday||"") + '">' +
            '<label style="margin-top:10px;display:block;">Коментар</label><textarea id="ceNote" maxlength="1000">' + (c.note||"") + '</textarea>' +
            '<div class="err" id="ceErr"></div>' +
            '<div class="modal-foot"><button class="btn btn-primary" id="ceSave">Зберегти</button><button class="btn btn-ghost" id="ceClose">Скасувати</button></div>';
          openModal(html);
          $("ceSave").addEventListener("click", function() {
            var name = $("ceN").value.trim(), phone = $("cePh").value.trim();
            if (!name) { $("ceErr").textContent = "Вкажи ім\'я"; return; }
            var payload = { name: name, note: $("ceNote").value.trim(), birthday: $("ceBd").value || "" };
            if (ME.can_see_phones) payload.phone = phone;
            api("PATCH", "/api/crm/clients/" + id, payload).then(function(r) {
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

        if (document.getElementById("cc-nomark")) {
          document.getElementById("cc-nomark").addEventListener("click", function() {
            closeCtx();
            api("PATCH", "/api/crm/clients/" + id + "/no-marketing", { no_marketing: c.no_marketing ? 0 : 1 })
              .then(function() { renderClientCard(id); });
          });
        }

        if (document.getElementById("cc-norem")) {
          document.getElementById("cc-norem").addEventListener("click", function() {
            closeCtx();
            api("PATCH", "/api/crm/clients/" + id + "/no-reminders", { no_reminders: c.no_reminders ? 0 : 1 })
              .then(function() { renderClientCard(id); });
          });
        }

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
      if (c.no_reminders) {
        var noRemEl = document.createElement("div");
        noRemEl.style.cssText = "font-size:.72rem;color:var(--warn);margin-top:4px;";
        noRemEl.textContent = "🔕 SMS-нагадування вимкнені";
        heroDiv.appendChild(noRemEl);
      }
      if (c.birthday) {
        var bdEl = document.createElement("div");
        bdEl.style.cssText = "font-size:.72rem;color:var(--text-dim);margin-top:4px;";
        bdEl.textContent = "🎂 " + c.birthday.slice(8,10) + "." + c.birthday.slice(5,7) + "." + c.birthday.slice(0,4);
        heroDiv.appendChild(bdEl);
      }
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
        if (ME.can_see_phones) {
          // Копіювання та дзвінок доступні лише коли номер справді повний.
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
          var callBtn = document.createElement("a");
          callBtn.className = "btn btn-ghost btn-sm";
          callBtn.style.cssText = "padding:6px;font-size:.9rem;text-decoration:none;";
          callBtn.title = "Зателефонувати";
          callBtn.textContent = "📲";
          callBtn.href = "tel:" + c.phone.replace(/\s/g, "");
          phCard.appendChild(copyBtn);
          phCard.appendChild(callBtn);
        }
        main.appendChild(phCard);
      }

      // ── Кнопки дій ──────────────────────────────────────────────────
      var actRow = document.createElement("div");
      actRow.style.cssText = "display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:14px;";
      var newAppt = el("button", "btn btn-primary", "📅 Новий запис");
      newAppt.addEventListener("click", function() {
        var lastCompleted = h.find(function(a) { return a.status === "completed"; });
        apptModal({ prefill: {
          client: c,
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
                  return '<option value="' + s.id + '" data-price="' + (s.price || 0) + '">' + s.name + '</option>';
                }).join("");
                var html = '<h3>🎟 Новий абонемент</h3>' +
                  '<div class="muted" style="margin-bottom:10px;">' + c.name + '</div>' +
                  '<label>Послуга</label><select id="sbSvc">' + opts + '</select>' +
                  '<label style="margin-top:10px;display:block;">К-ть сеансів</label>' +
                  '<input type="number" id="sbSess" value="10" min="1" max="100">' +
                  '<label style="margin-top:10px;display:block;">Сума оплати (грн)</label>' +
                  '<input type="number" id="sbPrice" value="0" min="0">' +
                  '<div id="sbCalc" class="muted" style="margin-top:4px;font-size:.75rem;"></div>' +
                  '<label style="margin-top:10px;display:block;">Нотатка</label>' +
                  '<input type="text" id="sbNote" placeholder="Необов\'язково" maxlength="300">' +
                  '<div class="err" id="sbErr"></div>' +
                  '<div class="modal-foot"><button class="btn btn-primary" id="sbSave">Зберегти</button>' +
                  '<button class="btn btn-ghost" id="sbClose">Скасувати</button></div>';
                openModal(html);
                // Авто-розрахунок суми: ціна послуги × сеанси × (1 − знижка)
                function recalcSb() {
                  var sel = $("sbSvc"), priceEl = $("sbPrice"); if (!sel || !priceEl) return;
                  var opt = sel.options[sel.selectedIndex];
                  var priceUAH = opt ? (parseInt(opt.getAttribute("data-price"), 10) || 0) / 100 : 0;
                  var sessions = parseInt($("sbSess").value, 10) || 0;
                  var pct   = subDiscountPct(sessions);
                  var total = subTotalUAH(priceUAH, sessions);
                  priceEl.value = total;
                  var calc = $("sbCalc");
                  if (calc) calc.textContent = (priceUAH > 0 && sessions > 0)
                    ? uahGroup(priceUAH) + " грн × " + sessions + (pct > 0 ? " − " + pct + "%" : "") + " = " + uahGroup(total) + " грн"
                    : "";
                }
                $("sbSvc").addEventListener("change", recalcSb);
                $("sbSess").addEventListener("input", recalcSb);
                recalcSb();
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
    filterBar.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;";
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
    var today = todayStr();
    function addDaysStr(dateStr, n) {
      var d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + n);
      return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
    }
    var TRAFFIC_PERIODS = [
      { label: "Вчора", from: addDaysStr(today, -1), to: addDaysStr(today, -1) },
      { label: "Сьогодні", from: today, to: today },
      { label: "10 днів", from: addDaysStr(today, -9), to: today },
      { label: "30 днів", from: addDaysStr(today, -29), to: today }
    ];
    var trafficPeriod = TRAFFIC_PERIODS[3];

    function load() {
      // Показуємо спінер лише якщо контент ще не завантажений
      if (!main.dataset.loaded) main.innerHTML = '<div class="empty">Завантаження…</div>';
      var btn = document.getElementById("traffic-refresh");
      if (btn) { btn.textContent = "⟳"; btn.disabled = true; }

      api("GET", "/api/crm/analytics/visits?from=" + trafficPeriod.from + "&to=" + trafficPeriod.to).then(function(res) {
        if (!res.j.ok) { main.innerHTML = '<div class="empty">Помилка завантаження</div>'; return; }
        main.dataset.loaded = "1";
        var d = res.j;
        main.innerHTML = "";

      var periodBar = document.createElement("div");
      periodBar.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:14px;";
      TRAFFIC_PERIODS.forEach(function(p) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn-sm " + (p === trafficPeriod ? "btn-primary" : "btn-ghost");
        b.textContent = p.label;
        b.addEventListener("click", function() { if (p !== trafficPeriod) { trafficPeriod = p; load(); } });
        periodBar.appendChild(b);
      });
      main.appendChild(periodBar);

      function sec(html) {
        var s = document.createElement("div");
        s.style.cssText = "background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:14px;";
        s.innerHTML = html; return s;
      }
      function ttl(t) { return '<div style="font-family:\'Playfair Display\',serif;color:var(--cream);font-size:1rem;font-weight:500;margin-bottom:14px;">'+t+'</div>'; }

      /* ---- KPI ---- */
      var kpi = d.kpi || {};
      var kpiRow = document.createElement("div");
      kpiRow.style.cssText = "display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:14px;";
      [
        { icon:"👁", label:"Перегляди · " + trafficPeriod.label, v: (kpi.period||{}).n||0 },
        { icon:"👤", label:"Унікальні · " + trafficPeriod.label, v: (kpi.period||{}).u||0 },
      ].forEach(function(k) {
        var c = document.createElement("div");
        c.style.cssText = "background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 14px;";
        c.innerHTML = '<div style="font-size:1.4rem;margin-bottom:6px;">'+k.icon+'</div>'+
          '<div style="font-size:1.3rem;font-weight:700;color:var(--cream);font-family:\'Playfair Display\',serif;">'+k.v+'</div>'+
          '<div style="font-size:.72rem;color:var(--text-dim);margin-top:3px;">'+k.label+'</div>';
        kpiRow.appendChild(c);
      });
      main.appendChild(kpiRow);

      /* ---- Відвідування по днях (area chart) ---- */
      var vdays = d.visits_by_day || [];
      if (vdays.length) {
        var W=860,H=120,PL=42,PR=10,PT=10,PB=20;
        var pw=W-PL-PR, ph=H-PT-PB;
        var maxV = Math.max.apply(null, vdays.map(function(x){return x.total||0;})) || 1;
        var n = vdays.length;
        var pts  = vdays.map(function(v,i){ var x = n === 1 ? PL + pw / 2 : PL + i / (n - 1) * pw; return [x, PT+ph-(v.total||0)/maxV*ph, v]; });
        var ptsU = vdays.map(function(v,i){ var x = n === 1 ? PL + pw / 2 : PL + i / (n - 1) * pw; return [x, PT+ph-(v.uniq||0)/maxV*ph,  v]; });

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
        main.appendChild(sec(ttl("👁 Відвідування · " + trafficPeriod.label)+legend+svg));
      } else {
        main.appendChild(sec(ttl("👁 Відвідування · " + trafficPeriod.label)+'<div class="empty" style="padding:20px 0;">Даних за цей період поки немає</div>'));
      }

      /* ---- Середній рядок: сторінки + джерела ---- */
      var midRow = document.createElement("div");
      /* auto-fit/minmax замість фіксованих 1fr 1fr — на вузькому екрані
         телефону дві колонки по ~170px ламали текст/бари, тепер блоки
         складаються в один стовпець, коли не влазять по 280px. */
      midRow.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-bottom:14px;";

      // Топ сторінок
      var topPages = d.top_pages || [];
      var maxP = Math.max.apply(null, topPages.map(function(p){return p.total||0;})) || 1;
      var pgHtml = ttl("📄 Топ сторінок · " + trafficPeriod.label);
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
      var srcHtml = ttl("📡 Джерела трафіку · " + trafficPeriod.label);
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
      /* Було 3 фіксовані колонки — на телефоні кожна ставала ~110px і
         сітка "по годинах" (8 колонок всередині) ставала нечитабельною.
         auto-fit складає блоки в один стовпець, доки не влазять по 240px. */
      botRow.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-bottom:14px;";

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
      var hourHtml = ttl("🕐 Активність по годинах · " + trafficPeriod.label);
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
      '<label>Опис (необов\'язково)</label><textarea id="sDescription" maxlength="500" rows="2" placeholder="Наприклад: У вартість входять рушник, капці…"></textarea>' +
      '<div class="err" id="sErr"></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" id="sCancel">Скасувати</button><button class="btn btn-primary" id="sSave">Зберегти</button></div>'
    );
    if (s) {
      $("sName").value = s.name; $("sDur").value = s.duration_min; $("sPrice").value = (s.price / 100) || 0;
      $("sDescription").value = s.description || "";
    }
    $("sCancel").addEventListener("click", closeModal);
    $("sSave").addEventListener("click", function () {
      var name = $("sName").value.trim(), dur = parseInt($("sDur").value, 10), price = Math.round(parseFloat($("sPrice").value || 0) * 100);
      if (!name || !(dur > 0)) { $("sErr").textContent = "Вкажіть назву й тривалість"; return; }
      var body = { name: name, duration_min: dur, price: price, description: $("sDescription").value.trim() };
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
          var hidden = m.show_on_site != null && !m.show_on_site;
          info.appendChild(el("div", "t", m.name + (m.last_name ? " " + m.last_name : "") + (hidden ? "  🚫 приховано з сайту" : "")));
          info.appendChild(el("div", "sub", (m.level || "Майстер") + " · " + (m.phone || "—") + " · " + svcCount + " послуг"));
          row.appendChild(info); row.appendChild(el("span", "sp"));
          var prof = el("button", "btn btn-sm btn-ghost", "Профіль"); prof.addEventListener("click", function () { masterModal(m); });
          var sch = el("button", "btn btn-sm btn-ghost", "Графік"); sch.addEventListener("click", function () {
            var mastersTabIdx = TABS.findIndex(function(t){return t.id==="masters";});
            scheduleEditPage(m, todayStr(), "masters");
          });
          var off = el("button", "btn btn-sm btn-ghost", "Вихідні"); off.addEventListener("click", function () { timeoffModal(m); });
          var pay = el("button", "btn btn-sm btn-ghost", "💰 Зарплата"); pay.addEventListener("click", function () { salaryModal(m); });
          var del = el("button", "btn btn-sm btn-ghost", "Видалити");
          del.addEventListener("click", function () { if (confirm("Видалити майстра?")) api("DELETE", "/api/crm/masters/" + m.id).then(load); });
          row.appendChild(prof); row.appendChild(sch); row.appendChild(off); row.appendChild(pay); row.appendChild(del);
          item.appendChild(row); listEl.appendChild(item);
        });
        if (!masters.length) listEl.appendChild(el("div", "empty", "Майстрів ще немає"));
      });
    }
    window.__reloadMasters = load; load();
  }

  /* ── Зарплата майстра: типовий % + персональні ставки по послугах ── */
  function salaryModal(m) {
    openModal('<h3>💰 Зарплата — ' + m.name + (m.last_name ? " " + m.last_name : "") + '</h3><div id="payBody"><div class="empty">Завантаження…</div></div>');
    api("GET", "/api/crm/masters/" + m.id + "/pay").then(function (r) {
      if (!(r.j && r.j.ok)) { $("payBody").innerHTML = '<div class="empty">Помилка завантаження</div>'; return; }
      var d = r.j;
      function grn(k) { return Math.round((k || 0) / 100).toLocaleString("uk-UA") + " грн"; }
      var ovMap = {}; (d.overrides || []).forEach(function (o) { ovMap[o.service_id] = o; });
      var subOvMap = {}; (d.sub_overrides || []).forEach(function (o) { subOvMap[o.service_id] = o.value; });

      var html = '';
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">' +
        [["Сьогодні", d.earnings.today], ["Тиждень", d.earnings.week], ["Місяць", d.earnings.month]].map(function (x) {
          return '<div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:10px 6px;text-align:center;">' +
            '<div style="font-size:.68rem;color:var(--text-dim);margin-bottom:3px;">' + x[0] + '</div>' +
            '<div style="font-weight:700;color:var(--cream);font-size:.92rem;">' + grn(x[1]) + '</div></div>';
        }).join("") + '</div>';

      // ── Перемикач вкладок ──
      html += '<div style="display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid var(--line);">' +
        '<button type="button" class="btn btn-sm" id="payTabBtnRegular" style="border-radius:8px 8px 0 0;">Звичайні візити</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" id="payTabBtnSub" style="border-radius:8px 8px 0 0;">Розрахунок за абонемент</button>' +
        '</div>';

      // ── Вкладка 1: звичайні візити ──
      html += '<div id="payTabRegular">';
      html += '<div class="sub" style="margin-bottom:12px;">Заробіток рахується із <b>завершених</b> візитів. <b>Новий</b> — перший завершений візит клієнта у цього майстра; <b>повторний</b> — усі наступні.</div>';
      var payNotSet = d.master.pay_percent == null;
      if (payNotSet) {
        html += '<div style="background:#fff4e0;border:1px solid #e6c789;border-radius:10px;padding:9px 12px;margin-bottom:10px;font-size:.8rem;color:#8a6414;">' +
          '⚠️ Відсоток оплати ще не задано — заробіток рахуватиметься як 0 грн, доки ви не вкажете %.</div>';
      }
      html += '<label>Типовий відсоток від ціни послуги</label>' +
        '<div style="display:flex;flex-direction:column;gap:6px;">' +
        '<div style="display:flex;align-items:center;gap:8px;"><span class="muted" style="min-width:88px;">Новий клієнт:</span>' +
        '<input type="number" id="payDef" min="0" max="100" step="0.5" style="width:100px;" value="' + (d.master.pay_percent != null ? d.master.pay_percent : "") + '" placeholder="не задано"><span class="muted">%</span></div>' +
        '<div style="display:flex;align-items:center;gap:8px;"><span class="muted" style="min-width:88px;">Повторний:</span>' +
        '<input type="number" id="payDefRet" min="0" max="100" step="0.5" style="width:100px;" value="' + (d.master.pay_percent_return != null ? d.master.pay_percent_return : "") + '" placeholder="як новий"><span class="muted">% (порожньо — як для нового)</span></div>' +
        '</div>';
      html += '<div style="margin-top:14px;margin-bottom:6px;font-size:.85rem;font-weight:600;color:var(--cream);">Ставки по послугах</div>';
      if ((d.services || []).length > 5) {
        html += '<input type="text" id="payServiceSearch" placeholder="🔍 Пошук послуги…" style="margin-bottom:8px;">';
      }
      html += '<div id="payServiceList" style="max-height:290px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;">';
      if (!(d.services || []).length) html += '<div class="empty">У майстра немає активних послуг</div>';
      (d.services || []).forEach(function (s) {
        var o = ovMap[s.id];
        var mode = o ? o.mode : "default";
        var val = o ? (o.mode === "fixed" ? Math.round(o.value / 100) : o.value) : "";
        var valRet = (o && o.value_return != null) ? (o.mode === "fixed" ? Math.round(o.value_return / 100) : o.value_return) : "";
        html += '<div data-ps="' + s.id + '" data-name="' + s.name.toLowerCase().replace(/"/g, "&quot;") + '" style="padding:9px 10px;border-bottom:1px solid var(--line);">' +
          '<div style="font-size:.78rem;color:var(--cream);margin-bottom:6px;">' + s.name + ' <span class="muted">· ' + Math.round((s.price || 0) / 100) + ' грн</span></div>' +
          '<select data-mode style="width:100%;font-size:.8rem;padding:6px 8px;margin-bottom:6px;">' +
            '<option value="default"' + (mode === "default" ? " selected" : "") + '>Типовий %</option>' +
            '<option value="percent"' + (mode === "percent" ? " selected" : "") + '>Свій відсоток</option>' +
            '<option value="fixed"' + (mode === "fixed" ? " selected" : "") + '>Фікс. грн за візит</option>' +
          '</select>' +
          '<div data-vals style="display:' + (mode === "default" ? "none" : "flex") + ';gap:6px;align-items:center;flex-wrap:wrap;">' +
            '<span class="muted" style="font-size:.72rem;">новий:</span>' +
            '<input data-val type="number" min="0" step="0.5" style="width:84px;font-size:.8rem;padding:6px 8px;" value="' + val + '">' +
            '<span class="muted" style="font-size:.72rem;">повторний:</span>' +
            '<input data-val-ret type="number" min="0" step="0.5" style="width:84px;font-size:.8rem;padding:6px 8px;" value="' + valRet + '" placeholder="як новий">' +
          '</div></div>';
      });
      html += '</div></div>'; // /payServiceList /payTabRegular

      // ── Вкладка 2: розрахунок за абонемент ──
      html += '<div id="payTabSub" style="display:none;">';
      html += '<div class="sub" style="margin-bottom:12px;">Якщо візит клієнта зарахований з абонементу, майстер, що продав цей абонемент, отримує окрему (типово вищу) ставку замість звичайної нової/повторної.</div>';
      html += '<label>Типовий відсоток за абонементський візит</label>' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
        '<input type="number" id="paySubDef" min="0" max="100" step="0.5" style="width:100px;" value="' + (d.master.pay_percent_subscription != null ? d.master.pay_percent_subscription : "") + '" placeholder="як для нового"><span class="muted">% (порожньо — як для нового клієнта)</span></div>';
      html += '<div style="margin-top:14px;margin-bottom:6px;font-size:.85rem;font-weight:600;color:var(--cream);">Ставки за абонемент по послугах</div>';
      if ((d.services || []).length > 5) {
        html += '<input type="text" id="paySubServiceSearch" placeholder="🔍 Пошук послуги…" style="margin-bottom:8px;">';
      }
      html += '<div id="paySubServiceList" style="max-height:290px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;">';
      if (!(d.services || []).length) html += '<div class="empty">У майстра немає активних послуг</div>';
      (d.services || []).forEach(function (s) {
        var subVal = subOvMap[s.id] != null ? subOvMap[s.id] : "";
        html += '<div data-pss="' + s.id + '" data-name="' + s.name.toLowerCase().replace(/"/g, "&quot;") + '" style="padding:9px 10px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
          '<div style="font-size:.78rem;color:var(--cream);min-width:0;">' + s.name + ' <span class="muted">· ' + Math.round((s.price || 0) / 100) + ' грн</span></div>' +
          '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' +
            '<input data-sub-val type="number" min="0" max="100" step="0.5" style="width:80px;font-size:.8rem;padding:6px 8px;" value="' + subVal + '" placeholder="типовий">' +
            '<span class="muted" style="font-size:.72rem;">%</span>' +
          '</div></div>';
      });
      html += '</div></div>'; // /paySubServiceList /payTabSub

      html += '<div class="err" id="payErr"></div>' +
        '<div class="modal-foot"><button class="btn btn-primary" id="paySave">Зберегти</button><button class="btn btn-ghost" id="payClose">Закрити</button></div>';
      $("payBody").innerHTML = html;

      $("payTabBtnRegular").addEventListener("click", function () {
        $("payTabRegular").style.display = ""; $("payTabSub").style.display = "none";
        $("payTabBtnRegular").className = "btn btn-sm"; $("payTabBtnSub").className = "btn btn-sm btn-ghost";
      });
      $("payTabBtnSub").addEventListener("click", function () {
        $("payTabRegular").style.display = "none"; $("payTabSub").style.display = "";
        $("payTabBtnRegular").className = "btn btn-sm btn-ghost"; $("payTabBtnSub").className = "btn btn-sm";
      });

      $("payBody").querySelectorAll("[data-ps]").forEach(function (row) {
        var sel = row.querySelector("[data-mode]"), vals = row.querySelector("[data-vals]");
        sel.addEventListener("change", function () {
          var off = sel.value === "default";
          vals.style.display = off ? "none" : "flex";
          if (off) { row.querySelector("[data-val]").value = ""; row.querySelector("[data-val-ret]").value = ""; }
        });
      });

      var svcSearch = $("payServiceSearch");
      if (svcSearch) {
        svcSearch.addEventListener("input", function () {
          var q = svcSearch.value.trim().toLowerCase();
          var anyVisible = false;
          $("payServiceList").querySelectorAll("[data-ps]").forEach(function (row) {
            var match = !q || row.getAttribute("data-name").indexOf(q) > -1;
            row.style.display = match ? "" : "none";
            if (match) anyVisible = true;
          });
          var emptyEl = $("payServiceEmpty");
          if (!anyVisible) {
            if (!emptyEl) {
              emptyEl = document.createElement("div");
              emptyEl.id = "payServiceEmpty";
              emptyEl.className = "empty";
              emptyEl.textContent = "Нічого не знайдено";
              $("payServiceList").appendChild(emptyEl);
            }
          } else if (emptyEl) { emptyEl.remove(); }
        });
      }

      var subSvcSearch = $("paySubServiceSearch");
      if (subSvcSearch) {
        subSvcSearch.addEventListener("input", function () {
          var q = subSvcSearch.value.trim().toLowerCase();
          var anyVisible = false;
          $("paySubServiceList").querySelectorAll("[data-pss]").forEach(function (row) {
            var match = !q || row.getAttribute("data-name").indexOf(q) > -1;
            row.style.display = match ? "" : "none";
            if (match) anyVisible = true;
          });
          var emptyEl = $("paySubServiceEmpty");
          if (!anyVisible) {
            if (!emptyEl) {
              emptyEl = document.createElement("div");
              emptyEl.id = "paySubServiceEmpty";
              emptyEl.className = "empty";
              emptyEl.textContent = "Нічого не знайдено";
              $("paySubServiceList").appendChild(emptyEl);
            }
          } else if (emptyEl) { emptyEl.remove(); }
        });
      }

      $("paySave").addEventListener("click", function () {
        var overrides = [], bad = null;
        $("payBody").querySelectorAll("[data-ps]").forEach(function (row) {
          var mode = row.querySelector("[data-mode]").value;
          if (mode === "default") return;
          var num = parseFloat(row.querySelector("[data-val]").value);
          var retRaw = row.querySelector("[data-val-ret]").value.trim();
          if (!isFinite(num) || num < 0) { bad = "Вкажіть ставку (новий клієнт) для всіх послуг зі своєю ставкою"; return; }
          if (mode === "percent" && num > 100) { bad = "Відсоток не може перевищувати 100"; return; }
          var retVal = null;
          if (retRaw !== "") {
            var retNum = parseFloat(retRaw);
            if (!isFinite(retNum) || retNum < 0) { bad = "Некоректна ставка для повторного клієнта"; return; }
            if (mode === "percent" && retNum > 100) { bad = "Відсоток (повторний) не може перевищувати 100"; return; }
            retVal = mode === "fixed" ? Math.round(retNum * 100) : retNum;
          }
          overrides.push({
            service_id: parseInt(row.getAttribute("data-ps"), 10),
            mode: mode,
            value: mode === "fixed" ? Math.round(num * 100) : num, // фікс — у копійках
            value_return: retVal, // null = як для нового
          });
        });
        if (bad) { $("payErr").textContent = bad; return; }
        var subOverrides = [];
        $("payBody").querySelectorAll("[data-pss]").forEach(function (row) {
          var raw = row.querySelector("[data-sub-val]").value.trim();
          if (raw === "") return;
          var num = parseFloat(raw);
          if (!isFinite(num) || num < 0 || num > 100) { bad = "Відсоток за абонемент має бути 0–100"; return; }
          subOverrides.push({ service_id: parseInt(row.getAttribute("data-pss"), 10), value: num });
        });
        if (bad) { $("payErr").textContent = bad; return; }
        var def = $("payDef").value.trim();
        var defRet = $("payDefRet").value.trim();
        var defSub = $("paySubDef").value.trim();
        api("PATCH", "/api/crm/masters/" + m.id + "/pay", {
          pay_percent: def === "" ? null : def,
          pay_percent_return: defRet === "" ? null : defRet,
          pay_percent_subscription: defSub === "" ? null : defSub,
          overrides: overrides,
          sub_overrides: subOverrides,
        }).then(function (r2) {
          if (!(r2.j && r2.j.ok)) { $("payErr").textContent = (r2.j && r2.j.error) || "Помилка збереження"; return; }
          closeModal();
        });
      });
      $("payClose").addEventListener("click", closeModal);
    });
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
      '<label>Посада</label><select id="mmLevel"><option value="Майстер">Майстер</option><option value="Топ Майстер">Топ Майстер</option></select>' +
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
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid #f0f2ee;">' +
        '<div><div style="font-size:.88rem;font-weight:600;color:#1a2016;">Показувати на сайті</div>' +
        '<div style="font-size:.75rem;color:#6a7a60;">Вимкни, щоб прибрати з лендінгу й онлайн-запису — у CRM майстер і далі працює як завжди</div></div>' +
        '<label style="position:relative;display:inline-flex;width:44px;height:24px;flex-shrink:0;">' +
          '<input type="checkbox" id="mmShowOnSite" style="opacity:0;width:0;height:0;position:absolute;" />' +
          '<span id="mmSosTrack" style="position:absolute;inset:0;border-radius:12px;background:#ccc;transition:.2s;cursor:pointer;"></span>' +
          '<span id="mmSosThumb" style="position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.3);pointer-events:none;"></span>' +
        '</label>' +
      '</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid #f0f2ee;">' +
        '<div><div style="font-size:.88rem;font-weight:600;color:#1a2016;">Редагувати свій графік роботи</div>' +
        '<div style="font-size:.75rem;color:#6a7a60;">Майстер зможе сам міняти графік, вихідні й перерви у вкладці «Графік роботи» — лише для себе</div></div>' +
        '<label style="position:relative;display:inline-flex;width:44px;height:24px;flex-shrink:0;">' +
          '<input type="checkbox" id="mmEditSchedule" style="opacity:0;width:0;height:0;position:absolute;" />' +
          '<span id="mmEsTrack" style="position:absolute;inset:0;border-radius:12px;background:#ccc;transition:.2s;cursor:pointer;"></span>' +
          '<span id="mmEsThumb" style="position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.3);pointer-events:none;"></span>' +
        '</label>' +
      '</div>' +
      '<div class="err" id="mmErr"></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" id="mmCancel">Скасувати</button><button class="btn btn-primary" id="mmSave">Зберегти</button></div>'
    );
    var showOnSite = !m || m.show_on_site == null || !!m.show_on_site; // нові й старі без поля — за замовчуванням увімкнено
    if (m) {
      $("mmFirstName").value = m.name || "";
      $("mmLastName").value = m.last_name || "";
      $("mmDisplayName").value = m.name || "";
      $("mmLevel").value = m.level || "Майстер";
      $("mmPhone").value = m.phone || "";
      $("mmCanSeePhones").checked = !!m.can_see_phones;
      if (m.can_see_phones) { $("mmCspTrack").style.background = "#3d5430"; $("mmCspThumb").style.left = "23px"; }
      $("mmEditSchedule").checked = !!m.can_edit_own_schedule;
      if (m.can_edit_own_schedule) { $("mmEsTrack").style.background = "#3d5430"; $("mmEsThumb").style.left = "23px"; }
    }
    $("mmShowOnSite").checked = showOnSite;
    if (showOnSite) { $("mmSosTrack").style.background = "#3d5430"; $("mmSosThumb").style.left = "23px"; }
    $("mmCanSeePhones").addEventListener("change", function() {
      $("mmCspTrack").style.background = this.checked ? "#3d5430" : "#ccc";
      $("mmCspThumb").style.left = this.checked ? "23px" : "3px";
    });
    $("mmShowOnSite").addEventListener("change", function() {
      $("mmSosTrack").style.background = this.checked ? "#3d5430" : "#ccc";
      $("mmSosThumb").style.left = this.checked ? "23px" : "3px";
    });
    $("mmEditSchedule").addEventListener("change", function() {
      $("mmEsTrack").style.background = this.checked ? "#3d5430" : "#ccc";
      $("mmEsThumb").style.left = this.checked ? "23px" : "3px";
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
        can_see_phones: $("mmCanSeePhones").checked ? 1 : 0,
        show_on_site: $("mmShowOnSite").checked ? 1 : 0,
        can_edit_own_schedule: $("mmEditSchedule").checked ? 1 : 0
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
      if (mBtns[gi] && gi < mBtns.length - 1) {
        // не остання кнопка (⋯"Ще") — це справжня вкладка нижньої панелі
        mBtns[gi].click();
      } else {
        // вкладка живе лише в шторці "Ще" (desktop) — activateTab тут поза
        // областю видимості, тож клікаємо відповідну кнопку верхньої панелі
        // вкладок, яка завжди в DOM незалежно від мобільного/десктопного виду
        var topBtn = document.querySelectorAll(".tab")[gi];
        if (topBtn) topBtn.click();
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
  /* ── Масова розсилка (тільки власник) ────────────────────────────
     Надсилає той самий драйвер, що й нагадування: Viber із фолбеком на
     SMS. Відправка не миттєва — запит лише ставить у чергу, розсилає
     планувальник порціями, тому великий список не вішає інтерфейс. */
  function renderBroadcast() {
    var main = $("main"); main.innerHTML = "";
    var bar = el("div", "bar"); bar.appendChild(el("h2", null, "📣 Масова розсилка"));
    main.appendChild(bar);

    var mode = "all";               // all | selected
    var selected = {};              // client_id -> true
    var allClients = [];

    /* --- Текст --- */
    var card = el("div", "item"); card.style.marginBottom = "16px";
    card.appendChild(el("div", "t", "Текст повідомлення"));
    var ta = document.createElement("textarea");
    ta.maxLength = 500; ta.rows = 5;
    ta.placeholder = "Напр.: Вітаємо! У серпні знижка 15% на масаж спини. Записатися: massage-oliva.com";
    ta.style.cssText = "width:100%;margin-top:8px;";
    card.appendChild(ta);
    var counter = el("div", "sub"); counter.style.marginTop = "4px";
    card.appendChild(counter);
    function updCounter() {
      var n = ta.value.length;
      /* Кирилиця в SMS — 70 символів на частину, і кожна частина
         тарифікується окремо. Показуємо, щоб текст не коштував утричі. */
      var parts = n === 0 ? 0 : (n <= 70 ? 1 : Math.ceil(n / 67));
      counter.textContent = n + " символів · " + parts + " SMS-частин" + (parts > 1 ? " (дорожче)" : "");
      counter.style.color = parts > 1 ? "var(--warn)" : "var(--text-dim)";
    }
    ta.addEventListener("input", updCounter); updCounter();
    main.appendChild(card);

    /* --- Тестова SMS на один номер --- */
    var testCard = el("div", "item"); testCard.style.marginBottom = "16px";
    testCard.appendChild(el("div", "t", "🧪 Тестова SMS (лише на один номер)"));
    var testHint = el("div", "sub"); testHint.style.margin = "6px 0 8px";
    testHint.textContent = "Введіть номер — надішлеться рівно одне повідомлення тільки на нього. Іншим клієнтам нічого не піде. Візьметься текст зверху (або типовий тестовий).";
    testCard.appendChild(testHint);
    var testRow = el("div", "acts"); testRow.style.cssText = "gap:8px;flex-wrap:nowrap;";
    var testPhone = document.createElement("input");
    testPhone.type = "tel"; testPhone.placeholder = "напр. 0671234567";
    testPhone.style.cssText = "flex:1;min-width:0;";
    var testBtn = el("button", "btn btn-primary btn-sm", "Надіслати тест");
    testBtn.style.flexShrink = "0";
    testRow.appendChild(testPhone); testRow.appendChild(testBtn);
    testCard.appendChild(testRow);
    var testMsg = el("div", "sub"); testMsg.style.marginTop = "8px";
    testCard.appendChild(testMsg);
    testBtn.addEventListener("click", function () {
      var phone = testPhone.value.trim();
      if (!phone) { testMsg.style.color = "var(--err)"; testMsg.textContent = "Введіть номер"; return; }
      var text = ta.value.trim() || "Тестове повідомлення від Oliva. Якщо ви це бачите — SMS працює.";
      testBtn.disabled = true; testBtn.textContent = "Надсилаю…";
      testMsg.style.color = "var(--text-dim)"; testMsg.textContent = "";
      api("POST", "/api/crm/broadcasts/test", { phone: phone, text: text }).then(function (r) {
        testBtn.disabled = false; testBtn.textContent = "Надіслати тест";
        if (r.j && r.j.ok) {
          testMsg.style.color = "var(--ok)";
          testMsg.textContent = "✓ Надіслано на " + (r.j.phone || phone) + ". Перевірте телефон.";
        } else {
          testMsg.style.color = "var(--err)";
          testMsg.textContent = "✗ " + ((r.j && r.j.error) || "помилка відправки");
        }
      }).catch(function () {
        testBtn.disabled = false; testBtn.textContent = "Надіслати тест";
        testMsg.style.color = "var(--err)"; testMsg.textContent = "✗ помилка мережі";
      });
    });
    main.appendChild(testCard);

    /* --- Кому --- */
    var whoCard = el("div", "item"); whoCard.style.marginBottom = "16px";
    whoCard.appendChild(el("div", "t", "Кому надіслати"));
    var modeRow = el("div", "acts"); modeRow.style.margin = "8px 0";
    var bAll = el("button", "btn btn-primary btn-sm", "Усім клієнтам");
    var bSel = el("button", "btn btn-ghost btn-sm", "Обрати вручну");
    modeRow.appendChild(bAll); modeRow.appendChild(bSel);
    whoCard.appendChild(modeRow);

    var listWrap = el("div", ""); listWrap.style.display = "none";
    var search = document.createElement("input");
    search.type = "search"; search.placeholder = "Пошук за іменем або телефоном…";
    search.style.cssText = "width:100%;margin-bottom:8px;";
    listWrap.appendChild(search);
    var list = el("div", ""); list.style.cssText = "max-height:320px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;";
    listWrap.appendChild(list);
    whoCard.appendChild(listWrap);

    var cntLine = el("div", "sub"); cntLine.style.marginTop = "8px";
    whoCard.appendChild(cntLine);
    main.appendChild(whoCard);

    function setMode(m) {
      mode = m;
      bAll.className = "btn btn-sm " + (m === "all" ? "btn-primary" : "btn-ghost");
      bSel.className = "btn btn-sm " + (m === "selected" ? "btn-primary" : "btn-ghost");
      listWrap.style.display = m === "selected" ? "block" : "none";
      refreshCount();
    }
    bAll.addEventListener("click", function () { setMode("all"); });
    /* Перезавантажуємо щоразу: клієнта могли додати щойно, в іншій вкладці. */
    bSel.addEventListener("click", function () { setMode("selected"); loadClients(); });

    function renderList(q) {
      list.innerHTML = "";
      var rows = allClients.filter(function (c) {
        if (!q) return true;
        var s = (c.name || "") + " " + (c.phone || "");
        return s.toLowerCase().indexOf(q.toLowerCase()) > -1;
      });
      if (!rows.length) { list.appendChild(el("div", "empty", "Нікого не знайдено")); return; }
      rows.forEach(function (c) {
        var row = el("div", ""); row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--line);";
        var cb = document.createElement("input"); cb.type = "checkbox"; cb.style.cssText = "width:18px;height:18px;flex-shrink:0;";
        cb.checked = !!selected[c.id];
        /* Клієнтів без телефону або з відмовою від розсилок обрати не можна —
           інакше в підсумку буде число, яке сервер однаково відкине. */
        var blocked = !c.phone || c.no_marketing || c.blacklisted;
        cb.disabled = blocked;
        cb.addEventListener("change", function () {
          if (cb.checked) selected[c.id] = true; else delete selected[c.id];
          refreshCount();
        });
        row.appendChild(cb);
        var info = el("div", ""); info.style.cssText = "flex:1;min-width:0;";
        info.innerHTML = '<div style="font-size:.88rem;color:var(--cream);font-weight:600;">' + (c.name || "—") + '</div>' +
          '<div style="font-size:.74rem;color:var(--text-dim);">' + (c.phone || "без телефону") +
          (c.no_marketing ? ' · <span style="color:var(--warn);">відмовився від розсилок</span>' : "") +
          (c.blacklisted ? ' · <span style="color:var(--err);">чорний список</span>' : "") + '</div>';
        row.appendChild(info);
        list.appendChild(row);
      });
    }

    /* Свій ендпоінт, а не /clients: той віддає лише 200 записів за
       останнім візитом, тому щойно доданий клієнт у список не потрапляв. */
    function loadClients() {
      list.innerHTML = '<div class="empty">Завантаження…</div>';
      api("GET", "/api/crm/broadcasts/clients").then(function (r) {
        allClients = (r.j && r.j.clients) || [];
        renderList(search.value.trim());
      });
    }
    var searchTimer = null;
    search.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { renderList(search.value.trim()); }, 200);
    });

    /* Кількість отримувачів рахує сервер — саме він відсіює дублі номерів
       і відмови, тож показане число дорівнює тому, що реально піде. */
    function refreshCount() {
      var body = mode === "all" ? { all: true } : { client_ids: Object.keys(selected) };
      if (mode === "selected" && !Object.keys(selected).length) {
        cntLine.textContent = "Нікого не обрано";
        cntLine.style.color = "var(--text-dim)";
        return;
      }
      api("POST", "/api/crm/broadcasts/preview", body).then(function (r) {
        var j = r.j || {};
        var n = j.recipients || 0;
        var html = '<span style="color:' + (n ? "var(--olive-light)" : "var(--err)") + ';font-weight:600;">Отримають повідомлення: ' + n + '</span>';
        if (j.total != null) {
          /* Розкладка, куди подівся кожен клієнт: без неї число ні з чим
             не звірити й незрозуміло, чому щойно доданий не додався. */
          var parts = [];
          if (j.no_phone)    parts.push(j.no_phone + " без телефону");
          if (j.blacklisted) parts.push(j.blacklisted + " у чорному списку");
          if (j.opted_out)   parts.push(j.opted_out + " відмовились");
          if (j.duplicates)  parts.push(j.duplicates + " дублів номера");
          html += '<div style="font-size:.72rem;color:var(--text-dim);margin-top:3px;">Усього клієнтів: ' + j.total +
            (parts.length ? " · не отримають: " + parts.join(", ") : "") + '</div>';
          if (j.last_client) {
            html += '<div style="font-size:.72rem;margin-top:3px;color:' + (j.last_client.included ? "var(--text-dim)" : "var(--warn)") + ';">' +
              'Останній доданий: ' + j.last_client.name + ' · ' + (j.last_client.phone || "без телефону") +
              (j.last_client.included ? " — у розсилці ✓" : " — не отримає") + '</div>';
          }
        }
        cntLine.innerHTML = html;
      });
    }

    /* --- Відправка --- */
    var sendCard = el("div", "item"); sendCard.style.marginBottom = "16px";
    var sendErr = el("div", "sub"); sendErr.style.cssText = "margin-bottom:8px;color:var(--err);";
    sendCard.appendChild(sendErr);
    var sendBtn = el("button", "btn btn-primary", "📣 Надіслати розсилку");
    sendBtn.addEventListener("click", function () {
      sendErr.textContent = "";
      var text = ta.value.trim();
      if (!text) { sendErr.textContent = "Введіть текст повідомлення"; return; }
      var body = mode === "all" ? { all: true, text: text } : { client_ids: Object.keys(selected), text: text };
      if (mode === "selected" && !body.client_ids.length) { sendErr.textContent = "Оберіть отримувачів"; return; }
      /* Розсилку не відкотиш, тому підтверджуємо з реальним числом. */
      api("POST", "/api/crm/broadcasts/preview", body).then(function (p) {
        var n = (p.j && p.j.recipients) || 0;
        if (!n) { sendErr.textContent = "Немає кому надсилати"; return; }
        if (!confirm("Надіслати повідомлення " + n + " клієнтам? Скасувати відправку буде неможливо.")) return;
        sendBtn.disabled = true; sendBtn.textContent = "Ставимо в чергу…";
        api("POST", "/api/crm/broadcasts", body).then(function (r) {
          sendBtn.disabled = false; sendBtn.textContent = "📣 Надіслати розсилку";
          if (!r.j.ok) { sendErr.textContent = "Помилка: " + (r.j.error || ""); return; }
          ta.value = ""; updCounter(); selected = {}; setMode("all");
          alert("У черзі " + r.j.queued + " повідомлень. Надсилаються порціями — статус видно нижче.");
          loadHistory();
        });
      });
    });
    sendCard.appendChild(sendBtn);
    main.appendChild(sendCard);

    /* --- Історія --- */
    var histBar = el("div", "bar"); histBar.appendChild(el("h2", null, "Історія розсилок"));
    main.appendChild(histBar);
    /* Попередження про драйвер: із console/telegram статус стане
       «надіслано», хоча на телефони клієнтів не піде нічого. Без цього
       рядка така конфігурація виглядає як «розсилка не працює». */
    var drvLine = el("div", ""); drvLine.style.cssText = "display:none;margin-bottom:10px;padding:9px 12px;border-radius:10px;background:rgba(224,129,107,.12);border:1px solid rgba(224,129,107,.4);font-size:.78rem;color:var(--err);line-height:1.45;";
    main.appendChild(drvLine);
    var hist = el("div", ""); main.appendChild(hist);

    function loadHistory() {
      api("GET", "/api/crm/broadcasts").then(function (r) {
        var rows = (r.j && r.j.broadcasts) || [];
        var drv = r.j && r.j.driver;
        /* Попереджаємо лише про console/telegram — вони «ковтають»
           повідомлення. turbosms і alphasms — реальні SMS-канали. */
        if (drv === "console" || drv === "telegram") {
          drvLine.style.display = "block";
          drvLine.innerHTML = "⚠️ Канал відправки зараз: <b>" + drv + "</b> — повідомлення НЕ йдуть на телефони клієнтів" +
            (drv === "console" ? " (лише лог сервера)" : " (лише службовий Telegram-чат студії)") +
            ". Для реальної відправки задай на сервері NOTIFY_DRIVER=alphasms і ALPHASMS_KEY (або turbosms + TURBOSMS_TOKEN).";
        } else {
          drvLine.style.display = "none";
        }
        hist.innerHTML = "";
        if (!rows.length) { hist.appendChild(el("div", "empty", "Розсилок ще не було")); return; }
        var hasPending = false;
        rows.forEach(function (b) {
          if (b.stats && b.stats.queued) hasPending = true;
        });
        rows.forEach(function (b) {
          var s = b.stats || {};
          var it = el("div", "item");
          var when = new Date(b.created_at);
          it.innerHTML =
            '<div class="t">' + (b.text.length > 90 ? b.text.slice(0, 90) + "…" : b.text) + '</div>' +
            '<div class="sub" style="margin-top:5px;">' +
              when.toLocaleDateString("uk-UA") + " " + when.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }) +
              " · всього " + b.total +
              (s.queued ? ' · <span style="color:var(--text-dim);">у черзі ' + s.queued + '</span>' : "") +
              (s.sent ? ' · <span style="color:var(--olive-light);">надіслано ' + s.sent + '</span>' : "") +
              (s.delivered ? ' · <span style="color:var(--ok);">доставлено ' + s.delivered + '</span>' : "") +
              (s.undelivered ? ' · <span style="color:var(--warn);">не доставлено ' + s.undelivered + '</span>' : "") +
              (s.failed ? ' · <span style="color:var(--err);">помилка ' + s.failed + '</span>' : "") +
            '</div>' +
            /* Текст відмови провайдера: саме він каже, ЩО лагодити
               (токен, непогоджений відправник, баланс). */
            ((b.errors && b.errors.length)
              ? '<div style="margin-top:6px;font-size:.72rem;color:var(--err);word-break:break-all;line-height:1.4;">' +
                  b.errors.map(function (e) { return "↳ " + e; }).join("<br>") + '</div>'
              : "");
          if (s.failed) {
            var retryBtn = el("button", "btn btn-ghost btn-sm", "🔄 Повторити невдалі");
            retryBtn.style.marginTop = "8px";
            retryBtn.addEventListener("click", function () {
              retryBtn.disabled = true; retryBtn.textContent = "Ставимо в чергу…";
              api("POST", "/api/crm/broadcasts/" + b.id + "/retry").then(function () { loadHistory(); });
            });
            it.appendChild(retryBtn);
          }
          hist.appendChild(it);
        });
        /* Поки щось у черзі — оновлюємось самі, щоб «у черзі» на очах
           перетікало в «надіслано». Зупиняємось, щойно вкладку покинули
           (main перезаписано) або черга спорожніла. */
        if (hasPending && document.body.contains(hist)) {
          clearTimeout(histTimer);
          histTimer = setTimeout(loadHistory, 5000);
        }
      });
    }
    var histTimer = null;

    setMode("all");
    loadHistory();
  }

  function renderNotif() {
    var main = $("main"); main.innerHTML = "";
    var bar = el("div", "bar"); bar.appendChild(el("h2", null, "Журнал сповіщень"));
    main.appendChild(bar);

    /* ── Баланс SMS-провайдера (AlphaSMS) ──
       Саме поповнення API не підтримує — лише перевірку балансу, тому
       кнопка веде в їхній особистий кабінет, а не оплачує тут напряму. */
    var balCard = el("div", "item"); balCard.style.marginBottom = "16px";
    balCard.appendChild(el("div", "t", "💳 Баланс SMS (AlphaSMS)"));
    var balBody = el("div", "sub"); balBody.style.margin = "8px 0 0";
    balBody.textContent = "Завантаження…";
    balCard.appendChild(balBody);
    main.appendChild(balCard);
    api("GET", "/api/crm/notify-balance").then(function (r) {
      if (!(r.j && r.j.ok)) {
        balBody.innerHTML = '<span style="color:var(--err);">Помилка: ' + ((r.j && r.j.error) || "не вдалось перевірити") + '</span>';
        return;
      }
      if (!r.j.supported) {
        balCard.style.display = "none"; // інший драйвер (console/turbosms) — баланс не показуємо
        return;
      }
      if (r.j.error) {
        balBody.innerHTML = '<span style="color:var(--err);">Помилка: ' + r.j.error + '</span>';
        return;
      }
      balBody.innerHTML = "";
      var row = el("div", "");
      row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;";
      var amt = el("div", "");
      amt.style.cssText = "font-size:1.3rem;font-weight:700;color:var(--cream);font-family:'Playfair Display',serif;";
      amt.textContent = Math.round((r.j.amount || 0) * 100) / 100 + " " + (r.j.currency || "UAH");
      var topUpBtn = document.createElement("a");
      topUpBtn.href = "https://alphasms.ua/panel/"; topUpBtn.target = "_blank"; topUpBtn.rel = "noopener noreferrer";
      topUpBtn.className = "btn btn-sm btn-primary";
      topUpBtn.textContent = "Поповнити →";
      row.appendChild(amt); row.appendChild(topUpBtn);
      balBody.appendChild(row);
      var hint = el("div", ""); hint.style.cssText = "font-size:.7rem;color:var(--text-dim);margin-top:6px;";
      hint.textContent = "Оплата — на стороні AlphaSMS (кнопка відкриє їхній особистий кабінет у новій вкладці).";
      balBody.appendChild(hint);
    });

    /* ── SMS-сповіщення клієнтам: перемикачі тригерів (аналог Bookon) ── */
    var remCard = el("div", "item"); remCard.style.marginBottom = "16px";
    remCard.appendChild(el("div", "t", "📨 SMS-сповіщення клієнтам"));
    var remHint = el("div", "sub"); remHint.style.margin = "6px 0 4px";
    remHint.textContent = "Тексти короткі й фіксовані (1 SMS-частина). День народження клієнта вводиться в його картці (⋮ → Редагувати).";
    remCard.appendChild(remHint);

    function togRow(title, whenTxt, smsTxt) {
      var row = el("div", "");
      row.style.cssText = "border-top:1px solid var(--line);padding:10px 0 12px;";
      var top = document.createElement("label");
      top.style.cssText = "display:flex;align-items:flex-start;gap:10px;cursor:pointer;";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.style.cssText = "width:19px;height:19px;accent-color:var(--olive-light);flex-shrink:0;margin-top:2px;";
      var tt = el("div", "");
      tt.innerHTML = '<div style="font-size:.9rem;font-weight:600;color:var(--cream);">' + title + '</div>' +
        '<div style="font-size:.72rem;color:var(--text-dim);margin-top:2px;">' + whenTxt + '</div>';
      top.appendChild(cb); top.appendChild(tt);
      row.appendChild(top);
      if (smsTxt) {
        var pv = el("div", "");
        pv.style.cssText = "margin:8px 0 0 29px;padding:8px 10px;background:var(--panel-2);border-radius:8px;font-size:.74rem;color:var(--text);white-space:pre-line;line-height:1.4;";
        pv.textContent = smsTxt;
        row.appendChild(pv);
      }
      remCard.appendChild(row);
      return cb;
    }

    var cbConfirm = togRow("Підтвердження запису",
      "Коли майстер підтверджує запис у CRM",
      "Ваш запис 27.07.2026 о 14:10 підтверджений. До зустрічі!\n{телефон студії}");

    /* Нагадування — з полями часу */
    var remRow = el("div", "");
    remRow.style.cssText = "border-top:1px solid var(--line);padding:10px 0 12px;";
    remRow.innerHTML = '<div style="font-size:.9rem;font-weight:600;color:var(--cream);">Нагадування про візит</div>' +
      '<div style="font-size:.72rem;color:var(--text-dim);margin-top:2px;">Автоматично всім клієнтам; вимкнути окремому — в його картці (⋮ → Вимкнути SMS-нагадування)</div>';
    function hoursInput() {
      var inp = document.createElement("input");
      inp.type = "number"; inp.min = "0"; inp.max = "240"; inp.step = "0.5";
      inp.style.cssText = "width:84px;";
      return inp;
    }
    var rem1 = hoursInput(), rem2 = hoursInput();
    function hrLine(lbl, inp) {
      var w = el("div", ""); w.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;";
      var l = el("span", "muted", lbl); l.style.minWidth = "50px";
      w.appendChild(l); w.appendChild(inp);
      w.appendChild(el("span", "muted", "год до візиту (0 — вимк)"));
      return w;
    }
    var hrWrap = el("div", "");
    hrWrap.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:8px;";
    hrWrap.appendChild(hrLine("Перше:", rem1));
    hrWrap.appendChild(hrLine("Друге:", rem2));
    remRow.appendChild(hrWrap);
    remCard.appendChild(remRow);

    var cbResched = togRow("Перенесення візиту",
      "Одразу після зміни дати або часу запису",
      "Ваш візит перенесено на 27.07.2026 о 14:10. Чекаємо!\n{телефон студії}");
    var cbCancel = togRow("Скасування візиту",
      "Одразу після скасування запису",
      "Відміна запису. А ми так чекали вас :( До зустрічі!");
    var cbBday = togRow("Привітання з днем народження",
      "О 10:00 у день народження, раз на рік (потрібна дата в картці клієнта; не шлеться відмовникам від розсилок)",
      "З Днем народження! Чекаємо на вас.\n{телефон студії}");

    var remActs = el("div", "acts"); remActs.style.marginTop = "4px";
    var remSave = el("button", "btn btn-primary btn-sm", "Зберегти налаштування");
    remActs.appendChild(remSave);
    remCard.appendChild(remActs);
    var remMsg = el("div", "sub"); remMsg.style.marginTop = "6px";
    remCard.appendChild(remMsg);

    api("GET", "/api/crm/notify-settings").then(function (r) {
      if (!(r.j && r.j.ok)) return;
      rem1.value = r.j.reminder1_hours;
      rem2.value = r.j.reminder2_hours;
      cbConfirm.checked      = !!r.j.notif_confirm;
      cbResched.checked      = !!r.j.notif_reschedule;
      cbCancel.checked       = !!r.j.notif_cancel;
      cbBday.checked         = !!r.j.notif_birthday;
    });
    remSave.addEventListener("click", function () {
      remSave.disabled = true;
      api("PATCH", "/api/crm/notify-settings", {
        reminder1_hours: rem1.value, reminder2_hours: rem2.value,
        notif_confirm: cbConfirm.checked,
        notif_reschedule: cbResched.checked, notif_cancel: cbCancel.checked,
        notif_birthday: cbBday.checked,
      }).then(function (r) {
        remSave.disabled = false;
        if (r.j && r.j.ok) { remMsg.style.color = "var(--ok)"; remMsg.textContent = "✓ Збережено — діє одразу."; }
        else { remMsg.style.color = "var(--err)"; remMsg.textContent = "✗ " + ((r.j && r.j.error) || "Помилка збереження"); }
      });
    });
    main.appendChild(remCard);

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
          pushStatus.textContent = "📊 Підписок у базі: " + r.j.count + " · доставлено: " + r.j.sent +
            (r.j.removed ? " · видалено як неробочі: " + r.j.removed : "") +
            (r.j.failed ? " · помилка доставки: " + r.j.failed : "");
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
    var KIND = { confirmation: "Підтвердження", reminder_24h: "Нагадування 1", reminder_2h: "Нагадування 2", reschedule: "Перенесення", cancellation: "Скасування візиту" };
    var ST = { queued: "у черзі", sent: "відправлено", delivered: "доставлено", undelivered: "не доставлено", failed: "помилка", cancelled: "скасовано" };
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
