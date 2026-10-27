import type { RoomView } from '@daisy/protocol';
import {
  resourceSync,
  seedResourceSync,
  type ResourceIdentity,
  type ResourceSync,
} from '../resource-sync/resource-sync';
import type { RoomCommandIds } from './room-command-ids';

/** The room view with the command identifiers offered for it. */
export type RoomSnapshot = {
  readonly view: RoomView;
  readonly ids: RoomCommandIds;
};
export type RoomSync = ResourceSync<RoomSnapshot>;

/**
 * Rooms order by `changeVersion`. An equal version is re-read for its
 * time-derived fields (prep remaining and finished, and the capabilities
 * that follow) and keeps the identifiers already offered; a newer one brings
 * its own, so an accepted command's identifier is never offered again.
 */
export const roomIdentity: ResourceIdentity<RoomSnapshot> = {
  id: (snapshot) => snapshot.view.id,
  version: (snapshot) => snapshot.view.changeVersion,
  sameVersion: (held, next) => ({ view: next.view, ids: held.ids }),
};

export const roomSync = resourceSync(roomIdentity);

export const seedRoomSync = (
  view: RoomView,
  ids: RoomCommandIds,
  at: number,
): RoomSync => seedResourceSync(roomIdentity, { view, ids }, at);

const runningPrep = (view: RoomView) =>
  view.prep.startedAt !== null &&
  !view.prep.finished &&
  view.prep.remainingMs !== null
    ? view.prep.remainingMs
    : null;

/**
 * When the reported prep time runs out, the room must be read again. A prep
 * with no time left has nothing more to wait for: the backstop picks up its
 * finish, so a read at zero never schedules another.
 */
export function prepDeadline(state: RoomSync): number | null {
  const remaining = runningPrep(state.value.view);
  return remaining === null || remaining === 0
    ? null
    : state.readAt + remaining;
}

/** When the open strike falls due by the read's own account, the room must be read again. */
function drawDeadline(state: RoomSync): number | null {
  const turn = state.value.view.resolutionDraw?.turn;
  return turn ? state.readAt + turn.remainingMs : null;
}

/** The nearest time-derived change: the strike due instant or the prep end. */
export function roomDeadline(state: RoomSync): number | null {
  const deadlines = [prepDeadline(state), drawDeadline(state)].filter(
    (at): at is number => at !== null,
  );
  return deadlines.length ? Math.min(...deadlines) : null;
}

/** The held view as of `now`: a running prep and an open strike count down from their read. */
export function presentedView(state: RoomSync, now: number): RoomView {
  const { view } = state.value;
  const elapsed = now - state.readAt;
  const remaining = runningPrep(view);
  const draw = view.resolutionDraw;
  if (remaining === null && !draw?.turn) return view;
  return {
    ...view,
    ...(remaining === null
      ? {}
      : {
          prep: {
            ...view.prep,
            remainingMs: Math.max(0, remaining - elapsed),
          },
        }),
    ...(draw?.turn
      ? {
          resolutionDraw: {
            ...draw,
            turn: {
              ...draw.turn,
              remainingMs: Math.max(0, draw.turn.remainingMs - elapsed),
            },
          },
        }
      : {}),
  };
}
