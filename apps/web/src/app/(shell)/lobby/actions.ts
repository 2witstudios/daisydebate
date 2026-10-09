'use server';

import { headers } from 'next/headers';
import { readAssemblyList } from '../../../features/rooms/read-assembly';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';

const list = processRoute((routes) => routes.rooms.list);
export async function roomListing() {
  return readAssemblyList(inProcessFetch(list, new Headers(await headers())));
}
