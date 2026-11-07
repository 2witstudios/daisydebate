import {
  createMessagingCoreSchemas,
  contentReportCreateSchema,
  idSchema,
  messagingBetaLimits,
} from '@daisy/protocol';
import { floorFormUnavailable, type FloorFormState } from './form';
const schemas = createMessagingCoreSchemas(messagingBetaLimits);
/** A retry repeats the full original command, including its target and operation. */
export async function submitFloorChange(
  send: (kind: string, url: string, init: RequestInit) => Promise<Response>,
  scope: { readonly roundId: string; readonly channelId: string },
  previous: FloorFormState,
  form: FormData,
  nextId: () => string,
  report = false,
): Promise<FloorFormState> {
  const kept = floorFormUnavailable(form);
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
    else return { ...kept, uncertain: previous.uncertain === true };
  } catch {
    return { ...kept, uncertain: previous.uncertain === true };
  }
  const signature = JSON.stringify({ kind, command });
  if (previous.uncertain && previous.command && previous.command !== signature)
    return {
      ...previous,
      notice: 'Retry the original change before starting another one.',
    };
  const unknown = { ...kept, command: signature };
  let acknowledgedText = '';
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
      return {
        ...unknown,
        uncertain: previous.uncertain === true || response.status >= 500,
        notice:
          response.status === 429
            ? 'Please wait before trying again.'
            : 'This change was not accepted. Your text is kept.',
      };
    const result: unknown = await response.json();
    if (report) {
      if (
        !result ||
        typeof result !== 'object' ||
        !('received' in result) ||
        result.received !== true
      )
        return unknown;
    } else {
      const parsed = schemas.messageResult.safeParse(result);
      if (
        !parsed.success ||
        parsed.data.id !== messageId ||
        parsed.data.channelId !== scope.channelId
      )
        return unknown;
      if (kind === 'remove' && !('unavailable' in parsed.data)) return unknown;
      if (kind === 'edit') {
        if (
          'unavailable' in parsed.data ||
          parsed.data.text !== form.get('text')
        )
          return unknown;
        acknowledgedText = parsed.data.text;
      }
    }
    return {
      text: acknowledgedText,
      requestId: idSchema.parse(nextId()),
      sent: messageId,
    };
  } catch {
    return unknown;
  }
}
