import type {
  AuthorizationCapability,
  AuthorizationDenyReason,
} from '@daisy/protocol/authorization';
/** Current producer facts only. Neither preferences nor client claims grant access. */
export type AuthorizationPrincipal =
  | { readonly kind: 'anonymous' }
  | {
      readonly kind: 'service';
      readonly serviceId: string;
      readonly scope: 'foundation';
      readonly capabilities: readonly AuthorizationCapability[];
    }
  | {
      readonly kind: 'user';
      readonly userId: string;
      readonly actorId: string | null;
    };
export type { AuthorizationCapability } from '@daisy/protocol/authorization';
export type AccountAuthorizationFact = {
  readonly userId: string;
  readonly actorId: string | null;
  readonly member: boolean;
  readonly erased: boolean;
  readonly revision: number;
};
export type RoomAuthorizationFact = {
  readonly kind: 'room';
  readonly roomId: string;
  readonly hostActorId: string | null;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly status: string;
  readonly revision: number;
  readonly participants: readonly {
    readonly actorId: string;
    readonly role: string;
    readonly slot: number;
  }[];
};
export type RoundAuthorizationFact = {
  readonly kind: 'round';
  readonly roundId: string;
  readonly createdByActorId: string | null;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly status: string;
  readonly participants: readonly {
    readonly actorId: string;
    readonly role: string;
    readonly slot: number;
  }[];
  readonly revision: number;
};
/** MSG owns the underlying pair/grant projection and its transactional fence. */
export type ChannelAuthorizationFact = {
  readonly kind: 'channel';
  readonly channelId: string;
  readonly policyKey: string;
  readonly policyRevision: number;
  readonly lifecycle: 'active' | 'archived';
  readonly revision: number;
  readonly authority:
    | {
        readonly kind: 'dm';
        readonly lowActorId: string;
        readonly highActorId: string;
        readonly requestSenderActorId: string;
        readonly state: 'pending' | 'accepted' | 'declined' | 'cancelled';
        readonly blocked: boolean;
        readonly revision: number;
      }
    | {
        readonly kind: 'private_group';
        readonly actorId: string;
        readonly role: 'manager' | 'member' | null;
        readonly generation: number;
        readonly activeMemberActorIds: readonly string[];
      };
};
export type ContactAuthorizationFact = {
  readonly lowActorId: string;
  readonly highActorId: string;
  readonly blocked: boolean;
  readonly revision: number;
};
export type ContactPairAuthorizationFact = ContactAuthorizationFact & {
  readonly kind: 'contact_pair';
};
/** Proposed identities are an operation intent, never persisted membership. */
export type SocialCreationFact =
  | {
      readonly kind: 'social_creation';
      readonly mode: 'dm';
      readonly initiatorActorId: string;
      readonly recipientActorId: string;
      readonly policyKey: 'social.dm';
      readonly policyRevision: number;
      readonly contactPair: ContactAuthorizationFact;
    }
  | {
      readonly kind: 'social_creation';
      readonly mode: 'private_group';
      readonly initiatorActorId: string;
      readonly memberActorIds: readonly string[];
      readonly policyKey: 'social.private_group';
      readonly policyRevision: number;
      readonly contactPairs: readonly ContactAuthorizationFact[];
    };
export type SocialCreationPolicy =
  import('./social-policy').SocialContactPolicy & {
    readonly groupBlockScope?: 'all_pairs' | 'initiator';
  };
/** MSG projects the locked own file and actual channel core; no grant/age/content fields needed. */
export type PendingFileAuthorizationFact = {
  readonly kind: 'pending_file';
  readonly fileId: string;
  readonly channelId: string;
  readonly ownerActorId: string;
  readonly lifecycle:
    'reserved' | 'quarantined' | 'attached' | 'deleting' | 'deleted';
  readonly generation: number;
  readonly expectedGeneration: number;
  readonly revision: number;
  readonly channel: {
    readonly channelId: string;
    readonly kind: 'dm' | 'private_group';
    readonly policyKey: 'social.dm' | 'social.private_group';
    readonly policyRevision: number;
    readonly revision: number;
  };
};
/** MSG projects the live invitation, channel and inviter grant under its transaction fence. */
export type GroupInvitationAuthorizationFact = {
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
  readonly expectedGeneration?: number;
  readonly inviterGrant: {
    readonly actorId: string;
    readonly role: 'manager' | 'member' | null;
    readonly generation: number;
  };
  readonly contactPairs: readonly ContactAuthorizationFact[];
};
/** Proposed invitees are intent only; MSG owns current channel/grant/pair projections. */
export type GroupInvitationCreationAuthorizationFact = {
  readonly kind: 'group_invitation_creation';
  readonly channel: ChannelAuthorizationFact;
  readonly inviteeActorIds: readonly string[];
  readonly contactPairs: readonly ContactAuthorizationFact[];
};
/** MSG supplies a committed own receipt and fresh channel core under its transaction fence.
 * This projection grants only a minimal result; digest/original-operation binding stays with MSG.
 */
export type GroupCommandResultAuthorizationFact = {
  readonly kind: 'group_command_result';
  readonly channel: {
    readonly channelId: string;
    readonly kind: 'private_group';
    readonly policyKey: 'social.private_group';
    readonly policyRevision: number;
    readonly revision: number;
    readonly lifecycle: 'active' | 'archived';
  };
  readonly command: {
    readonly actorId: string;
    readonly requestId: string;
    readonly kind: string;
    readonly resultChannelId: string;
  };
};
/** Own-association discovery only; every returned channel needs separate authorization. */
export type MessagingCollectionAuthorizationFact = {
  readonly kind: 'messaging_collection';
  readonly actorId: string;
};
export type AuthorizationInput = {
  readonly principal: AuthorizationPrincipal;
  readonly capability: AuthorizationCapability;
  readonly resource:
    | GroupInvitationCreationAuthorizationFact
    | GroupCommandResultAuthorizationFact
    | GroupInvitationAuthorizationFact
    | MessagingCollectionAuthorizationFact
    | PendingFileAuthorizationFact
    | ContactPairAuthorizationFact
    | SocialCreationFact
    | RoundAuthorizationFact
    | RoomAuthorizationFact
    | ChannelAuthorizationFact
    | { readonly kind: 'room_collection' }
    | { readonly kind: 'foundation' };
  readonly context: {
    readonly account: AccountAuthorizationFact | null;
    /** Trusted current facts/time from the same account-fenced transaction. */
    readonly now?: string;
    /** Exact fresh pair accounts under the same account fence; no age eligibility required. */
    readonly contactAccounts?: readonly AccountAuthorizationFact[];
    readonly socialAccounts?: readonly SocialAccountFact[];
    readonly socialReading?: SocialPolicyEvidence;
    readonly socialPosting?: SocialPolicyEvidence;
    readonly socialCreationPolicy?: SocialCreationPolicy;
  };
};
export type AuthorizationDecision =
  | { readonly allow: true }
  | {
      readonly allow: false;
      readonly reason: AuthorizationDenyReason;
    };

export type SocialAccountFact = {
  readonly account: AccountAuthorizationFact;
  readonly age: import('./account-age').AccountAgeFact;
};
export type SocialPolicyEvidence = {
  readonly channelId: string;
  readonly policyKey: string;
  readonly policyRevision: number;
  readonly allowed: boolean;
  readonly authorityRevision: number;
  readonly relationshipRevision: number;
  readonly evaluatedAt: string;
  readonly validUntil: string;
  readonly accounts: readonly {
    readonly actorId: string;
    readonly userId: string;
    readonly accountRevision: number;
    readonly ageRevision: number | null;
  }[];
};
