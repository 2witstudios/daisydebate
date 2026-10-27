import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { matchHistoryQuerySchema } from './member-profile';

setupRitewayBun();

describe('matchHistoryQuerySchema', () => {
  test('the before cursor', () => {
    assert({
      given: 'no cursor, a Round id, and a malformed cursor',
      should: 'accept the first two only',
      actual: [{}, { before: 'r'.repeat(24) }, { before: '1; drop' }].map(
        (input) => matchHistoryQuerySchema.safeParse(input).success,
      ),
      expected: [true, true, false],
    });
  });
});
