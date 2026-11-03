import { requireTestServices } from '@daisy/config';
import { captureRule } from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import {
  recordingLifecycleSchema,
  type RecordingLifecycle,
} from '@daisy/protocol';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { openBroadcast } from '../src/broadcast-operations';
import { recordingPrivacyAdopter } from '../src/recording-privacy';
import { recordingArchiveReadOperations } from '../src/recording-archive-reads';
import { recordingOperations } from '../src/recording-operations';
import { recordingRoundReadOperations } from '../src/recording-round-reads';
import { rejectedBy, withFixture } from './constraint-helpers';
import { exportThenErase, withPrivacySubject } from './privacy.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const at = '2026-11-02T10:00:00.000Z';
const later = new Date('2026-11-02T10:01:00.000Z');
const hostOptIn = { kind: 'host_opt_in', hostActorId: 'a'.repeat(24) } as const;
const ready = (id: string, durationMs = 60_000): RecordingLifecycle => ({
  status: 'ready',
  capture: {
    egressId: 'EG',
    startedAt: at,
    endedAt: at,
    sourceKey: `recordings/${id}/source.mp4`,
  },
  media: {
    playlistKey: `recordings/${id}/hls/master.m3u8`,
    downloadKey: `recordings/${id}/video.mp4`,
    durationMs,
    byteSize: 10,
    verifiedAt: at,
    gaps: [],
    speeches: [],
  },
});
const removing: RecordingLifecycle = {
  status: 'removing',
  cause: 'participant_request',
  requestedAt: at,
};

const withStore = async (
  run: (input: {
    ops: ReturnType<typeof recordingOperations>;
    archive: ReturnType<typeof recordingArchiveReadOperations>;
    reads: ReturnType<typeof recordingRoundReadOperations>;
    db: ReturnType<typeof drizzle>;
    client: SQL;
    fixture: Parameters<Parameters<typeof withFixture>[1]>[0];
    track: (roundId: string) => string;
  }) => Promise<void>,
) => {
  const client = new SQL(databaseUrl, { max: 8 });
  const db = drizzle({ client });
  const tracked: string[] = [];
  try {
    await withFixture(databaseUrl, async (fixture) => {
      try {
        await run({
          ops: recordingOperations({ database: db }),
          archive: recordingArchiveReadOperations({ database: db }),
          reads: recordingRoundReadOperations({ database: db }),
          db,
          client,
          fixture,
          track: (roundId) => {
            tracked.push(roundId);
            return roundId;
          },
        });
      } finally {
        for (const roundId of tracked) {
          await client`delete from recordings where round_id=${roundId}`;
          await client`delete from broadcasts where round_id=${roundId}`;
        }
      }
    });
  } finally {
    await client.close();
  }
};

test('a racing request makes one Recording, with one stable identity', async () => {
  await withStore(async ({ ops, fixture, track }) => {
    const roundId = track(await fixture.round());
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        ops.requestRecording({
          id: createId(),
          roundId,
          class: 'casual',
          eligibility: hostOptIn,
        }),
      ),
    );
    assert({
      given: 'six requests for one Round at once',
      should: 'return one identity',
      actual: new Set(results.map((row) => row.id)).size,
      expected: 1,
    });
  });
});

test('the schema refuses a lifecycle that disagrees with its status', async () => {
  await withStore(async ({ client, fixture, track }) => {
    const roundId = track(await fixture.round());
    assert({
      given: 'a status other than the lifecycle says',
      should: 'be refused by the database',
      actual: await rejectedBy(
        () => client`insert into recordings
          (id, round_id, recording_class, eligibility, status, lifecycle)
          values (${createId()}, ${roundId}, 'casual',
            jsonb_build_object('kind','host_opt_in','hostActorId',${hostOptIn.hostActorId}::text), 'ready', '{"status":"requested"}'::jsonb)`,
      ),
      expected: 'recordings_lifecycle_status_check',
    });
    assert({
      given: 'a casual class with ranked eligibility',
      should: 'be refused by the database',
      actual: await rejectedBy(
        () => client`insert into recordings
          (id, round_id, recording_class, eligibility, status, lifecycle)
          values (${createId()}, ${roundId}, 'casual',
            '{"kind":"ranked"}'::jsonb, 'requested', '{"status":"requested"}'::jsonb)`,
      ),
      expected: 'recordings_class_matches_eligibility_check',
    });
  });
});

test('racing versioned operations: one wins, and a rejected one changes nothing', async () => {
  await withStore(async ({ ops, fixture, track }) => {
    const roundId = track(await fixture.round());
    const id = createId();
    await ops.requestRecording({
      id,
      roundId,
      class: 'casual',
      eligibility: hostOptIn,
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ops.applyRecording(
          id,
          () => ({ kind: 'moved', next: removing }) as const,
          1,
        ),
      ),
    );
    assert({
      given: 'five writers holding version 1',
      should: 'let exactly one move and answer the rest stale',
      actual: results.map((result) => result.kind).sort(),
      expected: ['decided', 'stale', 'stale', 'stale', 'stale'],
    });
    const row = await ops.findRecording(id);
    assert({
      given: 'the race',
      should: 'move the version once',
      actual: [row?.version, row?.lifecycle.status],
      expected: [2, 'removing'],
    });
    const refused = await ops.applyRecording(
      id,
      () => ({ kind: 'refused', reason: 'out_of_order' }) as const,
    );
    assert({
      given: 'a refused decision',
      should: 'write nothing',
      actual: [refused.kind, (await ops.findRecording(id))?.version],
      expected: ['decided', 2],
    });
  });
});

