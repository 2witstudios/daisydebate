import { instantMs } from '@daisy/clock';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  seededDraws,
  seededWalk,
  type Draw,
} from '@daisy/seeded-random/testing';
import { attendanceTimingPolicy } from '@daisy/protocol/attendance';
import {
  isJudgeSeat,
  sameSeat,
  sideOfSeat,
  type SideKey,
} from '@daisy/protocol/seats';
import { isRoundOver } from '@daisy/protocol/round';
import { leadSeatOf } from '@daisy/protocol/format-seating';
import {
  type RoundCommand,
  type RoundParticipantSeat,
  type RoundPosition,
  type RoundProjection,
} from '@daisy/protocol/runtime';
import { type RoundRules } from '@daisy/protocol/format';
import {
  castOf,
  hydrate,
  iso,
  openingRound,
  oracleFormats,
  panelCompletion,
  persist,
  refusalOf,
  scheduledSeatOf,
  takesPointsOfInformation,
  viewAt,
  type Persisted,
  type Refusal,
} from './round-oracle.test-support';
import { oracleProperties } from './round-oracle-properties.test-support';

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
  poiRule: 'round.poi.requires-rule',
  lifecycle: 'round.lifecycle.matches-status',
  stage: 'round.stage.matches-clock',
  terminal: 'round.status.completed.terminal',
} as const;

const commands: readonly RoundCommand['type'][] = [
  'start_prep',
  'cancel_prep',
  'start_speech',
  'yield',
  'offer_poi',
  'withdraw_poi',
  'accept_poi',
  'decline_poi',
  'end_poi',
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
};

const T0 = instantMs('2026-11-19T09:00:00.000Z');

/** What happened to the Round over all walks: the walks must reach each. */
type Reached = Record<string, number>;

const statusOf = (rows: Persisted) => rows.lifecycle.status;
const isTerminal = (rows: Persisted) => isRoundOver(statusOf(rows));

/** How far time moves before a move: scaled to the Round's own clock. */
const delayOf = (world: World, draw: Draw): number => {
  // An offer lapses in seconds and a point lasts seconds: answer one in time, often.
  if (
    world.rows.checkpoint.point_of_information.phase !== 'none' &&
    draw(2) === 0
  )
    return [0, 1, 250, 5_000][draw(4)]!;
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
  const prepBudget = rules.inRoundPrep?.budgetMsPerSide ?? 0;
  for (const [side, spent] of Object.entries(rows.checkpoint.prep_consumed_ms))
    if (!Number.isSafeInteger(spent) || spent < 0 || spent > prepBudget)
      problems.push(`${ids.prepBudget}: ${side} persisted ${spent} ms of prep`);
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
      instantMs(row.endedAt) < instantMs(row.startedAt)
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
            instantMs(completedAt) >= instantMs(startedAt));
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

/** Whether `side` may spend prep before segment `target`, by the rules alone. */
const spendableBefore = (
  rules: RoundRules,
  side: SideKey | null,
  target: number,
): boolean => {
  const prep = rules.inRoundPrep;
  const upcoming = rules.segments[target];
  if (prep === null || side === null || upcoming === undefined) return false;
  const lead = leadSeatOf(upcoming.speak);
  const expires = prep.expiresAtSegment;
  return (
    lead !== null &&
    sideOfSeat(lead) === side &&
    prep.spendableBefore.includes(upcoming.type) &&
    (expires === null ||
      rules.segments.findIndex((segment) => segment.key === expires) > target)
  );
};

const positionProblems = (
  rules: RoundRules,
  cast: readonly RoundParticipantSeat[],
  position: RoundPosition,
): string[] => {
  const problems: string[] = [];
  const prep = rules.inRoundPrep;
  const open = position.openSegment;
  problems.push(...pointProblems(rules, cast, position));
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
  if (position.prep?.phase === 'running') {
    if (open !== null)
      problems.push(`${ids.prepSpendable}: prep runs while a segment is live`);
    const upcoming = position.nextSegment;
    if (
      upcoming === null ||
      !spendableBefore(rules, position.prep.side, upcoming.sequence)
    )
      problems.push(
        `${ids.prepSpendable}: prep runs before a segment it may not`,
      );
  }
  // Prep called ahead waits on the live segment and is for the one after it (INTX-2).
  if (position.prep?.phase === 'called') {
    if (open === null)
      problems.push(
        `${ids.prepSpendable}: prep is called with no segment live`,
      );
    else if (!spendableBefore(rules, position.prep.side, open.sequence + 1))
      problems.push(
        `${ids.prepSpendable}: prep is called before a segment it may not`,
      );
  }
  return problems;
};

