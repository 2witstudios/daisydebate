import type { Database } from '@daisy/db';
import { recordResult, tallyRecord } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import type {
  JudgePanel,
  MatchHistoryEntry,
  MatchHistoryQuery,
  MemberProfile,
} from '@daisy/protocol';

export type ProfileStore = Pick<
  Database,
  'readMember' | 'readRecordGroups' | 'readMatchHistory'
>;

type HistoryRow = Awaited<
  ReturnType<Database['readMatchHistory']>
>['rows'][number];

/** How many Rounds one history page lists. */
export const HISTORY_PAGE_SIZE = 20;

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
 * A member's profile as `viewer` may see it (ISSUE-600), or null when no
 * live member holds the name. The record counts every completed Round; the
 * history lists all of them to the member and only public ones to anyone
 * else, signed in or not.
 */
export async function readProfile(
  store: ProfileStore,
  input: {
    readonly username: string;
    readonly viewerUserId: string | null;
    readonly query: MatchHistoryQuery;
  },
): Promise<MemberProfile | null> {
  const member = await store.readMember(input.username);
  if (member === null) return null;
  const me = input.viewerUserId === member.userId;
  const [groups, page] = await Promise.all([
    store.readRecordGroups(member.actorId),
    store.readMatchHistory({
      actorId: member.actorId,
      publicOnly: !me,
      before: input.query.before ?? null,
      limit: HISTORY_PAGE_SIZE,
    }),
  ]);
  return {
    version: 1,
    username: member.username,
    memberSince: member.memberSince,
    me,
    record: tallyRecord(groups),
    history: page.rows.map(toEntry),
    nextBefore: page.nextBefore,
  };
}
