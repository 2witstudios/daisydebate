import {
  debaterOn,
  type Side,
  type SpeechPhase,
  type WatchDebate,
} from './debate';
import { durationLabel, sideLabel } from './labels';
import type { ReplayQuery, ReplaySpeed } from './replay-query';
import { replayQueryHref } from './replay-query';
import { totalSeconds, type Turn } from './schedule';

type StepState = 'done' | 'current' | 'upcoming';

export type ReplayPlayer = {
  readonly turnNumber: number;
  readonly turnCount: number;
  readonly letter: string;
  readonly speaker: string;
  readonly seat: string;
  readonly phaseName: string;
  readonly text: string;
  readonly position: number;
  readonly total: number;
  readonly positionLabel: string;
  readonly totalLabel: string;
  readonly speed: ReplaySpeed;
  readonly speeds: readonly {
    readonly value: ReplaySpeed;
    readonly label: string;
  }[];
  readonly nav: {
    readonly prevPhase: string;
    readonly prevTurn: string;
    readonly nextTurn: string;
    readonly nextPhase: string;
  };
  /** The next second's URL while playing; null at the end. */
  readonly tickHref: string | null;
  /** Milliseconds between ticks at this speed. */
  readonly tickMs: number;
};

export type ReplayTimeline = {
  readonly steps: readonly {
    readonly abbreviation: string;
    readonly name: string;
    readonly time: string;
    readonly state: StepState;
    readonly href: string;
  }[];
};

export type ReplayTranscript = {
  readonly q: string;
  readonly rows: readonly {
    readonly stamp: string;
    readonly speaker: string;
    readonly phaseName: string;
    readonly text: string;
    readonly current: boolean;
    readonly href: string;
  }[];
  readonly jump: readonly { readonly value: number; readonly label: string }[];
  readonly jumpValue: number;
};

export type ReplayTimetable = {
  readonly phases: readonly SpeechPhase[];
  readonly turns: readonly Turn[];
};

const SPEEDS: ReplayPlayer['speeds'] = [
  { value: '1', label: '1x' },
  { value: '1.5', label: '1.5x' },
  { value: '2', label: '2x' },
];

const starts = (phases: readonly SpeechPhase[]): readonly number[] =>
  phases.reduce<number[]>(
    (acc, phase, index) => [...acc, (acc[index] ?? 0) + phase.seconds],
    [0],
  );

const indexAt = (points: readonly number[], position: number): number =>
  points.reduce(
    (found, point, index) => (point <= position ? index : found),
    0,
  );

/** The position clamped into the timetable. */
const clampPosition = (query: ReplayQuery, total: number): number =>
  Math.max(0, Math.min(total, query.t));

type Ctx = {
  readonly id: string;
  readonly debate: WatchDebate;
  readonly query: ReplayQuery;
  readonly table: ReplayTimetable;
  readonly position: number;
  readonly total: number;
  readonly turnIndex: number;
  readonly phaseIndex: number;
  readonly phaseStarts: readonly number[];
};

export function replayContext(
  debate: WatchDebate,
  query: ReplayQuery,
  table: ReplayTimetable,
): Ctx {
  const total = totalSeconds(table.phases);
  const position = clampPosition(query, total);
  const phaseStarts = starts(table.phases);
  return {
    id: debate.id,
    debate,
    query,
    table,
    position,
    total,
    turnIndex: indexAt(
      table.turns.map((turn) => turn.startSeconds),
      position,
    ),
    phaseIndex: indexAt(phaseStarts, position),
    phaseStarts,
  };
}

const at = (ctx: Ctx, t: number, extra: Partial<ReplayQuery> = {}): string =>
  replayQueryHref(ctx.id, { ...ctx.query, t, ...extra });

const sideOf = (ctx: Ctx, phaseIndex: number): Side =>
  ctx.table.phases[phaseIndex]?.side ?? 'aff';

/** Previous restarts the current item, or steps back when just begun. */
const restartOrBack = (
  points: readonly number[],
  index: number,
  position: number,
): number => {
  const start = points[index] ?? 0;
  return index > 0 && position - start < 3 ? (points[index - 1] ?? 0) : start;
};

function navFor(ctx: Ctx): ReplayPlayer['nav'] {
  const { table, turnIndex, phaseIndex, phaseStarts, position, total } = ctx;
  const turnStarts = table.turns.map((turn) => turn.startSeconds);
  return {
    prevPhase: at(ctx, restartOrBack(phaseStarts, phaseIndex, position)),
    prevTurn: at(ctx, restartOrBack(turnStarts, turnIndex, position)),
    nextTurn: at(ctx, turnStarts[turnIndex + 1] ?? total),
    nextPhase: at(ctx, phaseStarts[phaseIndex + 1] ?? total),
  };
}

export function buildPlayer(ctx: Ctx): ReplayPlayer {
  const { table, debate, query, position, total, turnIndex, phaseIndex } = ctx;
  const turn = table.turns[turnIndex];
  const side = sideOf(ctx, turn?.phaseIndex ?? phaseIndex);
  const speaker = `@${debaterOn(debate, side).handle}`;
  return {
    turnNumber: turnIndex + 1,
    turnCount: table.turns.length,
    letter: speaker.slice(-1).toUpperCase(),
    speaker,
    seat: sideLabel(side),
    phaseName: table.phases[phaseIndex]?.name ?? '',
    text: turn?.text ?? '',
    position,
    total,
    positionLabel: durationLabel(position),
    totalLabel: durationLabel(total),
    speed: query.speed,
    speeds: SPEEDS,
    nav: navFor(ctx),
    tickHref: position < total ? at(ctx, position + 1) : null,
    tickMs: 1000 / Number(query.speed),
  };
}

const stepState = (index: number, current: number): StepState =>
  index < current ? 'done' : index === current ? 'current' : 'upcoming';

export function buildTimeline(ctx: Ctx): ReplayTimeline {
  return {
    steps: ctx.table.phases.map((phase, index) => ({
      abbreviation: phase.abbreviation,
      name: phase.name,
      time: durationLabel(phase.seconds),
      state: stepState(index, ctx.phaseIndex),
      href: at(ctx, ctx.phaseStarts[index] ?? 0),
    })),
  };
}

export function buildTranscript(ctx: Ctx): ReplayTranscript {
  const needle = ctx.query.q.toLowerCase();
  const rows = ctx.table.turns
    .map((turn, index) => {
      const phase = ctx.table.phases[turn.phaseIndex];
      const handle = debaterOn(ctx.debate, phase?.side ?? 'aff').handle;
      return {
        stamp: durationLabel(turn.startSeconds),
        speaker: `@${handle}`,
        phaseName: phase?.name ?? '',
        text: turn.text,
        current: index === ctx.turnIndex,
        href: at(ctx, turn.startSeconds),
      };
    })
    .filter((row) =>
      `${row.text} ${row.speaker} ${row.phaseName}`
        .toLowerCase()
        .includes(needle),
    );
  return {
    q: ctx.query.q,
    rows,
    jump: ctx.table.phases.map((phase, index) => ({
      value: ctx.phaseStarts[index] ?? 0,
      label: `${phase.abbreviation}. ${phase.name}`,
    })),
    jumpValue: ctx.phaseStarts[ctx.phaseIndex] ?? 0,
  };
}
