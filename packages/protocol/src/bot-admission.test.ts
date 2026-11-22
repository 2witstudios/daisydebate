import { assert, setupRitewayBun, test } from 'riteway/bun';
import { decideBotGeneration } from './bot-admission';
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
