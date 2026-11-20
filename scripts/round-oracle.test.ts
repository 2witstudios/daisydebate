import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seededWalk, type Draw } from '@daisy/seeded-random/testing';
import {
  attendanceTimingPolicy,
  isJudgeSeat,
  isRoundOver,
  leadSeatOf,
  sameSeat,
  sideOfSeat,
  type RoundCommand,
  type RoundParticipantSeat,
  type RoundPosition,
  type RoundProjection,
  type RoundRules,
} from '@daisy/protocol';
import {
  castOf,
  floorHolderOf,
  hydrate,
  iso,
  openingRound,
  oracleFormats,
  panelCompletion,
  persist,
  refusalOf,
  viewAt,
  type Persisted,
  type Refusal,
} from './round-oracle.test-support';
import {
  oracleProperties,
  ratingVolatilityUnderflow,
} from './round-oracle-properties.test-support';

setupRitewayBun();

const specIds: readonly string[] = (
  JSON.parse(
    readFileSync(resolve(import.meta.dir, '../spec/invariants.json'), 'utf8'),
  ) as { invariants: readonly { id: string }[] }
).invariants.map(({ id }) => id);

const ids = {
  panelPlayedRound: 'round.complete.panel-played-round',
  seats: 'round.seats.complete',
  segmentRules: 'round.segment.matches-rules',
  openCount: 'round.live.open-segment-count',
  prepCapability: 'round.prep.requires-capability',
  prepSpendable: 'round.prep.requires-spendable-segment',
  prepBudget: 'round.prep.requires-budget',
  speechPrep: 'round.speech.requires-prep',
  yieldFloor: 'round.yield.requires-floor',
  interruptPolicy: 'round.interrupt.requires-policy',
  lifecycle: 'round.lifecycle.matches-status',
  stage: 'round.stage.matches-clock',
  terminal: 'round.status.completed.terminal',
} as const;

const commands: readonly RoundCommand['type'][] = [
  'start_prep',
  'start_speech',
  'yield',
  'interrupt',
  'forfeit',
  'leave',
];

type Move =
  | {
      readonly kind: 'command';
      readonly command: RoundCommand['type'];
      readonly actor: string | null;
    }
  | {
      readonly kind:
        | 'tick'
        | 'activate'
        | 'stop'
        | 'pause'
        | 'resume'
        | 'end-incident'
        | 'gate-await'
        | 'gate-heard'
        | 'panel'
        | 'cutoff'
        | 'settled-forfeit'
        | 'settled-abandon';
    };

const labelOf = (move: Move) =>
  move.kind === 'command'
    ? `${move.command}(${move.actor ?? 'nobody'})`
    : move.kind;

type World = {
  readonly rules: RoundRules;
  readonly cast: readonly RoundParticipantSeat[];
  readonly rows: Persisted;
  readonly nowMs: number;
  /** Ids minted so far, so every hydration mints fresh ones. */
  readonly minted: number;
  /** The known engine defect this walk ran into; the walk ends there. */
  readonly halted?: string;
};

const T0 = Date.parse('2026-11-19T09:00:00.000Z');

/** What happened to the Round over all walks: the walks must reach each. */
type Reached = Record<string, number>;

const statusOf = (rows: Persisted) => rows.lifecycle.status;
const isTerminal = (rows: Persisted) => isRoundOver(statusOf(rows));

/** How far time moves before a move: scaled to the Round's own clock. */
const delayOf = (world: World, draw: Draw): number => {
  const next = world.rules.segments[world.rows.segments.length];
  const segment = next?.durationMs ?? 60_000;
  const choices = [
    0,
    1,
    250,
    world.rules.countdownMs,
    world.rules.countdownMs + 1,
    Math.floor(segment / 2),
    segment,
    segment + world.rules.countdownMs,
    30_000,
    draw(120_000),
  ];
  return choices[draw(choices.length)]!;
};

// ---- What must hold of the durable rows after every accepted step ----

