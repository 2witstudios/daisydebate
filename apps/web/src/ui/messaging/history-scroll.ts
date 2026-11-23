'use client';
import { useScrollAnchor } from '../edge/use-scroll-anchor';
import type { MessageRow } from '../../features/messaging/message-rows';

/** Keep the message being read in place; the reversed column sticks to newest at zero. */
export const useHistoryScroll = (rows: readonly MessageRow[]) =>
  useScrollAnchor<HTMLDivElement>(rows, 'data-message-id');
