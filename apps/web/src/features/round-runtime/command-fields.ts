import { roundCommandEnvelopeSchema } from '@daisy/protocol';
import { collectRoundFormFields, positiveFormInteger } from './posted-fields';
/** A posted strike ordinal or position; anything else fails the envelope parse. */
const formIndex = (value: string | undefined) =>
  value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;

/** The server action's flat form encoding of the command envelope. */
export function roundCommandFields(
  entries: Iterable<readonly [string, unknown]>,
) {
  const fields = collectRoundFormFields(
    entries,
    [
      'version',
      'commandId',
      'expectedVersion',
      'type',
      'participantId',
      'ordinal',
      'position',
    ],
    true,
    ['confirmed', 'segment'],
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
      ...(fields.type === 'strike_resolution'
        ? {
            ordinal: formIndex(fields.ordinal),
            position: formIndex(fields.position),
          }
        : {}),
    },
  });
  return parsed.success ? parsed.data : null;
}
