import { compareBytes, shuffleWith } from '@daisy/seeded-random';
import type { Id } from '../shapes/competition';
import type { EventFacts } from './facts';
import { eventStream } from './placement';

/** Entries by pairing strength, strongest first. */
export const byStrength = (facts: EventFacts, entries: readonly Id[]) =>
  [...entries].sort((a, b) => (facts.strength.get(a) ?? 0) - (facts.strength.get(b) ?? 0));

/** Entries by strength, weakest first. */
export const weakestFirst = (facts: EventFacts, entries: readonly Id[]) =>
  byStrength(facts, entries).reverse();

/**
 * Who takes the byes when a field does not divide: by `bye.recipient` (the
 * lowest, or a seeded lot), never one who has had a bye while `bye.repeat`
 * is a rule and another can take it.
 */
export const byeTakers = (
  facts: EventFacts,
  seed: Uint8Array,
  entries: readonly Id[],
  count: number,
): Id[] => {
  if (count === 0) return [];
  const ordered =
    facts.settings['bye.recipient'].value === 'lowest'
      ? weakestFirst(facts, entries)
      : shuffleWith([...entries].sort(compareBytes), eventStream(seed, facts.event, 'bye'));
  const repeatForce = facts.settings['bye.repeat'].force;
  const fresh = (e: Id) => (facts.byes.get(e) ?? 0) === 0;
  const ranked =
    repeatForce === 'rule' || repeatForce === 'preference'
      ? [...ordered.filter(fresh), ...ordered.filter((e) => !fresh(e))]
      : ordered;
  return ranked.slice(0, count);
};
