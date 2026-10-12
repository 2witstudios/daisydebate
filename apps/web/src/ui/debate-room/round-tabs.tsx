'use client';

import type { Dispatch } from 'react';
import {
  drawerTabs,
  roundKindOf,
  type DrawerTab,
} from '../../features/debate-room/workspace';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import type { IconName } from '../components/icon/icons';
import { tabNames } from './drawer';
import type { RoomAction, RoomState } from './room-state';
import type { RoundSnapshot } from './round';

const icons: Readonly<Record<DrawerTab | 'doc', IconName>> = {
  doc: 'file',
  files: 'book',
  chat: 'message',
  ai: 'sparkle',
  room: 'users',
};

/** A phone's round tabs: the document, then each drawer tab in its place. */
export function RoundTabs({
  round,
  state,
  dispatch,
  unread,
}: {
  readonly round: RoundSnapshot;
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
  readonly unread: number;
}) {
  const tabs = [null, ...drawerTabs(roundKindOf(round.competition))] as const;
  const current = state.phoneDrawer ? state.drawer : null;
  return (
    <nav
      aria-label="Round"
      className="grid shrink-0 auto-cols-fr grid-flow-col border-t border-border bg-surface-sunken px-1 pt-1 pb-5 narrow:hidden"
    >
      {tabs.map((tab) => {
        const name = tab === null ? 'Doc' : tabNames[tab];
        const dot = tab === 'chat' && current !== 'chat' && unread > 0;
        const glyph = icons[tab ?? 'doc'];
        return (
          <button
            key={name}
            type="button"
            aria-current={tab === current ? 'page' : undefined}
            aria-label={dot ? `${name}, ${unread} unread` : undefined}
            onClick={() => dispatch({ type: 'drawer/phone', tab })}
            className={cn(
              'relative flex h-12 cursor-pointer flex-col items-center justify-center gap-px text-xs',
              tab === current ? 'font-strong text-accent' : 'text-ink-muted',
            )}
          >
            <Icon name={glyph} size={20} />
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
