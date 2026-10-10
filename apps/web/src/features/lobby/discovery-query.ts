import { roomListQuerySchema } from '@daisy/protocol';
import type { SearchParams } from '../access/decision';

export function parseRoomDiscoveryQuery(raw: SearchParams) {
  return roomListQuerySchema.safeParse({
    q: raw.q,
    cursor: raw.cursor,
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
