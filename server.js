const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const net = require('net');
const crypto = require('crypto');
const ping = require('ping');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'ips.json');

// Puertos TCP comunes usados como respaldo cuando el ping ICMP
// no está disponible o el host lo tiene bloqueado.
const FALLBACK_PORTS = [80, 443, 22, 8080, 3389, 21, 23, 445];
const PING_TIMEOUT_SECONDS = 2;
const TCP_TIMEOUT_MS = 1500;

const IPV4_REGEX =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function loadIps() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveIps(ips) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(ips, null, 2));
}

function tcpProbe(host, port, timeout) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (alive) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(alive);
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    // ECONNREFUSED significa que el host respondió (rechazó la conexión),
    // por lo tanto está activo aunque el puerto esté cerrado.
    socket.once('error', (err) => finish(err.code === 'ECONNREFUSED'));
    socket.once('timeout', () => finish(false));

    socket.connect(port, host);
  });
}

async function tcpFallback(host) {
  const results = await Promise.all(
    FALLBACK_PORTS.map((port) => tcpProbe(host, port, TCP_TIMEOUT_MS))
  );
  return results.some(Boolean);
}

async function checkHost(ip) {
  const start = Date.now();
  try {
    const res = await ping.promise.probe(ip, {
      timeout: PING_TIMEOUT_SECONDS,
      extra: ['-c', '1'],
    });
    if (res.alive) {
      return { status: 'ACTIVO', ms: Date.now() - start, method: 'icmp' };
    }
  } catch (_err) {
    // El comando ping puede no estar disponible o no tener permisos.
  }

  const alive = await tcpFallback(ip);
  return {
    status: alive ? 'ACTIVO' : 'INACTIVO',
    ms: Date.now() - start,
    method: 'tcp',
  };
}

app.get('/api/ips', async (req, res) => {
  try {
    const ips = await loadIps();
    const results = await Promise.all(
      ips.map(async (entry) => {
        const check = await checkHost(entry.ip);
        return { ...entry, ...check, checkedAt: new Date().toISOString() };
      })
    );
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo obtener el estado de las IPs' });
  }
});

app.post('/api/ips', async (req, res) => {
  const { name, ip } = req.body || {};

  if (!ip || typeof ip !== 'string' || !IPV4_REGEX.test(ip.trim())) {
    return res.status(400).json({ error: 'Dirección IP inválida' });
  }

  const trimmedName = (name || '').trim();
  const trimmedIp = ip.trim();

  const ips = await loadIps();
  if (ips.some((entry) => entry.ip === trimmedIp)) {
    return res.status(409).json({ error: 'Esa IP ya está en la lista' });
  }

  const newEntry = {
    id: crypto.randomUUID(),
    name: trimmedName || trimmedIp,
    ip: trimmedIp,
  };

  ips.push(newEntry);
  await saveIps(ips);
  res.status(201).json(newEntry);
});

app.delete('/api/ips/:id', async (req, res) => {
  const ips = await loadIps();
  const filtered = ips.filter((entry) => entry.id !== req.params.id);

  if (filtered.length === ips.length) {
    return res.status(404).json({ error: 'IP no encontrada' });
  }

  await saveIps(filtered);
  res.status(204).end();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`IP Status Monitor escuchando en http://0.0.0.0:${PORT}`);
});
