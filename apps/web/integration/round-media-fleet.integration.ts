import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createMediaService } from '@daisy/media';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import { startRoundMediaRecovery } from '../src/server/round-media-recovery';
import { mediaDependencies, withMediaRound } from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('one actual provider failure does not prevent cleanup of another terminal media session', async () => {
  await withMediaRound(async (f) => {
    await f.mediaOperations.session(f.roundId, f.host.actorId);
    // A second Room needs its own cast: one user holds one active Room (ADR 0070).
    const cast = await f.freshCast();
    const fresh = await f.command(cast.host, await f.assemble({}, cast), {
      type: 'start-round',
    });
    const terminalRoundId = fresh.view.roundRef!.id;
    await f.mediaOperations.session(terminalRoundId, cast.host.actorId);
    const sessions = await f.store.mediaSessions.activeMediaSessions();
    const [failed] =
      await f.sql`select room_name from media_sessions where round_id=${f.roundId}`;
    const [terminal] =
      await f.sql`select room_name from media_sessions where round_id=${terminalRoundId}`;
    await f.sql`update rounds set status='abandoned',current_stage=null,completed_at=clock_timestamp() where id=${terminalRoundId}`;
    let blocked = true;
    const proxy = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = await request.arrayBuffer();
        if (
          blocked &&
          url.pathname.endsWith('/ListRooms') &&
          JSON.parse(new TextDecoder().decode(body)).names?.includes(
            failed!.room_name,
          )
        )
          return new Response('Unavailable', { status: 503 });
        return fetch(`${f.mediaConfig.url}${url.pathname}`, {
          method: request.method,
          headers: request.headers,
          body,
        });
      },
    });
    const reports: string[] = [];
    const operations = createRoundMediaOperations({
      ...mediaDependencies(
        f,
        createMediaService({
          config: { ...f.mediaConfig, url: `http://127.0.0.1:${proxy.port}` },
        }),
      ),
      reporter: {
        capture: (_error, context) => {
          reports.push(context.errorCode);
        },
      },
    });
    try {
      await operations.recoverActiveSessions();
      const [closed] =
        await f.sql`select ended_at from media_sessions where round_id=${terminalRoundId}`;
      assert({
        given:
          'an actual vendor ListRooms503 for one session and an unrelated terminal commit',
        should:
          'report the failed session and verify actual deletion of the terminal room in the same cycle',
        actual: [
          sessions.length >= 2,
          reports.includes('INFRASTRUCTURE'),
          closed!.ended_at !== null,
          await f.media.exists(terminal!.room_name),
        ],
        expected: [true, true, true, false],
      });
      blocked = false;
      await operations.recoverActiveSessions();
      const [recovered] =
        await f.sql`select unsafe_at from media_sessions where round_id=${f.roundId}`;
      assert({
        given: 'actual vendor ingress restored on a later recovery cycle',
        should:
          'never have marked the active session unsafe or deleted its room for a transient vendor 503 (ISSUE-803)',
        actual: [
          recovered!.unsafe_at,
          (await f.store.getRound(f.roundId))!.status,
          await f.media.exists(failed!.room_name),
        ],
        expected: [null, 'active', true],
      });
    } finally {
      proxy.stop(true);
      if (await f.media.exists(terminal!.room_name))
        await f.media.deleteRoom(terminal!.room_name);
    }
  });
});

