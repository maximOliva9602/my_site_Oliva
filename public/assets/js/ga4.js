/* ============================================================
   Oliva — Google Analytics 4 (потік G-2N69FC47C6)
   Єдине місце підключення gtag на всьому публічному сайті — тому теги
   не дублюються. Не вантажиться в CRM/адмінці. Персональних даних
   (імʼя, телефон, коментар) у подіях немає.
   Подія: window.olivaGA(name, params).
   Налагодження: додайте ?ga_debug=1 до адреси — події підуть у DebugView.
   ============================================================ */
(function () {
  'use strict';
  var GA_ID = 'G-2N69FC47C6';
  if (/\/(cabinet|admin)/.test(location.pathname) || window.__olivaGA) return;
  window.__olivaGA = true;

  /* ---- Збереження UTM і click-id рекламного переходу (90 днів) ----
     Параметри є лише на першій сторінці переходу; далі по сайту їх
     нема в адресі, тому запамʼятовуємо. Нові мітки перезаписують старі. */
  var ATTR_KEY = 'oliva_attr', TTL = 90 * 24 * 3600 * 1000;
  var NAMES = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid'];
  function readAttr() {
    try {
      var a = JSON.parse(localStorage.getItem(ATTR_KEY) || 'null');
      return a && a.ts && Date.now() - a.ts < TTL ? a : null;
    } catch (e) { return null; }
  }
  (function saveAttr() {
    try {
      var p = new URLSearchParams(location.search), found = {}, any = false;
      NAMES.forEach(function (n) { var v = p.get(n); if (v) { found[n] = v.slice(0, 150); any = true; } });
      if (any) { found.ts = Date.now(); localStorage.setItem(ATTR_KEY, JSON.stringify(found)); }
    } catch (e) {}
  })();

  /* ---- gtag ---- */
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(s);
  window.gtag('js', new Date());
  var cfg = {};
  if (/[?&]ga_debug=1/.test(location.search)) cfg.debug_mode = true;
  window.gtag('config', GA_ID, cfg);

  window.olivaGA = function (name, params) {
    try { window.gtag('event', name, params || {}); } catch (e) {}
  };
  /* UTM/click-id для подій, де це потрібно (успішний запис). */
  window.olivaGAAttr = function () {
    var a = readAttr() || {}, out = {};
    NAMES.forEach(function (n) { if (a[n]) out[n] = a[n]; });
    return out;
  };
})();
