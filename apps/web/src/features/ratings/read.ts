import type { StandingsStore } from '@daisy/db/stores/standings';
import { addMs } from '@daisy/clock';
import type { StandingsRead } from '@daisy/db/ratings';
import { ratingDivisionForAgeRule, type Ladder } from '@daisy/protocol/ladder';
import { createAppError } from '@daisy/errors';
import { spectatorClockAt } from '../spectating/spectator-clock';
import { rankRatingEntries } from './rank';
import { ratingStanding } from './standing';
import { summarizeStandings } from './summarize';
import { replayPublishedStandings } from './replay-published-standings';

export type RatingReadStore = Pick<
  StandingsStore,
  | 'listLadderSeasons'
  | 'readStandings'
  | 'readRatingBlindings'
  | 'listOfficialRatingLadders'
>;
type RatingSeason = {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly status: 'active' | 'closed';
};

/** Ratings owns the authoritative read, aggregation, uncertainty, rank and blinding context. */
export async function readRatingStandings(
  store: RatingReadStore,
  input: {
    /** The presentation used by this route and legacy URLs. */
    readonly ladder: Ladder;
    readonly lobbyId?: string;
    readonly frozenLadder?: {
      readonly lobbyId: string;
      readonly ladderId: string;
    };
    readonly seasonId: string | null;
    readonly now: string;
    readonly viewerActorId?: string;
    /** A Round the caller holds an authorized read of. */
    readonly revealRoundId?: string;
  },
) {
  const pool =
    input.frozenLadder ??
    (await store.listOfficialRatingLadders()).find((item) =>
      input.lobbyId
        ? item.lobbyId === input.lobbyId
        : ratingDivisionForAgeRule(item.ageRule) === input.ladder.division,
    );
  if (!pool) return null;
  const ladderId = 'ladderId' in pool ? pool.ladderId : pool.id;
  const records = await store.listLadderSeasons(pool.lobbyId);
  const seasons: readonly RatingSeason[] = records.map((s) => ({
    id: s.id,
    name: s.name,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    status: s.status,
  }));
  const season =
    seasons.find((s) => s.id === input.seasonId) ??
    seasons.find((s) => s.status === 'active') ??
    seasons[0];
  if (!season) return null;
  const source = replayPublishedStandings(
    await store.readStandings({
      ladderId,
      lobbyId: pool.lobbyId,
      seasonIds: seasons.map((s) => s.id),
      clock: spectatorClockAt(input.now),
      ...(!input.frozenLadder && !input.revealRoundId
        ? { includeCertified: true }
        : {}),
      ...(input.revealRoundId ? { revealRoundId: input.revealRoundId } : {}),
    }),
  );
  const blindedActorIds = input.viewerActorId
    ? await store.readRatingBlindings(input.viewerActorId)
    : [];
  const atBySeason = Object.fromEntries(
    seasons.map((s) => {
      if (s.status !== 'closed') return [s.id, input.now];
      if (s.endsAt === null)
        throw createAppError('INTERNAL', 'A closed season has no end instant');
      return [s.id, s.endsAt];
    }),
  );
  const summaries = seasons.flatMap((s) =>
    summarizeStandings(
      {
        ratings: source.ratings.filter((r) => r.seasonId === s.id),
        changes: source.changes.filter((c) => c.seasonId === s.id),
      },
      addMs(atBySeason[s.id]!, -(7 * 86400000)),
    ),
  );
  const entriesBySeason = Object.fromEntries(
    seasons.map((s) => {
      const at = atBySeason[s.id]!;
      return [
        s.id,
        rankRatingEntries(
          summaries
            .flatMap((r) =>
              r.seasonId === s.id && r.username !== null
                ? [{ ...r, username: r.username }]
                : [],
            )
            .map((r) => ({
              id: r.actorId,
              username: r.username,
              accountClosed: r.accountClosed,
              ...ratingStanding(r, r.lastRatedAt, at),
              // Ranking preserves the stored full-precision rating; renderers round figures.
              rating: r.rating,
              played: r.played,
              wins: r.wins,
              weekChange: r.weekChange,
              seasonChange: r.seasonChange,
            })),
        ),
      ];
    }),
  );
  const blindedUsernames = source.ratings
    .filter((r) => blindedActorIds.includes(r.actorId))
    .flatMap((r) => (r.username ? [r.username] : []));
  const visibleEntries = Object.fromEntries(
    Object.entries(entriesBySeason).map(([id, entries]) => [
      id,
      entries.map((entry) =>
        blindedActorIds.includes(entry.id)
          ? {
              ...entry,
              rating: 0,
              deviation: 0,
              played: 0,
              wins: 0,
              weekChange: 0,
              seasonChange: 0,
              losses: 0,
              provisional: false,
              rank: null,
            }
          : entry,
      ),
    ]),
  );
  return {
    season,
    seasons,
    summaries: summaries.filter((s) => !blindedActorIds.includes(s.actorId)),
    entriesBySeason: visibleEntries,
    postings: source.changes.filter(
      (p) => !blindedActorIds.includes(p.actorId),
    ) as StandingsRead['changes'],
    blindedActorIds,
    blindedUsernames,
  };
}
