import type {
  ChallengeList,
  CompetitionType,
  RatingDivision,
  RatingStyle,
} from '@daisy/protocol';
import { noLadderReason } from '../play/ladder-division-words';
import { ladderLabel, styleLabels } from '../ratings/ladder-labels';

/**
 * Which ladder a challenge between two members could rate on (ADR 0147): a
 * ranked challenge needs both on one division, so across divisions only
 * casual is offered. A hint for the form; the send decides again.
 *
 * - `ranked`: ranked is offered, on the challenger's own ladder. Their
 *   division may be unknown (no rating this season); the send then decides.
 * - `across-ladders`: both divisions are known and differ, so it is casual.
 * - `no-ladder`: the challenger has no division (no age on record).
 */
export type RankedChallenge =
  | { readonly kind: 'ranked'; readonly division: RatingDivision }
  | {
      readonly kind: 'across-ladders';
      readonly own: RatingDivision;
      readonly theirs: RatingDivision;
    }
  | { readonly kind: 'no-ladder' };

/** Whether both members' divisions are known and differ. */
export const acrossLadders = (
  own: RatingDivision | null,
  theirs: RatingDivision | null,
): boolean => own !== null && theirs !== null && own !== theirs;

export const rankedChallengeOf = (
  own: RatingDivision | null,
  theirs: RatingDivision | null,
): RankedChallenge => {
  if (own === null) return { kind: 'no-ladder' };
  if (theirs !== null && acrossLadders(own, theirs))
    return { kind: 'across-ladders', own, theirs };
  return { kind: 'ranked', division: own };
};

/** Whether the form may offer Ranked at all. */
export const offersRanked = (challenge: RankedChallenge): boolean =>
  challenge.kind === 'ranked';

const freestyleLadder = (division: RatingDivision) =>
  ladderLabel({ style: 'freestyle', division });

/** The line under the Ranked and Casual choice, as YChallenge words it. */
export function rankedChallengeLine(
  challenge: RankedChallenge,
  username: string,
): string {
  switch (challenge.kind) {
    case 'ranked':
      return `Ranked on ${freestyleLadder(challenge.division)}`;
    case 'across-ladders':
      return `Ranked needs you both on one ladder. You play ${freestyleLadder(challenge.own)} and @${username} plays ${freestyleLadder(challenge.theirs)}, so this challenge is casual.`;
    case 'no-ladder':
      return noLadderReason;
  }
}

const modeLabels: Readonly<Record<CompetitionType, string>> = {
  ranked: 'Ranked',
  casual: 'Casual',
};

type OfferFacts = {
  readonly mode: CompetitionType;
  readonly format: RatingStyle;
  readonly division: ChallengeList['outgoing'][number]['division'];
};

/**
 * A challenge card's one line: a ranked offer names its ladder ("Youth –
 * Freestyle · Ranked"); a casual one its style, marked when the two members
 * are known to play on different ladders ("Freestyle · Casual · mixed
 * ladders").
 */
export function challengeSummary(
  offer: OfferFacts,
  acrossLadders: boolean,
): string {
  if (offer.mode === 'ranked')
    return `${
      offer.division === null
        ? styleLabels[offer.format]
        : ladderLabel({ style: offer.format, division: offer.division })
    } · ${modeLabels.ranked}`;
  const casual = `${styleLabels[offer.format]} · ${modeLabels.casual}`;
  return acrossLadders ? `${casual} · mixed ladders` : casual;
}

/**
 * Whether this member may accept an incoming offer: casual always; ranked
 * only on their own ladder. A hint; the accept decides again.
 */
export const mayAcceptOffer = (
  offer: Pick<OfferFacts, 'mode' | 'division'>,
  own: RatingDivision | null,
): boolean =>
  offer.mode !== 'ranked' ||
  (own !== null && (offer.division === null || offer.division === own));

/** Why a ranked offer cannot be accepted here, for the card's one line. */
export const unacceptableOfferReason = (
  offer: Pick<OfferFacts, 'division'>,
  own: RatingDivision | null,
): string =>
  own === null || offer.division === null
    ? noLadderReason
    : `This challenge is ranked on ${freestyleLadder(offer.division)}, and you play ${freestyleLadder(own)}. Decline it, or ask for a casual one.`;
