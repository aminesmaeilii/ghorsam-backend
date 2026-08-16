const cron = require('node-cron');
const db = require('./db');
const { sendMessage } = require('./eitaa');
const { tehranNow, tehranAt } = require('./time');

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

// If a dose is still unmarked this long after its scheduled time, nag again.
// Matches exactly once per stage per dose (see reminder_log's unique index).
const ESCALATION_STAGES = [
  { minutes: 15, label: 'یک ربع' },
  { minutes: 30, label: 'نیم ساعت' },
  { minutes: 60, label: 'یک ساعت' },
  { minutes: 120, label: 'دو ساعت' },
];

/**
 * Builds the "خوردم" deep link: opening it inside Eitaa launches this Mini
 * App with a start_param the frontend reads to auto-mark that exact dose as
 * taken (see js/app.js). Requires EITAA_MINIAPP_USERNAME — the short name
 * this Mini App is registered under in the Eitaa developer panel (the
 * "<name>" in eitaa.com/app/<name>). Without it, reminders are still sent,
 * just without the one-tap link.
 */
function buildTakeLink(pillId, date, time) {
  const username = process.env.EITAA_MINIAPP_USERNAME;
  if (!username) return null;
  const compactDate = date.replace(/-/g, '');
  const compactTime = time.replace(':', '');
  const startParam = `take_${pillId}_${compactDate}_${compactTime}`;
  return `https://eitaa.com/app/${username}?startapp=${startParam}`;
}

function buildReminderText(row, target) {
  const safeName = escapeEitaaMarkdown(row.name);
  const icon = row.icon || '⏰';

  // The leading words are what shows up in the phone's push-notification
  // preview (Eitaa notifies on every new PV message the same way it does
  // for a normal chat), so front-load the pill name and keep it short.
  let text =
    target.stage === 0
      ? `${icon} یادآوری قرصام: وقت **${safeName}** رسیده!`
      : `${icon} یادت رفت؟ ${target.label} از موعد **${safeName}** گذشته و هنوز نزدی تیک!`;

  if (row.stock !== null && row.stock !== undefined) {
    text += `\n\nموجودی باقی‌مانده: ${toFaDigits(row.stock)} عدد`;
    if (row.stock <= (row.low_stock_threshold ?? 5)) {
      text += '\n⚠️ موجودیت داره کم میشه، یادت باشه دوباره تهیه کنی.';
    }
  }

  const link = buildTakeLink(row.pill_id, target.date, target.time);
  if (link) text += `\n\n[✅ خوردم](${link})`;

  return text;
}

async function checkAndSendReminders() {
  const now = new Date();
  const { date: nowDate, time: nowTime } = tehranNow();

  // The set of "moments" to look for among each pill's scheduled times this
  // tick: right now (stage 0, the on-time reminder), and each escalation
  // offset in the past. Deriving date+time from a real Date/timestamp (via
  // tehranAt) rather than string math on nowTime handles day boundaries
  // correctly (e.g. a 23:50 dose whose +30min escalation lands past midnight).
  const targets = [{ stage: 0, date: nowDate, time: nowTime, label: null }];
  for (const { minutes, label } of ESCALATION_STAGES) {
    const { date, time } = tehranAt(new Date(now.getTime() - minutes * 60000));
    targets.push({ stage: minutes, date, time, label });
  }

  const rows = db
    .prepare(
      `SELECT pills.id AS pill_id, pills.name, pills.times, pills.icon, pills.stock, pills.low_stock_threshold,
              users.id AS user_id, users.allows_write_to_pm
       FROM pills JOIN users ON users.id = pills.user_id
       WHERE pills.active = 1`
    )
    .all();

  const markSent = db.prepare('INSERT OR IGNORE INTO reminder_log (pill_id, sent_for, stage) VALUES (?, ?, ?)');
  const isTaken = db.prepare('SELECT 1 FROM doses WHERE pill_id = ? AND dose_date = ? AND dose_time = ?');

  for (const row of rows) {
    if (!row.allows_write_to_pm) continue;
    const times = JSON.parse(row.times);

    for (const target of targets) {
      if (!times.includes(target.time)) continue;
      if (isTaken.get(row.pill_id, target.date, target.time)) continue; // already checked off — stop nagging

      const sentFor = `${target.date} ${target.time}`;
      const result = markSent.run(row.pill_id, sentFor, target.stage);
      if (result.changes === 0) continue; // this stage was already sent for this exact dose

      const text = buildReminderText(row, target);
      try {
        const sendResult = await sendMessage(row.user_id, text);
        if (!sendResult.ok) {
          console.error(
            `sendMessage rejected for pill ${row.pill_id} stage ${target.stage} (user ${row.user_id}): ` +
              `HTTP ${sendResult.status} — ${JSON.stringify(sendResult.body)}`
          );
        }
      } catch (err) {
        console.error(`Failed to send reminder for pill ${row.pill_id} stage ${target.stage}:`, err.message);
      }
    }
  }
}

function startReminderScheduler() {
  cron.schedule('* * * * *', () => {
    checkAndSendReminders().catch((err) => console.error('Reminder tick failed:', err));
  }, { timezone: 'Asia/Tehran' });
  console.log('Reminder scheduler started (every minute, Asia/Tehran).');
  if (!process.env.EITAA_MINIAPP_USERNAME) {
    console.warn(
      'EITAA_MINIAPP_USERNAME is not set — reminder messages will not include the "خوردم" one-tap link.'
    );
  }
}

module.exports = { startReminderScheduler, checkAndSendReminders };
