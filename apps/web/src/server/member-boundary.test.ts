import { assert, setupRitewayBun, test } from 'riteway/bun';
import { resolveIdentity, type Identity } from '@daisy/auth';
import { createAppError } from '@daisy/errors';
import { noopErrorReporter } from '@daisy/observability';
import { runEvaluatedRoute, runMemberRoute } from './member-boundary';
import { origin } from './member-boundary.test-support';
import { silentLogger } from './test-loggers.test-support';

setupRitewayBun();

const rule = { max: 1, windowSeconds: 60 };
const principal = { kind: 'user' as const, userId: 'user', actorId: 'actor' };
const member: Identity = { state: 'member', username: 'Ada', principal };
const waitlisted: Identity = {
  state: 'waitlisted',
  username: 'Ada',
  reason: 'pending',
  principal,
};
const restricted: Identity = {
  state: 'restricted',
  username: 'Ada',
  principal,
};
const provisional: Identity = { state: 'provisional', principal };
const anonymous: Identity = {
  state: 'anonymous',
  principal: { kind: 'anonymous' },
};

const boundary = (identity: Identity) => {
  const events: string[] = [];
  return {
    events,
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => origin,
    identify: async () => {
      events.push('identify');
      return identity;
    },
    limiter: () => ({
      consume: async (key: string) => {
        events.push(`consume ${key}`);
        return { allowed: true, retryAfterSeconds: 0 };
      },
    }),
  };
};
const request = (from = origin) =>
  new Request(`${origin}/api/x`, { method: 'POST', headers: { origin: from } });
const route = {
  name: 'room.command',
  readOnly: false,
  bucket: 'b',
  rule,
} as const;

test('runMemberRoute()', async () => {
  const admitted = boundary(member);
  const callers: unknown[] = [];
  const answered = await runMemberRoute(
    admitted,
    request(),
    route,
    async (caller) => {
      callers.push(caller);
      return new Response(null, { status: 204 });
    },
  );
  assert({
    given: 'a member',
    should:
      "resolve the identity, spend the bucket and act as identity's actor, reading it no other way",
    actual: [answered.status, admitted.events, callers],
    expected: [
      204,
      ['identify', 'consume b:user'],
      [{ userId: 'user', actorId: 'actor' }],
    ],
  });

  const status = async (
    identity: Identity,
    extra: { readonly evaluatorDecides?: boolean } = {},
    from = origin,
  ) => {
    const gate = boundary(identity);
    let ran = false;
    const response = await runMemberRoute(
      gate,
      request(from),
      { ...route, ...extra },
      async () => {
        ran = true;
        return new Response(null, { status: 204 });
      },
    );
    return [response.status, gate.events.includes('consume b:user'), ran];
  };

  assert({
    given: 'a foreign origin, then anyone who is not a member',
    should: 'refuse each before any budget or work',
    actual: [
      await status(member, {}, 'https://foreign.invalid'),
      await status(anonymous),
      await status(provisional),
      await status(waitlisted),
      await status(restricted),
    ],
    expected: [
      [403, false, false],
      [401, false, false],
      [403, false, false],
      [403, false, false],
      [403, false, false],
    ],
  });

  assert({
    given: 'a route whose evaluator decides',
    should:
      'pass the accounts that keep only withdrawals, never a provisional one',
    actual: [
      await status(waitlisted, { evaluatorDecides: true }),
      await status(restricted, { evaluatorDecides: true }),
      await status(provisional, { evaluatorDecides: true }),
    ],
    expected: [
      [204, true, true],
      [204, true, true],
      [403, false, false],
    ],
  });

  const checked = boundary(member);
  const early = await runMemberRoute(
    checked,
    request(),
    {
      ...route,
      beforeBudget: () => {
        throw createAppError('VALIDATION');
      },
    },
    async () => new Response(null, { status: 204 }),
  );
  assert({
    given: 'a route that refuses before the budget',
    should: 'spend nothing',
    actual: [early.status, checked.events],
    expected: [400, ['identify']],
  });
});

test('a member whose actor row is missing', async () => {
  const gate = boundary(member);
  let ran = false;
  const response = await runMemberRoute(
    {
      ...gate,
      identify: () =>
        resolveIdentity({
          cookie: 'session=1',
          readSession: async () => ({
            userId: 'user',
            emailVerified: true,
            username: 'Ada',
            expiresAt: '2100-01-01T00:00:00.000Z',
          }),
          readActor: async () => null,
          readParticipation: async () => {
            throw new Error('Must not read participation');
          },
          now: () => '2026-01-01T00:00:00.000Z',
        }),
    },
    request(),
    route,
    async () => {
      ran = true;
      return new Response(null, { status: 204 });
    },
  );
  assert({
    given: 'identity resolution through the boundary',
    should: 'answer 503 as an outage, spending nothing and running nothing',
    actual: [response.status, gate.events, ran],
    expected: [503, [], false],
  });
});

test('runEvaluatedRoute()', async () => {
  const principals: unknown[] = [];
  const run = (identity: Identity) =>
    runEvaluatedRoute(boundary(identity), request(), {
      name: 'room.command',
      readOnly: false,
      readInput: async () => 'input',
      operation: async (input, given) => {
        principals.push([input, given]);
        return { done: true };
      },
    });
  const statuses = [
    (await run(member)).status,
    (await run(waitlisted)).status,
    (await run(restricted)).status,
    (await run(provisional)).status,
    (await run(anonymous)).status,
  ];
  assert({
    given: 'each signed-in identity and a visitor',
    should:
      'hand members and the accounts that may only withdraw to the operation with their principal, and refuse the rest',
    actual: [statuses, principals],
    expected: [
      [200, 200, 200, 403, 401],
      [
        ['input', principal],
        ['input', principal],
        ['input', principal],
      ],
    ],
  });
});
