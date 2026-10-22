import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createTestApp } from './fixtures';
import { createAccountFlows, uniqueName } from './auth-account-helpers';
import { withAttendanceRound } from './attendance.test-support';
import { composeAttendanceRoutes } from '../src/features/attendance/composition';
import { createPublicCheckInProbe } from '../src/features/availability/public-probe';
setupRitewayBun();

test('real public ingress probe uses ordinary signed session, scoped seat and durable receipt aliases', async () => {
  let handler: ((request: Request) => Promise<Response>) | undefined;
  let available = true;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      if (!available)
        return new Response('Public route unavailable', { status: 503 });
      return handler?.(request) ?? new Response('Not ready', { status: 503 });
    },
  });
  const origin = server.url.origin;
  const policy = {
    consentTtlMs: 60_000,
    maxOpenRooms: 5,
    maxBodyBytes: 1024,
    limits: Object.fromEntries(
      ['create', 'read', 'command'].map((name) => [
        name,
        { max: 200, windowSeconds: 60 },
      ]),
    ),
  };
  const app = createTestApp({
    PUBLIC_APP_URL: origin,
    ROOM_POLICY: JSON.stringify(policy),
  });
  const account = createAccountFlows(app);
  const signed = await account.signUp();
  const claimed = await account.claim(signed.cookie, {
    username: uniqueName(),
  });
  if (claimed.status !== 201)
    throw new Error('Real member fixture claim failed');
  const identity = await account.identifyAs(signed.cookie);
  if (identity.state !== 'member')
    throw new Error('Actual signed cookie did not resolve to a member');
  try {
    await withAttendanceRound(async ({ f, roundId, segmentId }) => {
      // Isolated resource setup: canonical Round seat belongs to the actual signed member.
      await f.sql`update round_participants set actor_id=${identity.principal.actorId} where round_id=${roundId} and role='affirmative'`;
      const mounted = composeAttendanceRoutes(app.app);
      handler = (request) =>
        new URL(request.url).pathname === `/api/rounds/${roundId}/check-in` &&
        request.method === 'POST'
          ? mounted.checkIn(request, roundId)
          : Promise.resolve(new Response('Not found', { status: 404 }));
      const participant = (await f.store.getRound(roundId))!.participants.find(
        (p) => p.actorId === identity.principal.actorId,
      )!;
      const probe = createPublicCheckInProbe({
        configuration: {
          origin,
          roundId,
          segmentId,
          participantId: participant.id,
          cookie: signed.cookie,
        },
        nextId: createId,
        fetch,
      });
      const healthy = [await probe(), await probe()];
      const [facts] =
        await f.sql`select (select count(*)::int from round_check_ins where round_id=${roundId}) as facts,(select count(*)::int from round_commands where round_id=${roundId} and type='check_in') as aliases,(select count(*)::int from round_check_in_attempts where round_id=${roundId} and state='committed') as attempts`;
      assert({
        given:
          'two actual HTTP probes with a real signed member session and actual speech',
        should:
          'produce two fresh durable command aliases and attempt receipts with one first stamp',
        actual: { healthy, facts },
        expected: {
          healthy: [true, true],
          facts: { facts: 1, aliases: 2, attempts: 2 },
        },
      });
      available = false;
      const outage = await probe();
      available = true;
      const recovered = await probe();
      assert({
        given: 'whole public-route failure then real ingress recovery',
        should:
          'return unhealthy then exercise a new durable receipt on recovery',
        actual: [outage, recovered],
        expected: [false, true],
      });
      const native = await fetch(`${origin}/api/rounds/${roundId}/check-in`, {
        method: 'POST',
        headers: {
          origin,
          cookie: signed.cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          version: '1',
          commandId: createId(),
          segmentId,
        }),
      });
      assert({
        given: 'actual explicit native POST through the same public route',
        should: 'show recorded feedback without Javascript presence inference',
        actual: [
          native.status,
          (await native.text()).includes('Attendance recorded'),
        ],
        expected: [200, true],
      });
      await f.sql`delete from session where user_id=${identity.principal.userId}`;
      const [before] =
        await f.sql`select count(*)::int as n from round_commands where round_id=${roundId}`;
      const revoked = await probe();
      const [after] =
        await f.sql`select count(*)::int as n from round_commands where round_id=${roundId}`;
      assert({
        given: 'revoked actual signed session',
        should: 'fail the probe without manufacturing a receipt alias',
        actual: [revoked, before.n === after.n],
        expected: [false, true],
      });
    });
  } finally {
    await server.stop(true);
  }
});
