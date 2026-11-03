import type { RecordingLifecycle } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  deletionRetryAt,
  FAILED_CAPTURE_RETENTION_MS,
  REMOVAL_OVERDUE_MS,
  REMOVAL_SETTLE_MS,
  runDeletionSweep,
} from './deletion-sweep';
import { fakeObjectStore, fakeRecordingStore } from './fake-store.test-support';
import { at, nowMs, prefix, record } from './fixture.test-support';

setupRitewayBun();

describe('runDeletionSweep', () => {
  const removing = (requestedAt: string): RecordingLifecycle => ({
    status: 'removing',
    cause: 'participant_request',
    requestedAt,
  });
  const settledAt = new Date(nowMs - REMOVAL_SETTLE_MS).toISOString();
  const keys = [`${prefix}video.mp4`, `${prefix}hls/master.m3u8`];

  test('an evidence hold that ended pays the removal it owed', async () => {
    const owed: RecordingLifecycle = {
      status: 'taken_down',
      takenDownAt: at,
      held: null,
      removalOwed: { requestedAt: at, heldUntil: at },
    };
    const { store, rows } = fakeRecordingStore(
      [
        record({ lifecycle: owed }),
        record({ id: 'still', roundId: 'r2', lifecycle: owed }),
      ],
      { endedHolds: ['rec'] },
    );
    await runDeletionSweep({
      store,
      objects: fakeObjectStore().store,
      owner: 'w',
      nowMs,
      report: () => {},
    });
    assert({
      given: 'one hold ended and one still running',
      should: 'move only the ended one to removing',
      actual: [
        rows.get('rec')?.lifecycle.status,
        rows.get('still')?.lifecycle.status,
      ],
      expected: ['removing', 'taken_down'],
    });
  });

  test('a POV goes with its Recording, under the one prefix', async () => {
    const { store } = fakeRecordingStore([
      record({ lifecycle: removing(settledAt) }),
    ]);
    const objects = fakeObjectStore([
      `${prefix}video.mp4`,
      `${prefix}pov/seat/video.mp4`,
      `${prefix}pov/seat/audio.m4a`,
    ]);
    await runDeletionSweep({
      store,
      objects: objects.store,
      owner: 'w',
      nowMs,
      report: () => undefined,
    });
    assert({
      given: 'a removed Recording with POV files',
      should: 'remove them with everything else',
      actual: [...objects.objects],
      expected: [],
    });
  });

  test('stays removing while its sources wait in the hold bucket', async () => {
    const { store, rows } = fakeRecordingStore(
      [record({ lifecycle: removing(settledAt) })],
      { sourcesRemain: ['rec'] },
    );
    await runDeletionSweep({
      store,
      objects: fakeObjectStore().store,
      owner: 'w',
      nowMs,
      report: () => {},
    });
    assert({
      given: 'an empty prefix with sources still held',
      should: 'not claim the whole Recording is gone',
      actual: rows.get('rec')?.lifecycle.status,
      expected: 'removing',
    });
  });

  test('deletes first and ends only when nothing is left', async () => {
    const { store, rows } = fakeRecordingStore([
      record({ lifecycle: removing(settledAt) }),
    ]);
    const objects = fakeObjectStore([...keys, 'recordings/other/keep.mp4']);
    const run = () =>
      runDeletionSweep({
        store,
        objects: objects.store,
        owner: 'w',
        nowMs,
        report: () => {},
      });
    const first = await run();
    assert({
      given: 'a first run',
      should: 'delete this Recording objects and no other, and stay removing',
      actual: [
        first.removedKeys,
        [...objects.objects],
        rows.get('rec')?.lifecycle.status,
      ],
      expected: [2, ['recordings/other/keep.mp4'], 'removing'],
    });
    await run();
    assert({
      given: 'a run that finds nothing left',
      should: 'mark it removed',
      actual: rows.get('rec')?.lifecycle.status,
      expected: 'removed',
    });
    const again = await run();
    assert({
      given: 'the sweep repeated',
      should: 'do nothing',
      actual: [again.removedKeys, again.removedRecordings],
      expected: [0, 0],
    });
  });

  test('keeps the intent through a vendor failure', async () => {
    const { store, rows, deferred } = fakeRecordingStore([
      record({ lifecycle: removing(settledAt) }),
    ]);
    const objects = fakeObjectStore(keys, { failRemoval: true });
    const result = await runDeletionSweep({
      store,
      objects: objects.store,
      owner: 'w',
      nowMs,
      report: () => {},
    });
    assert({
      given: 'object storage failing',
      should: 'stay removing and retry later',
      actual: [
        result.deferred,
        rows.get('rec')?.lifecycle.status,
        deferred[0]?.retryAt,
      ],
      expected: [1, 'removing', deletionRetryAt(nowMs, 0)],
    });
  });

  test('says out loud that a deletion failed, and that one is overdue', async () => {
    const run = async (requestedAt: string, failRemoval: boolean) => {
      const reported: string[] = [];
      await runDeletionSweep({
        store: fakeRecordingStore([
          record({ lifecycle: removing(requestedAt) }),
        ]).store,
        objects: fakeObjectStore(keys, { failRemoval }).store,
        owner: 'w',
        nowMs,
        report: (event) => reported.push(event),
      });
      return reported;
    };
    const aged = new Date(nowMs - REMOVAL_OVERDUE_MS).toISOString();
    assert({
      given: 'an attempt that fails on a young removal',
      should: 'report the failure alone',
      actual: await run(settledAt, true),
      expected: ['recording.deletion_failed'],
    });
    assert({
      given: 'a removal requested a day ago and still here, failing',
      should: 'report it overdue as well',
      actual: await run(aged, true),
      expected: ['recording.deletion_overdue', 'recording.deletion_failed'],
    });
    assert({
      given: 'a removal that is overdue with nothing failing',
      should: 'still report it overdue',
      actual: await run(aged, false),
      expected: ['recording.deletion_overdue'],
    });
    assert({
      given: 'a young removal going well',
      should: 'report nothing',
      actual: await run(settledAt, false),
      expected: [],
    });
  });

  test('waits for a capture that may still be writing', async () => {
    const { store, rows } = fakeRecordingStore([
      record({ lifecycle: removing(at) }),
    ]);
    await runDeletionSweep({
      store,
      objects: fakeObjectStore().store,
      owner: 'w',
      nowMs,
      report: () => {},
    });
    assert({
      given: 'an empty prefix moments after removal was asked',
      should: 'not close it yet',
      actual: rows.get('rec')?.lifecycle.status,
      expected: 'removing',
    });
  });

  test('queues the partial objects of old failures', async () => {
    const failed = record({
      lifecycle: { status: 'failed', reason: 'capture_failed', failedAt: at },
    });
    const { store, rows } = fakeRecordingStore([failed], {
      failedBefore: ['rec'],
    });
    const result = await runDeletionSweep({
      store,
      objects: fakeObjectStore().store,
      owner: 'w',
      nowMs: nowMs + FAILED_CAPTURE_RETENTION_MS,
      report: () => {},
    });
    assert({
      given: 'a failure past its retention',
      should: 'carry a cleanup intent',
      actual: [result.failedCleanups, rows.get('rec')?.lifecycle.status],
      expected: [1, 'removing'],
    });
  });
});

test('deletionRetryAt doubles from a minute to an hour', () => {
  assert({
    given: 'growing attempts',
    should: 'back off and stop at an hour',
    actual: [0, 1, 20].map(
      (attempts) => Date.parse(deletionRetryAt(0, attempts)) / 60_000,
    ),
    expected: [1, 2, 60],
  });
});
