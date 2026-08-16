const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// On a PaaS like Hamravesh the container's own filesystem is wiped on every
// redeploy/restart, so this MUST point at a mounted persistent volume in
// production (set DATA_DIR to that mount path). Defaults to a local folder
// for development only.
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'ghorsam.db'));

// WAL mode gives much better durability/concurrency behavior for a
// long-running server process than the default rollback journal.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,           -- eitaa user id
    first_name TEXT,
    last_name TEXT,
    allows_write_to_pm INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    times TEXT NOT NULL,              -- JSON array of "HH:mm" strings
    active INTEGER DEFAULT 1,
    color TEXT DEFAULT '#a51c26',
    icon TEXT DEFAULT '💊',
    stock INTEGER,                    -- NULL = not tracked
    low_stock_threshold INTEGER DEFAULT 5,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS reminder_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pill_id INTEGER NOT NULL,
    sent_for TEXT NOT NULL,           -- "YYYY-MM-DD HH:mm" to dedupe within the minute
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_log_unique
    ON reminder_log(pill_id, sent_for);

  -- Presence of a row = that dose was marked as taken.
  CREATE TABLE IF NOT EXISTS doses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pill_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    dose_date TEXT NOT NULL,          -- "YYYY-MM-DD" in Asia/Tehran
    dose_time TEXT NOT NULL,          -- "HH:mm"
    stock_decremented INTEGER DEFAULT 0,
    taken_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (pill_id) REFERENCES pills(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_doses_unique
    ON doses(pill_id, dose_date, dose_time);
`);

// Best-effort migration for databases created before color/icon/stock existed.
for (const stmt of [
  "ALTER TABLE pills ADD COLUMN color TEXT DEFAULT '#a51c26'",
  "ALTER TABLE pills ADD COLUMN icon TEXT DEFAULT '💊'",
  'ALTER TABLE pills ADD COLUMN stock INTEGER',
  'ALTER TABLE pills ADD COLUMN low_stock_threshold INTEGER DEFAULT 5',
  'ALTER TABLE doses ADD COLUMN stock_decremented INTEGER DEFAULT 0',
]) {
  try {
    db.exec(stmt);
  } catch {
    // column already exists
  }
}

module.exports = db;
