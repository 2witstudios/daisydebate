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
        cause: 'platform',
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
          'The platform captured no audio from 40.0 seconds to 52.0 seconds into this speech. The speaker may have spoken then.',
      },
    ],
  });
});

test('a gap says what is known about it', () => {
  const statements = (['platform', 'edge', 'unattributed'] as const).map(
    (cause) =>
      transcriptEvidence({
        revision: 1,
        completeness: 'complete',
        coverage: [],
        utterances: [],
        gaps: [
          {
            sequence: 0,
            side: 'affirmative',
            slot: 0,
            fromOffsetMs: 0,
            untilOffsetMs: 700,
            cause,
          },
        ],
      } as never).captureGaps[0]!.statement,
  );
  assert({
    given: 'a sub-second gap of each cause',
    should: 'state its span, and blame the platform only when it is known',
    actual: statements.map((line) => [
      line.includes('from 0.0 seconds to 0.7 seconds'),
      line.startsWith('The platform'),
    ]),
    expected: [
      [true, true],
      [true, false],
      [true, false],
    ],
  });
});
