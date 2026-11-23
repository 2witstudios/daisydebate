'use client';

import { useDeliver } from '../edge/use-answer';
import { useResource } from '../edge/use-driver';
import { useDocumentEvent, useWindowEvent } from '../edge/use-dom-events';
import { useRouteReads, type RouteRead } from '../edge/use-route-reads';
import { browserScheduler } from '../edge/browser-time';
import { Announcement } from '../components/announcement/announcement';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ConversationRecoveryOrigin } from './conversation-recovery';
import { createConversationRecovery } from './conversation-recovery';
import { shellNavigationEvent } from '../layout/app-shell/shell-navigation';

/** A same-tab target: the link or form leaves this page in place of a new one. */
const sameTab = (target: string | null | undefined) =>
  !target || target === '_self';
const baseTarget = () => document.querySelector('base')?.target;

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
  const [exhausted, setExhausted] = useState(false);
  const held = useResource(router, (current) => {
    const address = window.location.href;
    const owner = {
      /** When the latest refresh asked, on the page's monotonic clock. */
      refreshedAtMs: null as number | null,
      recovery: createConversationRecovery({
        refresh: () => {
          if (window.location.href !== address) {
            owner.recovery.stop();
            return;
          }
          owner.refreshedAtMs = performance.now();
          startTransition(() => current.refresh());
        },
        schedule: browserScheduler.after,
        exhausted: () => setExhausted(true),
      }),
      /** A finished read of this page that the latest refresh started settles it. */
      readFinished: ({ url, startedMs }: RouteRead) => {
        if (owner.refreshedAtMs === null) return;
        if (url.pathname !== new URL(address).pathname) return;
        if (startedMs < owner.refreshedAtMs) return;
        owner.refreshedAtMs = null;
        owner.recovery.settled();
      },
      dispose: () => owner.recovery.stop(),
    };
    return owner;
  });
  const recovery = held?.recovery;
  // A discarded held refresh settles its transition on discard while its
  // network read is still in flight. The buffered newest render is adopted
  // only once a route read of this page that started with or after the
  // latest refresh has finished arriving, so a wait never dispatches while
  // the held refresh is still on the wire.
  useRouteReads((read) => held?.readFinished(read));
  // Native default actions are separate from Next's accepted-link notice.
  useDocumentEvent('click', (event) => {
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
      event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (
      !(link instanceof HTMLAnchorElement) ||
      link.hasAttribute('download') ||
      !sameTab(link.target || baseTarget())
    )
      return;
    recovery?.stop();
  });
  useDocumentEvent('submit', (event) => {
    queueMicrotask(() => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || event.defaultPrevented) return;
      const target =
        event.submitter?.getAttribute('formtarget') ??
        (form.target || baseTarget());
      if (!sameTab(target)) return;
      recovery?.stop();
    });
  });
  useDocumentEvent(shellNavigationEvent, () => recovery?.stop());
  useWindowEvent('popstate', () => recovery?.stop());
  useWindowEvent('pagehide', () => recovery?.stop());
  // Each settled answer is offered once its recovery owner exists.
  const refusal = useMemo(
    () =>
      recovery === undefined || pending
        ? null
        : { recovery, requestId, retryAfterMs, origin },
    [recovery, pending, requestId, retryAfterMs, origin],
  );
  useDeliver(refusal, (offered) =>
    offered?.recovery.refused(
      offered.requestId,
      offered.retryAfterMs,
      offered.origin,
    ),
  );
  return (
    <div className="flex flex-1 flex-col gap-3 p-6 text-ink-muted">
      <Announcement as="p" kind="progress">
        {exhausted
          ? 'This conversation is still unavailable. Try again.'
          : 'This conversation could not load.'}
      </Announcement>
      <a href="" className="text-accent underline">
        Try again
      </a>
    </div>
  );
}
