import { assertRejects } from '@daisy/errors/testing';
import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readRoundAnalysisFacts } from './round-analysis-facts';
import {
  factsRow,
  plainFacts,
  history,
} from './round-analysis-facts.test-support';

setupRitewayBun();

const seat = { roundId: 'r1', roundParticipantId: 'p1' };

describe('readRoundAnalysisFacts()', () => {
  test('a seat’s facts, or none', async () => {
    const reader = (rows: unknown[]) =>
      ({ execute: async () => rows }) as never;
    assert({
      given: 'the driver’s row for a seat',
      should:
        'return plain facts: instants as UTC ISO and the line count as a number',
      actual: await readRoundAnalysisFacts(reader([factsRow]), seat),
      expected: plainFacts,
    });
    assert({
      given: 'a succeeded analysis with its report',
      should: 'return the validated report',
      actual: (
        await readRoundAnalysisFacts(
          reader([
            {
              ...factsRow,
              analysis: {
                kind: 'retained',
                historical: {
                  ...history,
                  completedAt: '2026-10-26T12:01:00.000Z',
                },
                report,
              },
            },
          ]),
          seat,
        )
      ).analysis,
      expected: {
        kind: 'retained',
        historical: { ...history, completedAt: '2026-10-26T12:01:00.000Z' },
        report,
      },
    });
    await assertRejects({
      given: 'no Round',
      should: 'refuse with NOT_FOUND',
      actual: () => readRoundAnalysisFacts(reader([]), seat),
      code: 'NOT_FOUND',
    });
  });
});
