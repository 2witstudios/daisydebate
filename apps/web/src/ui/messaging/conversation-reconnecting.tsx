'use client';

import { useDeliver } from '../edge/use-answer';
import { useResource } from '../edge/use-driver';
import { useDocumentEvent, useWindowEvent } from '../edge/use-dom-events';
import { useRouteReads, type RouteRead } from '../edge/use-route-reads';
import { browserScheduler } from '../edge/browser-time';
import { Announcement } from '../components/announcement/announcement';
import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ConversationRecoveryOrigin } from './conversation-recovery';
import { createConversationRecovery } from './conversation-recovery';
import { shellNavigationEvent } from '../layout/app-shell/shell-navigation';

type ConversationRecovery = ReturnType<typeof createConversationRecovery>;

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
  /**
   * The open recovery, for the page's own listeners. The browser proof
   * (e2e/support/messaging-committed-refusal.ts) finds the owner here, the
   * hook after the transition.
   */
  const active = useRef<ConversationRecovery | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const held = useResource(router, (current) => {
    const address = window.location.href;
    const owner = {
      /** A refresh has asked and its read has not yet finished arriving. */
      awaitingRead: false,
      recovery: createConversationRecovery({
        refresh: () => {
          if (window.location.href !== address) {
            owner.recovery.stop();
            return;
          }
          owner.awaitingRead = true;
          startTransition(() => current.refresh());
        },
        schedule: browserScheduler.after,
        exhausted: () => setExhausted(true),
      }),
      /**
       * The first read of this page to finish after a refresh asked settles
       * it. Recovery holds one refresh at a time, so nothing but that refresh
       * reads this page in between (prefetches and actions are not reads).
       */
      readFinished: ({ url }: RouteRead) => {
        if (!owner.awaitingRead) return;
        if (url.pathname !== new URL(address).pathname) return;
        owner.awaitingRead = false;
        owner.recovery.settled();
      },
      dispose: () => {
        owner.recovery.stop();
        if (active.current === owner.recovery) active.current = null;
      },
    };
    active.current = owner.recovery;
    return owner;
  });
  const recovery = held?.recovery;
  // A discarded held refresh settles its transition on discard while its
  // network read is still in flight. The buffered newest render is adopted
  // only once the route read the latest refresh made has finished arriving,
  // so a wait never dispatches while the held refresh is still on the wire.
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
