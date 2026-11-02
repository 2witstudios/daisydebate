import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRefusal } from '@daisy/errors';
import { noopErrorReporter } from '@daisy/observability';
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
      reporter: noopErrorReporter,
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

/** A same-origin member who passes every check before the operation. */
const admittedMember = {
  origin: () => origin,
  identify: async () =>
    ({
      state: 'member',
      principal: { userId: id, actorId: id },
    }) as never,
  getActorByUserId: async () => ({ id }) as never,
  limiter: () =>
    ({
      consume: async () => ({ allowed: true, retryAfterSeconds: 1 }),
    }) as never,
  active: () => true,
};

test('a deferred media request answers 503 without alerting anyone', async () => {
  const events: string[] = [];
  let reports = 0;
  const handlers = createRoundMediaHandlers({
    logger: {
      ...silentLogger,
      child: (bound: { requestId?: string }) => ({
        ...silentLogger,
        log: (event: string) =>
          void events.push(bound.requestId ? event : 'without its request'),
      }),
    } as unknown as typeof silentLogger,
    reporter: {
      capture: () => {
        reports++;
      },
    },
    ...admittedMember,
    operations: () =>
      ({
        session: async () => {
          throw createRefusal('INFRASTRUCTURE', 'media-deferred');
        },
      }) as never,
  });
  const response = await handlers.session(
    new Request(`${origin}/api/rounds/${id}/media/session`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: '{}',
    }),
    id,
  );
  assert({
    given: 'an admission that stopped waiting for the session lease',
    should:
      'answer the retryable 503, log the named outcome and report nothing',
    actual: [
      response.status,
      events.includes('round.media.request_deferred'),
      reports,
    ],
    expected: [503, true, 0],
  });
});

test('session and reconcile receive the client request signal', async () => {
  const seen: Record<string, AbortSignal | undefined> = {};
  const handlers = createRoundMediaHandlers({
    logger: silentLogger,
    reporter: noopErrorReporter,
    ...admittedMember,
    operations: () =>
      ({
        session: async (
          _round: string,
          _actor: string,
          signal: AbortSignal,
        ) => {
          seen.session = signal;
          return {};
        },
        reconcile: async (
          _round: string,
          _actor: string,
          signal: AbortSignal,
        ) => {
          seen.reconcile = signal;
          return {};
        },
      }) as never,
  });
  const request = (path: string) =>
    new Request(`${origin}/api/rounds/${id}/media/${path}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: '{}',
    });
  const session = request('session');
  const reconcile = request('reconcile');
  await handlers.session(session, id);
  await handlers.reconcile(reconcile, id);
  assert({
    given: 'browser requests that can be abandoned',
    should: 'pass each request signal to its operation',
    actual: [
      seen.session === session.signal,
      seen.reconcile === reconcile.signal,
    ],
    expected: [true, true],
  });
});
