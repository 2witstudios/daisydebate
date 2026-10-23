import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withBoundedRound } from './bounded-transaction.test-support';
import { historicalCapture } from './media-capture.test-support';

setupRitewayBun();
requireTestServices(process.env);
const outcome = (work: () => Promise<unknown>) =>
  work().then(
    () => 'accepted',
    (error: { code?: string }) => error.code ?? 'error',
  );

test('a closed capture session admits only audio captured before it closed, and a deletion request admits nothing (CAP-E.1-r6)', async () => {
  await withBoundedRound(async (fixture, transaction, firstRound) => {
    const results: Record<string, Record<string, string>> = {};
    for (const [state, column] of [
      ['unsafe', 'unsafe_at'],
      ['ended', 'ended_at'],
      ['deletion', 'deletion_requested_at'],
    ] as const) {
      const roundId = state === 'unsafe' ? firstRound : await fixture.round();
      const { store, lease, stream, clip, start } = await historicalCapture(
        fixture,
        transaction,
        roundId,
      );
      try {
        await store.claimMediaWorkerLease({ ...lease, leaseMs: 15000 });
        const closedAt = new Date(start.getTime() + 300);
        await fixture.sql.unsafe(
          `update media_sessions set created_at=$2, ${column}=$3 where id=$1`,
          [lease.sessionId, new Date(start.getTime() - 1000), closedAt],
        );
        const late = {
          ...clip,
          startOffsetMs: 500,
          before: new Date(start.getTime() + 499).toISOString(),
          after: new Date(start.getTime() + 601).toISOString(),
        };
        const observe = (until: number) =>
          store.observeCapturedStream({
            ...stream,
            trackId: clip.trackId,
            observedFrom: start.toISOString(),
            observedUntil: new Date(start.getTime() + until).toISOString(),
          });
        results[state] = {
          read: await outcome(() =>
            store.readMediaCaptureState({ ...lease, epoch: 1 }),
          ),
          appendBefore: await outcome(() =>
            store.appendCapturedTranscript(clip),
          ),
          appendAfter: await outcome(() =>
            store.appendCapturedTranscript(late),
          ),
          observeBefore: await outcome(() => observe(250)),
          observeAfter: await outcome(() => observe(700)),
          seal: await outcome(() =>
            store.sealCapturedStream({ ...stream, expectedChunkCount: 1 }),
          ),
        };
      } finally {
        await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
      }
    }
    const closed = {
      read: 'accepted',
      appendBefore: 'accepted',
      appendAfter: 'CONFLICT',
      observeBefore: 'accepted',
      observeAfter: 'CONFLICT',
      seal: 'accepted',
    };
    assert({
      given:
        'a session that turned unsafe, ended, or had deletion requested, with audio captured before and after that instant',
      should:
        'keep legitimate lagging writes from before the close, refuse later audio, and refuse everything once deletion is requested',
      actual: results,
      expected: {
        unsafe: closed,
        ended: closed,
        deletion: {
          read: 'CONFLICT',
          appendBefore: 'CONFLICT',
          appendAfter: 'CONFLICT',
          observeBefore: 'CONFLICT',
          observeAfter: 'CONFLICT',
          seal: 'CONFLICT',
        },
      },
    });
  });
});

test('audio stamped before the close but received after close plus the speech-to-text lag is refused (CAP-E.1-r8)', async () => {
  await withBoundedRound(async (fixture, transaction, roundId) => {
    const { store, lease, clip, start } = await historicalCapture(
      fixture,
      transaction,
      roundId,
      1000,
      1000,
    );
    try {
      await store.claimMediaWorkerLease({ ...lease, leaseMs: 15000 });
      await fixture.sql.unsafe(
        'update media_sessions set created_at=$2, unsafe_at=$3 where id=$1',
        [
          lease.sessionId,
          new Date(start.getTime() - 1000),
          new Date(Date.parse(clip.after) + 49),
        ],
      );
      assert({
        given:
          'a clip stamped 49 ms before the session turned unsafe, arriving more than 1 s after it under a 1 s lag policy',
        should: 'refuse it: the worker stamp alone cannot admit late audio',
        actual: await outcome(() => store.appendCapturedTranscript(clip)),
        expected: 'CONFLICT',
      });
    } finally {
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
    }
  });
});
