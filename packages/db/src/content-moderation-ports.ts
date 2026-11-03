import type { RecordingStatus } from '@daisy/protocol';
import type {
  RebuildableRecordings,
  recordingTakedownReasons,
} from '@daisy/protocol/content-moderation';
import type { BoundedTransactionContext } from './transaction-context';

type Tx = BoundedTransactionContext;
type RecordingTakedownReason = (typeof recordingTakedownReasons)[number];

/** A change a port made: it was applied, it already held, or no such thing. */
export type ContentModerationOutcome = 'applied' | 'unchanged' | null;

/**
 * Whose audience a report's target belongs to, for the feature's one rule: a
 * target the reporter could not reach answers as if it did not exist.
 */
export type ReportAudience = {
  readonly roundId: string;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly audienceLinkHash: string | null;
  readonly inLiveRoom: boolean;
};

/**
 * What moderation needs from Recording (WATCH-7, REC-1.5), a named port its
 * owner implements over its own tables. A takedown runs in the moderation
 * command's transaction and removes listing and delivery within
 * `CONTENT_MODERATION_DELIVERY_BOUND_MS`. Null everywhere means no such Recording.
 */
export type RecordingModeration = {
  readonly readReportFacts: (
    tx: Tx,
    input: { readonly recordingId: string; readonly reporterActorId: string },
  ) => Promise<{
    readonly ranked: boolean;
    readonly reporterSeated: boolean;
    readonly audience: ReportAudience;
  } | null>;
  readonly readSubject: (
    tx: Tx,
    recordingId: string,
  ) => Promise<{
    readonly status: RecordingStatus;
    readonly version: number;
    readonly restorable: boolean;
    readonly removable: boolean;
    readonly rebuildable: boolean;
    readonly takedownReason: RecordingTakedownReason | null;
  } | null>;
  /** Each names the version it read: one that no longer holds is a CONFLICT. */
  readonly takeDown: (
    tx: Tx,
    input: {
      readonly recordingId: string;
      readonly expectedVersion: number;
      readonly reason: RecordingTakedownReason;
      readonly now: Date;
    },
  ) => Promise<ContentModerationOutcome>;
  readonly restore: (
    tx: Tx,
    input: { readonly recordingId: string; readonly expectedVersion: number },
  ) => Promise<ContentModerationOutcome>;
  readonly remove: (
    tx: Tx,
    input: {
      readonly recordingId: string;
      readonly expectedVersion: number;
      readonly now: Date;
    },
  ) => Promise<ContentModerationOutcome>;
  /** The one removal an evidence hold does not stop. */
  readonly legallyRemove: (
    tx: Tx,
    input: {
      readonly recordingId: string;
      readonly expectedVersion: number;
      readonly now: Date;
    },
  ) => Promise<ContentModerationOutcome>;
  /** A failed ranked Recording builds again from what it captured. */
  readonly rebuild: (
    tx: Tx,
    input: { readonly recordingId: string; readonly expectedVersion: number },
  ) => Promise<ContentModerationOutcome>;
  /** Every failed ranked Recording that could: a report need not name them. */
  readonly listRebuildable: (
    tx: Tx,
    limit: number,
  ) => Promise<RebuildableRecordings['items']>;
  /** The Broadcast of the Recording's Round, whose feed a takedown also ends. */
  readonly readBroadcastId: (
    tx: Tx,
    recordingId: string,
  ) => Promise<string | null>;
};

/**
 * What moderation needs from spectator chat (WATCH-7, SPECT-1.4), the same
 * way. It reaches spectator messages only, never a DM or a private group.
 */
export type SpectatorChatModeration = {
  readonly readReportFacts: (
    tx: Tx,
    input: { readonly messageId: string; readonly reporterActorId: string },
  ) => Promise<{
    readonly ownMessage: boolean;
    readonly audience: ReportAudience;
  } | null>;
  readonly readSubject: (
    tx: Tx,
    messageId: string,
  ) => Promise<{
    readonly text: string | null;
    readonly authorUserId: string | null;
  } | null>;
  readonly remove: (
    tx: Tx,
    input: { readonly messageId: string; readonly now: Date },
  ) => Promise<ContentModerationOutcome>;
};

/** Until its owner lands, there is no Recording to report or take down. */
export const noRecordings: RecordingModeration = {
  readReportFacts: async () => null,
  readSubject: async () => null,
  takeDown: async () => null,
  restore: async () => null,
  remove: async () => null,
  legallyRemove: async () => null,
  rebuild: async () => null,
  listRebuildable: async () => [],
  readBroadcastId: async () => null,
};

/** Until its owner lands, there is no spectator message to report or remove. */
export const noSpectatorChat: SpectatorChatModeration = {
  readReportFacts: async () => null,
  readSubject: async () => null,
  remove: async () => null,
};
