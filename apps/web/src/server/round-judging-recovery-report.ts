import type { Logger } from '@daisy/logger';
import type { JudgingRecoveryReason } from '@daisy/protocol';

/** A durable pause is a work state, not a terminal failure or a raw provider error. */
export function reportJudgingRecovery(
  logger: Pick<Logger, 'log'>,
  cause: JudgingRecoveryReason,
) {
  try {
    logger.log(
      'round.judging.recovery_pending',
      { operation: 'round.judging.execute', cause },
      'Judging recovery remains pending',
    );
  } catch {
    // Reporting cannot change the already committed recovery obligation.
  }
}
