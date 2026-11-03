/** Where a scroller is, read by the component and passed in as data. */
export type ScrollPosition = {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
};
/** Whether new lines are followed, and the last position that decision saw. */
export type FollowState = {
  readonly following: boolean;
  readonly lastTop: number;
};
export type FollowEvent =
  | { readonly type: 'scrolled'; readonly position: ScrollPosition }
  /** Lines or layout changed: follow them, unless the reader has moved. */
  | { readonly type: 'changed'; readonly position: ScrollPosition }
  /** The list was written to its end, at this position. */
  | { readonly type: 'pinned'; readonly top: number }
  | { readonly type: 'latest' };

const NEAR_END_PX = 24;
/** Zoom and fractional pixels move a position by less than this with no reader. */
const SUBPIXEL_PX = 1;

const remaining = ({ scrollHeight, scrollTop, clientHeight }: ScrollPosition) =>
  scrollHeight - scrollTop - clientHeight;

export const isNearEnd = (position: ScrollPosition): boolean =>
  remaining(position) <= NEAR_END_PX;

/** A drop in position, unless the browser clamped it to the end of shrunk content. */
const movedUp = (state: FollowState, position: ScrollPosition) =>
  position.scrollTop < state.lastTop - SUBPIXEL_PX &&
  remaining(position) > SUBPIXEL_PX;

export const initialFollow: FollowState = { following: true, lastTop: 0 };

type FollowStep = {
  readonly state: FollowState;
  readonly pinToEnd: boolean;
};

function afterScroll(state: FollowState, position: ScrollPosition): FollowStep {
  if (position.clientHeight === 0) return { state, pinToEnd: false };
  return {
    state: {
      following:
        !movedUp(state, position) &&
        (state.following ||
          (position.scrollTop > state.lastTop + SUBPIXEL_PX &&
            isNearEnd(position))),
      lastTop: position.scrollTop,
    },
    pinToEnd: false,
  };
}

function afterChange(state: FollowState, position: ScrollPosition): FollowStep {
  if (!state.following) return { state, pinToEnd: false };
  // Hidden, the position cannot be read, so whatever it is on return is no move.
  if (position.clientHeight === 0)
    return { state: { ...state, lastTop: 0 }, pinToEnd: false };
  return movedUp(state, position)
    ? {
        state: { following: false, lastTop: position.scrollTop },
        pinToEnd: false,
      }
    : { state, pinToEnd: true };
}

/**
 * Following stops when the reader moves up, however little, and that is read at
 * every decision, so a render before the scroll event never snaps them back. A
 * reader's own scroll to the end resumes it, as does Latest. Nothing else does.
 */
export function followNext(state: FollowState, event: FollowEvent): FollowStep {
  switch (event.type) {
    case 'latest':
      return { state: { ...state, following: true }, pinToEnd: true };
    case 'pinned':
      return { state: { ...state, lastTop: event.top }, pinToEnd: false };
    case 'scrolled':
      return afterScroll(state, event.position);
    case 'changed':
      return afterChange(state, event.position);
  }
}
