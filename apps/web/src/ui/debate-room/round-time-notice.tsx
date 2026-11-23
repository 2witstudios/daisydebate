'use client';
import { useResource } from '../edge/use-driver';
import { useTick } from '../edge/use-tick';
import { Announcement } from '../components/announcement/announcement';
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
  const update = () => setStatus(roundTime.status());
  useResource(roundTime, (followed) => {
    setStatus(followed.status());
    return {
      dispose: followed.subscribe(() => setStatus(followed.status())),
    };
  });
  useTick(update, 1000, roundTime);
  const { announcement, detail } = roundTimeNotice(status);
  return (
    <p
      className="px-4 py-1 text-sm text-ink-muted"
      data-round-time={status.kind}
    >
      <Announcement as="span" kind="progress">
        {announcement}
      </Announcement>
      {detail ? ` · ${detail}` : null}
    </p>
  );
}
