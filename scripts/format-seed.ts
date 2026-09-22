import type { FormatRules } from '@daisy/protocol';

export const formatSeedVersion = 'format-seed-v1';

/**
 * Reference rows for `formats`. The foundation format is deliberately
 * unjudged (`judge: 0`): the engine has no judge operation yet, and the first
 * judged format is seeded together with that operation. Clock values are
 * integer milliseconds. Bump `formatSeedVersion` whenever this content
 * changes; `scripts/seed.ts` validates every rules value with the protocol
 * `formatRulesSchema` before writing it.
 */
export const formatSeeds: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly rankedEligible: boolean;
  readonly rules: FormatRules;
}> = [
  {
    id: 'foundation',
    name: 'Foundation (architectural proof)',
    rankedEligible: false,
    rules: {
      version: 1,
      seats: { affirmative: 1, negative: 1, judge: 0 },
      clock: { speechMs: 240_000, prepMs: 120_000 },
    },
  },
];
