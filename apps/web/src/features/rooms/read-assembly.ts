import { type ZodType } from 'zod';
import {
  idSchema,
  roomViewSchema,
  roomListPageSchema,
  roomListQuerySchema,
  type RoomListPage,
  type RoomListQuery,
  type RoomView,
} from '@daisy/protocol';

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

export async function readRoomList(
  fetch: FetchLike,
  query: RoomListQuery,
): Promise<
  ({ readonly kind: 'found' } & RoomListPage) | { readonly kind: 'unavailable' }
> {
  if (!roomListQuerySchema.safeParse(query).success)
    return { kind: 'unavailable' };
  const params = new URLSearchParams({
    q: query.q,
    pageSize: String(query.pageSize),
    ...(query.cursor ? { cursor: query.cursor } : {}),
  });
  const result = await readProjection(
    fetch,
    `/api/rooms?${params}`,
    roomListPageSchema,
  );
  if (result.kind !== 'found') return { kind: 'unavailable' };
  const page = result.value;
  if (!validPage(page, query)) return { kind: 'unavailable' };
  return { kind: 'found', ...page };
}

function validPage(page: RoomListPage, query: RoomListQuery) {
  return !(
    page.rooms.length > query.pageSize ||
    page.rooms.some(
      (room, index) =>
        room.id <= (index ? page.rooms[index - 1]!.id : (query.cursor ?? '')),
    ) ||
    (page.nextCursor !== null && page.nextCursor !== page.rooms.at(-1)?.id) ||
    (page.retry && (page.rooms.length > 0 || page.nextCursor !== null))
  );
}
