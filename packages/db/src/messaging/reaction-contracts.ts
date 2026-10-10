import type { AuthorizationTransaction } from '../authorization';
import type { MessagingAuthorizationFence } from './records';

type Scope = Parameters<MessagingAuthorizationFence>[1];
type Authority = Parameters<MessagingAuthorizationFence>[2];
export type MessagingReactionAssociation = {
  readonly actorId: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly reaction: string;
};
export type MessagingReactionCommand = {
  readonly version: 1;
  readonly channelId: string;
  readonly messageId: string;
  readonly requestId: string;
  readonly reaction: string;
  readonly active: boolean;
};
export type MessagingReactionResult = {
  readonly version: 1;
  readonly channelId: string;
  readonly messageId: string;
  readonly changeVersion: number;
  readonly replayed: boolean;
  readonly reactions: readonly {
    readonly reaction: string;
    readonly count: number;
    readonly own: boolean;
  }[];
};
export type MessagingReactionFence = (
  tx: AuthorizationTransaction,
  scope: Scope,
  authority: Authority,
  operation: 'read' | 'add' | 'remove',
  association?: MessagingReactionAssociation,
) => Promise<void>;
export type MessagingReactionStore = {
  readonly read: (
    scope: Scope,
    messageId: string,
  ) => Promise<MessagingReactionResult>;
  readonly change: (
    scope: Scope,
    command: MessagingReactionCommand,
    payloadDigest: string,
  ) => Promise<MessagingReactionResult>;
};