test('concurrent deletion claims share nothing; a defer keeps the intent', async () => {
  await withStore(async ({ ops, fixture, track }) => {
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const id = createId();
      ids.push(id);
      await ops.requestRecording({
        id,
        roundId: track(await fixture.round()),
        class: 'casual',
        eligibility: hostOptIn,
      });
      await ops.applyRecording(id, () => ({
        kind: 'moved',
        next: removing,
      }));
    }
    const claim = (owner: string) =>
      ops.claimRecordingDeletions({
        owner,
        now: later.toISOString(),
        leaseUntil: new Date(later.getTime() + 60_000).toISOString(),
        limit: 100,
      });
    const [first, second] = await Promise.all([claim('a'), claim('b')]);
    const mine = (claims: typeof first) =>
      claims.map((c) => c.record.id).filter((id) => ids.includes(id));
    assert({
      given: 'two workers claiming at once',
      should: 'never hold the same Recording',
      actual: [
        mine(first).concat(mine(second)).sort(),
        (await claim('c')).filter((c) => ids.includes(c.record.id)).length,
      ],
      expected: [[...ids].sort(), 0],
    });
    const target = ids[0]!;
    await ops.deferRecordingDeletion(target, {
      retryAt: new Date(later.getTime() + 120_000).toISOString(),
      failed: true,
    });
    assert({
      given: 'a failed attempt',
      should: 'not come due before its retry',
      actual: (await claim('d')).some((c) => c.record.id === target),
      expected: false,
    });
    const retried = await ops.claimRecordingDeletions({
      owner: 'e',
      now: new Date(later.getTime() + 121_000).toISOString(),
      leaseUntil: new Date(later.getTime() + 180_000).toISOString(),
      limit: 100,
    });
    assert({
      given: 'the retry coming due, as after a process death',
      should: 'come back with its failures counted',
      actual: retried.find((c) => c.record.id === target)?.attempts,
      expected: 1,
    });
  });
});

test('erasure removes casual Recordings whole and keeps ranked ones', async () => {
  await withPrivacySubject(async ({ client, actorId, userId, database }) => {
    await withFixture(databaseUrl, async (fixture) => {
      const ops = recordingOperations({ database });
      const casualRound = await fixture.round();
      await fixture.seat(casualRound, 'affirmative', 0, actorId);
      const unrelatedRound = await fixture.round();
      const casual = createId();
      const ranked = createId();
      const unrelated = createId();
      const rankedRound = await fixture.round();
      await fixture.seat(rankedRound, 'negative', 0, actorId);
      for (const [id, roundId, recordingClass] of [
        [casual, casualRound, 'casual'],
        [ranked, rankedRound, 'ranked'],
        [unrelated, unrelatedRound, 'casual'],
      ] as const) {
        await ops.requestRecording({
          id,
          roundId,
          class: recordingClass,
          eligibility:
            recordingClass === 'ranked' ? { kind: 'ranked' } : hostOptIn,
        });
        await ops.applyRecording(id, () => ({
          kind: 'moved',
          next: ready(id),
        }));
      }
      try {
        const exported = await exportThenErase(database, { userId, actorId }, [
          recordingPrivacyAdopter,
        ]);
        assert({
          given: 'an export',
          should: 'list only the Recordings the subject sits in',
          actual: (exported['recordings'] ?? []).map((row) => row['id']).sort(),
          expected: [casual, ranked].sort(),
        });
        const status = async (id: string) =>
          recordingLifecycleSchema.parse(
            (await ops.findRecording(id))?.lifecycle,
          ).status;
        assert({
          given: 'the erasure',
          should: 'remove casual, keep ranked, and leave others alone',
          actual: [
            await status(casual),
            await status(ranked),
            await status(unrelated),
          ],
          expected: ['removing', 'ready', 'ready'],
        });
        const [row] = (await client`select deletion_due_at is not null as due
          from recordings where id=${casual}`) as { due: boolean }[];
        assert({
          given: 'the erasure',
          should: 'leave a durable deletion intent that is due',
          actual: row?.due,
          expected: true,
        });
      } finally {
        await client`delete from recordings where id in (${casual}, ${ranked}, ${unrelated})`;
      }
    });
  });
});

