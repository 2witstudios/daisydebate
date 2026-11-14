import { roundBallotEnvelopeSchema } from '@daisy/protocol';
import { ballotFieldNames, parseBallot } from '../judge/ballot';
import type { BallotPlan } from '../judge/ballot-plan';
import {
  collectRoundFormFields,
  positiveFormInteger,
} from '../round-runtime/posted-fields';

const envelopeFields = [
  'version',
  'commandId',
  'expectedVersion',
  'judgeParticipantId',
  'freezeRevision',
];
/**
 * The native form encodes exactly the shared JSON envelope; no identity or
 * outcome claims. Its fields are the Round's own ballot plan's.
 */
export function ballotFields(
  entries: Iterable<readonly [string, unknown]>,
  plan: BallotPlan,
  serverAction = false,
) {
  const allowed = [...envelopeFields, ...ballotFieldNames(plan)];
  const fields = collectRoundFormFields(entries, allowed, serverAction);
  if (!fields)
    return {
      ok: false as const,
      error:
        'This ballot contains invalid or repeated fields. Reload and try again.',
    };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const parsed = parseBallot(form, plan);
  if (!parsed.ok) return parsed;
  const result = roundBallotEnvelopeSchema.safeParse({
    version: positiveFormInteger(fields.version),
    commandId: fields.commandId,
    expectedVersion: positiveFormInteger(fields.expectedVersion),
    judgeParticipantId: fields.judgeParticipantId,
    freezeRevision: positiveFormInteger(fields.freezeRevision),
    ballot: parsed.value.ballot,
  });
  return result.success
    ? { ok: true as const, envelope: result.data }
    : {
        ok: false as const,
        error: 'The ballot input changed. Refresh the Round before submitting.',
      };
}
