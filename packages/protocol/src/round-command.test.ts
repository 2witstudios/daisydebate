import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundCommandEnvelopeSchema } from './round-command';
setupRitewayBun();
const envelope = {
  version: 1,
  commandId: 'c'.repeat(24),
  expectedVersion: 1,
  command: { type: 'start' },
};
test('shared Round commands validate their complete trust boundary', () => {
  const cases = [
    [envelope, true],
    [
      {
        ...envelope,
        command: { type: 'start_speech', participantId: 'p'.repeat(24) },
      },
      true,
    ],
    [
      {
        ...envelope,
        command: { type: 'end_prep', participantId: 'p'.repeat(24) },
      },
      false,
    ],
    [{ ...envelope, actorId: 'a'.repeat(24) }, false],
    [
      { ...envelope, command: { type: 'yield', actorId: 'a'.repeat(24) } },
      false,
    ],
    [{ ...envelope, commandId: 'invalid' }, false],
    [{ ...envelope, expectedVersion: 0 }, false],
    [{ ...envelope, version: 2 }, false],
    [
      { ...envelope, command: { type: 'complete', outcome: 'affirmative' } },
      false,
    ],
  ] as const;
  for (const [input, expected] of cases)
    assert({
      given: JSON.stringify(input),
      should:
        'accept only versioned competitive commands without claimed actors or outcomes',
      actual: roundCommandEnvelopeSchema.safeParse(input).success,
      expected,
    });
});
