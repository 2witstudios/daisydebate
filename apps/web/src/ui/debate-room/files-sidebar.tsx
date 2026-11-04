'use client';

import type { Dispatch } from 'react';
import { flushSync } from 'react-dom';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import { FileTree } from '../documents/file-tree';
import type { DriveActions } from '../documents/use-drive';
import { RoomDetails } from './room-details';
import type { RoomAction, RoomState } from './room-state';
import type { RoundSnapshot } from './round';

export const FILES_ID = 'drive-files';
export const FILES_HIDE_ID = 'drive-files-hide';
export const FILES_SHOW_ID = 'drive-files-show';

const headerButton =
  'flex size-dense-target shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-surface-raised';

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
      onClick={() => {
        // This button goes away with the click, so focus moves with it.
        flushSync(() => dispatch({ type: 'files/toggle' }));
        document.getElementById(FILES_HIDE_ID)?.focus();
      }}
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
  drive,
  phoneClass,
}: {
  readonly round: RoundSnapshot;
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
  readonly drive: DriveActions;
  /** Hides the sidebar on a phone unless its tab is showing. */
  readonly phoneClass: string | false;
}) {
  return (
    <aside
      id={FILES_ID}
      aria-label="Your files"
      className={cn(
        'flex min-h-0 w-drive shrink-0 flex-col border-r border-border bg-surface max-compact:w-full max-compact:flex-1 max-compact:border-r-0',
        !state.filesOpen && 'compact:hidden',
        phoneClass,
      )}
    >
      <div className="flex h-12 shrink-0 items-center border-b border-border pr-1 pl-4">
        <h2 className="flex-1 text-sm font-strong">Files</h2>
        <button
          type="button"
          aria-label="New"
          onClick={() => dispatch({ type: 'palette/open', mode: 'create' })}
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
      <div className="flex min-h-0 flex-1 flex-col pt-2">
        <FileTree
          tree={state.drive}
          active={state.tabs.active}
          renaming={state.renaming}
          dispatch={dispatch}
          drive={drive}
        />
      </div>
      <details className="shrink-0 border-t border-border max-compact:hidden">
        <summary className="flex h-room-target cursor-pointer items-center px-4 text-sm font-strong">
          Room
        </summary>
        <div className="flex max-h-room-details flex-col overflow-y-auto px-3 pb-3">
          <RoomDetails round={round} />
        </div>
      </details>
    </aside>
  );
}
