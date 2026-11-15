# MonWorld

A small 2D multiplayer monster-catching game that runs in the browser.
Top-down, tile-based, one shared open world. All art is placeholder pixel art
drawn in code, so the project has no image files.

**Status:** all 4 milestones of the v1 prototype are in: world, battle rules, starter, wild battles and capture, party, hospital, shop, PvP, bot, win counts.

## Setup

Needs Node.js 20 or newer.

```bash
npm install
npm start          # http://localhost:3100
npm test           # node --test
```

Set `PORT` to use a different port. No build step: the browser loads the
JavaScript files as they are.

### Sample accounts

| Username | Password  |
|----------|-----------|
| alice    | alice123  |
| bob      | bob123    |
| carol    | carol123  |
| dave     | dave123   |

### Adding users

There is no registration. Edit `server/users.json` and restart the server:

```json
[
  { "username": "alice", "password": "alice123" },
  { "username": "erin", "password": "pick-something" }
]
```

Usernames are 1-16 letters, digits or `_`, and are case-insensitive. Passwords
are hashed with `crypto.scrypt` when the file is loaded and are never stored in
the save file.

### Resetting progress

Stop the server and delete `data/save.json`.

## Project layout

```
server/
  index.js     express (static files, POST /login) + Socket.IO setup
  auth.js      accounts from users.json, scrypt hashing, in-memory sessions
  game.js      real-time game: joins, movement, encounters, buildings, menus
  wild.js      one player's wild battle: timed rounds, throws, run, rewards
  pvp.js       challenges, the ordering phase, PvP and bot matches, wins
  party.js     party / storage rearranging and healing
  store.js     persistence: one JSON file, debounced saves (swap for a DB later)
  users.json   the accounts
shared/        imported by both server and browser, served at /shared
  world.js     world size, tile types, town layout, seeded generation, walk checks
  mons.js      the five species and their stats, advantage, stat rolls
  battle.js    pure, seeded battle rules (rounds, fights, PvP matches)
  rules.js     economy and other tunables (prices, rewards, encounter rate)
  rng.js       seeded random numbers
public/        the client
  index.html   canvas + HTML overlays (login, HUD, message box, menus, battle buttons, touch controls)
  js/main.js   login -> socket -> Phaser game
  js/WorldScene.js   the world scene: tilemap, camera, players, input
  js/BattleBase.js   what both battle screens share: arena, HP boxes, attack/faint animations
  js/WildScene.js    the wild battle screen
  js/ReplayScene.js  PvP / bot match replay
  js/menus.js  starter choice, shop and party menus
  js/pvpMenus.js     challenge prompt, ordering screen, result screen
  js/art.js    world pixel art (tiles, buildings, characters)
  js/monArt.js Mon and shackle pixel art (plain canvas)
  js/ui.js     overlay helpers
  js/controls.js     keyboard + touch controls, A / B routing
  js/view.js   pixel density, touch detection, fullscreen
  lab.html     Battle Lab dev page (js/lab.js)
test/          node --test
data/save.json created on first run
```

Phaser is served from `node_modules` at `/vendor/phaser.min.js`; the Socket.IO
client is served by Socket.IO at `/socket.io/socket.io.js`.

## How it works

- **The world** is an 80 x 80 grid generated from a fixed seed in
  `shared/world.js`. The server and the browser both run the same generator,
  so the map is never sent over the network. Change `WORLD_W` / `WORLD_H` to
  enlarge it; the town stays centred. The town is the middle 30 x 30 tiles;
  everything else is wilderness.
- **Movement** is one tile per step. The client moves immediately (so it feels
  smooth) and sends the step. The server checks that the target tile is the
  next tile from where the server thinks the player is, that it is walkable, and
  that the player isn't stepping faster than allowed. If not, it sends
  `correct` and the client snaps back.
