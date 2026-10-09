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
export type AuthorizationInput = {
  readonly principal: AuthorizationPrincipal;
  readonly capability: AuthorizationCapability;
  readonly resource:
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
