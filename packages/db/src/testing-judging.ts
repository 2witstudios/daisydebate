import { caseMapSchema } from '@daisy/protocol';

type Sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<unknown>;

const caseOf = (id: 'A' | 'N') => ({
  thesis: { id, claim: 'Synthetic thesis', line: '0.0' },
  framework: 'Synthetic framework',
  burdens: [],
});
/** A minimal valid case map (ADR 0125) for judging suites. */
export const syntheticCaseMap = caseMapSchema.parse({
  about: { question: 'Synthetic', affirmative: 'Yes', negative: 'No' },
  cases: { affirmative: caseOf('A'), negative: caseOf('N') },
  framework: {
    dispute: 'none',
    contested: [],
    ruling: 'Synthetic ruling',
    liveBurdens: [],
  },
  attacks: [],
  concessions: [],
  coherence: { affirmative: [], negative: [] },
  standing: { affirmative: ['A'], negative: ['N'] },
});

/**
 * Test support: moves a judging job past its first two coherency stages,
 * its first pass tried and a case map stored, so a suite about the final
 * ballot buys that ballot directly.
 */
export const atFinalJudgingStage = (
  sql: Sql,
  target: { readonly roundId: string; readonly judgeParticipantId: string },
) =>
  sql`update round_judging_jobs set first_ballot_failed=true,case_map=${JSON.stringify(syntheticCaseMap)}::text::jsonb,case_map_received_at=clock_timestamp()
    where round_id=${target.roundId} and judge_participant_id=${target.judgeParticipantId}`;
