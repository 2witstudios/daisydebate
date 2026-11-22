'use client';

import {
  interceptBrowserFetch,
  type BrowserRequest,
} from '../edge/browser-request';
import { useBrowserEffect } from '../edge/browser-sync';
import { scheduleDelay } from '../edge/browser-time';
import { StatusRegion } from '../components/status-region/status-region';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ConversationRecoveryOrigin } from './conversation-recovery';
import { createConversationRecovery } from './conversation-recovery';
import { shellNavigationEvent } from '../layout/app-shell/shell-navigation';

/** Only an explicitly temporary refused page mounts this recovery owner. */
export function ConversationReconnecting({
  requestId,
  retryAfterMs,
  origin,
}: {
  readonly requestId: string;
  readonly origin: ConversationRecoveryOrigin;
  readonly retryAfterMs: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const owner = useRef<ReturnType<typeof createConversationRecovery> | null>(
    null,
  );
  const [exhausted, setExhausted] = useState(false);
  useBrowserEffect(() => {
    const address = window.location.href;
    const recovery = createConversationRecovery({
      refresh: () => {
        if (window.location.href === address)
          startTransition(() => router.refresh());
        else recovery.stop();
      },
      schedule: (run, waitMs) => {
        return scheduleDelay(run, waitMs);
      },
      exhausted: () => setExhausted(true),
    });
    owner.current = recovery;
    // A discarded held refresh settles its transition on discard while its
    // network request is still in flight. Adopt the buffered newest render
    // only once that network fetch finishes, so a wait never dispatches
    // while a held refresh is still on the wire.
    let pendingRefetches = 0;
    const isConversationRefetch = (
      input: BrowserRequest[0],
      init: BrowserRequest[1],
    ) => {
      try {
        const raw =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const url = new URL(raw, window.location.href);
        if (
          url.origin !== window.location.origin ||
          url.pathname !== new URL(address).pathname
        )
          return false;
        const method =
          init?.method ?? (input instanceof Request ? input.method : 'GET');
        if (String(method).toUpperCase() !== 'GET') return false;
        const headers = new Headers(
          init?.headers ??
            (input instanceof Request ? input.headers : undefined),
        );
        return (
          headers.has('rsc') && headers.get('next-router-prefetch') !== '1'
        );
      } catch {
        return false;
      }
    };
    const releaseFetch = interceptBrowserFetch(async (args, send) => {
      if (!isConversationRefetch(args[0], args[1])) return send(...args);
      pendingRefetches += 1;
      try {
        return await send(...args);
      } finally {
        pendingRefetches -= 1;
        // The last refetch in flight settling settles the network.
        if (pendingRefetches === 0) recovery.settled();
      }
    });
    // Native default actions are separate from Next's accepted-link notice.
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest('a[href]')
          : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.hasAttribute('download') ||
        ((link.target || document.querySelector('base')?.target) &&
          (link.target || document.querySelector('base')?.target) !== '_self')
      )
        return;
      recovery.stop();
    };
    const submit = (event: SubmitEvent) => {
      queueMicrotask(() => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || event.defaultPrevented)
          return;
        const submitter = event.submitter;
        const target =
          submitter?.getAttribute('formtarget') ??
          (form.target || document.querySelector('base')?.target);
        if (target && target !== '_self') return;
        recovery.stop();
      });
    };
    document.addEventListener('click', navigate);
    document.addEventListener('submit', submit);
    document.addEventListener(shellNavigationEvent, recovery.stop);
    window.addEventListener('popstate', recovery.stop);
    window.addEventListener('pagehide', recovery.stop);
    return () => {
      recovery.stop();
      owner.current = null;
      releaseFetch();
      document.removeEventListener('click', navigate);
      document.removeEventListener('submit', submit);
      document.removeEventListener(shellNavigationEvent, recovery.stop);
      window.removeEventListener('popstate', recovery.stop);
      window.removeEventListener('pagehide', recovery.stop);
    };
  }, [router, startTransition]);
  useBrowserEffect(() => {
    if (!pending) owner.current?.refused(requestId, retryAfterMs, origin);
  }, [requestId, retryAfterMs, pending, origin]);
  return (
    <div className="flex flex-1 flex-col gap-3 p-6 text-ink-muted">
      <StatusRegion as="p" role="status">
        {exhausted
          ? 'This conversation is still unavailable. Try again.'
          : 'This conversation could not load.'}
      </StatusRegion>
      <a href="" className="text-accent underline">
        Try again
      </a>
    </div>
  );
}
