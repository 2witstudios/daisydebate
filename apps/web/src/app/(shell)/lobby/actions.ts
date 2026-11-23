'use server';

import type { RoomListQuery } from '@daisy/protocol/room-contract';
import { headers } from 'next/headers';
import {
  readHostedRooms,
  readRoomList,
} from '../../../features/rooms/read-assembly';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';
import { roomComposition } from '../../../features/room-runtime/composition';

const list = processRoute(roomComposition, (routes) => routes.list);
const hosted = processRoute(roomComposition, (routes) => routes.hosted);
export async function roomListing(query: RoomListQuery) {
  return readRoomList(
    inProcessFetch(list, new Headers(await headers())),
    query,
  );
}

/** The open Rooms the member hosts (TAB-6.16), through the canonical route's gates. */
export async function hostedRoomsRead() {
  return readHostedRooms(inProcessFetch(hosted, new Headers(await headers())));
}
