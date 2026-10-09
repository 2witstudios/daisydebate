import type {
  AuthorizationTransaction,
  lockAuthorizationActors,
} from '../authorization';
import type { MessagingChannelFact } from './social';
export type MessagingGroupDecision = 'accept' | 'decline' | 'cancel';
export type MessagingGroupInvitationScope = {
  readonly channelId: string;
  readonly actorId: string;
  readonly userId: string;
  readonly inviteeActorId: string;
  readonly operation: 'read' | MessagingGroupDecision;
  readonly expectedGeneration?: number;
};
export type MessagingGroupInvitationFact = {
  readonly kind: 'group_invitation';
  readonly channel: {
    readonly channelId: string;
    readonly kind: 'private_group';
    readonly policyKey: 'social.private_group';
    readonly policyRevision: number;
    readonly revision: number;
    readonly lifecycle: 'active' | 'archived';
    readonly activeMemberActorIds: readonly string[];
  };
  readonly invitation: {
    readonly channelId: string;
    readonly inviterActorId: string;
    readonly inviteeActorId: string;
    readonly state: 'pending' | 'accepted' | 'declined' | 'cancelled';
    readonly generation: number;
  };
  readonly inviterGrant: {
    readonly actorId: string;
    readonly role: 'manager' | 'member' | null;
    readonly generation: number;
  };
  readonly contactPairs: readonly {
    readonly lowActorId: string;
    readonly highActorId: string;
    readonly blocked: boolean;
    readonly revision: number;
  }[];
  readonly expectedGeneration?: number;
};
export type MessagingGroupInvitationFence = (
  tx: AuthorizationTransaction,
  scope: MessagingGroupInvitationScope,
  operation: 'read' | 'result' | MessagingGroupDecision,
  facts: {
    readonly invitation: MessagingGroupInvitationFact;
    readonly channel: MessagingChannelFact;
    readonly accounts: Awaited<ReturnType<typeof lockAuthorizationActors>>;
  },
) => Promise<void>;
export type MessagingGroupInvitationResult = {
  readonly channelId: string;
  readonly generation: number;
  readonly state: MessagingGroupInvitationFact['invitation']['state'];
};
export type MessagingGroupInvitationFrame = {
  readonly preview: () => Promise<MessagingGroupInvitationResult>;
  readonly readDecisionState: (
    requestId: string,
    decision: MessagingGroupDecision,
  ) => Promise<
    MessagingGroupInvitationResult & {
      readonly invitedAt: string;
      readonly inviterActorId: string;
      readonly receipt: {
        readonly kind: string;
        readonly digest: string | null;
        readonly channelId: string | null;
        readonly counterpartActorId: string | null;
      } | null;
    }
  >;
  readonly commitDecision: (command: {
    readonly requestId: string;
    readonly decision: MessagingGroupDecision;
    readonly digest: string;
    readonly now: string;
  }) => Promise<MessagingGroupInvitationResult>;
};
export type MessagingGroupInvitationStore = {
  readonly withInvitation: <T>(
    scope: MessagingGroupInvitationScope,
    work: (frame: MessagingGroupInvitationFrame) => Promise<T>,
  ) => Promise<T>;
};
