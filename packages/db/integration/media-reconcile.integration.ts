import { mediaTestHuman } from './media-session.test-support';
import { admitsPrincipalAccess } from '@daisy/auth/authorization';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { withFixture } from './constraint-helpers';
import { mediaTestStore, mediaTestTick } from './media-session.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

async function reconcileFixture(fixture: Parameters<typeof mediaTestHuman>[0]) {
  const { roundId, seat } = await mediaTestHuman(fixture);
  const store = mediaTestStore(fixture.sql);
  const caller = { actorId: seat.actorId, admits: admitsPrincipalAccess };
  const binding = await store.ensureBinding({
    roundId,
    caller,
    buildProjection: mediaTestTick,
  });
  /** The seated human asks this store for a reconcile. */
  const request = (by: typeof store = store) =>
    by.requestMediaReconcile({ roundId, caller });
  return { roundId, seat, store, binding, request };
}

test('durable reconcile claims serve only the request horizon they actually started with', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const { store, binding, request } = await reconcileFixture(fixture);
    const otherProcess = mediaTestStore(fixture.sql);
    try {
      const first = await request();
      const claim = await store.claimMediaReconcile({
        sessionId: binding.sessionId,
        owner: createId(),
      });
      if (claim.kind !== 'claimed')
        throw new Error('First reconcile was not claimed');
      const second = await request(otherProcess);
      const competing = await otherProcess.claimMediaReconcile({
        sessionId: binding.sessionId,
        owner: createId(),
      });
      await store.finishMediaReconcile({
        ...claim.fence,
        absenceProof: await store.prepareMediaAbsenceProof(claim.fence),
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
    const { roundId, seat, store, binding, request } =
      await reconcileFixture(fixture);
    try {
      await request();
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
            principal: {
              kind: 'human',
              actorId: seat.actorId,
              admits: admitsPrincipalAccess,
            },
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
        absenceProof: await restarted.prepareMediaAbsenceProof(recovery.fence),
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
      await restarted.settleMediaMutation(intent, 'succeeded');
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

test('absence proof cannot cross a different reconciliation fence or later mutation horizon', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const { store, binding } = await reconcileFixture(fixture);
    try {
      const claim = await store.claimMediaReconcile({
        sessionId: binding.sessionId,
        owner: createId(),
      });
      if (claim.kind !== 'claimed') throw new Error('Missing proof claim');
      const proof = await store.prepareMediaAbsenceProof(claim.fence);
      const intent = await store.beginMediaMutation({
        ...claim.fence,
        intent: { kind: 'create', identity: null, payload: {} },
        buildProjection: mediaTestTick,
        authorize: () => undefined,
      });
      await store.markMediaUnsafe(claim.fence);
      assert({
        given: 'an outstanding actual durable intent',
        should: 'refuse an absence proof before it settles',
        actual: await store.prepareMediaAbsenceProof(claim.fence),
        expected: null,
      });
      await store.settleMediaMutation(intent, 'succeeded');
      const result = await store.finishMediaReconcile({
        ...claim.fence,
        absenceProof: proof,
      });
      assert({
        given:
          'an old proof followed by a newly dispatched and settled mutation',
        should:
          'retain uncertainty because the immutable mutation horizon changed',
        actual: result.safe,
        expected: false,
      });
      await fixture.sql`update media_sessions set reconcile_started_at=reconcile_started_at-interval '1 second' where id=${binding.sessionId}`;
      const next = await store.claimMediaReconcile({
        sessionId: binding.sessionId,
        owner: createId(),
      });
      if (next.kind !== 'claimed') throw new Error('Missing next proof claim');
      const current = await store.prepareMediaAbsenceProof(next.fence);
      if (!current) throw new Error('Settled horizon missing');
      const refused = await store.finishMediaReconcile({
        ...next.fence,
        absenceProof: { ...current, owner: claim.fence.owner },
      });
      assert({
        given: 'a settled horizon bearing a different owner fence',
        should: 'retain uncertainty',
        actual: refused.safe,
        expected: false,
      });
    } finally {
      await fixture.sql`delete from media_sessions where id=${binding.sessionId}`;
    }
  });
});

test('an aborted reconcile past its lease never holds media admission', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const { roundId, seat, store, binding } = await reconcileFixture(fixture);
    const admit = () =>
      store.issueMediaToken({
        roundId,
        principal: {
          kind: 'human',
          actorId: seat.actorId,
          admits: admitsPrincipalAccess,
        },
        buildProjection: mediaTestTick,
        sign: async () => 'signed',
      });
    const reconciling = async () =>
      (
        await store.readMediaSession({
          roundId,
          buildProjection: mediaTestTick,
        })
      )?.reconciling;
    try {
      const claim = await store.claimMediaReconcile({
        sessionId: binding.sessionId,
        owner: createId(),
      });
      if (claim.kind !== 'claimed') throw new Error('Missing claim');
      const live = await reconciling();
      await assertRejects({
        given: 'a reconcile inside its lease',
        should: 'refuse admission for now',
        actual: admit,
        code: 'INFRASTRUCTURE',
      });
      // The owner crashed: its row stays, but its lease ran out on the database clock.
      await fixture.sql`update media_sessions set reconcile_lease_until=clock_timestamp()-interval '1 second' where id=${binding.sessionId}`;
      assert({
        given: 'the same owner after its lease expired',
        should: 'report no live reconcile and admit the human',
        actual: [live, await reconciling(), await admit()],
        expected: [true, false, 'signed'],
      });
    } finally {
      await fixture.sql`delete from media_sessions where id=${binding.sessionId}`;
    }
  });
});
