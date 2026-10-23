import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { withBotPublication } from './bot-publication.test-support';
setupRitewayBun();
requireTestServices(process.env);
test('concurrent bot claims preserve one active run and epochs through takeover', async () => {
  await withBotPublication(async ({ operations, target, fixture }) => {
    const attempts = await Promise.allSettled([
      operations.claimWorker(target),
      operations.claimWorker(target),
    ]);
    const winner = attempts.find((result) => result.status === 'fulfilled');
    if (winner?.status !== 'fulfilled')
      throw new Error('Expected one publication claim');
    const claim = winner.value;
    assert({
      given: 'two claims on one bot seat',
      should: 'admit one run and refuse the concurrent claimant',
      actual: attempts.map((a) => a.status).sort(),
      expected: ['fulfilled', 'rejected'],
    });
    const [seats] =
      await fixture.sql`select coalesce(array_agg(id order by id) filter (where role<>'judge' and id<>${target.roundParticipantId}),'{}') peers,(select type from round_segments where id=${target.segmentId}) kind from round_participants where round_id=${target.roundId}`;
    assert({
      given: 'an actual claim on the latest started segment',
      should: 'name its segment kind and every other debater seat',
      actual: [claim.segmentType, [...claim.peerParticipantIds].sort()],
      expected: [seats.kind, seats.peers],
    });
    await operations.verifyBotPublication(claim.scope, claim.token);
    await operations.renewWorker(claim.scope, claim.token);
    for (const [scope, token] of [
      [{ ...claim.scope, serviceId: 'foreign' }, claim.token],
      [claim.scope, 'a'.repeat(43)],
    ] as const)
      await assertRejects({
        given: 'foreign service or bearer',
        should: 'refuse publication without mutation',
        actual: () => operations.verifyBotPublication(scope, token),
        code: 'AUTHORIZATION',
      });
    await operations.revoke(claim.scope, claim.token);
    await assertRejects({
      given: 'a revoked claim',
      should: 'never resurrect the same epoch',
      actual: () => operations.renewWorker(claim.scope, claim.token),
      code: 'CONFLICT',
    });
    const next = await operations.claimWorker(target);
    assert({
      given: 'takeover after revocation',
      should: 'increment epoch, replace run and create no transcript',
      actual: [
        next.scope.publicationEpoch,
        next.scope.agentRunId !== claim.scope.agentRunId,
        await fixture.count('utterances', 'round_id', target.roundId),
      ],
      expected: [2, true, 0],
    });
    await assertRejects({
      given: 'old epoch after takeover',
      should: 'remain fenced',
      actual: () => operations.verifyBotPublication(claim.scope, claim.token),
      code: 'CONFLICT',
    });
  });
});
test('full historical windows are required and closed current authority cannot dispatch', async () => {
  await withBotPublication(async ({ operations, target, fixture }) => {
    const claim = await operations.claimWorker(target);
    const [interval] =
      await fixture.sql`select started_at from round_speaking_intervals where round_id=${target.roundId}`;
    const start = new Date(interval!.started_at).getTime();
    const window = { beforeMs: start + 1, afterMs: start + 11 };
    await operations.verifyBotPublication(claim.scope, claim.token, window);
    await assertRejects({
      given: 'a bracket crossing opening',
      should: 'refuse uncertain credit',
      actual: () =>
        operations.verifyBotPublication(claim.scope, claim.token, {
          beforeMs: start - 1,
          afterMs: start + 9,
        }),
      code: 'CONFLICT',
    });
    await fixture.sql`update round_speaking_intervals set ended_at=clock_timestamp(),ended_version=2 where round_id=${target.roundId}`;
    await assertRejects({
      given: 'closed speaking floor with live lease',
      should: 'refuse new generation or dispatch',
      actual: () => operations.verifyBotPublication(claim.scope, claim.token),
      code: 'CONFLICT',
    });
    await fixture.sql`update agent_runs set ended_at=clock_timestamp() where id=${claim.scope.agentRunId}`;
    await assertRejects({
      given: 'ended actual AgentRun',
      should: 'refuse even historically eligible prefix',
      actual: () =>
        operations.verifyBotPublication(claim.scope, claim.token, window),
      code: 'AUTHORIZATION',
    });
  });
});
test('expired leases and erased human accounts cannot authorize a bot run', async () => {
  await withBotPublication(async ({ operations, target, fixture }) => {
    const userId = await fixture.user();
    const actorId = await fixture.actor(userId);
    await fixture.seat(target.roundId, 'negative', 0, actorId);
    await assertRejects({
      given: 'an unverified human account in the frozen Round',
      should: 'deny generation before allocating a run or lease',
      actual: () => operations.claimWorker(target),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'refused account authority',
      should: 'leave claims absent',
      actual: await fixture.count(
        'round_bot_publications',
        'round_id',
        target.roundId,
      ),
      expected: 0,
    });
    await fixture.sql`update users set email_verified=true where id=${userId}`;
    const claim = await operations.claimWorker(target);
    await fixture.sql`update round_bot_publications set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${target.roundId}`;
    await assertRejects({
      given: 'a durable expired lease with an otherwise active run',
      should: 'refuse publication without a takeover',
      actual: () => operations.verifyBotPublication(claim.scope, claim.token),
      code: 'CONFLICT',
    });
    const next = await operations.claimWorker(target);
    await fixture.sql`update users set username=null,email=null,image=null,name='',deleted_at=clock_timestamp() where id=${userId}`;
    await assertRejects({
      given: 'an erased human participant after admission',
      should: 'fail current authority closed',
      actual: () => operations.verifyBotPublication(next.scope, next.token),
      code: 'AUTHORIZATION',
    });
  });
});
test('idle control heartbeat survives a closed floor independently of publication', async () => {
  await withBotPublication(async ({ operations, target, fixture }) => {
    await fixture.sql`update round_speaking_intervals set ended_at=clock_timestamp(),ended_version=2 where round_id=${target.roundId}`;
    const claim = await operations.claimWorker(target);
    await operations.verifyBotWorker(claim.scope, claim.token);
    await operations.renewWorker(claim.scope, claim.token);
    await assertRejects({
      given:
        'an idle bot with a healthy control lease and closed speaking floor',
      should: 'refuse publication without declaring worker absence',
      actual: () => operations.verifyBotPublication(claim.scope, claim.token),
      code: 'CONFLICT',
    });
    await operations.verifyBotWorker(claim.scope, claim.token);
    await fixture.sql`update round_segments set ended_at=clock_timestamp() where id=${target.segmentId}`;
    await operations.renewWorker(claim.scope, claim.token);
    assert({
      given:
        'a failed publication or ended segment while the controller remains healthy',
      should: 'retain the scoped active worker without transcript credit',
      actual: [
        await fixture.count('agent_runs', 'id', claim.scope.agentRunId),
        await fixture.count('utterances', 'round_id', target.roundId),
      ],
      expected: [1, 0],
    });
    await operations.revoke(claim.scope, claim.token);
    await assertRejects({
      given: 'an explicitly revoked control lease',
      should: 'refuse attendance authority',
      actual: () => operations.verifyBotWorker(claim.scope, claim.token),
      code: 'CONFLICT',
    });
  });
});
test('worker principal authority survives a closed floor and ended segment, and refuses an expired lease', async () => {
  await withBotPublication(async ({ operations, target, fixture, run }) => {
    const { verifyBotWorkerPrincipalLocked } =
      await import('../src/bot-worker-authority');
    const claim = await operations.claimWorker(target);
    const principal = {
      kind: 'agent' as const,
      serviceId: claim.scope.serviceId,
      agentRunId: claim.scope.agentRunId,
      participantId: claim.scope.roundParticipantId,
      publicationEpoch: claim.scope.publicationEpoch,
    };
    await fixture.sql`update round_speaking_intervals set ended_at=clock_timestamp(),ended_version=2 where round_id=${target.roundId}`;
    await fixture.sql`update round_segments set ended_at=clock_timestamp() where id=${target.segmentId}`;
    assert({
      given:
        'a scoped idle controller after its floor closed and the last actual speech ended',
      should: 'keep check-in authority for unresolved historical attendance',
      actual: await run((tx) =>
        verifyBotWorkerPrincipalLocked(tx, principal, target.roundId),
      ),
      expected: undefined,
    });
    await fixture.sql`update round_bot_publications set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${target.roundId} and round_participant_id=${target.roundParticipantId}`;
    await assertRejects({
      given: 'an expired control lease',
      should: 'refuse check-in authority without guessing absence',
      actual: () =>
        run((tx) =>
          verifyBotWorkerPrincipalLocked(tx, principal, target.roundId),
        ),
      code: 'CONFLICT',
    });
  });
});