const rowProblems = (rules: RoundRules, rows: Persisted): string[] => {
  const problems: string[] = [];
  const { lifecycle, segments } = rows;
  const open = segments.filter((row) => row.endedAt === null);
  if (open.length > 1)
    problems.push(`${ids.openCount}: ${open.length} segments open`);
  if (open.length > 0 && lifecycle.status !== 'active')
    problems.push(
      `${ids.openCount}: a segment open in a ${lifecycle.status} Round`,
    );
  if (segments.length > rules.segments.length)
    problems.push(
      `${ids.segmentRules}: more rows than the rules have segments`,
    );
  segments.forEach((row, index) => {
    const rule = rules.segments[row.sequence];
    if (
      row.sequence !== index ||
      rule === undefined ||
      rule.key !== row.rulesSegmentKey ||
      rule.type !== row.type ||
      rule.durationMs !== row.durationMs
    )
      problems.push(
        `${ids.segmentRules}: row ${index} is not the rules' segment`,
      );
    if (index < segments.length - 1 && row.endedAt === null)
      problems.push(`${ids.openCount}: row ${index} open behind a later row`);
    if (
      row.endedAt !== null &&
      Date.parse(row.endedAt) < Date.parse(row.startedAt)
    )
      problems.push(`${ids.segmentRules}: row ${index} ends before it starts`);
    if (row.returnedMs < 0)
      problems.push(`${ids.segmentRules}: row ${index} returned negative time`);
  });
  const { status, startedAt, completedAt } = lifecycle;
  const lifecycleHolds =
    status === 'opening'
      ? startedAt === null && completedAt === null && segments.length === 0
      : status === 'active'
        ? startedAt !== null && completedAt === null
        : completedAt !== null &&
          (startedAt === null ||
            Date.parse(completedAt) >= Date.parse(startedAt));
  if (!lifecycleHolds)
    problems.push(
      `${ids.lifecycle}: ${status} with started ${startedAt}, completed ${completedAt}`,
    );
  if (status === 'opening' && rows.currentStage !== null)
    problems.push(
      `${ids.stage}: an opening Round at stage ${rows.currentStage}`,
    );
  if (open.length === 1 && rows.currentStage !== 'live')
    problems.push(`${ids.stage}: a segment open at stage ${rows.currentStage}`);
  if (open.length === 0 && rows.currentStage === 'live')
    problems.push(`${ids.stage}: live with no segment open`);
  return problems;
};

const positionProblems = (
  rules: RoundRules,
  position: RoundPosition,
): string[] => {
  const problems: string[] = [];
  const prep = rules.inRoundPrep;
  if (prep === null) {
    if (position.prep !== null || position.prepBudgetRemainingMs !== null)
      problems.push(`${ids.prepCapability}: prep in a format without it`);
    return problems;
  }
  for (const [side, remaining] of Object.entries(
    position.prepBudgetRemainingMs ?? {},
  ))
    if (remaining < 0 || remaining > prep.budgetMsPerSide)
      problems.push(
        `${ids.prepBudget}: ${side} has ${remaining} ms of prep left`,
      );
  if (position.prep !== null) {
    if (position.openSegment !== null)
      problems.push(`${ids.prepSpendable}: prep runs while a segment is live`);
    const upcoming = position.nextSegment;
    const lead = upcoming === null ? null : leadSeatOf(upcoming.speak);
    if (
      upcoming === null ||
      lead === null ||
      sideOfSeat(lead) !== position.prep.side ||
      !prep.spendableBefore.includes(upcoming.type)
    )
      problems.push(
        `${ids.prepSpendable}: prep runs before a segment it may not`,
      );
  }
  return problems;
};

// ---- What a command may do, read from the position before it ----

const seatOf = (world: World, actor: string | null) =>
  actor === null
    ? null
    : (world.cast.find((seat) => seat.actorId === actor) ?? null);

/** Whether the seat may spend prep now, by the rules alone. */
const prepWindowOpen = (
  world: World,
  position: RoundPosition,
  seat: RoundParticipantSeat | null,
): boolean => {
  const prep = world.rules.inRoundPrep;
  const upcoming = position.nextSegment;
  if (
    prep === null ||
    seat === null ||
    upcoming === null ||
    position.openSegment !== null
  )
    return false;
  const lead = leadSeatOf(upcoming.speak);
  const expires = prep.expiresAtSegment;
  return (
    lead !== null &&
    sideOfSeat(lead) !== null &&
    sameSeat(lead, seat.seat) &&
    prep.spendableBefore.includes(upcoming.type) &&
    (expires === null ||
      world.rules.segments.findIndex((segment) => segment.key === expires) >
        upcoming.sequence)
  );
};

