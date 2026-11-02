import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { fixedClock } from '@daisy/clock';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { readChosen, setChosenStatus } from './setting';

setupRitewayBun();

const actorId = 'a'.repeat(24);
const userId = 'b'.repeat(24);
const member = {
  kind: 'user',
  userId,
  actorId,
  sessionId: 'c'.repeat(24),
} as unknown as AuthorizationPrincipal;

describe('setChosenStatus', () => {
  test('writes the choice for the acting member, after the limit', async () => {
    const seen: unknown[] = [];
    const answer = await setChosenStatus(member, 'busy', {
      clock: fixedClock('2026-11-02T00:00:00.000Z'),
      limit: async (id) => {
        seen.push(['limit', id]);
      },
      write: async (scope, input) => {
        seen.push(['write', scope, input]);
        return input.status;
      },
    });
    assert({
      given: 'a member choosing Busy',
      should: 'spend the limit, then write their own row',
      actual: { answer, seen },
      expected: {
        answer: { status: 'busy' },
        seen: [
          ['limit', actorId],
          ['write', { userId, actorId }, { status: 'busy', now: '2026-11-02T00:00:00.000Z' }],
        ],
      },
    });
  });

  test('a signed-out principal writes nothing', async () => {
    let writes = 0;
    await assertRejects({
      given: 'no member actor',
      should: 'refuse',
      code: 'AUTHORIZATION',
      actual: () =>
        setChosenStatus({ kind: 'anonymous' } as unknown as AuthorizationPrincipal, 'online', {
          clock: fixedClock('2026-11-02T00:00:00.000Z'),
          limit: async () => {},
          write: async (_scope, input) => {
            writes += 1;
            return input.status;
          },
        }),
    });
    assert({ given: 'the refusal', should: 'write nothing', actual: writes, expected: 0 });
  });
});

describe('readChosen', () => {
  test('reads the acting member', async () => {
    assert({
      given: 'a stored choice',
      should: 'answer it',
      actual: await readChosen(member, { read: async () => 'offline' }),
      expected: { status: 'offline' },
    });
  });
});
