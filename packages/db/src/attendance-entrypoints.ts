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
}) {
  const transaction: AttendanceTransaction = (work, attempt) => {
    const lifecycle = attempt ? checkInAttemptLifecycle(attempt) : undefined;
    return input.run(
      (tx, _signal, metadata) => {
        lifecycle?.requireRound();
        return work(tx, metadata);
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
      nextAttemptId: input.nextId,
      verifyWorker: verifyBotWorkerPrincipalLocked,
    }),
    evaluateRoundAttendance: createAttendanceEvaluator(transaction),
    reconcileRoundCheckInAttempts: (limit: number) =>
      transaction((tx) => reconcileCheckInAttempts(tx, limit)),
  };
}
export type AttendanceStore = ReturnType<typeof createAttendanceOperations>;
export type AttendanceEvaluator = ReturnType<typeof createAttendanceEvaluator>;
