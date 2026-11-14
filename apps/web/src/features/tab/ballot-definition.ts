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
  /**
   * The ballot part by part. An event that follows a template has its whole
   * definition pinned, so every part is locked and only what is not in the
   * definition (text screening) is the host's to choose.
   */
  readonly sections: readonly {
    readonly heading: string;
    readonly locked: readonly ResolvedSetting[];
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
