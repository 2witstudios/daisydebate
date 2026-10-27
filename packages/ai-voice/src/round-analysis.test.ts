import { assertRejects } from '@daisy/errors/testing';
import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseRoundAnalysis, roundAnalysisMessages } from './round-analysis';
import { roundJudgeMessages } from './round-judge';

setupRitewayBun();

const evidence = {
  resolution: 'Transit should be free',
  revision: 1,
  completeness: 'complete' as const,
  coverage: [],
  utterances: [
    {
      segmentSequence: 0,
      sequence: 0,
      side: 'affirmative' as const,
      slot: 0,
      text: 'Access improves.',
      complete: true,
    },
  ],
};
const seat = { side: 'affirmative' as const, slot: 0 };
const skills = Object.fromEntries(
  Object.entries(report.skills).map(([skill, { score }]) => [skill, score]),
) as Record<keyof typeof report.skills, number>;

describe('roundAnalysisMessages', () => {
  test('analyses one seat from the freeze, without a rubric or a decision', () => {
    const messages = roundAnalysisMessages({ evidence, seat, history: [] });
    const all = messages.map((m) => m.content).join('\n');
    const judge = roundJudgeMessages(evidence);
    const evidenceOf = (content: string) =>
      content.split('Frozen evidence:\n')[1]!.split('\n\n')[0];
    assert({
      given: 'a frozen Round and one debater seat',
      should:
        'name that seat, read the same neutral evidence as judging, and carry no ballot rubric or ballot shape',
      actual: {
        seat: all.includes('Analyse the affirmative debater in slot 0'),
        sameEvidence:
          evidenceOf(messages[1]!.content) === evidenceOf(judge[1]!.content),
        rubric: /Score every category|rubricVersion|"winner"/.test(all),
        decides: all.includes('You never decide or guess who won'),
      },
      expected: {
        seat: true,
        sameEvidence: true,
        rubric: false,
        decides: true,
      },
    });
  });

  test('carries the debater’s own earlier skill scores only when there are any', () => {
    const none = roundAnalysisMessages({ evidence, seat, history: [] });
    const some = roundAnalysisMessages({
      evidence,
      seat,
      history: [skills, skills, skills, skills, skills, skills],
    });
    const historyOf = (content: string) =>
      JSON.parse(
        content.split('newest first:\n')[1]!.split('\n\n')[0]!,
      ) as unknown[];
    assert({
      given: 'no earlier analyses, then six',
      should: 'ask for no patterns, then give at most five earlier scores',
      actual: [
        none[1]!.content.includes('"patterns" is an empty array'),
        historyOf(some[1]!.content).length,
      ],
      expected: [true, 5],
    });
  });
});

describe('parseRoundAnalysis', () => {
  test('reads a valid report, with or without a code fence', () => {
    assert({
      given: 'a fenced report citing a real line',
      should: 'return the report',
      actual: parseRoundAnalysis(
        '```json\n' + JSON.stringify(report) + '\n```',
        {
          evidence,
          history: [],
        },
      ),
      expected: report,
    });
  });

  test('refuses a report that cites speech that never happened', async () => {
    await assertRejects({
      given: 'a key moment citing a line not in the evidence',
      should: 'refuse with INFRASTRUCTURE',
      actual: async () =>
        parseRoundAnalysis(
          JSON.stringify({
            ...report,
            keyMoments: [
              { ...report.keyMoments[0]!, line: { segment: 4, sequence: 2 } },
            ],
          }),
          { evidence, history: [] },
        ),
      code: 'INFRASTRUCTURE',
    });
  });

  test('refuses patterns without history and anything but a report', async () => {
    await assertRejects({
      given: 'patterns for a debater with no earlier analyses',
      should: 'refuse with INFRASTRUCTURE',
      actual: async () =>
        parseRoundAnalysis(
          JSON.stringify({ ...report, patterns: ['You drop contentions.'] }),
          { evidence, history: [] },
        ),
      code: 'INFRASTRUCTURE',
    });
    await assertRejects({
      given: 'two sentences of free text',
      should: 'refuse with INFRASTRUCTURE',
      actual: async () =>
        parseRoundAnalysis('Great round!', { evidence, history: [] }),
      code: 'INFRASTRUCTURE',
    });
  });
});
