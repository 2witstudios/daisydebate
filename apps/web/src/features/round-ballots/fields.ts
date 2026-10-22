import { ballotCategories, roundBallotEnvelopeSchema } from '@daisy/protocol';
import { parseBallot, scoreField, feedbackField } from '../judge/ballot';
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
const allowed = [
  ...envelopeFields,
  'winner',
  'reason',
  'low-point',
  ...['affirmative', 'negative'].flatMap((side) => [
    feedbackField(side as 'affirmative' | 'negative'),
    ...ballotCategories.map((category) =>
      scoreField(side as 'affirmative' | 'negative', category),
    ),
  ]),
];
/** The native form encodes exactly the shared JSON envelope; no identity or outcome claims. */
export function ballotFields(
  entries: Iterable<readonly [string, unknown]>,
  serverAction = false,
) {
  const fields = collectRoundFormFields(entries, allowed, serverAction);
  if (!fields)
    return {
      ok: false as const,
      error:
        'This ballot contains invalid or repeated fields. Reload and try again.',
    };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const parsed = parseBallot(form, {
    affirmative: { name: 'Affirmative' },
    negative: { name: 'Negative' },
  });
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