/**
 * Each id a command's refusal may name, and whether the position before it
 * met the condition that id guards. An accepted command met every one; a
 * refusal naming an id failed that one.
 */
const commandGuards = (
  world: World,
  position: RoundPosition,
  command: RoundCommand['type'],
  actor: string | null,
): Readonly<Record<string, boolean>> => {
  const seat = seatOf(world, actor);
  const side = seat === null ? null : sideOfSeat(seat.seat);
  const holder = floorHolderOf(world.rules, world.cast, position);
  const open = position.openSegment;
  const terminal = { [ids.terminal]: position.status !== 'completed' };
  switch (command) {
    case 'start_prep':
      return {
        ...terminal,
        [ids.prepCapability]: world.rules.inRoundPrep !== null,
        [ids.prepSpendable]: prepWindowOpen(world, position, seat),
        [ids.prepBudget]:
          side !== null && (position.prepBudgetRemainingMs?.[side] ?? 0) > 0,
      };
    case 'start_speech':
      return { ...terminal, [ids.speechPrep]: position.prep !== null };
    case 'yield':
      return {
        ...terminal,
        [ids.yieldFloor]:
          open !== null &&
          seat !== null &&
          holder?.id === seat.id &&
          world.rules.interaction.yield?.allowed === true,
      };
    case 'interrupt': {
      const policy = world.rules.interaction.interruptions;
      return {
        ...terminal,
        [ids.interruptPolicy]:
          open !== null &&
          policy.allowed === 'enabled' &&
          open.speak.rights === 'one' &&
          open.remainingMs >= policy.minRemainingMs &&
          holder?.id !== seat?.id,
      };
    }
    case 'forfeit':
    case 'leave':
      return terminal;
  }
};

/** Whether every declared segment has closed, the last at or before `nowMs`. */
const debatePlayed = (world: World, nowMs: number) => {
  const { segments } = world.rows;
  const last = segments.at(-1);
  return (
    segments.length === world.rules.segments.length &&
    segments.every((row) => row.endedAt !== null) &&
    last !== undefined &&
    last.endedAt !== null &&
    Date.parse(last.endedAt) <= nowMs
  );
};

// ---- One step ----

type Outcome =
  | { readonly accepted: true; readonly projection: RoundProjection }
  | { readonly accepted: false; readonly refusal: Refusal };

const attempt = (run: () => RoundProjection): Outcome => {
  try {
    return { accepted: true, projection: run() };
  } catch (error) {
    return { accepted: false, refusal: refusalOf(error) };
  }
};

const speechRows = (world: World) =>
  world.rows.segments.filter((row) => row.type === 'speech');

