'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { buttonClass } from '../../components/button/button-class';

export type PlayToggleProps = {
  /** The next second's URL; null once the replay reaches its end. */
  readonly tickHref: string | null;
  readonly tickMs: number;
};

const subscribeNever = () => () => undefined;

/**
 * Play and pause: the replay's one client behavior. Playing moves the URL on
 * a second at a time, so the server renders each position and the page
 * without script is still a fully navigable replay (links, scrubber form).
 */
export function PlayToggle({ tickHref, tickMs }: PlayToggleProps) {
  const router = useRouter();
  const ready = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [playing, setPlaying] = useState(false);
  const running = playing && tickHref !== null;
  useEffect(() => {
    if (!running) return undefined;
    const timer = setTimeout(
      () => router.replace(tickHref, { scroll: false }),
      tickMs,
    );
    return () => clearTimeout(timer);
  }, [running, tickHref, tickMs, router]);
  return (
    <button
      type="button"
      disabled={!ready || tickHref === null}
      title={
        ready
          ? undefined
          : 'Playing needs JavaScript. Use the links and the position field.'
      }
      aria-label={running ? 'Pause' : 'Play'}
      aria-pressed={running}
      onClick={() => setPlaying(!running)}
      className={buttonClass('primary')}
    >
      {running ? 'Pause' : 'Play'}
    </button>
  );
}
