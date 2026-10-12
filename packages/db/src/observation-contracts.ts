import type {
  ObservationBase,
  ObservationHeader,
  ObservationPartition,
  ObservationResource,
  RoomAssemblyState,
} from '@daisy/protocol';
import type { RoundHydration } from './round-hydration';
import type { MessagingMessageRecord } from './messaging/records';
import type { authorizationAccountFact } from './authorization-account';
import type { roomAuthorizationRead } from './room-authorization-read';
import type { MessagingChannelFact } from './messaging/social';
import type { loadAuthorizationSession } from './authorization-session';
import type { loadAuthorizationAgeFact } from './authorization-age';

type RoomReads = ReturnType<typeof roomAuthorizationRead>;
type ResourceFact =
  | NonNullable<
      Awaited<ReturnType<RoomReads['readRoomAuthorizationFacts']>>
    >['resource']
  | NonNullable<
      Awaited<ReturnType<RoomReads['readRoundAuthorizationFacts']>>
    >['resource']
  | MessagingChannelFact
  | { readonly kind: 'messaging_collection'; readonly actorId: string };
export type ObservationBinding = {
  readonly principal: {
    readonly userId: string;
    readonly actorId: string;
    readonly sessionId: string;
  };
  readonly resource: ObservationResource;
  readonly window: ObservationBase['window'];
};
export type ObservationDependency = {
  readonly scope: 'subject' | 'cohort' | 'entitlement';
  readonly key: string;
  readonly revision: string;
  readonly nextBoundary: string | null;
};
export type ObservationAuthorityContext = {
  readonly principal: ObservationBinding['principal'] & {
    readonly kind: 'user';
  };
  readonly resource: ObservationResource;
  readonly session: NonNullable<
    Awaited<ReturnType<typeof loadAuthorizationSession>>
  >;
  readonly account: NonNullable<ReturnType<typeof authorizationAccountFact>>;
  readonly resourceFact: ResourceFact;
  readonly socialAccounts?: readonly {
    readonly account: NonNullable<ReturnType<typeof authorizationAccountFact>>;
    readonly age: Awaited<ReturnType<typeof loadAuthorizationAgeFact>>;
  }[];
  readonly databaseNow: string;
};
export type ObservationAuthorityDecision =
  | {
      readonly status: 'allowed';
      readonly partition: ObservationPartition;
      readonly dependencies: readonly ObservationDependency[];
      readonly eligibleUntil: string | null;
      readonly overlay: unknown;
    }
  | { readonly status: 'denied' | 'unavailable' };
export type DecideObservationAuthority = (
  input: ObservationAuthorityContext,
) => ObservationAuthorityDecision;
export type ObservationEvidence = {
  readonly fingerprint: string;
  readonly dependencies: readonly {
    readonly key: string;
    readonly revision: string;
  }[];
  readonly remainingMs: number;
};
export type ObservationAuthorityResult =
  | {
      readonly status: 'allowed';
      readonly subject: ObservationEvidence;
      readonly cohort: ObservationEvidence;
      readonly entitlement: ObservationEvidence;
      readonly base: ObservationBase;
      readonly minimumContentRevision: number;
      readonly purgeGeneration: number;
      readonly databaseNow: string;
      readonly overlay: unknown;
    }
  | { readonly status: 'denied' | 'unavailable' };
export type ObservationProjection = {
  readonly header: ObservationHeader;
  readonly base: ObservationBase;
  readonly rows: readonly Record<string, unknown>[];
  /** Channel: last included sequence iff older rows remain. Inbox: last scanned id iff more. Room/Round: null. */
  readonly continuation: number | string | null;
};
/** Exact restricted SQL aliases. Rows are untrusted until the portable provider validates them. */
export type ObservationChannelProjectionRow = MessagingMessageRecord;
export type ObservationRoomProjectionRow = {
  readonly room: Pick<
    RoomAssemblyState,
    | 'id'
    | 'hostActorId'
    | 'title'
    | 'topic'
    | 'visibility'
    | 'status'
    | 'version'
    | 'changeVersion'
    | 'formatId'
    | 'formatVersion'
    | 'presetVersion'
    | 'competitionType'
    | 'length'
    | 'config'
    | 'executionPlan'
    | 'prepStartedAt'
    | 'prepRemainingMs'
  >;
  readonly rules: RoomAssemblyState['rules'];
  readonly definition: RoomAssemblyState['definition'];
  readonly participants: readonly (Pick<
    RoomAssemblyState['participants'][number],
    'id' | 'actorId' | 'role' | 'slot'
  > & { readonly readinessVersion: number })[];
  readonly roundRef: RoomAssemblyState['roundRef'];
};
export type ObservationRoundProjectionRow = {
  readonly round: Pick<
    RoundHydration,
    | 'id'
    | 'competitionType'
    | 'formatId'
    | 'formatVersion'
    | 'resolution'
    | 'status'
    | 'currentStage'
    | 'startedAt'
    | 'completedAt'
    | 'outcome'
    | 'version'
  >;
  readonly rules: RoundHydration['rules'];
  readonly checkpoint: RoundHydration['checkpoint'];
  readonly participants: RoundHydration['participants'];
  readonly segments: RoundHydration['segments'];
};
export type ObservationExecutionGuard = { readonly isCurrent?: () => boolean };
export type ObservationProjectionInput = ObservationExecutionGuard & {
  readonly base: ObservationBase;
  readonly minimumContentRevision: number;
  readonly purgeGeneration: number;
};
