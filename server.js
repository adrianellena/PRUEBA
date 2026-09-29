const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const net = require('net');
const ping = require('ping');
const argon2 = require('argon2');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'ips.txt');
const LAST_SEEN_FILE = path.join(__dirname, 'data', 'last-seen.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.txt');
const FILE_HEADER =
  '# Lista de IPs a monitorear\n' +
  '# Formato: <ip>[:puerto] <nombre nemotécnico>\n' +
  '# Si se indica :puerto (ej: 192.168.1.50:20000), se testea puntualmente\n' +
  '# el estado de ese puerto TCP en vez del chequeo general por ping.\n' +
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

// Hash "señuelo" fijo: se usa para verificar contra un usuario inexistente,
// así el tiempo de respuesta no delata si el usuario existe o no en el archivo.
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$QUVeBlaGFHHKR9crBllO/g$0UO+I1V1DI0eqEnvIFTxcfm4ScocGuR6PJY6ufo32jQ';

// Protección básica contra fuerza bruta: bloquea una IP luego de varios
// intentos fallidos seguidos.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

function isLockedOut(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAttempt > LOCKOUT_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

function registerFailedAttempt(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry || Date.now() - entry.firstAttempt > LOCKOUT_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: Date.now() });
  } else {
    entry.count += 1;
  }
}

function clearFailedAttempts(ip) {
  loginAttempts.delete(ip);
}

function parseUserLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const sepIndex = trimmed.indexOf(':');
  if (sepIndex === -1) return null;

  const username = trimmed.slice(0, sepIndex).trim();
  const hash = trimmed.slice(sepIndex + 1).trim();
  if (!username || !hash) return null;

  return [username, hash];
}

async function loadUsers() {
  try {
    const raw = await fs.readFile(USERS_FILE, 'utf-8');
    return new Map(raw.split('\n').map(parseUserLine).filter(Boolean));
  } catch (err) {
    if (err.code === 'ENOENT') return new Map();
    throw err;
  }
}

async function verifyCredentials(username, password) {
  const users = await loadUsers();
  const hash = users.get(username);

  if (!hash) {
    // Igual hacemos una verificación (contra un hash señuelo) para que el
    // tiempo de respuesta sea similar al de un usuario que sí existe.
    await argon2.verify(DUMMY_HASH, password).catch(() => false);
    return false;
  }

  try {
    return await argon2.verify(hash, password);
  } catch (err) {
    console.error(`Hash inválido para el usuario "${username}" en ${USERS_FILE}:`, err.message);
    return false;
  }
}

async function requireAuth(req, res, next) {
  if (isLockedOut(req.ip)) {
    res.set('Retry-After', String(Math.ceil(LOCKOUT_WINDOW_MS / 1000)));
    return res.status(429).send('Demasiados intentos fallidos. Probá de nuevo más tarde.');
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const sepIndex = decoded.indexOf(':');
    const user = sepIndex === -1 ? decoded : decoded.slice(0, sepIndex);
    const pass = sepIndex === -1 ? '' : decoded.slice(sepIndex + 1);

    if (user && pass && (await verifyCredentials(user, pass))) {
      clearFailedAttempts(req.ip);
      return next();
    }
  }

  registerFailedAttempt(req.ip);
  res.set('WWW-Authenticate', 'Basic realm="Estado de IPs"');
  res.status(401).send('Autenticación requerida');
}

app.use(requireAuth);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function isValidPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

// Identificador único de una entrada: la IP sola, o "ip:puerto" si se
// especificó un puerto puntual a testear. Se usa como clave para el
// registro de "último online", para detectar duplicados y para el borrado.
function entryKey(entry) {
  return entry.port ? `${entry.ip}:${entry.port}` : entry.ip;
}

