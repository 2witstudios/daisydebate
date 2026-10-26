import { z } from 'zod';
import {
  activeRoomSchema,
  idSchema,
  roomCreateSchema,
  roomRefusalSchema,
  roomViewSchema,
} from '@daisy/protocol';
import { field } from '../mock-form/form';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Created =
  | { readonly kind: 'created'; readonly roomId: string }
  /** The caller already holds a Room (ADR 0069): return them to it. */
  | { readonly kind: 'active-room'; readonly href: string | null }
  | { readonly kind: 'refused'; readonly reason: CreateRefusal }
  | { readonly kind: 'invalid' | 'unavailable' };
/** What a 4xx refusal of creation means to the person who sent it. */
type CreateRefusal = 'settings' | 'forbidden' | 'rate-limited' | 'replayed';
const refusalBodySchema = z.object({
  refusal: roomRefusalSchema,
  activeRoom: activeRoomSchema.nullable().optional(),
});
async function refusalOf(response: Response): Promise<Created> {
  if (response.status === 403) return { kind: 'refused', reason: 'forbidden' };
  if (response.status === 429)
    return { kind: 'refused', reason: 'rate-limited' };
  if (response.status !== 409) return { kind: 'refused', reason: 'settings' };
  const body = refusalBodySchema.safeParse(
    await response.json().catch(() => null),
  );
  if (body.success && body.data.refusal === 'active-room')
    return { kind: 'active-room', href: body.data.activeRoom?.href ?? null };
  return { kind: 'refused', reason: 'replayed' };
}
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
    // Inert Room routes answer 404: creation is unavailable, not refused.
    if (!response.ok)
      return response.status < 500 && response.status !== 404
        ? await refusalOf(response)
        : { kind: 'unavailable' };
    const created = createdSchema.safeParse(await response.json());
    return created.success &&
      created.data.receipt.roomId === created.data.view.id
      ? { kind: 'created', roomId: created.data.view.id }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
