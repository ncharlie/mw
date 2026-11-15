import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateWorld, getWorld, tileAt, isWalkable, isInTown, tileInFront, buildingWithDoorAt,
  T, TOWN, SPAWN, BUILDINGS, BOT_NPC, WORLD_W, WORLD_H, DIRS,
} from '../shared/world.js';

test('the same seed always builds the same world', () => {
  assert.deepEqual(generateWorld().tiles, generateWorld().tiles);
});

test('world has the configured size', () => {
  const world = getWorld();
  assert.equal(world.w, WORLD_W);
  assert.equal(world.h, WORLD_H);
  assert.equal(world.tiles.length, WORLD_W * WORLD_H);
});

test('outer edge is impassable trees', () => {
  const world = getWorld();
  for (let i = 0; i < WORLD_W; i++) {
    assert.equal(tileAt(world, i, 0), T.TREE);
    assert.equal(tileAt(world, i, WORLD_H - 1), T.TREE);
  }
  for (let i = 0; i < WORLD_H; i++) {
    assert.equal(tileAt(world, 0, i), T.TREE);
    assert.equal(tileAt(world, WORLD_W - 1, i), T.TREE);
  }
  assert.equal(isWalkable(world, -1, 5), false);
});

test('town is the central 30 x 30 and has no tall grass', () => {
  const world = getWorld();
  assert.equal(TOWN.w, 30);
  assert.equal(TOWN.x, (WORLD_W - 30) / 2);
  for (let y = TOWN.y; y < TOWN.y + TOWN.h; y++) {
    for (let x = TOWN.x; x < TOWN.x + TOWN.w; x++) {
      assert.notEqual(tileAt(world, x, y), T.TALL_GRASS, `tall grass in town at ${x},${y}`);
    }
  }
});

test('wilderness is mostly tall grass', () => {
  const world = getWorld();
  let wild = 0;
  let grass = 0;
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      if (isInTown(x, y)) continue;
      wild++;
      if (tileAt(world, x, y) === T.TALL_GRASS) grass++;
    }
  }
  assert.ok(grass / wild > 0.5, `only ${Math.round((100 * grass) / wild)}% tall grass`);
});

test('town has 3 houses, 1 hospital and 1 shop, each with a reachable door', () => {
  const world = getWorld();
  const kinds = BUILDINGS.map((b) => b.kind).sort();
  assert.deepEqual(kinds, ['hospital', 'house', 'house', 'house', 'shop']);
  for (const b of BUILDINGS) {
    assert.ok(isInTown(b.x, b.y) && isInTown(b.x + b.w - 1, b.y + b.h - 1), `${b.id} outside town`);
    assert.equal(isWalkable(world, b.door.x, b.door.y), false, 'buildings are solid');
    assert.ok(isWalkable(world, b.front.x, b.front.y), `${b.id} door is blocked`);
    const looking = tileInFront(b.front.x, b.front.y, 'up');
    assert.equal(buildingWithDoorAt(looking.x, looking.y), b);
  }
});

test('spawn is walkable, the bot blocks its tile', () => {
  const world = getWorld();
  assert.ok(isWalkable(world, SPAWN.x, SPAWN.y));
  assert.ok(isInTown(BOT_NPC.x, BOT_NPC.y));
  assert.equal(isWalkable(world, BOT_NPC.x, BOT_NPC.y), false);
});

test('every walkable tile can be reached from the spawn point', () => {
  const world = getWorld();
  const seen = new Set([`${SPAWN.x},${SPAWN.y}`]);
  const queue = [[SPAWN.x, SPAWN.y]];
  while (queue.length) {
    const [x, y] = /** @type {number[]} */ (queue.pop());
    for (const { dx, dy } of Object.values(DIRS)) {
      const key = `${x + dx},${y + dy}`;
      if (!seen.has(key) && isWalkable(world, x + dx, y + dy)) {
        seen.add(key);
        queue.push([x + dx, y + dy]);
      }
    }
  }
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      if (isWalkable(world, x, y)) assert.ok(seen.has(`${x},${y}`), `${x},${y} is unreachable`);
    }
  }
});