- **Controls** (all in `public/js/controls.js`). Keyboard and touch share
  one layout, modelled on a joystick plus two buttons:

  | | Keyboard | Touch |
  |---|---|---|
  | Move | WASD (arrow keys also work) | joystick: put your thumb anywhere on the left side |
  | A: talk, confirm, accept | Space | A button |
  | B: back, close, decline | Esc | B button |
  | Party | P (or the HUD button) | menu icon, top right |
  | Zoom | `-` / `+`, mouse wheel | pinch |

  A quick tap of a direction turns on the spot; holding walks. A and B go to
  whatever is in front: a message box, then a menu (A buys in the shop, accepts
  a challenge, locks in your lineup...), then a battle (wild: A throws a
  shackle, B runs; replay: A speeds up, B skips), then the world (A talks to
  what you face).
- **Zoom** is set by how many tiles fit across the screen: 20 (closest, the
  default) to 45 (furthest), so it means the same on any screen. Name labels
  are part of the map and shrink as you zoom out. Zoom is per viewer
  (remembered in localStorage) and doesn't affect the game. Limits:
  `MIN_TILES` / `MAX_TILES` in `public/js/WorldScene.js`.
- **Screen:** the canvas fills the window at device resolution (up to 2x);
  battle screens scale to fit above their buttons.
- **Phones and tablets:** touch controls appear automatically. Logging in (or
  the first tap) asks for fullscreen landscape; Android Chrome allows it, iPhone
  Safari doesn't, so in portrait a "turn your device sideways" screen shows
  instead. Adding the page to the home screen opens it fullscreen in landscape
  (`public/manifest.webmanifest`).
- **First login:** pick a starter from the five species; you also get 10
  shackles and 50 coins (`shared/rules.js`). Players from older saves without
  Mons get the same choice.
- **Buildings:** face a door and press A. Hospital: free full heal of the party.
  Shop: shackles for 10 coins each (you must be standing at the shop door to
  buy). Houses: nobody is home.
- **Wild battles:** each step onto tall grass outside town has a 10% chance to
  start one, if a party Mon can still fight. The server runs a round every
  0.8 s and the client plays them back as animations. **Throw Shackle** uses
  one shackle; the chance is 100% minus the wild Mon's remaining HP percent,
  and the server rolls it. A caught Mon keeps its current HP and joins the
  party, or storage if the party has 5. Knocking the wild Mon out pays 5 coins
  and it can't be caught. If your Mon faints the next one comes in; if all
  faint you are healed and moved to the hospital door. **Run** always works.
  HP damage stays until you heal.
- **Party:** up to 5 Mons in order (slot 1 leads) plus unlimited storage. In
  the menu, click two Mons to swap them, or use Store / To party.
