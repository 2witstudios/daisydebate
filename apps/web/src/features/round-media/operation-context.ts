import type { MediaObservation } from '@daisy/debate-engine';
import type { RoundIncident, RoundStatus } from '@daisy/protocol';
import type { createAdmissionPriority } from './admission-priority';
import type { Database } from '@daisy/db';
import type { MediaNodes, MediaVendor } from '@daisy/media';
import type { ErrorReporter } from '@daisy/observability';
import type { Logger } from '@daisy/logger';
import type { BotPublicationScope } from '@daisy/db/bot-publication';
/** What one recovery pass saw, for whoever decides what that means for the Round. */
export type MediaPassReport = {
  readonly roundId: string;
  readonly observation: MediaObservation;
  readonly nowMs: number;
  /** Read from the pass's snapshot, so a healthy Round costs no Round lock. */
  readonly known: {
    readonly incident: RoundIncident;
    readonly status: RoundStatus;
  };
};

export type Store = Database['mediaSessions'];
export type Claim = Extract<
  Awaited<ReturnType<Store['claimMediaReconcile']>>,
  { kind: 'claimed' }
>;
export type Intent = Parameters<Store['beginMediaMutation']>[0]['intent'];
export type Principal = Parameters<Store['issueMediaToken']>[0]['principal'];
export type Scope = BotPublicationScope;

export type MediaOperationInput = {
  readonly priority: ReturnType<typeof createAdmissionPriority>;
  readonly store: Store;
  readonly media: MediaVendor;
  readonly urlsFor: MediaNodes['urlsFor'];
  /** The seat capture reports reading this track for, or null. */
  readonly readCaptureHeard: (
    roundId: string,
    trackId: string,
  ) => Promise<string | null>;
  readonly nextId: () => string;
  readonly reporter: ErrorReporter;
  readonly logger: Logger;
  /** What a recovery pass saw goes here; it owns what that means for the Round. */
  readonly observeIncident: (report: MediaPassReport) => Promise<void>;
  /** These speakers' microphones are opening, and capture has not reported them. */
  readonly awaitCapture: (
    roundId: string,
    seats: readonly string[],
  ) => Promise<void>;
  readonly deadline: <T>(work: Promise<T>) => Promise<T>;
  readonly wait: () => Promise<void>;
  /** The longest a Round goes with no recovery pass when nothing is due. */
  readonly recoveryHeartbeatMs: number;
  /** Milliseconds, read only to bound how long an admission waits. */
  readonly now: () => number;
  /** Which camera a seat captures. Only a hint about quality: it decides no authority. */
  readonly cameraProfile?: (
    roundId: string,
  ) => Promise<'standard' | 'broadcast'>;
};
