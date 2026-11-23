'use client';

// First: protocol schemas built after this load without Zod's eval probe.
import '../../lib/zod-jitless';
import {
  browserTransport,
  type BrowserTransport,
} from '../edge/browser-request';
import { useDeliver } from '../edge/use-answer';
import { useMutationObserver } from '../edge/use-dom-events';
import {
  defaultNotificationPresentation,
  notificationShellSchema,
  type NotificationShell,
} from '@daisy/protocol/notifications';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  arrivalKey,
  arrivalsOf,
  shownOn,
  titleWith,
  TOASTS_SHOWN,
} from '../../features/notifications/shell-policy';
import {
  createNotificationShellSyncDriver,
  seedNotificationShellSync,
} from '../../features/notifications/shell-sync-driver';
import { browserSyncEdges } from '../resource-sync/browser';
import type { ResourceRead } from '../../features/resource-sync/driver';
import { useDriver } from '../edge/use-driver';
import { NotificationToast } from './notification-toast';

type Recent = NotificationShell['recent'][number];

const ShellContext = createContext<NotificationShell | null>(null);

/** Nothing known yet: no count, nothing recent, everything on. */
const emptyShell: NotificationShell = {
  version: 1,
  unread: 0,
  recent: [],
  presentation: defaultNotificationPresentation,
};

/** The member's notifications as the shell holds them; null for a visitor. */
export const useNotificationShell = (): NotificationShell | null =>
  useContext(ShellContext);

const readShell = async (
  transport: BrowserTransport = browserTransport,
): Promise<ResourceRead<NotificationShell>> => {
  const response = await transport('/api/notifications/shell', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  // jitless: the strict CSP refuses Zod's eval-compiled parser.
  const parsed = notificationShellSchema.safeParse(
    response.ok ? await response.json() : null,
    { jitless: true },
  );
  return parsed.success
    ? { kind: 'found', value: parsed.data }
    : { kind: 'unavailable' };
};

const markRead = (
  ids: readonly string[],
  transport: BrowserTransport = browserTransport,
) =>
  transport('/api/notifications/read', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, kind: 'some', notificationIds: ids }),
  }).catch(() => null);

/** A short two-note chime, made here so no sound file is fetched. */
const chime = () => {
  try {
    const audio = new AudioContext();
    const gain = audio.createGain();
    gain.gain.value = 0.08;
    gain.connect(audio.destination);
    const notes = [880, 1320];
    notes.forEach((frequency, index) => {
      const tone = audio.createOscillator();
      tone.frequency.value = frequency;
      tone.connect(gain);
      const at = audio.currentTime + index * 0.12;
      tone.start(at);
      tone.stop(at + 0.1);
      // The chime's context closes once its last note has sounded.
      if (index === notes.length - 1) tone.onended = () => void audio.close();
    });
  } catch {
    // No audio here, or the browser refused it without a gesture yet.
  }
};

/** Desktop alerts may be raised: chosen, granted, and Daisy is in another tab. */
const mayAlert = (presentation: NotificationShell['presentation']) =>
  presentation.desktopAlerts &&
  document.visibilityState === 'hidden' &&
  typeof Notification !== 'undefined' &&
  Notification.permission === 'granted';

/** What needs the member now: a chime, and a desktop alert when they are elsewhere. */
const alertUrgent = (
  urgent: readonly Recent[],
  presentation: NotificationShell['presentation'],
  open: (href: string) => void,
) => {
  if (urgent.length === 0) return;
  if (presentation.sound) chime();
  if (!mayAlert(presentation)) return;
  for (const row of urgent) {
    const alert = new Notification('Daisy Debate', {
      body: row.text,
      tag: row.id,
    });
    alert.onclick = () => {
      window.focus();
      open(row.href);
      alert.close();
    };
  }
};

/**
 * The tab's one view of the member's notifications (ADR 0144). A ring on
 * their inbox, or a backstop, re-reads the shell; each read sets the badge
 * count and the title, presents what is new (a toast; for an urgent kind a
 * chime, and a desktop alert while Daisy is in another tab), and marks read
 * what the current page already shows. Every one of these is a view of a
 * stored row: what it shows is what the inbox holds.
 */
