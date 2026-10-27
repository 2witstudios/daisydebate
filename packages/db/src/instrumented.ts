import { isAppError, type ErrorCode } from '@daisy/errors';
import {
  isTransactionCapacityRefusal,
  markCapacityRefusalReported,
} from './transaction-admission';

export type DatabaseEventSink = (
  event:
    'db.query.failed' | 'db.capacity.refused' | 'realtime.outbox.actor_missing',
  fields: Readonly<Record<string, unknown>>,
  message: string,
) => void;

/**
 * The one failure wrapper every area operation runs through (ISSUE-8 AC2):
 * runs `fn`, and on rejection reports `operation` to `eventSink` as
 * `db.capacity.refused` for refused-unrun work or `db.query.failed` for
 * failures, before rethrowing unchanged. A domain answer (a minted refusal
 * such as CONFLICT or NOT_FOUND) is not a database failure and reports
 * nothing (ISSUE-555). Replaces the
 * `try { … } catch { reportFailure(op); throw }` block that used to be
 * copied into every operation across the package.
 */
export async function instrumented<T>(
  eventSink: DatabaseEventSink | undefined,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isDomainRefusal(error)) throw error;
    const refused = isTransactionCapacityRefusal(error);
    if (refused && eventSink) markCapacityRefusalReported(error);
    eventSink?.(
      refused ? 'db.capacity.refused' : 'db.query.failed',
      { operation },
      refused
        ? 'Database admission refused unrun work'
        : 'Database query failed',
    );
    throw error;
  }
}

/** Every code decides explicitly: a new protocol code must be classified here. */
const codeKinds: Readonly<Record<ErrorCode, 'answer' | 'failure'>> = {
  VALIDATION: 'answer',
  AUTHENTICATION: 'answer',
  AUTHORIZATION: 'answer',
  NOT_FOUND: 'answer',
  CONFLICT: 'answer',
  PAYLOAD_TOO_LARGE: 'answer',
  RATE_LIMIT: 'answer',
  INVARIANT: 'failure',
  INFRASTRUCTURE: 'failure',
  INTERNAL: 'failure',
};
const isDomainRefusal = (error: unknown) =>
  isAppError(error) && codeKinds[error.code] === 'answer';
