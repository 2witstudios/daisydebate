import type {
  AuthorizationDenyReason,
  ConflictConnection,
  ConflictHandling,
} from '@daisy/protocol/authorization';

/** Who a person is to a resource, where that alone allows them. */
export type AuthorityRelation =
  | 'self'
  | 'seat'
  | 'guardian'
  | 'ward'
  | 'responsible_adult'
  | 'proposer'
  | 'audience';

/**
 * What an allow was allowed under, which action history records: a rule
 * fixed for every admitted member, ownership, one named grant, or the
 * person's own relation to the resource.
 */
export type DecisionAuthority =
  | { readonly kind: 'fixed' }
  | {
      readonly kind: 'owner';
      readonly of:
        | { readonly kind: 'organization'; readonly organizationId: string }
        | { readonly kind: 'lobby'; readonly lobbyId: string };
    }
  | { readonly kind: 'grant'; readonly grantId: string }
  | { readonly kind: 'relationship'; readonly relation: AuthorityRelation };

/** The person's connections to a fixture and what the lobby does about them. */
export type Conflict = {
  readonly connections: readonly ConflictConnection[];
  readonly handling: ConflictHandling;
  /** The confirmed waiver for this person and fixture, when there is one. */
  readonly waiverId: string | null;
};

export type AuthorizationDecision =
  | {
      readonly allow: true;
      readonly authority: DecisionAuthority;
      readonly conflict: Conflict | null;
    }
  | {
      readonly allow: false;
      readonly reason: AuthorizationDenyReason;
      readonly conflict: Conflict | null;
    };

export const allowUnder = (
  authority: DecisionAuthority,
  conflict: Conflict | null = null,
): AuthorizationDecision => ({ allow: true, authority, conflict });

/** Allowed by a rule that holds for every admitted member it names. */
export const allowFixed: AuthorizationDecision = allowUnder({ kind: 'fixed' });

export const allowRelated = (relation: AuthorityRelation) =>
  allowUnder({ kind: 'relationship', relation });

export const deny = (
  reason: AuthorizationDenyReason,
  conflict: Conflict | null = null,
): AuthorizationDecision => ({ allow: false, reason, conflict });

/** A fixed rule's answer: allowed, or the capability is not held. */
export const decide = (allowed: boolean): AuthorizationDecision =>
  allowed ? allowFixed : deny('missing-capability');
