import type { RoundTimeSource } from './round-execution-time';
import { attendanceTimingPolicy } from '@daisy/protocol';
import {
  createAttendanceOperations,
  type AttendanceTransaction,
} from './attendance-operations';
import { createAttendanceEvaluator } from './attendance-evaluator';
import {
  checkInAttemptLifecycle,
  reconcileCheckInAttempts,
} from './check-in-attempts';
import { verifyBotWorkerPrincipalLocked } from './bot-publication';
import type { BoundedTransaction } from './bounded-transaction';

/** Shares the existing writer/watchdog admission counter and pool with transcript work. */
export function attendanceEntrypoints(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly roundTime?: RoundTimeSource | undefined;
}) {
  const transaction: AttendanceTransaction = (work, attempt) => {
    const lifecycle = attempt
      ? checkInAttemptLifecycle(attempt, input.roundTime)
      : undefined;
    return input.run(
      (tx, _signal, metadata) => {
        lifecycle?.requireRound();
        return work(
          tx,
          lifecycle
            ? { ...metadata, receivedAt: lifecycle.receiptTime() }
            : metadata,
        );
      },
      {
        executionMs: attendanceTimingPolicy.transactionSliceMs,
        ...(lifecycle ? { lifecycle } : {}),
      },
    );
  };
  return {
    ...createAttendanceOperations({
      transaction,
      roundTime: input.roundTime,
      nextAttemptId: input.nextId,
      verifyWorker: verifyBotWorkerPrincipalLocked,
    }),
    evaluateRoundAttendance: createAttendanceEvaluator(
      transaction,
      input.roundTime,
    ),
    reconcileRoundCheckInAttempts: (limit: number) =>
      transaction((tx) => reconcileCheckInAttempts(tx, limit)),
  };
}
export type AttendanceStore = ReturnType<typeof createAttendanceOperations>;
export type AttendanceEvaluator = ReturnType<typeof createAttendanceEvaluator>;
