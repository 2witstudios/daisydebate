'use client';

// First: protocol schemas built after this load without Zod's eval probe.
import '../../lib/zod-jitless';
import {
  buildUserInboxTopic,
  challengeListSchema,
  type ChallengeList,
} from '@daisy/protocol';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { tabConnection } from '../../features/realtime/browser-adapters';
import { ROSTER_CEILING_MS } from '../../features/presence/refresh-schedule';

type ChallengeView = {
  readonly challenges: ChallengeList;
  /** People whose offer from this member ended without the member ending it. */
  readonly endedOffers: readonly string[];
  readonly dismissEnded: (username: string) => void;
  /** The member is withdrawing this offer, so its end needs no notice. */
  readonly noteCancelled: (id: string) => void;
  /** That withdrawal failed, so the offer's end needs a notice after all. */
  readonly forgetCancelled: (id: string) => void;
  /** Re-reads at once, after the member's own action. */
  readonly refresh: () => void;
};

/** How often a member with an open offer checks it still stands. */
const OFFER_WATCH_MS = 5_000;

const ChallengeContext = createContext<ChallengeView | null>(null);

export const useChallenges = (): ChallengeView => {
  const view = useContext(ChallengeContext);
  if (!view) throw new Error('useChallenges needs a ChallengeProvider');
  return view;
};

const challengeRead = challengeListSchema.loose();

const readList = async () => {
  try {
    const response = await fetch('/api/challenges', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    // jitless: the strict CSP refuses Zod's eval-compiled parser.
    const parsed = challengeRead.safeParse(
      response.ok ? await response.json() : null,
      { jitless: true },
    );
    return parsed.success ? (parsed.data as ChallengeList) : null;
  } catch {
    return null;
  }
};

/**
 * The tab's one view of this member's challenges (ADR 0103), with its own
 * lifecycle: only the socket is shared with the online list. A ring on the
 * member's inbox asks for a fresh read, and a timer covers one that never comes.
 */
export function ChallengeProvider({
  initialChallenges,
  actorId,
  socketUrl,
  children,
}: {
  readonly initialChallenges: ChallengeList;
  readonly actorId: string | null;
  readonly socketUrl: string | null;
  readonly children: ReactNode;
}) {
  const [challenges, setChallenges] = useState(initialChallenges);
  const [endedOffers, setEndedOffers] = useState<readonly string[]>([]);
  // Only the newest answer lands: a slow one must not restore a removed card.
  const seq = useRef(0);
  const shown = useRef(initialChallenges);
  const cancelled = useRef(new Set<string>());
  const read = useCallback(async () => {
    seq.current += 1;
    const mine = seq.current;
    const list = await readList();
    if (!list || mine !== seq.current) return;
    const gone = shown.current.outgoing.filter(
      (offer) =>
        !cancelled.current.has(offer.id) &&
        !list.outgoing.some((next) => next.id === offer.id) &&
        !list.accepted.some((next) => next.id === offer.id),
    );
    if (gone.length > 0)
      setEndedOffers((current) => [
        ...new Set([...current, ...gone.map((offer) => offer.username)]),
      ]);
    shown.current = list;
    setChallenges(list);
  }, []);

  useEffect(() => {
    const poll = setInterval(() => void read(), ROSTER_CEILING_MS);
    return () => clearInterval(poll);
  }, [read]);

  useEffect(() => {
    if (socketUrl === null || actorId === null) return;
    const connection = tabConnection(socketUrl);
    connection.connect();
    const stop = connection.subscribeTopic(
      buildUserInboxTopic(actorId),
      (frame) => {
        // A ring missed while the socket was down reads on re-subscribing.
        if (
          frame.type === 'subscribed' ||
          (frame.type === 'event' && frame.payload.kind === 'challenge.changed')
        )
          void read();
      },
    );
    return () => {
      stop();
      connection.dispose();
    };
  }, [actorId, read, socketUrl]);

  // An offer running out rings nobody, so while one stands, keep reading.
  const offersOpen =
    challenges.outgoing.length > 0 || challenges.incoming.length > 0;
  useEffect(() => {
    if (!offersOpen) return;
    const watch = setInterval(() => void read(), OFFER_WATCH_MS);
    return () => clearInterval(watch);
  }, [offersOpen, read]);

  const dismissEnded = useCallback((username: string) => {
    setEndedOffers((current) => current.filter((name) => name !== username));
  }, []);
  const noteCancelled = useCallback((id: string) => {
    cancelled.current.add(id);
  }, []);
  const forgetCancelled = useCallback((id: string) => {
    cancelled.current.delete(id);
  }, []);
  const refresh = useCallback(() => void read(), [read]);

  const view = useMemo(
    () => ({
      challenges,
      endedOffers,
      dismissEnded,
      noteCancelled,
      forgetCancelled,
      refresh,
    }),
    [
      challenges,
      dismissEnded,
      endedOffers,
      forgetCancelled,
      noteCancelled,
      refresh,
    ],
  );
  return (
    <ChallengeContext.Provider value={view}>
      {children}
    </ChallengeContext.Provider>
  );
}
