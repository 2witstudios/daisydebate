'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createConversationRecovery } from './conversation-recovery';
import { shellNavigationEvent } from '../layout/app-shell/shell-navigation';

/** Only an explicitly temporary refused page mounts this recovery owner. */
export function ConversationReconnecting({
  requestId,
  retryAfterMs,
}: {
  readonly requestId: string;
  readonly retryAfterMs: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const owner = useRef<ReturnType<typeof createConversationRecovery> | null>(
    null,
  );
  const [exhausted, setExhausted] = useState(false);
  useEffect(() => {
    const address = window.location.href;
    const recovery = createConversationRecovery({
      refresh: () => {
        if (window.location.href === address)
          startTransition(() => router.refresh());
        else recovery.stop();
      },
      schedule: (run, waitMs) => {
        const timer = window.setTimeout(run, waitMs);
        return () => window.clearTimeout(timer);
      },
      exhausted: () => setExhausted(true),
    });
    owner.current = recovery;
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
      document.removeEventListener('click', navigate);
      document.removeEventListener('submit', submit);
      document.removeEventListener(shellNavigationEvent, recovery.stop);
      window.removeEventListener('popstate', recovery.stop);
      window.removeEventListener('pagehide', recovery.stop);
    };
  }, [router, startTransition]);
  useEffect(() => {
    if (!pending) owner.current?.refused(requestId, retryAfterMs);
  }, [requestId, retryAfterMs, pending]);
  return (
    <div className="flex flex-1 flex-col gap-3 p-6 text-ink-muted">
      <p role="status">
        {exhausted
          ? 'This conversation is still unavailable. Try again.'
          : 'This conversation could not load.'}
      </p>
      <a href="" className="text-accent underline">
        Try again
      </a>
    </div>
  );
}
