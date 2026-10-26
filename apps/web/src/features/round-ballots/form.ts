import type { BallotDebaters } from '../judge/ballot';
import {
  idSchema,
  roundBallotReceiptSchema,
  type RoundBallotReceipt,
} from '@daisy/protocol';
import { formValues } from '../mock-form/form';
import { ballotFields } from './fields';
export type RoundBallotFormState = {
  readonly values: Readonly<Record<string, string>>;
  readonly error?: string;
  readonly receipt?: RoundBallotReceipt;
  readonly unacknowledged?: boolean;
  readonly next?: string;
};
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export const ballotUnavailable = (form: FormData): RoundBallotFormState => ({
  values: formValues(form),
  unacknowledged: true,
  error:
    'The ballot is not acknowledged. Retry the original ballot to find out whether it was recorded.',
});
/** The same strict API boundary before hydration, without JavaScript and with enhanced retry. */
export async function submitRoundBallotForm(
  fetch: FetchLike,
  roundId: string,
  form: FormData,
  debaters?: BallotDebaters,
): Promise<RoundBallotFormState> {
  const parsed = ballotFields(form, true, debaters);
  if (!parsed.ok) return { values: formValues(form), error: parsed.error };
  if (!idSchema.safeParse(roundId).success)
    return {
      values: formValues(form),
      error:
        'This Round is invalid. Return to Judge and refresh your assignments.',
    };
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
    return { values: {}, receipt: accepted };
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
        ? 'Attendance is still settling. Your ballot has not been recorded. Try again after refreshing the Round.'
        : 'The Round changed or a ballot is already recorded. Your entries are kept. Refresh before trying again.';
  }
  return { values: formValues(form), error };
}
