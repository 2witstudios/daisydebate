import { z } from 'zod';
import {
  canonicalRatingStyle,
  ratingStyles,
  type RatingStyle,
} from './primitives';
import type { CompetitionType } from './round';
import { isDebatingSeat, type SeatRef } from './seats';

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

/**
 * What a ranked Room's seated debaters add up to: unset until one sits, one
 * division when all share it, mixed otherwise. A debater with no division
 * fits no ladder, so they make the seating mixed.
 */
export type SeatedDivision = RatingDivision | 'unset' | 'mixed';

export function divisionForSeatedDebaters(
  divisions: readonly (RatingDivision | null)[],
): SeatedDivision {
  const [first, ...rest] = divisions;
  if (first === undefined) return 'unset';
  if (first === null) return 'mixed';
  return rest.every((division) => division === first) ? first : 'mixed';
}

/**
 * The division a ranked Room's seated debaters set: its human debaters only.
 * Judges never set it, and a bot holds no ranked debater seat.
 */
type SeatedPerson = {
  readonly kind: 'human' | 'bot';
  readonly seat: SeatRef;
  readonly division: RatingDivision | null;
};
/** The divisions of a Room's seated human debaters: judges and bots set none. */
export const seatedDebaterDivisions = (
  participants: readonly SeatedPerson[],
): (RatingDivision | null)[] =>
  participants
    .filter((p) => p.kind === 'human' && isDebatingSeat(p.seat))
    .map((p) => p.division);
export const seatedDivision = (
  participants: readonly SeatedPerson[],
): SeatedDivision =>
  divisionForSeatedDebaters(seatedDebaterDivisions(participants));

/**
 * A ranked Room's ladder as a row or bar names it: a launched Room's Round's
 * own (mixed when that Round plays casual), an open Room's from its seated
 * debaters. A casual Room has none.
 */
export function roomLadderOf(room: {
  readonly competitionType: CompetitionType;
  /** Whether the Room has launched its Round. */
  readonly launched: boolean;
  /** The launched Round's frozen division; null when it plays casual. */
  readonly roundDivision: RatingDivision | null;
  /** The open Room's seated human debaters' divisions. */
  readonly debaterDivisions: readonly (RatingDivision | null)[];
}): SeatedDivision | null {
  if (room.competitionType !== 'ranked') return null;
  if (room.launched) return room.roundDivision ?? 'mixed';
  return divisionForSeatedDebaters(room.debaterDivisions);
}

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
 * seated division; when its debaters mix divisions (or none sat) the Round
 * plays casual and rates no one, though the Room stays ranked. A format that
 * is no style never gets a ladder invented for it.
 */
export function roundCompetition(
  room: {
    readonly competitionType: CompetitionType;
    readonly formatId: string;
  },
  seated: SeatedDivision,
): RoundCompetition {
  if (room.competitionType !== 'ranked') return casualRound;
  const style = canonicalRatingStyle(room.formatId);
  if (style === null || seated === 'unset' || seated === 'mixed')
    return casualRound;
  return { competitionType: 'ranked', ladder: { style, division: seated } };
}
