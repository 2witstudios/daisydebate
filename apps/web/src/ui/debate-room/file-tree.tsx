'use client';

import type { Dispatch } from 'react';
import type { WorkspaceDocument } from '../../features/debate-room/documents/documents';
import type { TreeNode } from '../../features/debate-room/workspace';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import type { RoomAction } from './room-state';

/** The live transcript is a file of the round, opened like a document. */
export const TRANSCRIPT_ID = 'transcript';

const row = (current: boolean) =>
  cn(
    'flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm transition-colors',
    current ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink',
  );

type Props = {
  readonly tree: readonly TreeNode[];
  readonly active: string | null;
  readonly dispatch: Dispatch<RoomAction>;
  readonly transcriptAvailable?: boolean;
};

/** This round, My library and the club's shared files. */
export function FileTree({
  tree,
  active,
  dispatch,
  transcriptAvailable = true,
}: Props) {
  const open = (id: string) => dispatch({ type: 'tabs/open', id });
  return (
    <nav
      aria-label="Files"
      className="flex min-w-0 flex-1 flex-col gap-px bg-background p-2"
    >
      <div className="flex items-center justify-between pl-2">
        <h2 className="text-xs font-strong tracking-wider text-ink-muted uppercase">
          Files
        </h2>
        <button
          type="button"
          aria-label="New document"
          aria-keyshortcuts="Meta+K Control+K"
          className="flex size-8 cursor-pointer items-center justify-center rounded-sm text-ink-muted hover:text-ink"
          onClick={() => dispatch({ type: 'palette/open' })}
        >
          <Icon name="plus" size={16} />
        </button>
      </div>
      {tree.map((node) => (
        <section key={node.folder.id} aria-label={node.folder.title}>
          <h3 className="flex items-center gap-1 px-1 pt-2 pb-1 text-xs font-strong text-ink-faint">
            <Icon name="chevronDown" size={14} />
            <span className="min-w-0 flex-1 truncate">{node.folder.title}</span>
            {node.folder.shared ? (
              <Icon name="users" size={14} label="Shared with club" />
            ) : null}
          </h3>
          <ul className="flex flex-col gap-px">
            {node.folder.id === 'round' && transcriptAvailable ? (
              <li>
                <button
                  type="button"
                  aria-current={active === TRANSCRIPT_ID ? 'page' : undefined}
                  className={row(active === TRANSCRIPT_ID)}
                  onClick={() => open(TRANSCRIPT_ID)}
                >
                  <Icon name="wave" size={15} />
                  <span className="min-w-0 flex-1 truncate">Transcript</span>
                  <span
                    aria-label="Live"
                    className="size-2 rounded-round bg-live"
                  />
                </button>
              </li>
            ) : null}
            {node.documents.map((doc: WorkspaceDocument) => (
              <li key={doc.id}>
                <button
                  type="button"
                  aria-current={active === doc.id ? 'page' : undefined}
                  className={row(active === doc.id)}
                  onClick={() => open(doc.id)}
                >
                  <Icon name="file" size={15} />
                  <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

type TabsProps = {
  readonly tabs: readonly { readonly id: string; readonly title: string }[];
  readonly active: string | null;
  readonly dispatch: Dispatch<RoomAction>;
};

/** Open files across the top of the editor; the active tab joins the page. */
export function DocumentTabs({ tabs, active, dispatch }: TabsProps) {
  return (
    <div
      role="group"
      aria-label="Open files"
      className="flex gap-px overflow-x-auto bg-background px-1 pt-1"
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            'group flex shrink-0 items-center rounded-t-sm',
            tab.id === active
              ? 'bg-surface-raised text-ink'
              : 'text-ink-faint hover:text-ink-muted',
          )}
        >
          <button
            type="button"
            aria-current={tab.id === active ? 'page' : undefined}
            className="h-8 cursor-pointer pr-1 pl-3 text-sm whitespace-nowrap"
            onClick={() => dispatch({ type: 'tabs/activate', id: tab.id })}
          >
            {tab.title}
          </button>
          <button
            type="button"
            aria-label={`Close ${tab.title}`}
            className="mr-1 flex size-6 cursor-pointer items-center justify-center rounded-sm opacity-60 hover:opacity-100"
            onClick={() => dispatch({ type: 'tabs/close', id: tab.id })}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
