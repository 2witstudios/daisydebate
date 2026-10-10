'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { systemId } from '@daisy/clock';
import { messagingContactBlockResultSchema } from '@daisy/protocol';
import { processRoute } from '../../../../server/process-app';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import {
  parseBlockForm,
  blockFormUnavailable,
  type BlockFormState,
} from '../../../../features/messaging/forms/block-form';
const blockContact = processRoute((routes) => routes.messaging.blockByUsername);
export async function blockContactAction(
  _previous: BlockFormState,
  form: FormData,
): Promise<BlockFormState> {
  const kept = blockFormUnavailable(form);
  try {
    const command = parseBlockForm(form);
    const response = await inProcessFetch(
      blockContact,
      new Headers(await headers()),
    )('/api/messaging/contacts/username', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    if (!response.ok) return kept;
    const result = messagingContactBlockResultSchema.safeParse(
      await response.json(),
    );
    if (!result.success || result.data.blocked !== command.blocked) return kept;
    revalidatePath('/messages');
    return {
      requestId: systemId.next(),
      username: kept.username,
      notice: result.data.blocked ? 'Contact blocked.' : 'Contact unblocked.',
    };
  } catch {
    return kept;
  }
}
