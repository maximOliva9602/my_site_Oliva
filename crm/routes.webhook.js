/* ============================================================
   crm/routes.webhook.js — статуси доставки від TurboSMS.
   Не cookie-авторизація: захист спільним секретом
   (TURBOSMS_WEBHOOK_SECRET) у query ?secret= або заголовку
   X-Webhook-Secret. Мапить payload драйвером і пише статус.
   ============================================================ */

const express = require("express");
const notify = require("./notify");
const db = require("./db");
const adminNotify = require("./admin-notify");
const clientTelegram = require("./client-telegram");

const router = express.Router();
const SECRET = process.env.TURBOSMS_WEBHOOK_SECRET || "";
const TG_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
if (!TG_WEBHOOK_SECRET) {
  console.warn("[webhook] TELEGRAM_WEBHOOK_SECRET не задано — /api/webhooks/telegram приймає запити без перевірки підпису.");
}
function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, function (ch) {
    return ch === "&" ? "&amp;" : (ch === "<" ? "&lt;" : "&gt;");
  });
}

router.post("/turbosms", function (req, res) {
  if (SECRET) {
    const got = req.query.secret || req.headers["x-webhook-secret"];
    if (got !== SECRET) return res.status(403).json({ ok: false, error: "forbidden" });
  }
  // TurboSMS може слати один об'єкт або масив
  const body = req.body || {};
  const items = Array.isArray(body) ? body : (Array.isArray(body.messages) ? body.messages : [body]);
  let updated = 0;
  for (const item of items) {
    try {
      const parsed = notify.driver.parseStatus(item);
      if (parsed && parsed.providerMsgId && notify.recordStatus(parsed.providerMsgId, parsed.status, parsed.channel)) {
        updated++;
      }
    } catch (e) { /* ігноруємо окремий битий елемент */ }
  }
  res.json({ ok: true, updated: updated });
});

/* ---------------- Telegram: прив'язка чату майстра ----------------
   Бот не може написати першим, тому майстер сам відкриває
   t.me/<bot>?start=<код> і тисне Start. Сюди прилітає /start <код> —
   знаходимо майстра за одноразовим кодом і запам'ятовуємо його chat_id.
   Захист: секретний заголовок, який Telegram шле сам (задається при
   setWebhook). Без нього маршрут приймав би що завгодно від будь-кого. */
router.post("/telegram", function (req, res) {
  if (TG_WEBHOOK_SECRET) {
    const got = req.headers["x-telegram-bot-api-secret-token"];
    if (got !== TG_WEBHOOK_SECRET) return res.status(403).json({ ok: false });
  }
  // Telegram вважає доставленим будь-який 200; на помилках теж відповідаємо
  // 200, інакше він ретраїть той самий апдейт по колу.
  try {
    const msg = (req.body && (req.body.message || req.body.edited_message)) || null;
    const chatId = msg && msg.chat && msg.chat.id;
    const text = String((msg && msg.text) || "").trim();
    if (!chatId || !text) return res.json({ ok: true });

    if (/^\/start\b/.test(text)) {
      const code = text.replace(/^\/start\b/, "").trim();
      if (!code) {
        adminNotify.sendTg(
          "Вітаю! Це бот студії Oliva.\n\n" +
          "Клієнти можуть підключити повідомлення після онлайн-запису, " +
          "а майстри — у CRM на вкладці «Сповіщення».",
          chatId
        );
        return res.json({ ok: true });
      }

      if (code.startsWith("client-")) {
        const client = clientTelegram.linkClient(code, chatId);
        if (!client) {
          adminNotify.sendTg(
            "Посилання недійсне або застаріло. Зробіть новий онлайн-запис і натисніть кнопку підключення Telegram ще раз.",
            chatId
          );
          return res.json({ ok: true });
        }
        adminNotify.sendTg(
          `✅ Готово, ${escHtml(client.name)}! Telegram підключено. Після завершення візиту ми надішлемо сюди посилання, щоб поділитися враженнями.\n\n` +
          "Щоб вимкнути повідомлення — надішліть /stop",
          chatId
        );
        setImmediate(function () {
          clientTelegram.flushQueued(client.id).catch(function (e) {
            console.error("[webhook] client telegram flush:", e.message);
          });
        });
        return res.json({ ok: true });
      }

      const m = db.prepare(
        "SELECT id, name FROM masters WHERE tg_link_code=? AND tg_code_expires > ?"
      ).get(code, Date.now());
      if (!m) {
        adminNotify.sendTg(
          "Код недійсний або застарів. Згенеруйте новий у CRM → «Сповіщення».",
          chatId
        );
        return res.json({ ok: true });
      }
      /* Один чат — один майстер: якщо цей Telegram уже був прив'язаний до
         іншого майстра (спільний телефон), стару прив'язку знімаємо. */
      db.prepare("UPDATE masters SET tg_chat_id=NULL, tg_linked_at=NULL WHERE tg_chat_id=?")
        .run(String(chatId));
      db.prepare(
        "UPDATE masters SET tg_chat_id=?, tg_link_code=NULL, tg_code_expires=NULL, tg_linked_at=? WHERE id=?"
      ).run(String(chatId), Date.now(), m.id);
      adminNotify.sendTg(
        `✅ Готово, ${m.name}! Тепер сповіщення про ваші записи приходитимуть сюди.\n\n` +
        "Щоб вимкнути — надішліть /stop",
        chatId
      );
      return res.json({ ok: true });
    }

    if (/^\/stop\b/.test(text)) {
      const masters = db.prepare("UPDATE masters SET tg_chat_id=NULL, tg_linked_at=NULL WHERE tg_chat_id=?")
        .run(String(chatId)).changes;
      const clients = clientTelegram.unlinkChat(chatId);
      adminNotify.sendTg(
        masters || clients
          ? "Сповіщення вимкнено. Підключити їх знову можна через CRM або після наступного онлайн-запису."
          : "Для цього Telegram-акаунта активних сповіщень не знайдено.",
        chatId
      );
      return res.json({ ok: true });
    }
  } catch (e) {
    console.error("[webhook] telegram:", e.message);
  }
  res.json({ ok: true });
});

module.exports = router;
