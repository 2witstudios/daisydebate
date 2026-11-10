import type { AttendanceRefusal } from './attendance';
import type { BillingEconomicsRefusal } from './billing-economics';
import type { CaptureRefusal } from './capture-refusal';
import type { RoomRefusal } from './room-contract';
import type { RoomInvitationRefusal } from './room-invitations';
import type { RoundRefusal } from './round-command';

/**
 * A Round's panel completion and its maintenance; never sent to a client. They
 * also read Attendance's `attendance-terminal` and Round's `attendance-unsettled`.
 */
type RoundCompletionRefusal = 'panel-ineligible';
/** Expected media backpressure: a retryable 503 that needs no one to look. */
type RoundMediaRefusal = 'media-deferred' | 'bot-room-changed';
/** A bot's transcript is authored, never captured (ADR 0122). */
type TranscriptRefusal = 'bot-authored';

/**
 * A web instance's maintenance authority lapsed: its own service lease is not
 * current. Internal to workers, never sent to a client; it usually clears on
 * the next renewal (DAISY-WEB-9).
 */
type ServiceAuthorityRefusal = 'service-lease-lapsed';

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
  | BillingEconomicsRefusal
  | TranscriptRefusal
  | CaptureRefusal
  | ReportRefusal
  | AudienceRefusal
  | RoomRefusal
  | RoomInvitationRefusal
  | RoundCompletionRefusal
  | RoundMediaRefusal
  | RoundRefusal
  | ServiceAuthorityRefusal;
