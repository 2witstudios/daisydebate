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
}: {
  readonly roundId: string;
  readonly actorId: string;
}) {
  const audience = await requestAudience(roundId, actorId);
  if (!audience?.seated || !audience.shown.chat) return null;
  return (
    <SeatedChatReader
      initial={audience.snapshot}
      unlisted={audience.unlisted}
    />
  );
}
