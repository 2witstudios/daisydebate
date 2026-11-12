import type { ReadKind } from './chat-state';
import type { ContextChatMetadata, ContextChatPageRead } from './view';

/** What happened: the reader's intents, the server's answers and the driver's timer. */
export type ContextChatEvent =
  | { readonly type: 'enter-requested'; readonly mayOpen: boolean }
  | {
      readonly type: 'discovered';
      readonly request: number;
      readonly channel: ContextChatMetadata | null;
    }
  | {
      readonly type: 'opened';
      readonly request: number;
      readonly metadata: ContextChatMetadata;
    }
  | {
      readonly type: 'entry-refused';
      readonly request: number;
      readonly denied: boolean;
    }
  /** Time to ask again whether someone else has opened a chat this reader may not. */
  | { readonly type: 'opening-check-requested' }
  | { readonly type: 'refresh-requested' }
  | { readonly type: 'older-requested'; readonly before: number }
  | {
      readonly type: 'latest-read';
      readonly request: number;
      readonly page: ContextChatPageRead;
    }
  | {
      readonly type: 'older-read';
      readonly request: number;
      readonly page: ContextChatPageRead;
    }
  | {
      readonly type: 'read-refused';
      readonly request: number;
      readonly read: ReadKind;
      readonly denied: boolean;
    }
  /** The live channel says this reader may no longer see the chat. */
  | { readonly type: 'chat-hidden' }
  /** The live channel lets this reader see the chat again. */
  | { readonly type: 'chat-shown' }
  | { readonly type: 'messages-shown'; readonly sequence: number }
  | {
      readonly type: 'read-marked';
      readonly request: number;
      readonly sequence: number;
    }
  | { readonly type: 'read-mark-failed'; readonly request: number }
  | { readonly type: 'expiry-reached'; readonly expiresAt: string };
