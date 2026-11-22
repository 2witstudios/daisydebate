import { createAppError } from '@daisy/errors';
import { roundBallotEnvelopeSchema } from '@daisy/protocol/round-ballot';
import { parseValidated, readBytes, readJson } from '../../server/http';
import type { BallotPlan } from '../judge/ballot-plan';
import { ballotFields } from './fields';
/**
 * A ballot body: JSON as posted, or a native form read against the Round's
 * own ballot plan, which only a native post needs.
 */
export async function readRoundBallotBody(
  request: Request,
  maxBytes: number,
  plan: () => Promise<BallotPlan>,
) {
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
    await plan(),
  );
  if (!parsed.ok) throw createAppError('VALIDATION');
  return { native, envelope: parsed.envelope };
}
