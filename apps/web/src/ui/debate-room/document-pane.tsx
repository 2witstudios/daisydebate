'use client';

import type { Dispatch, ReactNode } from 'react';
import { systemClock } from '@daisy/clock';
import type { WorkspaceDocument } from '../../features/debate-room/documents/documents';
import type { TabsState } from '../../features/debate-room/workspace';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import { TRANSCRIPT_ID } from './drawer-files';
import { DocumentEditor } from './editor/document-editor';
import type { RoomAction, PageTone } from './room-state';

/** Whether the open files are stored; null where nothing saves. */
export type SaveState = 'saved' | 'saving' | 'unsaved';

const saveLabels: Readonly<Record<SaveState, string>> = {
  saved: 'Saved',
  saving: 'Saving',
  unsaved: 'Not saved',
};

type TabsProps = {
  readonly tabs: readonly { readonly id: string; readonly title: string }[];
  readonly active: string | null;
  readonly dispatch: Dispatch<RoomAction>;
  readonly save: SaveState | null;
};

/** Open files across the top of the editor, and whether they are saved. */
function DocumentTabs({ tabs, active, dispatch, save }: TabsProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4">
      <div
        role="group"
        aria-label="Open files"
        className="flex min-w-0 flex-1 gap-px overflow-x-auto"
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              'flex shrink-0 items-center border-b-2',
              tab.id === active
                ? 'border-accent font-strong text-ink'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            <button
              type="button"
              aria-current={tab.id === active ? 'page' : undefined}
              className="h-room-target cursor-pointer pr-1 pl-3 text-sm whitespace-nowrap"
              onClick={() => dispatch({ type: 'tabs/activate', id: tab.id })}
            >
              {tab.title}
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              className="flex size-room-target cursor-pointer items-center justify-center rounded-sm opacity-60 hover:opacity-100"
              onClick={() => dispatch({ type: 'tabs/close', id: tab.id })}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
      </div>
      {save ? (
        <span
          className={cn(
            'shrink-0 text-xs',
            save === 'unsaved' ? 'text-live' : 'text-ink-muted',
          )}
        >
          {saveLabels[save]}
        </span>
      ) : null}
    </div>
  );
}

/** Shared editor pane for scheduled private files and the active-round workspace. */
export function DocumentPane({
  documents,
  tabs,
  pages,
  dispatch,
  onEdit,
  children,
  empty,
  save = null,
}: {
  readonly documents: readonly WorkspaceDocument[];
  readonly tabs: TabsState;
  readonly pages: Readonly<Record<string, PageTone>>;
  readonly dispatch: Dispatch<RoomAction>;
  readonly onEdit?: ((id: string, html: string) => void) | undefined;
  readonly children?: ReactNode;
  readonly empty?: ReactNode;
  readonly save?: SaveState | null;
}) {
  const active = documents.find((d) => d.id === tabs.active);
  return (
    <>
      <DocumentTabs
        tabs={tabs.open.map((id) => ({
          id,
          title:
            id === TRANSCRIPT_ID
              ? 'Transcript'
              : (documents.find((d) => d.id === id)?.title ?? ''),
        }))}
        active={tabs.active}
        dispatch={dispatch}
        save={save}
      />
      {children}
      {active ? (
        <DocumentEditor
          key={active.id}
          document={active}
          access={active.folder === 'club' ? 'Club' : 'Only you'}
          page={pages[active.id] ?? 'dark'}
          onPage={(tone) =>
            dispatch({ type: 'page/tone', documentId: active.id, tone })
          }
          onChange={(html) => {
            dispatch({
              type: 'doc/update',
              id: active.id,
              html,
              now: systemClock.now(),
            });
            onEdit?.(active.id, html);
          }}
        />
      ) : (
        empty
      )}
    </>
  );
}
