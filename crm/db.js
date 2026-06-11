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

/* ---------------- Seed початкових послуг ---------------- */
(function seedServices() {
  const count = db.prepare("SELECT COUNT(*) n FROM services").get().n;
  if (count > 0) return;

  const now = Date.now();
  const ins = db.prepare(
    "INSERT OR IGNORE INTO services (name, duration_min, price, active, sort_order, created_at) VALUES (?, ?, ?, 1, ?, ?)"
  );
  const services = [
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
  ];

  const seedTx = db.transaction(function () {
    services.forEach(function ([name, dur, price], i) {
      ins.run(name, dur, price, i, now);
    });
  });
  seedTx();
  console.log("[db] Seed: додано " + services.length + " послуг.");
})();

module.exports = db;
module.exports.DB_FILE = DB_FILE;
