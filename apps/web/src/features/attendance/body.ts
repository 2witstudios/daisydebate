import { createAppError } from '@daisy/errors';
import { attendanceEnvelopeSchema } from '@daisy/protocol';
import { parseValidated, readBytes, readJson } from '../../server/http';

/** Explicit native POST encodes exactly the same command, never a body principal. */
export async function readAttendanceCommand(request: Request) {
  const native =
    request.headers
      .get('content-type')
      ?.startsWith('application/x-www-form-urlencoded') === true;
  if (!native)
    return {
      native,
      envelope: parseValidated(
        attendanceEnvelopeSchema,
        await readJson(request, 1024),
      ),
    };
  const fields = new URLSearchParams(
    new TextDecoder().decode(await readBytes(request, 1024)),
  );
  const keys = [...fields.keys()];
  if (
    keys.length !== 3 ||
    new Set(keys).size !== 3 ||
    fields.get('version') !== '1'
  )
    throw createAppError('VALIDATION');
  const raw = Object.fromEntries(fields);
  return {
    native,
    envelope: parseValidated(attendanceEnvelopeSchema, { ...raw, version: 1 }),
  };
}