// ISSUE-972: the tick is the floor's last resort when every browser read is held,
// so another Round's slow provider call must not stand between it and this Round.
test('a Round whose provider call hangs does not hold another Round on the recovery tick', async () => {
  await withMediaRound(async (f) => {
    await f.mediaOperations.session(f.roundId, f.host.actorId);
    const cast = await f.freshCast();
    const fresh = await f.command(cast.host, await f.assemble({}, cast), {
      type: 'start-round',
    });
    const otherRoundId = fresh.view.roundRef!.id;
    await f.mediaOperations.session(otherRoundId, cast.host.actorId);
    // Older of the two, so a tick that visits sessions in turn meets it first.
    const [hung] =
      await f.sql`select room_name from media_sessions where round_id=${f.roundId}`;
    const [moving] =
      await f.sql`select id from media_sessions where round_id=${otherRoundId}`;
    const movingSessionId = String(moving!.id);
    const servedBefore = (
      await f.store.mediaSessions.mediaReconcileProgress(movingSessionId)
    ).servedVersion;
    const hang = Promise.withResolvers<void>();
    let hangs = 0;
    const proxy = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      idleTimeout: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = await request.arrayBuffer();
        if (
          url.pathname.endsWith('/ListRooms') &&
          JSON.parse(new TextDecoder().decode(body)).names?.includes(
            hung!.room_name,
          )
        ) {
          hangs++;
          await hang.promise;
        }
        return fetch(`${f.mediaConfig.url}${url.pathname}`, {
          method: request.method,
          headers: request.headers,
          body,
        });
      },
    });
    const operations = createRoundMediaOperations({
      ...mediaDependencies(
        f,
        createMediaService({
          config: { ...f.mediaConfig, url: `http://127.0.0.1:${proxy.port}` },
        }),
      ),
      // No 2 s cap, so the hang lasts until this test ends it, not until a timer.
      deadline: (work) => work,
    });
    const recovery = startRoundMediaRecovery({
      recover: () => operations.recoverActiveSessions(),
      failed: () => {
        throw Error('unexpected recovery failure');
      },
      every: (ms, tick) => {
        const timer = setInterval(tick, ms);
        return { stop: () => clearInterval(timer) };
      },
    });
    try {
      const served = async () =>
        (await f.store.mediaSessions.mediaReconcileProgress(movingSessionId))
          .servedVersion;
      const giveUpAt = performance.now() + 3_000;
      while ((await served()) === servedBefore && performance.now() < giveUpAt)
        await Bun.sleep(25);
      assert({
        given: 'one session whose provider call never answers',
        should: 'serve the other Round on the tick while that call still hangs',
        actual: [hangs > 0, (await served()) > servedBefore],
        expected: [true, true],
      });
    } finally {
      hang.resolve();
      await recovery.stop();
      proxy.stop(true);
    }
  });
});

// ISSUE-972: what the tick reads is what decides, at one read per tick.
test('the tick passes a Round only when its read shows one is due', async () => {
  await withMediaRound(async (f) => {
    await f.mediaOperations.session(f.roundId, f.host.actorId);
    const [session] =
      await f.sql`select id from media_sessions where round_id=${f.roundId}`;
    const sessionId = String(session!.id);
    const operations = createRoundMediaOperations({
      ...mediaDependencies(f),
      store: f.store.mediaSessions,
      recoveryHeartbeatMs: 60_000,
    });
    // Past the minimum interval, so only what the read shows decides.
    await f.sql`update media_sessions set reconcile_started_at=clock_timestamp() - interval '1 second' where id=${sessionId}`;
    await f.sql`update rounds set updated_at=clock_timestamp() - interval '1 minute' where id=${f.roundId}`;
    const served = async () =>
      (await f.store.mediaSessions.mediaReconcileProgress(sessionId))
        .servedVersion;
    const requested = async () =>
      Number(
        (
          await f.sql`select reconcile_request_version as v from media_sessions where id=${sessionId}`
        )[0]!.v,
      );
    const before = await requested();
    await operations.recoverActiveSessions();
    assert({
      given: 'a Round passed just now, with no commit and no boundary since',
      should: 'cost no pass',
      actual: await requested(),
      expected: before,
    });
    await f.sql`update rounds set updated_at=clock_timestamp() where id=${f.roundId}`;
    await operations.recoverActiveSessions();
    assert({
      given: 'a commit on the Round after that pass',
      should: 'pass it on the next tick and serve the request',
      actual: [await requested(), (await served()) >= before + 1],
      expected: [before + 1, true],
    });
    const read = async () =>
      (await f.store.mediaSessions.activeMediaSessions()).find(
        (row) => row.roundId === f.roundId,
      )!;
    const round = await read();
    assert({
      given: 'the one read of a real session',
      should: 'return the clock facts the decision reads',
      actual: [
        round.clock.segmentTotal > 0,
        Number.isInteger(round.clock.countdownMs),
        round.lastPassAt !== null,
        round.unsafe,
        round.lastPassClean,
      ],
      expected: [true, true, true, false, true],
    });
    await f.sql`update media_sessions set reconcile_owner='other', reconcile_lease_until=clock_timestamp() + interval '10 seconds', deletion_requested_at=clock_timestamp() where id=${sessionId}`;
    const held = await read();
    await f.sql`update media_sessions set reconcile_owner=null, reconcile_lease_until=null, deletion_requested_at=null, reconcile_started_at=clock_timestamp() - interval '1 second' where id=${sessionId}`;
    assert({
      given: 'a live lease and a deletion request',
      should: 'read as not claimable and unsafe',
      actual: [held.claimable, held.unsafe, (await read()).claimable],
      expected: [false, true, true],
    });
    const preparing = '2026-01-01T00:00:00.000Z';
    await f.sql`update rounds set rules_snapshot=jsonb_set(rules_snapshot, '{inRoundPrep}', '{"budgetMsPerSide": 60000}'::jsonb), runtime_state=jsonb_set(jsonb_set(runtime_state, '{active_prep}', jsonb_build_object('side', 'negative', 'started_at', ${preparing}::text)), '{prep_consumed_ms,negative}', '7000'::jsonb) where id=${f.roundId}`;
    assert({
      given: 'a side in in-round prep with time consumed',
      should: "return its budget and that side's consumed time",
      actual: [
        (await read()).clock.prepBudgetMs,
        (await read()).clock.activePrep,
      ],
      expected: [60_000, { startedAt: preparing, consumedMs: 7_000 }],
    });
  });
});

