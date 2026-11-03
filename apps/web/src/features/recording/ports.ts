import type {
  RecordingClass,
  RecordingEligibility,
  RecordingLifecycle,
} from '@daisy/protocol';
import type { BroadcastRelease, RecordingRound } from './audience';
import type { RecordingTransition } from './lifecycle';
import type { FloorInterval } from './speech-timeline';

export type RecordingRecord = {
  readonly id: string;
  readonly roundId: string;
  readonly class: RecordingClass;
  readonly eligibility: RecordingEligibility;
  readonly lifecycle: RecordingLifecycle;
  /** Moves with every change; a versioned operation names the one it read. */
  readonly version: number;
};

export type RecordingApplied =
  | { readonly kind: 'missing' }
  | { readonly kind: 'stale'; readonly record: RecordingRecord }
  | {
      readonly kind: 'decided';
      readonly record: RecordingRecord;
      readonly transition: RecordingTransition;
    };

/** A claimed deletion: the worker's lease and how often it has already failed. */
export type RecordingDeletionClaim = {
  readonly record: RecordingRecord;
  readonly attempts: number;
};

/** The durable Recording: its one writer is PostgreSQL under a row lock. */
export type RecordingStore = {
  /** One Recording per Round: a repeat returns the first, whoever asked. */
  readonly request: (input: {
    readonly id: string;
    readonly roundId: string;
    readonly class: RecordingClass;
    readonly eligibility: RecordingEligibility;
  }) => Promise<RecordingRecord>;
  readonly find: (recordingId: string) => Promise<RecordingRecord | null>;
  readonly findByRound: (roundId: string) => Promise<RecordingRecord | null>;
  /**
   * Runs the pure decision under the row lock and stores a move in the same
   * transaction. `unchanged` and `refused` write nothing. A named version that
   * no longer holds answers `stale` before the decision runs.
   */
  readonly apply: (
    recordingId: string,
    decide: (record: RecordingRecord) => RecordingTransition,
    expectedVersion?: number,
  ) => Promise<RecordingApplied>;
  /** Up to `limit` due deletions, leased so two workers never share one. */
  readonly claimDeletions: (input: {
    readonly owner: string;
    readonly now: string;
    readonly leaseUntil: string;
    readonly limit: number;
  }) => Promise<readonly RecordingDeletionClaim[]>;
  /**
   * Releases the lease; the intent stays and comes due again at `retryAt`. Only
   * a failure counts towards backoff, so a large Recording is not slowed by the
   * batches it needs.
   */
  readonly deferDeletion: (
    recordingId: string,
    input: { readonly retryAt: string; readonly failed: boolean },
  ) => Promise<void>;
  /** Whether anything of this Recording may still wait in the hold bucket. */
  readonly sourcesRemain: (recordingId: string) => Promise<boolean>;
  /** Failed Recordings older than `before`, whose partial objects can go. */
  readonly listFailedBefore: (input: {
    readonly before: string;
    readonly limit: number;
  }) => Promise<readonly string[]>;
};

/** Private bucket only. No key here is ever public; a signed read is short-lived. */
export type RecordingObjectStore = {
  readonly signedRead: (
    key: string,
    options: {
      readonly expiresInSeconds: number;
      readonly attachmentName?: string;
    },
  ) => string;
  readonly readText: (key: string) => Promise<string>;
  /** At most `limit` keys under the prefix: enough to know if any remain. */
  readonly listKeys: (
    prefix: string,
    limit: number,
  ) => Promise<readonly string[]>;
  /** Removing a key that is already gone succeeds, so a retry is harmless. */
  readonly removeKeys: (keys: readonly string[]) => Promise<void>;
};

/** The named read-only inputs from other features. */
export type RecordingInputs = {
  readonly readRound: (roundId: string) => Promise<RecordingRound | null>;
  readonly readBroadcastRelease: (roundId: string) => Promise<BroadcastRelease>;
  readonly readFloorIntervals: (
    roundId: string,
  ) => Promise<readonly FloorInterval[]>;
  /** The WATCH-8 subscription entitlement: read here, granted there. */
  readonly holdsRecordingDownload: (userId: string) => Promise<boolean>;
};
