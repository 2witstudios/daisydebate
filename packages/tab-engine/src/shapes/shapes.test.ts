import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { FixtureOf, FourSides, Speakers, TwoSides } from './competition';
import type { DrawOf } from './draw';
import type { ResolvedSettings } from './settings';

setupRitewayBun();

/*
 * Each mistake below is written on purpose. `@ts-expect-error` fails the
 * typecheck (`tsgo -p tsconfig.test.json`) if the line under it ever
 * compiles, so these are proofs that the shapes refuse them.
 */

// A force the key does not allow: `pairing.pull_up` is never a rule.
const pullUpAsRule: ResolvedSettings['pairing.pull_up'] = {
  // @ts-expect-error a pull-up is weighed or reported, never a rule
  force: 'rule',
  choose: 'least_pulled',
  maxRecordDistance: 1,
};

// `judging.conflict` is a rule or a warning, never off.
// @ts-expect-error a conflict cannot be switched off
const conflictOff: ResolvedSettings['judging.conflict'] = { force: 'off' };

// A fixture whose kind does not fit the format.
const sectionInDebate: FixtureOf<TwoSides> = {
  // @ts-expect-error a two-sided format holds pairings and byes, never a section
  kind: 'section',
  speakers: ['a', 'b', 'c'],
  panel: [],
};
const threeSidesInFour: FixtureOf<FourSides> = {
  kind: 'pairing',
  // @ts-expect-error a four-side pairing has exactly four positions
  sides: ['a', 'b', 'c'],
  panel: [],
};
const pairingInSpeech: FixtureOf<Speakers> = {
  // @ts-expect-error a speech event holds sections and byes, never a pairing
  kind: 'pairing',
  sides: ['a', 'b'],
  panel: [],
};

// An input that says where a value came from.
const sourcedValue: ResolvedSettings['pairing.rematch'] = {
  force: 'rule',
  // @ts-expect-error a resolved value carries no scope or hold
  hold: 'enforced',
};

// A draw with no inputs record.
// @ts-expect-error every draw records what it was computed from
const drawWithoutInputs: DrawOf<TwoSides> = {
  event: 'e',
  format: { outcome: 'winner', sides: 2 },
  tabRound: 1,
  keep: [],
  add: [],
  withdraw: [],
  assessment: {
    fixtures: [],
    totals: [],
    warnings: [],
    broken: [],
    invalid: [],
  },
};

describe('shapes', () => {
  test('the deliberate mistakes are values only so the typecheck sees them', () => {
    assert({
      given: 'the five mistakes above',
      should: 'exist as values; the proof is that the typecheck refuses each',
      actual: [
        pullUpAsRule,
        conflictOff,
        sectionInDebate,
        threeSidesInFour,
        pairingInSpeech,
        sourcedValue,
        drawWithoutInputs,
      ].length,
      expected: 7,
    });
  });
});
