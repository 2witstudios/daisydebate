import type { AttendanceRefusal } from './attendance';
import type { CaptureRefusal } from './capture-refusal';
import type { RoomRefusal } from './room-contract';
import type { RoundRefusal } from './round-command';

/**
 * A Round's panel completion and its maintenance; never sent to a client. They
 * also read Attendance's `attendance-terminal` and Round's `attendance-unsettled`.
 */
type RoundCompletionRefusal = 'panel-ineligible';
/** Expected media backpressure: a retryable 503 that needs no one to look. */
type RoundMediaRefusal = 'media-deferred';

/** A report its reporter may not make (WATCH-7). */
type ReportRefusal = 'report-not-eligible';
/** Audience interaction an account may not make right now (SPECT-1.4). */
type AudienceRefusal =
  | 'chat-unavailable'
  | 'chat-closed'
  | 'chat-banned'
  | 'chat-live-room'
  | 'chat-slow-mode'
  | 'audience-needs-username'
  | 'reactions-unavailable'
  | 'reactions-closed'
  | 'reactions-banned'
  | 'reactions-live-room'
  | 'follow-unavailable'
  | 'account-restricted';

/**
 * Every word an `AppError` may carry as its `reason`: code branches on these
 * closed words, never on a message, which stays free text for a person.
 */
export type RefusalReason =
  | AttendanceRefusal
  | CaptureRefusal
  | ReportRefusal
  | AudienceRefusal
  | RoomRefusal
  | RoundCompletionRefusal
  | RoundMediaRefusal
  | RoundRefusal;
