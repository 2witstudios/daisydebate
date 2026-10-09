import type {
  AuthorizationTransaction,
  lockAuthorizationActors,
} from '../authorization';
import type { MessagingChannelFact } from './social';
export type MessagingGroupCreationScope = {
  readonly actorId: string;
  readonly userId: string;
  readonly requestId: string;
  readonly proposedActorIds: readonly string[];
  readonly policyRevision?: number;
};
type Accounts = Awaited<ReturnType<typeof lockAuthorizationActors>>;
type Contacts = readonly {
  readonly lowActorId: string;
  readonly highActorId: string;
  readonly blocked: boolean;
  readonly revision: number;
}[];
export type MessagingGroupCreationFence = (
  tx: AuthorizationTransaction,
  scope: MessagingGroupCreationScope,
  facts:
    | {
        readonly kind: 'create';
        readonly accounts: Accounts;
        readonly contacts: Contacts;
      }
    | {
        readonly kind: 'result';
        readonly accounts: Accounts;
        readonly channel: MessagingChannelFact;
      },
) => Promise<void>;
export type MessagingGroupCreationFrame = {
  readonly authorize: () => Promise<void>;
  readonly readResult: () => Promise<{
    readonly kind: string;
    readonly digest: string | null;
    readonly channelId: string;
    readonly lifecycle: 'active' | 'archived';
  } | null>;
  readonly commit: (input: {
    readonly channelId: string;
    readonly title: string;
    readonly digest: string;
    readonly now: string;
  }) => Promise<{
    readonly channelId: string;
    readonly lifecycle: 'active' | 'archived';
  }>;
};
export type MessagingGroupCreationStore = {
  readonly withCreation: <T>(
    scope: MessagingGroupCreationScope,
    work: (frame: MessagingGroupCreationFrame) => Promise<T>,
  ) => Promise<T>;
};
