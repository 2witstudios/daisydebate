import { useMemo } from 'react';
import { useDeliver } from '../edge/use-answer';
import { Announcement } from '../components/announcement/announcement';

import { MediaPageLink } from '../round-media/media-page-link';
import {
  clearMutePreference,
  clearRoundMediaPreferences,
} from '../../features/round-media/media-preferences';

/**
 * What a live room shows once its Round has ended, while it moves to the
 * result page; the link is the same move before hydration.
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
  const ended = useMemo(
    () => ({ actorId, roundId, roomId }),
    [actorId, roundId, roomId],
  );
  useDeliver(ended, (round) => {
    if (round.roomId)
      clearRoundMediaPreferences(round.actorId, round.roomId, round.roundId);
    else clearMutePreference(round.actorId, round.roundId);
  });
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-3 p-6">
      <Announcement
        as="p"
        kind="progress"
        className="text-lg font-strong text-ink"
      >
        This round is over.
      </Announcement>
      {detail ? <p>{detail}</p> : null}
      <MediaPageLink href={`/rounds/${roundId}`}>See the result</MediaPageLink>
    </div>
  );
}
