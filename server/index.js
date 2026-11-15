// Entry point: `npm start` -> http://localhost:3000

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { loadUsers, checkLogin, createSession, sessionUser } from './auth.js';
import * as store from './store.js';
import { attachGame } from './game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const require = createRequire(import.meta.url);

const userCount = await loadUsers(path.join(ROOT, 'server', 'users.json'));
store.load(path.join(ROOT, 'data', 'save.json'));

const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
// Phaser is served from the local npm copy, not a CDN.
app.get('/vendor/phaser.min.js', (_req, res) => res.sendFile(require.resolve('phaser/dist/phaser.min.js')));

// POST /login { username, password } -> 200 { token, username } | 401 { error }
app.post('/login', async (req, res) => {
  const username = await checkLogin(req.body?.username, req.body?.password);
  if (!username) return res.status(401).json({ error: 'Wrong username or password.' });
  res.json({ token: createSession(username), username });
});

const server = http.createServer(app);
const io = new Server(server);

// Every socket must carry a valid session token from /login.
io.use((socket, next) => {
  const username = sessionUser(socket.handshake.auth?.token);
  if (!username) return next(new Error('unauthorized'));
  socket.data.username = username;
  next();
});

attachGame(io);

server.listen(PORT, () => {
  console.log(`MonWorld running at http://localhost:${PORT} (${userCount} accounts loaded)`);
});

function shutdown() {
  store.flush();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
