/* ============================================================
   Telegram-повідомлення КЛІЄНТАМ.

   Telegram Bot API не вміє шукати користувача за номером телефону:
   потрібен chat_id. Тому після онлайн-запису клієнт один раз відкриває
   персональне t.me-посилання, а webhook прив'язує chat_id до client_id.
   Після завершення сеансу сюди ставиться персональний запит на відгук.
   ============================================================ */

const crypto = require("crypto");
const db = require("./db");
const tz = require("./tz");

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_BOT_USERNAME = String(process.env.TELEGRAM_BOT_USERNAME || "Oliva_menedger_bot").replace(/^@/, "");
const SITE_URL = String(process.env.SITE_URL || "https://massage-oliva.com")
  .replace("massage-solomyanskyi.com.ua", "massage-oliva.com").replace(/\/+$/, "");
const LINK_TTL_MS = 24 * 60 * 60 * 1000;
const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function createLink(clientId) {
  const client = db.prepare(
    "SELECT id, tg_chat_id, tg_link_code, tg_code_expires FROM clients WHERE id=?"
  ).get(clientId);
  if (!client) return null;

  const now = Date.now();
  let code = client.tg_link_code;
  if (!code || !client.tg_code_expires || client.tg_code_expires <= now) {
    code = "client-" + crypto.randomBytes(20).toString("hex");
    db.prepare("UPDATE clients SET tg_link_code=?, tg_code_expires=? WHERE id=?")
      .run(code, now + LINK_TTL_MS, client.id);
  }
  return {
    connected: !!client.tg_chat_id,
    url: TG_BOT_USERNAME ? `https://t.me/${TG_BOT_USERNAME}?start=${code}` : null,
  };
}

function linkClient(code, chatId) {
  const now = Date.now();
  const client = db.prepare(
    "SELECT id, name FROM clients WHERE tg_link_code=? AND tg_code_expires>?"
  ).get(String(code || ""), now);
  if (!client) return null;

  const tx = db.transaction(function () {
    /* Один Telegram-чат відповідає одній картці клієнта. Повторний код
       навмисно дозволений: після заміни токена бота або старого chat_id
       клієнт може без звернення до адміністратора перевірити прив'язку й
       перезаписати її актуальним Telegram-акаунтом. */
    db.prepare(
      "UPDATE clients SET tg_chat_id=NULL, tg_linked_at=NULL WHERE tg_chat_id=? AND id<>?"
    ).run(String(chatId), client.id);
    db.prepare(
      "UPDATE clients SET tg_chat_id=?, tg_link_code=NULL, tg_code_expires=NULL, tg_linked_at=? WHERE id=?"
    ).run(String(chatId), now, client.id);
  });
  tx();
  return client;
}

function unlinkChat(chatId) {
  return db.prepare(
    "UPDATE clients SET tg_chat_id=NULL, tg_link_code=NULL, tg_code_expires=NULL, tg_linked_at=NULL WHERE tg_chat_id=?"
  ).run(String(chatId)).changes;
}

function queueReviewRequest(appointmentId, options) {
  options = options || {};
  const a = db.prepare(
    `SELECT a.id, a.client_id, a.master_id, a.date, a.end_min,
            c.name AS client_name, m.name AS master_name
       FROM appointments a
       JOIN clients c ON c.id=a.client_id
       JOIN masters m ON m.id=a.master_id
      WHERE a.id=?`
  ).get(appointmentId);
  if (!a) return { ok: false, error: "appointment not found" };

  const reviewUrl = `${SITE_URL}/google-review?m=${a.master_id}`;
  const text = `Дякуємо${a.client_name ? ", " + a.client_name : ""}, що завітали до Oliva 💚\n\n` +
    `Будемо вдячні, якщо ви поділитеся враженнями про сеанс у майстра ${a.master_name}.`;
  /* Ручне «Завершено» означає, що візит фактично вже закінчився — у
     цьому випадку власник очікує відправлення одразу. Автозавершення
     передає sendNow=false і продовжує чекати планового кінця сеансу. */
  const sendAfter = options.sendNow ? Date.now() : tz.apptInstant(a.date, a.end_min);
  try {
    const info = db.prepare(
      `INSERT INTO client_telegram_messages
         (appointment_id, client_id, text, review_url, send_after, status, created_at)
       VALUES (?,?,?,?,?,'queued',?)`
    ).run(a.id, a.client_id, text, reviewUrl, sendAfter, Date.now());
    return { ok: true, id: info.lastInsertRowid };
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      /* Запит міг уже стояти в черзі до майбутнього планового кінця.
         Повторне ручне завершення робить його доступним зараз, але не
         відновлює вже надіслане/скасоване повідомлення і не створює дубль. */
      if (options.sendNow) {
        db.prepare(
          "UPDATE client_telegram_messages SET send_after=? WHERE appointment_id=? AND status IN ('queued','failed')"
        ).run(Date.now(), a.id);
      }
      return { ok: true, duplicate: true };
    }
    return { ok: false, error: e.message };
  }
}

