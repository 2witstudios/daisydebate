'use client';
import type { AudienceSnapshot } from '@daisy/protocol';
import { SpectatorChatList } from './spectator-chat-list';
import { useAudienceSnapshot } from './use-audience-snapshot';

/** Spectator chat to read during a Round: closed until wanted, and never to post from. */
export function SeatedChatReader({
  initial,
}: {
  readonly initial: AudienceSnapshot;
}) {
  const { messages } = useAudienceSnapshot(initial, true);
  return (
    <details className="text-sm text-ink-muted">
      <summary className="cursor-pointer font-semibold">Spectator chat</summary>
      <div className="mt-2">
        <SpectatorChatList messages={messages} />
      </div>
    </details>
  );
}
