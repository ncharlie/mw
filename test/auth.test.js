import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadUsers, checkLogin, createSession, sessionUser } from '../server/auth.js';

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'monworld-')), 'users.json');
fs.writeFileSync(file, JSON.stringify([{ username: 'Tester', password: 'secret1' }]));
await loadUsers(file);

test('correct password logs in (username is case-insensitive)', async () => {
  assert.equal(await checkLogin('tester', 'secret1'), 'tester');
  assert.equal(await checkLogin('TESTER', 'secret1'), 'tester');
});

test('wrong password, unknown user and junk input are rejected', async () => {
  assert.equal(await checkLogin('tester', 'nope'), null);
  assert.equal(await checkLogin('nobody', 'secret1'), null);
  assert.equal(await checkLogin(undefined, undefined), null);
  assert.equal(await checkLogin({}, 5), null);
});

test('sessions map tokens to usernames', () => {
  const token = createSession('tester');
  assert.equal(sessionUser(token), 'tester');
  assert.equal(sessionUser('made-up'), undefined);
  assert.equal(sessionUser(undefined), undefined);
});
