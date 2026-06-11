/* ============================================================
   crm/routes.webhook.js — статуси доставки від TurboSMS.
   Не cookie-авторизація: захист спільним секретом
   (TURBOSMS_WEBHOOK_SECRET) у query ?secret= або заголовку
   X-Webhook-Secret. Мапить payload драйвером і пише статус.
   ============================================================ */

const express = require("express");
const notify = require("./notify");

const router = express.Router();
const SECRET = process.env.TURBOSMS_WEBHOOK_SECRET || "";

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

module.exports = router;
