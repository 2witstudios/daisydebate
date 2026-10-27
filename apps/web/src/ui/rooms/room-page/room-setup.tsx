'use client';

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import type { RoomView } from '@daisy/protocol';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import { Icon } from '../../components/icon/icon';
import { AssemblyDetails } from './assembly-details';
import { AssemblySettingsForm } from './assembly-settings-form';
import { formatLine, ROOM_SETUP_HREF, ROOM_SETUP_ID } from './room-labels';
import {
  dismissal,
  holdInert,
  releaseInert,
  returnTarget,
  setupOpener,
} from './room-setup-modal';

const competition = {
  ranked: 'Ranked',
  casual: 'Casual',
} as const;

/**
 * Closing is a link to the room itself, so it works without script and a
 * refused save (which keeps the sheet open to show its error) is cleared by
 * the navigation. With script and nothing refused, closing just drops the
 * fragment.
 */
function closeSheet(sheet: HTMLElement | null): boolean {
  if (dismissal(sheet) === 'navigate') return false;
  window.location.hash = '';
  return true;
}

/** The sheet shows while its fragment is the URL's or a refused save is on it. */
export function sheetOpen(hash: string, refused: boolean): boolean {
  return hash === ROOM_SETUP_HREF || refused;
}

/**
 * While the sheet is open the rest of the page is inert, content room sync
 * mounts behind it included, so focus and assistive technology stay in it;
 * opening moves focus to its heading and closing returns it to the link
 * that opened it.
 */
function useModalSheet(
  sheet: RefObject<HTMLElement | null>,
  heading: RefObject<HTMLHeadingElement | null>,
) {
  useEffect(() => {
    const element = sheet.current;
    if (!element) return;
    const held = new Set<HTMLElement>();
    let opener: HTMLElement | null = null;
    let wasOpen = false;
    const sync = () => {
      const open = sheetOpen(
        window.location.hash,
        element.querySelector('[role="alert"]') !== null,
      );
      if (open) holdInert(element, held);
      if (open === wasOpen) return;
      wasOpen = open;
      if (open) {
        opener = setupOpener(document.activeElement) ?? opener;
        heading.current?.focus();
        return;
      }
      releaseInert(held);
      returnTarget(document, opener)?.focus();
      opener = null;
    };
    const remember = (event: Event) => {
      opener = setupOpener(event.target) ?? opener;
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', remember, true);
    window.addEventListener('hashchange', sync);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', remember, true);
      window.removeEventListener('hashchange', sync);
      releaseInert(held);
    };
  }, [sheet, heading]);
}

/** Escape, the close links and an accepted save leave the sheet; focus is managed while it is open. */
function useSheetFocus(roomHref: string) {
  const sheet = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useModalSheet(sheet, heading);
  const key = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (!closeSheet(sheet.current)) window.location.assign(roomHref);
  };
  const close = (event: MouseEvent<HTMLAnchorElement>) => {
    if (closeSheet(sheet.current)) event.preventDefault();
  };
  /** An accepted save leaves the sheet, as the native post's redirect does. */
  const saved = () => {
    closeSheet(sheet.current);
  };
  return { sheet, heading, key, close, saved };
}

/**
 * The host's one place to set up the room: who can join and the
 * resolution, then the round, simple first with the full rules one
 * disclosure away. Both forms keep their native posts.
 */
export function RoomSetup({
  view,
  commandIds,
  detailsAction,
  settingsAction,
}: {
  readonly view: RoomView;
  readonly commandIds: { readonly details: string; readonly settings: string };
  readonly detailsAction: FormAction<RoomFormState>;
  readonly settingsAction: FormAction<RoomFormState>;
}) {
  const roomHref = `/rooms/${view.id}`;
  const { sheet, heading, key, close, saved } = useSheetFocus(roomHref);
  return (
    <section
      ref={sheet}
      id={ROOM_SETUP_ID}
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-setup-title"
      onKeyDown={key}
      className="fixed inset-0 z-40 room-setup"
    >
      <a
        href={roomHref}
        onClick={close}
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 bg-scrim"
      />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-room-sheet flex-col overflow-y-auto border-l border-border bg-surface text-ink shadow-3">
        <header className="flex items-start gap-3 border-b border-border px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2
              ref={heading}
              id="room-setup-title"
              tabIndex={-1}
              className="font-display text-xl font-semibold"
            >
              Room setup
            </h2>
            <p className="text-sm text-ink-muted">
              Everyone in the room sees these. You can change them until the
              round starts.
            </p>
          </div>
          <a
            href={roomHref}
            onClick={close}
            aria-label="Close room setup"
            className="flex size-room-target shrink-0 items-center justify-center rounded-round"
          >
            <Icon name="close" size={18} />
          </a>
        </header>
        <div className="flex flex-col gap-8 px-6 py-6">
          <section
            aria-labelledby="room-setup-room"
            className="flex flex-col gap-4"
          >
            <h3
              id="room-setup-room"
              className="text-xs font-bold tracking-wide text-ink-muted uppercase"
            >
              The room
            </h3>
            <AssemblyDetails
              view={view}
              commandId={commandIds.details}
              action={detailsAction}
              onSaved={saved}
            />
          </section>
          <section
            aria-labelledby="room-setup-round"
            className="flex flex-col gap-4"
          >
            <h3
              id="room-setup-round"
              className="text-xs font-bold tracking-wide text-ink-muted uppercase"
            >
              The round
            </h3>
            <p className="text-sm">
              <span className="font-strong">
                {formatLine(view)} · {competition[view.competitionType]}
              </span>
              <span className="block text-ink-muted">
                The format and rating are set when the room is created.
              </span>
            </p>
            <AssemblySettingsForm
              view={view}
              commandId={commandIds.settings}
              action={settingsAction}
              onSaved={saved}
            />
          </section>
        </div>
      </div>
    </section>
  );
}
