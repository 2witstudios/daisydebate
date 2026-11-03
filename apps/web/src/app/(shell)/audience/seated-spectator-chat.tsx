import { launched } from '../../../features/coming-soon/launch';
import { requestAudience } from '../../../lib/request-session';
import { SeatedChatReader } from '../../../ui/audience/seated-chat-reader';

/**
 * What a debater's Room mounts: spectator chat to read, and only when the rule
 * says so. On a ranked Round, for a judge, or when the host turned it off this
 * renders nothing and sends nothing of the chat to the browser.
 */
export async function SeatedSpectatorChat({
  roundId,
  actorId,
  watchOpen = launched.watch,
}: {
  readonly roundId: string;
  readonly actorId: string;
  /** No audience exists while Watch is closed, so there is nothing to read. */
  readonly watchOpen?: boolean;
}) {
  if (!watchOpen) return null;
  const audience = await requestAudience(roundId, actorId);
  if (!audience?.seated || !audience.shown.chat) return null;
  return (
    <SeatedChatReader
      initial={audience.snapshot}
      unlisted={audience.unlisted}
    />
  );
}
