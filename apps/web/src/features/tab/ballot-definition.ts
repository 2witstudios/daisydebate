import type { BallotDefinitionValue } from '@daisy/protocol/lobby/ballot-read';
import { isScoreOnScale } from '@daisy/protocol';
import { type TabAction } from './action';
import { type ResolvedSetting } from './settings';
import type { EventSwitch } from './setup';

/**
 * The typed settings of a ballot. Every field is something a host can
 * choose, and the judge's ballot is drawn from nothing else.
 */
export type BallotDefinition = BallotDefinitionValue;

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

/** What a host may choose for one part of the ballot, as labelled options. */
type BallotOption = {
  readonly id: 'screening';
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

/**
 * The settings preview's prelim, drawn with sample names. Every ballot
 * settings screen previews with these, the walk's and the stored event's.
 */
export const sampleBallotPreview: BallotSettings['preview'] = {
  lede: 'A prelim round, with sample names',
  subjects: [
    { id: 'jensen', name: 'Jensen', role: 'Affirmative' },
    { id: 'doyle', name: 'Doyle', role: 'Negative' },
  ],
  draft: { winner: 'jensen', points: { jensen: 28.5, doyle: 27 }, reason: '' },
};

/**
 * A preview's sample answers, fitted to the definition it draws: a sample
 * score off that definition's scale or step reads as its default instead,
 * so a 1 to 10 ballot never shows a 28.5.
 */
export function previewDraftOn(
  definition: BallotDefinition,
  draft: BallotDraft,
): BallotDraft {
  const points = definition.points;
  if (points === null) return draft;
  return {
    ...draft,
    points: Object.fromEntries(
      Object.entries(draft.points).map(([key, value]) => [
        key,
        isScoreOnScale(value, points.scale) ? value : points.default,
      ]),
    ),
  };
}
