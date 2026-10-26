import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundCoachMessages, roundJudgeMessages } from './round-judge';
setupRitewayBun();

test('shared judging prompt uses only scoped sides and honest frozen coverage', () => {
  const negative = {
    segmentSequence: 1,
    sequence: 1,
    side: 'negative' as const,
    slot: 1,
    text: 'Costs displace other services.',
    complete: false,
    actorId: 'private-actor-identity',
    actorKind: 'bot',
  };
  const messages = roundJudgeMessages({
    resolution: 'Transit should be free',
    revision: 2,
    completeness: 'incomplete',
    coverage: [
      {
        sequence: 1,
        side: 'affirmative',
        slot: 0,
        state: 'partial',
        chunkCount: 2,
        sealedChunkCount: 1,
      },
    ],
    utterances: [
      negative,
      {
        segmentSequence: 0,
        sequence: 0,
        side: 'affirmative',
        slot: 0,
        text: 'Access improves.',
        complete: true,
      },
    ],
  });
  const evidence = JSON.parse(
    messages[1]!.content.split('Frozen evidence:\n')[1]!.split('\n\n')[0]!,
  );
  assert({
    given: 'a partial immutable transcript with multiple seats',
    should:
      'order actual lines by played segment and preserve partial evidence',
    actual: [
      evidence.completeness,
      evidence.utterances.map((u: { text: string }) => u.text),
      evidence.utterances[1].complete,
      evidence.coverage[0].state,
    ],
    expected: [
      'incomplete',
      ['Access improves.', 'Costs displace other services.'],
      false,
      'partial',
    ],
  });
  assert({
    given: 'shared Round casts and missing captured history',
    should:
      'retain canonical rubric without labeling an actor kind or inventing speech',
    actual: [
      messages[0]!.content.includes('Score every category'),
      messages[0]!.content.includes('Never invent missing speech'),
      /human debater|the AI was/.test(messages[1]!.content),
      /private-actor-identity|actorKind/.test(messages[1]!.content),
    ],
    expected: [true, true, false, false],
  });
});

test('the coaching prompt reads the same freeze and asks for advice, not a decision', () => {
  const input = {
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
  const coach = roundCoachMessages(input);
  const judge = roundJudgeMessages(input);
  const evidence = (messages: typeof coach) =>
    messages[1]!.content.split('Frozen evidence:\n')[1]!.split('\n\n')[0];
  assert({
    given: 'one frozen transcript',
    should:
      'give the coach the judge’s exact evidence and ask for both sides’ coaching instead of a ballot',
    actual: {
      sameEvidence: evidence(coach) === evidence(judge),
      decides: coach[0]!.content.includes('You do not decide who won'),
      asks: coach[1]!.content.includes(
        '{"affirmative": "coaching for the affirmative"',
      ),
    },
    expected: { sameEvidence: true, decides: true, asks: true },
  });
});
