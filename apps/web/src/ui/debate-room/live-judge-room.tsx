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
import { RoundEnded, roundEnded } from './round-ended';

/**
 * The server admits an actual own judge assignment; media grants remain
 * server-authoritative. Once the Round ends, the judge goes to its result.
 */
export function LiveJudgeRoom(props: {
  readonly view: RoundView;
  readonly read: () => Promise<RoundRead>;
  readonly socketUrl: string | null;
}) {
  const [synced, driver] = useLiveRoundView(props);
  const refresh = useCallback(() => driver?.signal(), [driver]);
  const media = useMemo(() => roundMediaSlot(refresh), [refresh]);
  const view = synced.value;
  if (roundEnded(view.status)) return <RoundEnded roundId={view.id} />;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-dash-column flex-col gap-4 p-4">
      <h1 className="font-display text-2xl font-semibold">
        You’re judging this round
      </h1>
      <section
        aria-labelledby="judge-resolution"
        className="rounded-xl border border-border bg-surface-raised p-5"
      >
        <h2
          id="judge-resolution"
          className="text-xs font-bold tracking-wide text-ink-muted uppercase"
        >
          Resolution
        </h2>
        <p className="font-display text-xl wrap-anywhere">{view.topic}</p>
      </section>
      <p>
        You can watch and listen. Your ballot opens once the speeches are over
        and the transcript is saved.
      </p>
      <FreshnessNotice freshness={synced.freshness} noun="round" />
      {media(view)}
      <Link href={`/judge/ballot/${view.id}`} prefetch={false}>
        Open your ballot
      </Link>
      <MediaPageLink href={`/rounds/${view.id}`}>
        View the round result
      </MediaPageLink>
    </main>
  );
}
