import type { Entry, Id } from '../shapes/competition';
import type { Collision, Commitment, EventRequest } from '../shapes/draw';
import { panelOf } from './facts';

export type Holder = Collision['holders'][number];

/**
 * One person, one fixture per slot. Structural: no force, no override. A
 * member of an entry to be placed who is already in a fixed or committed
 * fixture, or in another entry of the call, is a collision; the engine does
 * not hand out a bye to dodge it.
 */
export const slotCollisions = (
  placed: readonly { readonly event: Id; readonly entries: readonly Entry[] }[],
  commitments: readonly Commitment[],
): Collision[] => {
  const holders = new Map<Id, Holder[]>();
  const hold = (person: Id, holder: Holder) =>
    holders.set(person, [...(holders.get(person) ?? []), holder]);
  for (const { event, entries } of placed)
    for (const entry of entries)
      for (const person of new Set(entry.members))
        hold(person, { kind: 'entry', event, entry: entry.id });
  for (const commitment of commitments)
    for (const person of new Set(commitment.people))
      hold(person, {
        kind: 'commitment',
        event: commitment.event,
        fixture: commitment.fixture,
      });
  return [...holders]
    .filter(([, held]) => held.length > 1)
    .map(([person, held]) => ({ person, holders: held }))
    .sort((a, b) => (a.person < b.person ? -1 : 1));
};

/** Judges already seated on fixtures the call keeps: they are taken in the slot. */
export const seatedJudges = (requests: readonly EventRequest[]) =>
  new Set(
    requests.flatMap((r) => r.existing.flatMap((f) => panelOf(f.fixture))),
  );