const step = (
  world: World,
  move: Move,
  draw: Draw,
  reached: Reached,
): { readonly state: World; readonly problems: readonly string[] } => {
  const at = world.nowMs + delayOf(world, draw);
  const runtime = hydrate(world.rules, world.cast, world.rows, world.minted);
  const before = viewAt(runtime, at);
  const sides = world.rules.sides.map((side) => side.key);
  const problems: string[] = [];
  let later = at;
  const outcome = attempt((): RoundProjection => {
    switch (move.kind) {
      case 'command':
        return runtime.execute({
          command: { type: move.command },
          actorId: move.actor,
          now: iso(at),
        });
      case 'tick': {
        // tick(a) then tick(b) is tick(b): checked on two fresh copies.
        later = at + delayOf(world, draw);
        const twice = hydrate(
          world.rules,
          world.cast,
          world.rows,
          world.minted,
        );
        const first = twice.tick(iso(at));
        const second = twice.tick(iso(later));
        const direct = runtime.tick(iso(later));
        if (!Bun.deepEquals(viewAt(twice, later), viewAt(runtime, later)))
          problems.push('tick(a) then tick(b) is not tick(b)');
        if (
          !Bun.deepEquals(
            persist(persist(world.rows, first), second),
            persist(world.rows, direct),
          )
        )
          problems.push('tick(a) then tick(b) writes other rows than tick(b)');
        return direct;
      }
      case 'activate':
        return runtime.activate({ at: iso(world.nowMs), now: iso(at) });
      case 'stop':
        return runtime.stop(iso(at));
      case 'pause':
        return runtime.applyIncident({
          kind: 'pause',
          atMs: at,
          cause: draw(2) === 0 ? 'vendor_unreachable' : 'room_retired',
          confirmedUntilMs: null,
        });
      case 'resume':
        return runtime.applyIncident({
          kind: 'begin_resume',
          atMs: at,
          countdownMs: world.rules.countdownMs,
        });
      case 'end-incident':
        return runtime.applyIncident({ kind: 'end', atMs: at });
      case 'gate-await':
        return runtime.applyStartGate({
          kind: 'await',
          atMs: at,
          seats: world.cast
            .filter((seat) => !isJudgeSeat(seat.seat))
            .map((seat) => seat.id),
          boundMs: 5_000,
        });
      case 'gate-heard': {
        const seats = world.cast.filter((seat) => !isJudgeSeat(seat.seat));
        return runtime.applyStartGate({
          kind: 'heard',
          atMs: at,
          seat: seats[draw(Math.max(1, seats.length))]?.id ?? 'nobody',
        });
      }
      case 'panel':
        return runtime.completePanel(panelCompletion(world.cast, at));
      case 'cutoff':
      case 'settled-forfeit':
      case 'settled-abandon': {
        const rows = speechRows(world);
        const row = rows[draw(Math.max(1, rows.length))];
        const settled = {
          evidence: 'settled_availability' as const,
          effectiveDeadlineMs:
            row === undefined ? at : Date.parse(row.startedAt) + 40_000,
          settledHorizonMs: at,
        };
        const winner = sides[draw(Math.max(1, sides.length))] ?? 'affirmative';
        return runtime.adjudicate({
          segmentId: row?.id ?? 'no-row',
          now: iso(at),
          decision:
            move.kind === 'cutoff'
              ? { evidence: 'resolution_cutoff', decision: 'abandoned' }
              : move.kind === 'settled-forfeit'
                ? { ...settled, decision: 'forfeit', winner }
                : { ...settled, decision: 'abandoned' },
        });
      }
    }
  });
  const now = later;
  if (!outcome.accepted) {
    const { refusal } = outcome;
    if (refusal.kind === 'stray')
      problems.push(`${labelOf(move)} threw a stray error: ${refusal.error}`);
    if (refusal.kind === 'invariant' && !specIds.includes(refusal.id))
      problems.push(`refused with an unregistered id ${refusal.id}`);
    // A refused event returns the identical state.
    if (!Bun.deepEquals(viewAt(runtime, at), before))
      problems.push(`refused ${labelOf(move)} changed the state`);
    if (move.kind === 'command') {
      if (
        statusOf(world.rows) === 'completed' &&
        !(refusal.kind === 'invariant' && refusal.id === ids.terminal)
      )
        problems.push(
          `${ids.terminal}: a completed Round refused ${move.command} otherwise`,
        );
      const guards = commandGuards(
        world,
        before.position,
        move.command,
        move.actor,
      );
      if (refusal.kind === 'invariant' && guards[refusal.id] === true)
        problems.push(
          `${move.command} refused with ${refusal.id} though its condition held`,
        );
    }
    if (
      move.kind === 'activate' &&
      refusal.kind === 'invariant' &&
      refusal.id === ids.seats
    )
      problems.push(`${ids.seats}: a complete cast was refused`);
    reached[
      `refused ${refusal.kind === 'invariant' ? refusal.id : refusal.kind}`
    ] =
      (reached[
        `refused ${refusal.kind === 'invariant' ? refusal.id : refusal.kind}`
      ] ?? 0) + 1;
    return { state: { ...world, nowMs: at }, problems };
  }
  const rows = persist(world.rows, outcome.projection);
  const minted = world.minted + 1_000;
  reached[`${labelOf(move).split('(')[0]}`] =
    (reached[`${labelOf(move).split('(')[0]}`] ?? 0) + 1;
  reached[`status ${rows.lifecycle.status}`] =
    (reached[`status ${rows.lifecycle.status}`] ?? 0) + 1;
  // Terminal states absorb every event.
  if (isTerminal(world.rows) && !Bun.deepEquals(rows, world.rows))
    problems.push(
      `${ids.terminal}: ${labelOf(move)} moved a ${statusOf(world.rows)} Round`,
    );
  if (move.kind === 'command') {
    const guards = commandGuards(
      world,
      before.position,
      move.command,
      move.actor,
    );
    for (const [id, held] of Object.entries(guards))
      if (!held)
        problems.push(
          `${id}: ${labelOf(move)} accepted though its condition failed`,
        );
  }
  if (
    move.kind === 'panel' &&
    !(statusOf(world.rows) === 'active' && debatePlayed(world, at))
  )
    problems.push(
      `${ids.panelPlayedRound}: a panel completed an unplayed Round`,
    );
  problems.push(...rowProblems(world.rules, rows));
  // Hydrating the persisted step gives back its state.
  try {
    const fresh = hydrate(world.rules, world.cast, rows, minted);
    if (!Bun.deepEquals(viewAt(fresh, now), viewAt(runtime, now)))
      problems.push(
        `${labelOf(move)}: its persisted rows hydrate to another state`,
      );
    problems.push(...positionProblems(world.rules, fresh.position(iso(now))));
  } catch (error) {
    const refusal = refusalOf(error);
    problems.push(
      `${labelOf(move)}: its persisted rows do not hydrate: ${refusal.kind === 'invariant' ? refusal.id : refusal.kind}`,
    );
  }
  return { state: { ...world, rows, nowMs: now, minted }, problems };
};

