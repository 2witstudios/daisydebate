'use server';

import { revalidatePath } from 'next/cache';
import { processRoute } from '../../../server/process-app';
import { post, text } from '../form-post';

const routes = {
  acknowledge: processRoute((all) => all.moderation.acknowledge),
};

/** Marks a warning read. A form with no typed input, so a failure stays silent. */
export async function acknowledgeNoticeAction(form: FormData): Promise<void> {
  await post(routes.acknowledge, '/api/moderation/notices', {
    version: 1,
    id: text(form, 'id'),
  });
  revalidatePath('/', 'layout');
}
