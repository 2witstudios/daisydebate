import {
  ADMITTED_AGE_BANDS,
  type AuthorizationPrincipal,
} from '@daisy/auth/authorization';
import type { AgeBand } from '@daisy/auth';
import { tallyRecord } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import type {
  PeopleFilter,
  Person,
  PeopleList,
  PresenceActivity,
  RatingLadder,
  RatingState,
  RoundStatus,
  RatedOutcome,
  DebateRole,
} from '@daisy/protocol';
import type {
  PeopleListCursor,
  PersonRow,
} from '@daisy/db/presence-people-list';
import { ratingStanding } from '../ratings/standing';
import { requireMemberActor } from '../access/actor';
import { displayStatus } from './status';

/** One page of the list. A browser asks for more as the viewer scrolls. */
export const PEOPLE_PAGE = 50;

export type PeopleListDependencies = {
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
      readonly admittedAgeBands: readonly AgeBand[];
      readonly now: string;
      readonly filter: PeopleFilter;
      readonly query: string | null;
      readonly after: PeopleListCursor | null;
      readonly limit: number;
    },
  ) => Promise<{
    readonly rows: readonly PersonRow[];
    readonly counts: {
      readonly everyone: number;
      readonly friends: number;
      readonly online: number;
    };
    readonly self: {
      readonly chosen: PersonRow['chosen'];
      readonly placement: PersonRow['placement'];
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
export const encodePeopleListCursor = (cursor: PeopleListCursor): string =>
  Buffer.from(
    JSON.stringify([
      cursor.friend,
      cursor.online,
      cursor.username,
      cursor.actorId,
    ]),
    'utf8',
  ).toString('base64url');

export function decodePeopleListCursor(
  value: string | undefined,
): PeopleListCursor | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (
      Array.isArray(parsed) &&
      parsed.length === 4 &&
      typeof parsed[0] === 'boolean' &&
      typeof parsed[1] === 'boolean' &&
      typeof parsed[2] === 'string' &&
      typeof parsed[3] === 'string' &&
      /^[a-z0-9]{24}$/.test(parsed[3])
    )
      return {
        friend: parsed[0],
        online: parsed[1],
        username: parsed[2],
        actorId: parsed[3],
      };
  } catch {
    // Falls through to the refusal.
  }
  throw createAppError('VALIDATION');
}

const relationOf = (row: PersonRow, viewer: string): Person['relation'] => {
  if (row.friendshipState === 'accepted') return 'friends';
  if (row.friendshipState !== 'pending') return 'none';
  return row.requesterActorId === viewer ? 'outgoing' : 'incoming';
};

/**
 * Everyone, as this member may see them (ADR 0105): one SQL read that drops any
 * blocked pair, with lease ids from Redis saying who is online. A member
 * appearing offline or whose lease lapsed since the scan shows as offline.
 * Presence grants nothing, and everything on a row is already public on a
 * profile or a ladder.
 */
export async function readPeopleList(
  principal: AuthorizationPrincipal,
  input: {
    readonly filter: PeopleFilter;
    readonly query: string | null;
    readonly cursor: string | undefined;
  },
  dependencies: PeopleListDependencies,
): Promise<Omit<PeopleList, 'version'>> {
  const { actorId, userId } = requireMemberActor(principal);
  await dependencies.limit(actorId);
  const after = decodePeopleListCursor(input.cursor);
  const onlineActorIds = await dependencies.onlineActorIds();
  const now = dependencies.now();
  const page = await dependencies.page(
    { userId, actorId },
    {
      onlineActorIds,
      admittedAgeBands: ADMITTED_AGE_BANDS,
      now,
      filter: input.filter,
      query: input.query,
      after,
      limit: PEOPLE_PAGE + 1,
    },
  );
  const rows = page.rows.slice(0, PEOPLE_PAGE);
  const ids = rows.map((row) => row.actorId);
  const [activity, cards, blinded] = await Promise.all([
    dependencies.activity([...ids, actorId]),
    dependencies.cards(ids),
    dependencies.blinded(actorId),
  ]);
  const hidden = new Set(blinded);
  const visibilityOf = new Map(cards.visibility.map((v) => [v.actorId, v]));
  const people: Person[] = [];
  for (const row of rows) {
    const status = displayStatus({
      chosen: row.chosen,
      activity: activity.get(row.actorId) ?? null,
      placement: row.placement,
    });
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
    people.push({
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
    people,
    nextCursor:
      page.rows.length > PEOPLE_PAGE && last
        ? encodePeopleListCursor({
            friend: last.friend,
            online: last.online,
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
