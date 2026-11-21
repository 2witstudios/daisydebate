import { attendanceEnvelopeSchema } from '@daisy/protocol';
import { parseValidated, readJson } from '../../server/http';

/** The check-in command: a JSON envelope, never a body principal. */
export async function readAttendanceCommand(request: Request) {
  return {
    envelope: parseValidated(
      attendanceEnvelopeSchema,
      await readJson(request, 1024),
    ),
  };
}
