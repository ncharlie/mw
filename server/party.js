// Party and storage rules. Pure functions so they are easy to test.

import { PARTY_SIZE } from '../shared/mons.js';

/**
 * Rearrange a player's Mons. The client sends the ids it wants in the party,
 * in order; every other Mon goes to (or stays in) storage. This one operation
 * covers reordering, swapping with storage, storing and taking out.
 *
 * @param {{ party: import('../shared/mons.js').Mon[], storage: import('../shared/mons.js').Mon[] }} p
 * @param {unknown} partyIds
 * @returns {string | null} an error message, or null if it worked (p is updated)
 */
export function arrangeParty(p, partyIds) {
  if (!Array.isArray(partyIds) || partyIds.length < 1 || partyIds.length > PARTY_SIZE) {
    return `The party needs 1 to ${PARTY_SIZE} Mons.`;
  }
  if (new Set(partyIds).size !== partyIds.length) return 'A Mon can only be in the party once.';
  const all = [...p.party, ...p.storage];
  const byId = new Map(all.map((m) => [m.id, m]));
  const party = partyIds.map((id) => byId.get(id));
  if (party.some((m) => !m)) return 'That Mon is not yours.';
  const chosen = new Set(partyIds);
  // Keep storage order; Mons that just left the party go to the end.
  const storage = [
    ...p.storage.filter((m) => !chosen.has(m.id)),
    ...p.party.filter((m) => !chosen.has(m.id)),
  ];
  p.party = /** @type {import('../shared/mons.js').Mon[]} */ (party);
  p.storage = storage;
  return null;
}

/** Fully heal every Mon in the party. @param {{ party: import('../shared/mons.js').Mon[] }} p */
export function healParty(p) {
  for (const m of p.party) m.hp = m.maxHp;
}
