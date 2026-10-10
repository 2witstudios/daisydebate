import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { inProcessFetch } from './in-process-fetch';
/** Two native message actions verify a scoped response before choosing their next page. */
export async function submitMessagingForm(
  incoming: Headers,
  handler: (request: Request) => Promise<Response>,
  path: string,
  command: unknown,
  expected: { readonly field: 'id' | 'messageId'; readonly value: string },
) {
  const response = await inProcessFetch(handler, incoming)(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!response.ok) return false;
  const reply = z
    .object({ [expected.field]: idSchema })
    .safeParse(await response.json());
  return reply.success && reply.data[expected.field] === expected.value;
}
