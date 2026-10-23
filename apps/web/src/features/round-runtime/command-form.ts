import { z } from 'zod';
import { idSchema, roundViewSchema, type RoundView } from '@daisy/protocol';
import { formValues } from '../mock-form/form';
import { roundCommandFields } from './command-fields';
export type RoundFormState = {
  readonly values: Readonly<Record<string, string>>;
  readonly error?: string;
  readonly view?: RoundView;
  readonly next?: string;
  readonly confirmation?: boolean;
  readonly acknowledged?: boolean;
  readonly unacknowledged?: boolean;
};
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
export const roundCommandUnavailable = (form: FormData): RoundFormState => ({
  values: formValues(form),
  unacknowledged: true,
  error:
    'The command is not acknowledged. Review the current round before trying again.',
});
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
    return {
      values: formValues(form),
      error: 'This round command is invalid. Reload the round and try again.',
    };
  if (
    ['yield', 'forfeit'].includes(envelope.command.type) &&
    form.get('confirmed') !== 'true'
  )
    return { values: formValues(form), confirmation: true };
  try {
    const response = await fetch(`/api/rounds/${roundId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    if (response.status >= 500) return roundCommandUnavailable(form);
    if (!response.ok)
      return {
        values: {},
        error:
          response.status === 409
            ? 'The round changed or that action is no longer legal. Review the current round and try again.'
            : 'The server refused this round command. Review the current round and try again.',
      };
    const view = acceptedView(
      await response.json(),
      roundId,
      envelope.commandId,
    );
    return view
      ? { values: {}, view, acknowledged: true }
      : roundCommandUnavailable(form);
  } catch {
    return roundCommandUnavailable(form);
  }
}
