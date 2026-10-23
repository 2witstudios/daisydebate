import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { mediaCaptureOperations } from '../src/media-capture';
import { historicalCapture } from './media-capture.test-support';
import { withBoundedRound } from './bounded-transaction.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('internal capture token admission requires a fresh exact lease and safe nonterminal session', async () => {
  await withBoundedRound(async (fixture, transaction, roundId) => {
    const scope = {
      roundId,
      sessionId: createId(),
      workerId: createId(),
      epoch: 1,
    };
    const store = mediaCaptureOperations({
      sttLagMs: 60_000,
      transaction,
      nextId: createId,
      buildProjection: () => {
        throw new Error(
          'A scheduled Round must not invent a running projection',
        );
      },
    });
    try {
      await fixture.insert('media_sessions', {
        id: scope.sessionId,
        round_id: roundId,
        room_name: createId(),
      });
      await assertRejects({
        given: 'no capture lease',
        should: 'refuse token scope verification',
        code: 'CONFLICT',
        actual: () => store.verifyMediaWorkerLease(scope),
      });
      const claimed = await store.claimMediaWorkerLease({
        roundId,
        sessionId: scope.sessionId,
        workerId: scope.workerId,
        leaseMs: 15000,
      });
      const verified = await store.verifyMediaWorkerLease(scope);
      const { serverNow, ...verifiedScope } = verified;
      assert({
        given: 'the fresh post-lock PostgreSQL calibration stamp',
        should: 'precede this verified lease deadline',
        actual:
          Number.isFinite(Date.parse(serverNow)) &&
          Date.parse(serverNow) < Date.parse(claimed.expiresAt),
        expected: true,
      });
      assert({
        given: 'an exact live capture lease',
        should: 'return only its server scope and lease deadline',
        actual: verifiedScope,
        expected: { ...scope, expiresAt: claimed.expiresAt },
      });
      for (const change of [{ workerId: createId() }, { epoch: 2 }])
        await assertRejects({
          given: 'a stale worker epoch or foreign session',
          should: 'refuse token scope',
          code: 'CONFLICT',
          actual: () => store.verifyMediaWorkerLease({ ...scope, ...change }),
        });
      await fixture.sql.unsafe(
        'update media_sessions set unsafe_at=clock_timestamp() where id=$1',
        [scope.sessionId],
      );
      await assertRejects({
        given: 'an unsafe session',
        should: 'refuse capture token admission',
        code: 'CONFLICT',
        actual: () => store.verifyMediaWorkerLease(scope),
      });
      await fixture.sql.unsafe(
        'update media_sessions set unsafe_at=null where id=$1',
        [scope.sessionId],
      );
      const pendingId = createId();
      await fixture.insert('media_vendor_mutations', {
        id: pendingId,
        session_id: scope.sessionId,
        epoch: 0,
        kind: 'create',
        payload: {},
      });
      await assertRejects({
        given: 'an unresolved vendor operation despite no unsafe timestamp',
        should: 'refuse capture token admission',
        code: 'CONFLICT',
        actual: () => store.verifyMediaWorkerLease(scope),
      });
      await fixture.sql.unsafe(
        "update media_vendor_mutations set settled_at=clock_timestamp(),outcome='failed' where id=$1",
        [pendingId],
      );
      await fixture.sql.unsafe(
        'update media_sessions set unsafe_at=null,ended_at=clock_timestamp() where id=$1',
        [scope.sessionId],
      );
      await assertRejects({
        given: 'an ended session',
        should: 'refuse capture token admission',
        code: 'CONFLICT',
        actual: () => store.verifyMediaWorkerLease(scope),
      });
      await fixture.sql.unsafe(
        'update media_sessions set ended_at=null,deletion_requested_at=clock_timestamp() where id=$1',
        [scope.sessionId],
      );
      await assertRejects({
        given: 'a session with a deletion request',
        should: 'refuse capture token admission (CAP-E.1-r6)',
        code: 'CONFLICT',
        actual: () => store.verifyMediaWorkerLease(scope),
      });
      await fixture.sql.unsafe(
        'update media_sessions set deletion_requested_at=null where id=$1',
        [scope.sessionId],
      );
      await fixture.sql.unsafe(
        "update media_worker_leases set expires_at=clock_timestamp()-interval '1 second' where session_id=$1",
        [scope.sessionId],
      );
      await assertRejects({
        given: 'an expired lease',
        should: 'refuse capture token admission',
        code: 'CONFLICT',
        actual: () => store.verifyMediaWorkerLease(scope),
      });
      const fresh = await store.claimMediaWorkerLease({
        roundId,
        sessionId: scope.sessionId,
        workerId: scope.workerId,
        leaseMs: 15000,
      });
      await fixture.sql.unsafe(
        "update rounds set status='abandoned',completed_at=clock_timestamp() where id=$1",
        [roundId],
      );
      await assertRejects({
        given: 'a terminal Round with a still-live worker lease',
        should: 'refuse new capture token admission',
        code: 'CONFLICT',
        actual: () =>
          store.verifyMediaWorkerLease({ ...scope, epoch: fresh.epoch }),
      });
    } finally {
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
    }
  });
});