// ISSUE-972: claiming advances the last pass, so only this fact says it did not finish.
test('a pass that fails leaves its Round due before the heartbeat', async () => {
  await withMediaRound(async (f) => {
    await f.mediaOperations.session(f.roundId, f.host.actorId);
    const [session] =
      await f.sql`select id,room_name from media_sessions where round_id=${f.roundId}`;
    let failing = true;
    const proxy = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = await request.arrayBuffer();
        if (
          failing &&
          url.pathname.endsWith('/ListRooms') &&
          JSON.parse(new TextDecoder().decode(body)).names?.includes(
            session!.room_name,
          )
        )
          return new Response('Unavailable', { status: 503 });
        return fetch(`${f.mediaConfig.url}${url.pathname}`, {
          method: request.method,
          headers: request.headers,
          body,
        });
      },
    });
    const operations = createRoundMediaOperations({
      ...mediaDependencies(
        f,
        createMediaService({
          config: { ...f.mediaConfig, url: `http://127.0.0.1:${proxy.port}` },
        }),
      ),
      store: f.store.mediaSessions,
      recoveryHeartbeatMs: 60_000,
    });
    const passes = async () =>
      Number(
        (
          await f.sql`select reconcile_request_version as v from media_sessions where id=${session!.id}`
        )[0]!.v,
      );
    const clean = async () =>
      Boolean(
        (
          await f.sql`select reconcile_last_pass_clean as c from media_sessions where id=${session!.id}`
        )[0]!.c,
      );
    const pastInterval = () =>
      f.sql`update media_sessions set reconcile_started_at=clock_timestamp() - interval '1 second' where id=${session!.id}`;
    try {
      await pastInterval();
      await f.sql`update rounds set updated_at=clock_timestamp() where id=${f.roundId}`;
      await operations.recoverActiveSessions();
      const cleanAfterFailure = await clean();
      const passesAfterFailure = await passes();
      await pastInterval();
      await f.sql`update rounds set updated_at=clock_timestamp() - interval '1 minute' where id=${f.roundId}`;
      failing = false;
      await operations.recoverActiveSessions();
      assert({
        given: 'a floor pass whose provider read failed, with no commit since',
        should: 'read as unfinished and pass again before the heartbeat',
        actual: [cleanAfterFailure, await passes(), await clean()],
        expected: [false, passesAfterFailure + 1, true],
      });
    } finally {
      proxy.stop(true);
    }
  });
});
