'use client';

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useSyncExternalStore,
  type RefObject,
} from 'react';

type Listening = boolean | AddEventListenerOptions;

type DocumentListening = {
  readonly capture?: boolean;
  readonly passive?: boolean;
};

/**
 * One listener on the document while mounted; the handler is read at its
 * latest. Custom event names carry a plain `Event`.
 */
export function useDocumentEvent<K extends keyof DocumentEventMap>(
  type: K,
  handle: (event: DocumentEventMap[K]) => void,
  options?: DocumentListening,
): void;
export function useDocumentEvent(
  type: string,
  handle: (event: Event) => void,
  options?: DocumentListening,
): void;
export function useDocumentEvent(
  type: string,
  handle: (event: Event) => void,
  options?: DocumentListening,
): void {
  const onEvent = useEffectEvent(handle);
  const capture = options?.capture ?? false;
  const passive = options?.passive;
  useEffect(() => {
    const listener = (event: Event) => onEvent(event);
    const listening: Listening =
      passive === undefined ? { capture } : { capture, passive };
    document.addEventListener(type, listener, listening);
    return () => document.removeEventListener(type, listener, { capture });
  }, [type, capture, passive]);
}

/**
 * One listener on the window while mounted (`enabled` false listens to
 * nothing). Custom event names carry a plain `Event`.
 */
export function useWindowEvent<K extends keyof WindowEventMap>(
  type: K,
  handle: (event: WindowEventMap[K]) => void,
  enabled?: boolean,
): void;
export function useWindowEvent(
  type: string,
  handle: (event: Event) => void,
  enabled?: boolean,
): void;
export function useWindowEvent(
  type: string,
  handle: (event: Event) => void,
  enabled = true,
): void {
  const onEvent = useEffectEvent(handle);
  useEffect(() => {
    if (!enabled) return;
    const listener = (event: Event) => onEvent(event);
    window.addEventListener(type, listener);
    return () => window.removeEventListener(type, listener);
  }, [type, enabled]);
}

/** One listener on the element a ref holds, while it holds one. */
export function useElementEvent<
  T extends HTMLElement,
  K extends keyof HTMLElementEventMap,
>(
  target: RefObject<T | null>,
  type: K,
  handle: (event: HTMLElementEventMap[K], element: T) => void,
): void {
  const onEvent = useEffectEvent(handle);
  useEffect(() => {
    const element = target.current;
    if (element === null) return;
    const listener = (event: HTMLElementEventMap[K]) => onEvent(event, element);
    element.addEventListener(type, listener);
    return () => element.removeEventListener(type, listener);
  }, [target, type]);
}

/** Calls `handle` whenever the document becomes visible again. */
export function useDocumentShown(handle: () => void): void {
  useDocumentEvent('visibilitychange', () => {
    if (document.visibilityState === 'visible') handle();
  });
}

/** Calls `handle` when the document is hidden or the page is left. */
export function useDocumentHidden(handle: () => void): void {
  useDocumentEvent('visibilitychange', () => {
    if (document.visibilityState === 'hidden') handle();
  });
  useWindowEvent('pagehide', handle);
}

const subscribeNothing = () => () => undefined;

const subscribeMedia = (query: string) => (changed: () => void) => {
  const list = window.matchMedia(query);
  list.addEventListener('change', changed);
  return () => list.removeEventListener('change', changed);
};

/**
 * Whether a media query matches, as a value: the server render and
 * hydration read `serverMatches`, and the browser's answer follows.
 */
export function useMediaQuery(
  query: string | null,
  serverMatches = false,
): boolean {
  // One subscription per query: a new subscribe each render would re-add
  // the listener every time.
  const subscribe = useMemo(
    () => (query === null ? subscribeNothing : subscribeMedia(query)),
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (query === null ? serverMatches : window.matchMedia(query).matches),
    () => serverMatches,
  );
}

function observeResize(target: Element, callback: ResizeObserverCallback) {
  const observer = new ResizeObserver(callback);
  observer.observe(target);
  return () => observer.disconnect();
}

/** Calls `handle` with the element each time it resizes, while `enabled`. */
export function useResizeObserver<T extends Element>(
  target: RefObject<T | null>,
  handle: (target: T) => void,
  enabled = true,
) {
  const onResize = useEffectEvent(handle);
  useEffect(() => {
    const node = target.current;
    if (node !== null && enabled)
      return observeResize(node, () => onResize(node));
  }, [target, enabled]);
}

/**
 * Calls `handle` once on mount and after each mutation of the node `find`
 * returns, until the owner leaves or `key` changes.
 */
export function useMutationObserver<K>(
  key: K,
  find: () => Node | null,
  init: MutationObserverInit,
  handle: () => void,
): void {
  const locate = useEffectEvent(find);
  const onChange = useEffectEvent(handle);
  const {
    childList = false,
    characterData = false,
    subtree = false,
    attributes = false,
  } = init;
  useEffect(() => {
    onChange();
    const node = locate();
    if (node === null) return;
    const observer = new MutationObserver(() => onChange());
    observer.observe(node, { childList, characterData, subtree, attributes });
    return () => observer.disconnect();
  }, [key, childList, characterData, subtree, attributes]);
}

/**
 * Calls `handle` with the new answer each time a media query's answer
 * changes, as the browser reports it and before React renders anything for
 * it. The handler is read at its latest.
 */
export function useMediaChange(
  query: string,
  handle: (matches: boolean) => void,
): void {
  const onChange = useEffectEvent(handle);
  useEffect(() => {
    const list = window.matchMedia(query);
    const changed = () => onChange(list.matches);
    list.addEventListener('change', changed);
    return () => list.removeEventListener('change', changed);
  }, [query]);
}

/**
 * One listener on the form that holds the anchor element, while it holds
 * one: a field's way to hear its whole form (a reset, a submit) without
 * owning the form element. The handler is read at its latest.
 */
export function useEnclosingFormEvent<K extends keyof HTMLElementEventMap>(
  anchor: RefObject<Element | null>,
  type: K,
  handle: (event: HTMLElementEventMap[K], form: HTMLFormElement) => void,
): void {
  const onEvent = useEffectEvent(handle);
  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!form) return;
    const listener = (event: HTMLElementEventMap[K]) => onEvent(event, form);
    form.addEventListener(type, listener);
    return () => form.removeEventListener(type, listener);
  }, [anchor, type]);
}