// Parsea el primer token de una línea ("ip" o "ip:puerto") en sus partes.
function parseIpPortToken(token) {
  const colonIndex = token.indexOf(':');
  if (colonIndex === -1) {
    return IPV4_REGEX.test(token) ? { ip: token, port: null } : null;
  }

  const ip = token.slice(0, colonIndex);
  const port = Number(token.slice(colonIndex + 1));
  if (!IPV4_REGEX.test(ip) || !isValidPort(port)) return null;

  return { ip, port };
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const match = trimmed.match(/^(\S+)\s+(.+)$/);
  const token = match ? match[1] : trimmed;
  const name = match ? match[2].trim() : token;

  const parsed = parseIpPortToken(token);
  if (!parsed) return null;

  return { ip: parsed.ip, port: parsed.port, name };
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
  const body = ips.map((entry) => `${entryKey(entry)} ${entry.name}`).join('\n');
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

// A diferencia de tcpProbe (que sólo quiere saber si el HOST responde en
// alguno de varios puertos comunes), acá cualquier error -incluido
// ECONNREFUSED- significa que ESE puerto puntual no está abierto.
function checkPortOpen(host, port, timeout) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));

    socket.connect(port, host);
  });
}

async function checkPort(ip, port) {
  const start = Date.now();
  const open = await checkPortOpen(ip, port, TCP_TIMEOUT_MS);
  return {
    status: open ? 'ACTIVO' : 'INACTIVO',
    ms: Date.now() - start,
    method: `tcp:${port}`,
  };
}

function checkEntry(entry) {
  return entry.port ? checkPort(entry.ip, entry.port) : checkHost(entry.ip);
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
        const key = entryKey(entry);
        const check = await checkEntry(entry);
        if (check.status === 'ACTIVO') {
          lastSeen[key] = new Date().toISOString();
        }
        return {
          ...entry,
          ...check,
          lastOnline: lastSeen[key] || null,
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

  const { name, ip, port } = req.body || {};

  if (!ip || typeof ip !== 'string' || !IPV4_REGEX.test(ip.trim())) {
    return res.status(400).json({ error: 'Dirección IP inválida' });
  }

  let parsedPort = null;
  if (port !== undefined && port !== null && port !== '') {
    parsedPort = Number(port);
    if (!isValidPort(parsedPort)) {
      return res.status(400).json({ error: 'El puerto debe ser un número entre 1 y 65535' });
    }
  }

  const trimmedName = (name || '').trim();
  const trimmedIp = ip.trim();
  const newEntry = {
    name: trimmedName || trimmedIp,
    ip: trimmedIp,
    port: parsedPort,
  };

  const ips = await loadIps();
  if (ips.some((entry) => entryKey(entry) === entryKey(newEntry))) {
    return res.status(409).json({ error: 'Esa IP (y puerto) ya está en la lista' });
  }

  ips.push(newEntry);
  await saveIps(ips);
  res.status(201).json(newEntry);
});

app.delete('/api/ips/:key', async (req, res) => {
  if (!ALLOW_IP_EDITS) {
    return res.status(403).json({ error: 'La edición de la lista de IPs está deshabilitada' });
  }

  const ips = await loadIps();
  const filtered = ips.filter((entry) => entryKey(entry) !== req.params.key);

  if (filtered.length === ips.length) {
    return res.status(404).json({ error: 'IP no encontrada' });
  }

  await saveIps(filtered);

  const lastSeen = await loadLastSeen();
  if (req.params.key in lastSeen) {
    delete lastSeen[req.params.key];
    await saveLastSeen();
  }

  res.status(204).end();
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`IP Status Monitor escuchando en http://0.0.0.0:${PORT}`);

  const users = await loadUsers();
  if (users.size === 0) {
    console.log('======================================================');
    console.log(`No hay usuarios configurados en ${USERS_FILE}.`);
    console.log('Nadie va a poder ingresar hasta que crees uno con:');
    console.log('  node scripts/manage-users.js add <usuario>');
    console.log('======================================================');
  } else {
    console.log(`Autenticación: ${users.size} usuario(s) cargado(s) desde ${USERS_FILE}`);
  }
});
