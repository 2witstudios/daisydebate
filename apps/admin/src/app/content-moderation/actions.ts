'use server';

import {
  broadcastStopReasons,
  chatSlowModeSchema,
  recordingTakedownReasons,
} from '@daisy/protocol/content-moderation';
import { idSchema } from '@daisy/protocol';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { submitModeration } from '../../features/content-moderation/commands';
import { currentOperator, requireSameOrigin } from '../../server/operator-gate';
import { adminRuntime } from '../../server/runtime';

/**
 * The moderation screen's plain POST form (no client script). It checks the
 * origin, then the live session, and the command authorizes the operator row
 * again before anything is signed. The redirect carries a closed notice.
 */
const target = { targetId: idSchema };
const requestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('content_report.resolve'),
    ...target,
    outcome: z.enum(['upheld', 'dismissed']),
  }),
  z.strictObject({
    action: z.literal('broadcast.stop'),
    ...target,
    reason: z.enum(broadcastStopReasons),
  }),
  z.strictObject({
    action: z.literal('broadcast.chat_slow_mode.update'),
    ...target,
    seconds: z.coerce.number().pipe(chatSlowModeSchema),
  }),
  z.strictObject({
    action: z.literal('recording.takedown'),
    ...target,
    reason: z.enum(recordingTakedownReasons),
  }),
  z.strictObject({ action: z.literal('chat_message.remove'), ...target }),
  z.strictObject({
    action: z.literal('account.audience_ban.update'),
    ...target,
    state: z.enum(['banned', 'lifted']),
  }),
]);

export async function contentModerationAction(form: FormData): Promise<never> {
  await requireSameOrigin();
  const operator = await currentOperator();
  if (!operator) redirect('/sign-in');
  const reportId = idSchema.safeParse(form.get('reportId'));
  const commandId = idSchema.safeParse(form.get('commandId'));
  const back = reportId.success
    ? `/content-moderation/${reportId.data}`
    : '/content-moderation';
  const { commands } = adminRuntime();
  if (!commands) redirect(`${back}?notice=unconfigured`);
  const fields = Object.fromEntries(
    [...form.entries()].filter(
      ([name]) =>
        name !== 'reportId' &&
        name !== 'commandId' &&
        !name.startsWith('$ACTION'),
    ),
  );
  const request = requestSchema.safeParse(fields);
  if (!request.success || !commandId.success)
    redirect(`${back}?notice=refused`);
  const notice = await submitModeration(commands, {
    operatorId: operator.id,
    commandId: commandId.data,
    request: request.data,
  });
  redirect(`${back}?notice=${notice}`);
}
