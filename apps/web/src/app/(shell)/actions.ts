'use server';

import { headers } from 'next/headers';
import { readActiveRoom } from '../../features/rooms/read-assembly';
import { inProcessFetch } from '../../server/in-process-fetch';
import { processRoute } from '../../server/process-app';

const active = processRoute((routes) => routes.rooms.active);

/** The member's own active Room (ADR 0070), through the canonical route's gates. */
export async function activeRoomRead() {
  return readActiveRoom(inProcessFetch(active, new Headers(await headers())));
}
