'use client';

import type { Dispatch } from 'react';
import {
  phonePanels,
  type PhonePanel,
} from '../../features/debate-room/workspace';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import type { IconName } from '../components/icon/icons';
import { phonePanelOf, type RoomAction, type RoomState } from './room-state';

const panels: Readonly<
  Record<PhonePanel, { readonly name: string; readonly icon: IconName }>
> = {
  doc: { name: 'Doc', icon: 'file' },
  transcript: { name: 'Transcript', icon: 'mic' },
  channels: { name: 'Channels', icon: 'message' },
  ai: { name: 'AI chat', icon: 'sparkle' },
  files: { name: 'Files', icon: 'book' },
  room: { name: 'Room', icon: 'users' },
};

/** The phone round tab that is showing, the target a focus return lands on. */
export const CURRENT_ROUND_TAB =
  'nav[aria-label="Round"] [aria-current="page"]';

/** The phone round tab bar's Doc tab: the way back when none is current. */
export const FIRST_ROUND_TAB = 'nav[aria-label="Round"] button';

/** The phone round tab bar itself: a breakpoint crossing can hide it under focus. */
export const ROUND_TAB_BAR = 'nav[aria-label="Round"]';

/** A phone's round tabs: one panel at a time below the video. */
export function RoundTabs({
  state,
  dispatch,
  unread,
  hydrated,
}: {
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
  readonly unread: number;
  /** Before script these buttons could not switch anything. */
  readonly hydrated: boolean;
}) {
  if (!hydrated) return null;
  return (
    <nav
      aria-label="Round"
      className="grid shrink-0 auto-cols-fr grid-flow-col border-t border-border bg-surface-sunken px-1 pt-1 pb-5 compact:hidden"
    >
      {phonePanels.map((panel) => {
        const { name, icon } = panels[panel];
        const current = phonePanelOf(state) === panel;
        const dot = panel === 'channels' && !current && unread > 0;
        return (
          <button
            key={panel}
            type="button"
            aria-current={current ? 'page' : undefined}
            aria-label={dot ? `${name}, ${unread} unread` : undefined}
            onClick={() => dispatch({ type: 'phone/panel', panel })}
            className={cn(
              'relative flex h-12 cursor-pointer flex-col items-center justify-center gap-px text-xs',
              current ? 'font-strong text-accent' : 'text-ink-muted',
            )}
          >
            <Icon name={icon} size={20} />
            {name}
            {dot ? (
              <span className="absolute top-1 right-1/4 size-2 rounded-round bg-live" />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
