import {
  uniformIndex,
  wordStream,
  type WordStream,
} from '@daisy/seeded-random';
import type { FormatDescriptor } from '../shapes/competition';
import type { ResolvedSettings } from '../shapes/settings';
import { randomPreset, roundRobinPreset, swissPower } from './presets';

/** A seeded source of small choices for one tournament. */
export type Dice = {
  readonly below: (n: number) => number;
  readonly chance: (percent: number) => boolean;
  readonly pick: <T>(items: readonly T[]) => T;
};

export const dice = (seed: Uint8Array, purpose: string): Dice => {
  const stream: WordStream = wordStream(
    `daisy-tab-v1/simulate/${purpose}`,
    seed,
    new Uint8Array(),
  );
  let at = 0;
  const below = (n: number) => {
    const pick = uniformIndex(stream, at, Math.max(1, n));
    at = pick.next;
    return pick.index;
  };
  return {
    below,
    chance: (percent) => below(100) < percent,
    pick: (items) => items[below(items.length)]!,
  };
};

export type EventPlan = {
  readonly id: string;
  readonly format: FormatDescriptor;
  readonly entries: number;
  readonly settings: ResolvedSettings;
  /** Whether entries carry the two divisions and break separately. */
  readonly divisions: boolean;
  /** A windowed stage drawn round by round with no slot. */
  readonly windowed: boolean;
};

export type Scenario = {
  readonly events: readonly EventPlan[];
  readonly schools: number;
  readonly preliminaryRounds: number;
  /** Draw a slot's events in one call, or one by one with the earlier ones as commitments. */
  readonly together: boolean;
  readonly drops: boolean;
  readonly lateResults: boolean;
  readonly corrections: boolean;
  readonly redraws: boolean;
  readonly personInTwoEvents: boolean;
  readonly unsubmittedBallots: boolean;
  readonly doubleQualifier: 'higher' | 'both' | 'choice';
};

const twoSides = { outcome: 'winner', sides: 2 } as const;
const fourSides = { outcome: 'ranking', of: 'sides', sides: 4 } as const;
const speakers = { outcome: 'ranking', of: 'speakers' } as const;

const fourTeam: ResolvedSettings = {
  ...swissPower,
  'pairing.rematch': { force: 'off' },
  'pairing.same_school': { force: 'off' },
};

/** A scenario from a seed: the grid the long run walks, in miniature. */
export const scenarioOf = (
  seed: Uint8Array,
  size: 'small' | 'full',
): Scenario => {
  const d = dice(seed, 'scenario');
  const scale = size === 'small' ? 1 : 2;
  const eventCount = 1 + d.below(3);
  const events: EventPlan[] = Array.from({ length: eventCount }, (_, i) => {
    const kind = d.below(5);
    if (kind <= 2) {
      const settings = d.pick([
        swissPower,
        swissPower,
        randomPreset,
        roundRobinPreset,
      ]);
      const windowed = settings !== swissPower && d.chance(50);
      return {
        id: `ev${i}`,
        format: twoSides,
        entries: (settings === roundRobinPreset ? 5 : 8) + d.below(10 * scale),
        settings: {
          ...settings,
          'break.line': {
            default: { kind: 'fixed', size: 4 },
            byDivision: { novice: { kind: 'fixed', size: 2 } },
          },
        },
        divisions: d.chance(50),
        windowed,
      };
    }
    if (kind === 3)
      return {
        id: `ev${i}`,
        format: fourSides,
        entries: 8 + 4 * d.below(3 * scale),
        settings: fourTeam,
        divisions: false,
        windowed: false,
      };
    return {
      id: `ev${i}`,
      format: speakers,
      entries: 10 + d.below(12 * scale),
      settings: swissPower,
      divisions: false,
      windowed: false,
    };
  });
  return {
    events,
    schools: 3 + d.below(6),
    preliminaryRounds: 3 + d.below(2),
    together: d.chance(50),
    drops: d.chance(50),
    lateResults: d.chance(40),
    corrections: d.chance(50),
    redraws: d.chance(50),
    personInTwoEvents: eventCount > 1 && d.chance(30),
    unsubmittedBallots: d.chance(40),
    doubleQualifier: d.pick(['higher', 'both', 'choice'] as const),
  };
};
