import {
  type CompetitionType,
  type RatingDivision,
  type RatingStyle,
} from '@daisy/protocol';
import { noLadderReason } from '../play/ladder-division-words';
import { styleLabels } from '../ratings/ladder-labels';

/**
 * The line under the Ranked and Casual choice: the age prompt when the
 * viewer has no age on record, so Ranked is not theirs; otherwise none.
 */
export const challengeModeLine = (own: RatingDivision | null): string | null =>
  own === null ? noLadderReason : null;

const modeLabels: Readonly<Record<CompetitionType, string>> = {
  ranked: 'Ranked',
  casual: 'Casual',
};

/** A challenge card's one line: "Freestyle · Ranked" (YChallenge). */
export const challengeSummary = (offer: {
  readonly mode: CompetitionType;
  readonly format: RatingStyle;
}): string => `${styleLabels[offer.format]} · ${modeLabels[offer.mode]}`;