/**
 * Engine defects the oracle found, reported on Delivery and left to the
 * engine rewrite (R4.1), since this slice changes no engine behaviour. A
 * walk that reaches one ends there, so it hides nothing else, and
 * `the known engine defects still reproduce` fails once one is fixed, so
 * its entry is deleted with the fix.
 */
const knownDefects: readonly {
  readonly name: string;
  readonly matches: (
    before: World,
    after: World,
    move: Move,
    problem: string,
  ) => boolean;
}[] = [
  {
    name: 'ISSUE-1495: a Round ended while paused does not hydrate',
    matches: (before, after, move, problem) => {
      const { incident } = after.rows.checkpoint;
      return (
        before.rows.lifecycle.status === 'active' &&
        before.rows.checkpoint.incident.phase !== 'none' &&
        isTerminal(after.rows) &&
        incident.phase !== 'none' &&
        incident.resume_point !== null &&
        after.rows.segments.every((row) => row.endedAt !== null) &&
        problem ===
          `${labelOf(move)}: its persisted rows do not hydrate: ${ids.openCount}`
      );
    },
  },
  {
    name: 'ISSUE-1496: an ended Round’s incident still moves',
    matches: (before, after, move, problem) => {
      const { incident, clock_stops, start_gate } = after.rows.checkpoint;
      const previous = before.rows.checkpoint;
      return (
        isTerminal(before.rows) &&
        previous.incident.phase !== 'none' &&
        !Bun.deepEquals(incident, previous.incident) &&
        problem ===
          `${ids.terminal}: ${labelOf(move)} moved a ${statusOf(before.rows)} Round` &&
        Bun.deepEquals(after.rows, {
          ...before.rows,
          checkpoint: { ...previous, incident, clock_stops, start_gate },
        })
      );
    },
  },
  {
    name: 'ISSUE-1497: an ended Round’s start gate still takes capture readiness',
    matches: (before, after, move, problem) => {
      const { start_gate: gate } = before.rows.checkpoint;
      const { start_gate: nextGate } = after.rows.checkpoint;
      return (
        isTerminal(before.rows) &&
        move.kind === 'gate-heard' &&
        gate?.phase === 'awaiting' &&
        nextGate !== null &&
        nextGate.sequence === gate.sequence &&
        (nextGate.phase === 'ready'
          ? gate.seats.length === 1
          : nextGate.until === gate.until &&
            nextGate.seats.length === gate.seats.length - 1 &&
            nextGate.seats.every((seat) => gate.seats.includes(seat))) &&
        problem ===
          `${ids.terminal}: gate-heard moved a ${statusOf(before.rows)} Round` &&
        Bun.deepEquals(after.rows, {
          ...before.rows,
          checkpoint: { ...before.rows.checkpoint, start_gate: nextGate },
        })
      );
    },
  },
];

