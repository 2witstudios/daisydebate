import { createAppError } from '@daisy/errors';
import { readAuthorizationActors } from './authorization';
import { actorFact } from './room-command-facts';
import { seatEligibility } from './seat-eligibility';
import {
  requireAdmittedPrincipal,
  type ParticipantAdmission,
} from './participant-admission';
import type { Tx } from './tx';

/** Fresh ordinary admission for a new identity; a profile alone never makes a human eligible. */
export async function requireJudgeAssignmentAdmission(
  tx: Tx,
  input: {
    readonly actorId: string;
    readonly slot: number;
    readonly accounts: Awaited<ReturnType<typeof readAuthorizationActors>>;
    readonly admits: ParticipantAdmission;
  },
) {
  const actor = await actorFact(tx, input.actorId);
  if (
    !actor ||
    !actor.eligible ||
    !seatEligibility(actor, input.accounts, {
      actorId: input.actorId,
      seat: { kind: 'judge', slot: input.slot },
    }).eligible
  )
    throw createAppError('AUTHORIZATION');
  if (actor.kind === 'human')
    requireAdmittedPrincipal(input.admits, input.accounts, input.actorId);
  return actor;
}
