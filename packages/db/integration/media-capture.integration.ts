import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { withBoundedRound } from './bounded-transaction.test-support';
import {
  historicalCapture,
  withClaimedCapture,
} from './media-capture.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('real bounded capture appends once and seals only actual continuous historical coverage', async () => {
  await withBoundedRound(async (fixture, transaction, roundId) => {
    const { store, lease, stream, clip, start, end } = await historicalCapture(
      fixture,
      transaction,
      roundId,
    );
    try {
      const claimed = await store.claimMediaWorkerLease({
        ...lease,
        leaseMs: 15000,
      });
      const appended = await store.appendCapturedTranscript(clip);
      const duplicate = await store.appendCapturedTranscript(clip);
      await assertRejects({
        given: 'same clip identity with conflicting transcript text',
        should: 'refuse conflicting retries',
        code: 'CONFLICT',
        actual: () =>
          store.appendCapturedTranscript({ ...clip, text: 'Different words' }),
      });
      await store.observeCapturedStream({
        ...stream,
        trackId: clip.trackId,
        observedFrom: start.toISOString(),
        observedUntil: end.toISOString(),
      });
      const sealed = await store.sealCapturedStream({
        ...stream,
        expectedChunkCount: 1,
      });
      assert({
        given:
          'one captured clip retried and continuously observed across its closed grant',
        should: 'persist one utterance and seal the committed frontier',
        actual: {
          epoch: claimed.epoch,
          appended,
          duplicate,
          sealed,
          utterances: await fixture.count('utterances', 'round_id', roundId),
        },
        expected: {
          epoch: 1,
          appended: { duplicate: false, revision: 1 },
          duplicate: { duplicate: true, revision: 1 },
          sealed: { state: 'complete', revision: 3 },
          utterances: 1,
        },
      });
    } finally {
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
    }
  });
});

test('capture gaps and mismatching committed chunk counts cannot produce complete seals', async () => {
  for (const mismatch of [false, true])
    await withBoundedRound(async (fixture, transaction, roundId) => {
      const { store, lease, stream, clip, start, end } =
        await historicalCapture(fixture, transaction, roundId);
      try {
        await store.claimMediaWorkerLease({ ...lease, leaseMs: 15000 });
        const observation = {
          ...stream,
          trackId: clip.trackId,
          observedFrom: start.toISOString(),
          observedUntil: mismatch
            ? end.toISOString()
            : new Date(start.getTime() + 500).toISOString(),
        };
        await store.observeCapturedStream(observation);
        const duplicate = await store.observeCapturedStream(observation);
        const sealed = await store.sealCapturedStream({
          ...stream,
          expectedChunkCount: mismatch ? 1 : 0,
        });
        assert({
          given: mismatch
            ? 'complete observation but a missing promised chunk'
            : 'a silent stream with only partial observed coverage',
          should: 'close partial without manufacturing complete evidence',
          actual: { duplicate, sealed },
          expected: {
            duplicate: { duplicate: true, revision: 1 },
            sealed: { state: 'partial', revision: 2 },
          },
        });
      } finally {
        await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
      }
    });
});

test('expired or superseded capture epochs cannot append or regain authority', async () => {
  await withBoundedRound(async (fixture, transaction, roundId) => {
    const { store, lease, clip } = await historicalCapture(
      fixture,
      transaction,
      roundId,
    );
    try {
      await store.claimMediaWorkerLease({ ...lease, leaseMs: 15000 });
      await assertRejects({
        given: 'another worker while the lease is held',
        should: 'refuse takeover',
        code: 'CONFLICT',
        actual: () =>
          store.claimMediaWorkerLease({
            ...lease,
            workerId: createId(),
            leaseMs: 15000,
          }),
      });
      await fixture.sql.unsafe(
        "update media_worker_leases set expires_at=clock_timestamp()-interval '1 second' where session_id=$1",
        [lease.sessionId],
      );
      await assertRejects({
        given: 'an expired capture epoch',
        should: 'refuse append',
        code: 'CONFLICT',
        actual: () => store.appendCapturedTranscript(clip),
      });
      const takeover = await store.claimMediaWorkerLease({
        ...lease,
        leaseMs: 15000,
      });
      await assertRejects({
        given: 'the same worker retaining stale epoch after takeover',
        should: 'refuse the old capture job',
        code: 'CONFLICT',
        actual: () => store.appendCapturedTranscript(clip),
      });
      const accepted = await store.appendCapturedTranscript({
        ...clip,
        epoch: takeover.epoch,
      });
      assert({
        given: 'an explicit new epoch after expiry',
        should: 'accept only the fresh epoch',
        actual: { epoch: takeover.epoch, accepted },
        expected: { epoch: 2, accepted: { duplicate: false, revision: 1 } },
      });
    } finally {
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
    }
  });
});

