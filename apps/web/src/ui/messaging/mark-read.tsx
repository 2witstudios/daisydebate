'use client';
import { useDeliver } from '../edge/use-answer';
import {
  browserTransport,
  type BrowserTransport,
} from '../edge/browser-request';

import { messagingMarkReadBody } from '../../features/messaging/mark-read';

/** One read mark; a failed attempt leaves the conversation unread. */
const markRead = (
  transport: BrowserTransport,
  channelId: string,
  sequence: number,
) =>
  transport('/api/messaging/read', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(messagingMarkReadBody(channelId, sequence)),
  }).catch(() => undefined);

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
  // Each conversation and sequence shown is marked once.
  useDeliver(`${sequence} ${channelId}`, () => {
    void markRead(browserTransport, channelId, sequence);
  });
  return null;
}
