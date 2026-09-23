import type { FormatRules } from '@daisy/protocol';

/**
 * The reference `formats` rows, as TypeScript, for tooling that runs without
 * a database (scenarios, invariants, the agent seed's debate). The database
 * gets them from the migrations, never from `db:seed` (ADR 0038):
 * `reference-formats.test.ts` fails when this list and the rows the
 * migrations insert disagree. The foundation format is deliberately
 * unjudged (`judge: 0`): the engine has no judge operation yet, and the
 * first judged format arrives in a forward migration together with that
 * operation. Clock values are integer milliseconds.
 */
export const referenceFormats: ReadonlyArray<{
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
