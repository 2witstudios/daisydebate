/**
 * How long after a capture session ends or turns unsafe speech-to-text output
 * for earlier audio may still be admitted (CAP-E.1-r8). Matches the transcript
 * admission window after the final played end.
 */
export const CAPTURE_STT_LAG_MS = 120_000;
