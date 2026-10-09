import type { AuthorizationTransaction } from '../authorization';
import type { MessagingChannelFact } from './social';
import type { authorizationAccountFact } from '../authorization-account';

export type MessagingMessageRecord = {
  readonly id: string;
  readonly channelId: string;
  readonly authorActorId: string;
  readonly sequence: number;
  readonly changeVersion: number;
  readonly text: string | null;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly removedAt: string | null;
  readonly replyToMessageId?: string;
};
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
export type MessagingChannelStore = {
  readonly withChannel: <T>(
    input: {
      readonly channelId: string;
      readonly actorId: string;
      readonly userId: string;
    },
    work: (frame: MessagingLockedFrame) => Promise<T>,
  ) => Promise<T>;
};
