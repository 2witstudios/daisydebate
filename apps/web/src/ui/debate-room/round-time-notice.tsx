'use client';
import { useEffect, useState } from 'react';
import type {
  RoundTime,
  RoundTimeStatus,
} from '../../features/round-runtime/round-time';
import { roundTimeNotice } from '../../features/round-runtime/round-time-notice';

/** Clock freshness is independent of the competitive Round revision's freshness. */
export function RoundTimeNotice({
  roundTime,
}: {
  readonly roundTime: RoundTime;
}) {
  const [status, setStatus] = useState<RoundTimeStatus>({
    kind: 'seed',
    uncertaintyMs: null,
  });
  useEffect(() => {
    const update = () => setStatus(roundTime.status());
    update();
    const unsubscribe = roundTime.subscribe(update);
    const timer = window.setInterval(update, 1000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [roundTime]);
  const { announcement, detail } = roundTimeNotice(status);
  return (
    <p
      className="px-4 py-1 text-sm text-ink-muted"
      data-round-time={status.kind}
    >
      <span role="status">{announcement}</span>
      {detail ? ` · ${detail}` : null}
    </p>
  );
}
