import { createAppError } from '@daisy/errors';
import { roundBallotEnvelopeSchema } from '@daisy/protocol';
import { parseValidated, readBytes, readJson } from '../../server/http';
import { ballotFields } from './fields';
export async function readRoundBallotBody(request: Request, maxBytes: number) {
  const native =
    request.headers
      .get('content-type')
      ?.startsWith('application/x-www-form-urlencoded') === true;
  if (!native)
    return {
      native,
      envelope: parseValidated(
        roundBallotEnvelopeSchema,
        await readJson(request, maxBytes),
      ),
    };
  const parsed = ballotFields(
    new URLSearchParams(
      new TextDecoder().decode(await readBytes(request, maxBytes)),
    ),
  );
  if (!parsed.ok) throw createAppError('VALIDATION');
  return { native, envelope: parsed.envelope };
}
