'use client';
import { useBrowserEffect } from '../edge/browser-sync';
import { startTick, stopTick } from '../edge/browser-time';
import { StatusRegion } from '../components/status-region/status-region';
import { useState } from 'react';
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
  useBrowserEffect(() => {
    const update = () => setStatus(roundTime.status());
    update();
    const unsubscribe = roundTime.subscribe(update);
    const timer = startTick(update, 1000);
    return () => {
      unsubscribe();
      stopTick(timer);
    };
  }, [roundTime]);
  const { announcement, detail } = roundTimeNotice(status);
  return (
    <p
      className="px-4 py-1 text-sm text-ink-muted"
      data-round-time={status.kind}
    >
      <StatusRegion as="span" role="status">
        {announcement}
      </StatusRegion>
      {detail ? ` · ${detail}` : null}
    </p>
  );
}