test('signed capture reader returns only scoped debater bindings and committed historical intervals', async () => {
  await withBoundedRound(async (fixture, transaction, roundId) => {
    const { store, lease, clip, start, end } = await historicalCapture(
      fixture,
      transaction,
      roundId,
    );
    try {
      await store.claimMediaWorkerLease({ ...lease, leaseMs: 15000 });
      const scope = { ...lease, epoch: 1 };
      const bindingId = createId(),
        identity = createId();
      await fixture.insert('media_participants', {
        id: bindingId,
        session_id: lease.sessionId,
        round_id: roundId,
        round_participant_id: clip.roundParticipantId,
        identity,
      });
      const judge = await fixture.seat(roundId, 'judge');
      await fixture.insert('media_participants', {
        id: createId(),
        session_id: lease.sessionId,
        round_id: roundId,
        round_participant_id: judge.id,
        identity: createId(),
      });
      const state = await store.readMediaCaptureState({
        ...scope,
        segmentId: clip.segmentId,
      });
      assert({
        given: 'a valid historical capture lease and a hidden judge binding',
        should: 'read only the actual debater stream and full durable grant',
        actual: {
          seats: state.participants.map((p) => ({
            roundParticipantId: p.roundParticipantId,
            identity: p.identity,
          })),
          segmentId: state.segment?.id,
          intervals: state.intervals.map((i) => ({
            roundParticipantId: i.roundParticipantId,
            startedAt: i.startedAt,
            endedAt: i.endedAt,
          })),
          next: state.nextIntervalId,
        },
        expected: {
          seats: [{ roundParticipantId: clip.roundParticipantId, identity }],
          segmentId: clip.segmentId,
          intervals: [
            {
              roundParticipantId: clip.roundParticipantId,
              startedAt: start.toISOString(),
              endedAt: end.toISOString(),
            },
          ],
          next: null,
        },
      });
      await assertRejects({
        given: 'a different snapshot version while paging history',
        should: 'refuse mixed authoritative history',
        code: 'CONFLICT',
        actual: () =>
          store.readMediaCaptureState({
            ...scope,
            segmentId: clip.segmentId,
            expectedVersion: state.version + 1,
          }),
      });
      const conversation = await store.readMediaCaptureState(scope);
      assert({
        given: 'no currently open competitive segment',
        should: 'supply no capture interval for conversation',
        actual: [conversation.segment, conversation.intervals],
        expected: [null, []],
      });
    } finally {
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
    }
  });
});

test('capture history pagination requires one exact version and never silently truncates grants', async () =>
  withBoundedRound(async (fixture, transaction, roundId) => {
    const { store, lease, clip, start } = await historicalCapture(
      fixture,
      transaction,
      roundId,
    );
    try {
      await store.claimMediaWorkerLease({ ...lease, leaseMs: 15000 });
      const scope = { ...lease, epoch: 1, segmentId: clip.segmentId };
      await assertRejects({
        given: 'a cursor without its snapshot version',
        should: 'refuse mixed historical pages',
        code: 'VALIDATION',
        actual: () =>
          store.readMediaCaptureState({
            ...scope,
            afterIntervalId: createId(),
          }),
      });
      await fixture.sql.unsafe(
        'delete from round_speaking_intervals where round_id=$1',
        [roundId],
      );
      await fixture.sql.unsafe(
        "insert into round_speaking_intervals(id,round_id,segment_id,round_participant_id,started_at,ended_at,started_version,ended_version) select ids.id,$2,$3,$4,$5::timestamptz + (ids.n-1)*interval '1 millisecond',$5::timestamptz + ids.n*interval '1 millisecond',1,2 from jsonb_array_elements_text($1::jsonb) with ordinality as ids(id,n)",
        [
          Array.from({ length: 513 }, () => createId()),
          roundId,
          clip.segmentId,
          clip.roundParticipantId,
          start,
        ],
      );
      const first = await store.readMediaCaptureState(scope);
      const second = await store.readMediaCaptureState({
        ...scope,
        expectedVersion: first.version,
        afterIntervalId: first.nextIntervalId!,
      });
      assert({
        given: '513 committed grants in one segment',
        should: 'return all in two bounded pages with no invented truncation',
        actual: [
          first.intervals.length,
          second.intervals.length,
          new Set([...first.intervals, ...second.intervals].map((i) => i.id))
            .size,
          second.nextIntervalId,
        ],
        expected: [512, 1, 513, null],
      });
    } finally {
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
    }
  }));
