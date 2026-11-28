import { assert, setupRitewayBun, test } from 'riteway/bun';
import { decideBotClaimActivity, decideBotGeneration } from './bot-admission';
setupRitewayBun();
test('speech budget and one-answer recovery preserve terminal admission decisions', () => {
  assert({
    given: 'the exact remaining budget and one extra character',
    should: 'admit the edge and refuse exhausted speech',
    actual: [880, 881].map((spoken) =>
      decideBotGeneration({
        kind: 'tts',
        model: 'voice-1',
        spoken,
        characters: 120,
        budget: 1000,
      }),
    ),
    expected: [
      { kind: 'admit', model: 'voice-1' },
      { kind: 'final', message: 'Speech budget exhausted' },
    ],
  });
  assert({
    given: 'received, spoken and unanswered language requests',
    should: 'never repurchase a speech already received or begun',
    actual: [
      [true, false],
      [false, true],
      [false, false],
    ].map(([answered, said]) =>
      decideBotGeneration({
        kind: 'language',
        workerKind: 'speech',
        model: 'model',
        answered: answered ?? false,
        said: said ?? false,
      }),
    ),
    expected: [
      { kind: 'final', message: 'Speech already answered' },
      { kind: 'final', message: 'Speech already begun' },
      { kind: 'admit', model: 'model' },
    ],
  });
});

test('team cross-examination bots answer only across sides, once per side (INTX-11)', () => {
  const side = (s: 'affirmative' | 'negative', slot: number) => ({
    kind: 'side' as const,
    side: s,
    slot,
  });
  const participants = [
    { id: 'aff1', seat: side('affirmative', 0) },
    { id: 'aff2', seat: side('affirmative', 1) },
    { id: 'neg1', seat: side('negative', 0) },
    { id: 'neg2', seat: side('negative', 1) },
    { id: 'judge', seat: { kind: 'judge' as const, slot: 0 } },
  ];
  const round = {
    rules: {
      segments: [
        {
          key: 'CX',
          label: 'Cross-examination',
          type: 'cross_ex' as const,
          speak: { rights: 'all' as const, lead: side('affirmative', 1) },
          durationMs: 180_000,
        },
      ],
    },
    participants,
  };
  const peers = (id: string) => {
    const decided = decideBotClaimActivity(
      round,
      participants.find((row) => row.id === id)!,
      { type: 'cross_ex', rulesSegmentKey: 'CX' },
    );
    return decided.kind === 'ready'
      ? [decided.activity.opensExchange, decided.activity.peerParticipantIds]
      : decided.kind;
  };
  assert({
    given: 'the asker, its partner, and both seats of the answering side',
    should:
      'let the asker answer the other side, the first answerer answer the asking side, and the rest stay quiet',
    actual: ['aff2', 'aff1', 'neg1', 'neg2'].map(peers),
    expected: [
      [true, ['neg1', 'neg2']],
      [false, []],
      [false, ['aff1', 'aff2']],
      [false, []],
    ],
  });
});
