/* ============================================================
   Oliva — єдина точка підключення аналітики на публічному сайті.
   Тут і лише тут: згода на cookie (Google Consent Mode v2), Google Tag
   Manager, GA4 (gtag напряму — як і було), Meta Pixel, джерело трафіку.
   Тому теги не дублюються. Не вантажиться в CRM/адмінці.

   Персональних даних (імʼя, телефон, адреса, коментар) у подіях немає.

   Публічне API:
     window.olivaTrack(name, params)  — подія: GA4 + dataLayer (GTM) + Pixel
     window.olivaGA(name, params)     — те саме (сумісність зі старим кодом)
     window.olivaGAAttr()             — UTM / click-id / джерело для подій
     window.olivaConsentOpen()        — показати вікно згоди ще раз
   Налагодження GA4: додайте ?ga_debug=1 до адреси.

   ВАЖЛИВО для GTM (контейнер GTM-PR59VT5Z): GA4 (G-2N69FC47C6) і Meta Pixel
   уже підключені тут. Не додавайте в контейнер ще й «Google-тег GA4» з цим
   самим ідентифікатором та базовий код Pixel — інакше події задвояться.
   Для рекламних тегів (Google Ads, ремаркетинг тощо) використовуйте
   тригери «Користувацька подія» з іменами oliva_booking_success,
   oliva_certificate_success, oliva_callback_success, oliva_office_request,
   oliva_phone_click, oliva_messenger_click.
   ============================================================ */
