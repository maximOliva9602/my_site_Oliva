/* Стара адреса підключення аналітики — лишилась для сторінок із застарілим
   кешем. Усе живе в analytics.js (GTM, GA4, Meta Pixel, згода). */
(function () {
  if (window.__olivaAnalytics || /\/(cabinet|admin)/.test(location.pathname)) return;
  var s = document.createElement('script');
  s.src = '/assets/js/analytics.js?v=1';
  document.head.appendChild(s);
})();
