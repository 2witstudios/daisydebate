import {
  isReportedCapacityRefusal,
  isTransactionCapacityRefusal,
  markCapacityRefusalReported,
} from '@daisy/db/capacity';
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
  else if (!isReportedCapacityRefusal(error)) {
    logger.log(
      'db.capacity.refused',
      { operation: source },
      'Database admission refused unrun work',
    );
    markCapacityRefusalReported(error);
  }
}

/**
 * Better Auth's logger. Its default prints driver errors verbatim (SQL text,
 * bound tokens and emails), so only the severity reaches the application
 * logger. Better Auth's adapter is not behind `instrumented`, and some of its
 * routes log an adapter failure and carry on, so a capacity refusal it logs
 * is reported here, once, rather than dropped.
 */
export const betterAuthLogger = (logger: Logger) => ({
  log: (level: string, _message: string, ...details: unknown[]) => {
    const refusal = details.find(isTransactionCapacityRefusal);
    if (refusal !== undefined)
      reportAuthFailure(
        logger,
        refusal,
        'better-auth',
        'Authentication library reported a refusal',
      );
    else if (level === 'error' || level === 'warn')
      logger.log(
        'request.unhandled',
        { source: 'better-auth', sourceLevel: level },
        'Authentication library reported a failure',
      );
  },
});
