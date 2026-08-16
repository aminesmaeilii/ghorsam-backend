const cron = require('node-cron');
const db = require('./db');
const { sendMessage } = require('./eitaa');
const { tehranNow } = require('./time');

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
function toFaDigits(n) {
  return String(n).replace(/\d/g, (d) => FA_DIGITS[d]);
}

// Pill names are free text the user picked. Eitaa's sendMessage text field
// supports Markdown (**bold**, __italic__, `code`, [text](url)), so a name
// containing any of those characters would otherwise corrupt the message's
// formatting — escape them per the docs' own literal-character convention.
function escapeEitaaMarkdown(text) {
  return String(text).replace(/[\\*_`[\]()]/g, '\\$&');
}

async function checkAndSendReminders() {
  const { date, time } = tehranNow();
  const sentFor = `${date} ${time}`;

  const rows = db
    .prepare(
      `SELECT pills.id AS pill_id, pills.name, pills.times, pills.icon, pills.stock, pills.low_stock_threshold,
              users.id AS user_id, users.allows_write_to_pm
       FROM pills JOIN users ON users.id = pills.user_id
       WHERE pills.active = 1`
    )
    .all();

  const markSent = db.prepare('INSERT OR IGNORE INTO reminder_log (pill_id, sent_for) VALUES (?, ?)');

  for (const row of rows) {
    const times = JSON.parse(row.times);
    if (!times.includes(time)) continue;
    if (!row.allows_write_to_pm) continue;

    const result = markSent.run(row.pill_id, sentFor);
    if (result.changes === 0) continue; // already sent for this minute

    // The leading words are what shows up in the phone's push-notification
    // preview (Eitaa notifies on every new PV message the same way it does
    // for a normal chat), so front-load the pill name and keep it short.
    const safeName = escapeEitaaMarkdown(row.name);
    let text = `${row.icon || '⏰'} یادآوری قرصام: وقت **${safeName}** رسیده!`;
    if (row.stock !== null && row.stock !== undefined) {
      text += `\n\nموجودی باقی‌مانده: ${toFaDigits(row.stock)} عدد`;
      if (row.stock <= (row.low_stock_threshold ?? 5)) {
        text += '\n⚠️ موجودیت داره کم میشه، یادت باشه دوباره تهیه کنی.';
      }
    }

    try {
      await sendMessage(row.user_id, text);
    } catch (err) {
      console.error(`Failed to send reminder for pill ${row.pill_id}:`, err.message);
    }
  }
}

function startReminderScheduler() {
  cron.schedule('* * * * *', () => {
    checkAndSendReminders().catch((err) => console.error('Reminder tick failed:', err));
  }, { timezone: 'Asia/Tehran' });
  console.log('Reminder scheduler started (every minute, Asia/Tehran).');
}

module.exports = { startReminderScheduler, checkAndSendReminders };
