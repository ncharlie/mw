// Battle Lab: a dev page (/lab.html) for trying the battle module and tuning numbers.

import { SPECIES, SPECIES_IDS, PARTY_SIZE, rollMon, randomSpecies } from '/shared/mons.js';
import { simulateMatch, fight } from '/shared/battle.js';
import { createRng } from '/shared/rng.js';
import { PVP_TEAM_SIZE, PVP_MAX_TURNS } from '/shared/rules.js';
import { monImage } from './monArt.js';

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const randomSeed = () => Math.floor(Math.random() * 1_000_000);
const name = (/** @type {import('/shared/mons.js').SpeciesId} */ s) => SPECIES[s].name;

/** Build an element: el('td', { className: 'x' }, child, 'text', ...) */
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// ---------------------------------------------------------------- species table

function renderSpecies() {
  const table = $('species');
  table.append(el('tr', {},
    el('th', { className: 'left' }, 'Species'), el('th', {}, 'HP'), el('th', {}, 'ATK'),
    el('th', {}, 'DEF'), el('th', {}, 'SPD'), el('th', { className: 'left' }, 'Strong against')));
  for (const id of SPECIES_IDS) {
    const s = SPECIES[id];
    table.append(el('tr', {},
      el('td', { className: 'left' }, monImage(id, 64), ` ${s.name}`),
      el('td', {}, String(s.hp)), el('td', {}, String(s.atk)), el('td', {}, String(s.def)), el('td', {}, String(s.spd)),
      el('td', { className: 'left' }, monImage(s.strongAgainst, 32), ` ${name(s.strongAgainst)}`)));
  }
}

// ---------------------------------------------------------------- match simulator

const teamSize = /** @type {HTMLSelectElement} */ ($('team-size'));
const teamSeed = /** @type {HTMLInputElement} */ ($('team-seed'));
const fightSeed = /** @type {HTMLInputElement} */ ($('fight-seed'));

for (let n = 1; n <= PARTY_SIZE; n++) teamSize.append(el('option', { value: String(n), textContent: String(n) }));
teamSize.value = String(PVP_TEAM_SIZE); // real matches are always this size
teamSeed.value = String(randomSeed());
fightSeed.value = String(randomSeed());

/** Two random teams from the team seed (random species, rolled stats). */
function makeTeams() {
  const rng = createRng(Number(teamSeed.value));
  const size = Number(teamSize.value);
  const team = (prefix) =>
    Array.from({ length: size }, (_, i) => rollMon(randomSpecies(rng), rng, `${prefix}${i + 1}`));
  return { a: team('A'), b: team('B') };
}

/** @param {import('/shared/mons.js').Mon} mon @param {boolean} faceLeft */
function monCard(mon, faceLeft) {
  return el('div', { className: 'mon-card' },
    monImage(mon.species, 40, faceLeft),
    el('span', {}, el('b', {}, name(mon.species)),
      ` HP ${mon.maxHp} · ATK ${mon.atk} · DEF ${mon.def} · SPD ${mon.spd}`));
}

function renderMatch() {
  const teams = makeTeams();
  $('team-a').replaceChildren(...teams.a.map((m) => monCard(m, false)));
  $('team-b').replaceChildren(...teams.b.map((m) => monCard(m, true)));

  const match = simulateMatch(teams.a, teams.b, Number(fightSeed.value), PVP_MAX_TURNS);
  const verdict = match.winner === 'draw' ? 'Draw' : `Team ${match.winner.toUpperCase()} wins`;
  const out = [el('div', { className: 'score' }, `A ${match.score.a} – ${match.score.b} B · ${verdict}`)];

  match.pairs.forEach((pair, i) => {
    const label = (side) => el('span', { className: `s${side}` }, `${name(pair[side].species)} (${side.toUpperCase()})`);
    const log = el('ol', { className: 'log' });
    pair.rounds.forEach((events, r) => {
      const line = el('li', {}, `R${r + 1}: `);
      for (const e of events) {
        if (e.type === 'attack') {
          const target = e.by === 'a' ? 'b' : 'a';
          line.append(label(e.by), ` hits for ${e.damage}`);
          if (e.strong) line.append(' ', el('span', { className: 'strong' }, 'strong!'));
          line.append(` → ${e.hp}/${pair[target].maxHp}. `);
        } else {
          line.append(label(e.side), ' faints.');
        }
      }
      log.append(line);
    });
    out.push(el('details', { open: i === 0 },
      el('summary', {}, `Pair ${i + 1}: `, label('a'), ' vs ', label('b'),
        ` — ${pair.rounds.length} rounds (replay: ${pair.turns.length} turns), winner `, label(pair.winner)),
      log));
  });
  $('result').replaceChildren(...out);
}

teamSize.addEventListener('change', renderMatch);
teamSeed.addEventListener('change', renderMatch);
fightSeed.addEventListener('change', renderMatch);
$('new-teams').addEventListener('click', () => {
  teamSeed.value = String(randomSeed());
  renderMatch();
});
$('new-fight').addEventListener('click', () => {
  fightSeed.value = String(randomSeed());
  renderMatch();
});

// ---------------------------------------------------------------- balance

function renderBalance() {
  const count = Math.min(20000, Math.max(10, Number(($('balance-count')).value) || 1000));
  const rng = createRng(12345);
  const table = $('balance');
  table.replaceChildren(el('tr', {}, el('th', { className: 'left' }, 'Row vs column'),
    ...SPECIES_IDS.map((id) => el('th', {}, monImage(id, 32, true)))));
  for (const a of SPECIES_IDS) {
    const row = el('tr', {}, el('td', { className: 'left' }, monImage(a, 32), ` ${name(a)}`));
    for (const b of SPECIES_IDS) {
      let wins = 0;
      for (let i = 0; i < count; i++) {
        if (fight(rollMon(a, rng), rollMon(b, rng), rng).winner === 'a') wins++;
      }
      const pct = Math.round((100 * wins) / count);
      // green when the row side wins most, red when it loses most
      const hue = Math.round((pct / 100) * 120);
      row.append(el('td', { className: 'heat', style: `background: hsl(${hue} 60% 85%)` }, `${pct}%`));
    }
    table.append(row);
  }
}

$('run-balance').addEventListener('click', renderBalance);

renderSpecies();
renderMatch();
renderBalance();