export function NotificationShellProvider({
  initialShell,
  actorId,
  socketUrl,
  children,
}: {
  /** The server's read, or null when it failed: the first browser read is then the baseline. */
  readonly initialShell: NotificationShell | null;
  readonly actorId: string;
  readonly socketUrl: string | null;
  readonly children: ReactNode;
}) {
  const [seed] = useState(initialShell ?? emptyShell);
  const start = useCallback(() => {
    const { connection, ...edges } = browserSyncEdges(socketUrl);
    return createNotificationShellSyncDriver({
      seed,
      read: () => readShell(),
      inbox: connection ? { actorId, connection } : null,
      ...edges,
    });
  }, [actorId, seed, socketUrl]);
  const [sync, driver] = useDriver(
    () => seedNotificationShellSync(seed, 0),
    start,
  );
  const shell = sync.value;
  const path = usePathname();
  const router = useRouter();
  const [toasts, setToasts] = useState<readonly Recent[]>([]);
  // Null until the first read is seen: what waited before is not news.
  const seen = useRef<Set<string> | null>(null);
  const marked = useRef(new Set<string>());

  const arrived = useMemo(() => ({ shell, path }), [shell, path]);
  useDeliver(arrived, () => {
    // Without the server's read the seed says nothing about what was waiting:
    // the first real read only learns it, so old rows never burst in as news.
    if (initialShell === null && shell === seed) return;
    const arrivals = arrivalsOf({
      seen: seen.current,
      recent: shell.recent,
      path,
    });
    seen.current = new Set([
      ...(seen.current ?? []),
      ...shell.recent.map(arrivalKey),
    ]);
    if (shell.presentation.toasts && arrivals.toasts.length > 0)
      setToasts((shown) => [...arrivals.toasts, ...shown]);
    alertUrgent(arrivals.urgent, shell.presentation, (href) =>
      router.push(href),
    );
  });

  // The page the member is on shows these: they are read.
  const surfacing = useMemo(
    () => ({ shell, path, driver }),
    [shell, path, driver],
  );
  useDeliver(surfacing, () => {
    // Keyed by arrival: a row brought back unread is read again here.
    const shown = new Set(shownOn(shell.recent, path));
    const surfaced = shell.recent.filter(
      (row) => shown.has(row.id) && !marked.current.has(arrivalKey(row)),
    );
    if (surfaced.length === 0) return;
    for (const row of surfaced) marked.current.add(arrivalKey(row));
    const here = surfaced.map((row) => row.id);
    setToasts((shown) => shown.filter((row) => !here.includes(row.id)));
    void markRead(here).then(() => driver?.signal());
  });

  // Next sets the title on each navigation, after this renders: keep the
  // count on it. Writing only a changed title cannot loop.
  useMutationObserver(
    shell.unread,
    () => document.querySelector('title'),
    { childList: true, characterData: true, subtree: true },
    () => {
      const next = titleWith(document.title, shell.unread);
      if (next !== document.title) document.title = next;
    },
  );

  const dismiss = useCallback(
    (id: string) => setToasts((shown) => shown.filter((row) => row.id !== id)),
    [],
  );
  // A toast whose row was read elsewhere (another tab) is no longer news.
  const unread = new Set(shell.recent.map((row) => row.id));
  const live = toasts.filter((row) => unread.has(row.id));
  const visible = live.slice(0, TOASTS_SHOWN);
  const more = live.length - visible.length;
  return (
    <ShellContext.Provider value={shell}>
      {children}
      <section
        aria-label="New notifications"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 top-16 z-50 flex flex-col items-center gap-2 narrow:right-4 narrow:left-auto narrow:w-toast"
      >
        {visible.map((row) => (
          <NotificationToast
            key={row.id}
            row={row}
            dismiss={() => dismiss(row.id)}
          />
        ))}
        {more > 0 ? (
          <p className="pointer-events-auto flex w-full items-center gap-3 rounded-lg border border-border bg-surface-raised py-1 pr-1 pl-4 text-base shadow-2">
            <span className="flex-1">
              <strong className="font-semibold">{more} more</strong> in your
              inbox
            </span>
            <Link
              href="/notifications"
              className="inline-flex min-h-toast-target items-center px-3 font-semibold"
            >
              Open inbox
            </Link>
          </p>
        ) : null}
      </section>
    </ShellContext.Provider>
  );
}