const checkedStep = (
  world: World,
  move: Move,
  draw: Draw,
  reached: Reached,
): { readonly state: World; readonly problems: readonly string[] } => {
  const next = step(world, move, draw, reached);
  const defect = knownDefects.find(
    (known) =>
      next.problems.length > 0 &&
      next.problems.every((problem) =>
        known.matches(world, next.state, move, problem),
      ),
  );
  if (defect === undefined) return next;
  reached[`known ${defect.name}`] = (reached[`known ${defect.name}`] ?? 0) + 1;
  return { state: { ...next.state, halted: defect.name }, problems: [] };
};

const movesOf = (world: World): readonly Move[] =>
  world.halted !== undefined
    ? []
    : [
        ...commands.flatMap((command) =>
          [
            ...world.cast.map((seat) => seat.actorId),
            null,
            'outsider00000000000000',
          ].map((actor): Move => ({ kind: 'command', command, actor })),
        ),
        // Time and the Round's own decisions come up as often as all commands.
        ...Array.from({ length: 8 }, (): Move => ({ kind: 'tick' })),
        ...Array.from({ length: 3 }, (): Move => ({ kind: 'activate' })),
        { kind: 'stop' },
        { kind: 'pause' },
        { kind: 'resume' },
        { kind: 'end-incident' },
        { kind: 'gate-await' },
        { kind: 'gate-heard' },
        { kind: 'panel' },
        { kind: 'panel' },
        { kind: 'cutoff' },
        { kind: 'settled-forfeit' },
        { kind: 'settled-abandon' },
      ];

const formats = oracleFormats();
const RUNS_PER_FORMAT = 40;

describe('round engine oracle (ADR 0161)', () => {
  test('the oracle checks every registered invariant', () => {
    const checked = new Set([
      ...Object.values(ids),
      ...oracleProperties.map(({ id }) => id),
    ]);
    assert({
      given: 'spec/invariants.json',
      should: 'name only ids the walks or the properties check',
      actual: specIds.filter((id) => !checked.has(id)),
      expected: [],
    });
  });

  test('every format resolves and seats a full cast', () => {
    assert({
      given: 'the catalogue and reference formats under their variants',
      should: 'give the walks many formats to run',
      actual: formats.length >= 20,
      expected: true,
    });
  });

  const reached: Reached = {};
  for (const [index, format] of formats.entries())
    test(
      `generated walks hold every invariant: ${format.name}`,
      () => {
        const cast = castOf(format.rules);
        const report = seededWalk({
          seed: 1_000 + index,
          runs: RUNS_PER_FORMAT,
          steps: 80,
          start: (): World => ({
            rules: format.rules,
            cast,
            rows: openingRound(format.rules),
            nowMs: T0,
            minted: 0,
          }),
          moves: movesOf,
          label: labelOf,
          step: (world, move, draw) => checkedStep(world, move, draw, reached),
        });
        assert({
          given: `${RUNS_PER_FORMAT} seeded walks of up to 80 steps in ${format.name}`,
          should: 'hold every invariant and engine property at every step',
          actual: report.failure,
          expected: null,
        });
      },
      { timeout: 30_000 },
    );

  test('the walks reach every part of the Round', () => {
    const wanted = [
      'activate',
      'tick',
      'start_prep',
      'start_speech',
      'yield',
      'interrupt',
      'forfeit',
      'leave',
      'stop',
      'pause',
      'resume',
      'end-incident',
      'panel',
      'settled-forfeit',
      'settled-abandon',
      'status completed',
      'status abandoned',
      ...Object.values(ids)
        .filter(
          (id) =>
            id !== ids.seats &&
            id !== ids.segmentRules &&
            id !== ids.openCount &&
            id !== ids.prepBudget &&
            id !== ids.lifecycle &&
            id !== ids.stage,
        )
        .map((id) => `refused ${id}`),
    ];
    assert({
      given: 'every walk in every format',
      should: 'accept and refuse each kind of event somewhere',
      actual: wanted.filter(
        (name) => !(reached[name] !== undefined && reached[name] > 0),
      ),
      expected: [],
    });
  });
});

