import type { AttendanceRefusal } from './attendance';
import type { CaptureRefusal } from './capture-refusal';
import type { RoomRefusal } from './room-contract';
import type { RoundRefusal } from './round-command';

/**
 * A Round's panel completion and its maintenance; never sent to a client. They
 * also read Attendance's `attendance-terminal` and Round's `attendance-unsettled`.
 */
type RoundCompletionRefusal =
  'panel-ineligible' | 'panel-projection' | 'panel-receipt-conflict';
/** A Round that cannot be rated yet; its rating pass tries again. */
type RatingRefusal = 'rating-input-not-finalized';
/** Expected media backpressure: a retryable 503 that needs no one to look. */
type RoundMediaRefusal = 'media-deferred';

/**
 * Every word an `AppError` may carry as its `reason`: code branches on these
 * closed words, never on a message, which stays free text for a person.
 */
export type RefusalReason =
  | AttendanceRefusal
  | CaptureRefusal
  | RatingRefusal
  | RoomRefusal
  | RoundCompletionRefusal
  | RoundMediaRefusal
  | RoundRefusal;
