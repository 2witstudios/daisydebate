import { type ZodType } from 'zod';
import { realtimeEndpointOf } from '../realtime/endpoint-header';
import {
  activeRoomReadSchema,
  idSchema,
  roomViewSchema,
  roomListPageSchema,
  roomListQuerySchema,
  type ActiveRoom,
  type RoomListPage,
  type RoomListQuery,
  type RoomView,
} from '@daisy/protocol';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Read<T> =
  | {
      readonly kind: 'found';
      readonly value: T;
      readonly socketUrl: string | null;
    }
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
      ? {
          kind: 'found',
          value: parsed.data,
          socketUrl: realtimeEndpointOf(response),
        }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** What a room read must answer for a consumer that needs only the view. */
export type RoomRead =
  | { readonly kind: 'found'; readonly view: RoomView }
  | { readonly kind: 'missing' | 'unavailable' };

export async function readAssembly(
  fetch: FetchLike,
  id: string,
): Promise<
  | {
      readonly kind: 'found';
      readonly view: RoomView;
      /** Where the room's doorbell rings, when realtime is configured. */
      readonly socketUrl: string | null;
    }
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
    ? { kind: 'found', view: result.value, socketUrl: result.socketUrl }
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
    ...(query.status ? { status: query.status } : {}),
    ...(query.mode ? { mode: query.mode } : {}),
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

/**
 * The signed-in member's own active Room (ADR 0070), for display only: a
 * Room route that is off, refused or down answers that no Room is shown.
 */
export async function readActiveRoom(
  fetch: FetchLike,
): Promise<ActiveRoom | null> {
  const result = await readProjection(
    fetch,
    '/api/rooms/active',
    activeRoomReadSchema,
  );
  return result.kind === 'found' ? result.value.activeRoom : null;
}
