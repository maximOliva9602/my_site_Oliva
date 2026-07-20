/* ============================================================
   push.js — спільна логіка Web Push підписки.
   Використовується в /master (та може в /cabinet).
   Глобальний API: OlivaPush.init(opts), OlivaPush.subscribe(opts)
   opts.headers — додаткові заголовки авторизації (напр. x-admin-token)
   ============================================================ */
(function () {
  "use strict";

  function req(method, url, body, headers) {
    var opts = { method: method, credentials: "include", headers: {} };
    if (headers) for (var k in headers) opts.headers[k] = headers[k];
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; });
    });
  }

  function urlB64ToUint8(key) {
    var raw = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  /* Створює підписку і зберігає її на сервері. */
  function subscribe(opts) {
    opts = opts || {};
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission !== "granted") return;

    navigator.serviceWorker.ready.then(function (reg) {
      req("GET", "/api/push/vapid-public-key", null, opts.headers).then(function (j) {
        if (!j || !j.publicKey) { console.warn("[push] VAPID ключ не налаштований на сервері"); return; }
        var key = urlB64ToUint8(j.publicKey);

        function doSubscribe() {
          reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
            .then(function (sub) {
              return req("POST", "/api/push/subscribe", { subscription: sub.toJSON() }, opts.headers)
                .then(function (j2) {
                  if (!j2 || !j2.ok) console.warn("[push] сервер не зберіг підписку:", j2);
                  else console.log("[push] підписка збережена");
                });
            })
            .catch(function (e) { console.error("[push] subscribe помилка:", e); });
        }

        // Стара підписка могла бути створена з іншим VAPID-ключем — перестворюємо
        reg.pushManager.getSubscription().then(function (existing) {
          if (existing) existing.unsubscribe().then(doSubscribe).catch(doSubscribe);
          else doSubscribe();
        }).catch(doSubscribe);
      });
    }).catch(function (e) { console.error("[push] SW ready error:", e); });
  }

  /* Тост із запитом дозволу (requestPermission має бути в жесті користувача — вимога iOS). */
  function showToast(opts) {
    if (document.getElementById("push-toast")) return;
    var t = document.createElement("div");
    t.id = "push-toast";
    t.innerHTML =
      '<div class="pt-msg">🔔 Отримувати сповіщення про нові записи на цей телефон?</div>' +
      '<div class="pt-btns">' +
        '<button class="pt-btn pt-btn-primary" id="pt-allow">Дозволити</button>' +
        '<button class="pt-btn" id="pt-later">Пізніше</button>' +
      '</div>';
    document.body.appendChild(t);

    document.getElementById("pt-allow").addEventListener("click", function () {
      Notification.requestPermission().then(function (p) {
        t.remove();
        sessionStorage.setItem("push_asked", "1");
        if (p === "granted") subscribe(opts);
      }).catch(function () { t.remove(); });
    });
    document.getElementById("pt-later").addEventListener("click", function () {
      t.remove();
      sessionStorage.setItem("push_asked", "1");
    });
  }

  /* Викликати після успішного логіну: тихо підписує, якщо дозвіл уже є. */
  function init(opts) {
    if (!("Notification" in window) || !("PushManager" in window)) return;
    if (Notification.permission === "granted") { setTimeout(function () { subscribe(opts); }, 1200); return; }
    if (Notification.permission === "denied") return;
    if (sessionStorage.getItem("push_asked")) return;
    showToast(opts);
  }

  window.OlivaPush = { init: init, subscribe: subscribe };
})();
