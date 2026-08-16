const express = require('express');
const db = require('../db');
const { verifyInitData, verifyContactData, issueSessionToken, sendMessage } = require('../eitaa');

const router = express.Router();

router.post('/verify-init', (req, res) => {
  const { initData } = req.body || {};
  const devSkip = process.env.DEV_SKIP_AUTH === '1';

  let user;
  if (devSkip) {
    user = { id: 1, first_name: 'تست', last_name: '', allows_write_to_pm: true };
  } else {
    const parsed = verifyInitData(initData);
    if (!parsed || !parsed.user) {
      return res.status(401).json({ ok: false, error: 'invalid_init_data' });
    }
    user = parsed.user;
  }

  const upsert = db.prepare(`
    INSERT INTO users (id, first_name, last_name, allows_write_to_pm)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      allows_write_to_pm = excluded.allows_write_to_pm
  `);
  upsert.run(user.id, user.first_name || '', user.last_name || '', user.allows_write_to_pm ? 1 : 0);

  const token = issueSessionToken(user.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ ok: true, token, user: serializeUser(row) });
});

// Called after the client shows requestWriteAccess() so we remember the grant.
router.post('/write-access', requireAuth, (req, res) => {
  const { granted } = req.body || {};
  db.prepare('UPDATE users SET allows_write_to_pm = ? WHERE id = ?').run(granted ? 1 : 0, req.userId);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, user: serializeUser(row) });
});

// Called after the client shows requestContact() so we can store the number.
// contactData is the raw signed string from the callback's 2nd argument —
// verified server-side exactly like initData (see verifyContactData).
router.post('/contact', requireAuth, (req, res) => {
  const { contactData } = req.body || {};
  const devSkip = process.env.DEV_SKIP_AUTH === '1';

  let phoneNumber = null;
  if (devSkip) {
    phoneNumber = '0912xxxxxxx';
  } else {
    const parsed = verifyContactData(contactData);
    if (!parsed) return res.status(401).json({ ok: false, error: 'invalid_contact_data' });
    const contact = parsed.contact;
    if (contact && typeof contact === 'object') {
      phoneNumber = contact.phone_number || contact.phone || contact.mobile || null;
    }
  }

  db.prepare('UPDATE users SET phone_number = ?, contact_shared = 1 WHERE id = ?').run(phoneNumber, req.userId);
  res.json({ ok: true });
});

// Diagnostic endpoint: sends the caller a real test message right now and
// returns Eitaa's raw response (status + body), so a delivery problem can be
// debugged from the HTTP response itself instead of digging through
// container logs. Not used by the UI.
router.post('/test-message', requireAuth, async (req, res) => {
  try {
    const result = await sendMessage(
      req.userId,
      '✅ این یک پیام تستی از قرصامه. اگه این رو تو ایتا می‌بینی، یعنی ارسال پیام درست کار می‌کنه.'
    );
    res.json({ ok: true, sendResult: result });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'send_failed', message: err.message });
  }
});

function serializeUser(row) {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    allows_write_to_pm: !!row.allows_write_to_pm,
    contactShared: !!row.contact_shared,
    memberSince: row.created_at,
  };
}

function requireAuth(req, res, next) {
  const { verifySessionToken } = require('../eitaa');
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const uid = verifySessionToken(token);
  if (!uid) return res.status(401).json({ ok: false, error: 'unauthorized' });
  req.userId = uid;
  next();
}

module.exports = { router, requireAuth };
