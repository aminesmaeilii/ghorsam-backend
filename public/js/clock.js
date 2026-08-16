/**
 * Analog (wall-clock style) time picker. Exposes window.GhorsamClock.open({ initial, onConfirm }).
 * `initial` is a "HH:mm" 24h string; onConfirm receives the chosen "HH:mm" 24h string.
 */
(function () {
  'use strict';

  const CX = 110;
  const CY = 110;
  const NUMBER_RADIUS = 80;
  const KNOB_RADIUS_HOUR = 32;

  const backdrop = document.getElementById('clock-backdrop');
  const sheet = document.getElementById('clock-sheet');
  const face = document.getElementById('clock-face');
  const hand = document.getElementById('clock-hand');
  const knob = document.getElementById('clock-hand-knob');
  const numbersGroup = document.getElementById('clock-numbers');
  const hourDisplay = document.getElementById('clock-hour-display');
  const minuteDisplay = document.getElementById('clock-minute-display');
  const amBtn = document.getElementById('ampm-am');
  const pmBtn = document.getElementById('ampm-pm');
  const cancelBtn = document.getElementById('clock-cancel');
  const confirmBtn = document.getElementById('clock-confirm');

  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  function toFa(n) {
    return String(n).replace(/\d/g, (d) => FA_DIGITS[d]);
  }
  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  let mode = 'hour'; // 'hour' | 'minute'
  let hour12 = 8; // 1-12
  let minute = 0; // 0-59, snapped to 5s while dragging
  let period = 'am'; // 'am' | 'pm'
  let onConfirmCb = null;
  let dragging = false;

  function angleForIndex(index) {
    return index * 30 * (Math.PI / 180);
  }

  function pointForAngle(angleRad, radius) {
    return {
      x: CX + radius * Math.sin(angleRad),
      y: CY - radius * Math.cos(angleRad),
    };
  }

  function renderNumbers() {
    numbersGroup.innerHTML = '';
    const count = 12;
    for (let i = 0; i < count; i++) {
      const angle = angleForIndex(i);
      const { x, y } = pointForAngle(angle, NUMBER_RADIUS);
      const label = mode === 'hour' ? (i === 0 ? 12 : i) : pad2(i === 0 ? 0 : i * 5);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', y);
      text.setAttribute('class', 'clock-number');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.textContent = toFa(label);
      numbersGroup.appendChild(text);
    }
  }

  function currentIndex() {
    if (mode === 'hour') return hour12 === 12 ? 0 : hour12;
    return Math.round(minute / 5) % 12;
  }

  function updateHandPosition() {
    const angle = angleForIndex(currentIndex());
    const { x, y } = pointForAngle(angle, NUMBER_RADIUS - 6);
    hand.setAttribute('x2', x);
    hand.setAttribute('y2', y);
    knob.setAttribute('cx', x);
    knob.setAttribute('cy', y);
    knob.setAttribute('r', KNOB_RADIUS_HOUR);
  }

  function updateDisplays() {
    hourDisplay.textContent = toFa(pad2(hour12));
    minuteDisplay.textContent = toFa(pad2(minute));
    hourDisplay.classList.toggle('active', mode === 'hour');
    minuteDisplay.classList.toggle('active', mode === 'minute');
    amBtn.classList.toggle('active', period === 'am');
    pmBtn.classList.toggle('active', period === 'pm');
  }

  function setMode(newMode) {
    mode = newMode;
    renderNumbers();
    updateHandPosition();
    updateDisplays();
  }

  function valueFromEvent(evt) {
    const rect = face.getBoundingClientRect();
    const scaleX = 220 / rect.width;
    const scaleY = 220 / rect.height;
    const px = (evt.clientX - rect.left) * scaleX;
    const py = (evt.clientY - rect.top) * scaleY;
    const dx = px - CX;
    const dy = py - CY;
    let angleDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (angleDeg < 0) angleDeg += 360;
    const index = Math.round(angleDeg / 30) % 12;
    return index;
  }

  function applyIndex(index) {
    if (mode === 'hour') {
      hour12 = index === 0 ? 12 : index;
    } else {
      minute = index === 0 ? 0 : index * 5;
    }
    updateHandPosition();
    updateDisplays();
  }

  function onPointerDown(evt) {
    dragging = true;
    face.setPointerCapture(evt.pointerId);
    applyIndex(valueFromEvent(evt));
  }

  function onPointerMove(evt) {
    if (!dragging) return;
    applyIndex(valueFromEvent(evt));
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    if (mode === 'hour') {
      setTimeout(() => setMode('minute'), 180);
    }
  }

  face.addEventListener('pointerdown', onPointerDown);
  face.addEventListener('pointermove', onPointerMove);
  face.addEventListener('pointerup', onPointerUp);
  face.addEventListener('pointercancel', onPointerUp);

  hourDisplay.addEventListener('click', () => setMode('hour'));
  minuteDisplay.addEventListener('click', () => setMode('minute'));
  amBtn.addEventListener('click', () => { period = 'am'; updateDisplays(); });
  pmBtn.addEventListener('click', () => { period = 'pm'; updateDisplays(); });

  function close() {
    backdrop.hidden = true;
    sheet.hidden = true;
    onConfirmCb = null;
  }

  cancelBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  confirmBtn.addEventListener('click', () => {
    let hour24 = hour12 % 12;
    if (period === 'pm') hour24 += 12;
    const value = `${pad2(hour24)}:${pad2(minute)}`;
    const cb = onConfirmCb;
    close();
    if (cb) cb(value);
  });

  function open({ initial, onConfirm }) {
    const [h, m] = (initial || '08:00').split(':').map(Number);
    period = h >= 12 ? 'pm' : 'am';
    hour12 = h % 12 === 0 ? 12 : h % 12;
    minute = Math.round((m || 0) / 5) * 5;
    onConfirmCb = onConfirm;

    setMode('hour');
    backdrop.hidden = false;
    sheet.hidden = false;
  }

  window.GhorsamClock = { open, toFa, pad2 };
})();
