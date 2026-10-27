import {
  isReportedCapacityRefusal,
  isTransactionCapacityRefusal,
} from '@daisy/db';
import type { Logger } from '@daisy/logger';

/**
 * One authentication failure, reported once. A capacity refusal is work
 * that never ran, not a crash: it is logged as `db.capacity.refused` unless
 * the database boundary already logged it, and never as `request.unhandled`.
 */
export function reportAuthFailure(
  logger: Logger,
  error: unknown,
  source: 'auth.after-response' | 'better-auth',
  message: string,
) {
  if (!isTransactionCapacityRefusal(error))
    logger.log('request.unhandled', { source }, message);
  else if (!isReportedCapacityRefusal(error))
    logger.log(
      'db.capacity.refused',
      { operation: source },
      'Database admission refused unrun work',
    );
}
