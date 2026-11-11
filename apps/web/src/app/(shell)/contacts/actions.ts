'use server';

import { systemId } from '@daisy/clock';
import { contactBlockResultSchema } from '@daisy/protocol';
import {
  personBlocked,
  personBlockUnavailable,
  type PersonBlockState,
} from '../../../features/contacts/block-form';
import { processRoute } from '../../../server/process-app';
import { post, text } from '../form-post';

const routes = { block: processRoute((all) => all.contacts.blockByUsername) };

/** Blocks a member, through Contacts' own route. */
export async function blockAction(
  _previous: PersonBlockState,
  form: FormData,
): Promise<PersonBlockState> {
  try {
    const response = await post(routes.block, '/api/contacts/username', {
      version: 1,
      requestId: systemId.next(),
      username: text(form, 'username'),
      blocked: true,
    });
    const result = contactBlockResultSchema.safeParse(
      response.ok ? await response.json() : null,
    );
    return result.success ? personBlocked : personBlockUnavailable();
  } catch {
    return personBlockUnavailable();
  }
}
