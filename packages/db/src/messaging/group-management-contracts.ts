import type { lockAuthorizationActors } from '../authorization';
import type { MessagingChannelFact } from './social';
import type { GroupManagementOperation } from './group-management-plan';
import type { Tx } from '../tx';

export type MessagingGroupManagementScope = {
  readonly userId: string;
  readonly actorId: string;
  readonly channelId: string;
  readonly requestId: string;
  readonly operation: GroupManagementOperation;
  readonly targetActorId?: string;
};
type MessagingGroupManagementReceipt = {
  readonly actorId: string;
  readonly requestId: string;
  readonly kind: string;
  readonly digest: string | null;
  readonly channelId: string | null;
};
export type MessagingGroupManagementFence = (
  tx: Tx,
  scope: MessagingGroupManagementScope,
  facts: {
    readonly channel: MessagingChannelFact;
    readonly accounts: Awaited<ReturnType<typeof lockAuthorizationActors>>;
    readonly receipt: MessagingGroupManagementReceipt | null;
  },
) => Promise<void>;
type Result = {
  readonly channelId: string;
  readonly lifecycle: 'active' | 'archived';
};
export type MessagingGroupManagementStore = {
  readonly withManagement: <T>(
    scope: MessagingGroupManagementScope,
    work: (frame: {
      readonly readResult: () => Promise<
        Result & { readonly receipt: MessagingGroupManagementReceipt | null }
      >;
      readonly commit: (input: {
        readonly digest: string;
        readonly now: string;
      }) => Promise<Result>;
    }) => Promise<T>,
  ) => Promise<T>;
};
