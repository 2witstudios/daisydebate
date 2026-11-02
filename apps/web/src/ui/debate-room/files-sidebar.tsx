'use client';

import { useMemo, type Dispatch } from 'react';
import { buildTree } from '../../features/debate-room/workspace';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import { DrawerFiles } from './drawer-files';
import { DrawerRoom } from './drawer-room';
import type { RoomAction, RoomState } from './room-state';
import type { RoundSnapshot } from './round';

export const FILES_ID = 'round-files';
export const FILES_HIDE_ID = 'round-files-hide';
export const FILES_SHOW_ID = 'round-files-show';

const headerButton =
  'flex size-room-target shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-surface-raised';

/** The closed Files sidebar's way back, at the start of the document tabs. */
export function ShowFiles({
  state,
  dispatch,
}: {
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
}) {
  if (state.filesOpen) return null;
  return (
    <button
      id={FILES_SHOW_ID}
      type="button"
      aria-label="Show files"
      aria-expanded="false"
      aria-controls={FILES_ID}
      onClick={() => dispatch({ type: 'files/toggle' })}
      className={cn(headerButton, 'max-compact:hidden')}
    >
      <Icon name="drawer" size={18} />
    </button>
  );
}

/** The viewer's drives, and who is in the Round below them. */
export function FilesSidebar({
  round,
  state,
  dispatch,
  onNew,
  transcribing,
  phoneClass,
}: {
  readonly round: RoundSnapshot;
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
  readonly onNew: () => void;
  readonly transcribing: boolean;
  /** Hides the sidebar on a phone unless its tab is showing. */
  readonly phoneClass: string | false;
}) {
  const tree = useMemo(
    () => buildTree(state.documents, round.clubName),
    [state.documents, round.clubName],
  );
  return (
    <aside
      id={FILES_ID}
      aria-label="Your files"
      className={cn(
        'flex min-h-0 w-round-drawer shrink-0 flex-col border-r border-border bg-surface max-compact:w-full max-compact:flex-1 max-compact:border-r-0',
        !state.filesOpen && 'compact:hidden',
        phoneClass,
      )}
    >
      <div className="flex h-12 shrink-0 items-center border-b border-border pr-1 pl-4">
        <h2 className="flex-1 text-sm font-strong">Files</h2>
        <button
          type="button"
          aria-label="New document"
          onClick={onNew}
          className={headerButton}
        >
          <Icon name="plus" size={18} />
        </button>
        <button
          id={FILES_HIDE_ID}
          type="button"
          aria-label="Hide files"
          aria-expanded={state.filesOpen}
          aria-controls={FILES_ID}
          onClick={() => dispatch({ type: 'files/toggle' })}
          className={cn(headerButton, 'max-compact:hidden')}
        >
          <Icon name="drawer" size={18} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <DrawerFiles
          tree={tree}
          active={state.tabs.active}
          dispatch={dispatch}
        />
      </div>
      <details className="shrink-0 border-t border-border max-compact:hidden">
        <summary className="flex h-room-target cursor-pointer items-center px-4 text-sm font-strong">
          Room
        </summary>
        <div className="flex max-h-room-details flex-col overflow-y-auto px-3 pb-3">
          <DrawerRoom round={round} transcribing={transcribing} />
        </div>
      </details>
    </aside>
  );
}
