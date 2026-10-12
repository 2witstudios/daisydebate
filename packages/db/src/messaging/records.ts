import type { messagingMessageView } from '@daisy/protocol';
import type { AuthorizationTransaction } from '../authorization';
import type { MessagingChannelFact } from './social';
import type { authorizationAccountFact } from '../authorization-account';

/** The durable message projection is the protocol's restricted record. */
export type MessagingMessageRecord = Parameters<typeof messagingMessageView>[0];
export type MessagingSendCommand = {
  readonly version: 1;
  readonly channelId: string;
  readonly requestId: string;
  readonly text: string;
  readonly replyToMessageId?: string;
};
export type MessagingCounters = {
  readonly channelId: string;
  readonly messageSequence: number;
  readonly changeVersion: number;
};
export type MessagingSendState = {
  readonly counters: MessagingCounters;
  readonly receipt: {
    readonly payloadDigest: string | null;
    readonly messageId: string | null;
  } | null;
  readonly existingMessage: MessagingMessageRecord | null;
  readonly reply: MessagingMessageRecord | null;
};
export type MessagingCreateSendPlan = {
  readonly kind: 'create';
  readonly message: MessagingMessageRecord;
  readonly receipt: {
    readonly payloadDigest: string;
    readonly messageId: string;
  };
  readonly doorbell: {
    readonly kind: 'channel.changed';
    readonly channelId: string;
    readonly changeVersion: number;
  };
};
export type MessagingMutationCommand = {
  readonly version: 1;
  readonly channelId: string;
  readonly requestId: string;
  readonly messageId: string;
} & (
  { readonly kind: 'edit'; readonly text: string } | { readonly kind: 'remove' }
);
export type MessagingMutationState = {
  readonly message: MessagingMessageRecord | null;
  readonly receipt: MessagingSendState['receipt'];
  readonly counters: MessagingCounters;
};
export type MessagingMutationPlan = {
  readonly message: MessagingMessageRecord;
  readonly doorbell: MessagingCreateSendPlan['doorbell'];
  readonly payloadDigest: string;
};
export type MessagingAuthorizationFence = (
  tx: AuthorizationTransaction,
  input: {
    readonly channelId: string;
    readonly userId: string;
    readonly actorId: string;
  },
  authority: Pick<MessagingLockedFrame, 'fact' | 'accounts'>,
) => Promise<void>;
type MessagingHistoryPage = {
  readonly messages: readonly MessagingMessageRecord[];
  readonly changeVersion: number;
  readonly nextBefore: {
    readonly channelId: string;
    readonly sequence: number;
  } | null;
};
type MessagingChangesPage = {
  readonly messages: readonly MessagingMessageRecord[];
  readonly changeVersion: number;
  readonly nextAfter: {
    readonly channelId: string;
    readonly changeVersion: number;
  };
};
export type MessagingLockedFrame = {
  readonly history: (input: {
    readonly query?: string;
    readonly limit: number;
    readonly before?: number;
  }) => Promise<MessagingHistoryPage>;
  readonly changes: (input: {
    readonly limit: number;
    readonly after: number;
  }) => Promise<MessagingChangesPage>;
  readonly markRead: (sequence: number) => Promise<number>;
  readonly authorize: () => Promise<void>;
  readonly fact: MessagingChannelFact;
  readonly accounts: readonly ReturnType<typeof authorizationAccountFact>[];
  readonly counters: MessagingCounters;
  readonly readSendState: (
    command: MessagingSendCommand,
  ) => Promise<MessagingSendState>;
  readonly commitSend: (plan: MessagingCreateSendPlan) => Promise<void>;
  readonly readMutationState: (
    command: MessagingMutationCommand,
  ) => Promise<MessagingMutationState>;
  readonly commitMutation: (plan: MessagingMutationPlan) => Promise<void>;
};
/** Readers: compatible authority fences and the stream's committed high-water mark, never its lock. */
export type MessagingReadFrame = Pick<
  MessagingLockedFrame,
  | 'history'
  | 'changes'
  | 'markRead'
  | 'authorize'
  | 'fact'
  | 'accounts'
  | 'counters'
>;
type MessagingChannelScope = {
  readonly channelId: string;
  readonly actorId: string;
  readonly userId: string;
};
export type MessagingChannelStore = {
  readonly withChannel: <T>(
    input: MessagingChannelScope,
    work: (frame: MessagingLockedFrame) => Promise<T>,
  ) => Promise<T>;
  readonly withReadChannel: <T>(
    input: MessagingChannelScope,
    work: (frame: MessagingReadFrame) => Promise<T>,
  ) => Promise<T>;
};
