import type { DebateSide } from '@daisy/protocol';
import type { ObservedActivity } from '../../features/round-runtime/observed-round';

/** What a side is doing, in words, wherever a Round is watched. */
export const observedActivityLabel: Readonly<Record<ObservedActivity, string>> =
  {
    speaking: 'Speaking',
    listening: 'Listening',
    asking: 'Asking',
    answering: 'Answering',
    preparing: 'Preparing',
    waiting: 'Waiting',
  };

/**
 * A side's ink in a live Round, as the round room's side chips use it (sky
 * and clay). The ballot's own side colours (`sideTextClass`) differ on
 * purpose and stay with the ballot.
 */
export const observedSideInk: Readonly<Record<DebateSide, string>> = {
  affirmative: 'text-hue-sky',
  negative: 'text-hue-clay',
};
