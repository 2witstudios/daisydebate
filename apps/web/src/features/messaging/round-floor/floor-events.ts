import type { ReadKind } from './floor-state';
import type { FloorMetadata, FloorPageRead } from './view';

/** What happened: the reader's intents, the server's answers and the driver's timer. */
export type FloorEvent =
  | { readonly type: 'enter-requested'; readonly mayOpen: boolean }
  | {
      readonly type: 'discovered';
      readonly request: number;
      readonly channel: FloorMetadata | null;
    }
  | {
      readonly type: 'opened';
      readonly request: number;
      readonly metadata: FloorMetadata;
    }
  | {
      readonly type: 'entry-refused';
      readonly request: number;
      readonly denied: boolean;
    }
  | { readonly type: 'refresh-requested' }
  | { readonly type: 'older-requested'; readonly before: number }
  | {
      readonly type: 'latest-read';
      readonly request: number;
      readonly page: FloorPageRead;
    }
  | {
      readonly type: 'older-read';
      readonly request: number;
      readonly page: FloorPageRead;
    }
  | {
      readonly type: 'read-refused';
      readonly request: number;
      readonly read: ReadKind;
      readonly denied: boolean;
    }
  /** The live channel says this reader may no longer see the floor. */
  | { readonly type: 'floor-hidden' }
  | { readonly type: 'messages-shown'; readonly sequence: number }
  | {
      readonly type: 'read-marked';
      readonly request: number;
      readonly sequence: number;
    }
  | { readonly type: 'read-mark-failed'; readonly request: number }
  | { readonly type: 'expiry-reached'; readonly expiresAt: string };
