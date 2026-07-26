/* alphasms-драйвер: чисті SMS через AlphaSMS (alphasms.ua).
   Обраний замість turbosms через модель оплати: жодних місячних
   платежів і пакетів — тільки поштучна оплата відправлених SMS.
   Viber тут свідомо не використовуємо (див. turbosms.js: комерційний
   Viber-відправник — це місячний мінімум у будь-якого провайдера).

   API: POST https://alphasms.ua/api/json.php, ключ у полі "auth" тіла.
   Док: https://docs.alphasms.ua/ (JSON API).
   Статуси запитуються за нашим id повідомлення (поле id при відправці),
   тому саме його зберігаємо як providerMsgId, а не шлюзовий msg_id.

   ENV:
     ALPHASMS_KEY    — API-ключ з кабінету alphasms.ua
     ALPHASMS_SENDER — альфа-ім'я відправника (спершу можна загальне,
                       своє "Oliva" погоджується в кабінеті)
*/
const KEY = process.env.ALPHASMS_KEY || "";
const SENDER = process.env.ALPHASMS_SENDER || "Msg";
const API = process.env.ALPHASMS_API || "https://alphasms.ua/api/json.php";

/* Унікальний id повідомлення: мс-таймстамп ×100 + лічильник. Унікальний
   і між рестартами процесу (для status-запитів цього достатньо). */
let seq = 0;
function nextId() { return Date.now() * 100 + (seq++ % 100); }

/* Статуси AlphaSMS (SMPP-подібні, рядком або кодом) -> наш enum.
   Негативні — першими: UNDELIVERABLE містить підрядок DELIVER, тож
   зворотний порядок мапив би його в «доставлено». */
function mapStatus(s) {
  const v = String(s == null ? "" : s).toUpperCase();
  if (v.includes("UNDELIV") || v.includes("EXPIRE") || v.includes("REJECT") ||
      v.includes("DELETED") || v === "103" || v === "104" || v === "105" || v === "108") return "undelivered";
  if (v.includes("DELIVER") || v === "READ" || v === "102") return "delivered";
  // SCHEDULED/ENROUTE/ACCEPTED/UNKNOWN — ще в дорозі
  return "sent";
}

async function call(data) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auth: KEY, data: data }),
  });
  const j = await res.json().catch(function () { return {}; });
  if (!res.ok || j.success === false) {
    throw new Error("alphasms " + res.status + ": " + JSON.stringify(j.error || j));
  }
  return j;
}

module.exports = {
  name: "alphasms",

  async sendMessage(opts) {
    if (!KEY) throw new Error("ALPHASMS_KEY не задано");
    const id = nextId();
    const j = await call([{
      type: "sms",
      id: id,
      phone: String(opts.phone).replace(/\D/g, ""), // API хоче цифри без «+»
      sms_signature: SENDER,
      sms_message: opts.text,
      sms_lifetime: 86400,
    }]);
    const item = j.data && j.data[0];
    if (!item || item.success === false) {
      throw new Error("alphasms: " + JSON.stringify((item && item.error) || j));
    }
    return { providerMsgId: String(id), channel: "sms" };
  },

  /* Вебхук (поле hook) — формат {id, status}; приймаємо й синоніми. */
  parseStatus(payload) {
    return {
      providerMsgId: String(payload.id || payload.msg_id || payload.message_id || ""),
      status: mapStatus(payload.status),
      channel: "sms",
    };
  },

  async pollStatus(ids) {
    if (!KEY || !ids.length) return [];
    const j = await call(ids.map(function (id) {
      return { type: "status", id: parseInt(id, 10) };
    }));
    const arr = j.data || [];
    const out = [];
    arr.forEach(function (item) {
      const d = item && item.data;
      if (!item || item.success === false || !d) return;
      out.push({ providerMsgId: String(d.id), status: mapStatus(d.status), channel: "sms" });
    });
    return out;
  },
};
