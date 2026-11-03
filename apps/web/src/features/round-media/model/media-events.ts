import type { RoundMediaAdmission, RoundMediaState } from '@daisy/protocol';
import type { MediaReadEvent } from '../media-read-intent';
import type { DeviceFailureKind, SourceFailureKind } from '../source-failure';
import type { MediaTimer } from './media-effects';
import type { ObservedPeer, ObservedTrack, Source } from './media-state';

/** How a request failed, classified at the edge: the model only reads the kind. */
export type RequestFailure = 'transient' | 'definite' | 'ending' | 'refused';

/** What this connection's room reports. Stale ones are fenced by `connection`. */
export type RoomEvent =
  | {
      readonly type: 'connected';
      readonly permission: readonly Source[] | null;
    }
  | { readonly type: 'connect-failed'; readonly failure: RequestFailure }
  | { readonly type: 'dropped' }
  | { readonly type: 'replaced' }
  /** Something a read should look at again: a peer moved. */
  | { readonly type: 'room-changed' }
  | {
      readonly type: 'permission-changed';
      readonly permission: readonly Source[] | null;
    }
  | {
      readonly type: 'observed';
      readonly tracks: readonly ObservedTrack[];
      readonly peers: readonly ObservedPeer[];
    }
  | { readonly type: 'captured'; readonly source: Source }
  | {
      readonly type: 'capture-failed';
      readonly source: Source;
      readonly kind: SourceFailureKind;
      /** It was the device the Room check passed. */
      readonly checked: boolean;
    }
  | { readonly type: 'published'; readonly source: Source }
  | {
      readonly type: 'publish-failed';
      readonly source: Source;
      readonly kind: DeviceFailureKind;
    }
  | { readonly type: 'unpublished'; readonly source: Source }
  | { readonly type: 'unpublish-failed'; readonly source: Source }
  | { readonly type: 'track-ended'; readonly source: Source }
  | { readonly type: 'device-swapped'; readonly source: Source }
  | { readonly type: 'mute-applied'; readonly muted: boolean }
  | { readonly type: 'mute-abandoned' }
  | { readonly type: 'mute-failed'; readonly kind: DeviceFailureKind }
  | { readonly type: 'playback-changed'; readonly allowed: boolean }
  /** The SDK is resuming this connection after a blip; tracks and connection stay. */
  | { readonly type: 'transport-resuming' }
  | { readonly type: 'transport-resumed' };

export type MediaEvent =
  | { readonly type: 'tab-changed'; readonly owns: boolean | null }
  | { readonly type: 'page-left' }
  | { readonly type: 'frozen-page-restored' }
  | { readonly type: 'round-ended' }
  | { readonly type: 'mute-restored'; readonly muted: boolean }
  | {
      readonly type: 'admission-answered';
      readonly connection: number;
      readonly admission: RoundMediaAdmission;
    }
  | {
      readonly type: 'admission-failed';
      readonly connection: number;
      readonly failure: RequestFailure;
    }
  | { readonly type: 'read-requested'; readonly read: MediaReadEvent }
  | { readonly type: 'read-start-due' }
  | {
      readonly type: 'read-answered';
      readonly ticket: number;
      readonly answer: RoundMediaState;
    }
  | {
      readonly type: 'read-failed';
      readonly ticket: number;
      readonly failure: RequestFailure;
    }
  | { readonly type: 'read-aborted'; readonly ticket: number }
  | {
      readonly type: 'timer-fired';
      readonly timer: MediaTimer;
      /** Which schedule fired; a replaced one is rejected. */
      readonly id: number;
    }
  | { readonly type: 'browser-nudged' }
  | { readonly type: 'retry-pressed' }
  | { readonly type: 'mute-requested'; readonly muted: boolean }
  | { readonly type: 'enable-sound-pressed' }
  | { readonly type: 'forget-failed'; readonly sources: readonly Source[] }
  | (RoomEvent & { readonly connection: number });
