const REFRESH_INTERVAL_MS = 8000;

const listEl = document.getElementById('ip-list');
const emptyStateEl = document.getElementById('empty-state');
const lastUpdatedEl = document.getElementById('last-updated');
const refreshBtn = document.getElementById('refresh-btn');
const form = document.getElementById('add-form');
const nameInput = document.getElementById('input-name');
const ipInput = document.getElementById('input-ip');
const formError = document.getElementById('form-error');

let refreshTimer = null;
let isFetching = false;

function formatTime(date) {
  return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderList(items) {
  listEl.innerHTML = '';
  emptyStateEl.hidden = items.length > 0;

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'ip-card';

    const statusClass = item.status === 'ACTIVO' ? 'activo' : 'inactivo';

    li.innerHTML = `
      <div class="ip-info">
        <div class="ip-name"></div>
        <div class="ip-address"></div>
      </div>
      <div class="ip-actions">
        <span class="status-badge ${statusClass}"></span>
        <button class="delete-btn" title="Eliminar" aria-label="Eliminar ${item.name}">✕</button>
      </div>
    `;

    li.querySelector('.ip-name').textContent = item.name;
    li.querySelector('.ip-address').textContent = item.ip;
    li.querySelector('.status-badge').textContent = item.status;
    li.querySelector('.delete-btn').addEventListener('click', () => deleteIp(item.ip));

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

fetchStatuses();
startAutoRefresh();
