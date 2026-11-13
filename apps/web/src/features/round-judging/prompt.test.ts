import { assert, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import { stubCaseMap } from '@daisy/ai-voice/testing';
import { frozenStageRequest } from './prompt';
import {
  frozen,
  round,
} from '../round-runtime/transcript-evidence.test-support';
setupRitewayBun();
/** The first pass reads the frozen evidence as JSON. */
const firstPassMessages = (input: Parameters<typeof frozenStageRequest>[0]) =>
  frozenStageRequest(input, { stage: 'first' }).messages;
test('actual frozen identities map to side/slot without becoming prompt metadata', () => {
  const messages = firstPassMessages({ round, frozen });
  const evidence = JSON.parse(
    messages[1]!.content.split('Frozen evidence:\n')[1]!.split('\n\n')[0]!,
  );
  assert({
    given: 'actual Round seat and segment identity witnesses',
    should:
      'map per-seat partial coverage and text to public competitive labels',
    actual: [
      evidence.coverage[0].side,
      evidence.coverage[0].slot,
      evidence.utterances[0].side,
      evidence.utterances[0].complete,
      evidence.coverage[0].sealedChunkCount,
      JSON.stringify(evidence).includes('roundParticipantId'),
    ],
    expected: ['affirmative', 1, 'affirmative', false, null, false],
  });
});
test('foreign frozen seat, segment or Round cannot become judge evidence', () => {
  for (const invalid of [
    { ...frozen, roundId: 'foreign' },
    {
      ...frozen,
      utterances: [{ ...frozen.utterances[0]!, roundParticipantId: 'foreign' }],
    },
    { ...frozen, coverage: [{ ...frozen.coverage[0]!, segmentId: 'foreign' }] },
  ])
    expect(() => firstPassMessages({ round, frozen: invalid })).toThrow(
      'Frozen transcript scope changed',
    );
});

test('the judge reads a bot’s exact authored words, with a cut line marked (ADR 0122)', () => {
  const authored = 'Free transit crowds out road repair budgets.';
  const messages = firstPassMessages({
    round,
    frozen: {
      ...frozen,
      completeness: 'complete',
      utterances: [
        { ...frozen.utterances[0]!, text: authored, complete: true },
        {
          ...frozen.utterances[0]!,
          id: 'cut',
          sequence: 1,
          text: 'And the second',
          complete: true,
          interrupted: true,
        },
      ],
    },
  });
  const evidence = JSON.parse(
    messages[1]!.content.split('Frozen evidence:\n')[1]!.split('\n\n')[0]!,
  );
  assert({
    given: 'a frozen bot speech: one whole authored line and one cut short',
    should:
      'give the judge each line word for word, and say which one was cut off',
    actual: evidence.utterances.map(
      (line: { text: string; interrupted: boolean }) => [
        line.text,
        line.interrupted,
      ],
    ),
    expected: [
      [authored, false],
      ['And the second', true],
    ],
  });
});

test('each coherency stage asks for its own contract, and the final one reads the map (ADR 0125)', () => {
  const caseMap = stubCaseMap;
  const requests = (
    [{ stage: 'first' }, { stage: 'map' }, { stage: 'final', caseMap }] as const
  ).map((due) => frozenStageRequest({ round, frozen }, due));
  assert({
    given:
      'the first pass, the case map and the final stage of one frozen Round',
    should:
      'ask for a ballot, then the long case map, then a ballot decided with the stored map in view',
    actual: requests.map((request) => [
      request.outputSchema.name,
      request.maxTokens,
      request.messages.some((message) =>
        message.content.includes(JSON.stringify(caseMap)),
      ),
    ]),
    expected: [
      ['ballot', 6000, false],
      ['case_map', 16000, false],
      ['ballot', 6000, true],
    ],
  });
});
