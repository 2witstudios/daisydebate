import { assert } from 'riteway/bun';
import { isAppError, type ErrorCode } from './index';

/**
 * Test support for expected failures (ISSUE-11). A bare `.toThrow()` passes
 * on any stray `TypeError`; these read the factory-minted code instead, so a
 * test names the refusal it expects and fails on every other outcome.
 */

type Rejection =
  | { readonly code: ErrorCode; readonly invariantId?: string }
  | { readonly code: 'NOT_APP_ERROR'; readonly name: string }
  | { readonly code: 'NO_REJECTION' };

/** How `actual` settled: its app-error code, a stray error's name, or none. */
export async function rejectionOf(actual: () => unknown): Promise<Rejection> {
  try {
    await actual();
    return { code: 'NO_REJECTION' };
  } catch (error) {
    if (!isAppError(error))
      return {
        code: 'NOT_APP_ERROR',
        name: error instanceof Error ? error.name : typeof error,
      };
    return error.invariantId === undefined
      ? { code: error.code }
      : { code: error.code, invariantId: error.invariantId };
  }
}

/**
 * Asserts that `actual` throws or rejects with an app error of `code`, and,
 * when named, of exactly `message` (for a refusal a caller maps by message).
 */
export async function assertRejects({
  given,
  should,
  actual,
  code,
  invariantId,
  message,
}: {
  readonly given: string;
  readonly should: string;
  readonly actual: () => unknown;
  readonly code: ErrorCode;
  readonly invariantId?: string;
  readonly message?: string;
}): Promise<void> {
  let thrown: unknown;
  const rejection = await rejectionOf(async () => {
    try {
      await actual();
    } catch (error) {
      thrown = error;
      throw error;
    }
  });
  assert({
    given,
    should,
    actual:
      message === undefined
        ? rejection
        : {
            ...rejection,
            message: isAppError(thrown) ? thrown.message : undefined,
          },
    expected: {
      code,
      ...(invariantId === undefined ? {} : { invariantId }),
      ...(message === undefined ? {} : { message }),
    },
  });
}
