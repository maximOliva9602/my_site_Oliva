/* ============================================================
   Студія масажу Oliva — script.js
   nav-scroll, мобільне меню, перемикач мов, таби послуг,
   reveal-анімації, плавний скрол, онлайн-чат (заглушка).
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Nav scroll ---------- */
  var nav = document.getElementById("nav");
  function onScroll() { nav.classList.toggle("scrolled", window.scrollY > 60); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile burger menu ---------- */
  var burger = document.getElementById("burger");
  var navLinks = document.getElementById("navLinks");
  var backdrop = document.createElement("div");
  backdrop.className = "nav-backdrop";
  document.body.appendChild(backdrop);

  function openMenu() { navLinks.classList.add("open"); backdrop.classList.add("open"); burger.classList.add("open"); document.body.style.overflow = "hidden"; }
  function closeMenu() { navLinks.classList.remove("open"); backdrop.classList.remove("open"); burger.classList.remove("open"); document.body.style.overflow = ""; }

  burger.addEventListener("click", function () {
    if (navLinks.classList.contains("open")) closeMenu(); else openMenu();
  });
  backdrop.addEventListener("click", closeMenu);
  navLinks.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", closeMenu); });

  /* ---------- Language switch ---------- */
  var langSwitch = document.getElementById("langSwitch");
  if (langSwitch && window.OlivaI18n) {
    langSwitch.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        window.OlivaI18n.apply(b.getAttribute("data-lang"));
      });
    });
  }

  /* ---------- Service tabs ---------- */
  var tabs = document.querySelectorAll(".srv-tab");
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var id = tab.getAttribute("data-tab");
      tabs.forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      document.querySelectorAll(".srv-panel").forEach(function (p) {
        p.classList.toggle("active", p.id === "tab-" + id);
      });
    });
  });

  /* ---------- Reveal on scroll ---------- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e, i) {
        if (e.isIntersecting) {
          setTimeout(function () { e.target.classList.add("visible"); }, i * 70);
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.1 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("visible"); });
  }

  /* ---------- Smooth scroll for in-page anchors ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var href = a.getAttribute("href");
      if (href === "#") return;
      var target = document.querySelector(href);
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: "smooth" }); }
    });
  });

  /* ---------- Online chat widget ----------
     Зараз — режим "messengers": кнопка відкриває панель зі швидкими
     контактами (WhatsApp / Viber / Telegram / Instagram / дзвінок).
     Коли підключимо живий чат (бекенд на Railway: Socket.IO + Telegram),
     активуємо поле вводу (#chatForm) і POST на /api/chat. Хук нижче. */
  var launcher = document.getElementById("chatLauncher");
  var panel = document.getElementById("chatPanel");
  var chatClose = document.getElementById("chatClose");

  function toggleChat(show) {
    var open = show != null ? show : panel.hasAttribute("hidden");
    if (open) { panel.removeAttribute("hidden"); }
    else { panel.setAttribute("hidden", ""); }
  }
  if (launcher) {
    launcher.addEventListener("click", function () { toggleChat(); });
    chatClose.addEventListener("click", function () { toggleChat(false); });
  }

  /* ----- Хук під майбутній живий чат (поки неактивний) -----
  var chatForm = document.getElementById("chatForm");
  var chatInput = document.getElementById("chatInput");
  var chatBody = document.getElementById("chatBody");
  function addMsg(text, dir) {
    var m = document.createElement("div");
    m.className = "chat-msg chat-msg--" + dir;
    m.textContent = text;
    chatBody.appendChild(m);
    chatBody.scrollTop = chatBody.scrollHeight;
  }
  if (chatForm) {
    chatForm.removeAttribute("hidden");
    chatForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = chatInput.value.trim();
      if (!text) return;
      addMsg(text, "out");
      chatInput.value = "";
      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text })
      }).then(function (r) { return r.json(); }).then(function (res) {
        // тут опрацюємо відповідь / підключимо Socket.IO
      });
    });
  }
  ----------------------------------------------------------- */
})();
