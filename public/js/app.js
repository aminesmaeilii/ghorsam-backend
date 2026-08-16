(function () {
  'use strict';

  // Same-origin backend by default; override if the API is hosted elsewhere.
  const API_BASE = window.GHORSAM_API_BASE || '';

  const webApp = window.Eitaa && window.Eitaa.WebApp;

  const ICONS = ['💊', '💉', '🩹', '🧴', '🌡️', '🫙', '🧪', '🩺'];
  const COLORS = ['#a51c26', '#1f6fb2', '#1f9d55', '#d99a1f', '#7a3fa0', '#c2447a'];

  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  function toFa(n) {
    return String(n).replace(/\d/g, (d) => FA_DIGITS[d]);
  }
  function faTime(time) {
    return toFa(time);
  }

  const state = {
    token: localStorage.getItem('ghorsam_token') || null,
    user: null,
    pills: [],
    today: [],
    stats: { streak: 0, totalTaken: 0, todayDone: 0, todayTotal: 0 },
    editingId: null,
    selectedIcon: ICONS[0],
    selectedColor: COLORS[0],
    activeTab: 'today',
    previousTab: 'today',
  };

  const el = {
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabToday: document.getElementById('tab-today'),
    tabPills: document.getElementById('tab-pills'),
    tabProfile: document.getElementById('tab-profile'),
    tabIndicator: document.getElementById('tab-indicator'),

    streakBadge: document.getElementById('streak-badge'),
    streakCount: document.getElementById('streak-count'),

    progressRingFg: document.getElementById('progress-ring-fg'),
    progressFraction: document.getElementById('progress-fraction'),
    progressHeadline: document.getElementById('progress-headline'),
    todayList: document.getElementById('today-list'),
    todayEmpty: document.getElementById('today-empty'),

    pillList: document.getElementById('pill-list'),
    pillsEmpty: document.getElementById('pills-empty'),

    profileChip: document.getElementById('profile-chip'),
    profileAvatar: document.getElementById('profile-avatar'),
    profileAvatarLg: document.getElementById('profile-avatar-lg'),
    profileName: document.getElementById('profile-name'),
    profileId: document.getElementById('profile-id'),
    statStreak: document.getElementById('stat-streak'),
    statTotalTaken: document.getElementById('stat-total-taken'),
    statPillCount: document.getElementById('stat-pill-count'),
    writeAccessStatus: document.getElementById('write-access-status'),
    requestWriteAccessBtn: document.getElementById('request-write-access-btn'),
    memberSince: document.getElementById('member-since'),
    profileBackBtn: document.getElementById('profile-back-btn'),

    addBtn: document.getElementById('add-btn'),
    sheet: document.getElementById('sheet'),
    backdrop: document.getElementById('sheet-backdrop'),
    sheetTitle: document.getElementById('sheet-title'),
    name: document.getElementById('pill-name'),
    iconPicker: document.getElementById('icon-picker'),
    colorPicker: document.getElementById('color-picker'),
    timeList: document.getElementById('time-list'),
    addTimeBtn: document.getElementById('add-time-btn'),
    stock: document.getElementById('pill-stock'),
    saveBtn: document.getElementById('save-btn'),
    deleteBtn: document.getElementById('delete-btn'),
    toast: document.getElementById('toast'),

    fabHint: document.getElementById('fab-hint'),
    fabHintClose: document.getElementById('fab-hint-close'),
  };

  const FAB_HINT_KEY = 'ghorsam_fab_hint_dismissed';

  function dismissFabHint() {
    el.fabHint.hidden = true;
    localStorage.setItem(FAB_HINT_KEY, '1');
  }

  function updateFabHint() {
    const alreadyDismissed = localStorage.getItem(FAB_HINT_KEY) === '1';
    el.fabHint.hidden = alreadyDismissed || state.pills.length > 0;
  }

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.toast.hidden = true; }, 2200);
  }

  async function api(path, options = {}) {
    const res = await fetch(API_BASE + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `request_failed_${res.status}`);
    }
    return data;
  }

  async function init() {
    if (webApp) {
      webApp.ready();
      webApp.expand();
    }

    renderIconPicker();
    renderColorPicker();
    wireStaticEvents();
    requestAnimationFrame(updateTabIndicator);
    window.addEventListener('resize', updateTabIndicator);

    try {
      await authenticate();
      await Promise.all([loadPills(), loadToday(), loadStats()]);
    } catch (err) {
      console.error(err);
      showToast('خطا در اتصال. دوباره تلاش کنید.');
    }
  }

  async function authenticate() {
    const initData = webApp ? webApp.initData : '';
    const data = await api('/api/auth/verify-init', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('ghorsam_token', data.token);
    renderProfile();

    if (webApp && !data.user.allows_write_to_pm && typeof webApp.requestWriteAccess === 'function') {
      webApp.requestWriteAccess((granted) => {
        state.user.allows_write_to_pm = granted;
        renderProfile();
        api('/api/auth/write-access', { method: 'POST', body: JSON.stringify({ granted }) }).catch(() => {});
      });
    }
  }

  function requestWriteAccess() {
    if (!webApp || typeof webApp.requestWriteAccess !== 'function') {
      showToast('این قابلیت فقط داخل اپ ایتا در دسترسه');
      return;
    }
    webApp.requestWriteAccess((granted) => {
      state.user.allows_write_to_pm = granted;
      renderProfile();
      api('/api/auth/write-access', { method: 'POST', body: JSON.stringify({ granted }) }).catch(() => {});
      showToast(granted ? 'یادآورها فعال شدن' : 'مجوز داده نشد');
    });
  }

  function renderProfile() {
    if (!state.user) return;
    const fullName = [state.user.first_name, state.user.last_name].filter(Boolean).join(' ') || 'کاربر ایتا';
    const initial = (state.user.first_name || 'ک').trim().charAt(0);

    el.profileAvatar.textContent = initial;
    el.profileAvatarLg.textContent = initial;
    el.profileName.textContent = fullName;
    el.profileId.textContent = `شناسه ایتا: ${toFa(state.user.id)}`;

    const granted = !!state.user.allows_write_to_pm;
    el.writeAccessStatus.textContent = granted ? 'فعال' : 'غیرفعال';
    el.writeAccessStatus.className = 'status-chip' + (granted ? '' : ' off');
    el.requestWriteAccessBtn.hidden = granted;

    if (state.user.memberSince) {
      el.memberSince.textContent = toFa(state.user.memberSince.slice(0, 10));
    }

    el.statStreak.textContent = toFa(state.stats.streak);
    el.statTotalTaken.textContent = toFa(state.stats.totalTaken);
    el.statPillCount.textContent = toFa(state.pills.filter((p) => p.active).length);
  }

  // ---------- Tabs ----------

  function wireStaticEvents() {
    el.tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab !== state.activeTab) state.previousTab = state.activeTab;
        switchTab(btn.dataset.tab);
      });
    });
    el.addBtn.addEventListener('click', () => openSheet(null));
    el.fabHint.addEventListener('click', () => {
      dismissFabHint();
      openSheet(null);
    });
    el.fabHintClose.addEventListener('click', (evt) => {
      evt.stopPropagation();
      dismissFabHint();
    });
    el.backdrop.addEventListener('click', closeSheet);
    el.addTimeBtn.addEventListener('click', () => openClockForNewTime());
    el.saveBtn.addEventListener('click', savePill);
    el.deleteBtn.addEventListener('click', deletePill);
    el.profileChip.addEventListener('click', () => {
      if (state.activeTab !== 'profile') state.previousTab = state.activeTab;
      switchTab('profile');
    });
    el.profileBackBtn.addEventListener('click', () => switchTab(state.previousTab));
    el.requestWriteAccessBtn.addEventListener('click', requestWriteAccess);
  }

  function switchTab(tab) {
    state.activeTab = tab;
    el.tabBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
    el.tabToday.hidden = tab !== 'today';
    el.tabPills.hidden = tab !== 'pills';
    el.tabProfile.hidden = tab !== 'profile';
    if (tab === 'profile') renderProfile();
    updateTabIndicator();
  }

  function updateTabIndicator() {
    const activeBtn = Array.from(el.tabBtns).find((btn) => btn.classList.contains('active'));
    if (!activeBtn) return;
    el.tabIndicator.style.width = `${activeBtn.offsetWidth}px`;
    el.tabIndicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
  }

  // ---------- Today tab ----------

  async function loadToday() {
    const data = await api('/api/doses/today');
    state.today = data.schedule;
    renderToday();
  }

  async function loadStats() {
    const data = await api('/api/doses/stats');
    state.stats = data;
    renderStats();
    renderProfile();
  }

  function renderStats() {
    const { streak, todayDone, todayTotal } = state.stats;
    el.streakBadge.hidden = streak <= 0;
    el.streakCount.textContent = toFa(streak);

    const fraction = todayTotal > 0 ? todayDone / todayTotal : 0;
    const circumference = 213.6;
    el.progressRingFg.style.strokeDashoffset = String(circumference * (1 - fraction));
    el.progressFraction.textContent = `${toFa(todayDone)}/${toFa(todayTotal)}`;

    if (todayTotal === 0) {
      el.progressHeadline.textContent = 'هنوز قرصی برای امروز ثبت نشده';
    } else if (todayDone >= todayTotal) {
      el.progressHeadline.textContent = 'آفرین! امروز رو کامل انجام دادی 🎉';
    } else {
      el.progressHeadline.textContent = `${toFa(todayTotal - todayDone)} یادآوری دیگه مونده`;
    }
  }

  function renderToday() {
    el.todayList.innerHTML = '';
    el.todayEmpty.hidden = state.today.length > 0;

    for (const item of state.today) {
      const row = document.createElement('div');
      row.className = 'today-item' + (item.taken ? ' taken' : '');

      const icon = document.createElement('div');
      icon.className = 'today-icon';
      icon.style.background = hexToSoft(item.color);
      icon.textContent = item.icon;

      const info = document.createElement('div');
      info.className = 'today-info';
      const name = document.createElement('div');
      name.className = 'today-name';
      name.textContent = item.name;
      const time = document.createElement('div');
      time.className = 'today-time';
      time.textContent = faTime(item.time);
      info.append(name, time);

      const check = document.createElement('div');
      check.className = 'today-check';
      check.textContent = item.taken ? '✓' : '';

      row.append(icon, info, check);
      row.addEventListener('click', () => toggleDose(item));
      el.todayList.appendChild(row);
    }
  }

  async function toggleDose(item) {
    item.taken = !item.taken;
    renderToday();
    try {
      await api('/api/doses/toggle', {
        method: 'POST',
        body: JSON.stringify({ pillId: item.pillId, time: item.time }),
      });
      await Promise.all([loadStats(), loadPills()]);
    } catch {
      item.taken = !item.taken;
      renderToday();
      showToast('خطا در ثبت. دوباره تلاش کن.');
    }
  }

  function hexToSoft(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, 0.14)`;
  }

  // ---------- Pills tab ----------

  async function loadPills() {
    const data = await api('/api/pills');
    state.pills = data.pills;
    renderPillList();
    renderProfile();
    updateFabHint();
  }

  function renderPillList() {
    el.pillList.innerHTML = '';
    el.pillsEmpty.hidden = state.pills.length > 0;

    for (const pill of state.pills) {
      const card = document.createElement('div');
      card.className = 'pill-card' + (pill.active ? '' : ' inactive');

      const iconBadge = document.createElement('div');
      iconBadge.className = 'pill-icon-badge';
      iconBadge.style.background = hexToSoft(pill.color);
      iconBadge.textContent = pill.icon;

      const info = document.createElement('div');
      info.className = 'pill-info';

      const name = document.createElement('div');
      name.className = 'pill-name';
      name.textContent = pill.name;
      info.appendChild(name);

      const times = document.createElement('div');
      times.className = 'pill-times';
      for (const t of pill.times) {
        const chip = document.createElement('span');
        chip.className = 'time-chip';
        chip.textContent = faTime(t);
        times.appendChild(chip);
      }
      if (pill.stock !== null) {
        const stockChip = document.createElement('span');
        const low = pill.stock <= pill.lowStockThreshold;
        stockChip.className = 'stock-chip' + (low ? ' low' : '');
        stockChip.textContent = `${toFa(pill.stock)} عدد مونده`;
        times.appendChild(stockChip);
      }
      info.appendChild(times);

      const actions = document.createElement('div');
      actions.className = 'pill-actions';

      const switchLabel = document.createElement('label');
      switchLabel.className = 'switch';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = pill.active;
      checkbox.addEventListener('change', () => toggleActive(pill, checkbox.checked));
      const track = document.createElement('span');
      track.className = 'switch-track';
      switchLabel.append(checkbox, track);

      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn';
      editBtn.textContent = '✎ ویرایش';
      editBtn.addEventListener('click', () => openSheet(pill));

      actions.append(switchLabel, editBtn);
      card.append(iconBadge, info, actions);
      el.pillList.appendChild(card);
    }
  }

  async function toggleActive(pill, active) {
    try {
      await api(`/api/pills/${pill.id}`, { method: 'PUT', body: JSON.stringify({ active }) });
      pill.active = active;
      renderPillList();
      await Promise.all([loadToday(), loadStats()]);
    } catch {
      showToast('خطا در بروزرسانی');
      renderPillList();
    }
  }

  // ---------- Icon / color pickers ----------

  function renderIconPicker() {
    el.iconPicker.innerHTML = '';
    for (const icon of ICONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-btn' + (icon === state.selectedIcon ? ' active' : '');
      btn.textContent = icon;
      btn.addEventListener('click', () => {
        state.selectedIcon = icon;
        renderIconPicker();
      });
      el.iconPicker.appendChild(btn);
    }
  }

  function renderColorPicker() {
    el.colorPicker.innerHTML = '';
    for (const color of COLORS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-btn' + (color === state.selectedColor ? ' active' : '');
      btn.style.background = color;
      btn.addEventListener('click', () => {
        state.selectedColor = color;
        renderColorPicker();
      });
      el.colorPicker.appendChild(btn);
    }
  }

  // ---------- Time list (uses the analog clock picker) ----------

  function addTimeRow(value) {
    const row = document.createElement('div');
    row.className = 'time-row';
    row.dataset.time = value;

    const valueSpan = document.createElement('span');
    valueSpan.className = 'time-row-value';
    valueSpan.textContent = faTime(value);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'time-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      row.remove();
    });

    row.addEventListener('click', () => {
      window.GhorsamClock.open({
        initial: row.dataset.time,
        onConfirm: (newValue) => {
          row.dataset.time = newValue;
          valueSpan.textContent = faTime(newValue);
        },
      });
    });

    row.append(valueSpan, removeBtn);
    el.timeList.appendChild(row);
  }

  function openClockForNewTime() {
    window.GhorsamClock.open({
      initial: '08:00',
      onConfirm: (value) => addTimeRow(value),
    });
  }

  function collectTimes() {
    return Array.from(el.timeList.querySelectorAll('.time-row')).map((row) => row.dataset.time);
  }

  // ---------- Add/edit pill sheet ----------

  function openSheet(pill) {
    dismissFabHint();
    state.editingId = pill ? pill.id : null;
    el.sheetTitle.textContent = pill ? 'ویرایش قرص' : 'قرص جدید';
    el.name.value = pill ? pill.name : '';
    el.stock.value = pill && pill.stock !== null ? pill.stock : '';

    state.selectedIcon = pill ? pill.icon : ICONS[0];
    state.selectedColor = pill ? pill.color : COLORS[0];
    renderIconPicker();
    renderColorPicker();

    el.timeList.innerHTML = '';
    if (pill) {
      pill.times.forEach((t) => addTimeRow(t));
    } else {
      addTimeRow('08:00');
    }
    el.deleteBtn.hidden = !pill;

    el.backdrop.hidden = false;
    el.sheet.hidden = false;
  }

  function closeSheet() {
    el.backdrop.hidden = true;
    el.sheet.hidden = true;
    state.editingId = null;
  }

  async function savePill() {
    const name = el.name.value.trim();
    const times = collectTimes();
    const stockRaw = el.stock.value.trim();
    const stock = stockRaw === '' ? null : Math.max(0, parseInt(stockRaw, 10) || 0);

    if (!name) {
      showToast('اسم قرص رو وارد کن');
      return;
    }
    if (times.length === 0) {
      showToast('حداقل یک ساعت یادآوری اضافه کن');
      return;
    }

    const payload = {
      name,
      times,
      icon: state.selectedIcon,
      color: state.selectedColor,
      stock,
    };

    try {
      if (state.editingId) {
        await api(`/api/pills/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/pills', { method: 'POST', body: JSON.stringify(payload) });
      }
      closeSheet();
      await Promise.all([loadPills(), loadToday(), loadStats()]);
      showToast('ذخیره شد');
    } catch {
      showToast('خطا در ذخیره‌سازی');
    }
  }

  async function deletePill() {
    if (!state.editingId) return;
    try {
      await api(`/api/pills/${state.editingId}`, { method: 'DELETE' });
      closeSheet();
      await Promise.all([loadPills(), loadToday(), loadStats()]);
      showToast('حذف شد');
    } catch {
      showToast('خطا در حذف');
    }
  }

  init();
})();
