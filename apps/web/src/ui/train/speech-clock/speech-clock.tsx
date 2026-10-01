'use client';

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  elapsedPercent,
  formatClock,
  isTimeUp,
  pause,
  resume,
  startClock,
  tick,
} from '../../../features/train/speech-clock';
import { renderSpeechClock } from './speech-clock.render';

export type SpeechClockProps = {
  readonly seconds: number;
  readonly actions: ReactNode;
  readonly endHref: ReactNode;
};

const TICK_MS = 250;

// False on the server and during hydration, true once the page is live.
const subscribeNever = () => () => {};
const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

/**
 * The turn timer, the one piece of Train state a URL cannot hold. It counts
 * down once hydrated; without script it shows the full length and the speech
 * is still run by the coach prompts and the End speech link.
 */
export function SpeechClock({ seconds, actions, endHref }: SpeechClockProps) {
  const [state, setState] = useState(() => startClock(seconds));
  const live = useHydrated();

  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      setState((current) => tick(current, now - last));
      last = now;
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return renderSpeechClock({
    display: formatClock(state.remainingMs),
    lengthLabel: formatClock(seconds * 1000),
    percent: elapsedPercent(seconds, state),
    paused: state.paused,
    timeUp: isTimeUp(state),
    live,
    actions,
    endHref,
    onPause: () => setState(pause),
    onResume: () => setState(resume),
  });
}
