import {
  createMessagingCoreSchemas,
  idSchema,
  messagingBetaLimits,
} from '@daisy/protocol';
import { parseMessageForm, messageFormUnavailable } from '../forms/send-form';

export type FloorFormState = {
  readonly text: string;
  readonly requestId: string;
  readonly notice?: string;
  readonly uncertain?: boolean;
  readonly command?: string;
  readonly changeVersion?: number;
  readonly sent?: string;
};

/** A lost answer may already have committed: keep the original command retryable. */
export const floorFormUnavailable = (form: FormData): FloorFormState => ({
  ...messageFormUnavailable(form),
  uncertain: true,
});

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
  previous: FloorFormState,
  form: FormData,
  nextId: () => string,
): Promise<FloorFormState> {
  const kept = messageFormUnavailable(form);
  if (
    previous.uncertain === true &&
    typeof previous.text === 'string' &&
    idSchema.safeParse(previous.requestId).success &&
    (kept.text !== previous.text || kept.requestId !== previous.requestId)
  )
    return {
      text: previous.text,
      requestId: previous.requestId,
      uncertain: true,
      notice:
        'Retry the original message before starting another one. Your draft is kept.',
    };
  let command: ReturnType<typeof parseMessageForm>;
  try {
    idSchema.parse(scope.roundId);
    command = schemas.send.parse(parseMessageForm(scope.channelId, form));
  } catch {
    return { ...kept, ...(previous.uncertain ? { uncertain: true } : {}) };
  }
  try {
    const response = await send(`/api/rounds/${scope.roundId}/floor/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    if (!response.ok)
      return {
        ...kept,
        notice: notices[response.status] ?? kept.notice!,
        ...(previous.uncertain || response.status >= 500
          ? { uncertain: true }
          : {}),
      };
    // Receipt replay returns current content, which may include a later edit.
    const result = schemas.message.safeParse(await response.json());
    if (!result.success || result.data.channelId !== scope.channelId)
      return floorFormUnavailable(form);
    return {
      text: '',
      requestId: idSchema.parse(nextId()),
      sent: result.data.id,
    };
  } catch {
    return floorFormUnavailable(form);
  }
}
