'use client';
import './zod-jitless';
import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import type { RoundView } from '@daisy/protocol';
import type { RoundRead } from '../../features/rooms/read-round';
import { roundMediaSlot } from '../../features/round-media/media-session';
import { FreshnessNotice } from '../resource-sync/freshness-notice';
import { useLiveRoundView } from './use-live-round-view';
import { MediaPageLink } from '../round-media/media-page-link';

/** The server admits an actual own judge assignment; media grants remain server-authoritative. */
export function LiveJudgeRoom(props: {
  readonly view: RoundView;
  readonly read: () => Promise<RoundRead>;
  readonly socketUrl: string | null;
}) {
  const [synced, driver] = useLiveRoundView(props);
  const refresh = useCallback(() => driver?.signal(), [driver]);
  const media = useMemo(() => roundMediaSlot(refresh), [refresh]);
  const view = synced.value;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-dash-column flex-col gap-4 p-4">
      <h1 className="text-xl font-strong">Judge live Round</h1>
      <p className="wrap-anywhere">{view.topic}</p>
      <p>
        You can watch and listen. Your ballot opens after the recorded
        transcript is frozen.
      </p>
      <FreshnessNotice freshness={synced.freshness} noun="round" />
      {media(view)}
      <Link href={`/judge/ballot/${view.id}`} prefetch={false}>
        Open your ballot
      </Link>
      <MediaPageLink href={`/rounds/${view.id}`}>
        View Round result
      </MediaPageLink>
    </main>
  );
}
