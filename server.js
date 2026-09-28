const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const net = require('net');
const crypto = require('crypto');
const ping = require('ping');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'ips.txt');
const LAST_SEEN_FILE = path.join(__dirname, 'data', 'last-seen.json');
const FILE_HEADER =
  '# Lista de IPs a monitorear\n' +
  '# Formato: <ip> <nombre nemotécnico>\n' +
  '# Una IP por línea. Las líneas vacías o que empiezan con # se ignoran.\n';

// Puertos TCP comunes usados como respaldo cuando el ping ICMP
// no está disponible o el host lo tiene bloqueado.
const FALLBACK_PORTS = [80, 443, 22, 8080, 3389, 21, 23, 445];
const PING_TIMEOUT_SECONDS = 2;
const TCP_TIMEOUT_MS = 1500;

// Si es "false", la lista de IPs queda de solo lectura: se puede ver el
// estado pero no agregar ni eliminar direcciones (ni desde la web ni la API).
const ALLOW_IP_EDITS = (process.env.ALLOW_IP_EDITS ?? 'true').toLowerCase() !== 'false';

const IPV4_REGEX =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const AUTH_USER = process.env.AUTH_USER || 'admin';
let AUTH_PASSWORD = process.env.AUTH_PASSWORD;
if (!AUTH_PASSWORD) {
  AUTH_PASSWORD = crypto.randomBytes(9).toString('base64url');
  console.log('======================================================');
  console.log('AUTH_PASSWORD no definida: se generó una contraseña temporal.');
  console.log(`  Usuario:    ${AUTH_USER}`);
  console.log(`  Contraseña: ${AUTH_PASSWORD}`);
  console.log('Para fijar credenciales propias (recomendado), definí las');
  console.log('variables de entorno AUTH_USER y AUTH_PASSWORD antes de iniciar.');
  console.log('======================================================');
}

function timingSafeStringEqual(a, b) {
  const bufA = crypto.createHash('sha256').update(String(a)).digest();
  const bufB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const sepIndex = decoded.indexOf(':');
    const user = sepIndex === -1 ? decoded : decoded.slice(0, sepIndex);
    const pass = sepIndex === -1 ? '' : decoded.slice(sepIndex + 1);

    if (timingSafeStringEqual(user, AUTH_USER) && timingSafeStringEqual(pass, AUTH_PASSWORD)) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Estado de IPs"');
  res.status(401).send('Autenticación requerida');
}

app.use(requireAuth);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const match = trimmed.match(/^(\S+)\s+(.+)$/);
  const ip = match ? match[1] : trimmed;
  const name = match ? match[2].trim() : ip;

  if (!IPV4_REGEX.test(ip)) return null;
  return { ip, name };
}

async function loadIps() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    return raw
      .split('\n')
      .map(parseLine)
      .filter(Boolean);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveIps(ips) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const body = ips.map((entry) => `${entry.ip} ${entry.name}`).join('\n');
  await fs.writeFile(DATA_FILE, FILE_HEADER + body + (body ? '\n' : ''));
}

let lastSeenCache = null;

async function loadLastSeen() {
  if (lastSeenCache) return lastSeenCache;
  try {
    const raw = await fs.readFile(LAST_SEEN_FILE, 'utf-8');
    lastSeenCache = JSON.parse(raw);
  } catch (err) {
    lastSeenCache = {};
  }
  return lastSeenCache;
}

async function saveLastSeen() {
  await fs.mkdir(path.dirname(LAST_SEEN_FILE), { recursive: true });
  await fs.writeFile(LAST_SEEN_FILE, JSON.stringify(lastSeenCache, null, 2));
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

app.get('/api/config', (req, res) => {
  res.json({ editableIps: ALLOW_IP_EDITS });
});

app.get('/api/ips', async (req, res) => {
  try {
    const ips = await loadIps();
    const lastSeen = await loadLastSeen();
    const results = await Promise.all(
      ips.map(async (entry) => {
        const check = await checkHost(entry.ip);
        if (check.status === 'ACTIVO') {
          lastSeen[entry.ip] = new Date().toISOString();
        }
        return {
          ...entry,
          ...check,
          lastOnline: lastSeen[entry.ip] || null,
          checkedAt: new Date().toISOString(),
        };
      })
    );
    await saveLastSeen();
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo obtener el estado de las IPs' });
  }
});

app.post('/api/ips', async (req, res) => {
  if (!ALLOW_IP_EDITS) {
    return res.status(403).json({ error: 'La edición de la lista de IPs está deshabilitada' });
  }

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
    name: trimmedName || trimmedIp,
    ip: trimmedIp,
  };

  ips.push(newEntry);
  await saveIps(ips);
  res.status(201).json(newEntry);
});

app.delete('/api/ips/:ip', async (req, res) => {
  if (!ALLOW_IP_EDITS) {
    return res.status(403).json({ error: 'La edición de la lista de IPs está deshabilitada' });
  }

  const ips = await loadIps();
  const filtered = ips.filter((entry) => entry.ip !== req.params.ip);

  if (filtered.length === ips.length) {
    return res.status(404).json({ error: 'IP no encontrada' });
  }

  await saveIps(filtered);

  const lastSeen = await loadLastSeen();
  if (req.params.ip in lastSeen) {
    delete lastSeen[req.params.ip];
    await saveLastSeen();
  }

  res.status(204).end();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`IP Status Monitor escuchando en http://0.0.0.0:${PORT}`);
});
