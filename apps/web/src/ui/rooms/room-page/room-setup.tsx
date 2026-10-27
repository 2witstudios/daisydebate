'use client';

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import type { RoomCatalogChoice, RoomView } from '@daisy/protocol';
import type { RoomCommandIds } from '../../../features/rooms/room-command-ids';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import { Icon } from '../../components/icon/icon';
import { AssemblyDetails } from './assembly-details';
import { AssemblySettingsForm } from './assembly-settings-form';
import { FormatChoice } from './format-choice';
import { formatLine, ROOM_SETUP_ID } from './room-labels';
import { dismissal, modalSheet } from './room-setup-modal';

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

/** An accepted save leaves setup even when a sibling form still holds a refusal. */
export function finishSetupSave(close: () => boolean, navigate: () => void) {
  if (!close()) navigate();
}

/**
 * The sheet's modal behaviour (`modalSheet`), held for as long as it is
 * mounted.
 */
function useModalSheet(
  sheet: RefObject<HTMLElement | null>,
  heading: RefObject<HTMLHeadingElement | null>,
) {
  useEffect(() => {
    const element = sheet.current;
    if (!element) return;
    return modalSheet({
      window,
      sheet: element,
      heading: () => heading.current,
    });
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
    finishSetupSave(
      () => closeSheet(sheet.current),
      () => window.location.assign(roomHref),
    );
  };
  return { sheet, heading, key, close, saved };
}

/**
 * The host's one place to set up the room: who can join and the
 * resolution, then the round: its format (Daisy's standards or Custom)
 * and settings, simple first with the full rules one disclosure away. Both forms keep their native posts.
 */
export function RoomSetup({
  view,
  choices,
  commandIds,
  formatIds,
  detailsAction,
  settingsAction,
  commandAction,
}: {
  readonly view: RoomView;
  /** The picker's catalog: Daisy's standards and league templates (FMT-3). */
  readonly choices: readonly RoomCatalogChoice[];
  readonly commandIds: { readonly details: string; readonly settings: string };
  readonly formatIds: RoomCommandIds['format'];
  readonly detailsAction: FormAction<RoomFormState>;
  readonly settingsAction: FormAction<RoomFormState>;
  readonly commandAction: FormAction<RoomFormState>;
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
            {view.competitionType === 'ranked' ? (
              <p className="text-sm">
                <span className="font-strong">
                  {view.format.name} · {formatLine(view)} ·{' '}
                  {competition[view.competitionType]}
                </span>
                <span className="block text-ink-muted">
                  Ranked rooms run their format unchanged.
                </span>
              </p>
            ) : (
              <FormatChoice
                view={view}
                choices={choices}
                ids={formatIds}
                action={commandAction}
              />
            )}
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
