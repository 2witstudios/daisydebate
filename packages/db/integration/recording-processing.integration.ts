import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  openBroadcast,
  readConversationHeld,
} from '../src/broadcast-operations';
import { createRecordingCaptureStore } from '../src/recording-capture-store';
import { recordingOperations } from '../src/recording-operations';
import { createRecordingWorkerStore } from '../src/recording-worker-store';
import { withFixture } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl } = requireTestServices(process.env);
const NOW = new Date('2036-01-01T00:00:00.000Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);
/** Far past any row another suite left, so only this suite's jobs come due. */
const FUTURE = 86_400_000 * 365 * 100;
const hostOptIn = { kind: 'host_opt_in', hostActorId: 'a'.repeat(24) } as const;
const at = NOW.toISOString();
const media = {
  capturedFrom: at,
  playlistKey: 'recordings/r/hls/master.m3u8',
  downloadKey: 'recordings/r/video.mp4',
  durationMs: 1000,
  byteSize: 1,
  verifiedAt: at,
  gaps: [],
};

const withStores = async (
  run: (input: {
    store: ReturnType<typeof createRecordingCaptureStore>;
    worker: ReturnType<typeof createRecordingWorkerStore>;
    ops: ReturnType<typeof recordingOperations>;
    db: ReturnType<typeof drizzle>;
    client: SQL;
    newRecording: () => Promise<{
      id: string;
      roundId: string;
    }>;
  }) => Promise<void>,
) => {
  const client = new SQL(databaseUrl, { max: 8 });
  const db = drizzle({ client });
  const worker = createRecordingWorkerStore(databaseUrl);
  const ops = recordingOperations({ database: db });
  const rounds: string[] = [];
  try {
    await withFixture(databaseUrl, async (fixture) => {
      try {
        await run({
          store: createRecordingCaptureStore(db),
          worker,
          ops,
          db,
          client,
          newRecording: async () => {
            const roundId = await fixture.round();
            rounds.push(roundId);
            const record = await ops.requestRecording({
              id: createId(),
              roundId,
              class: 'casual',
              eligibility: hostOptIn,
            });
            return { id: record.id, roundId };
          },
        });
      } finally {
        for (const roundId of rounds) {
          await client`delete from recording_processing_jobs where recording_id in (select id from recordings where round_id=${roundId})`;
          await client`delete from recording_captures where round_id=${roundId}`;
          await client`delete from recordings where round_id=${roundId}`;
          await client`delete from broadcasts where round_id=${roundId}`;
        }
      }
    });
  } finally {
    await worker.close();
    await client.close();
  }
};

const claimAt = (
  worker: ReturnType<typeof createRecordingWorkerStore>,
  owner: string,
  nowMs = 0,
) =>
  worker.claim({
    owner,
    now: later(nowMs),
    leaseUntil: later(nowMs + 60_000),
  });

test('the worker login reaches its job table and nothing else', async () => {
  const sql = new SQL(databaseUrl, { max: 1 });
  try {
    const can = async (table: string, privilege: string) =>
      (
        await sql`select has_table_privilege('daisy_recording_worker', ${table}, ${privilege}) as ok`
      )[0].ok as boolean;
    assert({
      given: 'the worker role',
      should:
        'read and update its jobs, insert or delete none, and hold nothing on a Recording, Round, Broadcast or account',
      actual: [
        await can('recording_processing_jobs', 'SELECT'),
        await can('recording_processing_jobs', 'UPDATE'),
        await can('recording_processing_jobs', 'INSERT'),
        await can('recording_processing_jobs', 'DELETE'),
        await can('recordings', 'SELECT'),
        await can('recordings', 'UPDATE'),
        await can('rounds', 'SELECT'),
        await can('broadcasts', 'SELECT'),
        await can('users', 'SELECT'),
      ],
      expected: [true, true, false, false, false, false, false, false, false],
    });
  } finally {
    await sql.close();
  }
});

test('a job is claimable once capture ended, by one worker at a time', async () => {
  await withStores(async ({ store, worker, newRecording }) => {
    const { id } = await newRecording();
    await store.openJob({ recordingId: id, holdPrefix: 'hold/b/' });
    await store.openJob({ recordingId: id, holdPrefix: 'hold/other/' });
    assert({
      given: 'a capture still running, its job opened twice',
      should: 'not be claimable, and keep the first prefix',
      actual: await claimAt(worker, 'w1', FUTURE),
      expected: null,
    });
    await store.queueJob({ recordingId: id, attemptCount: 2 });
    const claims = await Promise.all(
      Array.from({ length: 6 }, (_, n) => claimAt(worker, `w${n}`, FUTURE)),
    );
    const won = claims.filter((claim) => claim?.recordingId === id);
    assert({
      given: 'six workers racing',
      should: 'give the job to exactly one, with its plan',
      actual: [
        won.length,
        won[0]?.holdPrefix,
        won[0]?.state,
        won[0]?.leaseEpoch,
      ],
      expected: [1, 'hold/b/', { status: 'queued', attemptCount: 2 }, 1],
    });
  });
});

test('a slower former owner can write nothing', async () => {
  await withStores(async ({ store, worker, newRecording, client }) => {
    const { id } = await newRecording();
    await store.openJob({ recordingId: id, holdPrefix: 'hold/b/' });
    await store.queueJob({ recordingId: id, attemptCount: 1 });
    const first = await claimAt(worker, 'old', FUTURE);
    assert({
      given: 'a live lease',
      should: 'refuse a second claim',
      actual: (await claimAt(worker, 'next', FUTURE))?.recordingId === id,
      expected: false,
    });
    const second = await claimAt(worker, 'next', FUTURE + 120_000);
    const held = (owner: string, epoch: number) => ({
      recordingId: id,
      owner,
      epoch,
      expected: 'queued' as const,
    });
    assert({
      given: 'the lease run out and the job taken over',
      should: 'raise the epoch',
      actual: [first?.leaseEpoch, second?.leaseEpoch],
      expected: [1, 2],
    });
    assert({
      given: 'the old owner renewing, finishing and deferring',
      should: 'refuse all three',
      actual: [
        await worker.renew({
          ...held('old', 1),
          leaseUntil: later(FUTURE + 300_000),
        }),
        await worker.finish({
          ...held('old', 1),
          state: { status: 'built', media },
        }),
        await worker.defer({
          recordingId: id,
          owner: 'old',
          epoch: 1,
          retryAt: later(FUTURE),
          failed: true,
        }),
      ],
      expected: [false, false, null],
    });
    assert({
      given: 'the current owner finishing',
      should: 'store the report and release the lease',
      actual: await worker.finish({
        ...held('next', 2),
        state: { status: 'built', media },
      }),
      expected: true,
    });
    const [row] =
      await client`select status, lease_owner, failures from recording_processing_jobs where recording_id=${id}`;
    assert({
      given: 'that job',
      should: 'hold the report, unleased and with no failure counted',
      actual: [row.status, row.lease_owner, row.failures],
      expected: ['built', null, 0],
    });
  });
});

test('a failed run comes due later and counts, and shutdown does not count', async () => {
  await withStores(async ({ store, worker, newRecording, client }) => {
    const { id } = await newRecording();
    await store.openJob({ recordingId: id, holdPrefix: 'hold/b/' });
    await store.queueJob({ recordingId: id, attemptCount: 1 });
    await claimAt(worker, 'w', FUTURE);
    const failures = await worker.defer({
      recordingId: id,
      owner: 'w',
      epoch: 1,
      retryAt: later(FUTURE + 60_000),
      failed: true,
    });
    assert({
      given: 'a failed run',
      should: 'count it and refuse a claim until it is due',
      actual: [
        failures,
        (await claimAt(worker, 'w2', FUTURE))?.recordingId === id,
      ],
      expected: [1, false],
    });
    const claimed = await claimAt(worker, 'w2', FUTURE + 60_000);
    await worker.defer({
      recordingId: id,
      owner: 'w2',
      epoch: claimed?.leaseEpoch ?? 0,
      retryAt: later(FUTURE + 60_000),
      failed: false,
    });
    const [row] =
      await client`select failures from recording_processing_jobs where recording_id=${id}`;
    assert({
      given: 'a run given back at shutdown',
      should: 'not count as a failure',
      actual: row.failures,
      expected: 1,
    });
  });
});

test('a build reports how far it is, and only its current owner can say so', async () => {
  await withStores(async ({ store, worker, newRecording }) => {
    const { id } = await newRecording();
    await store.openJob({ recordingId: id, holdPrefix: 'hold/b/' });
    await store.queueJob({ recordingId: id, attemptCount: 1 });
    const job = await claimAt(worker, 'w', FUTURE);
    const progress = { step: 'encoding', done: 1000, total: 2000 } as const;
    await worker.recordProgress({
      recordingId: id,
      owner: 'w',
      epoch: job!.leaseEpoch,
      progress,
    });
    await worker.recordProgress({
      recordingId: id,
      owner: 'old',
      epoch: job!.leaseEpoch - 1,
      progress: { ...progress, done: 1 },
    });
    assert({
      given: 'its owner reporting, and a former owner reporting after',
      should: 'keep the owner\u2019s figures, on the state the web reads',
      actual: await store.readJobState(id),
      expected: { status: 'queued', attemptCount: 1, progress },
    });
    await worker.defer({
      recordingId: id,
      owner: 'w',
      epoch: job!.leaseEpoch,
      retryAt: later(FUTURE),
      failed: true,
    });
    assert({
      given: 'a run that failed and waits for its retry',
      should: 'not keep showing figures no run is at',
      actual: await store.readJobState(id),
      expected: { status: 'queued', attemptCount: 1 },
    });
  });
});

test('a delay is alerted once, and failed ranked work is never cleaned on a timer', async () => {
  await withStores(async ({ store, ops, newRecording, client }) => {
    const { id } = await newRecording();
    await store.openJob({ recordingId: id, holdPrefix: 'hold/b/' });
    const capture = {
      source: { kind: 'own_capture' as const },
      startedAt: at,
      attempts: [{ attempt: 1, egressId: 'EG', startedAt: at }],
      endedAt: at,
    };
    await ops.applyRecording(id, () => ({
      kind: 'moved',
      next: { status: 'processing', capture },
    }));
    const listed = async () =>
      (await store.listProcessingUnalerted(500)).some((row) => row.id === id);
    const alert = () =>
      store.markDelayAlerted({ recordingId: id, at: later(FUTURE) });
    assert({
      given: 'a processing Recording, alerted, then alerted again',
      should: 'list it until told, and let one caller raise it',
      actual: [await listed(), await alert(), await alert(), await listed()],
      expected: [true, true, false, false],
    });
    await ops.applyRecording(id, () => ({
      kind: 'moved',
      next: { status: 'failed', reason: 'processing_failed', failedAt: at },
    }));
    const old = async () =>
      (
        await ops.listFailedRecordingsBefore({
          before: new Date(FUTURE * 2).toISOString(),
          limit: 500,
        })
      ).includes(id);
    assert({
      given: 'an old failed casual Recording',
      should: 'come up for cleanup',
      actual: await old(),
      expected: true,
    });
    await client`update recordings set recording_class='ranked', eligibility=${{ kind: 'ranked' }} where id=${id}`;
    assert({
      given: 'the same as a ranked Recording',
      should: 'never come up: ranked is kept forever',
      actual: await old(),
      expected: false,
    });
  });
});

test('discarding fences a running build and is claimable itself', async () => {
  await withStores(async ({ store, worker, newRecording }) => {
    const { id } = await newRecording();
    await store.openJob({ recordingId: id, holdPrefix: 'hold/b/' });
    await store.queueJob({ recordingId: id, attemptCount: 1 });
    await claimAt(worker, 'builder', FUTURE);
    await store.discardSources(id);
    assert({
      given: 'a build running when the web asks to discard',
      should: 'refuse its renewal and its result',
      actual: [
        await worker.renew({
          recordingId: id,
          owner: 'builder',
          epoch: 1,
          expected: 'queued',
          leaseUntil: later(FUTURE + 60_000),
        }),
        await worker.finish({
          recordingId: id,
          owner: 'builder',
          epoch: 1,
          expected: 'queued',
          state: { status: 'built', media },
        }),
      ],
      expected: [false, false],
    });
    await worker.defer({
      recordingId: id,
      owner: 'builder',
      epoch: 1,
      retryAt: later(FUTURE),
      failed: false,
    });
    const claimed = await claimAt(worker, 'cleaner', FUTURE + 1);
    assert({
      given: 'the build gone',
      should: 'offer the discard, sources still known to remain',
      actual: [claimed?.state, await store.sourcesRemain(id)],
      expected: [{ status: 'discarding' }, true],
    });
    await worker.finish({
      recordingId: id,
      owner: 'cleaner',
      epoch: claimed?.leaseEpoch ?? 0,
      expected: 'discarding',
      state: { status: 'settled', settledAt: at },
    });
    await store.discardSources(id);
    assert({
      given: 'a settled job asked to discard again',
      should: 'stay settled, with nothing remaining',
      actual: [
        await store.sourcesRemain(id),
        (await store.sourcesRemain('never-recorded')) === false,
      ],
      expected: [false, true],
    });
  });
});

test('the web sees only jobs it can answer, and what still uses their sources', async () => {
  await withStores(async ({ store, ops, newRecording, db, client }) => {
    const { id, roundId } = await newRecording();
    await store.openJob({ recordingId: id, holdPrefix: 'hold/b/' });
    const listed = async () =>
      (await store.listJobs(1000)).find((job) => job.recordingId === id);
    assert({
      given: 'a capture still running',
      should: 'not list it',
      actual: await listed(),
      expected: undefined,
    });
    const capture = {
      source: { kind: 'broadcast_hold', broadcastId: 'b'.repeat(24) } as const,
      startedAt: at,
      attempts: [{ attempt: 1, egressId: 'EG', startedAt: at }],
    };
    await ops.applyRecording(id, () => ({
      kind: 'moved',
      next: { status: 'capturing', capture },
    }));
    await ops.applyRecording(id, () => ({
      kind: 'moved',
      next: { status: 'processing', capture: { ...capture, endedAt: at } },
    }));
    assert({
      given: 'capture ended with no Broadcast',
      should: 'list it, with nothing using the sources',
      actual: [(await listed())?.state, (await listed())?.sourcesInUse],
      expected: [{ status: 'waiting' }, false],
    });
    await openBroadcast(db, {
      id: createId(),
      feedKey: createId(),
      roundId,
      releasePolicy: { kind: 'delay', seconds: 60 },
    });
    assert({
      given: 'its Broadcast still releasing from the hold',
      should: 'say the sources are in use',
      actual: (await listed())?.sourcesInUse,
      expected: true,
    });
    await client`update broadcasts set stopped_at=now(), stop_reason='test' where round_id=${roundId}`;
    assert({
      given: 'that Broadcast stopped',
      should: 'say they are free',
      actual: (await listed())?.sourcesInUse,
      expected: false,
    });
    await store.queueJob({ recordingId: id, attemptCount: 1 });
    assert({
      given: 'a queued job while processing',
      should: 'not list it: it waits for the worker',
      actual: await listed(),
      expected: undefined,
    });
  });
});

test('a Recording running its own Egress holds conversation the same way', async () => {
  await withStores(async ({ store, db, newRecording }) => {
    const { id, roundId } = await newRecording();
    await store.openOwn({ recordingId: id, roundId });
    const held = () => readConversationHeld(db, { roundId });
    assert({
      given: 'no Egress yet',
      should: 'hold nothing',
      actual: await held(),
      expected: false,
    });
    await store.recordOwnEgressStarted({
      recordingId: id,
      egressId: 'EG',
      generation: 1,
      stageCredentialHash: 'digest',
      now: NOW,
    });
    assert({
      given: 'an observer that may be subscribed',
      should: 'hold conversation, with no timer',
      actual: await held(),
      expected: true,
    });
    await store.recordOwnRevoked({ recordingId: id, now: NOW });
    assert({
      given: 'the observer confirmed revoked',
      should: 'release it',
      actual: await held(),
      expected: false,
    });
    await store.recordOwnRestored(id);
    await store.closeOwn({ recordingId: id, now: NOW });
    assert({
      given: 'a capture closed',
      should: 'hold nothing',
      actual: await held(),
      expected: false,
    });
    assert({
      given: 'an id that is not a capture',
      should: 'answer as missing',
      actual: await store.readStage('not-a-capture'),
      expected: null,
    });
  });
});

test('the reconcile lease lets one instance act', async () => {
  await withStores(async ({ store, newRecording }) => {
    const { id, roundId } = await newRecording();
    await store.openOwn({ recordingId: id, roundId });
    await store.openOwn({ recordingId: id, roundId });
    const claims = await Promise.all(
      Array.from({ length: 6 }, () =>
        store.claimOwn({ recordingId: id, now: NOW, until: later(800) }),
      ),
    );
    assert({
      given: 'six instances at once',
      should: 'let exactly one act until the lease ends',
      actual: [
        claims.filter(Boolean).length,
        await store.claimOwn({
          recordingId: id,
          now: later(800),
          until: later(1600),
        }),
      ],
      expected: [1, true],
    });
  });
});
