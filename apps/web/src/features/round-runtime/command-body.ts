import { roundCommandFields } from './command-fields';
import { createAppError } from '@daisy/errors';
import { parseValidated, readBytes, readJson } from '../../server/http';
import { roundCommandEnvelopeSchema } from '@daisy/protocol';

/** The native form is a flat encoding of the same envelope, with no actor fields. */
export async function readRoundCommand(request: Request, maxBytes: number) {
  const native =
    request.headers
      .get('content-type')
      ?.startsWith('application/x-www-form-urlencoded') === true;
  if (!native)
    return {
      native,
      envelope: parseValidated(
        roundCommandEnvelopeSchema,
        await readJson(request, maxBytes),
      ),
    };
  const params = new URLSearchParams(
    new TextDecoder().decode(await readBytes(request, maxBytes)),
  );
  const envelope = roundCommandFields(params);
  if (!envelope) throw createAppError('VALIDATION');
  return { native, envelope };
}
