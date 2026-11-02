import type { RoundMediaAdmission } from '@daisy/protocol';
import type { Source } from './media-state';

export type MediaTimer =
  | 'admission-retry'
  | 'read-retry'
  | 'read-budget'
  | 'read-let-finish'
  | 'capture-patience'
  | 'recovery';

/** What the model asks of the world. Results come back as later events, never mid-reduce. */
export type MediaEffect =
  | { readonly type: 'admit'; readonly connection: number }
  | { readonly type: 'abort-admission'; readonly connection: number }
  | {
      readonly type: 'connect';
      readonly connection: number;
      readonly admission: RoundMediaAdmission;
    }
  | { readonly type: 'release-connection'; readonly connection: number }
  /** Reports read-start-due after the events already queued. */
  | { readonly type: 'defer-read-start' }
  | { readonly type: 'start-read'; readonly ticket: number }
  | { readonly type: 'abort-read'; readonly ticket: number }
  | {
      readonly type: 'capture';
      readonly connection: number;
      readonly source: Source;
      /** Use the browser's default rather than the checked device. */
      readonly useDefaults: boolean;
    }
  | {
      readonly type: 'publish';
      readonly connection: number;
      readonly source: Source;
      readonly muted: boolean;
    }
  | {
      readonly type: 'unpublish';
      readonly connection: number;
      readonly source: Source;
    }
  | {
      readonly type: 'release-track';
      readonly connection: number;
      readonly source: Source;
    }
  | {
      readonly type: 'set-mute';
      readonly connection: number;
      readonly muted: boolean;
    }
  | { readonly type: 'start-audio'; readonly connection: number }
  | {
      readonly type: 'schedule';
      readonly timer: MediaTimer;
      readonly ms: number;
      readonly id: number;
    }
  | { readonly type: 'cancel'; readonly timer: MediaTimer }
  | { readonly type: 'refresh-view' }
  | { readonly type: 'remember-mute'; readonly muted: boolean }
  | { readonly type: 'forget-mute' }
  | {
      readonly type: 'forget-checked-devices';
      readonly sources: readonly Source[];
    }
  | { readonly type: 'clear-checked-devices' };
