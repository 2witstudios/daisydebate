import { cache } from 'react';
import { activeRoomRead } from './actions';

/** Read once per render for the shell and the lobby that both show it. */
export const requestActiveRoom = cache(activeRoomRead);
