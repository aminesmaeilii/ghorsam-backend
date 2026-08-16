const cron = require('node-cron');
const db = require('./db');
const { sendMessage } = require('./eitaa');

function nowInTehran() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const time = `${get('hour')}:${get('minute')}`;
  return { date, time };
}

async function checkAndSendReminders() {
  const { date, time } = nowInTehran();
  const sentFor = `${date} ${time}`;

  const rows = db
    .prepare(
      `SELECT pills.id AS pill_id, pills.name, pills.times, users.id AS user_id, users.allows_write_to_pm
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

    try {
      await sendMessage(row.user_id, `⏰ وقت خوردن قرص **${row.name}** رسیده!`);
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