async function send(row, chatId) {
  if (!TG_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN не задано");
  const response = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      chat_id: chatId,
      text: row.text,
      reply_markup: {
        inline_keyboard: [[{ text: "⭐ Залишити відгук", url: row.review_url }]],
      },
      disable_web_page_preview: true,
    }),
  });
  const payload = await response.json().catch(function () { return {}; });
  if (!response.ok || !payload.ok) {
    const err = new Error(`telegram ${response.status}: ${payload.description || "помилка відправки"}`);
    err.status = response.status;
    throw err;
  }
  return payload.result && payload.result.message_id;
}

async function flushQueued(clientId) {
  const now = Date.now();
  const staleLock = now - 5 * 60 * 1000;
  const params = [staleLock, now, MAX_ATTEMPTS];
  let byClient = "";
  if (clientId) {
    byClient = " AND q.client_id=?";
    params.push(clientId);
  }
  const rows = db.prepare(
    `SELECT q.*, c.tg_chat_id, a.status AS appointment_status
       FROM client_telegram_messages q
       JOIN clients c ON c.id=q.client_id
       JOIN appointments a ON a.id=q.appointment_id
      WHERE (q.status IN ('queued','failed') OR (q.status='sending' AND q.locked_at<?))
        AND q.send_after<=? AND q.attempts<?${byClient}
      ORDER BY q.id LIMIT 30`
  ).all(...params);
  let sent = 0;

  for (const row of rows) {
    if (row.appointment_status === "cancelled" || row.appointment_status === "no_show") {
      db.prepare("UPDATE client_telegram_messages SET status='cancelled', last_error=? WHERE id=?")
        .run("запис скасований або клієнт не прийшов", row.id);
      continue;
    }
    /* Якщо «Завершено» випадково зняли, не втрачаємо повідомлення:
       просто чекаємо, доки запис знову матиме коректний статус. */
    if (row.appointment_status !== "completed") continue;
    if (now - row.created_at > MESSAGE_TTL_MS) {
      db.prepare("UPDATE client_telegram_messages SET status='cancelled', last_error=? WHERE id=?")
        .run("минув термін відправки", row.id);
      continue;
    }
    /* Клієнт ще не натиснув Start — не вважаємо це помилкою і чекаємо,
       доки він прив'яже Telegram (але не довше MESSAGE_TTL_MS). */
    if (!row.tg_chat_id) continue;

    /* setStatus(), щохвилинний scheduler і webhook після прив'язки можуть
       викликати flush одночасно. Атомарно «захоплюємо» рядок, щоб два
       процеси не надіслали клієнту однаковий запит відгуку. */
    const claimed = db.prepare(
      "UPDATE client_telegram_messages SET status='sending', locked_at=? WHERE id=? AND (status IN ('queued','failed') OR (status='sending' AND locked_at<?))"
    ).run(now, row.id, staleLock);
    if (!claimed.changes) continue;

    try {
      const messageId = await send(row, row.tg_chat_id);
      db.prepare(
        "UPDATE client_telegram_messages SET status='sent', attempts=attempts+1, provider_msg_id=?, last_error=NULL, locked_at=NULL, sent_at=? WHERE id=?"
      ).run(messageId == null ? null : String(messageId), Date.now(), row.id);
      sent++;
    } catch (e) {
      const terminal = e.status === 400 || e.status === 403;
      db.prepare(
        "UPDATE client_telegram_messages SET status=?, attempts=attempts+1, last_error=?, locked_at=NULL WHERE id=?"
      ).run(terminal ? "cancelled" : "failed", String(e.message).slice(0, 300), row.id);
      if (e.status === 403) unlinkChat(row.tg_chat_id);
      console.error(`[client-telegram] повідомлення #${row.id}:`, e.message);
    }
  }
  return sent;
}

module.exports = {
  TG_BOT_USERNAME,
  createLink,
  linkClient,
  unlinkChat,
  queueReviewRequest,
  flushQueued,
};
