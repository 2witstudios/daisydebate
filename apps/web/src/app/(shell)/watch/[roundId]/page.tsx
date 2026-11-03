import type { Metadata } from 'next';
import { redirectUnlessLaunched } from '../../../../features/coming-soon/launch-gate';
import { requestWatchRound } from '../../../../lib/request-session';
import { BroadcastViewer } from '../../../../ui/spectating/broadcast-viewer';
import { SpectateRefusal } from '../../../../ui/watch/spectate-refusal/spectate-refusal';

export const metadata: Metadata = { title: 'Live debate' };

/**
 * The public Round page. Watching needs no account and no device: it reads the
 * released snapshot and plays the Broadcast's public feed, and is never in the
 * debate's room. An audience of everyone is the same read for everyone.
 */
export default async function WatchRoundPage({
  params,
}: {
  params: Promise<{ roundId: string }>;
}) {
  redirectUnlessLaunched('watch');
  const { roundId } = await params;
  const timeline = await requestWatchRound(roundId);
  return timeline ? (
    <BroadcastViewer initial={timeline} />
  ) : (
    <div className="px-6 pt-8 pb-8 max-compact:px-4">
      <SpectateRefusal />
    </div>
  );
}
