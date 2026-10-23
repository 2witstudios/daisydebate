/**
 * The capture worker's per-clip deadlines and the server windows derived from
 * them (CAP-E.1-r8). The worker, the capture admission rule and the transcript
 * cutoff all read these; nothing restates the numbers.
 */
/** The worker's fresh history read before transcribing a clip. */
export const CAPTURE_HISTORY_READ_MS = 500;
/** The speech-to-text call's own timeout. */
export const CAPTURE_STT_TIMEOUT_MS = 60_000;
/** Each signed worker call, an append included. */
export const CAPTURE_CALL_DEADLINE_MS = 3_000;
/**
 * The latest a clip's append can arrive after its audio: history read,
 * transcription, then the append and its one retry. A clip delayed further by
 * queueing behind others is refused, and its stream seals partial.
 */
export const CAPTURE_STT_LAG_MS =
  CAPTURE_HISTORY_READ_MS +
  CAPTURE_STT_TIMEOUT_MS +
  2 * CAPTURE_CALL_DEADLINE_MS;
/** Captured text is admitted until this long after the final played end; it covers the lag. */
export const TRANSCRIPT_ADMISSION_WINDOW_MS = 120_000;
