/* telegram-драйвер: шле текст у студійний чат (як dev-фолбек без
   акаунта TurboSMS). Доставку Telegram не трекає — одразу 'sent'.
   Використовує ті ж env, що й чат у server.js. */
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
let seq = 1;

module.exports = {
  name: "telegram",
  async sendMessage(opts) {
    const id = "tg_" + (seq++);
    if (!TG_TOKEN || !TG_CHAT_ID) {
      console.warn("[notify:telegram] TELEGRAM_BOT_TOKEN/CHAT_ID не задано — пропуск.");
      return { providerMsgId: id, channel: "telegram" };
    }
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const body = JSON.stringify({
      chat_id: TG_CHAT_ID,
      text: `📲 <b>Сповіщення клієнту</b> (${opts.phone})\n\n${opts.text}`,
      parse_mode: "HTML",
    });
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!res.ok) throw new Error("telegram " + res.status + ": " + (await res.text()));
    return { providerMsgId: id, channel: "telegram" };
  },
  parseStatus(payload) {
    return { providerMsgId: payload.id, status: "delivered", channel: "telegram" };
  },
};
