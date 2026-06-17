/* ============================================================
   Oliva — трекінг відвідувань сайту
   Підключається на всіх публічних сторінках.
   Збирає: pageview, кліки на CTA (Записатися, телефон, чат).
   НЕ збирає: особисті дані, точні IP (лише hash на сервері).
   ============================================================ */
(function () {
  'use strict';

  // Не трекаємо CRM/адмін
  if (/\/(cabinet|admin)/.test(location.pathname)) return;

  /* ---- Сесія (зберігається 30 хв, потім нова) ---- */
  function getSession() {
    var KEY = '_oliva_sid';
    var EXP = '_oliva_sid_exp';
    var now = Date.now();
    var sid = sessionStorage.getItem(KEY);
    var exp = parseInt(sessionStorage.getItem(EXP) || '0', 10);
    if (!sid || now > exp) {
      sid = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      sessionStorage.setItem(KEY, sid);
    }
    sessionStorage.setItem(EXP, now + 30 * 60 * 1000);
    return sid;
  }

  /* ---- UTM з URL ---- */
  function getUTM() {
    var p = new URLSearchParams(location.search);
    return {
      utm_source:   p.get('utm_source')   || '',
      utm_medium:   p.get('utm_medium')   || '',
      utm_campaign: p.get('utm_campaign') || '',
    };
  }

  /* ---- Відправка події ---- */
  function send(event, label) {
    var utm = getUTM();
    var payload = {
      path:       location.pathname,
      referrer:   document.referrer || '',
      event:      event,
      label:      label || '',
      session_id: getSession(),
      utm_source:   utm.utm_source,
      utm_medium:   utm.utm_medium,
      utm_campaign: utm.utm_campaign,
    };
    // sendBeacon — не блокує сторінку, не чекає відповіді
    if (navigator.sendBeacon) {
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon('/api/track', blob);
    } else {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(function () {});
    }
  }

  /* ---- Pageview ---- */
  send('pageview');

  /* ---- Кліки по CTA ---- */
  var CTA_SELECTORS = [
    // Кнопки запису
    { sel: 'a[href*="booking"], a[href*="zapys"], button',  label: 'booking' },
    // Телефон
    { sel: 'a[href^="tel:"]',  label: 'phone' },
    // Чат
    { sel: '.chat-toggle, #chatToggle, [data-chat]', label: 'chat' },
    // Instagram
    { sel: 'a[href*="instagram.com"]', label: 'instagram' },
    // Telegram
    { sel: 'a[href*="t.me"], a[href*="telegram"]', label: 'telegram' },
  ];

  document.addEventListener('click', function (e) {
    var target = e.target;
    // Знаходимо найближчий клікабельний елемент
    for (var i = 0; i < 4 && target && target !== document.body; i++) {
      for (var j = 0; j < CTA_SELECTORS.length; j++) {
        var rule = CTA_SELECTORS[j];
        try {
          if (target.matches && target.matches(rule.sel)) {
            // Для кнопки — беремо текст, якщо є
            var lbl = rule.label;
            if (target.tagName === 'BUTTON' || target.tagName === 'A') {
              var txt = (target.textContent || '').trim().slice(0, 40);
              if (txt) lbl = rule.label + ':' + txt;
            }
            send('click', lbl);
            return;
          }
        } catch (err) {}
      }
      target = target.parentElement;
    }
  }, { passive: true });

})();
