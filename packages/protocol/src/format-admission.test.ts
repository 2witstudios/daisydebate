import { assert, setupRitewayBun, test } from 'riteway/bun';
import { formatDefinitionSchema } from './format';
import { invalidFormatDefinitions } from './format-fixtures.test-support';

setupRitewayBun();

test('custom format admission rejects invalid seats, defaults, bounds and unused prep references', () => {
  assert({
    given: 'the independently reproduced invalid custom schedules',
    should: 'reject each before it enters a portable Room command',
    actual: invalidFormatDefinitions.map(
      ([, definition]) => formatDefinitionSchema.safeParse(definition).success,
    ),
    expected: [false, false, false, false],
  });
});
