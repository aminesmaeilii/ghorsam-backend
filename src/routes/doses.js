const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const { tehranNow, tehranDateDaysAgo } = require('../time');

const router = express.Router();

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STREAK_LOOKBACK_DAYS = 3650; // 10 years — safety bound against a runaway loop

/** Inserts a dose row and decrements stock if tracked. Assumes no existing row for this key. */
function insertTakenDose(pill, userId, date, time) {
  let stockDecremented = 0;
  let newStock = pill.stock;
  if (pill.stock !== null && pill.stock > 0) {
    newStock = pill.stock - 1;
    stockDecremented = 1;
    db.prepare('UPDATE pills SET stock = ? WHERE id = ?').run(newStock, pill.id);
  }
  db.prepare(
    'INSERT INTO doses (pill_id, user_id, dose_date, dose_time, stock_decremented) VALUES (?, ?, ?, ?, ?)'
  ).run(pill.id, userId, date, time, stockDecremented);
  return newStock;
}

router.get('/today', requireAuth, (req, res) => {
  const { date } = tehranNow();
  const pills = db
    .prepare('SELECT * FROM pills WHERE user_id = ? AND active = 1')
    .all(req.userId);

  const taken = new Set(
    db
      .prepare('SELECT pill_id, dose_time FROM doses WHERE user_id = ? AND dose_date = ?')
      .all(req.userId, date)
      .map((r) => `${r.pill_id}|${r.dose_time}`)
  );

  const schedule = [];
  for (const pill of pills) {
    for (const time of JSON.parse(pill.times)) {
      schedule.push({
        pillId: pill.id,
        name: pill.name,
        icon: pill.icon || '💊',
        color: pill.color || '#a51c26',
        time,
        taken: taken.has(`${pill.id}|${time}`),
      });
    }
  }
  schedule.sort((a, b) => a.time.localeCompare(b.time));

  res.json({ ok: true, date, schedule });
});

router.post('/toggle', requireAuth, (req, res) => {
  const { pillId, time } = req.body || {};
  if (!pillId || typeof time !== 'string' || !TIME_RE.test(time)) {
    return res.status(400).json({ ok: false, error: 'pill_id_and_time_required' });
  }

  const pill = db.prepare('SELECT * FROM pills WHERE id = ? AND user_id = ?').get(pillId, req.userId);
  if (!pill) return res.status(404).json({ ok: false, error: 'not_found' });
  if (!JSON.parse(pill.times).includes(time)) {
    return res.status(400).json({ ok: false, error: 'time_not_scheduled' });
  }

  const { date } = tehranNow();
  const existing = db
    .prepare('SELECT * FROM doses WHERE pill_id = ? AND dose_date = ? AND dose_time = ?')
    .get(pillId, date, time);

  if (existing) {
    db.prepare('DELETE FROM doses WHERE id = ?').run(existing.id);
    if (existing.stock_decremented && pill.stock !== null) {
      db.prepare('UPDATE pills SET stock = stock + 1 WHERE id = ?').run(pillId);
    }
    return res.json({ ok: true, taken: false, stock: existing.stock_decremented && pill.stock !== null ? pill.stock + 1 : pill.stock });
  }

  const newStock = insertTakenDose(pill, req.userId, date, time);
  res.json({ ok: true, taken: true, stock: newStock });
});

// Idempotent "mark as taken" for a specific dose — used by the "خوردم" link
// in reminder messages (see src/reminder.js buildTakeLink / js/app.js
// start_param handling). Unlike /toggle, clicking it twice is harmless: the
// second call just reports it was already taken instead of un-taking it.
// Accepts an explicit date because a reminder (and its escalations, up to 2h
// later) can be clicked after midnight, after "today" has moved on.
router.post('/mark-taken', requireAuth, (req, res) => {
  const { pillId, date, time } = req.body || {};
  if (!pillId || !DATE_RE.test(date) || typeof time !== 'string' || !TIME_RE.test(time)) {
    return res.status(400).json({ ok: false, error: 'pill_id_date_and_time_required' });
  }

  const pill = db.prepare('SELECT * FROM pills WHERE id = ? AND user_id = ?').get(pillId, req.userId);
  if (!pill) return res.status(404).json({ ok: false, error: 'not_found' });
  if (!JSON.parse(pill.times).includes(time)) {
    return res.status(400).json({ ok: false, error: 'time_not_scheduled' });
  }

  const existing = db
    .prepare('SELECT 1 FROM doses WHERE pill_id = ? AND dose_date = ? AND dose_time = ?')
    .get(pillId, date, time);
  if (existing) {
    return res.json({ ok: true, alreadyTaken: true, stock: pill.stock });
  }

  const newStock = insertTakenDose(pill, req.userId, date, time);
  res.json({ ok: true, alreadyTaken: false, stock: newStock });
});

router.get('/stats', requireAuth, (req, res) => {
  const pills = db.prepare('SELECT id, times FROM pills WHERE user_id = ? AND active = 1').all(req.userId);
  const scheduledPerDay = pills.reduce((sum, p) => sum + JSON.parse(p.times).length, 0);

  const totalTaken = db.prepare('SELECT COUNT(*) AS c FROM doses WHERE user_id = ?').get(req.userId).c;

  const countByDate = db
    .prepare("SELECT dose_date, COUNT(*) AS c FROM doses WHERE user_id = ? GROUP BY dose_date")
    .all(req.userId)
    .reduce((map, r) => ((map[r.dose_date] = r.c), map), {});

  let streak = 0;
  if (scheduledPerDay > 0) {
    const today = tehranDateDaysAgo(0);
    let dayOffset = (countByDate[today] || 0) >= scheduledPerDay ? 0 : 1;
    while (dayOffset <= MAX_STREAK_LOOKBACK_DAYS) {
      const d = tehranDateDaysAgo(dayOffset);
      if ((countByDate[d] || 0) >= scheduledPerDay) {
        streak += 1;
        dayOffset += 1;
      } else {
        break;
      }
    }
  }

  const { date } = tehranNow();
  const todayDone = countByDate[date] || 0;

  res.json({ ok: true, streak, totalTaken, todayDone, todayTotal: scheduledPerDay });
});

module.exports = router;
