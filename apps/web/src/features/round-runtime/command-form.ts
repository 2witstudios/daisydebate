import { z } from 'zod';
import { idSchema, roundViewSchema, type RoundView } from '@daisy/protocol';
import {
  blankFields,
  formFields,
  formValues,
  refused,
  refusedWith,
  unacknowledged,
  type FormFields,
  type FormValues,
  type Idle,
  type Moved,
  type Refused,
  type Unacknowledged,
} from '../forms/form-state';
import { roundCommandFields } from './command-fields';

/** Yield and forfeit ask once more: `values` are the press to confirm. */
type RoundConfirming = {
  readonly kind: 'confirming';
  readonly values: FormValues;
};
/** The Round took the command and answered with the view it leads to. */
type RoundAcknowledged = {
  readonly kind: 'acknowledged';
  readonly view: RoundView;
};
/** A Round command's answer; a lost acknowledgement keeps the original envelope for its retry. */
export type RoundFormState =
  Idle | Refused | RoundConfirming | RoundAcknowledged | Unacknowledged | Moved;

const unacknowledgedText =
  'The command is not acknowledged. Review the current round before trying again.';

/** What a Round command's controls render from each answer. */
export function roundFormFields(answer: RoundFormState): FormFields {
  switch (answer.kind) {
    case 'unacknowledged':
      return { values: answer.values, error: unacknowledgedText };
    case 'confirming':
      return { values: answer.values, error: undefined };
    case 'acknowledged':
      return blankFields;
    case 'idle':
    case 'refused':
    case 'moved':
      return formFields(answer);
  }
}
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
const responseSchema = z.strictObject({
  receipt: z.strictObject({
    commandId: idSchema,
    roundId: idSchema,
    resultingVersion: z.int().positive(),
    replayed: z.boolean(),
  }),
  view: roundViewSchema,
});
export const roundCommandUnavailable = (form: FormData): RoundFormState =>
  unacknowledged(form);
function acceptedView(
  body: unknown,
  roundId: string,
  commandId: string,
): RoundView | null {
  const parsed = responseSchema.safeParse(body);
  if (
    !parsed.success ||
    parsed.data.receipt.commandId !== commandId ||
    parsed.data.receipt.roundId !== roundId ||
    parsed.data.view.id !== roundId ||
    parsed.data.view.version < parsed.data.receipt.resultingVersion
  )
    return null;
  return parsed.data.view;
}
/** Same canonical JSON boundary; an unacknowledged attempt keeps its original envelope for replay. */
export async function submitRoundForm(
  fetch: FetchLike,
  roundId: string,
  form: FormData,
): Promise<RoundFormState> {
  const envelope = roundCommandFields(form);
  if (!idSchema.safeParse(roundId).success || !envelope)
    return refused(
      form,
      'This round command is invalid. Reload the round and try again.',
    );
  if (
    ['yield', 'forfeit'].includes(envelope.command.type) &&
    form.get('confirmed') !== 'true'
  )
    return { kind: 'confirming', values: formValues(form) };
  try {
    const response = await fetch(`/api/rounds/${roundId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    if (response.status >= 500) return roundCommandUnavailable(form);
    if (!response.ok)
      return refusedWith(
        // A refused strike keeps its type: its explanation ends with the strike step.
        envelope.command.type === 'strike_resolution'
          ? { type: envelope.command.type }
          : {},
        response.status === 409 && envelope.command.type === 'strike_resolution'
          ? 'Someone struck first, or time ran out. Here is the draw now.'
          : response.status === 409
            ? 'The round changed or that action is no longer legal. Review the current round and try again.'
            : 'The server refused this round command. Review the current round and try again.',
      );
    const view = acceptedView(
      await response.json(),
      roundId,
      envelope.commandId,
    );
    return view
      ? { kind: 'acknowledged', view }
      : roundCommandUnavailable(form);
  } catch {
    return roundCommandUnavailable(form);
  }
}