/**
 * Points of information live only in a speech that takes them: offers stand
 * inside its window and never from the speaker's side; an accepted point is
 * another side's and lasts no longer than the rule allows (INTX-13..15).
 */
const pointProblems = (
  rules: RoundRules,
  cast: readonly RoundParticipantSeat[],
  position: RoundPosition,
): string[] => {
  const point = position.pointOfInformation;
  const open = position.openSegment;
  if (point === null) return [];
  if (open === null || !takesPointsOfInformation(rules, open.sequence))
    return [
      `${ids.poiRule}: points of information outside a speech that takes them`,
    ];
  const rule = rules.interaction.pointsOfInformation;
  const speaker = scheduledSeatOf(rules, cast, open.sequence);
  const speakerSide = speaker === null ? null : sideOfSeat(speaker.seat);
  const problems: string[] = [];
  const otherSide = (participantId: string) => {
    const seat = cast.find(({ id }) => id === participantId);
    return (
      seat !== undefined &&
      seat.id !== speaker?.id &&
      !isJudgeSeat(seat.seat) &&
      (speakerSide === null || sideOfSeat(seat.seat) !== speakerSide)
    );
  };
  const closes = instantMs(point.offersCloseAt);
  if (instantMs(point.offersOpenAt) > closes)
    problems.push(`${ids.poiRule}: the offer window opens after it closes`);
  for (const offer of point.offers) {
    if (!otherSide(offer.participantId))
      problems.push(`${ids.poiRule}: an offer from the speaker’s own side`);
    if (instantMs(offer.lapsesAt) > closes)
      problems.push(`${ids.poiRule}: an offer stands past the protected end`);
  }
  if (
    new Set(point.offers.map(({ participantId }) => participantId)).size !==
    point.offers.length
  )
    problems.push(`${ids.poiRule}: one seat offers twice`);
  const { holder } = point;
  if (holder !== null) {
    if (!otherSide(holder.participantId))
      problems.push(`${ids.poiRule}: a point held by the speaker’s own side`);
    if (
      !rule.allowed ||
      holder.remainingMs <= 0 ||
      holder.remainingMs > rule.maxDurationMs
    )
      problems.push(
        `${ids.poiRule}: a point with ${holder.remainingMs} ms left`,
      );
    if (point.offers.length > 0)
      problems.push(`${ids.poiRule}: offers stand while a point is given`);
  }
  return problems;
};

// ---- What a command may do, read from the position before it ----

const seatOf = (world: World, actor: string | null) =>
  actor === null
    ? null
    : (world.cast.find((seat) => seat.actorId === actor) ?? null);

/** The segment a press of `type` means now, read from the position alone. */
const meantSequenceOf = (
  world: World,
  position: RoundPosition,
  type: RoundCommand['type'],
): number => {
  const open = position.openSegment;
  const next = position.nextSegment?.sequence ?? world.rules.segments.length;
  switch (type) {
    // Prep is for the segment after the live one, or the one the gap leads to.
    case 'start_prep':
    case 'cancel_prep':
      return open === null ? next : open.sequence + 1;
    case 'start_speech':
      return next;
    default:
      return open?.sequence ?? next;
  }
};

/**
 * The command a move posts: the segment it means, or (when `stale`) one it
 * does not, and for an accept one of the standing offers or any seat.
 */
const commandOf = (
  world: World,
  position: RoundPosition,
  type: RoundCommand['type'],
  stale: boolean,
  draw: Draw,
): RoundCommand => {
  const sequence = meantSequenceOf(world, position, type) + (stale ? 1 : 0);
  switch (type) {
    case 'forfeit':
    case 'leave':
      return { type };
    case 'accept_poi': {
      const offers = (position.pointOfInformation?.offers ?? []).map(
        ({ participantId }) => participantId,
      );
      const pool =
        offers.length > 0 && draw(4) !== 0
          ? offers
          : world.cast.map(({ id }) => id);
      return {
        type,
        sequence,
        offererParticipantId: pool[draw(pool.length)] ?? 'nobody',
      };
    }
    default:
      return { type, sequence };
  }
};

/**
 * Each id a command's refusal may name, and whether the position before it
 * met the condition that id guards. An accepted command met every one; a
 * refusal naming an id failed that one.
 */
