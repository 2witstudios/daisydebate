'use client';

import type { Dispatch, ReactNode } from 'react';
import { systemClock } from '@daisy/clock';
import type { WorkspaceDocument } from '../../features/debate-room/documents/documents';
import type { TabsState } from '../../features/debate-room/workspace';
import { DocumentEditor } from './editor/document-editor';
import { DocumentTabs } from './file-tree';
import type { RoomAction, PageTone } from './room-state';

/** Shared editor pane for scheduled private files and the active-round workspace. */
export function DocumentPane({
  documents,
  tabs,
  pages,
  dispatch,
  onEdit,
  children,
  empty,
}: {
  readonly documents: readonly WorkspaceDocument[];
  readonly tabs: TabsState;
  readonly pages: Readonly<Record<string, PageTone>>;
  readonly dispatch: Dispatch<RoomAction>;
  readonly onEdit?: ((id: string, html: string) => void) | undefined;
  readonly children?: ReactNode;
  readonly empty?: ReactNode;
}) {
  const active = documents.find((d) => d.id === tabs.active);
  return (
    <>
      <DocumentTabs
        tabs={tabs.open.map((id) => ({
          id,
          title:
            id === 'transcript'
              ? 'Transcript'
              : (documents.find((d) => d.id === id)?.title ?? ''),
        }))}
        active={tabs.active}
        dispatch={dispatch}
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
