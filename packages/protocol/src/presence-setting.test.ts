import { assert, setupRitewayBun, test } from 'riteway/bun';
import { presenceSettingSchema } from './presence-setting';
setupRitewayBun();

test('the presence setting command', () => {
  assert({
    given: 'a boolean choice, and a choice naming another member',
    should: 'accept the first and refuse the second',
    actual: [
      presenceSettingSchema.safeParse({ version: 1, hidden: true }).success,
      presenceSettingSchema.safeParse({
        version: 1,
        hidden: true,
        username: 'ada',
      }).success,
    ],
    expected: [true, false],
  });
});
