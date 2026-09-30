#!/usr/bin/env node

// Gestiona data/users.txt: usuario en texto plano + hash Argon2id de la
// contraseña, uno por línea, separados por ":".
//
// Uso:
//   node scripts/manage-users.js add <usuario>
//   node scripts/manage-users.js remove <usuario>
//   node scripts/manage-users.js list

const fs = require('fs');
const path = require('path');
const argon2 = require('argon2');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.txt');

function readHiddenInput(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Este comando necesita una terminal interactiva para pedir la contraseña.'));
      return;
    }

    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf-8');

    let input = '';
    const onData = (char) => {
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input);
          break;
        case '\u0003':
          process.stdout.write('\n');
          process.exit(1);
          break;
        case '\u007f':
        case '\b':
          input = input.slice(0, -1);
          break;
        default:
          input += char;
          break;
      }
    };
    stdin.on('data', onData);
  });
}

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return new Map();

  const users = new Map();
  const lines = fs.readFileSync(USERS_FILE, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const sepIndex = trimmed.indexOf(':');
    if (sepIndex === -1) continue;

    const username = trimmed.slice(0, sepIndex).trim();
    const hash = trimmed.slice(sepIndex + 1).trim();
    if (username && hash) users.set(username, hash);
  }
  return users;
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  const body = [...users.entries()].map(([user, hash]) => `${user}:${hash}`).join('\n');
  fs.writeFileSync(USERS_FILE, body + (body ? '\n' : ''), { mode: 0o600 });
}

async function cmdAdd(username) {
  if (!username) {
    console.error('Uso: node scripts/manage-users.js add <usuario>');
    process.exit(1);
  }

  const pass1 = await readHiddenInput('Contraseña: ');
  if (!pass1) {
    console.error('La contraseña no puede estar vacía.');
    process.exit(1);
  }
  const pass2 = await readHiddenInput('Confirmar contraseña: ');
  if (pass1 !== pass2) {
    console.error('Las contraseñas no coinciden.');
    process.exit(1);
  }

  const hash = await argon2.hash(pass1, { type: argon2.argon2id });
  const users = loadUsers();
  const isUpdate = users.has(username);
  users.set(username, hash);
  saveUsers(users);

  console.log(`Usuario "${username}" ${isUpdate ? 'actualizado' : 'creado'} en ${USERS_FILE}`);
}

function cmdRemove(username) {
  if (!username) {
    console.error('Uso: node scripts/manage-users.js remove <usuario>');
    process.exit(1);
  }

  const users = loadUsers();
  if (!users.delete(username)) {
    console.error(`El usuario "${username}" no existe en ${USERS_FILE}`);
    process.exit(1);
  }
  saveUsers(users);
  console.log(`Usuario "${username}" eliminado.`);
}

function cmdList() {
  const users = loadUsers();
  if (users.size === 0) {
    console.log(`No hay usuarios configurados en ${USERS_FILE}`);
    return;
  }
  console.log([...users.keys()].join('\n'));
}

function printUsage() {
  console.log('Uso:');
  console.log('  node scripts/manage-users.js add <usuario>');
  console.log('  node scripts/manage-users.js remove <usuario>');
  console.log('  node scripts/manage-users.js list');
}

async function main() {
  const [, , cmd, arg] = process.argv;

  if (cmd === 'add') await cmdAdd(arg);
  else if (cmd === 'remove') cmdRemove(arg);
  else if (cmd === 'list') cmdList();
  else {
    printUsage();
    process.exit(cmd ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
