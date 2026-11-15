// Accounts and sessions.
// Accounts come from server/users.json (no registration). Passwords are hashed
// with scrypt as soon as the file is loaded, so plain text is never kept in memory
// after startup. Sessions live in memory: restarting the server logs everyone out.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

const scrypt = /** @type {(pw: string, salt: Buffer, len: number) => Promise<Buffer>} */ (
  promisify(crypto.scrypt)
);
const KEY_LEN = 32;

/** @type {Map<string, {salt: Buffer, hash: Buffer}>} username -> hashed password */
const accounts = new Map();
/** @type {Map<string, string>} session token -> username */
const sessions = new Map();

/** Used for unknown usernames so a failed login takes as long as a wrong password. */
const dummy = { salt: crypto.randomBytes(16), hash: crypto.randomBytes(KEY_LEN) };

/**
 * Load and hash every account in the users file.
 * @param {string} file path to users.json: [{ "username": "...", "password": "..." }]
 */
export async function loadUsers(file) {
  const list = JSON.parse(await fs.readFile(file, 'utf8'));
  accounts.clear();
  for (const { username, password } of list) {
    const name = normalizeName(username);
    if (!name || typeof password !== 'string' || !password) {
      throw new Error(`Bad entry in ${file}: usernames are 1-16 letters, digits or _ and need a password`);
    }
    const salt = crypto.randomBytes(16);
    accounts.set(name, { salt, hash: await scrypt(password, salt, KEY_LEN) });
  }
  return accounts.size;
}

/**
 * Check a username and password. Returns the canonical username, or null.
 * @param {unknown} username
 * @param {unknown} password
 */
export async function checkLogin(username, password) {
  const name = normalizeName(username);
  const account = (name && accounts.get(name)) || dummy;
  const hash = await scrypt(typeof password === 'string' ? password : '', account.salt, KEY_LEN);
  const ok = crypto.timingSafeEqual(hash, account.hash) && account !== dummy;
  return ok ? name : null;
}

/** @param {string} username @returns {string} a new session token */
export function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, username);
  return token;
}

/** @param {unknown} token @returns {string | undefined} */
export function sessionUser(token) {
  return typeof token === 'string' ? sessions.get(token) : undefined;
}

/** Usernames are case-insensitive: "Alice" and "alice" are the same account. */
function normalizeName(username) {
  if (typeof username !== 'string') return null;
  const name = username.trim().toLowerCase();
  return /^[a-z0-9_]{1,16}$/.test(name) ? name : null;
}