test('frozen input and expired actual-final-end cutoff fence every capture mutation', async () => {
  await withBoundedRound(async (fixture, transaction, roundId) => {
    const { store, lease, stream, clip, start, end } = await historicalCapture(
      fixture,
      transaction,
      roundId,
    );
    try {
      await store.claimMediaWorkerLease({ ...lease, leaseMs: 15000 });
      await fixture.sql.unsafe(
        "insert into round_transcript_freezes(round_id,revision,frontier,completeness) values($1,1,0,'incomplete')",
        [roundId],
      );
      const writes = [
        () => store.appendCapturedTranscript(clip),
        () =>
          store.observeCapturedStream({
            ...stream,
            trackId: clip.trackId,
            observedFrom: start.toISOString(),
            observedUntil: end.toISOString(),
          }),
        () => store.sealCapturedStream({ ...stream, expectedChunkCount: 0 }),
        () => store.claimMediaWorkerLease({ ...lease, leaseMs: 15000 }),
      ];
      for (const actual of writes)
        await assertRejects({
          given: 'an immutable frozen transcript',
          should: 'refuse capture mutation',
          code: 'CONFLICT',
          actual,
        });
      assert({
        given: 'all rejected post-freeze writes',
        should: 'preserve empty utterances, streams and frontier',
        actual: await Promise.all(
          ['utterances', 'transcript_segments', 'round_transcripts'].map(
            (table) => fixture.count(table, 'round_id', roundId),
          ),
        ),
        expected: [0, 0, 0],
      });
    } finally {
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
    }
  });
  await withBoundedRound(async (fixture, transaction, roundId) => {
    const { store, lease } = await historicalCapture(
      fixture,
      transaction,
      roundId,
      121000,
    );
    try {
      await assertRejects({
        given: 'actual final end more than120seconds ago',
        should: 'refuse new capture lease',
        code: 'CONFLICT',
        actual: () => store.claimMediaWorkerLease({ ...lease, leaseMs: 15000 }),
      });
    } finally {
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
    }
  });
});

test('capture refuses full uncertainty windows across historical gaps and boundaries atomically', async () =>
  withClaimedCapture(async (f, { store, clip, start, end }, roundId) => {
    await f.sql`delete from round_speaking_intervals where round_id=${roundId}`;
    for (const [from, until] of [
      [0, 400],
      [600, 1000],
    ])
      await f.sql`insert into round_speaking_intervals(id,round_id,segment_id,round_participant_id,started_at,ended_at,started_version,ended_version) values(${createId()},${roundId},${clip.segmentId},${clip.roundParticipantId},${new Date(start.getTime() + from!)},${new Date(start.getTime() + until!)},1,2)`;
    for (const candidate of [
      { ...clip, after: new Date(start.getTime() + 601).toISOString() },
      { ...clip, before: new Date(start.getTime() - 1).toISOString() },
      { ...clip, after: end.toISOString() },
    ])
      await assertRejects({
        given:
          'full uncertainty outside one historical grant despite eligible nominal clip',
        should: 'refuse atomically',
        code: 'CONFLICT',
        actual: () => store.appendCapturedTranscript(candidate),
      });
    assert({
      given: 'all refused windows',
      should: 'leave no text stream observation or frontier',
      actual: await Promise.all(
        [
          'utterances',
          'transcript_segments',
          'transcript_observations',
          'round_transcripts',
        ].map((t) => f.count(t, 'round_id', roundId)),
      ),
      expected: [0, 0, 0, 0],
    });
  }));
