// Real-time game logic. The server is authoritative: clients send inputs
// ("I step left to x,y", "throw a shackle"), the server checks them and tells
// clients the result.

import crypto from 'node:crypto';
import * as store from './store.js';
import { WildBattle } from './wild.js';
import { Pvp } from './pvp.js';
import { arrangeParty, healParty } from './party.js';
import {
  getWorld, isWalkable, isDir, tileInFront, buildingWithDoorAt, tileAt, isInTown,
  SPAWN, DIRS, STEP_MS, BOT_NPC, BUILDINGS, T,
} from '../shared/world.js';
import { isSpecies, rollMon, SPECIES } from '../shared/mons.js';
import {
  STARTER_COINS, STARTER_SHACKLES, SHACKLE_PRICE, MAX_BUY, ENCOUNTER_CHANCE,
} from '../shared/rules.js';

/** How many steps a client may send in a quick burst (absorbs network jitter). */
const MOVE_BURST = 3;
const INTERACT_COOLDOWN_MS = 250;

const HOSPITAL = /** @type {import('../shared/world.js').Building} */ (BUILDINGS.find((b) => b.kind === 'hospital'));
const SHOP = /** @type {import('../shared/world.js').Building} */ (BUILDINGS.find((b) => b.kind === 'shop'));

/**
 * @typedef {object} Online
 * @property {string} name
 * @property {import('socket.io').Socket} socket
 * @property {import('./store.js').PlayerRecord} p
 * @property {number} moveTokens
 * @property {number} refillAt
 * @property {number} lastInteract
 * @property {WildBattle | null} battle
 * @property {import('./pvp.js').Challenge | null} challenge
 * @property {any} match a PvP or bot match (see pvp.js)
 */

/** Reply to a Socket.IO acknowledgement callback, if the client sent one. */
const reply = (ack, response) => {
  if (typeof ack === 'function') ack(response);
};

/** Fill in fields added after a save file was written. @param {any} p */
function upgradeRecord(p) {
  p.wins ??= 0;
  p.coins ??= 0;
  p.shackles ??= 0;
  p.party ??= [];
  p.storage ??= [];
  return /** @type {import('./store.js').PlayerRecord} */ (p);
}

