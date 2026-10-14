import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { fixedClock, fixedIds } from '@daisy/clock';
import type { Database } from '@daisy/db';
import { composeMessaging } from './messaging';
import { messagingUnitPolicy } from './typing.test-support';

setupRitewayBun();

/** A database and limiter that record every touch, so a refusal can prove it touched neither. */
const world = (policy = messagingUnitPolicy()) => {
  const touched: string[] = [];
  const database = new Proxy({} as Database, {
    get: (_, key) => {
      touched.push(`database.${String(key)}`);
      throw new Error('untouched database');
    },
  });
  const messaging = composeMessaging({
    database,
    clock: fixedClock('2026-10-12T00:00:00.000Z'),
    ids: fixedIds([]),
    policy,
    limiter: () => ({
      consume: async (key) => {
        touched.push(`limit.${key}`);
        return { allowed: true, retryAfterSeconds: 0 };
      },
    }),
  });
  return { messaging, touched };
};

test('messaging exposes only its named operations', () => {
  assert({
    given: 'a composed messaging feature',
    should:
      'offer the fixed reads and commands, with no store, transaction or capability surface',
    actual: Object.keys(world().messaging).sort(),
    expected: [
      'changes',
      'edit',
      'history',
      'inbox',
      'invitationPreview',
      'markRead',
      'remove',
      'requestStatus',
      'search',
      'send',
    ],
  });
});

test('a read refuses a principal without a durable actor before any limit or database work', async () => {
  const { messaging, touched } = world();
  await assertRejects({
    given: 'an anonymous principal reading history',
    should: 'refuse with AUTHORIZATION',
    actual: () =>
      messaging.history({ kind: 'anonymous' }, { version: 1, channelId: 'c' }),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'the refused read',
    should: 'consume no limit and touch no database surface',
    actual: touched,
    expected: [],
  });
});

test('the invitation preview is unavailable when the deploy enables no social messaging', async () => {
  const { messaging, touched } = world();
  await assertRejects({
    given: 'a messaging policy without social bounds',
    should: 'refuse the preview as unavailable without touching the database',
    actual: async () =>
      messaging.invitationPreview(
        { kind: 'user', userId: 'u', actorId: 'a' },
        { version: 1, channelId: 'c' },
      ),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'the refused preview',
    should: 'touch nothing',
    actual: touched,
    expected: [],
  });
});
