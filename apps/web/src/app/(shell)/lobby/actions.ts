'use server';

import type { RoomListQuery } from '@daisy/protocol';
import { headers } from 'next/headers';
import { readRoomList } from '../../../features/rooms/read-assembly';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';

const list = processRoute((routes) => routes.rooms.list);
export async function roomListing(query: RoomListQuery) {
  return readRoomList(
    inProcessFetch(list, new Headers(await headers())),
    query,
  );
}
