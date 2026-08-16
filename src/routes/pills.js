const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');

const router = express.Router();

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function serializePill(row) {
  return { id: row.id, name: row.name, times: JSON.parse(row.times), active: !!row.active };
}

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM pills WHERE user_id = ? ORDER BY created_at DESC').all(req.userId);
  res.json({ ok: true, pills: rows.map(serializePill) });
});

router.post('/', requireAuth, (req, res) => {
  const { name, times } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ ok: false, error: 'name_required' });
  }
  if (!Array.isArray(times) || times.length === 0 || !times.every((t) => TIME_RE.test(t))) {
    return res.status(400).json({ ok: false, error: 'invalid_times' });
  }

  const info = db
    .prepare('INSERT INTO pills (user_id, name, times) VALUES (?, ?, ?)')
    .run(req.userId, name.trim(), JSON.stringify(times));

  const row = db.prepare('SELECT * FROM pills WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ok: true, pill: serializePill(row) });
});

router.put('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM pills WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });

  const { name, times, active } = req.body || {};
  const newName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
  const newTimes =
    Array.isArray(times) && times.length && times.every((t) => TIME_RE.test(t))
      ? JSON.stringify(times)
      : existing.times;
  const newActive = typeof active === 'boolean' ? (active ? 1 : 0) : existing.active;

  db.prepare('UPDATE pills SET name = ?, times = ?, active = ? WHERE id = ?').run(newName, newTimes, newActive, id);
  const row = db.prepare('SELECT * FROM pills WHERE id = ?').get(id);
  res.json({ ok: true, pill: serializePill(row) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM pills WHERE id = ? AND user_id = ?').run(id, req.userId);
  if (info.changes === 0) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true });
});

module.exports = router;
