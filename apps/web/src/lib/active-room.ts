import { cache } from 'react';
import { headers } from 'next/headers';
import { readActiveRoom } from '../features/rooms/read-assembly';
import { inProcessFetch } from '../server/in-process-fetch';
import { processRoute } from '../server/process-app';

const active = processRoute((routes) => routes.rooms.active);

/**
 * This request's member's own active Room (ADR 0069), read once per render
 * through the canonical route's gates, for the shell and the lobby.
 */
export const requestActiveRoom = cache(async () =>
  readActiveRoom(inProcessFetch(active, new Headers(await headers()))),
);
