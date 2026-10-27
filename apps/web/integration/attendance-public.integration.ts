import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createTestApp } from './fixtures';
import { createAccountFlows, uniqueName } from './auth-account-helpers';
import { withAttendanceRound } from './attendance.test-support';
import { createPublicCheckInProbe } from '../src/features/availability/public-probe';
import { verifyAvailabilityLeaseCadence } from './availability-lease.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('real public ingress probe uses ordinary signed session, scoped seat and durable receipt aliases', async () => {
  let handler: ((request: Request) => Promise<Response>) | undefined;
  let available = true;
  const pending = new Set<Promise<Response>>();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      if (!available)
        return new Response('Public route unavailable', { status: 503 });
      const work = handler?.(request);
      if (!work) return new Response('Not ready', { status: 503 });
      pending.add(work);
      void work.then(
        () => pending.delete(work),
        () => pending.delete(work),
      );
      return work;
    },
  });
  const origin = server.url.origin;
  const policy = {
    consentTtlMs: 60_000,
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
      try {
        // Isolated resource setup: canonical Round seat belongs to the actual signed member.
        await f.sql`update round_participants set actor_id=${identity.principal.actorId} where round_id=${roundId} and role='affirmative'`;
        const mounted = app.routes.attendance;
        handler = (request) => {
          const { pathname } = new URL(request.url);
          if (
            pathname === `/api/rounds/${roundId}/check-in` &&
            request.method === 'POST'
          )
            return mounted.checkIn(request, roundId);
          // The probe's hourly session read reaches the real auth route.
          if (pathname.startsWith('/api/auth/') && request.method === 'GET')
            return app.routes.auth.GET(request);
          return Promise.resolve(new Response('Not found', { status: 404 }));
        };
        const participant = (await f.store.getRound(
          roundId,
        ))!.participants.find((p) => p.actorId === identity.principal.actorId)!;
        const probe = createPublicCheckInProbe({
          configuration: {
            origin,
            roundId,
            segmentId,
            participantId: participant.id,
            cookie: signed.cookie,
          },
          nextId: createId,
          nowMs: () => performance.now(),
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
          should:
            'show recorded feedback without Javascript presence inference',
          actual: [
            native.status,
            (await native.text()).includes('Attendance recorded'),
          ],
          expected: [200, true],
        });
        await verifyAvailabilityLeaseCadence({
          app: app.app,
          sql: f.sql,
          configuration: {
            origin,
            roundId,
            segmentId,
            participantId: participant.id,
            cookie: signed.cookie,
          },
        });
        // ISSUE-531: the probe's own session read slides a real session.
        const expiresInDays = async () => {
          const [row] =
            await f.sql`select extract(epoch from expires_at-now())/86400.0 as days from session where user_id=${identity.principal.userId} order by expires_at desc limit 1`;
          return Math.round(Number(row.days));
        };
        let sessionRead: Promise<Response> | undefined;
        const sliding = createPublicCheckInProbe({
          configuration: {
            origin,
            roundId,
            segmentId,
            participantId: participant.id,
            cookie: signed.cookie,
          },
          nextId: createId,
          nowMs: () => performance.now(),
          fetch: (url, init) => {
            const response = fetch(url, init);
            if (url.endsWith('/api/auth/get-session')) sessionRead = response;
            return response;
          },
        });
        const backdate = () =>
          f.sql`update session set expires_at=now()+interval '5 days', updated_at=now()-interval '2 days' where user_id=${identity.principal.userId}`;
        await backdate();
        const firstHealthy = await sliding();
        const firstRead = await sessionRead;
        const slid = await expiresInDays();
        await backdate();
        sessionRead = undefined;
        const secondHealthy = await sliding();
        assert({
          given:
            'a probe session five days from expiry, then the same probe again inside its refresh interval',
          should:
            'slide it to the full seven days through get-session on the first probe, and leave it alone on the second',
          actual: {
            healthy: [firstHealthy, secondHealthy],
            readStatus: firstRead?.status,
            slid,
            secondRead: sessionRead === undefined,
            unslid: await expiresInDays(),
          },
          expected: {
            healthy: [true, true],
            readStatus: 200,
            slid: 7,
            secondRead: true,
            unslid: 5,
          },
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
      } finally {
        // Drain request/deferred work before withAttendanceRound deletes the Round.
        // The signed actor remains owned by createTestApp until its later teardown.
        await server.stop(true);
        await Promise.allSettled([...pending]);
        await app.app.auth().settled();
      }
    });
  } finally {
    await server.stop(true);
  }
});
