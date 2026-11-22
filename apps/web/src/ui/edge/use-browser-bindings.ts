'use client';

import { useEffect, useEffectEvent, type RefObject } from 'react';

export function useDocumentEvent<K extends keyof DocumentEventMap>(
  type: K,
  handle: (event: DocumentEventMap[K]) => void,
): void {
  const onEvent = useEffectEvent(handle);
  useEffect(() => {
    const listener = (event: DocumentEventMap[K]) => onEvent(event);
    document.addEventListener(type, listener);
    return () => document.removeEventListener(type, listener);
  }, [type]);
}

export function observeResize(
  target: Element,
  callback: ResizeObserverCallback,
) {
  const observer = new ResizeObserver(callback);
  observer.observe(target);
  return () => observer.disconnect();
}

export function useResizeObserver<T extends Element>(
  target: RefObject<T | null>,
  handle: (target: T) => void,
) {
  const onResize = useEffectEvent(handle);
  useEffect(() => {
    const node = target.current;
    if (node !== null) return observeResize(node, () => onResize(node));
  }, [target]);
}
