'use client';
import { useMemo } from 'react';
import { useDeliver } from '../edge/use-answer';
import {
  browserTransport,
  type BrowserTransport,
} from '../edge/browser-request';

import { messagingMarkReadBody } from '../../features/messaging/mark-read';

type ReadMark = { readonly channelId: string; readonly sequence: number };

/** One read mark; a failed attempt leaves the conversation unread. */
const markRead = (
  transport: BrowserTransport,
  { channelId, sequence }: ReadMark,
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
  const mark = useMemo(() => ({ channelId, sequence }), [channelId, sequence]);
  useDeliver(mark, (shown) => void markRead(browserTransport, shown));
  return null;
}
