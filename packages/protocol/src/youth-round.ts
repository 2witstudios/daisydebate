import type { RatingDivision } from './ladder';

/** Where someone stands towards a running Round. */
export type LiveStanding = 'seat' | 'seatless-host' | 'linked-adult' | 'none';

/**
 * Whether a Round is a Youth Round: any Round of a Room in the Youth lobby,
 * casual included (ADR 0157). It is Youth when either its Room or its frozen
 * ladder is Youth, so it fails closed; a Round with no Room has only its
 * ladder. It never decides who may view a Round (ADR 0161): it names whose
 * linked adults see through private, which content waiver its debaters sign,
 * the reuse fence and the Youth takedown. `youthRoundSql` in `@daisy/db` is
 * its SQL mirror.
 */
export const isYouthRound = (
  round: { readonly ladderDivision: RatingDivision | null },
  /** Null for a Round with no Room. */
  roomYouth: boolean | null,
): boolean => roomYouth === true || round.ladderDivision === 'youth';
