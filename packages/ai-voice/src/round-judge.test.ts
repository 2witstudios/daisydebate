import { transcriptEvidence } from './transcript-evidence';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundJudgeMessages } from './round-judge';
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
    gaps: [],
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

test('a capture gap reaches the judge in plain words', () => {
  const evidence = transcriptEvidence({
    resolution: 'A resolution',
    revision: 1,
    completeness: 'incomplete',
    coverage: [],
    gaps: [
      {
        sequence: 2,
        side: 'negative',
        slot: 0,
        fromOffsetMs: 40_000,
        untilOffsetMs: 52_000,
      },
    ],
    utterances: [],
  });
  assert({
    given: 'a stretch of speech with no transcript',
    should: 'state it to the judge, naming the seat and the time',
    actual: evidence.captureGaps,
    expected: [
      {
        sequence: 2,
        side: 'negative',
        slot: 0,
        statement:
          'The platform captured no audio from 40 seconds to 52 seconds into this speech. The speaker may have spoken then.',
      },
    ],
  });
});
