'use client';
import { useCallback, useLayoutEffect, useRef } from 'react';
import type { MessageRow } from '../../features/messaging/message-rows';

/** Keep the message being read in place; the reversed column sticks to newest at zero. */
export function useHistoryScroll(rows: readonly MessageRow[]) {
  const ref = useRef<HTMLDivElement>(null);
  const anchor = useRef<{
    readonly id: string;
    readonly offset: number;
  } | null>(null);
  const capture = useCallback(() => {
    const scroller = ref.current;
    if (!scroller || scroller.scrollTop >= -1) {
      anchor.current = null;
      return;
    }
    const top = scroller.getBoundingClientRect().top;
    const visible = [
      ...scroller.querySelectorAll<HTMLElement>('[data-message-id]'),
    ].find((row) => row.getBoundingClientRect().bottom > top);
    anchor.current = visible
      ? {
          id: visible.dataset.messageId!,
          offset: visible.getBoundingClientRect().top - top,
        }
      : null;
  }, []);
  useLayoutEffect(() => {
    const scroller = ref.current;
    const held = anchor.current;
    if (scroller && held) {
      const row = [
        ...scroller.querySelectorAll<HTMLElement>('[data-message-id]'),
      ].find((row) => row.dataset.messageId === held.id);
      if (row)
        scroller.scrollTop +=
          row.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          held.offset;
    }
    capture();
  }, [rows, capture]);
  return { ref, capture };
}
