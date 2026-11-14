import type { TabAction } from './action';
import { sampleBallotSettings, sampleJudgeBallot } from './sample/ballot';
import type { SampleScene } from './sample/scene';
import type { ResolvedSetting } from './settings';
import type { EventSwitch } from './setup';

export type WrittenRule = 'required' | 'optional' | 'off';

/**
 * The typed settings of a ballot. Every field is something a host can
 * choose, and the judge's ballot is drawn from nothing else.
 */
export type BallotDefinition = {
  readonly version: number;
  /** Speaker points, or null where the ballot scores nothing. */
  readonly points: {
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly lowPointWin: boolean;
  } | null;
  /** Whether judges rank the speakers or sides in the Room. */
  readonly ranks: boolean;
  /** Criteria scored separately and added up; empty for one score each. */
  readonly criteria: readonly string[];
  readonly outcomes: {
    readonly winner: boolean;
    readonly doubleLoss: boolean;
  };
  readonly written: {
    readonly reason: WrittenRule;
    readonly feedback: WrittenRule;
    /** Never required: a judge may have nothing to tell tab. */
    readonly privateNote: Exclude<WrittenRule, 'required'>;
  };
};

/** Who a judge scores: a side's entry or a section's speaker. */
export type BallotSubject = {
  readonly id: string;
  readonly name: string;
  readonly role: string | null;
};

export type BallotDraft = {
  readonly winner: string | null;
  readonly points: Readonly<Record<string, number>>;
  readonly reason: string;
};

/** One judge's ballot for one fixture, before it is submitted. */
export type JudgeBallot = {
  readonly context: string;
  readonly resolution: string | null;
  readonly definition: BallotDefinition;
  readonly subjects: readonly BallotSubject[];
  readonly draft: BallotDraft;
  readonly reasonReaders: string;
};

/** What a host may choose for one part of the ballot, as labelled options. */
export type BallotOption = {
  readonly id:
    | 'ranks'
    | 'criteria'
    | 'doubleLoss'
    | 'reason'
    | 'feedback'
    | 'privateNote'
    | 'screening';
  readonly label: string;
  readonly detail: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly value: string;
};

export type BallotSettings = {
  readonly event: EventSwitch;
  readonly setup: TabAction;
  readonly lede: string;
  readonly saveLabel: string;
  /** The parts a scope above enforces. */
  readonly locked: readonly ResolvedSetting[];
  readonly sections: readonly {
    readonly heading: string;
    readonly options: readonly BallotOption[];
  }[];
  readonly definition: BallotDefinition;
  readonly preview: {
    readonly lede: string;
    readonly subjects: readonly BallotSubject[];
    readonly draft: BallotDraft;
  };
};

export const readBallotSettings = (
  slug: string,
  event: string,
  scene: SampleScene,
): BallotSettings | null => sampleBallotSettings(slug, event, scene);

export const readJudgeBallot = (
  room: string,
  scene: SampleScene,
): JudgeBallot | null => sampleJudgeBallot(room, scene);

const isWrittenRule = (value: string): value is WrittenRule =>
  value === 'required' || value === 'optional' || value === 'off';

/** The definition after a host chooses `value` for one part of the ballot. */
export function applyBallotOption(
  definition: BallotDefinition,
  id: BallotOption['id'],
  value: string,
): BallotDefinition {
  switch (id) {
    case 'ranks':
      return { ...definition, ranks: value === 'on' };
    case 'criteria':
      return {
        ...definition,
        criteria: value === 'grid' ? ['Argument', 'Evidence', 'Delivery'] : [],
      };
    case 'doubleLoss':
      return {
        ...definition,
        outcomes: { ...definition.outcomes, doubleLoss: value !== 'never' },
      };
    case 'reason':
    case 'feedback':
      return isWrittenRule(value)
        ? { ...definition, written: { ...definition.written, [id]: value } }
        : definition;
    case 'privateNote':
      return value === 'optional' || value === 'off'
        ? {
            ...definition,
            written: { ...definition.written, privateNote: value },
          }
        : definition;
    // Screening decides what is held back from release, never what a judge is asked.
    case 'screening':
      return definition;
  }
}

/** The scale as a judge reads it: "20 to 30, in halves". */
export function pointsScaleLabel(
  points: NonNullable<BallotDefinition['points']>,
): string {
  const step =
    points.step === 0.5
      ? 'in halves'
      : points.step === 1
        ? 'in whole points'
        : `in steps of ${points.step}`;
  return `${points.min} to ${points.max}, ${step}`;
}

/** The key one score is kept under: a subject's, or one criterion of it. */
export const scoreKey = (subject: string, criterion: string | null): string =>
  criterion === null ? subject : `${subject}:${criterion}`;

/** A subject's points: its one score, or its criteria added up. */
export function subjectTotal(
  definition: BallotDefinition,
  points: Readonly<Record<string, number>>,
  subject: string,
): number {
  const start = definition.points?.min ?? 0;
  return definition.criteria.length === 0
    ? (points[subject] ?? start)
    : definition.criteria.reduce(
        (sum, criterion) =>
          sum + (points[scoreKey(subject, criterion)] ?? start),
        0,
      );
}

/**
 * Why this ballot cannot be submitted as it stands, in words that say what
 * to do; null when it can.
 */
export function ballotProblem(
  definition: BallotDefinition,
  subjects: readonly BallotSubject[],
  draft: Pick<BallotDraft, 'winner' | 'points'>,
): string | null {
  if (definition.points === null || definition.points.lowPointWin) return null;
  const winner = subjects.find((subject) => subject.id === draft.winner);
  if (winner === undefined) return null;
  const total = (subject: BallotSubject) =>
    subjectTotal(definition, draft.points, subject.id);
  const ahead = subjects.find((subject) => total(subject) > total(winner));
  return ahead === undefined
    ? null
    : `This tournament doesn't allow the winner to have fewer points. Raise ${winner.name} or lower ${ahead.name}.`;
}
