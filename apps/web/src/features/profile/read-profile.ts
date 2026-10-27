import { consumeOrThrow, type AuthRateLimiter } from '../auth/abuse/rate-limit';
import type { Identity } from '@daisy/auth';
import {
  authorize,
  type AccountAuthorizationFact,
} from '@daisy/auth/authorization';
import type { Database } from '@daisy/db';
import { recordResult, tallyRecord } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import type {
  JudgePanel,
  MatchHistoryEntry,
  MatchHistoryQuery,
  MemberProfile,
} from '@daisy/protocol';

export type ProfileStore = Pick<Database, 'readMemberProfile'>;

type HistoryRow = NonNullable<
  Awaited<ReturnType<Database['readMemberProfile']>>
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
  seats: readonly { readonly role: string; readonly kind: 'human' | 'bot' }[],
): JudgePanel => {
  const kinds = new Set(
    seats.filter((seat) => seat.role === 'judge').map((seat) => seat.kind),
  );
  if (kinds.size === 0) return 'none';
  if (kinds.size === 2) return 'mixed';
  return kinds.has('bot') ? 'ai' : 'human';
};

const toEntry = (row: HistoryRow): MatchHistoryEntry => {
  const result = recordResult(
    { status: 'completed', outcome: row.outcome },
    row.role,
  );
  if (result === null)
    throw createAppError('INTERNAL', 'A listed Round has no record result');
  return {
    roundId: row.roundId,
    completedAt: row.completedAt,
    resolution: row.resolution,
    side: row.role,
    opponents: row.seats
      .filter((seat) => seat.role !== 'judge' && seat.role !== row.role)
      .map((seat) => ({ kind: seat.kind, label: seat.label })),
    result,
    forfeit: row.forfeit,
    judges: judgePanel(row.seats),
    visibility: row.visibility,
  };
};

/**
 * A member's profile as `identity` may see it (ISSUE-600), or null when no
 * live member holds the name or the cursor names no Round the viewer may list. A visitor reads the public scope; a signed-in
 * caller's scope is decided in the read's own snapshot, and the record and
 * the history share it, so the record never reveals a result the history
 * hides. An unreadable session is an outage, never a visitor's view.
 */
export async function readProfile(
  {
    store,
    limiter,
  }: { readonly store: ProfileStore; readonly limiter: AuthRateLimiter },
  input: {
    readonly identity: Identity;
    readonly username: string;
    readonly query: MatchHistoryQuery;
    /** Ingress-stamped client hash; absent clients share the unknown bucket. */
    readonly clientId?: string | null;
  },
): Promise<MemberProfile | null> {
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
    identity.state === 'member' && identity.principal.actorId !== null
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
  });
  if (read === null) return null;
  return {
    version: 1,
    username: read.member.username,
    memberSince: read.member.memberSince,
    me: read.scope === 'owner',
    record: tallyRecord(read.groups),
    history: read.rows.map(toEntry),
    nextBefore: read.nextBefore,
  };
}
