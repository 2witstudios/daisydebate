import { createAppError, isAppError } from '@daisy/errors';
import { captureRefusalSchema, type CaptureRefusal } from '@daisy/protocol';
import { z } from 'zod';

const namedRefusalReply = z.object({ refusal: captureRefusalSchema });

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
/** The capture refusal a 409 named. */
const namedRefusals = new WeakMap<object, CaptureRefusal>();
const namedRefusal = (error: unknown) =>
  typeof error === 'object' && error !== null
    ? namedRefusals.get(error)
    : undefined;
/** Whether the server closed the capture for good: the session ends (ISSUE-494). */
export const isCaptureClosedRefusal = (error: unknown) =>
  namedRefusal(error) === 'capture-closed';
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
/**
 * Whether the control plane may still answer: its outcome is unknown, or the
 * server refused only for now. A named refusal or any other code is an answer.
 */
export const isTransientControlFailure = (error: unknown) =>
  isAppError(error) &&
  error.code === 'INFRASTRUCTURE' &&
  !isDefiniteRefusal(error);
/** Whether a seal may be resent: its timeline was still open (VIDEO-4.1-r1). */
export const isOpenTimelineRefusal = (error: unknown) =>
  namedRefusal(error) === 'timeline-open';
/** Throws the refusal; a 409's closed capture word is read, never anything else. */
export async function refuse(
  response: Response,
  signal: AbortSignal,
  caller?: AbortSignal,
): Promise<never> {
  let named: CaptureRefusal | undefined;
  if (response.status === 409)
    named = await readReply(response, signal, caller).then(
      (raw) => namedRefusalReply.safeParse(raw).data?.refusal,
      () => undefined,
    );
  else await response.body?.cancel().catch(() => undefined);
  const error = refusalFor(response.status);
  if (definiteStatus(response.status)) definite.add(error);
  if (named) namedRefusals.set(error, named);
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
