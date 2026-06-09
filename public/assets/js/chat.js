/* ============================================================
   Студія масажу Oliva — віджет живого чату (відвідувач)
   Підключається до Socket.IO. Якщо сервер недоступний
   (напр. відкрито index.html як файл) — лишаються кнопки
   месенджерів як фолбек, поле вводу не показуємо.
   ============================================================ */
(function () {
  "use strict";

  // Немає socket.io (file:// або сервер недоступний) -> фолбек на месенджери
  if (typeof io === "undefined") return;

  var body = document.getElementById("chatBody");
  var form = document.getElementById("chatForm");
  var input = document.getElementById("chatInput");
  var quick = document.getElementById("chatQuick");
  var launcher = document.getElementById("chatLauncher");
  if (!body || !form || !input) return;

  var VID_KEY = "oliva_vid";
  var visitorId = null;
  try { visitorId = localStorage.getItem(VID_KEY) || null; } catch (e) {}

  function timeLabel(ts) {
    var d = new Date(ts);
    var hh = ("0" + d.getHours()).slice(-2);
    var mm = ("0" + d.getMinutes()).slice(-2);
    return hh + ":" + mm;
  }
  function render(m) {
    var el = document.createElement("div");
    el.className = "chat-msg chat-msg--" + (m.from === "admin" ? "in" : "out");
    el.textContent = m.text; // textContent -> захист від XSS
    var t = document.createElement("span");
    t.className = "chat-msg__time";
    t.textContent = timeLabel(m.ts || Date.now());
    el.appendChild(t);
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  }

  var socket = io({ auth: { role: "visitor", visitorId: visitorId } });

  socket.on("connect_error", function () { /* мовчки — фолбек кнопки лишаються */ });

  socket.on("ready", function (data) {
    visitorId = data.visitorId;
    try { localStorage.setItem(VID_KEY, visitorId); } catch (e) {}
    // показати поле вводу, прибрати дубль кнопок (лишаємо як запасний варіант нижче)
    form.removeAttribute("hidden");
    (data.messages || []).forEach(render);
  });

  socket.on("message", function (m) { render(m); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    socket.emit("message", { text: text });
    input.value = "";
    input.focus();
  });

  // Якщо чат відкрили — фокус на полі
  if (launcher) {
    launcher.addEventListener("click", function () {
      setTimeout(function () { if (!form.hasAttribute("hidden")) input.focus(); }, 80);
    });
  }
})();
