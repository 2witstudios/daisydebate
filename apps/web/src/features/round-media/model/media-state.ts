import type { RoundMediaState } from '@daisy/protocol';
import type { MediaReadIntent } from '../media-read-intent';
import type {
  DeviceFailureKind,
  PreferenceFailureKind,
} from '../source-failure';
import type { MediaTimer } from './media-effects';

/**
 * The whole picture of one Round's media on this tab. The types carry the rules: only
 * a `live` link holds tracks, grants or a read; only an `established` one has an answer
 * to be out of date; a released link has nothing to misread.
 */
export type Source = 'camera' | 'microphone';
export const SOURCES: readonly Source[] = ['camera', 'microphone'];

export type SourceState =
  | { readonly phase: 'off' }
  /** `waiting`: past patience, so the answer no longer waits for this prompt. */
  | { readonly phase: 'capturing'; readonly waiting: boolean }
  /** A debater's microphone between turns: its grant costs a publish, not a device open. */
  | { readonly phase: 'warm' }
  /** `stuck`: past the budget beside a healthy source, so it is named and a person decides. */
  | {
      readonly phase: 'publishing';
      readonly sinceMs: number;
      readonly stuck: boolean;
    }
  /** `swapped`: the SDK restarted a dead checked device on another input. */
  | { readonly phase: 'published'; readonly swapped: boolean }
  | {
      readonly phase: 'unpublishing';
      readonly sinceMs: number;
      readonly keepWarm: boolean;
      readonly stuck: boolean;
    }
  /** `removingSinceMs`: its publication is still being taken down after the failure. */
  | {
      readonly phase: 'failed';
      readonly kind: DeviceFailureKind;
      readonly removingSinceMs: number | null;
    }
  /** A saved choice that could not be read fails before anything is published. */
  | {
      readonly phase: 'failed';
      readonly kind: PreferenceFailureKind;
      readonly removingSinceMs: null;
    }
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

/**
 * Whether the last server answer still describes what is shown. `wakeArmed`: recovery
 * will read again by itself; false once that read has been sent.
 */
export type Freshness =
  | { readonly status: 'current' }
  | { readonly status: 'checking' }
  | {
      readonly status: 'stale';
      readonly cause: 'transient';
      readonly wakeArmed: boolean;
    }
  | { readonly status: 'stale'; readonly cause: 'definite' };

type ReadIdentity = {
  readonly ticket: number;
  readonly generation: number;
  /** Failed attempts so far. */
  readonly attempt: number;
  readonly startedAtMs: number;
};
/** The one read in flight, in the stage it is really in. */
export type ReadFlight = ReadIdentity &
  (
    | { readonly stage: 'requesting' }
    /** Waiting out a retry delay: no request is open. */
    | { readonly stage: 'pausing' }
    /** Superseded while young: it may finish, and its reply is fenced like any other. */
    | { readonly stage: 'letting-finish' }
    /** Asked to stop; waiting for that to settle. */
    | { readonly stage: 'aborting' }
  );

export type LiveReads = {
  readonly flight: ReadFlight | null;
  /**
   * `wanted`: a read follows when nothing holds it. `starting`: it starts when this
   * burst of events ends, so a burst costs one read.
   */
  readonly next: 'none' | 'wanted' | 'starting';
  readonly supersededSinceAnswer: number;
};

export type PendingAnswer = {
  readonly generation: number;
  readonly answer: RoundMediaState;
};
/** One answer applies at a time; only one still current may announce. */
export type RunningApply = PendingAnswer & {
  readonly next: PendingAnswer | null;
};

/** Before the first answer applies there is nothing to be out of date. */
export type Establishment =
  | { readonly stage: 'establishing'; readonly reconnecting: boolean }
  | {
      readonly stage: 'established';
      /** The last applied answer. */
      readonly media: RoundMediaState;
      readonly freshness: Freshness;
    };

export type LiveConnection = {
  readonly phase: 'live';
  readonly connection: number;
  readonly identity: string;
  readonly establishment: Establishment;
  readonly grants: readonly Source[];
  /** What LiveKit allows now, which outranks a reply crossing it; null if unknown. */
  readonly permission: readonly Source[] | null;
  readonly sources: Readonly<Record<Source, SourceState>>;
  readonly tracks: readonly ObservedTrack[];
  readonly peers: readonly ObservedPeer[];
  readonly sound: 'allowed' | 'blocked';
  /** A mute change this connection is carrying out. */
  readonly changingMicrophone: boolean;
  /** The vendor room this connection joined. */
  readonly room: string;
  /** A blip: `resuming` until the SDK's short budget answers, or a drop ends this link. */
  readonly transport: 'steady' | 'resuming';
  readonly reads: LiveReads;
  readonly apply: RunningApply | null;
};

export type MediaLink =
  | { readonly phase: 'waiting'; readonly tab: 'checking' | 'elsewhere' }
  | {
      readonly phase: 'admitting';
      readonly connection: number;
      /** A first join retries its own admission; null: recovery paces the next try. */
      readonly ownRetry: {
        readonly attempt: number;
        readonly pausing: boolean;
      } | null;
    }
  | {
      readonly phase: 'connecting';
      readonly connection: number;
      readonly identity: string;
      readonly room: string;
      readonly reconnecting: boolean;
    }
  | LiveConnection
  /** Released `transient` always has its rejoin waiting. */
  | { readonly phase: 'released'; readonly why: ReleaseReason }
  | { readonly phase: 'ended' };

/** A first attempt says connecting; anything after it, reconnecting. */
export const admissionReconnects = (
  link: Extract<MediaLink, { readonly phase: 'admitting' }>,
) => link.ownRetry === null || link.ownRetry.attempt > 0;

/** The pace of the one owner of "try again". What it waits to do is in the link. */
export type RecoveryPace = {
  readonly step: number;
  readonly lastAttemptMs: number | null;
  readonly heldSinceMs: number | null;
};

export type MediaState = {
  readonly link: MediaLink;
  readonly intent: MediaReadIntent;
  readonly recovery: RecoveryPace;
  readonly microphoneMuted: boolean;
  /** A person chose the browser's default after a saved choice could not be read. */
  readonly devices: 'checked' | 'defaults';
  readonly nextConnection: number;
  readonly nextTicket: number;
  /** Which schedule of each timer is current, so a late firing is rejected. */
  readonly timers: Readonly<Partial<Record<MediaTimer, number>>>;
  readonly nextTimer: number;
};

/** The numbers an environment chooses. The let-finish limit stays with read intent. */
export type MediaPolicy = {
  readonly requestRetryDelaysMs: readonly number[];
  readonly readBudgetMs: number;

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
    },
    recovery: { step: 0, lastAttemptMs: null, heldSinceMs: null },
    microphoneMuted: input.microphoneMuted,
    devices: 'checked',
    nextConnection: 1,
    nextTicket: 1,
    timers: {},
    nextTimer: 1,
  };
};
