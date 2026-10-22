import { createAppError } from '@daisy/errors';
import { createRoundBotAdmission } from './round-bot-admission';
import type { BoundedTransaction } from './bounded-transaction';
type Reservation = Parameters<
  ReturnType<typeof createRoundBotAdmission>['markFirstModelCall']
>[0];

/** One configured admission resource serves Room freeze, worker usage and host status. */
export function roundBotAdmissionEntrypoints(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly busyCap: number | undefined;
}) {
  const admission =
    input.busyCap === undefined
      ? undefined
      : createRoundBotAdmission({ ...input, busyCap: input.busyCap });
  const configured = () => {
    if (!admission)
      throw createAppError('INFRASTRUCTURE', 'Bot admission is not configured');
    return admission;
  };
  return {
    admission,
    operations: {
      readRoundBotAdmissionStatus: async (actorId: string) =>
        admission ? admission.readStatus(actorId) : null,
      reserveRoundBotUsage: (target: Omit<Reservation, 'id'>) =>
        configured().reserve(target),
      markRoundBotModelCall: (reservation: Reservation) =>
        configured().markFirstModelCall(reservation),
      refundRoundBotVendorFailure: (reservation: Reservation) =>
        configured().refundVendorFailure(reservation),
    },
  };
}
