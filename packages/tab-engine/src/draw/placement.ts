import {
  canonicalOrder,
  utf8,
  wordStream,
  type WordStream,
} from '@daisy/seeded-random';
import type { Fixture, Id } from '../shapes/competition';
import type { EventRequest } from '../shapes/draw';
import type { PairingForceKey } from '../shapes/settings';
import { forceOf, pairingKeys, pairingTerms } from '../settings/registry';
import type { EventFacts } from './facts';

/** One event's entries placed: kept, added and withdrawn, before judges. */
export type Placed = {
  readonly kept: readonly { readonly id: Id; readonly fixture: Fixture }[];
  readonly added: readonly Fixture[];
  readonly withdrawn: readonly Id[];
};

export type PlacementAnswer =
  | { readonly kind: 'placed'; readonly placed: Placed }
  | { readonly kind: 'infeasible' }
  | { readonly kind: 'unresolved'; readonly placed: Placed }
  | {
      readonly kind: 'structure';
      readonly fact: 'missing_result' | 'no_plan';
      readonly fixture: Id | null;
    };

/** The seeded streams of one event: adding a choice in one place shifts no other. */
export const eventStream = (
  seed: Uint8Array,
  event: Id,
  purpose: string,
): WordStream =>
  wordStream(`daisy-tab-v1/${event}/${purpose}`, seed, new Uint8Array());

/** A word for one named thing, e.g. one candidate pair. */
export const wordFor = (
  seed: Uint8Array,
  event: Id,
  purpose: string,
  thing: string,
) => wordStream(`daisy-tab-v1/${event}/${purpose}`, seed, utf8(thing))(0);

/** The pool a request places: active entries not already in a fixed fixture. */
export const poolOf = (
  request: EventRequest,
  entriesOfFixture: (f: Fixture) => readonly Id[],
) => {
  const fixed = new Set(
    request.existing
      .filter((f) => f.hold === 'fixed')
      .flatMap((f) => entriesOfFixture(f.fixture as Fixture)),
  );
  return canonicalOrder(
    request.entries.filter((e) => e.status === 'active' && !fixed.has(e.id)),
  ).map((e) => e.id);
};

/** The rule keys a fixture breaks under the event's settings. */
export const brokenRules = (
  facts: EventFacts,
  fixture: Fixture,
): PairingForceKey[] =>
  pairingKeys.filter(
    (key) =>
      forceOf(facts.settings, key) === 'rule' &&
      (pairingTerms[key](facts, fixture) ?? []).some((cost) => cost > 0),
  );

const widthOf = (key: PairingForceKey) => (key === 'pairing.pull_up' ? 2 : 1);

/** The preference keys in the order they are weighed. */
const weighedKeys = (facts: EventFacts): PairingForceKey[] => {
  const order = facts.settings['pairing.preference_order'].order;
  const listed = [
    ...order,
    ...pairingKeys.filter((key) => !order.includes(key)),
  ];
  return listed.filter((key) => forceOf(facts.settings, key) === 'preference');
};

/**
 * A fixture's preference fields, highest first. Who takes the bye is
 * decided before every other preference except `bye.repeat` (the lowest, or
 * a lot, among those who have not had one), as Swiss rules give it; then each
 * weighed key's term in `pairing.preference_order`; then the record distance
 * when pull-ups are only reported, since a powered round is still paired by
 * record.
 */
export const preferenceFields = (
  facts: EventFacts,
  fixture: Fixture,
  byeCost: readonly number[] | null,
): number[] => {
  const weighed = weighedKeys(facts);
  const term = (key: PairingForceKey) => {
    const cost = pairingTerms[key](facts, fixture);
    return cost === null
      ? Array.from({ length: widthOf(key) }, () => 0)
      : [...cost];
  };
  const fields = [
    ...(weighed.includes('bye.repeat') ? term('bye.repeat') : []),
    byeCost?.[0] ?? 0,
    ...weighed.filter((key) => key !== 'bye.repeat').flatMap(term),
  ];
  if (facts.powered && forceOf(facts.settings, 'pairing.pull_up') === 'warning')
    fields.push(pairingTerms['pairing.pull_up'](facts, fixture)?.[0] ?? 0);
  return fields;
};

/** Kept, added and withdrawn, from the movable fixtures a method keeps. */
export const placedFrom = (
  request: EventRequest,
  keptMovable: readonly { readonly id: Id }[],
  added: readonly Fixture[],
): Placed => {
  const keeps = new Set(keptMovable.map((f) => f.id));
  return {
    kept: request.existing
      .filter((f) => f.hold === 'fixed' || keeps.has(f.id))
      .map((f) => ({ id: f.id, fixture: f.fixture as Fixture })),
    added,
    withdrawn: request.existing
      .filter((f) => f.hold === 'movable' && !keeps.has(f.id))
      .map((f) => f.id),
  };
};

/** A heuristic method's answer: placed, or unresolved when a rule is still broken. */
export const placedOrUnresolved = (
  facts: EventFacts,
  placed: Placed,
): PlacementAnswer =>
  placed.added.some((fixture) => brokenRules(facts, fixture).length > 0)
    ? { kind: 'unresolved', placed }
    : { kind: 'placed', placed };

/** Rule breaks first, then each named key's cost where it is weighed. */
export const ruleThenWeighed = (
  facts: EventFacts,
  fixture: Fixture,
  keys: readonly PairingForceKey[],
) => [
  brokenRules(facts, fixture).length,
  ...keys.map((key) =>
    forceOf(facts.settings, key) === 'preference'
      ? (pairingTerms[key](facts, fixture)?.[0] ?? 0)
      : 0,
  ),
];
