import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createMessagingInboxSchemas,
  decodeMessagingInboxCursor,
  encodeMessagingInboxCursor,
  messagingInboxSearchLine,
} from './inbox';

setupRitewayBun();
const channelId = 'c'.repeat(24);
const query = createMessagingInboxSchemas(10).query;

describe('inbox cursor', () => {
  test('round trip', () => {
    const activity = {
      lead: false,
      activityAt: '2026-11-04T10:00:00.000Z',
      channelId,
    } as const;
    assert({
      given: 'an activity position',
      should: 'decode what it encoded',
      actual: decodeMessagingInboxCursor(encodeMessagingInboxCursor(activity)),
      expected: activity,
    });
    assert({
      given: 'an invitation position',
      should: 'carry no activity',
      actual: encodeMessagingInboxCursor({ lead: true, channelId }),
      expected: `lead~${channelId}`,
    });
  });
  test('refusals', () => {
    for (const bad of [
      channelId,
      `yesterday~${channelId}`,
      'lead~short',
      `lead~${channelId}~more`,
    ])
      assert({
        given: `the cursor ${bad.slice(0, 16)}`,
        should: 'refuse it',
        actual: query.safeParse({ version: 1, after: bad }).success,
        expected: false,
      });
  });
});

describe('inbox search query', () => {
  test('bounds', () => {
    assert({
      given: 'only whitespace',
      should: 'refuse it',
      actual: query.safeParse({ version: 1, q: ' \n\t ' }).success,
      expected: false,
    });
    assert({
      given: 'more than the query bound',
      should: 'refuse it',
      actual: query.safeParse({ version: 1, q: 'x'.repeat(201) }).success,
      expected: false,
    });
  });
  test('one line', () => {
    assert({
      given: 'runs of whitespace, a no-break space included',
      should: 'collapse them as a row does',
      actual: messagingInboxSearchLine('  a \n  b '),
      expected: 'a b',
    });
  });
});
