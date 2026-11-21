import { tryInstantMs } from '@daisy/clock';
import { isOpenRoomStatus } from '@daisy/protocol';
import {
  roomCommunityPolicySchema,
  roomCommunityReadsOnly,
  roomCommunityRetentionMs,
  roomCommunitySeatReadsOnly,
  type RoomCommunityFact,
} from '@daisy/protocol/room-community';
import type { AccountAuthorizationFact } from './authorization-facts';
import { roomReadable } from './authorization-room';
import { participantAccess } from './participant-access';

type RoomCommunityDecisionInput = {
  readonly principal: { readonly userId: string; readonly actorId: string };
  readonly account: AccountAuthorizationFact | null;
  readonly fact: RoomCommunityFact;
  readonly action: 'read' | 'post' | 'remove';
  readonly now: string;
};
type RoomCommunityDecision =
  | { readonly allow: false }
  | {
      readonly allow: true;
      readonly readOnly: boolean;
      readonly expiresAt: string | null;
    };
const denied: RoomCommunityDecision = { allow: false };

/** Removing one's own message is a withdrawal (ADR 0075): it needs no participant admission. */
const boundAccount = ({
  principal,
  account,
  action,
}: RoomCommunityDecisionInput) =>
  account !== null &&
  account.member &&
  !account.erased &&
  (action === 'remove' || participantAccess(account)) &&
  account.userId === principal.userId &&
  account.actorId === principal.actorId;
const currentFact = ({ fact, principal }: RoomCommunityDecisionInput) =>
  fact.actorId === principal.actorId &&
  roomCommunityPolicySchema.safeParse(fact).success &&
  Number.isSafeInteger(fact.revision) &&
  fact.revision > 0;

/** What an actor is to a Room's chat, from the Room's facts about them. */
export type RoomCommunityStanding =
  'seated' | 'visitor' | 'judge' | 'spectator' | null;

/**
 * Whoever may read the Room (`room.read`) is in its chat. A judge's seat reads
 * and never posts, host or not, so no message can name an anonymous judge
 * (DEC-174). The host and the debaters post; so does a visitor, a member who
 * may read the Room and holds no seat, except in a Youth Room (decision 84):
 * there a seatless member is a spectator, who reads and never posts, unless
 * they are a seated youth debater's club staff.
 */
export const roomCommunityStanding = (
  fact: Pick<
    RoomCommunityFact,
    'visibility' | 'host' | 'seatKind' | 'youthRoom' | 'youthStaff'
  >,
): RoomCommunityStanding => {
  const { visibility, host, seatKind } = fact;
  const seated = seatKind !== null;
  if (!roomReadable({ visibility, host, seated })) return null;
  if (roomCommunitySeatReadsOnly(seatKind)) return 'judge';
  if (host || seated) return 'seated';
  return roomCommunityReadsOnly(fact) ? 'spectator' : 'visitor';
};
const readsOnly = (standing: RoomCommunityStanding) =>
  standing === 'judge' || standing === 'spectator';

/** While the Room gathers: a standing reads, all but a judge or a spectator post, and an author may always withdraw. */
const whileOpen = ({
  fact,
  action,
}: RoomCommunityDecisionInput): RoomCommunityDecision => {
  const standing = roomCommunityStanding(fact);
  const admitted =
    action === 'remove' ||
    (standing !== null && (action === 'read' || !readsOnly(standing)));
  return fact.endedAt === null && admitted
    ? { allow: true, readOnly: readsOnly(standing), expiresAt: null }
    : denied;
};

/** After the Room ended: own removal alone, until the rows are due to be purged. */
const afterEnd = (
  { fact, action }: RoomCommunityDecisionInput,
  instant: number,
): RoomCommunityDecision => {
  const endedAt = tryInstantMs(fact.endedAt);
  if (endedAt === undefined || action !== 'remove') return denied;
  const expiry = endedAt + roomCommunityRetentionMs;
  return instant < expiry
    ? { allow: true, readOnly: true, expiresAt: new Date(expiry).toISOString() }
    : denied;
};

/**
 * Room chat belongs to a Room while it gathers. Everyone who may read the Room
 * reads it while it is open; its host, its debaters and its visitors post, and
 * a judge, or a seatless spectator of a Youth Room, only reads. Once the Room has started or closed nobody reads, posts
 * or observes. An author may still
 * remove their own message, whatever their standing has become, until the rows
 * are due to be purged; that discloses no one else's content.
 */
export function decideRoomCommunity(
  input: RoomCommunityDecisionInput,
): RoomCommunityDecision {
  const instant = tryInstantMs(input.now);
  if (instant === undefined || !boundAccount(input) || !currentFact(input))
    return denied;
  return isOpenRoomStatus(input.fact.status)
    ? whileOpen(input)
    : afterEnd(input, instant);
}
