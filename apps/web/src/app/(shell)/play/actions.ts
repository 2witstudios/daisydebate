'use server';

import { headers } from 'next/headers';
import { readRoomTemplates } from '../../../features/rooms/read-catalog';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';

const catalog = processRoute((routes) => routes.rooms.catalog);

export async function roomTemplates() {
  return readRoomTemplates(
    inProcessFetch(catalog, new Headers(await headers())),
  );
}
