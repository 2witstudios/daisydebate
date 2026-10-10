import type {
  AuthorizationTransaction,
  lockAuthorizationActors,
} from '../authorization';
import type { MessagingChannelFact } from './social';
import type { MessagingGroupInvitationFact } from './group-invitation-contracts';
export type MessagingGroupIssuanceScope = {
  readonly userId: string;
  readonly actorId: string;
  readonly channelId: string;
  readonly requestId: string;
  readonly inviteeActorIds: readonly string[];
};
export type MessagingGroupIssuanceFence = (
  tx: AuthorizationTransaction,
  scope: MessagingGroupIssuanceScope,
  facts: {
    readonly channel: MessagingChannelFact;
    readonly accounts: Awaited<ReturnType<typeof lockAuthorizationActors>>;
    readonly contactPairs: MessagingGroupInvitationFact['contactPairs'];
    readonly receipt: {
      readonly actorId: string;
      readonly requestId: string;
      readonly kind: string;
      readonly digest: string | null;
      readonly channelId: string | null;
    } | null;
  },
) => Promise<void>;
type Result = {
  readonly channelId: string;
  readonly lifecycle: 'active' | 'archived';
};
export type MessagingGroupIssuanceStore = {
  readonly withIssuance: <T>(
    scope: MessagingGroupIssuanceScope,
    work: (frame: {
      readonly readResult: () => Promise<
        Result & {
          readonly receipt: {
            readonly kind: string;
            readonly digest: string | null;
            readonly channelId: string | null;
          } | null;
        }
      >;
      readonly commit: (command: {
        readonly digest: string;
        readonly now: string;
        readonly maxMembers: number;
        readonly maxPendingInvitations: number;
      }) => Promise<Result>;
    }) => Promise<T>,
  ) => Promise<T>;
};
