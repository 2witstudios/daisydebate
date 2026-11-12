import type { ContentReportCreate } from '@daisy/protocol/content-moderation';
import type { AuthorizationTransaction } from '../authorization';
import type { authorizationAccountFact } from '../authorization-account';
import type { MessagingLockedFrame, MessagingReadFrame } from './records';

/** The Messaging channel kinds that belong to one owning resource and take its authority. */
export type ContextChannelKind = 'round_floor' | 'room_community';
/** What every context's authority fact says about its channel. */
export type ContextChannelFact = { readonly channelId: string | null };
export type ContextChannelScope = {
  /** The Round or Room the channel belongs to. */
  readonly ownerId: string;
  readonly channelId: string;
  readonly userId: string;
  readonly actorId: string;
};
export type ContextChannelAction = 'read' | 'post' | 'remove';
export type ContextChannelAuthority<Fact extends ContextChannelFact> = {
  readonly tx: AuthorizationTransaction;
  readonly scope: Omit<ContextChannelScope, 'channelId'>;
  readonly fact: Fact;
  readonly account: ReturnType<typeof authorizationAccountFact>;
  readonly action: ContextChannelAction;
};
/** Refuses by throwing; the context's pure decision is made inside it. */
export type ContextChannelFence<Fact extends ContextChannelFact> = (
  input: ContextChannelAuthority<Fact>,
) => Promise<void>;
export type ContextChannelMetadata = {
  readonly channelId: string;
  readonly readOnly: boolean;
  readonly expiresAt: string | null;
};
type ContextChannelAuthor = {
  readonly actorId: string;
  readonly label: string;
};
/**
 * What one context supplies to the shared store: its channel kind, its owner's
 * lock, its authority read and what only it knows about its own audience.
 */
export type ContextChannelOwner<Fact extends ContextChannelFact> = {
  readonly kind: ContextChannelKind;
  /** Takes the owner's shared lock; false when there is no such owner. */
  readonly fence: (
    tx: AuthorizationTransaction,
    ownerId: string,
  ) => Promise<boolean>;
  readonly readFact: (
    tx: AuthorizationTransaction,
    ownerId: string,
    actorId: string,
  ) => Promise<Fact | null>;
  /** Inserts the owner's one channel unless it exists; true when this call created it. */
  readonly insertChannel: (
    tx: AuthorizationTransaction,
    input: { readonly ownerId: string; readonly channelId: string },
  ) => Promise<boolean>;
  /** The labels this context lets a reader see for the authors of a page. */
  readonly readAuthors: (
    tx: AuthorizationTransaction,
    input: {
      readonly ownerId: string;
      readonly channelId: string;
      readonly authorActorIds: readonly string[];
    },
  ) => Promise<readonly ContextChannelAuthor[]>;
  readonly metadataOf: (fact: Fact) => ContextChannelMetadata;
};
export type ContextChannelReadFrame<Fact extends ContextChannelFact> = {
  readonly fileReport: (input: {
    readonly id: string;
    readonly messageId: string;
    readonly reason: Extract<
      ContentReportCreate,
      { targetKind: 'chat_message' }
    >['reason'];
  }) => Promise<void>;
  readonly readAuthors: (
    authorActorIds: readonly string[],
  ) => Promise<readonly ContextChannelAuthor[]>;
} & Omit<MessagingReadFrame, 'fact' | 'accounts'> &
  Pick<ContextChannelAuthority<Fact>, 'fact' | 'account'>;
export type ContextChannelWriteFrame<Fact extends ContextChannelFact> = Omit<
  MessagingLockedFrame,
  'fact' | 'accounts'
> &
  Pick<ContextChannelAuthority<Fact>, 'fact' | 'account'>;
