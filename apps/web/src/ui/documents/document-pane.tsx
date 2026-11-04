'use client';

import type { Dispatch, ReactNode } from 'react';
import { systemClock } from '@daisy/clock';
import {
  findOpen,
  openTitle,
  type OpenDocument,
  type TabsState,
} from '../../features/documents/open-documents';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import { DocumentEditor } from '../document-editor/document-editor';
import type { ManagerAction } from '../../features/documents/document-manager-state';
import type { PageTone } from '../document-editor/document-editor';

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
  readonly dispatch: Dispatch<ManagerAction>;
  readonly save: SaveState | null;
  readonly leading?: ReactNode;
  readonly onNew?: (() => void) | undefined;
};

/** Open files across the top of the editor, and whether they are saved. */
function DocumentTabs({
  tabs,
  active,
  dispatch,
  save,
  leading,
  onNew,
}: TabsProps) {
  return (
    <div className="flex min-h-tab-strip shrink-0 items-stretch border-b border-border bg-surface">
      {leading}
      <div
        role="group"
        aria-label="Open files"
        className="flex min-w-0 flex-1 overflow-x-auto"
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              'flex shrink-0 items-center border-r border-border',
              tab.id === active
                ? 'bg-surface-raised font-strong text-ink'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            <button
              type="button"
              aria-current={tab.id === active ? 'page' : undefined}
              className="h-full cursor-pointer pr-1 pl-3 text-sm whitespace-nowrap"
              onClick={() => dispatch({ type: 'tabs/activate', id: tab.id })}
            >
              {tab.title}
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              className="flex size-dense-target cursor-pointer items-center justify-center rounded-sm opacity-60 hover:opacity-100"
              onClick={() => dispatch({ type: 'tabs/close', id: tab.id })}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        {onNew ? (
          <button
            type="button"
            aria-label="New document"
            title="New document"
            className="flex h-full w-tab-strip shrink-0 cursor-pointer items-center justify-center text-ink-muted hover:bg-surface-overlay hover:text-ink"
            onClick={onNew}
          >
            <Icon name="plus" size={14} />
          </button>
        ) : null}
      </div>
      {save ? (
        <span
          className={cn(
            'flex shrink-0 items-center px-3 text-xs',
            save === 'unsaved' ? 'text-live' : 'text-ink-muted',
          )}
        >
          {saveLabels[save]}
        </span>
      ) : null}
    </div>
  );
}

/** Shared editor pane for private files in the opening and the active-round workspace. */
export function DocumentPane({
  opened,
  tabs,
  pages,
  onRetry,
  dispatch,
  onEdit,
  empty,
  leading,
  onNew,
  save = null,
}: {
  readonly opened: readonly OpenDocument[];
  /** Asks for a document that did not load again. */
  readonly onRetry?: ((id: string, title: string) => void) | undefined;
  readonly tabs: TabsState;
  readonly pages: Readonly<Record<string, PageTone | null>>;
  readonly dispatch: Dispatch<ManagerAction>;
  readonly onEdit?: ((id: string, html: string) => void) | undefined;
  readonly leading?: ReactNode;
  /** Starts a document from the end of the tabs. */
  readonly onNew?: (() => void) | undefined;
  readonly empty?: ReactNode;
  readonly save?: SaveState | null;
}) {
  const active =
    tabs.active === null ? undefined : findOpen(opened, tabs.active);
  return (
    <>
      <DocumentTabs
        tabs={tabs.open.map((id) => {
          const open = findOpen(opened, id);
          return { id, title: open ? openTitle(open) : '' };
        })}
        active={tabs.active}
        dispatch={dispatch}
        save={save}
        leading={leading}
        onNew={onNew}
      />
      {active?.kind === 'loading' ? (
        <p role="status" className="p-4 text-sm text-ink-muted">
          Opening {active.title}
        </p>
      ) : active?.kind === 'failed' ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 p-4 text-sm"
        >
          <p>{active.title} did not open.</p>
          <button
            type="button"
            onClick={() => onRetry?.(active.id, active.title)}
            className="h-room-target cursor-pointer rounded-sm border border-border px-3 hover:bg-surface-raised"
          >
            Try again
          </button>
        </div>
      ) : active?.kind === 'loaded' ? (
        <DocumentEditor
          key={active.document.id}
          document={active.document}
          access="Only you"
          page={pages[active.document.id] ?? null}
          onPage={(tone) =>
            dispatch({
              type: 'page/tone',
              documentId: active.document.id,
              tone,
            })
          }
          onChange={(html) => {
            dispatch({
              type: 'doc/update',
              id: active.document.id,
              html,
              now: systemClock.now(),
            });
            onEdit?.(active.document.id, html);
          }}
        />
      ) : (
        empty
      )}
    </>
  );
}