test('the archive pages, filters and holds back what is not released', async () => {
  await withStore(
    async ({ ops, archive, reads, db, fixture, track, client }) => {
      const debater = await fixture.actor();
      const completed = (minutes: number, competition: 'casual' | 'ranked') =>
        fixture.round({
          status: 'completed',
          competition_type: competition,
          visibility: 'public',
          started_at: new Date(Date.UTC(2026, 10, 2, 9, minutes)).toISOString(),
          completed_at: new Date(
            Date.UTC(2026, 10, 2, 10, minutes),
          ).toISOString(),
        });
      const make = async (
        minutes: number,
        options: { visibility?: string; durationMs?: number } = {},
      ) => {
        const roundId = track(await completed(minutes, 'casual'));
        if (options.visibility)
          await client`update rounds set visibility=${options.visibility} where id=${roundId}`;
        await fixture.seat(roundId, 'affirmative', 0, debater);
        const id = createId();
        await ops.requestRecording({
          id,
          roundId,
          class: 'casual',
          eligibility: hostOptIn,
        });
        await ops.applyRecording(id, () => ({
          kind: 'moved',
          next: ready(id, options.durationMs),
        }));
        return roundId;
      };
      const older = await make(1, { durationMs: 900_000 });
      const newer = await make(2, { durationMs: 300_000 });
      const hidden = await make(3, { visibility: 'private' });
      const unlisted = await make(4, { visibility: 'unlisted' });
      const held = await make(5);
      await openBroadcast(db, {
        id: createId(),
        roundId: held,
        releasePolicy: { kind: 'delay', seconds: 60 },
      });
      const list = (
        query: Partial<
          Parameters<typeof archive.listRecordingArchive>[0]['query']
        >,
        viewerActorId: string | null = null,
        limit = 1000,
      ) =>
        archive.listRecordingArchive({
          query: {
            scope: 'all',
            mode: 'any',
            q: '',
            sort: 'newest',
            before: '',
            ...query,
          },
          viewerActorId,
          marginMs: 5000,
          limit,
        });
      const ids = (page: Awaited<ReturnType<typeof list>>) =>
        page.rows.map((row) => row.id);
      const pub = ids(await list({}));
      assert({
        given: 'the public archive',
        should:
          'list public released Recordings only, never private, unlisted or held',
        actual: [
          pub.includes(older),
          pub.includes(newer),
          pub.includes(hidden),
          pub.includes(unlisted),
          pub.includes(held),
        ],
        expected: [true, true, false, false, false],
      });
      const owner = await client`select * from rounds where id=${held}`;
      assert({
        given: 'the held Round',
        should: 'exist, so its absence is the release rule',
        actual: (owner as unknown[]).length,
        expected: 1,
      });
      const mine = ids(await list({ scope: 'mine' }, debater));
      assert({
        given: 'own history',
        should: 'list every Round they sat in, whatever its visibility',
        actual: [older, newer, hidden, unlisted, held].every((id) =>
          mine.includes(id),
        ),
        expected: true,
      });
      assert({
        given: 'own history with no viewer',
        should: 'list nothing',
        actual: ids(await list({ scope: 'mine' }, null)),
        expected: [],
      });
      const first = await list({ scope: 'mine' }, debater, 2);
      const second = await list(
        { scope: 'mine', before: first.nextBefore ?? '' },
        debater,
        2,
      );
      assert({
        given: 'two pages of newest',
        should: 'continue without overlap, in order',
        actual: [...ids(first), ...ids(second)],
        expected: [held, unlisted, hidden, newer],
      });
      const longest = ids(await list({ sort: 'longest' }));
      assert({
        given: 'longest first',
        should: 'order by video length',
        actual: longest.indexOf(older) < longest.indexOf(newer),
        expected: true,
      });
      assert({
        given: 'a search holding LIKE wildcards',
        should: 'treat them as text',
        actual: ids(await list({ q: '%_%' })),
        expected: [],
      });
      assert({
        given: 'the mode filter',
        should: 'exclude other modes',
        actual: ids(await list({ mode: 'ranked' })).includes(older),
        expected: false,
      });
      assert({
        given: 'the public count',
        should: 'count at least what the public list shows here',
        actual:
          (await archive.countPublicRecordingArchive({ marginMs: 5000 })) >= 2,
        expected: true,
      });
      assert({
        given: 'a held Round read as a named input',
        should: 'report its Broadcast watermark, not a clock',
        actual: await reads.readRecordingBroadcastRelease(held),
        expected: { kind: 'open', releasedThroughMs: null },
      });
    },
  );
});

test('the Round inputs read only public ballot fields', async () => {
  await withStore(async ({ reads, fixture, track }) => {
    const roundId = track(await fixture.round());
    assert({
      given: 'a Round with no ballots and no freeze',
      should: 'read empty rather than invent evidence',
      actual: [
        await reads.readRecordingBallots(roundId),
        await reads.readRecordingTranscript(roundId, captureRule),
        await reads.readRecordingBroadcastRelease(roundId),
      ],
      expected: [[], null, { kind: 'none' }],
    });
    assert({
      given: 'a Round that does not exist',
      should: 'read null',
      actual: await reads.readRecordingRound(createId()),
      expected: null,
    });
  });
});
