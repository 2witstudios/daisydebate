import type { ChannelMessageRecord } from '@daisy/protocol';
import type { AuthorizationTransaction } from '../authorization';
import type { MessagingChannelFact } from './social';
import type { authorizationAccountFact } from '../authorization-account';

/** One stored message: the shape the shared channel mapper reads (ADR 0089). */
export type MessagingMessageRecord = ChannelMessageRecord;
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
/**
 * What a read may do: no counter writes, sends or mutations (MSG-2.1-arch1).
 * `markRead` writes only the actor's own read marker, so it shares the
 * fences too (MSG-2.2-arch1).
 * `readRequestState` is a command's lock-free preflight: it tells a new
 * request from a replay before the limiter, outside the write transaction
 * (MSG-2.2-arch1).
 */
export type MessagingReadFrame = Pick<
  MessagingLockedFrame,
  'history' | 'changes' | 'markRead' | 'authorize' | 'fact' | 'accounts'
> & {
  readonly readRequestState: (input: {
    readonly requestId: string;
    readonly messageId?: string;
  }) => Promise<MessagingMutationState>;
};
type ChannelScope = {
  readonly channelId: string;
  readonly actorId: string;
  readonly userId: string;
};
export type MessagingChannelStore = {
  /** Commands: exclusive fences and the channel counters. */
  readonly withChannel: <T>(
    input: ChannelScope,
    work: (frame: MessagingLockedFrame) => Promise<T>,
  ) => Promise<T>;
  /** Reads: shared fences, so readers never serialize behind each other. */
  readonly readChannel: <T>(
    input: ChannelScope,
    work: (frame: MessagingReadFrame) => Promise<T>,
  ) => Promise<T>;
};
