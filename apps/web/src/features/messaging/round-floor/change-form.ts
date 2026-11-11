import {
  createMessagingCoreSchemas,
  contentReportCreateSchema,
  idSchema,
  messagingBetaLimits,
} from '@daisy/protocol';
import { messageDraft, messageUnsentNotice } from '../forms/send-form';
import {
  floorChanged,
  floorCommand,
  floorRefused,
  floorSent,
  floorUnacknowledged,
  sameFloorCommand,
  unacknowledgedFloorCommand,
  type FloorFormState,
} from './form-state';
const schemas = createMessagingCoreSchemas(messagingBetaLimits);
/** A retry repeats the full original command, including its target and operation. */
export async function submitFloorChange(
  send: (kind: string, url: string, init: RequestInit) => Promise<Response>,
  scope: { readonly roundId: string; readonly channelId: string },
  previous: unknown,
  form: FormData,
  nextId: () => string,
  report = false,
): Promise<FloorFormState> {
  const posted = floorCommand(form);
  const original = unacknowledgedFloorCommand(previous);
  if (original !== null && !sameFloorCommand(original, posted))
    return floorUnacknowledged(
      original,
      'Retry the original change before starting another one.',
    );
  const lost = floorUnacknowledged(posted, messageUnsentNotice);
  // Once unacknowledged, only a confirmed answer releases the command.
  const refuse = (error: string, mayHaveCommitted = false): FloorFormState =>
    original !== null || mayHaveCommitted
      ? floorUnacknowledged(posted, error)
      : floorRefused(messageDraft(form), error);
  let command: unknown, kind: string, messageId: string;
  try {
    idSchema.parse(scope.roundId);
    messageId = idSchema.parse(form.get('messageId'));
    kind = report ? 'report' : String(form.get('kind'));
    const base = {
      version: 1 as const,
      channelId: idSchema.parse(scope.channelId),
      messageId,
      requestId: idSchema.parse(form.get('requestId')),
    };
    if (report) {
      const value = contentReportCreateSchema.parse({
        targetKind: 'chat_message',
        targetId: messageId,
        reason: form.get('reason'),
      });
      command = {
        version: 1,
        channelId: base.channelId,
        messageId,
        reason: value.reason,
      };
    } else if (kind === 'edit')
      command = schemas.edit.parse({ ...base, text: form.get('text') });
    else if (kind === 'remove') command = schemas.remove.parse(base);
    else return refuse(messageUnsentNotice);
  } catch {
    return refuse(messageUnsentNotice);
  }
  try {
    const response = await send(
      kind,
      `/api/rounds/${scope.roundId}/floor/${kind}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      },
    );
    if (!response.ok)
      return refuse(
        response.status === 429
          ? 'Please wait before trying again.'
          : 'This change was not accepted. Your text is kept.',
        response.status >= 500,
      );
    const result: unknown = await response.json();
    if (report)
      return result &&
        typeof result === 'object' &&
        'received' in result &&
        result.received === true
        ? floorSent(messageId, idSchema.parse(nextId()))
        : lost;
    const parsed = schemas.messageResult.safeParse(result);
    if (
      !parsed.success ||
      parsed.data.id !== messageId ||
      parsed.data.channelId !== scope.channelId
    )
      return lost;
    const removed = 'unavailable' in parsed.data;
    if (removed !== (kind === 'remove')) return lost;
    return floorChanged(
      messageId,
      idSchema.parse(nextId()),
      'unavailable' in parsed.data ? '' : parsed.data.text,
      parsed.data.changeVersion,
    );
  } catch {
    return lost;
  }
}
