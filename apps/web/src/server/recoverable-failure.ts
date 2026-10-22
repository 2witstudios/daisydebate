import { isAppError } from '@daisy/errors';
import type { EventName, Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';

/**
 * A background worker's recoverable failure: the log line names the stage
 * and the error's own code; only the scrubbed reporter sees the raw error
 * (ADR 0037). An untyped error carries no trustworthy code, so it is INTERNAL.
 */
export function recoverableFailure(input: {
  readonly logger: Pick<Logger, 'log'>;
  readonly reporter: ErrorReporter;
  readonly nextId: () => string;
  readonly event: EventName;
  readonly operation: string;
  readonly message: string;
}) {
  return (error: unknown, stage: string) => {
    const operation = `${input.operation}.${stage}`;
    const errorCode = isAppError(error) ? error.code : 'INTERNAL';
    input.logger.log(input.event, { operation, errorCode }, input.message);
    input.reporter.capture(error, {
      requestId: input.nextId(),
      route: operation,
      errorCode,
    });
  };
}