(function () {
  'use strict';
  var GA_ID = 'G-2N69FC47C6';
  var GTM_ID = 'GTM-PR59VT5Z';
  var PIXEL_ID = '2184518798832199';

  if (/\/(cabinet|admin)/.test(location.pathname) || window.__olivaAnalytics) return;
  window.__olivaAnalytics = true;
  window.__olivaGA = true; // track.js перевіряє цей прапорець

  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function extend(a) {
    for (var i = 1; i < arguments.length; i++) {
      var o = arguments[i];
      if (o) for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) a[k] = o[k];
    }
    return a;
  }

  /* ---------------- Згода (Consent Mode v2) ---------------- */
  var CONSENT_KEY = 'oliva_consent_v1';
  /* ДВА шари даних, щоб GA4 не рахувався двічі:
     - olivaGaLayer — лише для прямого gtag.js (GA4). Команди config/event
       пишемо сюди, а не в dataLayer: інакше GTM підхоплює config і вантажить
       власний gtag.js (другий запит із cx=c) → задвоєні події.
     - dataLayer — для GTM: згода + користувацькі події oliva_*.
     Згоду кладемо в обидва. */
  window.dataLayer = window.dataLayer || [];
  window.olivaGaLayer = window.olivaGaLayer || [];
  function gtagGA() { window.olivaGaLayer.push(arguments); }
  window.gtag = gtagGA;
  // Команди gtag мають лягати в шар саме як об'єкт `arguments`, не як масив.
  function gtagDL() { window.dataLayer.push(arguments); }
  function consentCmd(kind, state) {
    gtagDL('consent', kind, state);   // GTM читає згоду зі свого шару
    gtagGA('consent', kind, state);   // gtag.js — з власного
  }

  // Типово ВСЕ заборонено, доки відвідувач не обере.
  consentCmd('default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    analytics_storage: 'denied', wait_for_update: 500
  });

  function readConsent() {
    return safe(function () {
      var c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
      return c && (c.granted === true || c.granted === false) ? c : null;
    }) || null;
  }
  function granted() { var c = readConsent(); return !!(c && c.granted); }

  function applyConsent(ok) {
    var v = ok ? 'granted' : 'denied';
    consentCmd('update', {
      ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v
    });
    if (ok) { persistAttr(); loadPixel(); }
  }

  function saveConsent(ok) {
    safe(function () { localStorage.setItem(CONSENT_KEY, JSON.stringify({ granted: ok, ts: Date.now() })); });
    applyConsent(ok);
  }

  /* ---------------- Джерело трафіку ----------------
     Параметри є лише на першій сторінці переходу; далі по сайту їх нема
     в адресі, тому запамʼятовуємо: перше джерело (first) і останнє (last)
     на 90 днів. До згоди тримаємо лише в sessionStorage, після згоди —
     в localStorage. */
  var ATTR_KEY = 'oliva_attr2', TTL = 90 * 24 * 3600 * 1000;
  var PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid'];

  function refHost() {
    return safe(function () {
      if (!document.referrer) return '';
      var h = new URL(document.referrer).hostname.replace(/^www\./, '').toLowerCase();
      return h === location.hostname.replace(/^www\./, '').toLowerCase() ? '' : h;
    }) || '';
  }

  /* Класифікація: google_ads | instagram_ads | instagram_organic |
     facebook_ads | facebook_organic | google_organic | search_other |
     referral | direct. «Ads» для Meta — коли utm_medium платний
     (cpc, paid, paid_social, ads …); див. шаблон UTM у налаштуванні реклами. */
  function classify(p, host) {
    var us = (p.utm_source || '').toLowerCase(), um = (p.utm_medium || '').toLowerCase();
    var paidMedium = /(cpc|ppc|paid|ads?\b|cpm|promo|display)/.test(um);
    if (p.gclid || p.gbraid || p.wbraid || (us === 'google' && paidMedium)) return 'google_ads';
    var ig = /^(ig|instagram|insta)$/.test(us) || /(^|\.)instagram\.com$/.test(host);
    var fb = /^(fb|facebook|meta)$/.test(us) || /(^|\.)(facebook|fb)\.com$/.test(host) || host === 'l.facebook.com' || host === 'lm.facebook.com';
    if (ig) return paidMedium ? 'instagram_ads' : 'instagram_organic';
    if (fb) return paidMedium ? 'facebook_ads' : 'facebook_organic';
    if (p.fbclid) return paidMedium ? 'facebook_ads' : 'facebook_organic';
    if (/(^|\.)google\./.test(host) && !us) return 'google_organic';
    if (/(^|\.)(bing|yahoo|duckduckgo|yandex|ecosia)\./.test(host) && !us) return 'search_other';
    if (us) return 'referral';
    if (host) return 'referral';
    return 'direct';
  }

  function currentTouch() {
    var q = new URLSearchParams(location.search), p = {}, any = false;
    PARAMS.forEach(function (n) { var v = q.get(n); if (v) { p[n] = v.slice(0, 150); any = true; } });
    var host = refHost();
    if (!any && !host) return null; // прямий візит — не перезаписує попереднє джерело
    var t = extend({}, p);
    t.src = classify(p, host);
    if (host) t.ref = host;
    t.ts = Date.now();
    return t;
  }

  function readAttr() {
    return safe(function () {
      var s = JSON.parse(sessionStorage.getItem(ATTR_KEY) || 'null');
      var l = JSON.parse(localStorage.getItem(ATTR_KEY) || 'null');
      var a = s || l || null;
      if (l && s) a = { first: l.first || s.first, last: (s.last && s.last.ts > ((l.last || {}).ts || 0)) ? s.last : l.last };
      if (a && a.last && a.last.ts && Date.now() - a.last.ts > TTL) return null;
      return a;
    }) || null;
  }
  function writeAttr(a, toLocal) {
    safe(function () { sessionStorage.setItem(ATTR_KEY, JSON.stringify(a)); });
    if (toLocal) safe(function () { localStorage.setItem(ATTR_KEY, JSON.stringify(a)); });
  }
  function persistAttr() { var a = readAttr(); if (a) writeAttr(a, true); }

  (function captureTouch() {
    var t = currentTouch();
    if (!t) return;
    var a = readAttr() || {};
    a.last = t;
    if (!a.first) a.first = t;
    writeAttr(a, granted());
  })();

  function sourceParams() {
    var a = readAttr() || {}, last = a.last || {}, first = a.first || {}, out = {};
    out.traffic_source = last.src || 'direct';
    out.first_traffic_source = first.src || out.traffic_source;
    PARAMS.forEach(function (n) { if (last[n]) out[n] = last[n]; });
    return out;
  }
  window.olivaGAAttr = sourceParams;

  /* ---------------- Google Tag Manager ---------------- */
  (function (w, d, s, l, i) {
    w[l] = w[l] || [];
    w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var f = d.getElementsByTagName(s)[0], j = d.createElement(s);
    j.async = true; j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i;
    (f && f.parentNode ? f.parentNode : d.head).insertBefore(j, f || null);
  })(window, document, 'script', 'dataLayer', GTM_ID);

  /* ---------------- GA4 (напряму, як і було) ---------------- */
  (function () {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID + '&l=olivaGaLayer';
    document.head.appendChild(s);
    window.gtag('js', new Date());
    var cfg = {};
    if (/[?&]ga_debug=1/.test(location.search)) cfg.debug_mode = true;
    window.gtag('config', GA_ID, cfg);
  })();

  /* ---------------- Meta Pixel (лише після згоди) ---------------- */
  function loadPixel() {
    if (window.__olivaPixel) return;
    window.__olivaPixel = true;
    (function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = true; t.src = v;
      s = b.getElementsByTagName(e)[0];
      (s && s.parentNode ? s.parentNode : b.head).insertBefore(t, s || null);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  /* ---------------- Події ---------------- */
  // Стандартні події Meta для наших конверсій
  var PIXEL_EVENT = {
    booking_success: 'Schedule',
    certificate_success: 'Lead',
    callback_success: 'Lead',
    office_request_success: 'Lead',
    phone_click: 'Contact',
    messenger_click: 'Contact'
  };
  // Події, до яких додаємо джерело трафіку
  var WITH_SOURCE = {
    booking_success: 1, certificate_success: 1, callback_success: 1, office_request_success: 1,
    phone_click: 1, messenger_click: 1
  };
  var PIXEL_NAME = {
    booking_success: 'booking', certificate_success: 'gift_certificate', callback_success: 'callback',
    office_request_success: 'office_request', phone_click: 'phone', messenger_click: 'messenger'
  };

  window.olivaTrack = function (name, params) {
    safe(function () {
      var p = extend({}, params || {});
      if (WITH_SOURCE[name]) p = extend(sourceParams(), p);
      var id = p.transaction_id ? String(p.transaction_id) : '';

      // 1) GA4
      window.gtag('event', name, p);
      // 2) GTM (користувацька подія, префікс oliva_ — щоб не плутати з подіями GA4)
      window.dataLayer.push(extend({ event: 'oliva_' + name }, p));
      // 3) Meta Pixel (тільки конверсії й лише за наявності згоди)
      var std = PIXEL_EVENT[name];
      if (std && window.fbq) {
        var px = { content_name: p.service_name || PIXEL_NAME[name], traffic_source: p.traffic_source };
        if (p.value != null) { px.value = p.value; px.currency = p.currency || 'UAH'; }
        if (p.messenger) px.content_category = p.messenger;
        var opt = id ? { eventID: name + '_' + id } : undefined;
        if (opt) window.fbq('track', std, px, opt); else window.fbq('track', std, px);
      }
    });
  };
  window.olivaGA = window.olivaTrack;

  /* ---- Кліки: телефон і месенджери ---- */
  function messengerOf(href) {
    if (/^https?:\/\/(www\.)?(t\.me|telegram\.me)\//i.test(href) || /^tg:/i.test(href)) return 'telegram';
    if (/^https?:\/\/(wa\.me|api\.whatsapp\.com|(www\.)?whatsapp\.com)\//i.test(href)) return 'whatsapp';
    if (/^https?:\/\/(www\.)?(viber\.me|invite\.viber\.com)\//i.test(href) || /^viber:/i.test(href)) return 'viber';
    return '';
  }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^tel:/i.test(href)) {
      window.olivaTrack('phone_click', { page_path: location.pathname });
      return;
    }
    var m = messengerOf(href);
    if (m) window.olivaTrack('messenger_click', { messenger: m, page_path: location.pathname });
  }, { capture: true, passive: true });

  /* ---------------- Вікно згоди ---------------- */
  var TXT = {
    uk: { t: 'Ми використовуємо cookie та аналітику Google і Meta, щоб бачити, які оголошення приводять клієнтів, і покращувати сайт. Погодьтесь або відхиліть — сайт працюватиме в обох випадках.', y: 'Прийняти', n: 'Відхилити' },
    en: { t: 'We use cookies and Google/Meta analytics to see which ads bring clients and to improve the site. Accept or decline — the site works either way.', y: 'Accept', n: 'Decline' }
  };
  function lang() {
    var l = safe(function () { return localStorage.getItem('oliva_lang'); }) || document.documentElement.lang || 'uk';
    return /^en/i.test(l) ? 'en' : 'uk';
  }
  function showBanner() {
    var old = document.getElementById('oliva-consent');
    if (old) old.remove();
    var t = TXT[lang()];
    var box = document.createElement('div');
    box.id = 'oliva-consent';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Cookie');
    box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;margin:0 auto;max-width:560px;z-index:2147483000;' +
      'background:rgba(22,18,13,.97);color:#F2EDE4;border:1px solid rgba(217,185,120,.55);border-radius:14px;' +
      'padding:14px 16px;box-shadow:0 8px 30px rgba(0,0,0,.45);font:400 13px/1.45 Inter,system-ui,sans-serif;';
    box.innerHTML = '<div style="margin-bottom:12px;">' + t.t + '</div>' +
      '<div style="display:flex;gap:10px;">' +
      '<button type="button" data-c="0" style="flex:1;padding:11px 8px;border-radius:10px;border:1px solid rgba(217,185,120,.6);background:transparent;color:#F2EDE4;font:600 13px Inter,system-ui,sans-serif;cursor:pointer;">' + t.n + '</button>' +
      '<button type="button" data-c="1" style="flex:1;padding:11px 8px;border-radius:10px;border:1px solid #D9B978;background:#D9B978;color:#1a140d;font:600 13px Inter,system-ui,sans-serif;cursor:pointer;">' + t.y + '</button>' +
      '</div>';
    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-c]') : null;
      if (!b) return;
      saveConsent(b.getAttribute('data-c') === '1');
      box.remove();
    });
    document.body.appendChild(box);
  }
  window.olivaConsentOpen = showBanner;
  // Посилання «Налаштування cookie» де завгодно: <a href="#" data-cookie-settings>
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('[data-cookie-settings]') : null;
    if (a) { e.preventDefault(); showBanner(); }
  });

  /* ---------------- Старт ---------------- */
  var saved = readConsent();
  if (saved) applyConsent(saved.granted);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner);
  else showBanner();
})();
