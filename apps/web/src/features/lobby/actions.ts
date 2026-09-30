import type { Viewer } from './filter';
import { canTakeSeat } from './eligibility';
import type { RoomListItem } from './room';

/**
 * Where each lobby action goes. There is no backend yet, so each points at
 * the nearest existing route and does nothing else: no fake mutation. The
 * real operations (take a seat, open a table, request a match) replace these
 * destinations here and nowhere else.
 */
export const lobbyDestinations = {
  findMatch: '/ranked',
  openTable: '/play',
  takeSeat: '/play',
  spectate: '/watch',
} as const;

export type RoomAction = {
  readonly kind: 'take-seat' | 'spectate';
  readonly href: string;
  /** False when the viewer cannot act: a ranked band that excludes them. */
  readonly enabled: boolean;
};

/** The one action a room row offers the viewer. */
export const roomAction = (room: RoomListItem, viewer: Viewer): RoomAction =>
  room.status === 'open'
    ? {
        kind: 'take-seat',
        href: lobbyDestinations.takeSeat,
        enabled: canTakeSeat(room, viewer),
      }
    : { kind: 'spectate', href: lobbyDestinations.spectate, enabled: true };
