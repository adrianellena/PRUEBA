const REFRESH_INTERVAL_MS = 8000;
const ALARM_BEEP_INTERVAL_MS = 1200;
const ALARM_PREF_KEY = 'ipstatus.alarmEnabled';

const listEl = document.getElementById('ip-list');
const emptyStateEl = document.getElementById('empty-state');
const lastUpdatedEl = document.getElementById('last-updated');
const refreshBtn = document.getElementById('refresh-btn');
const form = document.getElementById('add-form');
const nameInput = document.getElementById('input-name');
const ipInput = document.getElementById('input-ip');
const formError = document.getElementById('form-error');
const alarmToggleBtn = document.getElementById('alarm-toggle');
const alarmBanner = document.getElementById('alarm-banner');
const alarmSilenceBtn = document.getElementById('alarm-silence-btn');

let refreshTimer = null;
let isFetching = false;
let appConfig = { editableIps: true };
let previousStatuses = null;
let alarmEnabled = localStorage.getItem(ALARM_PREF_KEY) !== 'false';
let alarmActive = false;
let alarmIntervalId = null;
let audioCtx = null;

function updateAlarmToggleUI() {
  alarmToggleBtn.textContent = alarmEnabled ? '🔔' : '🔕';
  alarmToggleBtn.classList.toggle('muted', !alarmEnabled);
  alarmToggleBtn.setAttribute('aria-pressed', String(alarmEnabled));
}

function ensureAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function beep() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (err) {
    console.error('No se pudo reproducir la alarma', err);
  }
}

function startAlarm() {
  if (alarmActive) return;
  alarmActive = true;
  alarmBanner.hidden = false;
  beep();
  alarmIntervalId = setInterval(beep, ALARM_BEEP_INTERVAL_MS);
}

function stopAlarm() {
  alarmActive = false;
  alarmBanner.hidden = true;
  if (alarmIntervalId) {
    clearInterval(alarmIntervalId);
    alarmIntervalId = null;
  }
}

function checkOfflineTransitions(items) {
  const current = new Map(items.map((item) => [item.ip, item.status]));

  if (previousStatuses) {
    for (const [ip, status] of current) {
      const prevStatus = previousStatuses.get(ip);
      if (prevStatus === 'ACTIVO' && status === 'INACTIVO' && alarmEnabled) {
        startAlarm();
      }
    }
  }

  previousStatuses = current;
}

alarmToggleBtn.addEventListener('click', () => {
  alarmEnabled = !alarmEnabled;
  localStorage.setItem(ALARM_PREF_KEY, String(alarmEnabled));
  updateAlarmToggleUI();
  if (!alarmEnabled) stopAlarm();
  ensureAudioContext();
});

alarmSilenceBtn.addEventListener('click', stopAlarm);

updateAlarmToggleUI();

function formatTime(date) {
  return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatLastOnline(isoString) {
  const date = new Date(isoString);
  const sameDay = date.toDateString() === new Date().toDateString();
  const dateOpts = sameDay
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
  return date.toLocaleString('es-AR', dateOpts);
}

function renderList(items) {
  listEl.innerHTML = '';
  emptyStateEl.hidden = items.length > 0;

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'ip-card';

    const isOnline = item.status === 'ACTIVO';
    const statusClass = isOnline ? 'activo' : 'inactivo';

    li.innerHTML = `
      <span class="status-icon ${statusClass}" title="${item.status}" aria-hidden="true"></span>
      <div class="ip-info">
        <div class="ip-name"></div>
        <div class="ip-address"></div>
        <div class="last-seen"></div>
      </div>
      <div class="ip-actions">
        <span class="status-badge ${statusClass}"></span>
        <button class="delete-btn" title="Eliminar" aria-label="Eliminar ${item.name}">✕</button>
      </div>
    `;

    li.querySelector('.ip-name').textContent = item.name;
    li.querySelector('.ip-address').textContent = item.ip;
    li.querySelector('.status-badge').textContent = item.status;

    const lastSeenEl = li.querySelector('.last-seen');
    if (!isOnline) {
      lastSeenEl.textContent = item.lastOnline
        ? `Último online: ${formatLastOnline(item.lastOnline)}`
        : 'Sin registro de actividad';
    } else {
      lastSeenEl.remove();
    }

    const deleteBtn = li.querySelector('.delete-btn');
    if (appConfig.editableIps) {
      deleteBtn.addEventListener('click', () => deleteIp(item.ip));
    } else {
      deleteBtn.remove();
    }

    listEl.appendChild(li);
  }
}

async function fetchStatuses({ showSpinner = true } = {}) {
  if (isFetching) return;
  isFetching = true;

  if (showSpinner) refreshBtn.classList.add('spinning');

  try {
    const res = await fetch('/api/ips');
    if (!res.ok) throw new Error('Error al obtener el estado');
    const data = await res.json();
    checkOfflineTransitions(data);
    renderList(data);
    lastUpdatedEl.textContent = `Actualizado ${formatTime(new Date())}`;
  } catch (err) {
    lastUpdatedEl.textContent = 'Error al actualizar';
    console.error(err);
  } finally {
    isFetching = false;
    if (showSpinner) refreshBtn.classList.remove('spinning');
  }
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) appConfig = await res.json();
  } catch (err) {
    console.error(err);
  }
  form.hidden = !appConfig.editableIps;
}

async function deleteIp(ip) {
  try {
    const res = await fetch(`/api/ips/${encodeURIComponent(ip)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('No se pudo eliminar');
    await fetchStatuses({ showSpinner: false });
  } catch (err) {
    console.error(err);
  }
}

function showFormError(message) {
  formError.textContent = message;
  formError.hidden = false;
  setTimeout(() => {
    formError.hidden = true;
  }, 3000);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const ip = ipInput.value.trim();

  if (!ip) {
    showFormError('Ingresá una dirección IP');
    return;
  }

  try {
    const res = await fetch('/api/ips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ip }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'No se pudo agregar la IP');
    }

    nameInput.value = '';
    ipInput.value = '';
    await fetchStatuses({ showSpinner: false });
  } catch (err) {
    showFormError(err.message);
  }
});

refreshBtn.addEventListener('click', () => fetchStatuses());

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => fetchStatuses({ showSpinner: false }), REFRESH_INTERVAL_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (refreshTimer) clearInterval(refreshTimer);
  } else {
    fetchStatuses({ showSpinner: false });
    startAutoRefresh();
  }
});

loadConfig().then(fetchStatuses);
startAutoRefresh();
