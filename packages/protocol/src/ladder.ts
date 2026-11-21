import { z } from 'zod';
import {
  canonicalRatingStyle,
  ratingStyles,
  type RatingStyle,
} from './primitives';
import type { CompetitionType } from './round';
import type { LobbyAgeRule } from './lobby/eligibility';

/**
 * A ladder is a style in a division (owner decision 79, ADR 0147): Open –
 * Freestyle and Youth – Freestyle. The style says what is debated; the
 * division says who may debate it. Every rule over the pair lives here,
 * beside the vocabulary, so the adapters, the auth rules and the UI share one
 * reading of it.
 */

/**
 * A person's age band from their stored birth month (ADR 0075). `@daisy/auth`
 * computes it on an injected clock and the database's `daisy_age_band` with
 * the same edges; this is the band vocabulary both produce.
 */
export const ageBands = ['under-13', '13-15', '16-17', 'adult'] as const;
export type AgeBand = (typeof ageBands)[number];

/** Who may debate on a ladder: Open is 18 and over, Youth is under 18. */
export const ratingDivisions = ['open', 'youth'] as const;
export type RatingDivision = (typeof ratingDivisions)[number];

/** The existing ledger key for a lobby until ratings key on lobby ladders. */
export const ratingDivisionForAgeRule = (rule: LobbyAgeRule): RatingDivision =>
  rule === 'under-18' ? 'youth' : 'open';

/** One rating ladder: a style in a division. */
export type Ladder = {
  readonly style: RatingStyle;
  readonly division: RatingDivision;
};

/** A ladder as a message carries it. */
export const ladderSchema = z.strictObject({
  style: z.enum(ratingStyles),
  division: z.enum(ratingDivisions),
});

/** The one string naming a ladder, for maps and lock keys. */
export const ladderKey = <S extends string>(
  style: S,
  division: RatingDivision,
): `${S}:${RatingDivision}` => `${style}:${division}`;

/** Every ladder the styles make: each style in each division. */
export const daisyLaddersOf = <S extends string>(
  styles: readonly S[],
): readonly { readonly style: S; readonly division: RatingDivision }[] =>
  styles.flatMap((style) =>
    ratingDivisions.map((division) => ({ style, division })),
  );

/** Daisy's ladders today: Open – Freestyle and Youth – Freestyle. */
export const daisyLadders: readonly Ladder[] = daisyLaddersOf(ratingStyles);

/**
 * How long a member is held on Youth past their 18th birthday, at most
 * (ADR 0147 §3): a member is aged on the Youth season's start, so a mid-season
 * birthday finishes that season on Youth, but never on an instant before their
 * own age record nor more than this many months back. A Youth season that never
 * closes therefore holds no one on Youth for longer than this.
 */
export const YOUTH_CARRY_MONTHS = 12;

/**
 * The division an age band debates on: 18 and over is Open, any younger
 * member is Youth. No valid age record has no division, so no ranked seat.
 */
export const divisionOfAgeBand = (
  band: AgeBand | null,
): RatingDivision | null =>
  band === null ? null : band === 'adult' ? 'open' : 'youth';

/** How a Round from this Room competes, frozen at Start. */
export type RoundCompetition =
  | { readonly competitionType: 'ranked'; readonly ladder: Ladder }
  | { readonly competitionType: 'casual'; readonly ladder: null };

const casualRound: RoundCompetition = {
  competitionType: 'casual',
  ladder: null,
};

/**
 * The Round a Room's Start freezes. A ranked Room rates on its style in the
 * Room's own division, fixed when it was created (ADR 0156): its debater seats
 * hold only that lobby's members. A format that is no style never gets a
 * ladder invented for it.
 */
export function roundCompetition(room: {
  readonly competitionType: CompetitionType;
  readonly formatId: string;
  readonly division: RatingDivision;
}): RoundCompetition {
  if (room.competitionType !== 'ranked') return casualRound;
  const style = canonicalRatingStyle(room.formatId);
  if (style === null) return casualRound;
  return {
    competitionType: 'ranked',
    ladder: { style, division: room.division },
  };
}
