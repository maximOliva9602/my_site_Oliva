/* turbosms-драйвер: каскад Viber -> SMS-фолбек через TurboSMS.
   Док: https://turbosms.ua/api.html (REST JSON, Bearer-токен).
   Надсилаємо повідомлення з Viber-частиною й SMS-частиною; TurboSMS
   сам робить фолбек на SMS, якщо Viber не доставлено. Повертаємо
   message_id; фінальний статус приходить вебхуком або опитуванням.

   ENV:
     TURBOSMS_TOKEN        — Bearer-токен з кабінету
     TURBOSMS_SENDER       — зареєстроване Alpha-ім'я для SMS (напр. "Oliva")
     TURBOSMS_VIBER_SENDER — зареєстроване ім'я Viber-відправника
*/
const TOKEN = process.env.TURBOSMS_TOKEN || "";
const SMS_SENDER = process.env.TURBOSMS_SENDER || "Oliva";
const VIBER_SENDER = process.env.TURBOSMS_VIBER_SENDER || SMS_SENDER;
const API = "https://api.turbosms.ua";

function mapStatus(s) {
  // TurboSMS статуси -> наш enum
  const v = String(s || "").toLowerCase();
  if (v.includes("deliver") || v.includes("read")) return "delivered";
  if (v.includes("sent") || v.includes("enroute") || v.includes("accept")) return "sent";
  if (v.includes("undeliv") || v.includes("expire") || v.includes("reject") || v.includes("fail")) return "undelivered";
  return "sent";
}

module.exports = {
  name: "turbosms",
  async sendMessage(opts) {
    if (!TOKEN) throw new Error("TURBOSMS_TOKEN не задано");
    // Каскад: спершу Viber, фолбек на SMS у тому ж запиті.
    // is_transactional=false для масових розсилок: рекламу не можна слати
    // як службове повідомлення, у Viber це різні тарифи й правила.
    const transactional = opts.transactional !== false;
    const body = {
      recipients: [opts.phone],
      sms: { sender: SMS_SENDER, text: opts.text },
      viber: { sender: VIBER_SENDER, text: opts.text, is_transactional: transactional },
    };
    const res = await fetch(API + "/message/send.json", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok || (data && data.response_code && data.response_code !== 0 && data.response_code !== 800)) {
      throw new Error("turbosms " + res.status + ": " + JSON.stringify(data));
    }
    // message_id зазвичай у data.response_result[0].message_id
    const r = data.response_result && data.response_result[0];
    const id = (r && (r.message_id || r.messageId)) || ("turbosms_" + Date.now());
    const channel = r && r.channel ? r.channel : "viber";
    return { providerMsgId: String(id), channel: channel };
  },
  parseStatus(payload) {
    // вебхук TurboSMS: { message_id, status, channel? }
    return {
      providerMsgId: String(payload.message_id || payload.messageId || payload.id || ""),
      status: mapStatus(payload.status),
      channel: payload.channel || null,
    };
  },
  async pollStatus(ids) {
    if (!TOKEN || !ids.length) return [];
    const res = await fetch(API + "/message/status.json", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify({ messages: ids }),
    });
    const data = await res.json().catch(function () { return {}; });
    const arr = data.response_result || [];
    return arr.map(function (r) {
      return { providerMsgId: String(r.message_id || r.messageId || ""), status: mapStatus(r.status), channel: r.channel || null };
    });
  },
};