const commandGuards = (
  world: World,
  position: RoundPosition,
  command: RoundCommand,
  actor: string | null,
): Readonly<Record<string, boolean>> => {
  const seat = seatOf(world, actor);
  const side = seat === null ? null : sideOfSeat(seat.seat);
  const open = position.openSegment;
  const terminal = { [ids.terminal]: position.status !== 'completed' };
  const pointRule = {
    ...terminal,
    [ids.poiRule]:
      open !== null && takesPointsOfInformation(world.rules, open.sequence),
  };
  switch (command.type) {
    case 'start_prep':
      return {
        ...terminal,
        [ids.prepCapability]: world.rules.inRoundPrep !== null,
        [ids.prepSpendable]: spendableBefore(
          world.rules,
          side,
          meantSequenceOf(world, position, 'start_prep'),
        ),
        [ids.prepBudget]:
          side !== null && (position.prepBudgetRemainingMs?.[side] ?? 0) > 0,
      };
    case 'cancel_prep':
      return terminal;
    case 'start_speech':
      return {
        ...terminal,
        [ids.speechPrep]: position.prep?.phase === 'running',
      };
    case 'yield':
      return { ...terminal, [ids.yieldFloor]: mayYield(world, open, seat) };
    case 'offer_poi':
    case 'withdraw_poi':
    case 'accept_poi':
    case 'decline_poi':
    case 'end_poi':
      return pointRule;
    case 'forfeit':
    case 'leave':
      return terminal;
  }
};

/**
 * Whether the seat may end the live segment early: its scheduled seat may end
 * a speech when the rules permit yielding; the asker always ends
 * cross-examination, and a person answering a bot asker may (INTX-9).
 */
const mayYield = (
  world: World,
  open: RoundPosition['openSegment'],
  seat: RoundParticipantSeat | null,
): boolean => {
  if (open === null || seat === null) return false;
  const scheduled = scheduledSeatOf(world.rules, world.cast, open.sequence);
  const holds = scheduled !== null && scheduled.id === seat.id;
  if (world.rules.segments[open.sequence]?.type !== 'cross_ex')
    return holds && world.rules.interaction.yield?.allowed === true;
  const side = sideOfSeat(seat.seat);
  return (
    holds ||
    (scheduled?.kind === 'bot' &&
      seat.kind === 'human' &&
      !isJudgeSeat(seat.seat) &&
      side !== null &&
      side !== sideOfSeat(scheduled.seat))
  );
};

/**
 * What an accepted command must also have honoured, beyond the ids it may
 * name: a stale press never applies (INTX-7), offers and accepts stand inside
 * the speech's window, and ending cross-examination returns no prep (INTX-8).
 */