describe('round engine oracle at rare clock boundaries', () => {
  const { rules } = formats[0]!;
  const cast = castOf(rules);
  const opened = () => {
    const blank = openingRound(rules);
    const at = iso(T0);
    return persist(
      blank,
      hydrate(rules, cast, blank).activate({ at, now: at }),
    );
  };

  test('spent prep is refused without changing the Round', () => {
    const active = opened();
    const lead = leadSeatOf(rules.segments[0]!.speak)!;
    const { actorId } = cast.find(({ seat }) => sameSeat(seat, lead))!;
    const side = sideOfSeat(lead)!;
    const at = iso(T0 + 1);
    const runtime = hydrate(rules, cast, {
      ...active,
      checkpoint: {
        ...active.checkpoint,
        prep_consumed_ms: {
          ...active.checkpoint.prep_consumed_ms,
          [side]: rules.inRoundPrep!.budgetMsPerSide,
        },
      },
    });
    const before = viewAt(runtime, T0 + 1);
    const outcome = attempt(() =>
      runtime.execute({ command: { type: 'start_prep' }, actorId, now: at }),
    );
    assert({
      given: 'a speaker at a spendable segment whose side has spent all prep',
      should: 'refuse with the budget invariant and leave the state identical',
      actual: { outcome, state: viewAt(runtime, T0 + 1) },
      expected: {
        outcome: {
          accepted: false,
          refusal: { kind: 'invariant', id: ids.prepBudget },
        },
        state: before,
      },
    });
  });

  test('resolution cutoff refuses before its deadline and abandons at it', () => {
    const active = opened();
    const live = hydrate(rules, cast, active);
    const played = persist(active, live.tick(iso(T0 + 3_600_000)));
    const cutoff =
      Date.parse(played.segments.at(-1)!.endedAt!) +
      attendanceTimingPolicy.resolutionCutoffMs;
    const segmentId = played.segments.find(({ type }) => type === 'speech')!.id;
    const runtime = hydrate(rules, cast, played, 1_000);
    const adjudicate = (ms: number) =>
      runtime.adjudicate({
        segmentId,
        now: iso(ms),
        decision: { evidence: 'resolution_cutoff', decision: 'abandoned' },
      });
    const before = viewAt(runtime, cutoff - 1);
    const early = attempt(() => adjudicate(cutoff - 1));
    const afterRefusal = viewAt(runtime, cutoff - 1);
    const settled = persist(played, adjudicate(cutoff));
    assert({
      given: 'a fully played Round one millisecond before and then at cutoff',
      should: 'preserve the early state and abandon at the declared instant',
      actual: { early, afterRefusal, lifecycle: settled.lifecycle },
      expected: {
        early: { accepted: false, refusal: { kind: 'app', code: 'INVARIANT' } },
        afterRefusal: before,
        lifecycle: {
          status: 'abandoned',
          startedAt: iso(T0),
          completedAt: iso(cutoff),
          outcome: null,
        },
      },
    });
  });
});

