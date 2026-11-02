import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { tallyRecord } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import type {
  OnlineFilter,
  OnlineMember,
  OnlineRoster,
  PresenceActivity,
  RatingLadder,
  RatingState,
  RoundStatus,
  RatedOutcome,
  DebateRole,
} from '@daisy/protocol';
import type { RosterCursor, RosterRow } from '@daisy/db/presence-roster';
import { ratingStanding } from '../ratings/standing';
import { requireMemberActor } from '../access/actor';
import { displayStatus, isAround } from './status';

/** One page of the list. A browser asks for more as the viewer scrolls. */
export const ROSTER_PAGE = 50;

export type OnlineRosterDependencies = {
  readonly now: () => string;
  readonly limit: (actorId: string) => Promise<void>;
  readonly onlineActorIds: () => Promise<readonly string[]>;
  readonly activity: (
    actorIds: readonly string[],
  ) => Promise<ReadonlyMap<string, PresenceActivity | null>>;
  readonly page: (
    scope: { readonly userId: string; readonly actorId: string },
    input: {
      readonly onlineActorIds: readonly string[];
      readonly filter: OnlineFilter;
      readonly query: string | null;
      readonly after: RosterCursor | null;
      readonly limit: number;
    },
  ) => Promise<{
    readonly rows: readonly RosterRow[];
    readonly counts: { readonly everyone: number; readonly friends: number };
    readonly self: {
      readonly chosen: RosterRow['chosen'];
      readonly placement: RosterRow['placement'];
    };
  }>;
  readonly cards: (actorIds: readonly string[]) => Promise<{
    readonly visibility: readonly {
      readonly actorId: string;
      readonly showPolicy: boolean;
      readonly showValue: boolean;
    }[];
    readonly ratings: readonly (RatingState & {
      readonly actorId: string;
      readonly ladder: RatingLadder;
      readonly lastRatedAt: string | null;
    })[];
    readonly records: readonly {
      readonly actorId: string;
      readonly status: string;
      readonly outcome: string | null;
      readonly role: string;
      readonly rounds: number;
    }[];
  }>;
  /** Actors whose ratings a judge may not see before their ballot. */
  readonly blinded: (viewerActorId: string) => Promise<readonly string[]>;
};

/** The ladders a card shows: Freestyle always, the rest by the member's choice. */
export const shownLadders = (
  visibility:
    { readonly showPolicy: boolean; readonly showValue: boolean } | undefined,
): readonly RatingLadder[] => [
  'freestyle',
  ...(visibility?.showPolicy ? (['policy'] as const) : []),
  ...(visibility?.showValue ? (['value'] as const) : []),
];

/** An opaque keyset position; a tampered one is a refusal, never a probe. */
export const encodeRosterCursor = (cursor: RosterCursor): string =>
  Buffer.from(
    JSON.stringify([cursor.friend, cursor.username, cursor.actorId]),
    'utf8',
  ).toString('base64url');

export function decodeRosterCursor(
  value: string | undefined,
): RosterCursor | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      typeof parsed[0] === 'boolean' &&
      typeof parsed[1] === 'string' &&
      typeof parsed[2] === 'string' &&
      /^[a-z0-9]{24}$/.test(parsed[2])
    )
      return { friend: parsed[0], username: parsed[1], actorId: parsed[2] };
  } catch {
    // Falls through to the refusal.
  }
  throw createAppError('VALIDATION');
}

const relationOf = (
  row: RosterRow,
  viewer: string,
): OnlineMember['relation'] => {
  if (row.friendshipState === 'accepted') return 'friends';
  if (row.friendshipState !== 'pending') return 'none';
  return row.requesterActorId === viewer ? 'outgoing' : 'incoming';
};

/**
 * Who is online, as this member may see them (ADR 0098): lease ids from Redis,
 * then one SQL read that drops anyone appearing offline and any blocked pair.
 * A row whose lease lapsed since the scan drops out here. Presence grants
 * nothing, and everything on a row is already public on a profile or a ladder.
 */
export async function readOnlineRoster(
  principal: AuthorizationPrincipal,
  input: {
    readonly filter: OnlineFilter;
    readonly query: string | null;
    readonly cursor: string | undefined;
  },
  dependencies: OnlineRosterDependencies,
): Promise<Omit<OnlineRoster, 'version'>> {
  const { actorId, userId } = requireMemberActor(principal);
  await dependencies.limit(actorId);
  const after = decodeRosterCursor(input.cursor);
  const onlineActorIds = await dependencies.onlineActorIds();
  const page = await dependencies.page(
    { userId, actorId },
    {
      onlineActorIds,
      filter: input.filter,
      query: input.query,
      after,
      limit: ROSTER_PAGE + 1,
    },
  );
  const rows = page.rows.slice(0, ROSTER_PAGE);
  const ids = rows.map((row) => row.actorId);
  const [activity, cards, blinded] = await Promise.all([
    dependencies.activity([...ids, actorId]),
    dependencies.cards(ids),
    dependencies.blinded(actorId),
  ]);
  const hidden = new Set(blinded);
  const now = dependencies.now();
  const visibilityOf = new Map(cards.visibility.map((v) => [v.actorId, v]));
  const members: OnlineMember[] = [];
  for (const row of rows) {
    const status = displayStatus({
      chosen: row.chosen,
      activity: activity.get(row.actorId) ?? null,
      placement: row.placement,
    });
    if (!isAround(status)) continue;
    const record = tallyRecord(
      cards.records
        .filter((group) => group.actorId === row.actorId)
        .map((group) => ({
          status: group.status as RoundStatus,
          outcome: group.outcome as RatedOutcome | null,
          role: group.role as DebateRole,
          rounds: group.rounds,
        })),
    );
    members.push({
      username: row.username,
      status,
      relation: relationOf(row, actorId),
      ratings: shownLadders(visibilityOf.get(row.actorId)).map((ladder) => {
        const state = cards.ratings.find(
          (rating) =>
            rating.actorId === row.actorId && rating.ladder === ladder,
        );
        if (hidden.has(row.actorId))
          return { ladder, rating: null, provisional: false, hidden: true };
        if (!state)
          return { ladder, rating: null, provisional: false, hidden: false };
        const standing = ratingStanding(state, state.lastRatedAt, now);
        return {
          ladder,
          rating: standing.rating,
          provisional: standing.provisional,
          hidden: false,
        };
      }),
      wins: record.wins,
      losses: record.losses,
    });
  }
  const last = rows.at(-1);
  return {
    members,
    nextCursor:
      page.rows.length > ROSTER_PAGE && last
        ? encodeRosterCursor({
            friend: last.friend,
            username: last.username,
            actorId: last.actorId,
          })
        : null,
    counts: page.counts,
    // They are here, asking: a reload closes their socket before it reopens.
    self: displayStatus({
      chosen: page.self.chosen,
      activity: activity.get(actorId) ?? 'active',
      placement: page.self.placement,
    }),
  };
}
