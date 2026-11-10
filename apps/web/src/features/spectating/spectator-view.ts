import type { RoundView } from '@daisy/protocol';
import { isLiveRound } from '../round-runtime/round-reading';

/**
 * Why a viewer watches the live room of a Round they hold no seat in. Only an
 * undelayed observer does; the public audience watches the delayed Broadcast
 * and never reaches this view.
 */
export type SpectatorKind = 'undelayed-observer';

/** The kind of spectator a viewer watches as; null without the capability, or once the Round is over. */
export function spectatorKindOf(view: RoundView): SpectatorKind | null {
  return isLiveRound(view) && view.viewerIsUndelayedObserver === true
    ? 'undelayed-observer'
    : null;
}

/** Which live view a member without a debater's seat gets, with what it needs. */
export type WatchingRoom<R> =
  | { readonly kind: 'judge'; readonly round: R }
  | { readonly kind: 'spectator'; readonly spectatorKind: SpectatorKind }
  | { readonly kind: 'receipt' };

/**
 * The room route's order for a member without a debater's seat (ISSUE-673):
 * the assigned judge's live view first, so a host who also judges judges;
 * then a spectator's view for a spectator kind; else the Round's receipt.
 */
export function watchingRoomOf<R extends Pick<RoundView, 'status'>>(input: {
  readonly judgeRound: R | null;
  readonly spectatorKind: SpectatorKind | null;
}): WatchingRoom<R> {
  if (input.judgeRound !== null)
    return isLiveRound(input.judgeRound)
      ? { kind: 'judge', round: input.judgeRound }
      : { kind: 'receipt' };
  return input.spectatorKind === null
    ? { kind: 'receipt' }
    : { kind: 'spectator', spectatorKind: input.spectatorKind };
}
