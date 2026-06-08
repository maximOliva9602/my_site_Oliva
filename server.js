/* ============================================================
   Студія масажу Oliva — сервер (Railway-ready)
   Зараз: роздає статичний сайт із папки /public.
   Далі: тут же додамо живий онлайн-чат (Socket.IO + Telegram-міст).
   ============================================================ */

const path = require("path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// Статика сайту
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

/* ------------------------------------------------------------
   TODO (онлайн-чат, відкладено):
   Тут буде бекенд живого чату. План:
   1. Socket.IO для реального часу між віджетом на сайті та сервером.
   2. Telegram-бот (node-telegram-bot-api) як «пульт» для менеджера:
      - кожен клієнт = окрема ТЕМА (topic) у Telegram-групі
        => кілька клієнтів одночасно не плутаються;
      - повідомлення клієнта -> сервер -> Telegram-тема;
      - відповідь менеджера у темі -> сервер -> назад у віджет.
   3. Змінні середовища (див. .env.example):
      TELEGRAM_BOT_TOKEN, TELEGRAM_GROUP_ID.

   Заглушка ендпоінта, щоб фронт уже мав куди звертатися:
------------------------------------------------------------ */
app.post("/api/chat", (req, res) => {
  // Поки що нічого не пересилаємо — повертаємо ознаку, що бекенд не активний.
  // Віджет у цьому режимі показує кнопки месенджерів.
  res.json({ ok: false, mode: "messengers" });
});

// SPA-fallback на головну
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Oliva site running on http://localhost:${PORT}`);
});
