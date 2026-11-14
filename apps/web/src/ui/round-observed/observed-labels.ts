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
