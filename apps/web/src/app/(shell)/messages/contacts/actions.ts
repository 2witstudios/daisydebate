'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { systemId } from '@daisy/clock';
import { contactBlockResultSchema } from '@daisy/protocol/contacts';
import { processRoute } from '../../../../server/process-app';
import { contactComposition } from '../../../../features/contacts/composition';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import {
  parseBlockForm,
  blockChanged,
  blockFormUnavailable,
  type BlockFormState,
} from '../../../../features/contacts/block-form';
const blockContact = processRoute(
  contactComposition,
  (routes) => routes.blockByUsername,
);
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
    )('/api/contacts/username', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    if (!response.ok) return kept;
    const result = contactBlockResultSchema.safeParse(await response.json());
    if (!result.success || result.data.blocked !== command.blocked) return kept;
    revalidatePath('/messages');
    return blockChanged(
      { requestId: systemId.next(), username: kept.values.username },
      result.data.blocked,
    );
  } catch {
    return kept;
  }
}
