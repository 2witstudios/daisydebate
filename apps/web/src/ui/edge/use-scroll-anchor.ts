'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';

type Anchor = { readonly id: string; readonly offset: number };

/**
 * Keeps the row being read in place while the content around it changes:
 * `capture` remembers the first row still visible below the scroller's top
 * (rows carry their id in `idAttribute`), and each new `content` scrolls by
 * however far that row moved, before the browser paints. A scroller at its
 * resting edge (`scrollTop` at or past -1, as a reversed column sticks to
 * its newest row at zero) holds no anchor.
 */
export function useScrollAnchor<T extends HTMLElement>(
  content: unknown,
  idAttribute: string,
) {
  const ref = useRef<T>(null);
  const anchor = useRef<Anchor | null>(null);
  const selector = `[${idAttribute}]`;
  const capture = useCallback(() => {
    const scroller = ref.current;
    if (!scroller || scroller.scrollTop >= -1) {
      anchor.current = null;
      return;
    }
    const top = scroller.getBoundingClientRect().top;
    const visible = [...scroller.querySelectorAll<HTMLElement>(selector)]
      .flatMap((row) => {
        const id = row.getAttribute(idAttribute);
        return id === null ? [] : [{ row, id }];
      })
      .find(({ row }) => row.getBoundingClientRect().bottom > top);
    anchor.current = visible
      ? {
          id: visible.id,
          offset: visible.row.getBoundingClientRect().top - top,
        }
      : null;
  }, [selector, idAttribute]);
  useLayoutEffect(() => {
    const scroller = ref.current;
    const held = anchor.current;
    if (scroller && held) {
      const row = [...scroller.querySelectorAll<HTMLElement>(selector)].find(
        (row) => row.getAttribute(idAttribute) === held.id,
      );
      if (row)
        scroller.scrollTop +=
          row.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          held.offset;
    }
    capture();
  }, [content, capture, selector, idAttribute]);
  return { ref, capture };
}
