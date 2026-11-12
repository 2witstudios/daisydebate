import type { ContextChatMessage } from './history';
import type { ContextChatMetadata, ContextChatPageRead } from './view';

/** Pages before the latest, valid for the one change version they were read at. */
export type ContextChatOlderPages = {
  readonly changeVersion: number;
  readonly messages: readonly ContextChatMessage[];
  readonly before: number | null;
};

/** The messages a reader has been shown since the chat was last opened. */
export type ContextChatThread = {
  readonly history: ContextChatPageRead['history'];
  readonly authors: ContextChatPageRead['authors'];
  readonly bounds: ContextChatPageRead['bounds'];
  readonly older: ContextChatOlderPages | null;
  /** The older read whose answer Older messages waits for. */
  readonly paging: number | null;
};

/** What keeps a reader's open drafts mounted while the chat itself is away. */
export type KeptForms = {
  readonly channelId: string;
  readonly messageUnits: number | null;
};

export type ReadKind = 'latest' | 'older';

/**
 * Per kind, the reads asked of this chat whose answers may still apply. A read
 * leaves when it fails, when it or a later one of its kind is applied, and when
 * the chat is hidden. Any other request's answer changes nothing.
 */
export type OutstandingReads = Readonly<Record<ReadKind, readonly number[]>>;

export type OpenContextChat = {
  readonly kind: 'ready';
  readonly metadata: ContextChatMetadata;
  /** The chat's own expiry has passed, as the driver's timer reported. */
  readonly expired: boolean;
  readonly notice: 'read-failed' | null;
  readonly readSequence: number;
  /** The read marker on its way to the server. */
  readonly marking: {
    readonly request: number;
    readonly sequence: number;
  } | null;
  /**
   * The live channel says this reader may not see the chat. Nothing is read,
   * marked read or paged meanwhile, and being shown again asks for the latest
   * page.
   */
  readonly hidden: boolean;
  readonly reads: OutstandingReads;
  /**
   * Null while no latest page is held: `reads.latest` says whether one is on
   * its way, and when none is, `hidden` or `notice` says why.
   */
  readonly thread: ContextChatThread | null;
};

export type ContextChatStanding =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'loading';
      readonly request: number;
      readonly step: 'discovering';
      /** With no channel found, whether this reader may open one. */
      readonly mayOpen: boolean;
      readonly kept: KeptForms | null;
    }
  | {
      readonly kind: 'loading';
      readonly request: number;
      readonly step: 'opening';
      readonly kept: KeptForms | null;
    }
  | {
      readonly kind: 'empty' | 'unavailable' | 'denied';
      readonly kept: KeptForms | null;
    }
  | OpenContextChat;

export type ContextChatState = {
  /** The last request id handed out; ids are never reused across standings. */
  readonly requests: number;
  readonly standing: ContextChatStanding;
};

export const initialContextChatState: ContextChatState = {
  requests: 0,
  standing: { kind: 'idle' },
};
