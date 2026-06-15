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
  phone         TEXT UNIQUE NOT NULL,
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
try { db.exec("ALTER TABLE services ADD COLUMN category TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE services ADD COLUMN description TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE services ADD COLUMN image_url TEXT"); } catch(e) {}

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

/* ---------------- Міграція: категорії/описи/фото послуг ---------------- */
(function seedServiceMeta() {
  var need = db.prepare("SELECT COUNT(*) n FROM services WHERE category IS NULL AND active=1").get().n;
  if (!need) return;

  /* Категорія за шаблоном назви */
  var catRules = [
    [/\(Топ Майстер\)/,                                           'Прайс Топ Майстер'],
    [/\(Майстер\)/,                                               'Прайс Майстер'],
    [/Парний|чотири руки|гарячим камінням|SPA|фітобочці|Паріння|Тепловий SPA/, 'SPA-ритуали'],
  ];

  /* Опис за ключовим словом (перший збіг) */
  var descRules = [
    ['Загально-оздоровчий масаж', 'Класичний масаж для відновлення всього тіла: знімаємо м\'язову напругу, покращуємо кровообіг та повертаємо природну легкість руху. Після сеансу — тіло «живе», а голова ясна.'],
    ['Антистресовий масаж',       'Розслаблюючий масаж для зняття нервового напруження та відновлення внутрішнього балансу. М\'яка техніка знімає тривогу та дає відчуття спокою вже під час сеансу.'],
    ['Парний масаж',              'Одночасний масаж для двох в одному кабінеті — два майстри, два столи, повне розслаблення поряд. Ідеально для пар, подруг або близьких людей. Після процедури — легкість у тілі та спокій у думках.'],
    ['Масаж спини',               'Глибока робота з м\'язами спини, хребтом та плечовим поясом. Знімає затиски, усуває больовий синдром і повертає свободу рухів.'],
    ['Масаж шийно-комірцевої',    'Точковий масаж шиї та плечей — знімає головний біль, напругу від роботи за комп\'ютером та відновлює рухливість верхнього поясу.'],
    ['Антивіковий масаж обличчя', 'Спеціальна техніка для корекції вікових змін — моделює контур обличчя та підтягує шкіру природним способом.'],
    ['Класичний масаж обличчя',   'Ліфтинговий масаж для покращення кольору обличчя, зменшення зморщок та відновлення тонусу шкіри. Після сеансу — природне сяйво та ефект «відпочилого вигляду».'],
    ['Лімфодренажний масаж',      'Стимулює відтік лімфи, зменшує набряклість та виводить токсини. Відчутний результат вже після першого сеансу — легші ноги, зменшення об\'ємів і покращення стану шкіри.'],
    ['Антицелюлітний масаж',      'Інтенсивна техніка для проблемних зон: розбиваємо застій, активуємо кровообіг і запускаємо процес зменшення об\'ємів. Шкіра стає більш гладкою, пружною, а тіло — підтягнутим.'],
    ['Паріння у фітобочці',       '20 хв. — швидке прогрівання, розігрів м\'язів та підготовка тіла до масажу. 30 хв. — глибоко розігріває м\'язи, запускає детокс та готує тіло до масажу. 45 хв. — інтенсивне прогрівання з детоксом та глибоким розслабленням м\'язів. 1 год. — максимальний ефект: детокс, покращення кровообігу та повне розслаблення тіла.'],
    ['SPA Ритуал "Фіто-оновлення', 'Комплексна SPA-програма: фітобочка + скраб + масаж в єдиному ритуалі. Глибоке відновлення та перезавантаження — тіло та думки приходять до балансу.'],
    ['Тепловий SPA-ритуал',       'SPA-програма для двох: фітобочка + стоун терапія + скраб + масаж. Унікальний спільний досвід релаксу та відновлення. Це більше, ніж SPA — це глибоке перезавантаження тіла і стану.'],
    ['Дитячий масаж',             'Ніжний профілактичний масаж для дітей — зміцнює м\'язи, формує правильну поставу та підвищує імунітет. Безпечна техніка, адаптована під дитяче тіло.'],
    ['Масаж в чотири руки',       'Синхронний масаж двома майстрами одночасно — вдвічі глибше розслаблення та відновлення м\'язів. Незвичний досвід, який неможливо забути.'],
    ['Масаж гарячим камінням',    'Стоун-масаж базальтовими каменями — тепло проникає вглиб м\'язів, знімаючи найглибші затиски. Поєднання тепла і техніки масажу дає незрівнянний ефект розслаблення.'],
    ['Спортивний масаж',          'Повноцінний сеанс відновлення: пропрацьовує всі напружені зони, прибирає втому та повертає енергію.'],
  ];

  /* Фото за ключовим словом */
  var imgRules = [
    ['Загально-оздоровчий',           '/assets/img/ozdorovchuy.jpeg'],
    ['Антистресовий',                 '/assets/img/antystresovyi-masazh-kyiv.jpg'],
    ['Спортивний',                    '/assets/img/sportyvnyi-masazh-kyiv.png'],
    ['Парний',                        '/assets/img/srv-parni.jpg'],
    ['чотири руки',                   '/assets/img/masazh-zhk-dynastia.jpg'],
    ['Масаж спини',                   '/assets/img/masazh-shuliavska-kyiv.jpg'],
    ['шийно-комірцевої',              '/assets/img/masazh-shyino-komirtsevoi-zony-shuliavska-kyiv.jpg'],
    ['Лімфодренажний',                '/assets/img/limfodrenazhnyi-masazh-kyiv.jpg'],
    ['Антицелюлітний',                '/assets/img/antytseliulitnyi-masazh-kyiv.jpg'],
    ['Паріння',                       '/assets/img/parinnia-u-fitobochtsi-kyiv.jpg'],
    ['фітобочці',                     '/assets/img/parinnia-u-fitobochtsi-kyiv.jpg'],
    ['Тепловий SPA',                  '/assets/img/relaks-spa-programa-kyiv.jpg'],
    ['SPA Ритуал',                    '/assets/img/srv-spa.jpg'],
    ['Дитячий',                       '/assets/img/masazh-dlia-ditei-kyiv.PNG'],
    ['гарячим камінням',              '/assets/img/stoun-terapiia-kyiv.jpg'],
    ['Антивіковий масаж обличчя',     '/assets/img/lifting-masazh-oblychchya-shulyavska-kyiv.jpg'],
    ['Класичний масаж обличчя',       '/assets/img/masazh-oblychchia-kyiv-shuliavska.jpg'],
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

module.exports = db;
module.exports.DB_FILE = DB_FILE;