describe('known engine defects (reported on Delivery, fixed in R4.1)', () => {
  const format = formats[0]!;
  const cast = castOf(format.rules);
  const pause = (atMs: number) =>
    ({
      kind: 'pause',
      atMs,
      cause: 'vendor_unreachable',
      confirmedUntilMs: null,
    }) as const;
  /** A live Round paused by an incident, then stopped by its owner. */
  const pausedThenStopped = () => {
    let rows = openingRound(format.rules);
    rows = persist(
      rows,
      hydrate(format.rules, cast, rows).activate({ at: iso(T0), now: iso(T0) }),
    );
    rows = persist(
      rows,
      hydrate(format.rules, cast, rows, 100).applyIncident(pause(T0 + 20_000)),
    );
    rows = persist(
      rows,
      hydrate(format.rules, cast, rows, 200).stop(iso(T0 + 30_000)),
    );
    return attempt(() =>
      hydrate(format.rules, cast, rows, 300).tick(iso(T0 + 30_000)),
    );
  };
  /** A paused Round stopped, then told the incident is resuming. */
  const stoppedThenResumed = () => {
    let rows = openingRound(format.rules);
    rows = persist(
      rows,
      hydrate(format.rules, cast, rows).applyIncident(pause(T0)),
    );
    rows = persist(
      rows,
      hydrate(format.rules, cast, rows, 10).stop(iso(T0 + 1)),
    );
    const after = persist(
      rows,
      hydrate(format.rules, cast, rows, 20).applyIncident({
        kind: 'begin_resume',
        atMs: T0 + 2,
        countdownMs: format.rules.countdownMs,
      }),
    );
    return {
      status: after.lifecycle.status,
      moved: !Bun.deepEquals(after, rows),
    };
  };
  const stoppedThenHeard = () => {
    const at = iso(T0);
    const runtime = hydrate(format.rules, cast, openingRound(format.rules));
    const seat = cast.find(({ seat }) => !isJudgeSeat(seat))!;
    runtime.activate({ at, now: at });
    runtime.applyStartGate({
      kind: 'await',
      atMs: T0,
      seats: [seat.id],
      boundMs: 5_000,
    });
    runtime.stop(iso(T0 + 1));
    const before = runtime.checkpoint().start_gate;
    runtime.applyStartGate({ kind: 'heard', atMs: T0 + 2, seat: seat.id });
    return {
      status: runtime.position(iso(T0 + 2)).status,
      before: before?.phase,
      after: runtime.checkpoint().start_gate?.phase,
    };
  };
  test('the known engine defects still reproduce', () => {
    const paused = pausedThenStopped();
    assert({
      given: knownDefects.map(({ name }) => name).join('; '),
      should:
        'still reproduce; once one is fixed, delete its entry from knownDefects and this case',
      actual: {
        [knownDefects[0]!.name]:
          !paused.accepted &&
          paused.refusal.kind === 'invariant' &&
          paused.refusal.id === ids.openCount,
        [knownDefects[1]!.name]: stoppedThenResumed(),
        [knownDefects[2]!.name]: stoppedThenHeard(),
      },
      expected: {
        [knownDefects[0]!.name]: true,
        [knownDefects[1]!.name]: { status: 'abandoned', moved: true },
        [knownDefects[2]!.name]: {
          status: 'abandoned',
          before: 'awaiting',
          after: 'ready',
        },
      },
    });
  });
});

describe('a cast that is not the declared seats never starts (round.seats.complete)', () => {
  test('dropping any seat, or doubling one, is refused with its invariant and changes nothing', () => {
    const problems: string[] = [];
    for (const format of formats) {
      const cast = castOf(format.rules);
      const casts = [
        ...cast.map((_, index) => cast.filter((__, other) => other !== index)),
        [
          ...cast,
          {
            ...cast[0]!,
            id: 'seat-doubled-00000000000',
            actorId: 'actor-doubled-0000000000',
          },
        ],
      ];
      for (const partial of casts) {
        const rows = openingRound(format.rules);
        const runtime = hydrate(format.rules, partial, rows);
        const before = viewAt(runtime, T0);
        const outcome = attempt(() =>
          runtime.activate({ at: iso(T0), now: iso(T0) }),
        );
        if (
          outcome.accepted ||
          outcome.refusal.kind !== 'invariant' ||
          outcome.refusal.id !== ids.seats
        )
          problems.push(
            `${format.name}: a cast of ${partial.length} was not refused with ${ids.seats}`,
          );
        if (!Bun.deepEquals(viewAt(runtime, T0), before))
          problems.push(`${format.name}: the refusal changed the Round`);
      }
    }
    assert({
      given: 'every format with each seat left out, and with one seat doubled',
      should: 'refuse to start with the seat-completeness invariant',
      actual: problems.slice(0, 3),
      expected: [],
    });
  });
});

describe('generated inputs to the engine’s rules, rating and attendance', () => {
  test('ISSUE-1498: the smallest positive volatility rounds down to zero', () => {
    assert({
      given: 'a ledger rating with the smallest positive volatility',
      should:
        'reproduce the underflow until the ledger and rating agree on the bound',
      actual: ratingVolatilityUnderflow(),
      expected: 0,
    });
  });

  for (const property of oracleProperties)
    test(`${property.id}: ${property.claim}`, () => {
      assert({
        given: 'generated inputs',
        should: property.claim,
        actual: property.check(formats),
        expected: null,
      });
    });
});
