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
  const transaction: AttendanceTransaction = (work, attempt) =>
    input.run((tx, _signal, metadata) => work(tx, metadata), {
      executionMs: attendanceTimingPolicy.transactionSliceMs,
      ...(attempt ? { lifecycle: checkInAttemptLifecycle(attempt) } : {}),
    });
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
