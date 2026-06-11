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

module.exports = db;
module.exports.DB_FILE = DB_FILE;
