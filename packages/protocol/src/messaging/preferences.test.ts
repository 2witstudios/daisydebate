import { assert, setupRitewayBun, test } from 'riteway/bun';
import { messagingPreferenceSchemas } from './preferences';
setupRitewayBun();
const channelId = 'c'.repeat(24);
test('preferences require explicit selections and refuse unrelated authority fields', () => {
  const value = {
    version: 1,
    channelId,
    following: false,
    hidden: true,
    notificationLevel: 'none',
  };
  assert({
    given: 'explicit preferences and untrusted channel intent',
    should:
      'accept exact selections without accepting a grant, missing choice or invalid level',
    actual: [
      messagingPreferenceSchemas.update.safeParse(value).success,
      messagingPreferenceSchemas.update.safeParse({ ...value, grant: true })
        .success,
      messagingPreferenceSchemas.update.safeParse({ version: 1, channelId })
        .success,
      messagingPreferenceSchemas.update.safeParse({
        ...value,
        notificationLevel: 'always',
      }).success,
    ],
    expected: [true, false, false, false],
  });
});
test('preference results expose scoped state or honest absence and a bounded unread count', () => {
  assert({
    given: 'absent preferences, an existing read marker and malformed progress',
    should:
      'preserve null state and refuse negative unread counts or invented fields',
    actual: [
      messagingPreferenceSchemas.result.safeParse({
        version: 1,
        channelId,
        state: null,
        unread: 3,
      }).success,
      messagingPreferenceSchemas.result.safeParse({
        version: 1,
        channelId,
        state: {
          following: false,
          hidden: false,
          notificationLevel: 'all',
          readSequence: 4,
        },
        unread: 0,
      }).success,
      messagingPreferenceSchemas.result.safeParse({
        version: 1,
        channelId,
        state: null,
        unread: -1,
      }).success,
    ],
    expected: [true, true, false],
  });
});
