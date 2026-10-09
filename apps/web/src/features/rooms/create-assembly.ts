import { z } from 'zod';
import { idSchema, roomCreateSchema, roomViewSchema } from '@daisy/protocol';
import { field } from '../mock-form/form';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Created =
  | { readonly kind: 'created'; readonly roomId: string }
  | { readonly kind: 'invalid' | 'refused' | 'unavailable' };
const createdSchema = z.object({
  receipt: z.object({ roomId: idSchema }),
  view: roomViewSchema,
});

/** Native form input goes through CAP's schema and its canonical authenticated POST. */
export async function createAssembly(
  fetch: FetchLike,
  form: FormData,
): Promise<Created> {
  let selection: unknown;
  try {
    selection = JSON.parse(field(form, 'selection'));
  } catch {
    return { kind: 'invalid' };
  }
  const parsed = roomCreateSchema.safeParse({
    commandId: field(form, 'commandId'),
    title: field(form, 'title'),
    topic: field(form, 'topic'),
    visibility: field(form, 'visibility'),
    selection,
  });
  if (!parsed.success) return { kind: 'invalid' };
  try {
    const response = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    if (!response.ok)
      return { kind: response.status < 500 ? 'refused' : 'unavailable' };
    const created = createdSchema.safeParse(await response.json());
    return created.success &&
      created.data.receipt.roomId === created.data.view.id
      ? { kind: 'created', roomId: created.data.view.id }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
