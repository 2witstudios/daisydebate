import { assert, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import { frozenJudgingMessages } from './prompt';
import {
  frozen,
  round,
} from '../round-runtime/transcript-evidence.test-support';
setupRitewayBun();
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
      'Frozen transcript scope changed',
    );
});
