'use server';

import { headers } from 'next/headers';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { moveOn } from '../../../../../server/form-action';
import { processRoute } from '../../../../../server/process-app';
import type { RetainedDeleteState } from '../../../../../ui/messaging/retained-delete-form';

const remove = processRoute((all) => all.messaging.retained.remove);

/** Deletes the survivor's retained conversation, then returns to Messages. */
export async function deleteRetainedAction(
  channelId: string,
  _previous: RetainedDeleteState,
): Promise<RetainedDeleteState> {
  const incoming = new Headers(await headers());
  const response = await inProcessFetch(remove, incoming)(
    '/api/messaging/retained/delete',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, channelId }),
    },
  );
  if (!response.ok)
    return { notice: 'Could not delete this conversation. Try again.' };
  return moveOn(incoming, '/messages');
}
