import { mediaTestHuman } from './media-session.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { withFixture } from './constraint-helpers';
import { mediaTestStore, mediaTestTick } from './media-session.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('durable reconcile claims serve only the request horizon they actually started with', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const { roundId, seat } = await mediaTestHuman(fixture);
    const store = mediaTestStore(fixture.sql),
      otherProcess = mediaTestStore(fixture.sql);
    const binding = await store.ensureBinding({
      roundId,
      actorId: seat.actorId,
      buildProjection: mediaTestTick,
    });
    try {
      const first = await store.requestMediaReconcile({
        roundId,
        actorId: seat.actorId,
      });
      const claim = await store.claimMediaReconcile({
        sessionId: binding.sessionId,
        owner: createId(),
      });
      if (claim.kind !== 'claimed')
        throw new Error('First reconcile was not claimed');
      const second = await otherProcess.requestMediaReconcile({
        roundId,
        actorId: seat.actorId,
      });
      const competing = await otherProcess.claimMediaReconcile({
        sessionId: binding.sessionId,
        owner: createId(),
      });
      await store.finishMediaReconcile({
        ...claim.fence,
        absenceVerified: true,
      });
      const progress = await store.mediaReconcileProgress(binding.sessionId);
      assert({
        given: 'a second request arriving after an in-flight run starts',
        should:
          'serialize across instances without claiming that the old run served it',
        actual: [
          first.version,
          second.version,
          claim.runningVersion,
          competing.kind,
          progress.servedVersion,
          progress.endedAt,
        ],
        expected: [1, 2, 1, 'wait', 1, null],
      });
      const immediate = await store.claimMediaReconcile({
        sessionId: binding.sessionId,
        owner: createId(),
      });
      assert({
        given: 'a new claim inside the 500ms minimum interval',
        should: 'return the next scheduling instant instead of running twice',
        actual: immediate.kind,
        expected: 'wait',
      });
    } finally {
      await fixture.sql.unsafe('delete from media_sessions where id=$1', [
        binding.sessionId,
      ]);
    }
  });
});

test('restart, verified absence and late acknowledgement never erase unknown vendor outcomes', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const { roundId, seat } = await mediaTestHuman(fixture);
    const store = mediaTestStore(fixture.sql);
    const binding = await store.ensureBinding({
      roundId,
      actorId: seat.actorId,
      buildProjection: mediaTestTick,
    });
    try {
      await store.requestMediaReconcile({ roundId, actorId: seat.actorId });
      const claim = await store.claimMediaReconcile({
        sessionId: binding.sessionId,
        owner: createId(),
      });
      if (claim.kind !== 'claimed') throw new Error('Missing initial claim');
      const intent = await store.beginMediaMutation({
        ...claim.fence,
        intent: { kind: 'create', identity: null, payload: {} },
        buildProjection: mediaTestTick,
        authorize: () => undefined,
      });
      // Persisted process-crash state: no outcome arrived and the old owner's lease is expired.
      await fixture.sql.unsafe(
        "update media_sessions set reconcile_lease_until=clock_timestamp()-interval '1 second', reconcile_started_at=clock_timestamp()-interval '1 second' where id=$1",
        [binding.sessionId],
      );
      const restarted = mediaTestStore(fixture.sql);
      const recovery = await restarted.claimMediaReconcile({
        sessionId: binding.sessionId,
        owner: createId(),
      });
      if (recovery.kind !== 'claimed')
        throw new Error('Missing recovery claim');
      await assertRejects({
        given: 'a new process with an unresolved pre-crash creation',
        should: 'refuse another opening mutation',
        actual: () =>
          restarted.beginMediaMutation({
            ...recovery.fence,
            intent: { kind: 'create', identity: null, payload: {} },
            buildProjection: mediaTestTick,
            authorize: () => undefined,
          }),
        code: 'CONFLICT',
      });
      let signed = false;
      await assertRejects({
        given: 'unsafe persisted admission',
        should: 'refuse before signing a token',
        actual: () =>
          restarted.issueMediaToken({
            roundId,
            principal: { kind: 'human', actorId: seat.actorId },
            buildProjection: mediaTestTick,
            sign: async () => {
              signed = true;
              return 'must-never-sign';
            },
          }),
        code: 'INFRASTRUCTURE',
      });
      const result = await restarted.finishMediaReconcile({
        ...recovery.fence,
        absenceVerified: true,
      });
      assert({
        given:
          'one provider absence observation while old creation is still unresolved',
        should: 'retain unsafe state and never stamp ended',
        actual: [
          result.safe,
          result.ended,
          signed,
          (await restarted.mediaReconcileProgress(binding.sessionId)).endedAt,
        ],
        expected: [false, false, false, null],
      });
      await restarted.settleMediaMutation(intent);
      assert({
        given: 'a late real success response',
        should:
          'settle its immutable intent without silently clearing unsafe state',
        actual:
          (await restarted.mediaReconcileProgress(binding.sessionId))
            .unsafeAt !== null,
        expected: true,
      });
    } finally {
      await fixture.sql.unsafe('delete from media_sessions where id=$1', [
        binding.sessionId,
      ]);
    }
  });
});
