import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createRoundMediaHandlers } from './handlers';
setupRitewayBun();
const id = 'a'.repeat(24),
  origin = 'https://daisy.invalid';
const member: Identity = {
  state: 'member',
  username: 'Member',
  principal: { kind: 'user', userId: id, actorId: id },
};

test('media boundary refuses identity claims, foreign origins, anonymous callers and exhausted limits', async () => {
  let calls = 0;
  const response = {
    version: 1 as const,
    roundId: id,
    state: 'unavailable' as const,
    grants: {
      publish: [],
      subscribe: false,
      hidden: false,
      capture: false as const,
    },
    peers: [],
  };
  const results = [];
  for (const input of [
    { body: { actorId: id }, origin, identity: member, allowed: true },
    {
      body: {},
      origin: 'https://foreign.invalid',
      identity: member,
      allowed: true,
    },
    {
      body: {},
      origin,
      identity: {
        state: 'anonymous',
        principal: { kind: 'anonymous' },
      } as const,
      allowed: true,
    },
    { body: {}, origin, identity: member, allowed: false },
  ]) {
    const handlers = createRoundMediaHandlers({
      logger: silentLogger,
      origin: () => origin,
      identify: async () => input.identity,
      getActorByUserId: async () => ({ id }),
      limiter: () => ({
        consume: async () => ({ allowed: input.allowed, retryAfterSeconds: 1 }),
      }),
      active: () => true,
      operations: () => ({
        read: async () => response,
        reconcile: async () => response,
        session: async () => {
          calls++;
          throw new Error('Must not mint');
        },
      }),
    });
    results.push(
      (
        await handlers.session(
          new Request(`${origin}/api/rounds/${id}/media/session`, {
            method: 'POST',
            headers: {
              origin: input.origin,
              'content-type': 'application/json',
            },
            body: JSON.stringify(input.body),
          }),
          id,
        )
      ).status,
    );
  }
  assert({
    given: 'untrusted media requests',
    should: 'refuse before token or vendor operations',
    actual: { results, calls },
    expected: { results: [400, 403, 401, 429], calls: 0 },
  });
});
