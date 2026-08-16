const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');

const router = express.Router();

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_NAME_LENGTH = 100;
const MAX_ICON_LENGTH = 16;
const MAX_TIMES_PER_PILL = 20;

function isValidTimesArray(times) {
  return (
    Array.isArray(times) &&
    times.length > 0 &&
    times.length <= MAX_TIMES_PER_PILL &&
    times.every((t) => typeof t === 'string' && TIME_RE.test(t))
  );
}

function dedupeTimes(times) {
  return Array.from(new Set(times)).sort();
}

function clampThreshold(value, fallback) {
  return Number.isInteger(value) && value >= 0 && value <= 1000 ? value : fallback;
}

function serializePill(row) {
  return {
    id: row.id,
    name: row.name,
    times: JSON.parse(row.times).sort(),
    active: !!row.active,
    color: row.color || '#a51c26',
    icon: row.icon || '💊',
    stock: row.stock === null || row.stock === undefined ? null : row.stock,
    lowStockThreshold: row.low_stock_threshold ?? 5,
  };
}

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM pills WHERE user_id = ? ORDER BY created_at DESC').all(req.userId);
  res.json({ ok: true, pills: rows.map(serializePill) });
});

router.post('/', requireAuth, (req, res) => {
  const { name, times, color, icon, stock, lowStockThreshold } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ ok: false, error: 'name_required' });
  }
  if (!isValidTimesArray(times)) {
    return res.status(400).json({ ok: false, error: 'invalid_times' });
  }
  if (color !== undefined && !COLOR_RE.test(color)) {
    return res.status(400).json({ ok: false, error: 'invalid_color' });
  }
  if (icon !== undefined && (typeof icon !== 'string' || icon.length > MAX_ICON_LENGTH)) {
    return res.status(400).json({ ok: false, error: 'invalid_icon' });
  }
  const stockValue = stock === undefined || stock === null || stock === '' ? null : Number(stock);
  if (stockValue !== null && (!Number.isInteger(stockValue) || stockValue < 0 || stockValue > 100000)) {
    return res.status(400).json({ ok: false, error: 'invalid_stock' });
  }

  const info = db
    .prepare(
      `INSERT INTO pills (user_id, name, times, color, icon, stock, low_stock_threshold)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.userId,
      name.trim().slice(0, MAX_NAME_LENGTH),
      JSON.stringify(dedupeTimes(times)),
      color || '#a51c26',
      icon || '💊',
      stockValue,
      clampThreshold(lowStockThreshold, 5)
    );

  const row = db.prepare('SELECT * FROM pills WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ok: true, pill: serializePill(row) });
});

router.put('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM pills WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });

  const { name, times, active, color, icon, stock, lowStockThreshold } = req.body || {};
  const newName =
    typeof name === 'string' && name.trim() ? name.trim().slice(0, MAX_NAME_LENGTH) : existing.name;
  const newTimes = isValidTimesArray(times) ? JSON.stringify(dedupeTimes(times)) : existing.times;
  const newActive = typeof active === 'boolean' ? (active ? 1 : 0) : existing.active;
  const newColor = typeof color === 'string' && COLOR_RE.test(color) ? color : existing.color;
  const newIcon =
    typeof icon === 'string' && icon.trim() && icon.length <= MAX_ICON_LENGTH ? icon.trim() : existing.icon;
  const newStock =
    stock === undefined
      ? existing.stock
      : stock === null || stock === ''
        ? null
        : Number.isInteger(Number(stock)) && Number(stock) >= 0 && Number(stock) <= 100000
          ? Number(stock)
          : existing.stock;
  const newThreshold = clampThreshold(lowStockThreshold, existing.low_stock_threshold);

  db.prepare(
    `UPDATE pills SET name = ?, times = ?, active = ?, color = ?, icon = ?, stock = ?, low_stock_threshold = ?
     WHERE id = ?`
  ).run(newName, newTimes, newActive, newColor, newIcon, newStock, newThreshold, id);

  const row = db.prepare('SELECT * FROM pills WHERE id = ?').get(id);
  res.json({ ok: true, pill: serializePill(row) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM pills WHERE id = ? AND user_id = ?').run(id, req.userId);
  if (info.changes === 0) return res.status(404).json({ ok: false, error: 'not_found' });
  db.prepare('DELETE FROM doses WHERE pill_id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
