'use server';

import { headers } from 'next/headers';
import { readRoomTemplates } from '../../../features/rooms/read-catalog';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';
import { roomComposition } from '../../../features/room-runtime/composition';

const catalog = processRoute(roomComposition, (routes) => routes.catalog);

export async function roomTemplates() {
  return readRoomTemplates(
    inProcessFetch(catalog, new Headers(await headers())),
  );
}
