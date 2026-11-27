/* Рейтинг Google на сайті. Цифри власник вписує в кабінеті (безкоштовно, без ключів
   і лімітів); зберігаються в app_settings. Картка показується лише для студій, де
   заповнено і оцінку, і кількість відгуків. */
const db = require("./db");

const KEY = "google_rating";
const STUDIOS = [
  { key: "borshchahivska", match: /борщагів/i, label: "вул. Борщагівська, 145",
    reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJTQzX8Ow38GYRKaa1CYwhqac" },
  { key: "uspishna", match: /успішн/i, label: "вул. Успішна, 8",
    reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJL48te7DJ1EAR6JYya9rk6UA" },
];

function read() {
  try {
    const r = db.prepare("SELECT value FROM app_settings WHERE key=?").get(KEY);
    return r ? JSON.parse(r.value) : {};
  } catch (e) { return {}; }
}

/* Порожнє поле — «не показувати»; некоректне значення — помилка. */
function clean(v) {
  const out = {};
  for (const s of STUDIOS) {
    const x = (v && v[s.key]) || {};
    const rawR = String(x.rating == null ? "" : x.rating).trim().replace(",", ".");
    const rawC = String(x.count == null ? "" : x.count).trim();
    const rating = rawR === "" ? null : Math.round(Number(rawR) * 10) / 10;
    const count = rawC === "" ? null : Number(rawC);
    if (rating !== null && !(rating >= 1 && rating <= 5)) return null;
    if (count !== null && !(Number.isInteger(count) && count >= 0 && count < 1000000)) return null;
    out[s.key] = { rating: rating, count: count };
  }
  return out;
}

function save(v) {
  db.prepare("INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(KEY, JSON.stringify(v));
}

function publicList() {
  const data = read();
  const branches = db.prepare("SELECT name, address, photo FROM branches WHERE active=1").all();
  return STUDIOS.filter(function (s) {
    const d = data[s.key];
    return d && d.rating && d.count > 0;
  }).map(function (s) {
    const b = branches.find(function (x) { return s.match.test((x.address || "") + " " + (x.name || "")); });
    return { key: s.key, address: s.label, photo: (b && b.photo) || null,
             rating: data[s.key].rating, count: data[s.key].count, reviewUrl: s.reviewUrl };
  });
}

module.exports = { read, clean, save, publicList };