- **PvP:** stand next to another player, face them and press A. They get 20 s
  to accept or decline (the challenger can cancel). Both players need at least
  3 Mons in their party (`PVP_TEAM_SIZE` in `shared/rules.js`). Nobody busy (in
  a wild battle, a match or a pending challenge) can be challenged.
  - **Ordering:** every match is exactly 3 pairs. Each player sees the
    opponent's party species (sorted, so not their order) and picks 3 of their
    own party Mons and their order. 30 s timer; "Lock in" ends it early once
    both are locked. When time runs out, whatever is picked locks, topped up
    from the party in party order.
  - **Match:** the server simulates the whole match at once with
    `simulateMatch` (slot 1 vs slot 1, then slot 2 vs slot 2..., every Mon at
    full HP, wild damage ignored and untouched). The winner's `wins` goes up by
    1. With 3 pairs there are no draws. Both clients get the same event log and
    play it as a replay with a running pair score (Speed x3 and Skip only change
    your own view), then a result screen. Players stay busy until they close it.
  - **Fast replays:** each pair is shown in at most 3 turns (`PVP_MAX_TURNS`).
    A long fight, like Fish vs Fish, has its rounds grouped: in each turn each
    Mon makes one attack with its damage in those rounds summed ("attacks 6
    times!"). Nothing about the result changes; it's only how it is shown.
    Each pair, from entering to leaving, plays in under 5 seconds.
  - Leaving during the ordering phase cancels the match for both, no wins.
- **Bot:** face the bot in town and press A. It always accepts, with 3 fresh
  random Mons in random order, and uses the same ordering screen, battle code
  and replay. You need 3 Mons in your party for it too. Beating it counts as a
  win.
- **Sessions** live in server memory. Restarting the server logs everyone out.
  Each browser tab keeps its own token (sessionStorage), so two tabs can be two
  players. Logging into the same account again kicks the older tab.

## Mons and battles

Species live in `shared/mons.js`; change the numbers there to tune.

| Species | HP  | ATK | DEF | SPD | Strong against |
|---------|-----|-----|-----|-----|----------------|
| Cat     | 90  | 14  | 8   | 12  | Bird           |
| Bird    | 70  | 16  | 5   | 15  | Snake          |
| Snake   | 80  | 13  | 7   | 11  | Frog           |
| Frog    | 100 | 12  | 9   | 9   | Fish           |
| Fish    | 120 | 10  | 12  | 6   | Cat            |

- Every Mon rolls each stat +/-10% (rounded) when it spawns and keeps it forever.
  A Mon is `{ id, species, maxHp, hp, atk, def, spd }`.
- `shared/battle.js` is pure and deterministic: same Mons + same seed = same
  battle, on the server or in the browser.
  - `playRound(a, b, rng)`: both attack once, higher SPD first (RNG breaks ties).
    A Mon at 0 HP faints at once and doesn't attack. Used round by round for
    wild battles.
  - `fight(a, b, rng)`: rounds until one faints.
  - `simulateMatch(teamA, teamB, seed, maxTurns)`: PvP/bot match. Slot 1 vs
    slot 1, and so on, for the shorter team's length (always 3 in the game);
    every Mon starts at full HP; more pair wins wins, equal is a draw. Each pair
    has the full log (`rounds`) and the replay version (`turns`).
  - `compressRounds(rounds, maxTurns)`: groups a long fight into at most
    `maxTurns` turns, summing each Mon's damage per turn (`hits` = attacks summed).
- Damage = `max(1, round((ATK * advantage - DEF / 2) * random(0.9..1.1)))`,
  advantage 1.5 when strong against the target.

Battle events (also the replay format):

```js
{ type: 'attack', by: 'a' | 'b', damage, strong /* advantage applied */, hp /* target HP after */, hits? /* turns only */ }
{ type: 'faint', side: 'a' | 'b' }
```

### Battle Lab

Open http://localhost:3100/lab.html for a dev page that shows the species,
simulates seeded matches between random teams with a round-by-round log, and
prints a win-rate table for every species matchup. Handy after changing numbers.

## Message protocol

### HTTP

| Request | Body | Response |
|---------|------|----------|
| `POST /login` | `{ username, password }` | `200 { token, username }` or `401 { error }` |

### Socket.IO

Connect with `io({ auth: { token } })`. A missing or unknown token fails the
connection with the error message `unauthorized`.

`Player` below means `{ name, x, y, dir, wins }`, where `dir` is
`"up" | "down" | "left" | "right"`.

**Client to server**

| Event | Payload | Meaning |
|-------|---------|---------|
| `move` | `{ dir, x, y }` | Step one tile in `dir`, expecting to land on `(x, y)`. Refused during a battle or before picking a starter. |
| `face` | `{ dir }` | Turn on the spot. |
| `interact` | none | Use whatever is in the tile the player faces. |
| `chooseStarter` | `{ species }`, ack | Only while the player has no Mons. |
| `buy` | `{ qty }`, ack | Buy shackles; must be at the shop door. |
| `setParty` | `{ party: monId[] }`, ack | The new party, in order (1-5 ids from party or storage). Every other Mon goes to storage. Covers reorder, swap, store and take out. |
| `throwShackle` | none | During a wild battle. |
| `run` | none | During a wild battle. |
| `challengeAnswer` | `{ accept }` | Answer a challenge you received. |
| `challengeWithdraw` | none | Take back a challenge you sent. |
| `pvpOrder` | `{ order: monId[], lock? }`, ack | Your lineup so far (up to `pairs` ids, fight order). With `lock: true` it must have exactly `pairs` and can't change after. |
| `pvpDone` | none | You closed the result screen; you're free again. |

Challenging the bot or another player uses `interact` while facing them.

"ack" means the client passes a Socket.IO acknowledgement callback and gets
`{ ok: true }` or `{ ok: false, error }`. Changes to coins, shackles or Mons
also arrive as a `self` event.

**Server to client**

| Event | Payload | Meaning |
|-------|---------|---------|
| `welcome` | `{ you: Player, self: Self, players: Player[] }` | Sent after every (re)connect with the full state. An empty `self.party` means: show the starter choice. |
| `self` | `Self` | Your coins, shackles or Mons changed. |
| `playerJoined` | `Player` | Someone came online (replaces any old copy of them). |
| `playerLeft` | `{ name }` | Someone went offline. |
| `playerMoved` | `Player` | Another player stepped or turned. |
| `correct` | `{ x, y, dir }` | Your last step was rejected; this is your real position. |
| `message` | `{ text }` | Show a message box. |
| `kicked` | `{ reason }` | This tab was replaced by a newer login. |
| `openShop` | `{ price }` | You used the shop door. |
| `wildStart` | `{ wild: Mon, active, party: Mon[], shackles }` | A wild battle begins. `active` is the party index of your Mon in the field. |
| `wildRound` | `{ events: BattleEvent[], hp: { a, b }, active }` | One round. `a` is your Mon, `b` the wild one. If `active` changed, that party Mon comes in next. |
| `wildThrow` | `{ success, chance, shackles }` | Result of a shackle throw (`chance` is 0..1). |
| `wildEnd` | `{ result, coins?, to? }` | `result` is `won` (with `coins`), `caught` (with `to`: `party` or `storage`), `ran` or `lost` (you are healed and moved to the hospital; a `correct` with the new position comes too). |
| `wins` | `{ name, wins }` | Someone's win count changed (sent to everyone). |
| `challengeSent` | `{ to, seconds }` | Your challenge is waiting for an answer. |
| `challenge` | `{ from, seconds }` | Someone challenged you. |
| `challengeClosed` | `{ text }` | The challenge is over without a match (declined, timed out, cancelled, someone left). `text` may be null. |
| `pvpOrder` | `{ opponent, bot, opponentSpecies, party: Mon[], pairs, order, seconds }` | Pick your lineup. `order` is the default (your first `pairs` party Mons). |
| `pvpLocked` | `{ who: 'opponent' }` | The opponent locked in. |
| `pvpCancelled` | `{ text }` | The match was called off before it started. |
| `pvpResult` | `MatchResult & { you, names: { a, b }, bot, wins }` | The whole match. `you` says which side (`a`/`b`) you are; `wins` is your new total. The replay plays each pair's `turns`. |

`MatchResult` is what `simulateMatch` returns: `{ seed, pairs: [{ a: Mon, b: Mon,
rounds: BattleEvent[][], turns: BattleEvent[][], winner }], score: { a, b },
winner: 'a' | 'b' | 'draw' }`.

`Self` is `{ coins, shackles, party: Mon[], storage: Mon[] }`. Only the player
themself receives it; other players never see a wild battle.

## Milestones

1. **Done:** server, login, world, movement, scrolling camera, other players.
2. **Done:** Mon data, the battle module.
3. **Done:** starter choice, wild encounters, capture, party menu, hospital, shop.
4. **Done:** PvP challenge, ordering screen, replay, bot NPC, win counts.
