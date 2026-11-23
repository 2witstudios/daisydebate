'use client';

import { useAnswer, useDeliver } from '../edge/use-answer';
import { useDriver } from '../edge/use-driver';
import { useDocumentEvent, useWindowEvent } from '../edge/use-dom-events';
import { useRouteReads } from '../edge/use-route-reads';
import { browserScheduler } from '../edge/browser-time';
import { Announcement } from '../components/announcement/announcement';
import { useCallback, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ConversationRecoveryOrigin } from './conversation-recovery';
import {
  createConversationReconnectingDriver,
  type ConversationReconnectingSnapshot,
} from './conversation-reconnecting-driver';
import { shellNavigationEvent } from '../layout/app-shell/shell-navigation';

/** A same-tab target: the link or form leaves this page in place of a new one. */
const sameTab = (target: string | null | undefined) =>
  !target || target === '_self';
const baseTarget = () => document.querySelector('base')?.target;
const beginning: ConversationReconnectingSnapshot = { exhausted: false };

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
   * The recovery driver, held right after the transition: the browser proof
   * (e2e/support/messaging-committed-refusal.ts) finds its holder there.
   */
  const start = useCallback(
    () =>
      createConversationReconnectingDriver({
        address: () => window.location.href,
        refresh: () => startTransition(() => router.refresh()),
        scheduler: browserScheduler,
      }),
    [router],
  );
  const [{ exhausted }, recovery] = useDriver(() => beginning, start);
  // The buffered newest render is adopted only once the held refresh has
  // finished (refresh-settlement.ts), so a wait never dispatches while it is
  // still on the wire.
  useRouteReads((read) => recovery?.readFinished(read.url));
  const transition = useMemo(
    () => ({ owner: recovery, pending }),
    [recovery, pending],
  );
  useAnswer(transition, ({ owner, pending: running }) =>
    owner?.transitionRan(running),
  );

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
      recovery === null || pending
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
