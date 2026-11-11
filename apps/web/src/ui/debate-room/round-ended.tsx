import { useEffect } from 'react';
import { MediaPageLink } from '../round-media/media-page-link';
import {
  clearMutePreference,
  clearRoundMediaPreferences,
} from '../../features/round-media/media-preferences';

/**
 * What a live room shows once its Round has ended, while it moves to the
 * result page; the link is the same move without JavaScript.
 */
export function RoundEndedNotice({
  roundId,
  actorId = null,
  roomId,
  detail,
}: {
  readonly roundId: string;
  /** An actor only arrives with its own Room surface; a viewer cleans nothing. */
  readonly actorId?: string | null;
  readonly roomId?: string;
  /** What this viewer should know about the result, beside the ending itself. */
  readonly detail?: string | undefined;
}) {
  /**
   * This is the surface the terminal view reaches, so the media session's
   * own terminal effect cannot: the records are done once this Round's life
   * ends (ISSUE-879). No personal data leaves this tab.
   */
  useEffect(() => {
    if (roomId) clearRoundMediaPreferences(actorId, roomId, roundId);
    else clearMutePreference(actorId, roundId);
  }, [actorId, roundId, roomId]);
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-3 p-6">
      <p role="status" className="text-lg font-strong text-ink">
        This round is over.
      </p>
      {detail ? <p>{detail}</p> : null}
      <MediaPageLink href={`/rounds/${roundId}`}>See the result</MediaPageLink>
    </div>
  );
}
