import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { fixedClock } from '@daisy/clock';
import { readPresenceSetting, setPresenceHidden } from './setting';

setupRitewayBun();

const principal = {
  kind: 'user' as const,
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
};
const now = '2026-10-26T18:00:00.000Z';

test('setPresenceHidden', async () => {
  const writes: unknown[] = [];
  const limited: string[] = [];
  const answer = await setPresenceHidden(principal, true, {
    clock: fixedClock(now),
    limit: async (actorId) => {
      limited.push(actorId);
    },
    write: async (scope, input) => {
      writes.push([scope, input]);
      return input.hidden;
    },
  });
  assert({
    given: 'a member choosing to hide',
    should: 'rate-limit them and write their own choice at the clock time',
    actual: [answer, limited, writes],
    expected: [
      { hidden: true },
      [principal.actorId],
      [
        [
          { userId: principal.userId, actorId: principal.actorId },
          { hidden: true, now },
        ],
      ],
    ],
  });
  await assertRejects({
    given: 'a visitor',
    should: 'refuse as authentication',
    actual: () =>
      setPresenceHidden({ kind: 'anonymous' }, true, {
        clock: fixedClock(now),
        limit: async () => {},
        write: async () => true,
      }),
    code: 'AUTHENTICATION',
  });
});

test('readPresenceSetting', async () => {
  const scopes: unknown[] = [];
  assert({
    given: 'a member reading their own setting',
    should: 'read only their own scope and answer their choice',
    actual: [
      await readPresenceSetting(principal, {
        read: async (scope) => {
          scopes.push(scope);
          return true;
        },
      }),
      scopes,
    ],
    expected: [
      { hidden: true },
      [{ userId: principal.userId, actorId: principal.actorId }],
    ],
  });
  await assertRejects({
    given: 'a visitor',
    should: 'refuse as authentication',
    actual: () =>
      readPresenceSetting({ kind: 'anonymous' }, { read: async () => true }),
    code: 'AUTHENTICATION',
  });
});
