/* ============================================================
   crm/db.js — SQLite (better-sqlite3) для CRM Oliva.
   Один файл на Railway Volume (DB_FILE). Синхронний, тому
   read-check-insert у транзакції атомарний для 1 інстансу.
   Настінний час: date 'YYYY-MM-DD' + *_min (хвилини від півночі).
   Моменти: *_at — epoch ms UTC.
   ============================================================ */

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_FILE = process.env.DB_FILE || path.join(__dirname, "..", "data", "oliva.db");
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/* SQLite LIKE/LOWER () регістронезалежні лише для ASCII — українські
   імена/назви з великої літери не знаходились при пошуку в нижньому
   регістрі (і навпаки). LOWERU — те саме, але через JS String.toLowerCase(),
   який коректно опускає регістр і кирилиці. Використовувати як
   "WHERE LOWERU(col) LIKE LOWERU(?)" замість вбудованого LIKE. */
db.function("LOWERU", { deterministic: true }, function (s) {
  return s == null ? null : String(s).toLowerCase();
});

/* ---------------- Міграції ---------------- */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'worker',   -- 'owner' | 'worker'
  master_id     INTEGER,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (master_id) REFERENCES masters(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS masters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  color      TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  price        INTEGER NOT NULL DEFAULT 0,   -- копійки
  active       INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS master_services (
  master_id  INTEGER NOT NULL,
  service_id INTEGER NOT NULL,
  PRIMARY KEY (master_id, service_id),
  FOREIGN KEY (master_id)  REFERENCES masters(id)  ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ms_service ON master_services(service_id);

CREATE TABLE IF NOT EXISTS master_schedule (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  master_id  INTEGER NOT NULL,
  weekday    INTEGER NOT NULL,   -- 0=Нд .. 6=Сб
  work_start INTEGER NOT NULL,   -- хвилини від півночі
  work_end   INTEGER NOT NULL,
  FOREIGN KEY (master_id) REFERENCES masters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sched_master ON master_schedule(master_id, weekday);

CREATE TABLE IF NOT EXISTS master_breaks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  master_id   INTEGER NOT NULL,
  weekday     INTEGER NOT NULL,
  break_start INTEGER NOT NULL,
  break_end   INTEGER NOT NULL,
  FOREIGN KEY (master_id) REFERENCES masters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_break_master ON master_breaks(master_id, weekday);

CREATE TABLE IF NOT EXISTS master_time_off (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  master_id INTEGER NOT NULL,
  date      TEXT NOT NULL,             -- 'YYYY-MM-DD'
  full_day  INTEGER NOT NULL DEFAULT 1,
  off_start INTEGER,
  off_end   INTEGER,
  FOREIGN KEY (master_id) REFERENCES masters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_timeoff_master ON master_time_off(master_id, date);

CREATE TABLE IF NOT EXISTS clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phone         TEXT UNIQUE,          -- NULL для записів без телефону (SQLite дозволяє кілька NULL в UNIQUE)
  name          TEXT NOT NULL,
  note          TEXT,
  visit_count   INTEGER NOT NULL DEFAULT 0,
  last_visit_at INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id    TEXT UNIQUE NOT NULL,
  client_id    INTEGER NOT NULL,
  master_id    INTEGER NOT NULL,
  service_id   INTEGER NOT NULL,
  date         TEXT NOT NULL,          -- 'YYYY-MM-DD'
  start_min    INTEGER NOT NULL,
  end_min      INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,       -- знімок
  price        INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending|confirmed|cancelled|completed|no_show
  source       TEXT NOT NULL DEFAULT 'public',  -- public|staff
  comment      TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  FOREIGN KEY (client_id)  REFERENCES clients(id),
  FOREIGN KEY (master_id)  REFERENCES masters(id),
  FOREIGN KEY (service_id) REFERENCES services(id)
);
CREATE INDEX IF NOT EXISTS idx_appt_master_date ON appointments(master_id, date);
CREATE INDEX IF NOT EXISTS idx_appt_date        ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appt_client      ON appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_appt_status      ON appointments(status);

CREATE TABLE IF NOT EXISTS notifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL,
  kind           TEXT NOT NULL,        -- confirmation|reminder_24h|reminder_2h
  phone          TEXT NOT NULL,
  text           TEXT NOT NULL,
  provider       TEXT,
  provider_msg_id TEXT,
  status         TEXT NOT NULL DEFAULT 'queued', -- queued|sent|delivered|undelivered|failed
  final_channel  TEXT,                 -- viber|sms
  created_at     INTEGER NOT NULL,
  sent_at        INTEGER,
  status_at      INTEGER,
  UNIQUE (appointment_id, kind),
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notif_status   ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notif_provider ON notifications(provider_msg_id);
`);

/* ---------------- Таблиця блог-статей ---------------- */
db.exec(`
CREATE TABLE IF NOT EXISTS blog_posts (
  id        TEXT PRIMARY KEY,
  slug      TEXT UNIQUE NOT NULL,
  title     TEXT NOT NULL,
  excerpt   TEXT NOT NULL DEFAULT '',
  body      TEXT NOT NULL DEFAULT '',
  cover     TEXT NOT NULL DEFAULT '',
  date      TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_posts_slug      ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_published ON blog_posts(published, date);
`);

/* ---------------- Сторінки послуг ("Про цей масаж") ----------------
   Структурований лендінг за одним фіксованим шаблоном (hero, "Знайоме
   відчуття", переваги, кроки сеансу, кому підійде) — власник заповнює
   лише текст у полях, розмітку й порядок секцій міняти не може.
   Прив'язка до послуги — той самий service_key, що й у blog_posts
   (базова назва послуги без рівня майстра й тривалості). Списки
   (symptoms/benefits/steps/suitable) зберігаються рядок-на-пункт у
   textarea; для benefits/steps формат рядка "Заголовок :: текст".
   Порожня секція на сайті просто не рендериться. */
db.exec(`
CREATE TABLE IF NOT EXISTS service_pages (
  service_key        TEXT PRIMARY KEY,
  hero_title          TEXT NOT NULL DEFAULT '',
  hero_tagline         TEXT NOT NULL DEFAULT '',
  hero_description     TEXT NOT NULL DEFAULT '',
  hero_photo           TEXT NOT NULL DEFAULT '',
  symptoms_title        TEXT NOT NULL DEFAULT '',
  symptoms_items        TEXT NOT NULL DEFAULT '',
  symptoms_photo        TEXT NOT NULL DEFAULT '',
  symptoms_quote        TEXT NOT NULL DEFAULT '',
  benefits_title        TEXT NOT NULL DEFAULT '',
  benefits_items        TEXT NOT NULL DEFAULT '',
  steps_title           TEXT NOT NULL DEFAULT '',
  steps_items           TEXT NOT NULL DEFAULT '',
  detail_description    TEXT NOT NULL DEFAULT '',
  suitable_items        TEXT NOT NULL DEFAULT '',
  published             INTEGER NOT NULL DEFAULT 0,
  updated_at            INTEGER NOT NULL
);
`);

/* ---------------- Таблиця відвідувань сайту ---------------- */
db.exec(`
CREATE TABLE IF NOT EXISTS page_visits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT    NOT NULL,
  referrer   TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  event      TEXT    NOT NULL DEFAULT 'pageview',
  label      TEXT,
  session_id TEXT,
  ip_hash    TEXT,
  ua_type    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pv_created ON page_visits(created_at);
CREATE INDEX IF NOT EXISTS idx_pv_path    ON page_visits(path);
CREATE INDEX IF NOT EXISTS idx_pv_event   ON page_visits(event);
`);

/* ---------------- Міграція: ціни в копійках ---------------- */
/* Якщо ціни в БД ще в гривнях (MAX < 10000) — множимо на 100 */
(function migrateprices() {
  const maxPrice = db.prepare("SELECT MAX(price) v FROM services").get().v || 0;
  if (maxPrice > 0 && maxPrice < 10000) {
    db.prepare("UPDATE services SET price = price * 100").run();
    console.log("[db] Міграція: ціни переведено в копійки.");
  }
})();

/* ВИДАЛЕНО: перший seedServices() з цінами в гривнях */
/* Зараз використовується тільки seed() нижче (ціни в копійках) */

/* ---------------- DEPRECATED seed (не видаляти — для довідки) ---------------- */
if (false) { // eslint-disable-line
  const _services_grn = [
    ["Загально-оздоровчий масаж (Майстер) 30 хв", 30, 700],
    ["Загально-оздоровчий масаж (Майстер) 45 хв", 45, 1000],
    ["Загально-оздоровчий масаж (Майстер) 60 хв", 60, 1200],
    ["Загально-оздоровчий масаж (Майстер) 90 хв", 90, 1600],
    ["Загально-оздоровчий масаж (Майстер) 120 хв", 120, 2200],
    ["Загально-оздоровчий масаж (Топ Майстер) 30 хв", 30, 800],
    ["Загально-оздоровчий масаж (Топ Майстер) 45 хв", 45, 1150],
    ["Загально-оздоровчий масаж (Топ Майстер) 60 хв", 60, 1350],
    ["Загально-оздоровчий масаж (Топ Майстер) 90 хв", 90, 1750],
    ["Загально-оздоровчий масаж (Топ Майстер) 120 хв", 120, 2300],
    ["Антистресовий масаж (Майстер) 30 хв", 30, 700],
    ["Антистресовий масаж (Майстер) 45 хв", 45, 1000],
    ["Антистресовий масаж (Майстер) 60 хв", 60, 1200],
    ["Антистресовий масаж (Майстер) 90 хв", 90, 1600],
    ["Антистресовий масаж (Майстер) 120 хв", 120, 2200],
    ["Антистресовий масаж (Топ Майстер) 30 хв", 30, 800],
    ["Антистресовий масаж (Топ Майстер) 45 хв", 45, 1150],
    ["Антистресовий масаж (Топ Майстер) 60 хв", 60, 1350],
    ["Антистресовий масаж (Топ Майстер) 90 хв", 90, 1750],
    ["Антистресовий масаж (Топ Майстер) 120 хв", 120, 2300],
    ["Парний масаж 60 хв", 60, 2700],
    ["Парний масаж 90 хв", 90, 3500],
    ["Парний масаж 120 хв", 120, 4500],
    ["Масаж спини (Майстер) 60 хв", 60, 1200],
    ["Масаж спини (Топ Майстер) 30 хв", 30, 800],
    ["Масаж спини (Топ Майстер) 45 хв", 45, 1150],
    ["Масаж спини (Топ Майстер) 60 хв", 60, 1350],
    ["Масаж шийно-комірцевої зони (Майстер) 30 хв", 30, 700],
    ["Масаж шийно-комірцевої зони (Майстер) 45 хв", 45, 1000],
    ["Масаж шийно-комірцевої зони (Майстер) 60 хв", 60, 1200],
    ["Масаж шийно-комірцевої зони (Топ Майстер) 30 хв", 30, 800],
    ["Масаж шийно-комірцевої зони (Топ Майстер) 45 хв", 45, 1150],
    ["Масаж шийно-комірцевої зони (Топ Майстер) 60 хв", 60, 1350],
    ["Класичний масаж обличчя (Майстер) 30 хв", 30, 700],
    ["Класичний масаж обличчя (Майстер) 45 хв", 45, 1000],
    ["Класичний масаж обличчя (Майстер) 60 хв", 60, 1200],
    ["Класичний масаж обличчя (Топ Майстер) 30 хв", 30, 800],
    ["Класичний масаж обличчя (Топ Майстер) 45 хв", 45, 1150],
    ["Класичний масаж обличчя (Топ Майстер) 60 хв", 60, 1350],
    ["Лімфодренажний масаж (Майстер) 30 хв", 30, 700],
    ["Лімфодренажний масаж (Майстер) 45 хв", 45, 1000],
    ["Лімфодренажний масаж (Майстер) 60 хв", 60, 1200],
    ["Лімфодренажний масаж (Майстер) 90 хв", 90, 1600],
    ["Лімфодренажний масаж (Топ Майстер) 30 хв", 30, 800],
    ["Лімфодренажний масаж (Топ Майстер) 45 хв", 45, 1150],
    ["Лімфодренажний масаж (Топ Майстер) 60 хв", 60, 1350],
    ["Лімфодренажний масаж (Топ Майстер) 90 хв", 90, 1750],
    ["Антицелюлітний масаж (Майстер) 45 хв", 45, 1000],
    ["Антицелюлітний масаж (Майстер) 60 хв", 60, 1200],
    ["Антицелюлітний масаж (Майстер) 90 хв", 90, 1600],
    ["Антицелюлітний масаж (Майстер) 120 хв", 120, 2200],
    ["Антицелюлітний масаж (Топ Майстер) 30 хв", 30, 800],
    ["Антицелюлітний масаж (Топ Майстер) 45 хв", 45, 1150],
    ["Антицелюлітний масаж (Топ Майстер) 60 хв", 60, 1450],
    ["Антицелюлітний масаж (Топ Майстер) 90 хв", 90, 1750],
    ["Антицелюлітний масаж (Топ Майстер) 120 хв", 120, 2300],
    ["Паріння у фітобочці 20 хв", 20, 500],
    ["Паріння у фітобочці 30 хв", 30, 600],
    ["Паріння у фітобочці 45 хв", 45, 700],
    ["Паріння у фітобочці 60 хв", 60, 800],
    ["SPA Ритуал \"Фіто-оновлення тіла\" 90 хв", 90, 2150],
    ["SPA Ритуал \"Фіто-оновлення тіла\" 130 хв", 130, 2800],
    ["Тепловий SPA-ритуал \"Глибоке прогрівання для двох\" 130 хв", 130, 3800],
    ["Тепловий SPA-ритуал \"Глибоке прогрівання для двох\" 160 хв", 160, 4500],
    ["Тепловий SPA-ритуал \"Глибоке прогрівання для двох\" 220 хв", 220, 5800],
    ["Дитячий масаж (Майстер) 30 хв", 30, 700],
    ["Дитячий масаж (Майстер) 45 хв", 45, 1000],
    ["Дитячий масаж (Майстер) 60 хв", 60, 1200],
    ["Дитячий масаж (Майстер) 90 хв", 90, 1600],
    ["Дитячий масаж (Топ Майстер) 30 хв", 30, 800],
    ["Дитячий масаж (Топ Майстер) 45 хв", 45, 1150],
    ["Дитячий масаж (Топ Майстер) 60 хв", 60, 1350],
    ["Дитячий масаж (Топ Майстер) 90 хв", 90, 1750],
    ["Масаж в чотири руки 60 хв", 60, 2700],
    ["Масаж в чотири руки 90 хв", 90, 3500],
    ["Масаж в чотири руки 120 хв", 120, 4500],
    ["Масаж гарячим камінням 60 хв", 60, 1600],
    ["Масаж гарячим камінням 90 хв", 90, 2200],
    ["Спортивний масаж (Майстер) 60 хв", 60, 1200],
    ["Спортивний масаж (Майстер) 90 хв", 90, 1600],
    ["Спортивний масаж (Топ Майстер) 60 хв", 60, 1350],
    ["Спортивний масаж (Топ Майстер) 90 хв", 90, 1750],
    ["Антивіковий масаж обличчя (Майстер) 60 хв", 60, 1200],
    ["Антивіковий масаж обличчя (Топ Майстер) 60 хв", 60, 1350],
    ["Антивіковий масаж обличчя (Топ Майстер) 90 хв", 90, 1750],
  ]; // _services_grn — не використовується
} // end if(false)

/* ---------------- Міграції: нові колонки ---------------- */
try { db.exec("ALTER TABLE masters ADD COLUMN photo TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE masters ADD COLUMN level TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE masters ADD COLUMN mono_link TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE masters ADD COLUMN last_name TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE services ADD COLUMN category TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE services ADD COLUMN description TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE services ADD COLUMN image_url TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE services ADD COLUMN featured INTEGER NOT NULL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE services ADD COLUMN in_carousel INTEGER NOT NULL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE appointments ADD COLUMN paid INTEGER NOT NULL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE appointments ADD COLUMN pay_method TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE appointments ADD COLUMN color_marker TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE appointments ADD COLUMN extra_services TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE appointments ADD COLUMN subscription_used INTEGER NOT NULL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE blog_posts ADD COLUMN service_key TEXT"); } catch(e) {} // стаття-опис послуги (для «Детальніше» на головній)
try { db.exec("ALTER TABLE clients ADD COLUMN blacklisted INTEGER NOT NULL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE masters ADD COLUMN branch_id INTEGER REFERENCES branches(id)"); } catch(e) {}
try { db.exec("ALTER TABLE masters ADD COLUMN can_see_phones INTEGER NOT NULL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE masters ADD COLUMN can_edit_own_schedule INTEGER NOT NULL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE masters ADD COLUMN experience_years INTEGER NOT NULL DEFAULT 0"); } catch(e) {}
/* Відмова від масових розсилок. Нагадувань про запис не стосується —
   ті транзакційні й типово надсилаються всім. */
try { db.exec("ALTER TABLE clients ADD COLUMN no_marketing INTEGER NOT NULL DEFAULT 0"); } catch(e) {}
/* Вимкнення SMS-нагадувань для ОКРЕМОГО клієнта (типово всім увімкнено). */
try { db.exec("ALTER TABLE clients ADD COLUMN no_reminders INTEGER NOT NULL DEFAULT 0"); } catch(e) {}

/* ---------------- Налаштування (key-value) ----------------
   Напр. reminder1_hours / reminder2_hours — за скільки годин до візиту
   надсилати нагадування; notif_* — перемикачі типів SMS-сповіщень
   (редагується у CRM, вкладка Сповіщення). */
db.exec("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)");

/* День народження клієнта ('YYYY-MM-DD') — для SMS-привітання. */
try { db.exec("ALTER TABLE clients ADD COLUMN birthday TEXT"); } catch(e) {}

/* ---------------- Оплата праці майстрів ----------------
   masters.pay_percent — типовий відсоток майстра для НОВОГО клієнта;
   masters.pay_percent_return — для ПОВТОРНОГО (null = як для нового).
   Повторний = клієнт, який уже має завершений візит у цього ж майстра.
   master_service_pay — персональна ставка на конкретну послугу:
   mode='percent' (value у %) або mode='fixed' (value у КОПІЙКАХ за візит);
   value — для нового клієнта, value_return — для повторного (null = як value).
   Заробіток рахується із завершених (completed) візитів. */
try { db.exec("ALTER TABLE masters ADD COLUMN pay_percent REAL"); } catch(e) {}
try { db.exec("ALTER TABLE masters ADD COLUMN pay_percent_return REAL"); } catch(e) {}
db.exec(`CREATE TABLE IF NOT EXISTS master_service_pay (
  master_id  INTEGER NOT NULL,
  service_id INTEGER NOT NULL,
  mode       TEXT NOT NULL CHECK (mode IN ('percent','fixed')),
  value      REAL NOT NULL,
  PRIMARY KEY (master_id, service_id),
  FOREIGN KEY (master_id)  REFERENCES masters(id)  ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
)`);
try { db.exec("ALTER TABLE master_service_pay ADD COLUMN value_return REAL"); } catch(e) {}

/* Підвищена ставка за візити, зараховані з абонементу (майстер, що продав
   абонемент клієнту, отримує трохи більший %). masters.pay_percent_subscription —
   типовий відсоток (null = як для нового клієнта). Окрема таблиця, а не ще
   одна колонка в master_service_pay: субставка на послугу не прив'язана до
   mode/value звичайної ставки — послуга може мати лише абонементський %,
   без окремого override для нового/повторного клієнта. */
try { db.exec("ALTER TABLE masters ADD COLUMN pay_percent_subscription REAL"); } catch(e) {}
/* Окремо від "active" — щоб можна було прибрати майстра з публічного
   сайту (лендінг, онлайн-запис), лишивши його активним у CRM (записи,
   графік, зарплата й далі працюють як завжди). */
try { db.exec("ALTER TABLE masters ADD COLUMN show_on_site INTEGER NOT NULL DEFAULT 1"); } catch(e) {}
/* Telegram-сповіщення майстру про ЙОГО записи. Бот не може написати
   першим, тому прив'язка разова: CRM видає одноразовий код, майстер
   тисне t.me/<bot>?start=<код>, вебхук зберігає сюди його chat_id. */
try { db.exec("ALTER TABLE masters ADD COLUMN tg_chat_id TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE masters ADD COLUMN tg_link_code TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE masters ADD COLUMN tg_code_expires INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE masters ADD COLUMN tg_linked_at INTEGER"); } catch(e) {}
db.exec(`CREATE TABLE IF NOT EXISTS master_subscription_pay (
  master_id  INTEGER NOT NULL,
  service_id INTEGER NOT NULL,
  value      REAL NOT NULL,
  PRIMARY KEY (master_id, service_id),
  FOREIGN KEY (master_id)  REFERENCES masters(id)  ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
)`);
/* Номер сеансу абонементу, зафіксований НАЗАВЖДИ в момент завершення візиту
   (і загальна к-ть сеансів абонементу на той момент) — щоб бейдж "3/5" на
   картці завершеного візиту показував, яким сеансом БУВ САМЕ ЦЕЙ візит,
   а не поточний підсумок абонементу (який однаковий на всіх картках і
   росте далі з новими візитами). Скидається в NULL, якщо статус
   "Завершено" знімають (сеанс повертається — див. setStatus). */
try { db.exec("ALTER TABLE appointments ADD COLUMN subscription_session_no INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE appointments ADD COLUMN subscription_session_total INTEGER"); } catch(e) {}

/* Одноразове донарахування номерів сеансів для візитів, завершених ЩЕ ДО
   появи полів вище (subscription_session_no тоді ще не було куди писати).
   Рахуємо лише коли в клієнта РІВНО ОДИН абонемент на групу тарифів
   послуги (типовий випадок) — так однозначно видно, яким за рахунком був
   кожен візит. Якщо абонементів на ту саму послугу декілька (клієнт
   купував повторно) — прив'язку неможливо відновити однозначно заднім
   числом, такі рядки лишаємо NULL (як і було, без регресії). */
try {
  const pending = db.prepare(
    `SELECT id, client_id, service_id, date, start_min FROM appointments
      WHERE subscription_used=1 AND subscription_session_no IS NULL`
  ).all();
  if (pending.length) {
    const allServices = db.prepare("SELECT id, name FROM services").all();
    function baseKey(name) {
      const cat = String(name || "")
        .replace(/\s*\((Топ Майстер|Майстер)\)/, "")
        .replace(/\s+\d+\s*хв$/, "")
        .replace(/\s+\d+\s*год.*$/, "")
        .trim().toLowerCase();
      const durM = String(name || "").match(/(\d+)\s*хв/);
      const durH = String(name || "").match(/(\d+)\s*год/);
      const dur = durM ? parseInt(durM[1], 10) : (durH ? parseInt(durH[1], 10) * 60 : null);
      return cat + "|" + (dur || "");
    }
    const nameById = {}; allServices.forEach(function (s) { nameById[s.id] = s.name; });
    const groupIdsByKey = {};
    allServices.forEach(function (s) {
      const k = baseKey(s.name);
      (groupIdsByKey[k] || (groupIdsByKey[k] = [])).push(s.id);
    });

    // Групуємо непроставлені візити за client_id + ключ групи послуги
    const byGroup = {};
    pending.forEach(function (a) {
      const k = baseKey(nameById[a.service_id]);
      const gk = a.client_id + "|" + k;
      (byGroup[gk] || (byGroup[gk] = { clientId: a.client_id, key: k, rows: [] })).rows.push(a);
    });

    const upd = db.prepare("UPDATE appointments SET subscription_session_no=?, subscription_session_total=? WHERE id=?");
    let fixed = 0;
    Object.keys(byGroup).forEach(function (gk) {
      const g = byGroup[gk];
      const svcIds = groupIdsByKey[g.key] || [];
      if (!svcIds.length) return;
      const subsStmt = db.prepare(
        `SELECT id, total_sessions, used_sessions FROM subscriptions WHERE client_id=? AND service_id IN (${svcIds.map(function(){return "?";}).join(",")})`
      );
      const subs = subsStmt.all.apply(subsStmt, [g.clientId].concat(svcIds));
      if (subs.length !== 1) return; // неоднозначно — лишаємо як є
      const sub = subs[0];
      g.rows.sort(function (a, b) { return a.date === b.date ? a.start_min - b.start_min : (a.date < b.date ? -1 : 1); });
      const n = Math.min(g.rows.length, sub.used_sessions);
      for (let i = 0; i < n; i++) {
        upd.run(i + 1, sub.total_sessions, g.rows[i].id);
        fixed++;
      }
    });
    if (fixed) console.log(`[db] донараховано номер сеансу абонементу для ${fixed} існуючих завершених візитів`);
  }
} catch (e) { console.error("[db] backfill subscription_session_no:", e.message); }

/* Журнал надісланих привітань: раз на рік на клієнта, переживає рестарти. */
db.exec(`CREATE TABLE IF NOT EXISTS birthday_greetings (
  client_id INTEGER NOT NULL,
  year      INTEGER NOT NULL,
  sent_at   INTEGER,
  PRIMARY KEY (client_id, year)
)`);

/* ---------------- Масові розсилки ---------------- */
db.exec(`
CREATE TABLE IF NOT EXISTS broadcasts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text       TEXT    NOT NULL,
  total      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS broadcast_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id INTEGER NOT NULL,
  client_id    INTEGER,
  phone        TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'queued', -- queued|sent|delivered|undelivered|failed
  provider     TEXT,
  provider_msg_id TEXT,
  final_channel TEXT,
  error        TEXT,
  created_at   INTEGER NOT NULL,
  sent_at      INTEGER,
  status_at    INTEGER,
  -- один номер не отримує ту саму розсилку двічі, навіть якщо в базі
  -- два записи клієнта з однаковим телефоном
  UNIQUE (broadcast_id, phone),
  FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bmsg_status   ON broadcast_messages(status);
CREATE INDEX IF NOT EXISTS idx_bmsg_provider ON broadcast_messages(provider_msg_id);
`);

/* Разові блокування часу в календарі */
db.exec(`
CREATE TABLE IF NOT EXISTS day_blocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  master_id  INTEGER NOT NULL,
  date       TEXT    NOT NULL,
  start_min  INTEGER NOT NULL,
  end_min    INTEGER NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (master_id) REFERENCES masters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_day_blocks_date ON day_blocks(date, master_id);

CREATE TABLE IF NOT EXISTS master_day_overrides (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  master_id  INTEGER NOT NULL,
  date       TEXT    NOT NULL,
  is_off     INTEGER NOT NULL DEFAULT 0,
  work_start INTEGER,
  work_end   INTEGER,
  UNIQUE(master_id, date),
  FOREIGN KEY (master_id) REFERENCES masters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_day_overrides ON master_day_overrides(master_id, date);

CREATE TABLE IF NOT EXISTS branches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  photo      TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS branch_schedule (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id  INTEGER NOT NULL,
  weekday    INTEGER NOT NULL,
  work_start INTEGER NOT NULL,
  work_end   INTEGER NOT NULL,
  UNIQUE(branch_id, weekday),
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

/* Один майстер може працювати в кількох філіях. masters.branch_id
   залишається його основною філією для сумісності зі старими даними. */
CREATE TABLE IF NOT EXISTS branch_masters (
  branch_id INTEGER NOT NULL,
  master_id INTEGER NOT NULL,
  PRIMARY KEY (branch_id, master_id),
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (master_id) REFERENCES masters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_branch_masters_master ON branch_masters(master_id);
`);

/* Для майстра з кількома філіями запис повинен пам'ятати конкретну
   філію, яку обрав клієнт. Старі записи залишаються сумісними (NULL). */
try { db.exec("ALTER TABLE appointments ADD COLUMN branch_id INTEGER REFERENCES branches(id)"); } catch(e) {}

/* Парні процедури ("SPA для двох") обслуговують два майстри одночасно,
   але запис/оплата — один. Другого майстра власник додає вручну в CRM
   (клієнт при онлайн-записі обирає лише "свого"). NULL — для всіх
   звичайних записів і для старих парних записів до цієї міграції. */
try { db.exec("ALTER TABLE appointments ADD COLUMN second_master_id INTEGER REFERENCES masters(id)"); } catch(e) {}

/* Одноразово та безпечно переносимо старі прив'язки до нової таблиці.
   INSERT OR IGNORE дозволяє запускати міграцію на кожному старті. */
db.exec(`
  INSERT OR IGNORE INTO branch_masters (branch_id, master_id)
  SELECT m.branch_id, m.id
    FROM masters m
    JOIN branches b ON b.id=m.branch_id
   WHERE m.branch_id IS NOT NULL
`);

/* Абонементи */
db.exec(`
CREATE TABLE IF NOT EXISTS subscriptions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER NOT NULL,
  service_id     INTEGER NOT NULL,
  total_sessions INTEGER NOT NULL,
  used_sessions  INTEGER NOT NULL DEFAULT 0,
  price          INTEGER NOT NULL DEFAULT 0,
  note           TEXT,
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (client_id)  REFERENCES clients(id)  ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES services(id)
);
CREATE INDEX IF NOT EXISTS idx_subs_client ON subscriptions(client_id);
`);

/* Таблиця відгуків */
db.exec(`
CREATE TABLE IF NOT EXISTS reviews (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL UNIQUE,
  master_id      INTEGER NOT NULL,
  client_id      INTEGER NOT NULL,
  rating         INTEGER NOT NULL,
  comment        TEXT,
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  FOREIGN KEY (master_id)      REFERENCES masters(id),
  FOREIGN KEY (client_id)      REFERENCES clients(id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_master ON reviews(master_id);
`);

/* Подарункові сертифікати, куплені через сайт. Клієнт називає code
   адміністратору при візиті — той перевіряє валідність у CRM
   (не використаний, не прострочений) і одразу записує на послугу.
   amount — у копійках, як і всі ціни в базі. expires_at — created_at +
   2 місяці, відповідно до умов на самій сторінці сертифіката. */
db.exec(`
CREATE TABLE IF NOT EXISTS certificates (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  code                  TEXT NOT NULL UNIQUE,
  buyer_name            TEXT NOT NULL,
  buyer_phone           TEXT NOT NULL,
  recipient             TEXT,
  service_label         TEXT,
  amount                INTEGER NOT NULL DEFAULT 0,
  cert_type             TEXT,
  delivery              TEXT,
  address               TEXT,
  wishes                TEXT,
  status                TEXT NOT NULL DEFAULT 'active', -- active|used|cancelled
  used_at               INTEGER,
  used_by_appointment_id INTEGER,
  used_note             TEXT,
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,
  FOREIGN KEY (used_by_appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_certificates_phone ON certificates(buyer_phone);
CREATE INDEX IF NOT EXISTS idx_certificates_status ON certificates(status);
`);

/* ---------------- Seed початкових даних ---------------- */
(function seed() {
  const now = Date.now();

  /* ---- Послуги (ціни в копійках = грн × 100) ---- */
  if (db.prepare("SELECT COUNT(*) n FROM services").get().n === 0) {
    const insSvc = db.prepare(
      "INSERT OR IGNORE INTO services (name, duration_min, price, active, sort_order, created_at) VALUES (?, ?, ?, 1, ?, ?)"
    );
    const services = [
      ["Загально-оздоровчий масаж (Майстер) 30 хв",       30,  70000],
      ["Загально-оздоровчий масаж (Майстер) 45 хв",       45, 100000],
      ["Загально-оздоровчий масаж (Майстер) 60 хв",       60, 120000],
      ["Загально-оздоровчий масаж (Майстер) 90 хв",       90, 160000],
      ["Загально-оздоровчий масаж (Майстер) 120 хв",     120, 220000],
      ["Загально-оздоровчий масаж (Топ Майстер) 30 хв",   30,  80000],
      ["Загально-оздоровчий масаж (Топ Майстер) 45 хв",   45, 115000],
      ["Загально-оздоровчий масаж (Топ Майстер) 60 хв",   60, 135000],
      ["Загально-оздоровчий масаж (Топ Майстер) 90 хв",   90, 175000],
      ["Загально-оздоровчий масаж (Топ Майстер) 120 хв", 120, 230000],
      ["Антистресовий масаж (Майстер) 30 хв",             30,  70000],
      ["Антистресовий масаж (Майстер) 45 хв",             45, 100000],
      ["Антистресовий масаж (Майстер) 60 хв",             60, 120000],
      ["Антистресовий масаж (Майстер) 90 хв",             90, 160000],
      ["Антистресовий масаж (Майстер) 120 хв",           120, 220000],
      ["Антистресовий масаж (Топ Майстер) 30 хв",         30,  80000],
      ["Антистресовий масаж (Топ Майстер) 45 хв",         45, 115000],
      ["Антистресовий масаж (Топ Майстер) 60 хв",         60, 135000],
      ["Антистресовий масаж (Топ Майстер) 90 хв",         90, 175000],
      ["Антистресовий масаж (Топ Майстер) 120 хв",       120, 230000],
      ["Парний масаж 60 хв",                               60, 270000],
      ["Парний масаж 90 хв",                               90, 350000],
      ["Парний масаж 120 хв",                             120, 450000],
      ["Масаж спини (Майстер) 60 хв",                     60, 120000],
      ["Масаж спини (Топ Майстер) 30 хв",                 30,  80000],
      ["Масаж спини (Топ Майстер) 45 хв",                 45, 115000],
      ["Масаж спини (Топ Майстер) 60 хв",                 60, 135000],
      ["Масаж шийно-комірцевої зони (Майстер) 30 хв",     30,  70000],
      ["Масаж шийно-комірцевої зони (Майстер) 45 хв",     45, 100000],
      ["Масаж шийно-комірцевої зони (Майстер) 60 хв",     60, 120000],
      ["Масаж шийно-комірцевої зони (Топ Майстер) 30 хв", 30,  80000],
      ["Масаж шийно-комірцевої зони (Топ Майстер) 45 хв", 45, 115000],
      ["Масаж шийно-комірцевої зони (Топ Майстер) 60 хв", 60, 135000],
      ["Класичний масаж обличчя (Майстер) 30 хв",         30,  70000],
      ["Класичний масаж обличчя (Майстер) 45 хв",         45, 100000],
      ["Класичний масаж обличчя (Майстер) 60 хв",         60, 120000],
      ["Класичний масаж обличчя (Топ Майстер) 30 хв",     30,  80000],
      ["Класичний масаж обличчя (Топ Майстер) 45 хв",     45, 115000],
      ["Класичний масаж обличчя (Топ Майстер) 60 хв",     60, 135000],
      ["Лімфодренажний масаж (Майстер) 30 хв",            30,  70000],
      ["Лімфодренажний масаж (Майстер) 45 хв",            45, 100000],
      ["Лімфодренажний масаж (Майстер) 60 хв",            60, 120000],
      ["Лімфодренажний масаж (Майстер) 90 хв",            90, 160000],
      ["Лімфодренажний масаж (Топ Майстер) 30 хв",        30,  80000],
      ["Лімфодренажний масаж (Топ Майстер) 45 хв",        45, 115000],
      ["Лімфодренажний масаж (Топ Майстер) 60 хв",        60, 135000],
      ["Лімфодренажний масаж (Топ Майстер) 90 хв",        90, 175000],
      ["Антицелюлітний масаж (Майстер) 45 хв",            45, 100000],
      ["Антицелюлітний масаж (Майстер) 60 хв",            60, 120000],
      ["Антицелюлітний масаж (Майстер) 90 хв",            90, 160000],
      ["Антицелюлітний масаж (Майстер) 120 хв",          120, 220000],
      ["Антицелюлітний масаж (Топ Майстер) 30 хв",        30,  80000],
      ["Антицелюлітний масаж (Топ Майстер) 45 хв",        45, 115000],
      ["Антицелюлітний масаж (Топ Майстер) 60 хв",        60, 145000],
      ["Антицелюлітний масаж (Топ Майстер) 90 хв",        90, 175000],
      ["Антицелюлітний масаж (Топ Майстер) 120 хв",      120, 230000],
      ["Паріння у фітобочці 20 хв",                       20,  50000],
      ["Паріння у фітобочці 30 хв",                       30,  60000],
      ["Паріння у фітобочці 45 хв",                       45,  70000],
      ["Паріння у фітобочці 60 хв",                       60,  80000],
      ['SPA Ритуал "Фіто-оновлення тіла" 90 хв',         90, 215000],
      ['SPA Ритуал "Фіто-оновлення тіла" 130 хв',       130, 280000],
      ['Тепловий SPA-ритуал "Глибоке прогрівання для двох" 130 хв', 130, 380000],
      ['Тепловий SPA-ритуал "Глибоке прогрівання для двох" 160 хв', 160, 450000],
      ['Тепловий SPA-ритуал "Глибоке прогрівання для двох" 220 хв', 220, 580000],
      ["Дитячий масаж (Майстер) 30 хв",                   30,  70000],
      ["Дитячий масаж (Майстер) 45 хв",                   45, 100000],
      ["Дитячий масаж (Майстер) 60 хв",                   60, 120000],
      ["Дитячий масаж (Майстер) 90 хв",                   90, 160000],
      ["Дитячий масаж (Топ Майстер) 30 хв",               30,  80000],
      ["Дитячий масаж (Топ Майстер) 45 хв",               45, 115000],
      ["Дитячий масаж (Топ Майстер) 60 хв",               60, 135000],
      ["Дитячий масаж (Топ Майстер) 90 хв",               90, 175000],
      ["Масаж в чотири руки 60 хв",                       60, 270000],
      ["Масаж в чотири руки 90 хв",                       90, 350000],
      ["Масаж в чотири руки 120 хв",                     120, 450000],
      ["Масаж гарячим камінням 60 хв",                    60, 160000],
      ["Масаж гарячим камінням 90 хв",                    90, 220000],
      ["Спортивний масаж (Майстер) 60 хв",                60, 120000],
      ["Спортивний масаж (Майстер) 90 хв",                90, 160000],
      ["Спортивний масаж (Топ Майстер) 60 хв",            60, 135000],
      ["Спортивний масаж (Топ Майстер) 90 хв",            90, 175000],
      ["Антивіковий масаж обличчя (Майстер) 60 хв",       60, 120000],
      ["Антивіковий масаж обличчя (Топ Майстер) 60 хв",   60, 135000],
      ["Антивіковий масаж обличчя (Топ Майстер) 90 хв",   90, 175000],
    ];
    const svcTx = db.transaction(function() {
      services.forEach(function([name, dur, price], i) { insSvc.run(name, dur, price, i, now); });
    });
    svcTx();
    console.log("[db] Seed: додано " + services.length + " послуг.");
  }

  /* ---- Майстри ---- */
  if (db.prepare("SELECT COUNT(*) n FROM masters").get().n === 0) {
    const insM = db.prepare(
      "INSERT INTO masters (name, photo, level, active, sort_order, created_at) VALUES (?,?,?,1,?,?)"
    );
    const insSched = db.prepare(
      "INSERT OR IGNORE INTO master_schedule (master_id, weekday, work_start, work_end) VALUES (?,?,540,1290)"
    );
    const insMS = db.prepare(
      "INSERT OR IGNORE INTO master_services (master_id, service_id) VALUES (?,?)"
    );

    const masterData = [
      { name: "Максим",   photo: "assets/img/master-maksym.jpg",   level: "Топ Майстер", sort: 0 },
      { name: "Ярослав",  photo: "assets/img/master-yaroslav.jpg",  level: "Топ Майстер", sort: 1 },
      { name: "Олена",    photo: "assets/img/master-olena.jpg",     level: "Топ Майстер", sort: 2 },
      { name: "Тетяна",   photo: "assets/img/master-tetiana.jpg",   level: "Топ Майстер", sort: 3 },
      { name: "Людмила",  photo: "assets/img/master-liudmyla.jpg",  level: "Майстер",     sort: 4 },
    ];

    const allServices = db.prepare("SELECT id, name FROM services WHERE active=1").all();

    const masterTx = db.transaction(function() {
      masterData.forEach(function(m) {
        const r = insM.run(m.name, m.photo, m.level, m.sort, now);
        const mid = r.lastInsertRowid;
        // Розклад: Пн-Сб (1-6), 9:00-21:30
        for (let wd = 1; wd <= 6; wd++) insSched.run(mid, wd);
        // Прив'язати послуги за рівнем
        allServices.forEach(function(s) {
          const hasLevel = s.name.includes("(Топ Майстер)") || s.name.includes("(Майстер)");
          const matchTop = s.name.includes("(Топ Майстер)") && m.level === "Топ Майстер";
          const matchReg = s.name.includes("(Майстер)") && !s.name.includes("(Топ Майстер)") && m.level === "Майстер";
          const noLevel  = !hasLevel; // парний, фітобочка, SPA — всі майстри
          if (matchTop || matchReg || noLevel) insMS.run(mid, s.id);
        });
      });
    });
    masterTx();
    console.log("[db] Seed: додано " + masterData.length + " майстрів з розкладом.");
  }
})();

/* ---------------- Seed: відсутні послуги з сайту ---------------- */
(function seedMissingServices() {
  var now = Date.now();
  var chk = db.prepare("SELECT COUNT(*) n FROM services WHERE name = ?");
  var ins = db.prepare(
    "INSERT INTO services (name, duration_min, price, active, sort_order, created_at) VALUES (?,?,?,1,999,?)"
  );
  var newSvcs = [
    /* === Прайс Майстер: відсутні === */
    ["Масаж спини (Майстер) 30 хв",                      30,  70000],
    ["Масаж спини (Майстер) 45 хв",                      45, 100000],
    ["Масаж для вагітних (Майстер) 30 хв",               30,  70000],
    ["Масаж для вагітних (Майстер) 45 хв",               45,  90000],
    ["Масаж для вагітних (Майстер) 60 хв",               60, 120000],
    ["Масаж для вагітних (Майстер) 90 хв",               90, 160000],
    ["Масаж стоп (Майстер) 30 хв",                       30,  70000],
    ["Масаж стоп (Майстер) 45 хв",                       45, 100000],
    ["Масаж голови (Майстер) 30 хв",                     30,  70000],
    ["Апаратно-вакуумний масаж (Майстер) 30 хв",         30,  70000],
    ["Апаратно-вакуумний масаж (Майстер) 45 хв",         45, 100000],
    ["Апаратно-вакуумний масаж (Майстер) 60 хв",         60, 120000],
    ["Апаратно-вакуумний масаж (Майстер) 90 хв",         90, 160000],
    ["Relax масаж (Майстер) 45 хв",                      45, 100000],
    ["Relax масаж (Майстер) 60 хв",                      60, 120000],
    ["Relax масаж (Майстер) 90 хв",                      90, 160000],
    ["Кінезіотейпування (Майстер) 30 хв",                30,  50000],
    ["Моделюючий масаж (Майстер) 45 хв",                 45, 110000],
    ["Моделюючий масаж (Майстер) 60 хв",                 60, 130000],
    ["Моделюючий масаж (Майстер) 90 хв",                 90, 170000],
    ["Вакуумно-баночний масаж (Майстер) 30 хв",          30,  70000],
    ["Вакуумно-баночний масаж (Майстер) 45 хв",          45, 100000],
    ["Вакуумно-баночний масаж (Майстер) 60 хв",          60, 120000],
    ["Вакуумно-баночний масаж (Майстер) 90 хв",          90, 160000],
    ["Вісцеральний масаж (Майстер) 30 хв",               30,  70000],
    ["Антивіковий масаж обличчя (Майстер) 30 хв",        30,  70000],
    ["Антивіковий масаж обличчя (Майстер) 45 хв",        45, 100000],
    ["Лімфодренажний масаж обличчя (Майстер) 30 хв",     30,  70000],
    ["Лімфодренажний масаж обличчя (Майстер) 45 хв",     45, 100000],
    ["Лімфодренажний масаж обличчя (Майстер) 60 хв",     60, 120000],
    ["Relax масаж обличчя (Майстер) 30 хв",              30,  70000],
    ["Relax масаж обличчя (Майстер) 45 хв",              45, 100000],
    ["Relax масаж обличчя (Майстер) 60 хв",              60, 110000],
    ["Моделюючий масаж обличчя (Майстер) 30 хв",         30,  70000],
    ["Моделюючий масаж обличчя (Майстер) 45 хв",         45, 100000],
    ["Моделюючий масаж обличчя (Майстер) 60 хв",         60, 120000],
    ["Пластичний масаж обличчя (Майстер) 30 хв",         30,  70000],
    ["Пластичний масаж обличчя (Майстер) 45 хв",         45, 100000],
    ["Пластичний масаж обличчя (Майстер) 60 хв",         60, 120000],
    ["Скульптуруючий масаж обличчя (Майстер) 30 хв",     30,  70000],
    ["Скульптуруючий масаж обличчя (Майстер) 45 хв",     45, 100000],
    ["Скульптуруючий масаж обличчя (Майстер) 60 хв",     60, 120000],
    ["Кобідо (Майстер) 30 хв",                           30,  65000],
    ["Кобідо (Майстер) 45 хв",                           45, 100000],
    ["Кобідо (Майстер) 60 хв",                           60, 120000],
    ["Гуа-ша обличчя (Майстер) 30 хв",                  30,  65000],
    ["Гуа-ша обличчя (Майстер) 45 хв",                  45, 100000],
    ["Гуа-ша обличчя (Майстер) 60 хв",                  60, 120000],
    ["Букальний масаж (Майстер) 50 хв",                  50, 110000],
    /* === Прайс Топ Майстер: відсутні === */
    ["Спортивний масаж (Топ Майстер) 30 хв",             30,  80000],
    ["Спортивний масаж (Топ Майстер) 45 хв",             45, 115000],
    ["Спортивний масаж (Топ Майстер) 120 хв",           120, 230000],
    ["Міофасціальний масаж (Топ Майстер) 30 хв",         30,  80000],
    ["Міофасціальний масаж (Топ Майстер) 45 хв",         45, 110000],
    ["Міофасціальний масаж (Топ Майстер) 60 хв",         60, 135000],
    ["Міофасціальний масаж (Топ Майстер) 90 хв",         90, 175000],
    ["Relax масаж (Топ Майстер) 30 хв",                  30,  80000],
    ["Relax масаж (Топ Майстер) 45 хв",                  45, 115000],
    ["Relax масаж (Топ Майстер) 60 хв",                  60, 135000],
    ["Relax масаж (Топ Майстер) 90 хв",                  90, 175000],
    ["Relax масаж (Топ Майстер) 120 хв",                120, 230000],
    ["Моделюючий масаж (Топ Майстер) 45 хв",             45, 120000],
    ["Моделюючий масаж (Топ Майстер) 60 хв",             60, 145000],
    ["Моделюючий масаж (Топ Майстер) 90 хв",             90, 190000],
    ["Моделюючий масаж (Топ Майстер) 120 хв",           120, 240000],
    ["Медовий масаж (Топ Майстер) 45 хв",                45, 120000],
    ["Медовий масаж (Топ Майстер) 60 хв",                60, 145000],
    ["Медовий масаж (Топ Майстер) 90 хв",                90, 190000],
    ["Медовий масаж (Топ Майстер) 120 хв",              120, 240000],
    ["Вакуумно-баночний масаж (Топ Майстер) 30 хв",      30,  80000],
    ["Вакуумно-баночний масаж (Топ Майстер) 45 хв",      45, 115000],
    ["Вакуумно-баночний масаж (Топ Майстер) 60 хв",      60, 135000],
    ["Вакуумно-баночний масаж (Топ Майстер) 90 хв",      90, 175000],
    ["Вакуумно-баночний масаж (Топ Майстер) 120 хв",    120, 230000],
    ["Масаж для вагітних (Топ Майстер) 30 хв",           30,  80000],
    ["Масаж для вагітних (Топ Майстер) 45 хв",           45, 110000],
    ["Масаж для вагітних (Топ Майстер) 60 хв",           60, 135000],
    ["Масаж для вагітних (Топ Майстер) 90 хв",           90, 175000],
    ["Масаж для вагітних (Топ Майстер) 120 хв",         120, 230000],
    ["Масаж стоп (Топ Майстер) 30 хв",                   30,  80000],
    ["Масаж стоп (Топ Майстер) 45 хв",                   45, 115000],
    ["Масаж голови (Топ Майстер) 30 хв",                 30,  80000],
    ["Апаратно-вакуумний масаж (Топ Майстер) 30 хв",     30,  80000],
    ["Апаратно-вакуумний масаж (Топ Майстер) 45 хв",     45, 110000],
    ["Апаратно-вакуумний масаж (Топ Майстер) 60 хв",     60, 135000],
    ["Апаратно-вакуумний масаж (Топ Майстер) 90 хв",     90, 175000],
    ["Вісцеральний масаж (Топ Майстер) 30 хв",           30,  80000],
    ["Антивіковий масаж обличчя (Топ Майстер) 30 хв",    30,  80000],
    ["Антивіковий масаж обличчя (Топ Майстер) 45 хв",    45, 115000],
    ["Лімфодренажний масаж обличчя (Топ Майстер) 30 хв", 30,  80000],
    ["Лімфодренажний масаж обличчя (Топ Майстер) 45 хв", 45, 115000],
    ["Лімфодренажний масаж обличчя (Топ Майстер) 60 хв", 60, 135000],
    ["Relax масаж обличчя (Топ Майстер) 30 хв",          30,  80000],
    ["Relax масаж обличчя (Топ Майстер) 45 хв",          45, 115000],
    ["Relax масаж обличчя (Топ Майстер) 60 хв",          60, 135000],
    ["Моделюючий масаж обличчя (Топ Майстер) 30 хв",     30,  80000],
    ["Моделюючий масаж обличчя (Топ Майстер) 45 хв",     45, 115000],
    ["Моделюючий масаж обличчя (Топ Майстер) 60 хв",     60, 135000],
    ["Пластичний масаж обличчя (Топ Майстер) 30 хв",     30,  80000],
    ["Пластичний масаж обличчя (Топ Майстер) 45 хв",     45, 115000],
    ["Пластичний масаж обличчя (Топ Майстер) 60 хв",     60, 135000],
    ["Скульптуруючий масаж обличчя (Топ Майстер) 30 хв", 30,  80000],
    ["Скульптуруючий масаж обличчя (Топ Майстер) 45 хв", 45, 115000],
    ["Скульптуруючий масаж обличчя (Топ Майстер) 60 хв", 60, 135000],
    ["Кобідо (Топ Майстер) 30 хв",                       30,  80000],
    ["Кобідо (Топ Майстер) 45 хв",                       45, 115000],
    ["Кобідо (Топ Майстер) 60 хв",                       60, 135000],
    ["Гуа-ша обличчя (Топ Майстер) 30 хв",              30,  80000],
    ["Гуа-ша обличчя (Топ Майстер) 60 хв",              60, 135000],
    ["Букальний масаж (Топ Майстер) 50 хв",              50, 125000],
    /* === Комплекси === */
    ["Обгортання Amore Shemen (гаряче) 60 хв",           60, 160000],
    ["Обгортання Amore Shemen (холодне) 70 хв",          70, 160000],
    ["Обгортання Bruno Vassari Detox 75 хв",             75, 160000],
    ["Гаряче обгортання SPA Seaweed 70 хв",              70, 160000],
    ["Гаряча експрес-трансформація тіла 130 хв",        130, 350000],
    ["Холодне моделювання тіла 120 хв",                 120, 270000],
    ["Гаряче моделювання тіла 120 хв",                  120, 270000],
    ["Сольове обгортання 75 хв",                         75, 130000],
    ["Кінезіотейпування 30 хв",                          30,  50000],
  ];
  var added = 0;
  var tx = db.transaction(function() {
    newSvcs.forEach(function(s) {
      if (!chk.get(s[0]).n) { ins.run(s[0], s[1], s[2], now); added++; }
    });
  });
  tx();
  if (added) console.log("[db] seedMissingServices: додано " + added + " нових послуг.");
})();

/* ---------------- Міграція: категорії/описи/фото послуг ---------------- */
(function seedServiceMeta() {
  var need = db.prepare("SELECT COUNT(*) n FROM services WHERE category IS NULL AND active=1").get().n;
  if (!need) return;

  /* Категорія за шаблоном назви */
  var catRules = [
    [/\(Топ Майстер\)/,                                           'Прайс Топ Майстер'],
    [/\(Майстер\)/,                                               'Прайс Майстер'],
    [/Парний|чотири руки|гарячим камінням|SPA|фітобочці|Паріння|Тепловий SPA/, 'SPA-ритуали'],
    [/Обгортання|моделювання тіла|Сольове|Кінезіотейпування|трансформація тіла/, 'Комплекси'],
  ];

  /* Опис за ключовим словом (специфічніші — першими) */
  var descRules = [
    ['Лімфодренажний масаж обличчя',  'М\'який лімфодренажний масаж для обличчя: знімає набряклість, освітлює шкіру та надає їй свіжого відпочилого вигляду.'],
    ['Relax масаж обличчя',           'Розслаблюючий масаж обличчя — знімає напругу жувальних м\'язів, розгладжує мімічні зморщки та дарує відчуття легкості.'],
    ['Моделюючий масаж обличчя',      'Техніка для чіткого контуру обличчя: моделює овал, підтягує шкіру і підкреслює природну красу без ін\'єкцій.'],
    ['Пластичний масаж обличчя',      'Глибокий пластичний масаж для корекції контурів обличчя і підвищення пружності шкіри. Видимий ліфтинг-ефект вже після першого сеансу.'],
    ['Скульптуруючий масаж обличчя',  'Скульптурує риси обличчя, зміцнює м\'язи та повертає виразний молодий овал. Природна альтернатива апаратній косметології.'],
    ['Антивіковий масаж обличчя',     'Спеціальна техніка для корекції вікових змін — моделює контур обличчя та підтягує шкіру природним способом.'],
    ['Класичний масаж обличчя',       'Ліфтинговий масаж для покращення кольору обличчя, зменшення зморщок та відновлення тонусу шкіри. Після сеансу — природне сяйво та ефект «відпочилого вигляду».'],
    ['Кобідо',                        'Японська техніка омолодження обличчя: інтенсивні ритмічні рухи активують мікроциркуляцію, підтягують шкіру та повертають природне сяйво.'],
    ['Гуа-ша',                        'Масаж каменем гуа-ша для обличчя — розганяє лімфу, усуває набряки та надає шкірі скульптурності. Давня китайська техніка в сучасному виконанні.'],
    ['Букальний масаж',               'Масаж з роботою всередині ротової порожнини: розслаблює жувальні м\'язи, усуває бруксизм та дає виражений ліфтинг нижньої третини обличчя.'],
    ['Загально-оздоровчий масаж',     'Класичний масаж для відновлення всього тіла: знімаємо м\'язову напругу, покращуємо кровообіг та повертаємо природну легкість руху. Після сеансу — тіло «живе», а голова ясна.'],
    ['Антистресовий масаж',           'Розслаблюючий масаж для зняття нервового напруження та відновлення внутрішнього балансу. М\'яка техніка знімає тривогу та дає відчуття спокою вже під час сеансу.'],
    ['Парний масаж',                  'Одночасний масаж для двох в одному кабінеті — два майстри, два столи, повне розслаблення поряд. Ідеально для пар, подруг або близьких людей. Після процедури — легкість у тілі та спокій у думках.'],
    ['Масаж спини',                   'Глибока робота з м\'язами спини, хребтом та плечовим поясом. Знімає затиски, усуває больовий синдром і повертає свободу рухів.'],
    ['Масаж шийно-комірцевої',        'Точковий масаж шиї та плечей — знімає головний біль, напругу від роботи за комп\'ютером та відновлює рухливість верхнього поясу.'],
    ['Лімфодренажний масаж',          'Стимулює відтік лімфи, зменшує набряклість та виводить токсини. Відчутний результат вже після першого сеансу — легші ноги, зменшення об\'ємів і покращення стану шкіри.'],
    ['Антицелюлітний масаж',          'Інтенсивна техніка для проблемних зон: розбиваємо застій, активуємо кровообіг і запускаємо процес зменшення об\'ємів. Шкіра стає більш гладкою, пружною, а тіло — підтягнутим.'],
    ['Моделюючий масаж',              'Формує силует: прибирає застій у проблемних зонах, моделює контури тіла та покращує текстуру шкіри. Поєднує антицелюлітний ефект та скульптурну роботу.'],
    ['Міофасціальний масаж',          'Робота з фасціями та глибокими м\'язами — усуває хронічні затиски, відновлює рухливість суглобів та повертає тілу природну свободу. Рекомендується при болях у спині та обмеженій рухливості.'],
    ['Relax масаж',                   'М\'який розслаблюючий масаж всього тіла — знімає накопичену втому, заспокоює нервову систему та відновлює внутрішній баланс.'],
    ['Медовий масаж',                 'Масаж з натуральним медом — глибоко живить шкіру, виводить токсини та запускає детокс на клітинному рівні. Шкіра після сеансу — шовковиста та сяюча.'],
    ['Вакуумно-баночний масаж',       'Баночний масаж для глибокої проробки підшкірного жирового шару: руйнує целюліт, покращує кровообіг та надає шкірі пружності.'],
    ['Апаратно-вакуумний масаж',      'Апаратна вакуумна терапія для корекції форми тіла: підсилює лімфодренаж, зменшує об\'єми та суттєво покращує стан шкіри.'],
    ['Масаж для вагітних',            'Безпечний масаж для майбутніх мам — знімає навантаження зі спини та ніг, зменшує набряки та покращує самопочуття на будь-якому терміні вагітності.'],
    ['Масаж стоп',                    'Рефлекторний масаж стоп — розслаблює все тіло через активні точки на підошві, знімає втому ніг та покращує загальний стан.'],
    ['Масаж голови',                  'Масаж голови та шкіри — знімає головний біль, покращує мікроциркуляцію та дарує глибоке розслаблення. Особливо ефективний після напруженого робочого дня.'],
    ['Вісцеральний масаж',            'Глибокий масаж органів черевної порожнини — нормалізує роботу ШКТ, знімає спазми та покращує загальне самопочуття.'],
    ['Кінезіотейпування',             'Накладання кінезіологічних тейпів для підтримки м\'язів та суглобів. Зменшує біль, відновлює рухливість та захищає від повторних травм.'],
    ['Паріння у фітобочці',           '20 хв. — швидке прогрівання, розігрів м\'язів та підготовка тіла до масажу. 30 хв. — глибоко розігріває м\'язи, запускає детокс та готує тіло до масажу. 45 хв. — інтенсивне прогрівання з детоксом та глибоким розслабленням м\'язів. 1 год. — максимальний ефект: детокс, покращення кровообігу та повне розслаблення тіла.'],
    ['SPA Ритуал "Фіто-оновлення',    'Комплексна SPA-програма: фітобочка + скраб + масаж в єдиному ритуалі. Глибоке відновлення та перезавантаження — тіло та думки приходять до балансу.'],
    ['Тепловий SPA-ритуал',           'SPA-програма для двох: фітобочка + стоун терапія + скраб + масаж. Унікальний спільний досвід релаксу та відновлення. Це більше, ніж SPA — це глибоке перезавантаження тіла і стану.'],
    ['Дитячий масаж',                 'Ніжний профілактичний масаж для дітей — зміцнює м\'язи, формує правильну поставу та підвищує імунітет. Безпечна техніка, адаптована під дитяче тіло.'],
    ['Масаж в чотири руки',           'Синхронний масаж двома майстрами одночасно — вдвічі глибше розслаблення та відновлення м\'язів. Незвичний досвід, який неможливо забути.'],
    ['Масаж гарячим камінням',        'Стоун-масаж базальтовими каменями — тепло проникає вглиб м\'язів, знімаючи найглибші затиски. Поєднання тепла і техніки масажу дає незрівнянний ефект розслаблення.'],
    ['Спортивний масаж',              'Повноцінний сеанс відновлення: пропрацьовує всі напружені зони, прибирає втому та повертає енергію.'],
    ['Обгортання Amore Shemen',       'Розкішне обгортання з маслом Amore Shemen — живить шкіру, зволожує та залишає відчуття шовковистості та сяяння.'],
    ['Обгортання Bruno Vassari',      'Детокс-обгортання Bruno Vassari — виводить токсини, зменшує об\'єми та відновлює природне здоров\'я шкіри.'],
    ['Гаряче обгортання SPA Seaweed', 'Водоростеве обгортання з ефектом нагрівання — активує жироспалення, насичує мінералами та залишає шкіру підтягнутою та пружною.'],
    ['Гаряча експрес-трансформація',  'Комплексна програма моделювання тіла: обгортання + антицелюлітний масаж + інтенсивна детокс-терапія. Максимальний результат за один сеанс.'],
    ['Холодне моделювання',           'Охолоджувальне обгортання для моделювання силуету: тонізує шкіру, зменшує набряки та формує чіткі контури тіла.'],
    ['Гаряче моделювання',            'Теплове обгортання для скульптурного моделювання тіла: розм\'якшує жировий шар, активізує метаболізм та підтягує шкіру.'],
    ['Сольове обгортання',            'Скраб + обгортання з морською сіллю — відлущує ороговілі клітини, мінералізує шкіру та залишає відчуття ніжності та свіжості.'],
  ];

  /* Фото за ключовим словом (специфічніші — першими) */
  var imgRules = [
    ['Лімфодренажний масаж обличчя',  '/assets/img/masazh-oblychchia-kyiv-shuliavska.jpg'],
    ['Relax масаж обличчя',           '/assets/img/relaks-masazh-oblychchia-shuliavska-kyiv.jpg'],
    ['Моделюючий масаж обличчя',      '/assets/img/masazh-oblychchia-kyiv-shuliavska.jpg'],
    ['Пластичний масаж обличчя',      '/assets/img/kosmetychnyi-masazh-oblychchia-kyiv.jpg'],
    ['Скульптуруючий масаж обличчя',  '/assets/img/masazh-oblychchia-industrialnyi-mist-kyiv.jpg'],
    ['Антивіковий масаж обличчя',     '/assets/img/lifting-masazh-oblychchya-shulyavska-kyiv.jpg'],
    ['Класичний масаж обличчя',       '/assets/img/masazh-oblychchia-kyiv-shuliavska.jpg'],
    ['Кобідо',                        '/assets/img/oliva-masazh-oblychchya-kyiv.jpg'],
    ['Гуа-ша',                        '/assets/img/masazh-oblychchia-solomianskyi-raion.jpg'],
    ['Букальний',                     '/assets/img/bukkalnyi-masazh-kyiv.jpg'],
    ['Загально-оздоровчий',           '/assets/img/ozdorovchuy.jpeg'],
    ['Антистресовий',                 '/assets/img/antystresovyi-masazh-kyiv.jpg'],
    ['Спортивний',                    '/assets/img/sportyvnyi-masazh-kyiv.png'],
    ['Міофасціальний',                '/assets/img/masazh-shuliavska-kyiv.jpg'],
    ['Парний',                        '/assets/img/srv-parni.jpg'],
    ['чотири руки',                   '/assets/img/masazh-zhk-dynastia.jpg'],
    ['Медовий',                       '/assets/img/medovyi-masazh-shuliavska-kyiv.jpg'],
    ['Масаж спини',                   '/assets/img/masazh-shuliavska-kyiv.jpg'],
    ['шийно-комірцевої',              '/assets/img/masazh-shyino-komirtsevoi-zony-shuliavska-kyiv.jpg'],
    ['Лімфодренажний',                '/assets/img/limfodrenazhnyi-masazh-kyiv.jpg'],
    ['Антицелюлітний',                '/assets/img/antytseliulitnyi-masazh-kyiv.jpg'],
    ['Моделюючий',                    '/assets/img/antytseliulitnyi-masazh-kyiv.jpg'],
    ['Вакуумно-баночний',             '/assets/img/banochnyi-masazh-kyiv.jpg'],
    ['Апаратно-вакуумний',            '/assets/img/aparatnyi-masazh-shuliavska.jpg'],
    ['Масаж для вагітних',            '/assets/img/masazh-dlia-vahitnykh-shuliavska-kyiv.jpg'],
    ['Масаж стоп',                    '/assets/img/masazh-kyiv-shuliavska-oliva.jpg'],
    ['Масаж голови',                  '/assets/img/masazh-kyiv-shuliavska-oliva.jpg'],
    ['Вісцеральний',                  '/assets/img/vistseralnyi-masazh-kyiv.jpg'],
    ['Relax масаж',                   '/assets/img/relaks-masazh-shuliavska-kyiv.jpg'],
    ['Кінезіотейпування',             '/assets/img/kinezioteipuvannia-kyiv.jpg'],
    ['Паріння',                       '/assets/img/parinnia-u-fitobochtsi-kyiv.jpg'],
    ['фітобочці',                     '/assets/img/parinnia-u-fitobochtsi-kyiv.jpg'],
    ['Тепловий SPA',                  '/assets/img/relaks-spa-programa-kyiv.jpg'],
    ['SPA Ритуал',                    '/assets/img/srv-spa.jpg'],
    ['Дитячий',                       '/assets/img/masazh-dlia-ditei-kyiv.PNG'],
    ['гарячим камінням',              '/assets/img/stoun-terapiia-kyiv.jpg'],
    ['Обгортання',                    '/assets/img/srv-spa.jpg'],
    ['моделювання тіла',              '/assets/img/relaks-spa-programa-kyiv.jpg'],
    ['трансформація тіла',            '/assets/img/relaks-spa-programa-kyiv.jpg'],
    ['Сольове',                       '/assets/img/srv-spa.jpg'],
  ];

  var services = db.prepare("SELECT id, name FROM services WHERE active=1 AND category IS NULL").all();
  var upd = db.prepare("UPDATE services SET category=?, description=?, image_url=? WHERE id=?");

  var tx = db.transaction(function () {
    services.forEach(function (s) {
      var cat = null, desc = null, img = null;

      for (var i = 0; i < catRules.length; i++) {
        if (catRules[i][0].test(s.name)) { cat = catRules[i][1]; break; }
      }
      for (var j = 0; j < descRules.length; j++) {
        if (s.name.indexOf(descRules[j][0]) !== -1) { desc = descRules[j][1]; break; }
      }
      for (var k = 0; k < imgRules.length; k++) {
        if (s.name.indexOf(imgRules[k][0]) !== -1) { img = imgRules[k][1]; break; }
      }

      upd.run(cat, desc, img, s.id);
    });
  });
  tx();
  console.log('[db] Seeded category/description/image_url for ' + services.length + ' services.');
})();

/* ---------------- Перенесення add-on послуг у каталог онлайн-запису ----------------
   Ці десять позицій раніше існували лише на фінальному кроці як доповнення.
   Тепер вони є повноцінними послугами групи «Додаткові послуги».
   Кінезіотейпування доступне і в каталозі, і фінальним add-on'ом. */
(function moveBookingAddonsToCatalog() {
  var now = Date.now();
  var additions = [
    ['Глибоке прогрівання у ІЧ Сауні', 'Глибоке прогрівання у ІЧ Сауні 30 хв', 30, 65000,
      'Глибоке прогрівання організму, виведення токсинів і релакс.', '/assets/img/spa-sauna-kyiv.jpg'],
    ['Гаряче каміння', 'Гаряче каміння 15 хв', 15, 35000,
      'Локальне прогрівання м\'язів і глибоке розслаблення.', '/assets/img/stoun-terapiia-kyiv.jpg'],
    ['Масаж долонь', 'Масаж долонь 15 хв', 15, 35000,
      'Зняття напруги в кистях і передпліччях.', '/assets/img/relaks-masazh-shuliavska-kyiv.jpg'],
    ['Масаж зі зволожувальним кремом', 'Масаж зі зволожувальним кремом 10 хв', 10, 10000,
      'Живлення шкіри та ніжний догляд зі зволожувальним кремом.', '/assets/img/antystresovyi-masazh-kyiv.jpg'],
    ['Композиція зі свічок', 'Композиція зі свічок 10 хв', 10, 15000,
      'Атмосфера спокою з ароматом теплих свічок.', '/assets/img/relaks-spa-programa-kyiv.jpg'],
    ['Душ', 'Душ 10 хв', 10, 15000,
      'Рушник, капці, шапочка, шампунь, кондиціонер та гель для душу.', '/assets/img/dush-oliva.png'],
  ];
  var exists = db.prepare("SELECT 1 FROM services WHERE active=1 AND name LIKE ? LIMIT 1");
  var insert = db.prepare(
    "INSERT INTO services (name,duration_min,price,active,sort_order,created_at,category,description,image_url) VALUES (?,?,?,1,850,?,'Додаткові послуги',?,?)"
  );

  additions.forEach(function(s) {
    if (!exists.get(s[0] + '%')) insert.run(s[1], s[2], s[3], now, s[4], s[5]);
  });

  var catalog = [
    ['Глибоке прогрівання у ІЧ Сауні%', 'Глибоке прогрівання організму, виведення токсинів і релакс.', '/assets/img/spa-sauna-kyiv.jpg'],
    ['Гаряче каміння%', 'Локальне прогрівання м\'язів і глибоке розслаблення.', '/assets/img/stoun-terapiia-kyiv.jpg'],
    ['Паріння у фітобочці%', 'Прогрівання тіла на цілющих травах перед масажем.', '/assets/img/parinnia-u-fitobochtsi-kyiv.jpg'],
    ['Масаж голови%', 'Зняття напруги, покращення сну та концентрації.', '/assets/img/head_massage.jpg'],
    ['Масаж шийно-комірцевої зони%', 'Розслаблення шиї та плечей, зняття напруги.', '/assets/img/masazh-shyino-komirtsevoi-zony-shuliavska-kyiv.jpg'],
    ['Масаж долонь%', 'Зняття напруги в кистях і передпліччях.', '/assets/img/relaks-masazh-shuliavska-kyiv.jpg'],
    ['Масаж стоп%', 'Розслаблення втомлених ніг і стоп.', '/assets/img/masazh-shuliavska-kyiv.jpg'],
    ['Масаж зі зволожувальним кремом%', 'Живлення шкіри та ніжний догляд зі зволожувальним кремом.', '/assets/img/antystresovyi-masazh-kyiv.jpg'],
    ['Композиція зі свічок%', 'Атмосфера спокою з ароматом теплих свічок.', '/assets/img/relaks-spa-programa-kyiv.jpg'],
    ['Душ%', 'Рушник, капці, шапочка, шампунь, кондиціонер та гель для душу.', '/assets/img/dush-oliva.png'],
  ];
  var update = db.prepare(
    "UPDATE services SET category='Додаткові послуги',sort_order=?,description=COALESCE(NULLIF(description,''),?),image_url=COALESCE(NULLIF(image_url,''),?) WHERE active=1 AND name LIKE ?"
  );
  db.transaction(function() {
    catalog.forEach(function(s, i) { update.run(700 + i, s[1], s[2], s[0]); });
  })();
})();

/* ---------------- Міграція: оновити майстрів ---------------- */
(function updateMasters() {
  // Застарілий рівень «Майстриня» об'єднано з рівнем «Майстер».
  db.prepare("UPDATE masters SET level='Майстер' WHERE level='Майстриня'").run();
  // Додати Андрія якщо ще немає
  var andrii = db.prepare("SELECT id FROM masters WHERE name='Андрій'").get();
  if (!andrii) {
    var now = Date.now();
    var r = db.prepare(
      "INSERT INTO masters (name, photo, level, active, sort_order, created_at) VALUES (?,?,?,1,?,?)"
    ).run('Андрій', 'assets/img/master-andrii.jpg', 'Майстер', 5, now);
    var mid = r.lastInsertRowid;
    // Розклад Пн-Сб 9:00-21:30
    var insSched = db.prepare("INSERT OR IGNORE INTO master_schedule (master_id,weekday,work_start,work_end) VALUES (?,?,540,1290)");
    for (var wd = 1; wd <= 6; wd++) insSched.run(mid, wd);
    // Послуги рівня Майстер
    var svcs = db.prepare("SELECT id FROM services WHERE active=1 AND name LIKE '%(Майстер)%' AND name NOT LIKE '%(Топ Майстер)%'").all();
    var insMS = db.prepare("INSERT OR IGNORE INTO master_services (master_id,service_id) VALUES (?,?)");
    svcs.forEach(function(s) { insMS.run(mid, s.id); });
    // Спільні послуги (без рівня)
    var shared = db.prepare("SELECT id FROM services WHERE active=1 AND name NOT LIKE '%(Майстер)%' AND name NOT LIKE '%(Топ Майстер)%'").all();
    shared.forEach(function(s) { insMS.run(mid, s.id); });
    console.log('[db] Додано майстра Андрій.');
  }
})();

/* ---------------- Міграція: синхронізація master_services за рівнем ---------------- */
/*
 * Запускається щоразу при старті. Додає відсутні послуги майстрам згідно їхнього рівня.
 * Рівні:
 *   "Топ Майстер"        → послуги з "(Топ Майстер)" + спільні (без мітки)
 *   "Майстер"            → послуги з "(Майстер)" (НЕ Топ) + спільні
 *   Решта                → лише спільні
 *
 * Існуючі зв'язки не видаляються (використовується INSERT OR IGNORE).
 */
(function syncMasterServices() {
  var masters = db.prepare("SELECT id, level FROM masters WHERE active=1").all();
  var allSvcs = db.prepare("SELECT id, name FROM services WHERE active=1").all();
  var ins = db.prepare("INSERT OR IGNORE INTO master_services (master_id, service_id) VALUES (?,?)");
  var added = 0;

  var tx = db.transaction(function() {
    masters.forEach(function(m) {
      var lvl = (m.level || "").trim();
      var isTop = lvl === "Топ Майстер";
      var isMaster = lvl === "Майстер";
      var isExpert = lvl === "Експерт";

      allSvcs.forEach(function(s) {
        var hasExpert = s.name.indexOf("(Експерт)")     !== -1;
        var hasTop    = !hasExpert && s.name.indexOf("(Топ Майстер)") !== -1;
        var hasMaster = !hasExpert && !hasTop && s.name.indexOf("(Майстер)") !== -1;
        var shared    = !hasExpert && !hasTop && !hasMaster;

        var fits = shared ||
                   (isTop    && hasTop)    ||
                   (isMaster && hasMaster) ||
                   (isExpert && hasExpert);

        if (fits) {
          var r = ins.run(m.id, s.id);
          if (r.changes) added++;
        }
      });
    });
  });
  tx();
  if (added > 0) console.log("[db] syncMasterServices: додано " + added + " нових зв'язків майстер–послуга.");
})();

/* ---- Популярні послуги: встановлюємо featured=1 ---- */
(function seedFeaturedServices() {
  var already = db.prepare("SELECT COUNT(*) n FROM services WHERE featured=1").get().n;
  if (already > 0) return; // Вже налаштовано — не перезатираємо
  var upd = db.prepare("UPDATE services SET featured=1 WHERE name LIKE ?");
  var patterns = [
    'Загально-оздоровчий масаж (Топ Майстер)%',
    'Парний масаж%',
    'Масаж спини (Топ Майстер)%',
    'Масаж шийно-комірцевої зони (Топ Майстер)%',
    'Класичний масаж обличчя (Майстер) 30 хв',
    'Класичний масаж обличчя (Топ Майстер)%',
    'Антистресовий масаж (Топ Майстер)%',
    'Лімфодренажний масаж (Топ Майстер)%',
    'Антицелюлітний масаж (Топ Майстер)%',
    'Паріння у фітобочці%',
    'SPA Ритуал%',
    'Тепловий SPA-ритуал%',
    'Дитячий масаж (Топ Майстер)%',
    'Обгортання Amore Shemen%',
  ];
  var tx = db.transaction(function() {
    patterns.forEach(function(p) { upd.run(p); });
  });
  tx();
  var cnt = db.prepare("SELECT COUNT(*) n FROM services WHERE featured=1").get().n;
  console.log('[db] seedFeaturedServices: позначено ' + cnt + ' послуг як популярні.');
})();

/* clients.phone був TEXT UNIQUE NOT NULL — потрібно дозволити запис без
   телефону (клієнт з іменем, але без номера). SQLite не вміє ALTER COLUMN
   DROP NOT NULL, тому перебудовуємо таблицю разово, якщо стара схема ще
   активна. FK вимкнено на час перебудови (PRAGMA не діє всередині
   транзакції), бо appointments/subscriptions посилаються на clients(id). */
try {
  const phoneCol = db.prepare("PRAGMA table_info(clients)").all().find(function (c) { return c.name === "phone"; });
  if (phoneCol && phoneCol.notnull) {
    db.pragma("foreign_keys = OFF");
    db.exec(`
      CREATE TABLE clients_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        phone         TEXT UNIQUE,
        name          TEXT NOT NULL,
        note          TEXT,
        visit_count   INTEGER NOT NULL DEFAULT 0,
        last_visit_at INTEGER,
        created_at    INTEGER NOT NULL,
        blacklisted   INTEGER NOT NULL DEFAULT 0,
        no_marketing  INTEGER NOT NULL DEFAULT 0,
        no_reminders  INTEGER NOT NULL DEFAULT 0,
        birthday      TEXT
      );
      INSERT INTO clients_new (id, phone, name, note, visit_count, last_visit_at, created_at, blacklisted, no_marketing, no_reminders, birthday)
        SELECT id, phone, name, note, visit_count, last_visit_at, created_at, blacklisted, no_marketing, no_reminders, birthday FROM clients;
      DROP TABLE clients;
      ALTER TABLE clients_new RENAME TO clients;
    `);
    db.pragma("foreign_keys = ON");
    console.log("[db] clients.phone: знято NOT NULL (перебудова таблиці)");
  }
} catch (e) { console.error("[db] migrate clients.phone nullable:", e.message); }

/* ---------------- PWA Push підписки ---------------- */
db.exec(`
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_json TEXT NOT NULL UNIQUE,
  user_id          INTEGER,
  created_at       INTEGER NOT NULL
);
`);
/* Роль і майстер пишуться прямо в підписку. Раніше адресат визначався за
   user_id: NULL означав «власник» (bootstrap-логін без рядка в users).
   Але той самий NULL лишався й на телефоні МАЙСТРА, якщо на ньому колись
   логінився власник — і майстер отримував push про чужі записи.
   Явні поля прибирають цю двозначність. */
try { db.exec("ALTER TABLE push_subscriptions ADD COLUMN role TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE push_subscriptions ADD COLUMN master_id INTEGER"); } catch(e) {}
/* Backfill для вже наявних рядків: майстрів беремо з users, решту (NULL)
   лишаємо власником — це історичне значення. Пристрої, підписані заново,
   оновлять роль самі (UPSERT у /api/push/subscribe). */
try {
  db.exec(`
    UPDATE push_subscriptions SET
      role = COALESCE((SELECT u.role FROM users u WHERE u.id = push_subscriptions.user_id), 'owner'),
      master_id = (SELECT u.master_id FROM users u WHERE u.id = push_subscriptions.user_id)
    WHERE role IS NULL;
  `);
} catch (e) { console.error("[db] backfill push_subscriptions.role:", e.message); }

/* Розмір фото на сторінці "Про цей масаж" — власник обирає при завантаженні,
   бо різні фото не однаково добре вписуються у фіксовану пропорцію блоку. */
try { db.exec("ALTER TABLE service_pages ADD COLUMN hero_photo_size TEXT NOT NULL DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE service_pages ADD COLUMN symptoms_photo_size TEXT NOT NULL DEFAULT ''"); } catch(e) {}
/* Позиція тексту в шапці ("" = зліва, "right" = справа) — щоб текст не
   закривав обличчя/головний об'єкт на фото, коли він знаходиться зліва. */
try { db.exec("ALTER TABLE service_pages ADD COLUMN hero_text_align TEXT NOT NULL DEFAULT ''"); } catch(e) {}
/* Абонементи (5/10/15 сеансів тощо) — власник вписує варіанти, на сторінці
   клієнт клацає кількість сеансів і бачить ціну, як у прайс-таблиці. */
try { db.exec("ALTER TABLE service_pages ADD COLUMN abonement_items TEXT NOT NULL DEFAULT ''"); } catch(e) {}

module.exports = db;
module.exports.DB_FILE = DB_FILE;
