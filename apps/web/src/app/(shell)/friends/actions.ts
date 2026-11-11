'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { friendCommandResultSchema } from '@daisy/protocol';
import {
  friendChanged,
  friendDoneNotice,
  friendFormUnavailable,
  friendRefused,
  friendRefusalNotice,
  friendRouteFor,
  parseFriendForm,
  type FriendFormState,
  type FriendIntent,
} from '../../../features/friends/forms';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';

const routes = {
  request: processRoute((all) => all.friends.request),
  respond: processRoute((all) => all.friends.respond),
  remove: processRoute((all) => all.friends.remove),
};

/**
 * Every friend form: the same route a script would call, in process with
 * this request's own headers, so each gate still runs. A change re-renders
 * /friends; a refusal keeps what was typed.
 */
export async function friendAction(
  _previous: FriendFormState,
  form: FormData,
): Promise<FriendFormState> {
  const kept = friendFormUnavailable(form);
  try {
    const { intent, username } = parseFriendForm(form);
    const { route, path, body } = friendRouteFor(intent, username);
    const response = await inProcessFetch(
      routes[route],
      new Headers(await headers()),
    )(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      return friendRefused(
        kept.values.username,
        friendRefusalNotice(intent, response.status),
      );
    const reply: unknown = await response.json();
    const notice = friendDoneNoticeOf(
      intent,
      friendCommandResultSchema.safeParse(reply),
    );
    if (notice === null) return kept;
    revalidatePath('/friends');
    revalidatePath('/profile/[username]', 'page');
    return friendChanged(notice);
  } catch {
    return kept;
  }
}

/** The notice for a friendship change, or null when its reply is not one. */
function friendDoneNoticeOf(
  intent: FriendIntent,
  result: ReturnType<typeof friendCommandResultSchema.safeParse>,
): string | null {
  return result.success
    ? friendDoneNotice(intent, result.data.username, result.data.relation)
    : null;
}
