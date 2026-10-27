import type { SocialRequestLimits } from './social-request-budget';
import type { AuthorizationTransaction } from '../authorization';
import type { authorizationAccountFact } from '../authorization-account';

type MessagingContactFact = {
  readonly lowActorId: string;
  readonly highActorId: string;
  readonly blocked: boolean;
  readonly revision: number;
};
export type MessagingSocialInput = {
  readonly actorId: string;
  readonly userId: string;
  readonly memberActorIds: readonly string[];
  readonly policyRevision?: number;
};
export type MessagingSocialAuthorizationFence = (
  tx: AuthorizationTransaction,
  input: MessagingSocialInput,
  facts: {
    readonly contacts: readonly MessagingContactFact[];
    readonly accounts: readonly ReturnType<typeof authorizationAccountFact>[];
  },
) => Promise<void>;
type MessagingFriendshipPair = {
  readonly state: 'pending' | 'accepted';
  readonly requesterActorId: string;
};
export type MessagingSocialFrame = {
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
    readonly pair: MessagingFriendshipPair | null;
    readonly actorPendingOutgoing: number;
    readonly actorFriends: number;
    readonly otherFriends: number;
  }>;
  readonly commitFriendship: (input: {
    readonly previous: MessagingFriendshipPair | null;
    readonly next: MessagingFriendshipPair | null;
    /** Ledger id for a new request, which spends a DEC-251 social request. */
    readonly requestId: string;
    readonly now: string;
    readonly limits: SocialRequestLimits;
  }) => Promise<void>;
  readonly readDmRequest: () => Promise<{
    readonly channelId: string;
    readonly state: string;
  } | null>;
  readonly commitDmRequest: (input: {
    readonly requestId: string;
    readonly channelId: string;
    readonly introduction: string | null;
    readonly digest: string;
    readonly policyRevision: number;
    readonly now: string;
    readonly limits: SocialRequestLimits;
  }) => Promise<{ readonly channelId: string; readonly state: string }>;
  /**
   * Before any budget is spent: answers the existing pending or accepted DM
   * a request converges on, or else refuses (AUTHORIZATION, as a block) a
   * new request the commit would refuse, one the other member's declines
   * block at `now` (DEC-251) or one on an inactive channel, or answers null
   * for a new request to commit.
   */
  readonly screenDmRequest: (now: string) => Promise<{
    readonly channelId: string;
    readonly state: string;
  } | null>;
  readonly blocking: boolean | null;
  readonly contacts: readonly MessagingContactFact[];
  readonly readReceipt: (requestId: string) => Promise<{
    readonly kind: string;
    readonly digest: string | null;
    readonly channelId: string | null;
  } | null>;
  readonly commitBlock: (input: {
    readonly requestId: string;
    readonly blocked: boolean;
    readonly digest: string;
    readonly now: string;
  }) => Promise<{ readonly blocked: boolean; readonly revision: number }>;
};
export type MessagingSocialStore = {
  readonly withContacts: <T>(
    input: MessagingSocialInput,
    work: (frame: MessagingSocialFrame) => Promise<T>,
  ) => Promise<T>;
};
