import type { SocialRequestLimits } from '../contacts/request-budget';
import type { ContactFact, ContactInput } from '../contacts/fence';

/** A pair's friendship as stored (ADR 0072): asked, or accepted. */
type FriendshipPair = {
  readonly state: 'pending' | 'accepted';
  readonly requesterActorId: string;
};
/** One friendship or challenge command over a locked contact pair. */
export type FriendFrame = {
  /** Records a challenge to the pair's other member for a room the caller hosts. */
  readonly commitChallenge: (input: {
    readonly roomId: string;
    readonly now: string;
  }) => Promise<{ readonly recorded: boolean }>;
  /** Declines the pair's other member's challenge to the caller. */
  readonly declineChallenge: (input: {
    readonly roomId: string;
  }) => Promise<void>;
  readonly readFriendship: () => Promise<{
    readonly otherActorId: string;
    readonly pair: FriendshipPair | null;
    readonly actorPendingOutgoing: number;
    readonly actorFriends: number;
    readonly otherFriends: number;
  }>;
  readonly commitFriendship: (input: {
    readonly previous: FriendshipPair | null;
    readonly next: FriendshipPair | null;
    /** Ledger id for a new request, which spends a DEC-251 social request. */
    readonly requestId: string;
    readonly now: string;
    readonly limits: SocialRequestLimits;
  }) => Promise<void>;
  readonly contacts: readonly ContactFact[];
};
export type FriendStore = {
  readonly withContacts: <T>(
    input: ContactInput,
    work: (frame: FriendFrame) => Promise<T>,
  ) => Promise<T>;
};
