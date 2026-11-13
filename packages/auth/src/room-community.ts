import { isOpenRoomStatus } from '@daisy/protocol';
import {
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
  fact.policyKey === 'room.community' &&
  fact.policyRevision === 1 &&
  Number.isSafeInteger(fact.revision) &&
  fact.revision > 0;

/** What an actor is to a Room's chat, from the Room's facts about them. */
export type RoomCommunityStanding = 'seated' | 'visitor' | 'judge' | null;

/**
 * Whoever may read the Room (`room.read`) is in its chat. A judge's seat reads
 * and never posts, host or not, so no message can name an anonymous judge
 * (DEC-174). The host and the debaters post; so does a visitor, a member who
 * may read the Room and holds no seat.
 */
export const roomCommunityStanding = ({
  visibility,
  host,
  seatRole,
}: Pick<
  RoomCommunityFact,
  'visibility' | 'host' | 'seatRole'
>): RoomCommunityStanding => {
  const seated = seatRole !== null;
  if (!roomReadable({ visibility, host, seated })) return null;
  if (roomCommunitySeatReadsOnly(seatRole)) return 'judge';
  return host || seated ? 'seated' : 'visitor';
};

/** While the Room gathers: a standing reads, all but a judge post, and an author may always withdraw. */
const whileOpen = ({
  fact,
  action,
}: RoomCommunityDecisionInput): RoomCommunityDecision => {
  const standing = roomCommunityStanding(fact);
  const admitted =
    action === 'remove' ||
    (standing !== null && (action === 'read' || standing !== 'judge'));
  return fact.endedAt === null && admitted
    ? { allow: true, readOnly: standing === 'judge', expiresAt: null }
    : denied;
};

/** After the Room ended: own removal alone, until the rows are due to be purged. */
const afterEnd = (
  { fact, action }: RoomCommunityDecisionInput,
  instant: number,
): RoomCommunityDecision => {
  const expiry = Date.parse(fact.endedAt ?? '') + roomCommunityRetentionMs;
  return action === 'remove' && Number.isFinite(expiry) && instant < expiry
    ? { allow: true, readOnly: true, expiresAt: new Date(expiry).toISOString() }
    : denied;
};

/**
 * Room chat belongs to a Room while it gathers. Everyone who may read the Room
 * reads it while it is open; its host, its debaters and its visitors post, and
 * a judge only reads. Once the Room has started or closed nobody reads, posts
 * or observes. An author may still
 * remove their own message, whatever their standing has become, until the rows
 * are due to be purged; that discloses no one else's content.
 */
export function decideRoomCommunity(
  input: RoomCommunityDecisionInput,
): RoomCommunityDecision {
  const instant = Date.parse(input.now);
  if (!Number.isFinite(instant) || !boundAccount(input) || !currentFact(input))
    return denied;
  return isOpenRoomStatus(input.fact.status)
    ? whileOpen(input)
    : afterEnd(input, instant);
}
