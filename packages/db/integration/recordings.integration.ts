import { recordingModeration } from '../src/recording-moderation';
import { requireTestServices } from '@daisy/config';
import { captureRule } from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import {
  recordingLifecycleSchema,
  type RecordingLifecycle,
} from '@daisy/protocol';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { openBroadcast } from '../src/broadcast-operations';
import { recordingPrivacyAdopter } from '../src/recording-privacy';
import { recordingArchiveReadOperations } from '../src/recording-archive-reads';
import { recordingOperations } from '../src/recording-operations';
import { recordingRoundReadOperations } from '../src/recording-round-reads';
import { rejectedBy, withFixture } from './constraint-helpers';
import { exportThenErase, withPrivacySubject } from './privacy.test-support';

setupRitewayBun();

const clock = {
  now: new Date('2036-01-01T00:00:00.000Z').toISOString(),
  rankedDelaySeconds: 60,
};
const { databaseUrl } = requireTestServices(process.env);

const at = '2026-11-02T10:00:00.000Z';
const later = new Date('2026-11-02T10:01:00.000Z');
const hostOptIn = { kind: 'host_opt_in', hostActorId: 'a'.repeat(24) } as const;
const ready = (id: string, durationMs = 60_000): RecordingLifecycle => ({
  status: 'ready',
  capture: {
    source: { kind: 'own_capture' },
    startedAt: at,
    attempts: [{ attempt: 1, egressId: 'EG', startedAt: at }],
    endedAt: at,
  },
  media: {
    capturedFrom: at,
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

test('erasure under an open report keeps a taken-down casual Recording hidden, then the hold ends', async () => {
  await withPrivacySubject(async ({ client, actorId, userId, database }) => {
    await withFixture(databaseUrl, async (fixture) => {
      const ops = recordingOperations({ database });
      const make = async () => {
        const roundId = await fixture.round();
        await fixture.seat(roundId, 'affirmative', 0, actorId);
        const id = createId();
        await ops.requestRecording({
          id,
          roundId,
          class: 'casual',
          eligibility: hostOptIn,
        });
        await ops.applyRecording(id, () => ({
          kind: 'moved',
          next: {
            status: 'taken_down',
            takenDownAt: at,
            held: ready(id) as Extract<RecordingLifecycle, { status: 'ready' }>,
          },
        }));
        return { id, roundId };
      };
      const reported = await make();
      const unreported = await make();
      const roundReported = await make();
      const report = (kind: string, targetId: string) =>
        client`insert into content_reports (id, target_kind, target_id, reason, queue)
          values (${createId()}, ${kind}, ${targetId}, 'harassment', 'safety')`;
      try {
        await report('recording', reported.id);
        await report('round', roundReported.roundId);
        await exportThenErase(database, { userId, actorId }, [
          recordingPrivacyAdopter,
        ]);
        const read = async (id: string) =>
          recordingLifecycleSchema.parse(
            (await ops.findRecording(id))?.lifecycle,
          );
        const held = await read(reported.id);
        assert({
          given: 'erasure of a seat, with open reports on two of three',
          should: 'keep the reported ones hidden and remove the other',
          actual: [
            held.status,
            (await read(roundReported.id)).status,
            (await read(unreported.id)).status,
          ],
          expected: ['taken_down', 'taken_down', 'removing'],
        });
        const heldUntil =
          held.status === 'taken_down' ? held.removalOwed?.heldUntil : null;
        const requestedAt =
          held.status === 'taken_down' ? held.removalOwed?.requestedAt : null;
        assert({
          given: 'the hold',
          should: 'last 90 days from the request, and keep the media',
          actual: [
            Date.parse(heldUntil!) - Date.parse(requestedAt!),
            held.status === 'taken_down' && held.held !== null,
          ],
          expected: [90 * 24 * 60 * 60 * 1000, true],
        });
        const ended = (now: string) =>
          ops.listEndedRecordingEvidenceHolds({ now, limit: 100 });
        const mine = (ids: readonly string[]) =>
          [reported.id, roundReported.id].filter((id) => ids.includes(id));
        assert({
          given: 'open reports inside the period',
          should: 'hold both',
          actual: mine(await ended(requestedAt!)),
          expected: [],
        });
        await client`update content_reports set status='dismissed', resolved_at=now(), resolved_by_ref='op'
          where target_id=${reported.id}`;
        assert({
          given: 'one report closed',
          should: 'end only that hold',
          actual: mine(await ended(requestedAt!)),
          expected: [reported.id],
        });
        assert({
          given: 'the period passed with a report still open',
          should: 'end the other hold too',
          actual: mine(await ended(heldUntil!)).sort(),
          expected: [reported.id, roundReported.id].sort(),
        });
      } finally {
        await client`delete from content_reports where target_id in
          (${reported.id}, ${roundReported.roundId})`;
        await client`delete from recordings where id in
          (${reported.id}, ${unreported.id}, ${roundReported.id})`;
      }
    });
  });
});

test('a ranked Round leaves the archive when its Recording is taken down, transcript or not', async () => {
  await withStore(async ({ ops, archive, fixture, track, client }) => {
    const formatId = 'freestyle';
    const roundId = track(
      await fixture.round({
        status: 'completed',
        competition_type: 'ranked',
        format_id: formatId,
        ladder_id: formatId,
        preset_version: 1,
        visibility: 'public',
        started_at: at,
        completed_at: at,
      }),
    );
    await fixture.freeze(roundId);
    const id = createId();
    await ops.requestRecording({
      id,
      roundId,
      class: 'ranked',
      eligibility: { kind: 'ranked' },
    });
    await ops.applyRecording(id, () => ({ kind: 'moved', next: ready(id) }));
    const listed = async () =>
      (
        await archive.listRecordingArchive({
          query: {
            scope: 'all',
            mode: 'any',
            q: '',
            sort: 'newest',
            before: '',
          },
          viewerActorId: null,
          clock,
          limit: 200,
        })
      ).rows.some((row) => row.id === roundId);
    const count = () => archive.countPublicRecordingArchive({ clock });
    const before = await count();
    assert({
      given: 'a ready ranked Recording with a transcript',
      should: 'be listed',
      actual: await listed(),
      expected: true,
    });
    await client`update recordings set status='taken_down',
        lifecycle=${JSON.stringify({ status: 'taken_down', takenDownAt: at, held: null })}::text::jsonb
      where id=${id}`;
    assert({
      given: 'its takedown, with the transcript remaining',
      should: 'leave the list and the count',
      actual: [await listed(), (await count()) - before],
      expected: [false, -1],
    });
    await client`update recordings set status='removing',
        lifecycle=${JSON.stringify({ status: 'removing', cause: 'moderation', requestedAt: at })}::text::jsonb
      where id=${id}`;
    assert({
      given: 'moderation then removing it',
      should: 'not bring the Round back',
      actual: await listed(),
      expected: false,
    });
    await client`update recordings set status='removing',
        lifecycle=${JSON.stringify({ status: 'removing', cause: 'failed_capture_cleanup', requestedAt: at })}::text::jsonb
      where id=${id}`;
    assert({
      given: 'a failed capture being cleaned up, which no moderator decided',
      should: 'keep the ranked Round listed by its transcript',
      actual: await listed(),
      expected: true,
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
        feedKey: createId(),
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
          clock,
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
      const pagedLongest: string[] = [];
      for (let before = '', page = 0; page < 10; page += 1) {
        const next = await list(
          { scope: 'mine', sort: 'longest', before },
          debater,
          2,
        );
        pagedLongest.push(...ids(next));
        if (next.nextBefore === null) break;
        before = next.nextBefore;
      }
      assert({
        given: 'longest first read two rows at a time',
        should: 'continue from the cursor with no gap or overlap',
        actual: pagedLongest,
        expected: ids(await list({ scope: 'mine', sort: 'longest' }, debater)),
      });
      assert({
        given: 'the pages of longest first',
        should: 'cover every Round the debater sat in',
        actual: pagedLongest.length,
        expected: 5,
      });
      const phrase = `Quorum ${createId()}`;
      await client`update rounds set resolution=${`Resolved: ${phrase}`} where id=${older}`;
      assert({
        given: 'a search for words in one resolution, in another case',
        should: 'find that row and no other',
        actual: ids(await list({ q: phrase.toLowerCase() })),
        expected: [older],
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
        actual: (await archive.countPublicRecordingArchive({ clock })) >= 2,
        expected: true,
      });
      assert({
        given: 'a held Round read as a named input',
        should: 'report its Broadcast watermark, not a clock',
        actual: await reads.readRecordingBroadcastRelease(held, clock),
        expected: { releasedThroughMs: null, stopped: false },
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
        await reads.readRecordingBroadcastRelease(roundId, clock),
      ],
      expected: [[], null, { releasedThroughMs: null, stopped: false }],
    });
    assert({
      given: 'a Round that does not exist',
      should: 'read null',
      actual: await reads.readRecordingRound(createId()),
      expected: null,
    });
  });
});

test('moderation reaches a real Recording, and a takedown holds what it can restore', async () => {
  await withStore(async ({ client, ops, fixture, track }) => {
    const db = drizzle({ client });
    const roundId = track(await fixture.round());
    const id = createId();
    await ops.requestRecording({
      id,
      roundId,
      class: 'casual',
      eligibility: hostOptIn,
    });
    await ops.applyRecording(id, () => ({ kind: 'moved', next: ready(id) }));
    const before = await recordingModeration.readReportFacts(db as never, {
      recordingId: id,
      reporterActorId: createId(),
    });
    const facts = {
      ranked: before?.ranked,
      reporterSeated: before?.reporterSeated,
      roundId: before?.audience.roundId,
    };
    assert({
      given: 'a stranger reporting a real Recording',
      should: 'find it, with its Round, instead of answering as missing',
      actual: [facts, await recordingModeration.readSubject(db as never, id)],
      expected: [
        { ranked: false, reporterSeated: false, roundId },
        { status: 'ready', version: 2, restorable: false },
      ],
    });
    const take = (expectedVersion: number) =>
      recordingModeration.takeDown(db as never, {
        recordingId: id,
        expectedVersion,
        now: later,
      });
    const first = await take(2);
    const taken = await ops.findRecording(id);
    assert({
      given: 'a takedown, then the same again',
      should: 'apply once, keep the media for a restore, and hide it',
      actual: [
        first,
        await take(3),
        taken?.lifecycle.status,
        taken?.lifecycle.status === 'taken_down' &&
          taken.lifecycle.held?.status,
      ],
      expected: ['applied', 'unchanged', 'taken_down', 'ready'],
    });
    assert({
      given: 'no such Recording',
      should: 'answer as missing',
      actual: [
        await recordingModeration.takeDown(db as never, {
          recordingId: createId(),
          expectedVersion: 1,
          now: later,
        }),
        await recordingModeration.readSubject(db as never, createId()),
      ],
      expected: [null, null],
    });
    await assertRejects({
      given: 'a restore naming a version that no longer holds',
      should: 'refuse',
      code: 'CONFLICT',
      actual: () =>
        recordingModeration.restore(db as never, {
          recordingId: id,
          expectedVersion: 2,
        }),
    });
    assert({
      given: 'a restore at the current version, then a removal',
      should: 'put the same media back, then write a durable moderation intent',
      actual: [
        await recordingModeration.restore(db as never, {
          recordingId: id,
          expectedVersion: 3,
        }),
        (await ops.findRecording(id))?.lifecycle,
        await recordingModeration.remove(db as never, {
          recordingId: id,
          expectedVersion: 4,
          now: later,
        }),
        (await ops.findRecording(id))?.lifecycle,
      ],
      expected: [
        'applied',
        ready(id),
        'applied',
        {
          status: 'removing',
          cause: 'moderation',
          requestedAt: later.toISOString(),
        },
      ],
    });
  });
});
