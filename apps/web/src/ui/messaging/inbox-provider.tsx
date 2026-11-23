'use client';
import { useAnswer, useDeliver } from '../edge/use-answer';
import { useDriver } from '../edge/use-driver';
import {
  browserTransport,
  type BrowserTransport,
} from '../edge/browser-request';
import { browserScheduler } from '../edge/browser-time';
import { tabConnection } from '../edge/realtime-browser';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { systemClock } from '@daisy/clock';
import { readMessagingInboxResponse } from '../../features/messaging/inbox-response';
import type { MessagingInboxPageAnswer } from '../../features/messaging/inbox-view';
import {
  createInboxDriver,
  seedInbox,
  type InboxSnapshot,
} from '../../features/messaging/inbox-driver';

type Inbox = InboxSnapshot & {
  readonly searching: boolean;
  readonly setSearch: (value: string) => void;
  /** Whether the next page was read; a refused read leaves the native link. */
  readonly more: (after: string) => Promise<boolean>;
};
const InboxContext = createContext<Inbox | null>(null);

export const useInbox = () => {
  const inbox = useContext(InboxContext);
  if (inbox === null) throw new Error('The inbox requires its provider');
  return inbox;
};

const readPageThrough =
  (transport: BrowserTransport) =>
  async ({
    q,
    after,
  }: {
    readonly q: string | null;
    readonly after: string | null;
  }) => {
    const params = new URLSearchParams();
    if (q !== null) params.set('q', q);
    if (after !== null) params.set('after', after);
    const query = params.size > 0 ? `?${params}` : '';
    return readMessagingInboxResponse(
      await transport(`/api/messaging/inbox${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      }),
    );
  };
const readPage = readPageThrough(browserTransport);
/** The inbox on the browser's transport, timers, clock and tab socket. */
const startInbox = (seed: InboxSnapshot) =>
  createInboxDriver({
    seed,
    readPage,
    scheduler: browserScheduler,
    now: () => systemClock.now(),
    connect: tabConnection,
  });

/** The tab's one view of the conversation list (`createInboxDriver`). */
export function InboxProvider({
  seed,
  actorId,
  socketUrl,
  children,
}: {
  readonly seed: (MessagingInboxPageAnswer & { readonly now: string }) | null;
  readonly actorId: string;
  readonly socketUrl: string | null;
  readonly children: ReactNode;
}) {
  const [shown, driver] = useDriver(() => seedInbox(seed), startInbox);
  // A server render elsewhere (a native answer, a refresh) says something changed.
  useAnswer(seed, () => driver?.ring());
  const doorbells = useMemo(
    () => (socketUrl === null ? null : { actorId, socketUrl }),
    [actorId, socketUrl],
  );
  const following = useMemo(() => ({ driver, doorbells }), [driver, doorbells]);
  useDeliver(following, (next) => next.driver?.follow(next.doorbells));
  const setSearch = useCallback(
    (value: string) => driver?.setSearch(value),
    [driver],
  );
  const more = useCallback(
    (after: string) => driver?.more(after) ?? Promise.resolve(false),
    [driver],
  );
  const inbox = useMemo(
    () => ({
      ...shown,
      searching: shown.appliedSearch !== null,
      setSearch,
      more,
    }),
    [shown, setSearch, more],
  );
  return (
    <InboxContext.Provider value={inbox}>{children}</InboxContext.Provider>
  );
}
