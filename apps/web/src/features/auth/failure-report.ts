import { AsyncLocalStorage } from 'node:async_hooks';
import {
  isReportedCapacityRefusal,
  isCapacityRefusal,
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
  if (!isCapacityRefusal(error))
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

const heardRefusal = new AsyncLocalStorage<{ refusal?: unknown }>();
/**
 * Better Auth logs a session read's refusal and rethrows a bare error without
 * its cause, so its logger is the only place left to hear it. This fails the
 * read with the refusal itself, so a caller can tell work that never ran.
 */
export function keepingRefusal<T>(read: () => Promise<T>): Promise<T> {
  const heard: { refusal?: unknown } = {};
  return heardRefusal.run(heard, async () => {
    try {
      return await read();
    } catch (error) {
      throw heard.refusal ?? error;
    }
  });
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
    const refusal = details.find(isCapacityRefusal);
    const heard = heardRefusal.getStore();
    if (heard && refusal !== undefined) heard.refusal = refusal;
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
