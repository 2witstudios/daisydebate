'use client';
import { useEffect } from 'react';
import { messagingMarkReadBody } from '../../features/messaging/mark-read';

/**
 * Marks a conversation read through `sequence` once it is on screen. The
 * read mutation is a same-origin POST, so the browser makes it; a failed
 * attempt leaves the conversation unread and the next view retries.
 */
export function MarkConversationRead({
  channelId,
  sequence,
}: {
  readonly channelId: string;
  readonly sequence: number;
}) {
  useEffect(() => {
    void fetch('/api/messaging/read', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(messagingMarkReadBody(channelId, sequence)),
    }).catch(() => undefined);
  }, [channelId, sequence]);
  return null;
}
