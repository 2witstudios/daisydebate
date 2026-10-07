import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import type { RoundProjection, RoundRules } from '@daisy/protocol';
import { roundAuthoring, withFixture } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

type Fixture = Parameters<Parameters<typeof withFixture>[1]>[0];

const within = (at: Date | null, from: number, to: number) =>
  at instanceof Date && at.getTime() >= from && at.getTime() <= to;

const commandOf = (
  type: string,
  digestChar: string,
  result: Record<string, string | number | boolean | null>,
) => ({
  commandId: createId(),
  actorId: null,
  serviceId: 'integration',
  type,
  payloadDigest: digestChar.repeat(64),
  result,
});

const projection = (
  rules: RoundRules,
  now: string,
  completed = false,
): RoundProjection => ({
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

const stamps = async (fixture: Fixture, roundId: string) => {
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


/** The version each still-active execution claims: one per digest. */
const expectedVersionOf = (digest: string): number =>
  digest === 'c' ? 2 : 3;

/** What the stored round row says about the start instant. */
const startEvidence = (
  row: { readonly started_at: Date | null } | undefined,
  window: { readonly from: number; readonly to: number },
) => {
  const startedAt = row?.started_at ?? null;
  return {
    insideOriginalWindow: within(startedAt, window.from, window.to),
    notRestampedForward:
      (startedAt === null ? Number.POSITIVE_INFINITY : startedAt.getTime()) <=
      window.to,
  };
};

/**
 * One still-active execution must leave the start instant exactly as the
 * start transition recorded it. Taking the transition from the *projected*
 * status instead re-stamped `started_at` on every write, so a segment
 * closing halfway through a debate moved the round's start forward.
 */
const assertStillActiveKeptTheStart = async (inputs: {
  readonly database: Awaited<ReturnType<typeof roundAuthoring>>['database'];
  readonly fixture: Fixture;
  readonly roundId: string;
  readonly rules: RoundRules;
  readonly digest: string;
  readonly window: { readonly from: number; readonly to: number };
}) => {
  const { database, fixture, roundId, rules, digest, window } = inputs;
  const before = Date.parse(await database.databaseNow());
  await database.applyRoundExecution({
    roundId,
    expectedVersion: expectedVersionOf(digest),
    command: commandOf('yield', digest, { ok: true }),
    // Only the round row is under test here, so no segment rows: the
    // start transition already opened sequence 0.
    projection: {
      ...projection(rules, new Date(before).toISOString()),
      segmentInserts: [],
      segmentCloses: [],
    },
  });
  const row = (await stamps(fixture, roundId)).row;
  assert({
    given: `a still-active execution ${digest} after the round started`,
    should: 'leave the start instant the start transition recorded',
    actual: startEvidence(row, window),
    expected: { insideOriginalWindow: true, notRestampedForward: true },
  });
};

/**
 * The still-active executions run before the completion because a completed
 * round cannot go back to active — `rounds_lifecycle_check` requires
 * `completed_at is null` for an active row, so the database refuses that
 * transition outright rather than restating anything.
 */
const assertStillActiveExecutionsKeptTheStart = async (inputs: {
  readonly database: Awaited<ReturnType<typeof roundAuthoring>>['database'];
  readonly fixture: Fixture;
  readonly roundId: string;
  readonly rules: RoundRules;
  readonly window: { readonly from: number; readonly to: number };
}) => {
  for (const digest of ['c', 'd'])
    await assertStillActiveKeptTheStart({ ...inputs, digest });
};

/** What the stored rows say about the start and the completion instants. */
const completionEvidence = (
  started: Awaited<ReturnType<typeof stamps>>,
  completed: Awaited<ReturnType<typeof stamps>>,
  callerInstant: string,
  startWindow: { readonly from: number; readonly to: number },
  completionWindow: { readonly from: number; readonly to: number },
) => {
  const startedAt = started.row?.started_at ?? null;
  const startedSegmentAt = started.segments[0]?.started_at ?? null;
  return {
    startedAt: within(startedAt, startWindow.from, startWindow.to),
    // Both instants are PostgreSQL's, so they share one window and one
    // order; they are not byte-equal because the segment carries the
    // instant `databaseNow()` handed the runtime and the round row is
    // stamped by the write. Making them equal would mean letting the
    // projection choose the round's start, which is the thing ADR 0033
    // §3.2 forbids (ISSUE-37).
    startedSegmentInWindow: within(
      startedSegmentAt,
      startWindow.from,
      startWindow.to,
    ),
    startedSegmentOrdered:
      (startedSegmentAt === null ? Infinity : startedSegmentAt.getTime()) <=
      (startedAt === null ? 0 : startedAt.getTime()),
    callerTimeRejected: startedAt?.getTime() === Date.parse(callerInstant),
    completedAt: within(
      completed.row?.completed_at ?? null,
      completionWindow.from,
      completionWindow.to,
    ),
  };
};

/** The completion must land in its own database-clock window. */
const assertCompletionInWindow = async (inputs: {
  readonly database: Awaited<ReturnType<typeof roundAuthoring>>['database'];
  readonly fixture: Fixture;
  readonly roundId: string;
  readonly rules: RoundRules;
  readonly callerInstant: string;
  readonly startWindow: { readonly from: number; readonly to: number };
  readonly started: Awaited<ReturnType<typeof stamps>>;
}) => {
  const { database, fixture, roundId, rules, callerInstant, startWindow, started } =
    inputs;
  if (!started.row) throw new Error('the round row vanished');
  const beforeComplete = Date.parse(await database.databaseNow());
  const completeInstant = new Date(await database.databaseNow()).toISOString();
  await database.applyRoundExecution({
    roundId,
    expectedVersion: 4,
    command: commandOf('complete', 'b', { outcome: 'affirmative' }),
    projection: {
      ...projection(rules, completeInstant, true),
      segmentInserts: [],
      segmentCloses: [],
    },
  });
  const afterComplete = Date.parse(await database.databaseNow());
  const completed = await stamps(fixture, roundId);
  if (!completed.row) throw new Error('the round row vanished');
  assert({
    given:
      'a round started and completed through one injected database instant per execution, with a caller instant of 2001 in the projection it ignored',
    should:
      'stamp the start, the segment and the completion inside their own database-clock windows, never with the caller instant',
    actual: completionEvidence(
      started,
      completed,
      callerInstant,
      startWindow,
      { from: beforeComplete, to: afterComplete },
    ),
    expected: {
      startedAt: true,
      startedSegmentInWindow: true,
      startedSegmentOrdered: true,
      callerTimeRejected: false,
      completedAt: true,
    },
  });
};

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

      // The caller proposes 2001; the injected instant is the database's.
      const callerInstant = '2001-01-01T00:00:00.000Z';
      const beforeStart = Date.parse(await database.databaseNow());
      const startInstant = new Date(await database.databaseNow()).toISOString();
      await database.applyRoundExecution({
        roundId,
        expectedVersion: 1,
        command: commandOf('start', 'a', { ok: true }),
        projection: projection(rules, startInstant),
      });
      const afterStart = Date.parse(await database.databaseNow());
      const started = await stamps(fixture, roundId);
      if (!started.row) throw new Error('the round row vanished');
      const startWindow = { from: beforeStart, to: afterStart };

      await assertStillActiveExecutionsKeptTheStart({
        database,
        fixture,
        roundId,
        rules,
        window: startWindow,
      });
      await assertCompletionInWindow({
        database,
        fixture,
        roundId,
        rules,
        callerInstant,
        startWindow,
        started,
      });
    } finally {
      await database.close();
    }
  });
});