/** @param {import('socket.io').Server} io */
export function attachGame(io) {
  const world = getWorld();
  /** @type {Map<string, Online>} */
  const online = new Map();

  const pvp = new Pvp({
    save: () => store.save(),
    onWins: (pl) => io.emit('wins', { name: pl.name, wins: pl.p.wins }),
  });

  /** What other players are allowed to know about someone. @param {Online} o */
  const publicView = (o) => ({ name: o.name, x: o.p.x, y: o.p.y, dir: o.p.dir, wins: o.p.wins });
  /** What only the player themself sees. @param {Online} o */
  const privateView = (o) => ({ coins: o.p.coins, shackles: o.p.shackles, party: o.p.party, storage: o.p.storage });

  io.on('connection', (socket) => {
    const name = socket.data.username;

    // One connection per account: a new login replaces the old tab.
    const old = online.get(name);
    if (old) {
      old.battle?.stop();
      pvp.leave(old);
      old.socket.emit('kicked', { reason: 'You logged in somewhere else.' });
      old.socket.disconnect(true);
    }

    let p = store.getPlayer(name);
    if (!p) {
      p = upgradeRecord({ x: SPAWN.x, y: SPAWN.y, dir: SPAWN.dir });
      store.setPlayer(name, p);
    }
    upgradeRecord(p);
    if (!isWalkable(world, p.x, p.y)) Object.assign(p, { x: SPAWN.x, y: SPAWN.y });

    /** @type {Online} */
    const me = {
      name, socket, p, moveTokens: MOVE_BURST, refillAt: Date.now(), lastInteract: 0,
      battle: null, challenge: null, match: null,
    };
    online.set(name, me);

    const sendSelf = () => socket.emit('self', privateView(me));
    const correct = () => socket.emit('correct', { x: p.x, y: p.y, dir: p.dir });
    /** In a battle, a match, a pending challenge, or still without a starter. */
    const busy = () => !Pvp.isFree(me);

    socket.emit('welcome', {
      you: publicView(me),
      self: privateView(me),
      players: [...online.values()].filter((o) => o !== me).map(publicView),
    });
    socket.broadcast.emit('playerJoined', publicView(me));

    // ------------------------------------------------------------ starter

    // { species } -> ack { ok, error? }. Only while the player has no Mons at all.
    socket.on('chooseStarter', (msg, ack) => {
      if (p.party.length > 0 || p.storage.length > 0) return reply(ack, { ok: false, error: 'You already have a Mon.' });
      if (!isSpecies(msg?.species)) return reply(ack, { ok: false, error: 'Unknown species.' });
      p.party.push(rollMon(msg.species, Math.random, crypto.randomUUID()));
      p.coins += STARTER_COINS;
      p.shackles += STARTER_SHACKLES;
      store.save();
      sendSelf();
      reply(ack, { ok: true });
      socket.emit('message', {
        text: `${SPECIES[msg.species].name} joined you! You also got ${STARTER_SHACKLES} shackles and ${STARTER_COINS} coins.`,
      });
    });

    // ------------------------------------------------------------ movement

    // { dir, x, y }: step one tile in `dir`, which the client expects to land on (x, y).
    socket.on('move', (msg) => {
      if (!msg || !isDir(msg.dir)) return;
      const now = Date.now();
      me.moveTokens = Math.min(MOVE_BURST, me.moveTokens + (now - me.refillAt) / (STEP_MS * 0.8));
      me.refillAt = now;

      const nx = p.x + DIRS[msg.dir].dx;
      const ny = p.y + DIRS[msg.dir].dy;
      // Reject if busy, too fast, blocked, or the client thinks it is somewhere else.
      if (busy() || me.moveTokens < 1 || nx !== msg.x || ny !== msg.y || !isWalkable(world, nx, ny)) {
        correct();
        return;
      }
      me.moveTokens -= 1;
      p.x = nx;
      p.y = ny;
      p.dir = msg.dir;
      store.save();
      socket.broadcast.emit('playerMoved', publicView(me));

      if (tileAt(world, nx, ny) === T.TALL_GRASS && !isInTown(nx, ny)
        && WildBattle.canFight(p) && Math.random() < ENCOUNTER_CHANCE) {
        startWildBattle();
      }
    });

    // { dir }: turn on the spot.
    socket.on('face', (msg) => {
      if (!msg || !isDir(msg.dir) || msg.dir === p.dir || me.battle) return;
      p.dir = msg.dir;
      store.save();
      socket.broadcast.emit('playerMoved', publicView(me));
    });

    // ------------------------------------------------------------ wild battles

    function startWildBattle() {
      me.battle = new WildBattle(me, {
        newId: () => crypto.randomUUID(),
        sendSelf,
        save: () => store.save(),
        sendToHospital: () => {
          healParty(p);
          Object.assign(p, { x: HOSPITAL.front.x, y: HOSPITAL.front.y, dir: 'down' });
          correct();
          socket.broadcast.emit('playerMoved', publicView(me));
        },
        onEnd: () => {
          me.battle = null;
        },
      });
      me.battle.start();
    }

    socket.on('throwShackle', () => me.battle?.throwShackle());
    socket.on('run', () => me.battle?.run());

    // ------------------------------------------------------------ buildings and party

    // Interact with whatever is in front of the player.
    socket.on('interact', () => {
      const now = Date.now();
      if (busy() || now - me.lastInteract < INTERACT_COOLDOWN_MS) return;
      me.lastInteract = now;

      const front = tileInFront(p.x, p.y, p.dir);
      const building = buildingWithDoorAt(front.x, front.y);
      if (building?.kind === 'house') {
        socket.emit('message', { text: 'Nobody is home.' });
      } else if (building?.kind === 'hospital') {
        healParty(p);
        store.save();
        sendSelf();
        socket.emit('message', { text: 'Your Mons are fully healed. Take care out there!' });
      } else if (building?.kind === 'shop') {
        socket.emit('openShop', { price: SHACKLE_PRICE });
      } else if (front.x === BOT_NPC.x && front.y === BOT_NPC.y) {
        pvp.challengeBot(me);
      } else {
        // Another player standing right in front: challenge them (a free one, if several).
        const there = [...online.values()].filter((o) => o !== me && o.p.x === front.x && o.p.y === front.y);
        const target = there.find((o) => Pvp.isFree(o)) ?? there[0];
        if (target) pvp.challenge(me, target);
      }
    });

    // ------------------------------------------------------------ PvP

    // { accept: boolean } from the challenged player.
    socket.on('challengeAnswer', (msg) => pvp.answer(me, msg?.accept === true));
    // The challenger takes the challenge back.
    socket.on('challengeWithdraw', () => pvp.withdraw(me));
    // { order: monId[], lock?: boolean } -> ack { ok, error? }
    socket.on('pvpOrder', (msg, ack) => {
      const error = pvp.setOrder(me, msg?.order, msg?.lock === true);
      reply(ack, error ? { ok: false, error } : { ok: true });
    });
    // The player closed the result screen and is back in the world.
    socket.on('pvpDone', () => pvp.done(me));

    // { qty } -> ack { ok, error? }. Must be standing at the shop door.
    socket.on('buy', (msg, ack) => {
      const qty = msg?.qty;
      if (p.x !== SHOP.front.x || p.y !== SHOP.front.y) return reply(ack, { ok: false, error: 'You are not at the shop.' });
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_BUY) return reply(ack, { ok: false, error: `Buy 1 to ${MAX_BUY}.` });
      const cost = qty * SHACKLE_PRICE;
      if (p.coins < cost) return reply(ack, { ok: false, error: 'Not enough coins.' });
      p.coins -= cost;
      p.shackles += qty;
      store.save();
      sendSelf();
      reply(ack, { ok: true });
    });

    // { party: [monId, ...] } -> ack { ok, error? }
    socket.on('setParty', (msg, ack) => {
      if (me.battle || me.match || me.challenge) return reply(ack, { ok: false, error: 'Not during a battle.' });
      const error = arrangeParty(p, msg?.party);
      if (error) return reply(ack, { ok: false, error });
      store.save();
      sendSelf();
      reply(ack, { ok: true });
    });

    // ------------------------------------------------------------ leaving

    socket.on('disconnect', () => {
      if (online.get(name) !== me) return; // already replaced by a newer login
      me.battle?.stop();
      pvp.leave(me);
      online.delete(name);
      io.emit('playerLeft', { name });
      store.save();
    });
  });
}
