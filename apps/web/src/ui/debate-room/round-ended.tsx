import { useEffect } from 'react';
import { MediaPageLink } from '../round-media/media-page-link';
import {
  clearMutePreference,
  clearRoundMediaPreferences,
  markDeparture,
} from '../../features/round-media/media-preferences';

/** True once a Round can no longer be debated or judged live. */
export const roundEnded = (status: string): boolean =>
  status === 'completed' || status === 'abandoned';

/**
 * What a live room shows once its Round has ended, while it moves to the
 * result page; the link is the same move without JavaScript.
 */
export function RoundEndedNotice({
  roundId,
  actorId = null,
  roomId,
}: {
  readonly roundId: string;
  /** An actor only arrives with its own Room surface; a viewer cleans nothing. */
  readonly actorId?: string | null;
  readonly roomId?: string;
}) {
  /**
   * This is the surface the terminal view reaches, so the media session's
   * own terminal effect cannot: the Record is done either way once this
   * Round's life ends, and the end keeps the Round from auto-resuming again
   * (ISSUE-879). No personal data leaves this tab.
   */
  useEffect(() => {
    if (roomId) clearRoundMediaPreferences(actorId, roomId, roundId);
    else clearMutePreference(actorId, roundId);
    markDeparture(actorId, roundId);
  }, [actorId, roundId, roomId]);
  return (
    <main className="mx-auto flex w-full max-w-dash-column flex-col gap-3 p-6">
      <p role="status" className="text-lg font-strong text-ink">
        This round is over.
      </p>
      <MediaPageLink href={`/rounds/${roundId}`}>See the result</MediaPageLink>
    </main>
  );
}
