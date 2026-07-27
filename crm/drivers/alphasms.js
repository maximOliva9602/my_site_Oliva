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

/* Номер у міжнародний формат для оператора: 380XXXXXXXXX (цифри без «+»).
   ВАЖЛИВО: AlphaSMS тарифікує будь-яке ПРИЙНЯТЕ повідомлення, навіть якщо
   оператор не може його доставити. Тому локальні «0XX…» без коду країни —
   це просто злиті гроші (шлюз бере оплату, доставки нема). UA-номери
   доводимо до 380…, іноземні лишаємо як є, а вочевидь побиті відсікаємо
   ще до відправки (див. валідацію у sendMessage). */
function normalizeUA(raw) {
  let d = String(raw == null ? "" : raw).replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("380")) return d;                          // вже міжнародний UA
  if (d.startsWith("0") && d.length === 10) return "38" + d;  // 0XXXXXXXXX -> 380XXXXXXXXX
  if (d.startsWith("80") && d.length === 11) return "3" + d;  // 80XXXXXXXXX -> 380XXXXXXXXX
  if (d.length === 9) return "380" + d;                       // XXXXXXXXX -> 380XXXXXXXXX
  return d;                                                    // іноземний номер — лишаємо
}

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
    const phone = normalizeUA(opts.phone);
    // Не палимо гроші на завідомо некоректних номерах: якщо після нормалізації
    // це не схоже на міжнародний номер (11–15 цифр) — навіть не звертаємось до
    // API (інакше AlphaSMS прийме, спише кошти, а оператор не доставить).
    if (!/^\d{11,15}$/.test(phone)) {
      throw new Error("alphasms: некоректний номер «" + opts.phone + "» — пропущено (очікується формат 380XXXXXXXXX)");
    }
    const id = nextId();
    const j = await call([{
      type: "sms",
      id: id,
      phone: phone, // міжнародний формат, цифри без «+»
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
