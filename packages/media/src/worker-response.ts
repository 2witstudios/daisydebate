import { createAppError } from '@daisy/errors';

export const unavailable = () =>
  createAppError('INFRASTRUCTURE', 'Media control is unavailable');
const cancelled = () =>
  createAppError('CONFLICT', 'Media control was cancelled');
export const aborted = (signal: AbortSignal, caller?: AbortSignal) => {
  if (caller?.aborted) throw cancelled();
  if (signal.aborted) throw unavailable();
};
/** 503 refusals the call may retry; every other failure is final. */
const refusedForNow = new WeakSet<object>();
/** Seals refused only because the capture timeline has not closed yet. */
const openTimeline = new WeakSet<object>();
/** Requests refused because the capture session or admission is closed. */
const captureClosed = new WeakSet<object>();
/** Whether the server closed the capture for good: the session ends (ISSUE-494). */
export const isCaptureClosedRefusal = (error: unknown) =>
  typeof error === 'object' && error !== null && captureClosed.has(error);
/**
 * A 4xx is a refusal for certain, except a 408 (the outcome is unknown, as in
 * the media service, ISSUE-464) and a 429 (refused for now) (VIDEO-4.1-r4).
 */
export const definiteStatus = (status: number) =>
  status >= 400 && status < 500 && status !== 408 && status !== 429;
/** Requests the server definitely refused (see definiteStatus). */
const definite = new WeakSet<object>();
/**
 * Whether the server definitely refused the request. A 408, a 429, a 503 that
 * outlasted its retries, an elapsed deadline or a network failure leaves the
 * outcome uncertain.
 */
export const isDefiniteRefusal = (error: unknown) =>
  typeof error === 'object' && error !== null && definite.has(error);
/** Whether a seal may be resent: its timeline was still open (VIDEO-4.1-r1). */
export const isOpenTimelineRefusal = (error: unknown) =>
  typeof error === 'object' && error !== null && openTimeline.has(error);
/** Throws the refusal; a 409's named refusal is read, never anything else. */
export async function refuse(
  response: Response,
  signal: AbortSignal,
  caller?: AbortSignal,
): Promise<never> {
  let named: unknown;
  if (response.status === 409)
    named = await readReply(response, signal, caller).then(
      (raw) => (raw as { refusal?: unknown } | null)?.refusal,
      () => undefined,
    );
  else await response.body?.cancel().catch(() => undefined);
  const error = refusalFor(response.status);
  if (definiteStatus(response.status)) definite.add(error);
  if (named === 'timeline-open') openTimeline.add(error);
  if (named === 'capture-closed') captureClosed.add(error);
  throw error;
}
function refusalFor(status: number) {
  if (status === 503) {
    const refusal = unavailable();
    refusedForNow.add(refusal);
    return refusal;
  }
  const codes = {
    400: 'VALIDATION',
    401: 'AUTHENTICATION',
    403: 'AUTHORIZATION',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
  } as const;
  return createAppError(
    codes[status as keyof typeof codes] ?? 'INFRASTRUCTURE',
  );
}
export async function readReply(
  response: Response,
  signal: AbortSignal,
  caller?: AbortSignal,
) {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      aborted(signal, caller);
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 1024 * 1024) throw unavailable();
      chunks.push(value);
    }
    aborted(signal, caller);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    aborted(signal, caller);
    throw unavailable();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
/** A 503 the transport may retry inside its existing deadline. */
export const isRefusedForNow = (error: unknown) =>
  typeof error === 'object' && error !== null && refusedForNow.has(error);
