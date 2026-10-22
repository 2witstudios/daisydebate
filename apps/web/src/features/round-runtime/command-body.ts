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
  const allowed = [
    'version',
    'commandId',
    'expectedVersion',
    'type',
    'participantId',
  ];
  if (
    [...params.keys()].some((key) => !allowed.includes(key)) ||
    new Set(params.keys()).size !== [...params.keys()].length
  )
    throw createAppError('VALIDATION');
  const numberOf = (name: string) =>
    /^[1-9][0-9]*$/.test(params.get(name) ?? '')
      ? Number(params.get(name))
      : NaN;
  return {
    native,
    envelope: parseValidated(roundCommandEnvelopeSchema, {
      version: numberOf('version'),
      commandId: params.get('commandId'),
      expectedVersion: numberOf('expectedVersion'),
      command: {
        type: params.get('type'),
        ...(params.has('participantId')
          ? { participantId: params.get('participantId') }
          : {}),
      },
    }),
  };
}
