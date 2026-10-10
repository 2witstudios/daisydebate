import { z } from 'zod';
import {
  idSchema,
  roomCommandSchema,
  roomViewSchema,
  type RoomView,
  type RoomRefusal,
} from '@daisy/protocol';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Submitted =
  | { readonly kind: 'accepted'; readonly view: RoomView }
  | { readonly kind: 'refused'; readonly reason: RoomRefusal | null }
  | { readonly kind: 'invalid' | 'unavailable' };

function commandFields(form: FormData): Record<string, unknown> | null {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of form) {
    if (key.startsWith('$ACTION_')) continue;
    if (form.getAll(key).length !== 1) return null;
    raw[key] = value;
  }
  for (const key of ['expectedVersion', 'expectedConsentVersion', 'slot'])
    if (key in raw) raw[key] = Number(raw[key]);
  for (const key of ['config', 'definition']) {
    if (!(key in raw)) continue;
    if (typeof raw[key] !== 'string') return null;
    raw[key] = JSON.parse(raw[key]);
  }
  return raw;
}

const responseSchema = z.object({ view: roomViewSchema });
export async function submitAssembly(
  fetch: FetchLike,
  roomId: string,
  form: FormData,
): Promise<Submitted> {
  if (!idSchema.safeParse(roomId).success) return { kind: 'invalid' };
  let fields;
  try {
    fields = commandFields(form);
  } catch {
    return { kind: 'invalid' };
  }
  const parsed = roomCommandSchema.safeParse(fields);
  if (!parsed.success) return { kind: 'invalid' };
  try {
    const response = await fetch(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    if (!response.ok) {
      if (response.status >= 500) return { kind: 'unavailable' };
      const body = z
        .object({ refusal: roomViewSchema.shape.startRefusal })
        .safeParse(await response.json());
      return {
        kind: 'refused',
        reason: body.success ? body.data.refusal : null,
      };
    }
    const body = responseSchema.safeParse(await response.json());
    return body.success && body.data.view.id === roomId
      ? { kind: 'accepted', view: body.data.view }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
