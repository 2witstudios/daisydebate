'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { processRoute } from '../../../../../server/process-app';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { readReactionResponse } from '../../../../../features/messaging/reaction-response';
import { readReactionChangeResponse } from '../../../../../features/messaging/reaction-change-response';
import { submitMessagingForm } from '../../../../../server/messaging-form-submit';
import { moveOn, stayOn } from '../../../../../server/form-action';
import {
  parseReactionForm,
  reactionUnavailable,
  type ReactionFormState,
} from '../../../../../features/messaging/forms/reaction-form';
import { systemId } from '@daisy/clock';
import { idSchema } from '@daisy/protocol';
import type { ReactionPillState } from '../../../../../ui/messaging/reaction-pill';
const change = processRoute((routes) => routes.messaging.reactions);
export async function changeReactionAction(
  channelId: string,
  messageId: string,
  _previous: ReactionFormState,
  form: FormData,
): Promise<ReactionFormState> {
  const incoming = new Headers(await headers());
  const kept = reactionUnavailable(form);
  try {
    const command = parseReactionForm(channelId, messageId, form);
    if (
      (await submitMessagingForm(
        incoming,
        change,
        '/api/messaging/reactions',
        command,
        { field: 'messageId', value: command.messageId },
      )) !== 'accepted'
    )
      return kept;
  } catch {
    return kept;
  }
  const path = `/messages/${channelId}/reactions?messageId=${messageId}`;
  revalidatePath(`/messages/${channelId}`);
  revalidatePath(`/messages/${channelId}/reactions`);
  return moveOn(incoming, path);
}

/**
 * A pill's toggle in the conversation. Its fields are untrusted and the route
 * re-validates them. The desired state is in the form, so a repeat is harmless
 * and each post takes a fresh request. Hydrated, the answer updates the reader's
 * own mark. Non-live history also uses the accepted count, without refetching
 * the page; live history continues to take counts from shared snapshots.
 */
export async function reactToMessageAction(
  _previous: ReactionPillState,
  form: FormData,
): Promise<ReactionPillState> {
  const incoming = new Headers(await headers());
  const refused = { notice: 'Reaction could not be changed. Try again.' };
  const channel = idSchema.safeParse(form.get('channelId'));
  const message = idSchema.safeParse(form.get('messageId'));
  if (!channel.success || !message.success) return refused;
  form.set('requestId', systemId.next());
  let aggregate: ReactionPillState;
  try {
    const command = parseReactionForm(channel.data, message.data, form);
    const result = await readReactionChangeResponse(
      await inProcessFetch(change, incoming)('/api/messaging/reactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      }),
      command,
    );
    if (result === null) return refused;
    const accepted = result.reactions.find(
      (item) => item.reaction === command.reaction,
    );
    aggregate = {
      own: command.active,
      ...(accepted ? { count: accepted.count } : {}),
    };
    // A withdrawal grants no read authority (ADR 0075). An HTTP-only view
    // separately reauthorizes a fresh aggregate instead of inferring zero.
    if (!command.active && form.get('observed') === 'false') {
      const current = await readReactionResponse(
        await inProcessFetch(
          processRoute(
            (routes) => (request) =>
              routes.messaging.reactions(request, channel.data),
          ),
          incoming,
        )(
          `/api/messaging/channels/${channel.data}/reactions?messageId=${message.data}`,
          { method: 'GET' },
        ),
        channel.data,
        message.data,
      );
      aggregate =
        current === null
          ? {
              own: false,
              notice: 'Reaction removed. Reload to see the current count.',
            }
          : {
              own: false,
              count:
                current.result.reactions.find(
                  (item) => item.reaction === command.reaction,
                )?.count ?? 0,
            };
    }
  } catch {
    return refused;
  }
  return { ...aggregate, ...stayOn(incoming, `/messages/${channel.data}`) };
}