test('controller restart after the final actual segment grants no new publication window', async () => {
  await withBotPublication(async ({ operations, target, fixture }) => {
    const old = await operations.claimWorker(target);
    await fixture.sql`update round_segments set ended_at=clock_timestamp() where id=${target.segmentId}`;
    await operations.revoke(old.scope, old.token);
    const fresh = await operations.claimWorker(target);
    await operations.verifyBotWorker(fresh.scope, fresh.token);
    await assertRejects({
      given: 'a healthy restarted controller after the last segment ended',
      should: 'refuse new publication without inventing a new window',
      actual: () => operations.verifyBotPublication(fresh.scope, fresh.token),
      code: 'CONFLICT',
    });
    assert({
      given: 'an active Round with unresolved historical attendance',
      should: 'recover verified control with a fresh epoch and no transcript',
      actual: [
        fresh.scope.publicationEpoch,
        await fixture.count('utterances', 'round_id', target.roundId),
      ],
      expected: [2, 0],
    });
  });
});
test('authorized windows are stored as credited runs and refused ones are not (DEC-212, DEC-218)', async () => {
  await withBotPublication(async ({ operations, target, fixture }) => {
    const claim = await operations.claimWorker(target);
    const [interval] =
      await fixture.sql`select started_at from round_speaking_intervals where round_id=${target.roundId}`;
    const start = new Date(interval!.started_at).getTime();
    await operations.verifyBotPublication(claim.scope, claim.token);
    for (const [before, after] of [
      [1, 11],
      [11, 21],
      [100, 110],
      [15, 30],
    ])
      await operations.verifyBotPublication(claim.scope, claim.token, {
        beforeMs: start + before!,
        afterMs: start + after!,
      });
    await operations
      .verifyBotPublication(claim.scope, claim.token, {
        beforeMs: start - 1,
        afterMs: start + 9,
      })
      .catch(() => undefined);
    const rows =
      await fixture.sql`select credited_from,credited_until from round_bot_publication_windows where round_id=${target.roundId} and segment_id=${target.segmentId} and round_participant_id=${target.roundParticipantId} order by credited_from`;
    assert({
      given:
        'a plain verification, touching and overlapping windows, a separate one and a refused bracket',
      should: 'store one credited row per contiguous run, nothing else',
      actual: rows.map((row: { credited_from: Date; credited_until: Date }) => [
        row.credited_from.getTime() - start,
        row.credited_until.getTime() - start,
      ]),
      expected: [
        [1, 30],
        [100, 110],
      ],
    });
  });
});
