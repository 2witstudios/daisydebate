import { isAppError, type ErrorCode } from '@daisy/errors';

/**
 * Where a capture process failed (ISSUE-571). The child's only channel back
 * to its worker is its exit status, so a failure is encoded as one of a fixed
 * set of stage and error-code pairs: never a raw error, PCM or text.
 */
export const CAPTURE_FAILURE_STAGES = [
  'configuration',
  'lease',
  'history',
  'token',
  'connect',
  'renewal',
  'refresh',
  'batch',
  'seal',
  'transcription',
  'shutdown',
  /** Not tagged with a stage: a bug in the session's own code. */
  'session',
] as const;
export type CaptureFailureStage = (typeof CAPTURE_FAILURE_STAGES)[number];

const codeIndex: Readonly<Record<ErrorCode, number>> = {
  VALIDATION: 0,
  AUTHENTICATION: 1,
  AUTHORIZATION: 2,
  NOT_FOUND: 3,
  CONFLICT: 4,
  PAYLOAD_TOO_LARGE: 5,
  INVARIANT: 6,
  RATE_LIMIT: 7,
  INFRASTRUCTURE: 8,
  INTERNAL: 9,
};
const codes = Object.keys(codeIndex) as ErrorCode[];
/** Statuses 8 to 127: below the 128 + n a signal produces, above the reserved ones. */
const STAGED_EXIT_BASE = 8;
/** An exception or rejection nothing awaited, which Bun would report as a bare 1. */
export const CAPTURE_UNCAUGHT_EXIT = 4;

const stages = new WeakMap<object, CaptureFailureStage>();
/** Marks an error with the stage it failed in; the innermost stage is kept. */
export function tagCaptureFailure(stage: CaptureFailureStage, error: unknown) {
  if (typeof error === 'object' && error !== null && !stages.has(error))
    stages.set(error, stage);
  return error;
}
/** Runs one stage of the session, tagging what it throws. */
export const atStage = <T>(
  stage: CaptureFailureStage,
  work: Promise<T>,
): Promise<T> =>
  work.catch((error: unknown) => {
    throw tagCaptureFailure(stage, error);
  });
/** The first tagged error on the error's cause chain (bounded), if any. */
function taggedFailure(error: unknown) {
  for (let at = error, depth = 0; depth < 8; depth++) {
    if (typeof at !== 'object' || at === null) return undefined;
    if (stages.has(at)) return at;
    at = (at as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * The exit status for a failure: the stage and error code of the first
 * tagged error on its cause chain, or `otherwise` and its own code.
 */
export function captureFailureExit(
  error: unknown,
  otherwise: CaptureFailureStage = 'session',
) {
  const tagged = taggedFailure(error);
  const stage = tagged ? stages.get(tagged)! : otherwise;
  const source = tagged ?? error;
  const code = isAppError(source) ? source.code : 'INTERNAL';
  return (
    STAGED_EXIT_BASE +
    CAPTURE_FAILURE_STAGES.indexOf(stage) * codes.length +
    codeIndex[code]
  );
}

/** What the worker may log about a failed capture process's exit status. */
export function describeCaptureExit(status: number): {
  readonly cause: CaptureFailureStage | 'uncaught' | 'signal' | 'unknown';
  readonly errorCode?: ErrorCode;
} {
  if (status === CAPTURE_UNCAUGHT_EXIT) return { cause: 'uncaught' };
  if (status > 128 && status < 160) return { cause: 'signal' };
  const offset = status - STAGED_EXIT_BASE;
  const stage = CAPTURE_FAILURE_STAGES[Math.floor(offset / codes.length)];
  if (!Number.isSafeInteger(status) || offset < 0 || !stage)
    return { cause: 'unknown' };
  return { cause: stage, errorCode: codes[offset % codes.length]! };
}
