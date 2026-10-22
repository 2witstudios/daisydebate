import { roundCommandEnvelopeSchema } from '@daisy/protocol';
/** Strict flat form encoding; server-action metadata never becomes command authority. */
function collectFields(
  entries: Iterable<readonly [string, unknown]>,
  serverAction = false,
) {
  const fields: Record<string, unknown> = {};
  const allowed = [
    'version',
    'commandId',
    'expectedVersion',
    'type',
    'participantId',
  ];
  for (const [key, value] of entries) {
    if (serverAction && (key.startsWith('$ACTION_') || key === 'confirmed'))
      continue;
    if (!allowed.includes(key) || key in fields || typeof value !== 'string')
      return null;
    fields[key] = value;
  }
  return fields;
}
export function roundCommandFields(
  entries: Iterable<readonly [string, unknown]>,
  serverAction = false,
) {
  const fields = collectFields(entries, serverAction);
  if (!fields) return null;
  const integer = (name: string) =>
    typeof fields[name] === 'string' && /^[1-9][0-9]*$/.test(fields[name])
      ? Number(fields[name])
      : NaN;
  const parsed = roundCommandEnvelopeSchema.safeParse({
    version: integer('version'),
    commandId: fields.commandId,
    expectedVersion: integer('expectedVersion'),
    command: {
      type: fields.type,
      ...(fields.participantId !== undefined
        ? { participantId: fields.participantId }
        : {}),
    },
  });
  return parsed.success ? parsed.data : null;
}
