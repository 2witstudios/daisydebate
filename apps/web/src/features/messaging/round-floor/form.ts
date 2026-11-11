import {
  createMessagingCoreSchemas,
  idSchema,
  messagingBetaLimits,
} from '@daisy/protocol';
import {
  messageDraft,
  messageUnsentNotice,
  parseMessageForm,
} from '../forms/send-form';
import {
  floorCommand,
  floorRefused,
  floorSent,
  floorUnacknowledged,
  sameFloorCommand,
  unacknowledgedFloorCommand,
  type FloorFormState,
  type FloorUnacknowledged,
} from './form-state';

/** A lost answer may already have committed: keep the original command retryable. */
export const floorFormUnavailable = (form: FormData): FloorUnacknowledged =>
  floorUnacknowledged(floorCommand(form), messageUnsentNotice);

const notices: Readonly<Record<number, string>> = {
  400: 'Your message needs text and must fit the character limit. Your draft is kept.',
  403: 'You cannot send to this Round chat now. Your draft is kept.',
  404: 'This Round chat is unavailable. Your draft is kept.',
  409: 'This command conflicts with an earlier message. Your draft is kept.',
  429: 'Please wait before sending again. Your draft is kept.',
};
const schemas = createMessagingCoreSchemas(messagingBetaLimits);

/** Embedded forms use the canonical HTTP gates and never navigate away from the Round. */
export async function submitFloorMessage(
  send: (url: string, init: RequestInit) => Promise<Response>,
  scope: { readonly roundId: string; readonly channelId: string },
  previous: unknown,
  form: FormData,
  nextId: () => string,
): Promise<FloorFormState> {
  const original = unacknowledgedFloorCommand(previous);
  if (original !== null && !sameFloorCommand(original, floorCommand(form)))
    return floorUnacknowledged(
      original,
      'Retry the original message before starting another one. Your draft is kept.',
    );
  // Once unacknowledged, only a confirmed answer releases the command.
  const refuse = (error: string, mayHaveCommitted = false): FloorFormState =>
    original !== null || mayHaveCommitted
      ? floorUnacknowledged(floorCommand(form), error)
      : floorRefused(messageDraft(form), error);
  let command: ReturnType<typeof parseMessageForm>;
  try {
    idSchema.parse(scope.roundId);
    command = schemas.send.parse(parseMessageForm(scope.channelId, form));
  } catch {
    return refuse(messageUnsentNotice);
  }
  try {
    const response = await send(`/api/rounds/${scope.roundId}/floor/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    if (!response.ok)
      return refuse(
        notices[response.status] ?? messageUnsentNotice,
        response.status >= 500,
      );
    // Receipt replay returns current content, which may include a later edit.
    const result = schemas.message.safeParse(await response.json());
    if (!result.success || result.data.channelId !== scope.channelId)
      return floorFormUnavailable(form);
    return floorSent(result.data.id, idSchema.parse(nextId()));
  } catch {
    return floorFormUnavailable(form);
  }
}
