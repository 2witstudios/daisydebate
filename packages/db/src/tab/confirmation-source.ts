import { fixtureCommandEnvelopeSchema } from '@daisy/protocol/lobby/fixture-command';
import { resultCommandEnvelopeSchema } from '@daisy/protocol/lobby/result-command';
import { confirmationCommandEnvelopeSchema } from '@daisy/protocol/lobby/confirmation-command';
import { createAppError } from '@daisy/errors';
import type { pendingCommands } from '../schema/conflicts';

/** Reparse the persisted original envelope; JSONB key order never becomes command identity. */
export function confirmationSource(row: typeof pendingCommands.$inferSelect) {
  const envelope = {
    version: 1,
    commandId: row.commandId,
    expected: row.expected,
    command: row.payload,
  };
  const fixture = fixtureCommandEnvelopeSchema.safeParse(envelope);
  if (fixture.success && fixture.data.command.type === row.type)
    return { kind: 'fixture' as const, envelope: fixture.data };
  const result = resultCommandEnvelopeSchema.safeParse(envelope);
  if (
    result.success &&
    'fixtureId' in result.data.command &&
    result.data.command.type === row.type
  )
    return {
      kind: 'result' as const,
      envelope: { ...result.data, command: result.data.command },
    };
  const waiver = confirmationCommandEnvelopeSchema.safeParse(envelope);
  if (
    waiver.success &&
    waiver.data.command.type === 'request-conflict-waiver' &&
    row.type === waiver.data.command.type
  )
    return {
      kind: 'waiver' as const,
      envelope: { ...waiver.data, command: waiver.data.command },
    };
  throw createAppError('INVARIANT', 'Stored confirmation source is invalid');
}
