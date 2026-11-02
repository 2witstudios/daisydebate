import type { RoundMediaState } from '@daisy/protocol';
import type { MediaReadIntent } from '../media-read-intent';
import type { SourceFailureKind } from '../source-failure';

/**
 * The whole picture of one Round's media on this tab. Only `live` holds tracks,
 * grants or a read, so a dead connection cannot say Connected and a released one
 * has no grants to misread.
 */
export type Source = 'camera' | 'microphone';
export const SOURCES: readonly Source[] = ['camera', 'microphone'];

export type SourceState =
  | { readonly phase: 'off' }
  | { readonly phase: 'capturing'; readonly waiting: boolean }
  /** A debater's microphone between turns: its grant costs a publish, not a device open. */
  | { readonly phase: 'warm' }
  | { readonly phase: 'publishing'; readonly sinceMs: number }
  /** `swapped`: the SDK restarted a dead checked device on another input. */
  | { readonly phase: 'published'; readonly swapped: boolean }
  | {
      readonly phase: 'unpublishing';
      readonly sinceMs: number;
      readonly keepWarm: boolean;
    }
  | { readonly phase: 'failed'; readonly kind: SourceFailureKind }
  /** The device the Room check passed is gone. */
  | { readonly phase: 'missing' }
  /** The SDK would not remove it. Lasts until this source's next grant or a Retry. */
  | { readonly phase: 'stale-publication' };

export type ObservedTrack = {
  readonly identity: string;
  readonly source: Source;
  readonly local: boolean;
  readonly speaking: boolean;
  readonly muted: boolean;
};
export type ObservedPeer = {
  readonly identity: string;
  readonly microphonePublished: boolean;
};

/** Why nothing is connected: it decides whether anything will try again. */
export type ReleaseReason = 'transient' | 'definite' | 'refused' | 'replaced';

/** Whether the last server answer still describes what is shown. */
export type Freshness =
  'current' | 'checking' | { readonly stale: 'transient' | 'definite' };

export type ReadFlight = {
  readonly ticket: number;
  readonly generation: number;
  readonly attempt: number;
  readonly stage: 'requesting' | 'pausing';
  readonly startedAtMs: number;
  /** A superseded young read finishes; its reply is fenced like any other. */
  readonly letFinishing: boolean;
};
export type LiveReads = {
  readonly flight: ReadFlight | null;
  readonly queued: boolean;
  /** A read is due once this burst of events ends, so a burst costs one read. */
  readonly startDeferred: boolean;
  readonly supersededSinceAnswer: number;
  /** The one timer for "no answer for too long". */
  readonly budgetRunning: boolean;
};
export type PendingAnswer = {
  readonly generation: number;
  readonly answer: RoundMediaState;
};
/** One answer applies at a time; only one still current may announce. */
export type LiveApply = {
  readonly running:
    (PendingAnswer & { readonly patienceExpired: boolean }) | null;
  readonly next: PendingAnswer | null;
};

export type LiveConnection = {
  readonly phase: 'live';
  readonly connection: number;
  readonly identity: string;
  /** Shown while not yet established: this is a return, not a first join. */
  readonly reconnecting: boolean;
  /** The first answer applied. Before this it cannot be out of date. */
  readonly established: boolean;
  readonly grants: readonly Source[];
  /** What LiveKit allows now, which outranks a reply crossing it; null if unknown. */
  readonly permission: readonly Source[] | null;
  /** The last applied answer, for layout. */
  readonly media: RoundMediaState | null;
  readonly freshness: Freshness;
  readonly sources: Readonly<Record<Source, SourceState>>;
  readonly tracks: readonly ObservedTrack[];
  readonly peers: readonly ObservedPeer[];
  readonly sound: 'allowed' | 'blocked';
  readonly reads: LiveReads;
  readonly apply: LiveApply;
};

export type MediaLink =
  | { readonly phase: 'waiting'; readonly tab: 'checking' | 'elsewhere' }
  | {
      readonly phase: 'admitting';
      readonly connection: number;
      readonly reconnecting: boolean;
      /** Attempts this admission may still retry itself. */
      readonly attempt: number;
      readonly retries: boolean;
      readonly stage: 'requesting' | 'pausing';
    }
  | {
      readonly phase: 'connecting';
      readonly connection: number;
      readonly identity: string;
      readonly reconnecting: boolean;
    }
  | LiveConnection
  | { readonly phase: 'released'; readonly why: ReleaseReason }
  | { readonly phase: 'ended' };

/** The one paced owner of "try again". */
export type Recovery = {
  readonly step: number;
  readonly lastAttemptMs: number | null;
  readonly heldSinceMs: number | null;
  readonly armed: 'rejoin' | 'wake' | null;
};

export type MediaState = {
  readonly link: MediaLink;
  readonly intent: MediaReadIntent;
  readonly recovery: Recovery;
  readonly microphoneMuted: boolean;
  readonly changingMicrophone: boolean;
  readonly nextConnection: number;
  readonly nextTicket: number;
};

/** Every number the model decides with. Injected, so it holds no constants of its own. */
export type MediaPolicy = {
  readonly requestRetryDelaysMs: readonly number[];
  readonly readBudgetMs: number;
  readonly letFinishMs: number;
  readonly capturePatienceMs: number;
  readonly recoveryDelaysMs: readonly number[];
  readonly eventFloorMs: number;
};

export const initialMediaState = (input: {
  readonly roundViewVersion: number;
  readonly microphoneMuted: boolean;
}): MediaState => {
  if (
    !Number.isSafeInteger(input.roundViewVersion) ||
    input.roundViewVersion < 0
  )
    throw new Error('Invalid initial Round view version');
  return {
    link: { phase: 'waiting', tab: 'checking' },
    intent: {
      roundViewVersion: input.roundViewVersion,
      deadlineMs: null,
      generation: 0,
      disposed: false,
    },
    recovery: { step: 0, lastAttemptMs: null, heldSinceMs: null, armed: null },
    microphoneMuted: input.microphoneMuted,
    changingMicrophone: false,
    nextConnection: 1,
    nextTicket: 1,
  };
};
