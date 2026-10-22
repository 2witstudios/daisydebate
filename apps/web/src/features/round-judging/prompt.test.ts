import { assert, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import { frozenJudgingMessages } from './prompt';
setupRitewayBun();
const round = {
  id: 'round',
  resolution: 'Transit should be free',
  participants: [{ id: 'seat', role: 'affirmative' as const, slot: 1 }],
  segments: [{ id: 'segment', sequence: 0 }],
};
const frozen = {
  roundId: 'round',
  revision: 1,
  frontier: 0,
  frozenAt: '2026-10-22T00:00:00.000Z',
  completeness: 'incomplete' as const,
  coverage: [
    {
      segmentId: 'segment',
      roundParticipantId: 'seat',
      state: 'partial' as const,
      chunkCount: 1,
      sealedChunkCount: null,
      sealedAt: null,
    },
  ],
  utterances: [
    {
      id: 'line',
      segmentId: 'segment',
      segmentSequence: 0,
      sequence: 0,
      roundParticipantId: 'seat',
      text: 'Access improves.',
      complete: false,
    },
  ],
};
test('actual frozen identities map to side/slot without becoming prompt metadata', () => {
  const messages = frozenJudgingMessages({ round, frozen });
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
    expect(() => frozenJudgingMessages({ round, frozen: invalid })).toThrow(
      'Frozen judging scope changed',
    );
});
