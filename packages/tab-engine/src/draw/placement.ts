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
export const weighedKeys = (facts: EventFacts): PairingForceKey[] => {
  const order = facts.settings['pairing.preference_order'].order;
  const listed = [
    ...order,
    ...pairingKeys.filter((key) => !order.includes(key)),
  ];
  return listed.filter((key) => forceOf(facts.settings, key) === 'preference');
};

/**
 * A fixture's preference fields, highest first: each weighed key's term,
 * then the record distance when pull-ups are only reported (a powered round
 * is still paired by record), then `bye.recipient`.
 */
export const preferenceFields = (
  facts: EventFacts,
  fixture: Fixture,
  byeCost: readonly number[] | null,
): number[] => {
  const fields = weighedKeys(facts).flatMap((key) => {
    const cost = pairingTerms[key](facts, fixture);
    return cost === null
      ? Array.from({ length: widthOf(key) }, () => 0)
      : [...cost];
  });
  if (facts.powered && forceOf(facts.settings, 'pairing.pull_up') === 'warning')
    fields.push(pairingTerms['pairing.pull_up'](facts, fixture)?.[0] ?? 0);
  fields.push(byeCost?.[0] ?? 0);
  return fields;
};
