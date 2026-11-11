import type { BallotDebaters } from '../judge/ballot';
import {
  idSchema,
  roundBallotReceiptSchema,
  type RoundBallotReceipt,
} from '@daisy/protocol';
import {
  blankFields,
  formFields,
  refused,
  unacknowledged,
  type FormFields,
  type Idle,
  type Moved,
  type Refused,
  type Unacknowledged,
} from '../forms/form-state';
import { ballotFields } from './fields';

/** The ballot is recorded: the receipt is the acknowledgement. */
type BallotRecorded = {
  readonly kind: 'recorded';
  readonly receipt: RoundBallotReceipt;
};
/** A ballot form's answer; a lost acknowledgement keeps the original ballot for its retry. */
export type RoundBallotFormState =
  Idle | Refused | BallotRecorded | Unacknowledged | Moved;

const recorded = (receipt: RoundBallotReceipt): BallotRecorded => ({
  kind: 'recorded',
  receipt,
});
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export const ballotUnavailable = (form: FormData): RoundBallotFormState =>
  unacknowledged(form);

const unacknowledgedText =
  'The ballot is not acknowledged. Retry the original ballot to find out whether it was recorded.';

/** What the ballot's fields render from each answer. */
export function ballotFormFields(answer: RoundBallotFormState): FormFields {
  switch (answer.kind) {
    case 'unacknowledged':
      return { values: answer.values, error: unacknowledgedText };
    case 'recorded':
      return blankFields;
    case 'idle':
    case 'refused':
    case 'moved':
      return formFields(answer);
  }
}
/** The same strict API boundary before hydration, without JavaScript and with enhanced retry. */
export async function submitRoundBallotForm(
  fetch: FetchLike,
  roundId: string,
  form: FormData,
  debaters?: BallotDebaters,
): Promise<RoundBallotFormState> {
  const parsed = ballotFields(form, true, debaters);
  if (!parsed.ok) return refused(form, parsed.error);
  if (!idSchema.safeParse(roundId).success)
    return refused(
      form,
      'This Round is invalid. Return to Judge and refresh your assignments.',
    );
  try {
    const response = await fetch(`/api/rounds/${roundId}/ballots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.envelope),
    });
    if (response.status >= 500) return ballotUnavailable(form);
    if (!response.ok) return await ballotRefusal(response, form);
    const body = await response.json();
    const receipt = roundBallotReceiptSchema.safeParse(body.receipt);
    if (!receipt.success) return ballotUnavailable(form);
    const accepted = receipt.data;
    const expected = {
      commandId: parsed.envelope.commandId,
      roundId,
      judgeParticipantId: parsed.envelope.judgeParticipantId,
      freezeRevision: parsed.envelope.freezeRevision,
    };
    if (
      Object.entries(expected).some(
        ([key, value]) => accepted[key as keyof typeof expected] !== value,
      )
    )
      return ballotUnavailable(form);
    return recorded(accepted);
  } catch {
    return ballotUnavailable(form);
  }
}
async function ballotRefusal(
  response: Response,
  form: FormData,
): Promise<RoundBallotFormState> {
  let error =
    'The server refused this ballot. Your entries are kept. Refresh your assignment before trying again.';
  if (response.status === 409) {
    const body = await response.json();
    error =
      body.refusal === 'attendance-unsettled'
        ? 'Not recorded yet: attendance for the last speeches is still being confirmed. Your entries are kept; submit again in a few seconds.'
        : 'The Round changed or a ballot is already recorded. Your entries are kept. Refresh before trying again.';
  }
  return refused(form, error);
}
