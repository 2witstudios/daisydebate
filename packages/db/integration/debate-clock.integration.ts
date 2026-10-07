import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import type { RoundProjection } from '@daisy/protocol';
import { roundAuthoring, withFixture } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

/**
 * ISSUE-37 (ADR 0033 §3.2, as amended by ADR 0058): every competitive time
 * is PostgreSQL time. The caller reads one instant (`databaseNow`) per
 * execution, injects it as the runtime's `now`, and the projection lands
 * verbatim — so a malicious or buggy caller cannot stamp 2001 into the
 * timetable, and every row one execution writes shares that instant.
 */
test('started_at, segment instants and completed_at come from the injected database instant, never a caller-chosen one', async () => {
  await withFixture(url, async (fixture) => {
    const { roundId, database, rules, formatId } = await roundAuthoring(
      fixture,
      url,
    );
    try {
      await database.createRound({
        id: roundId,
        createdByActorId: null,
        resolution: 'integration proof',
        competitionType: 'casual',
        length: 'full',
        formatId,
        formatVersion: 1,
        presetVersion: null,
        rules,
      });

      const databaseNow = async () => Date.parse(await database.databaseNow());
      const stamps = async () => {
        const [row] = (await fixture.sql.unsafe(
          `select started_at, completed_at from rounds where id = $1`,
          [roundId],
        )) as Array<{ started_at: Date | null; completed_at: Date | null }>;
        const segments = (await fixture.sql.unsafe(
          `select rules_segment_key, started_at from round_segments where round_id = $1 order by sequence`,
          [roundId],
        )) as Array<{ rules_segment_key: string; started_at: Date }>;
        return { row, segments };
      };
      const within = (at: Date | null, from: number, to: number) =>
        at instanceof Date && at.getTime() >= from && at.getTime() <= to;

      const projection = (now: string, completed = false): RoundProjection => ({
        round: {
          status: completed ? 'completed' : 'active',
          currentStage: completed ? null : 'live',
          startedAt: now,
          completedAt: completed ? now : null,
          outcome: completed ? 'affirmative' : null,
          checkpoint: {
            version: 1,
            prep_consumed_ms: { affirmative: 0, negative: 0 },
            active_prep: null,
            floor: null,
          },
        },
        segmentInserts: [
          {
            id: createId(),
            sequence: 0,
            type: 'speech',
            rulesSegmentKey: 'AC',
            startedAt: now,
            durationMs: rules.segments[0]?.durationMs ?? 240_000,
          },
        ],
        segmentCloses: completed
          ? [
              {
                id: '',
                endedAt: now,
              },
            ]
          : [],
        effects: [],
      });

      // The caller proposes 2001; the injected instant is the database's.
      const callerInstant = '2001-01-01T00:00:00.000Z';
      const beforeStart = await databaseNow();
      const startInstant = new Date(await database.databaseNow()).toISOString();
      await database.applyRoundExecution({
        roundId,
        expectedVersion: 1,
        command: {
          commandId: createId(),
          actorId: null,
          serviceId: 'integration',
          type: 'start',
          payloadDigest: 'a'.repeat(64),
          result: { ok: true },
        },
        projection: projection(startInstant),
      });
      const afterStart = await databaseNow();
      const started = await stamps();
      if (!started.row) throw new Error('the round row vanished');

      const beforeComplete = await databaseNow();
      const completeInstant = new Date(
        await database.databaseNow(),
      ).toISOString();
      await database.applyRoundExecution({
        roundId,
        expectedVersion: 2,
        command: {
          commandId: createId(),
          actorId: null,
          serviceId: 'integration',
          type: 'complete',
          payloadDigest: 'b'.repeat(64),
          result: { outcome: 'affirmative' },
        },
        projection: {
          ...projection(completeInstant, true),
          segmentInserts: [],
          segmentCloses: [],
        },
      });
      const afterComplete = await databaseNow();
      const completed = await stamps();
      if (!completed.row) throw new Error('the round row vanished');

      assert({
        given:
          'a round started and completed through one injected database instant per execution, with a caller instant of 2001 in the projection it ignored',
        should:
          'stamp the start, the segment and the completion inside their own database-clock windows, never with the caller instant',
        actual: {
          startedAt: within(started.row.started_at, beforeStart, afterStart),
          // Both instants are PostgreSQL's, so they share one window and one
          // order; they are not byte-equal because the segment carries the
          // instant `databaseNow()` handed the runtime and the round row is
          // stamped by the write. Making them equal would mean letting the
          // projection choose the round's start, which is the thing ADR 0033
          // §3.2 forbids (ISSUE-37).
          startedSegmentInWindow: within(
            started.segments[0]?.started_at ?? null,
            beforeStart,
            afterStart,
          ),
          startedSegmentOrdered:
            (started.segments[0]?.started_at?.getTime() ?? Infinity) <=
            (started.row.started_at?.getTime() ?? 0),
          callerTimeRejected:
            started.row.started_at?.getTime() === Date.parse(callerInstant),
          completedAt: within(
            completed.row.completed_at,
            beforeComplete,
            afterComplete,
          ),
        },
        expected: {
          startedAt: true,
          startedSegmentInWindow: true,
          startedSegmentOrdered: true,
          callerTimeRejected: false,
          completedAt: true,
        },
      });
    } finally {
      await database.close();
    }
  });
});