const acceptedProblems = (
  world: World,
  before: RoundPosition,
  command: RoundCommand,
  actor: string | null,
  stale: boolean,
  at: number,
  rows: Persisted,
): string[] => {
  const problems: string[] = [];
  const label = `${command.type}(${actor ?? 'nobody'})`;
  if (stale) problems.push(`${label}: a press naming another segment applied`);
  const seat = seatOf(world, actor);
  const point = before.pointOfInformation;
  const open = before.openSegment;
  const speaker =
    open === null
      ? null
      : scheduledSeatOf(world.rules, world.cast, open.sequence);
  switch (command.type) {
    case 'offer_poi':
      if (
        point === null ||
        at < instantMs(point.offersOpenAt) ||
        at >= instantMs(point.offersCloseAt)
      )
        problems.push(`${label}: an offer outside the speech’s window`);
      if (seat === null || seat.id === speaker?.id)
        problems.push(`${label}: the speaker offered to their own speech`);
      break;
    case 'accept_poi':
      if (seat === null || seat.id !== speaker?.id)
        problems.push(`${label}: someone other than the speaker accepted`);
      if (point === null || at >= instantMs(point.offersCloseAt))
        problems.push(`${label}: an accept inside the protected end`);
      if (
        !(point?.offers ?? []).some(
          ({ participantId }) => participantId === command.offererParticipantId,
        )
      )
        problems.push(`${label}: accepted an offer that was not standing`);
      break;
    case 'yield': {
      if (
        open === null ||
        world.rules.segments[open.sequence]?.type !== 'cross_ex'
      )
        break;
      // The same instant without the press: what the clock alone would have stored.
      const clockOnly = persist(
        world.rows,
        hydrate(world.rules, world.cast, world.rows, world.minted).tick(
          iso(at),
        ),
      );
      if (
        !Bun.deepEquals(
          rows.checkpoint.prep_consumed_ms,
          clockOnly.checkpoint.prep_consumed_ms,
        )
      )
        problems.push(`${label}: ending cross-examination refunded prep`);
      if ((rows.segments[open.sequence]?.returnedMs ?? 0) !== 0)
        problems.push(`${label}: ending cross-examination returned time`);
      break;
    }
    case 'start_prep': {
      const phase = rows.checkpoint.prep.phase;
      if (phase !== (open === null ? 'running' : 'called'))
        problems.push(`${label}: prep stood ${phase} after the press`);
      break;
    }
  }
  return problems;
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
    instantMs(last.endedAt) <= nowMs
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
  // One press in eight names a segment it does not mean (INTX-7).
  const stale =
    move.kind === 'command' &&
    move.command !== 'forfeit' &&
    move.command !== 'leave' &&
    draw(8) === 0;
  const command =
    move.kind === 'command'
      ? commandOf(world, before.position, move.command, stale, draw)
      : null;
  const sides = world.rules.sides.map((side) => side.key);
  const problems: string[] = [];
  let later = at;
  const outcome = attempt((): RoundProjection => {
    switch (move.kind) {
      case 'command':
        return runtime.execute({
          command: command!,
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
            row === undefined ? at : instantMs(row.startedAt) + 40_000,
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
        command!,
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
    const guards = commandGuards(world, before.position, command!, move.actor);
    for (const [id, held] of Object.entries(guards))
      if (!held)
        problems.push(
          `${id}: ${labelOf(move)} accepted though its condition failed`,
        );
    problems.push(
      ...acceptedProblems(
        world,
        before.position,
        command!,
        move.actor,
        stale,
        at,
        rows,
      ),
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
    problems.push(
      ...positionProblems(world.rules, world.cast, fresh.position(iso(now))),
    );
  } catch (error) {
    const refusal = refusalOf(error);
    problems.push(
      `${labelOf(move)}: its persisted rows do not hydrate: ${refusal.kind === 'invariant' ? refusal.id : refusal.kind}`,
    );
  }
  return { state: { ...world, rows, nowMs: now, minted }, problems };
};

/** The speaker's answers to standing offers, and the holder's and speaker's end of a point. */
const pointAnswersOf = (world: World): readonly Move[] => {
  const point = world.rows.checkpoint.point_of_information;
  const open = world.rows.segments.find((row) => row.endedAt === null);
  if (point.phase === 'none' || open === undefined) return [];
  const speaker = scheduledSeatOf(world.rules, world.cast, open.sequence);
  const press = (
    command: RoundCommand['type'],
    actor: string | undefined,
    times: number,
  ): Move[] =>
    actor === undefined
      ? []
      : Array.from({ length: times }, () => ({
          kind: 'command',
          command,
          actor,
        }));
  if (point.phase === 'offered')
    return [
      ...press('accept_poi', speaker?.actorId, 30),
      ...press('decline_poi', speaker?.actorId, 10),
    ];
  const holder = world.cast.find(
    ({ id }) => id === point.holder_participant_id,
  );
  return [
    ...press('end_poi', holder?.actorId, 10),
    ...press('end_poi', speaker?.actorId, 10),
  ];
};

const movesOf = (world: World): readonly Move[] => [
  ...commands.flatMap((command) =>
    [
      ...world.cast.map((seat) => seat.actorId),
      null,
      'outsider00000000000000',
    ].map((actor): Move => ({ kind: 'command', command, actor })),
  ),
  // A live speech under a points-of-information rule draws its POI moves more
  // often, so walks reach offer, accept, decline and return (INTX-13..15).
  ...(world.rules.interaction.pointsOfInformation.allowed &&
  world.rows.segments.some(
    (row) => row.endedAt === null && row.type === 'speech',
  )
    ? (['offer_poi', 'accept_poi', 'decline_poi', 'end_poi'] as const).flatMap(
        (command) =>
          world.cast.flatMap((seat) =>
            Array.from({ length: 3 }, (): Move => ({
              kind: 'command',
              command,
              actor: seat.actorId,
            })),
          ),
      )
    : []),
  // A standing offer or a point being given draws its answers, from the
  // speaker and the holder, more often still.
  ...pointAnswersOf(world),
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
const ROTATING_RUNS_PER_FORMAT = 10;

/**
 * The rotating seed: fresh on every run unless `ROUND_ORACLE_SEED` replays
 * one, so the walks cover new ground each time while the fixed seeds keep a
 * stable baseline. Each assertion names it, so a failure says how to replay.
 */
const rotatingSeed = (() => {
  const replay = process.env.ROUND_ORACLE_SEED;
  if (replay !== undefined && replay !== '') {
    const seed = Number(replay);
    if (!Number.isSafeInteger(seed))
      throw new Error('ROUND_ORACLE_SEED must be an integer');
    return seed;
  }
  // Below 2^31 - 2^16, so every per-format seed stays a 32-bit integer.
  return crypto.getRandomValues(new Uint32Array(1))[0]! % 0x7fff_0000;
})();

describe('round engine oracle (ADR 0164)', () => {
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
  const walk = (format: (typeof formats)[number], seed: number, runs: number) =>
    seededWalk({
      seed,
      runs,
      steps: 80,
      start: (): World => ({
        rules: format.rules,
        cast: castOf(format.rules),
        rows: openingRound(format.rules),
        nowMs: T0,
        minted: 0,
      }),
      moves: movesOf,
      label: labelOf,
      step: (world, move, draw) => step(world, move, draw, reached),
    });
  for (const [index, format] of formats.entries())
    test(
      `generated walks hold every invariant: ${format.name}`,
      () => {
        assert({
          given: `${RUNS_PER_FORMAT} seeded walks of up to 80 steps in ${format.name}`,
          should: 'hold every invariant and engine property at every step',
          actual: walk(format, 1_000 + index, RUNS_PER_FORMAT).failure,
          expected: null,
        });
        // Replay a failure with ROUND_ORACLE_SEED=<rotating seed>.
        const seed = rotatingSeed + index;
        assert({
          given: `${ROTATING_RUNS_PER_FORMAT} walks on rotating seed ${seed} (ROUND_ORACLE_SEED=${rotatingSeed}) in ${format.name}`,
          should: 'hold every invariant and engine property at every step',
          actual: walk(format, seed, ROTATING_RUNS_PER_FORMAT).failure,
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
      'cancel_prep',
      'start_speech',
      'yield',
      'offer_poi',
      'accept_poi',
      'decline_poi',
      'end_poi',
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
      runtime.execute({
        command: { type: 'start_prep', sequence: 0 },
        actorId,
        now: at,
      }),
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
      instantMs(played.segments.at(-1)!.endedAt!) +
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

describe('hydration rejects inconsistent Round rows', () => {
  test('a single corrupted row or checkpoint field names its invariant', () => {
    const proof = seededDraws({
      seed: 1_137,
      runs: 126,
      draws: 3,
      problems: (draw) => {
        const format = formats[draw(formats.length)]!;
        const { rules } = format;
        const cast = castOf(rules);
        const blank = openingRound(rules);
        const start = T0 + draw(1_000);
        const now = start + rules.countdownMs;
        const live = persist(
          blank,
          hydrate(rules, cast, blank).activate({
            at: iso(start),
            now: iso(now),
          }),
        );
        const [open, ...later] = live.segments;
        if (
          live.lifecycle.status !== 'active' ||
          open?.endedAt !== null ||
          later.length > 0
        )
          return [`${format.name} never opened its first segment`];
        hydrate(rules, cast, live).position(iso(now));

        const alternatives: ReadonlyArray<readonly [string, Persisted]> = [
          [
            ids.segmentRules,
            {
              ...live,
              segments: [
                { ...open, durationMs: open.durationMs + 1 + draw(1_000) },
              ],
            },
          ],
          [
            ids.openCount,
            {
              ...live,
              checkpoint: {
                ...live.checkpoint,
                prep: { phase: 'lead', ended_at: iso(now) },
              },
            },
          ],
          // A point of information in a segment that takes none.
          ...(takesPointsOfInformation(rules, open.sequence)
            ? []
            : [
                [
                  ids.openCount,
                  {
                    ...live,
                    checkpoint: {
                      ...live.checkpoint,
                      point_of_information: {
                        phase: 'speaking',
                        holder_participant_id: cast.at(-1)!.id,
                        accepted_at: iso(now),
                      },
                    },
                  },
                ] as const,
              ]),
          [
            ids.lifecycle,
            {
              ...live,
              lifecycle: { ...live.lifecycle, startedAt: 'invalid time' },
            },
          ],
          [ids.stage, { ...live, currentStage: 'countdown' }],
        ];
        return alternatives.flatMap(([id, rows]) => {
          try {
            hydrate(rules, cast, rows);
            return [`${format.name} hydrated rows violating ${id}`];
          } catch (error) {
            const refusal = refusalOf(error);
            return refusal.kind === 'invariant' && refusal.id === id
              ? []
              : [`${format.name} refused ${id} as ${JSON.stringify(refusal)}`];
          }
        });
      },
    });
    assert({
      given:
        'generated valid live Rounds with one corrupted persisted field at a time',
      should:
        'hydrate each control and refuse each corruption with its registered invariant',
      actual: proof.failure,
      expected: null,
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
