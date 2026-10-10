import { z, type ZodType } from 'zod';
import { idSchema, roomViewSchema, type RoomView } from '@daisy/protocol';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Read<T> =
  | { readonly kind: 'found'; readonly value: T }
  | { readonly kind: 'missing' | 'unavailable' };

async function readProjection<T>(
  fetch: FetchLike,
  path: string,
  schema: ZodType<T>,
): Promise<Read<T>> {
  try {
    const response = await fetch(path, { method: 'GET' });
    if (response.status === 404) return { kind: 'missing' };
    if (!response.ok) return { kind: 'unavailable' };
    const parsed = schema.safeParse(await response.json());
    return parsed.success
      ? { kind: 'found', value: parsed.data }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

export async function readAssembly(
  fetch: FetchLike,
  id: string,
): Promise<
  | { readonly kind: 'found'; readonly view: RoomView }
  | { readonly kind: 'missing' | 'unavailable' }
> {
  if (!idSchema.safeParse(id).success) return { kind: 'missing' };
  const result = await readProjection(
    fetch,
    `/api/rooms/${id}`,
    roomViewSchema,
  );
  if (result.kind !== 'found') return result;
  return result.value.id === id
    ? { kind: 'found', view: result.value }
    : { kind: 'unavailable' };
}

const listing = z.strictObject({ rooms: z.array(roomViewSchema) });
export async function readAssemblyList(
  fetch: FetchLike,
): Promise<
  | { readonly kind: 'found'; readonly rooms: readonly RoomView[] }
  | { readonly kind: 'unavailable' }
> {
  const result = await readProjection(fetch, '/api/rooms', listing);
  return result.kind === 'found'
    ? { kind: 'found', rooms: result.value.rooms }
    : { kind: 'unavailable' };
}
