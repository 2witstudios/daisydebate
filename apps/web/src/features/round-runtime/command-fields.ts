import { roundCommandEnvelopeSchema } from '@daisy/protocol';
import { collectRoundFormFields, positiveFormInteger } from './posted-fields';
/** The server action's flat form encoding of the command envelope. */
export function roundCommandFields(
  entries: Iterable<readonly [string, unknown]>,
) {
  const fields = collectRoundFormFields(
    entries,
    ['version', 'commandId', 'expectedVersion', 'type', 'participantId'],
    true,
    ['confirmed'],
  );
  if (!fields) return null;
  const parsed = roundCommandEnvelopeSchema.safeParse({
    version: positiveFormInteger(fields.version),
    commandId: fields.commandId,
    expectedVersion: positiveFormInteger(fields.expectedVersion),
    command: {
      type: fields.type,
      ...(fields.participantId !== undefined
        ? { participantId: fields.participantId }
        : {}),
    },
  });
  return parsed.success ? parsed.data : null;
}
