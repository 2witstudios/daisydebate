import { roomListQuerySchema } from '@daisy/protocol';
import type { SearchParams } from '../access/decision';

/** The Lobby's "every status" and "any mode" choices narrow nothing. */
const narrowing = (value: SearchParams[string], everything: string) =>
  value === everything ? undefined : value;

export function parseRoomDiscoveryQuery(raw: SearchParams) {
  return roomListQuerySchema.safeParse({
    q: raw.q,
    cursor: raw.cursor,
    status: narrowing(raw.status, 'all'),
    mode: narrowing(raw.mode, 'any'),
    ...(raw.pageSize === undefined
      ? {}
      : {
          pageSize:
            typeof raw.pageSize === 'string' &&
            /^(?:[1-9]|[1-4][0-9]|50)$/.test(raw.pageSize)
              ? Number(raw.pageSize)
              : NaN,
        }),
  });
}
