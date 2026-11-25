import type { ProfileStore as ProfileAreaStore } from '@daisy/db/stores/profiles';
import { consumeOrThrow, type RateLimiter } from '../../server/rate-limit';
import { spectatorClockAt } from '../spectating/spectator-clock';
import type { Identity } from '@daisy/auth';
import {
  authorize,
  type AccountAuthorizationFact,
} from '@daisy/auth/authorization';
import { recordResult, tallyRecord } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import {
  isDebatingSeat,
  isJudgeSeat,
  sideOfSeat,
  type SeatRef,
} from '@daisy/protocol/seats';
import {
  type JudgePanel,
  type MatchHistoryEntry,
  type MatchHistoryQuery,
  type MemberProfile,
} from '@daisy/protocol/member-profile';

export type ProfileStore = Pick<
  ProfileAreaStore,
  'readMemberProfile' | 'readPublicProfile'
>;

/**
 * What a member chose to show besides the username (ADR 0143): their display
 * name, bio and published photo, and the profile row a report of the text
 * names. A closed account shows none of it.
 */
export type ShownPublicProfile = {
  readonly profileId: string | null;
  readonly displayName: string | null;
  readonly bio: string | null;
  readonly photoId: string | null;
};

/** The profile page's read: the record and history, and the public profile. */
export type ProfileView = MemberProfile & {
  readonly shown: ShownPublicProfile;
  /** Whether they wear the Premium mark (ADR 0933); never for a closed account. */
  readonly premium: boolean;
};

const nothingShown: ShownPublicProfile = {
  profileId: null,
  displayName: null,
  bio: null,
  photoId: null,
};

type HistoryRow = NonNullable<
  Awaited<ReturnType<ProfileAreaStore['readMemberProfile']>>
>['rows'][number];

type Caller = { readonly userId: string; readonly actorId: string };

/**
 * Which of a member's Rounds `caller` may see, from the shared evaluator
 * on the account fact read fresh in the profile's snapshot: the owner's
 * scope (private and unlisted Rounds too) only for the bound current member
 * themself, the public scope for everyone else. `round.read` is not reused:
 * it would make unlisted Rounds discoverable.
 */
const historyScope = (
  caller: Caller,
  memberActorId: string,
  account: AccountAuthorizationFact | null,
): 'owner' | 'public' =>
  authorize({
    principal: { kind: 'user', ...caller },
    capability: 'member.history.read',
    resource: { kind: 'member_history', actorId: memberActorId },
    context: { account },
  }).allow
    ? 'owner'
    : 'public';

/** How many Rounds one history page lists. */
const HISTORY_PAGE_SIZE = 20;

/** Who ruled, from the Round's judge seats. */
export const judgePanel = (
  seats: readonly { readonly seat: SeatRef; readonly kind: 'human' | 'bot' }[],
): JudgePanel => {
  const kinds = new Set(
    seats.filter((seat) => isJudgeSeat(seat.seat)).map((seat) => seat.kind),
  );
  if (kinds.size === 0) return 'none';
  if (kinds.size === 2) return 'mixed';
  return kinds.has('bot') ? 'ai' : 'human';
};

/** A sided Round's line; an unsided speaker's Round has no side to list it by. */
const toEntry = (row: HistoryRow): MatchHistoryEntry[] => {
  const result = recordResult(
    { status: 'completed', outcome: row.outcome },
    row.seat,
  );
  const side = sideOfSeat(row.seat);
  if (result === null)
    throw createAppError('INTERNAL', 'A listed Round has no record result');
  if (side === null) return [];
  return [
    {
      roundId: row.roundId,
      completedAt: row.completedAt,
      resolution: row.resolution,
      side,
      opponents: row.seats
        .filter(
          (seat) => isDebatingSeat(seat.seat) && sideOfSeat(seat.seat) !== side,
        )
        .map((seat) => ({
          kind: seat.kind,
          label: seat.label,
          closed: seat.closed,
        })),
      result,
      forfeit: row.forfeit,
      judges: judgePanel(row.seats),
      visibility: row.visibility,
      ladder: row.ladder,
    },
  ];
};

/**
 * A member's profile as `identity` may see it (ISSUE-600), or null when no
 * member holds the name or the cursor names no Round the viewer may list. A
 * closed account still has a profile: its name and public record (ADR 0087). A visitor reads the public scope; a signed-in
 * caller's scope is decided in the read's own snapshot, and the record and
 * the history share it, so the record never reveals a result the history
 * hides. An unreadable session is an outage, never a visitor's view.
 */
export async function readProfile(
  {
    store,
    limiter,
    wearsPremiumMark = async () => false,
  }: {
    readonly store: ProfileStore;
    readonly limiter: RateLimiter;
    /** The mark decorates the page: a failed read shows none. */
    readonly wearsPremiumMark?: (actorId: string) => Promise<boolean>;
  },
  input: {
    readonly identity: Identity;
    readonly username: string;
    readonly query: MatchHistoryQuery;
    /** Ingress-stamped client hash; absent clients share the unknown bucket. */
    readonly clientId?: string | null;
    /** The render's instant: a public record waits for the spectator timeline. */
    readonly now: string;
  },
): Promise<ProfileView | null> {
  const { identity } = input;
  if (identity.state === 'unavailable') throw createAppError('INFRASTRUCTURE');
  // Budget the in-process render itself: no API request protects this read.
  await consumeOrThrow(
    limiter,
    `profile:read:client:${input.clientId ?? 'unknown'}`,
    {
      max: 60,
      windowSeconds: 60,
    },
  );
  await consumeOrThrow(limiter, 'profile:read:global', {
    max: 600,
    windowSeconds: 60,
  });
  const caller =
    identity.state === 'member'
      ? {
          userId: identity.principal.userId,
          actorId: identity.principal.actorId,
        }
      : null;
  const read = await store.readMemberProfile({
    username: input.username,
    caller,
    decide: (memberActorId, account) =>
      caller === null ? 'public' : historyScope(caller, memberActorId, account),
    before: input.query.before ?? null,
    limit: HISTORY_PAGE_SIZE,
    clock: spectatorClockAt(input.now),
  });
  if (read === null) return null;
  const shown = read.member.closed
    ? nothingShown
    : // The public text and photo decorate the page; without them it shows
      // the username and record, never an error (the store logs the failure).
      await store
        .readPublicProfile(read.member.actorId)
        .catch(() => nothingShown);
  const premium =
    !read.member.closed &&
    (await wearsPremiumMark(read.member.actorId).catch(() => false));
  return {
    version: 1,
    username: read.member.username,
    memberSince: read.member.memberSince,
    closed: read.member.closed,
    me: read.scope === 'owner',
    record: tallyRecord(read.groups),
    history: read.rows.flatMap(toEntry),
    nextBefore: read.nextBefore,
    shown,
    premium,
  };
}
