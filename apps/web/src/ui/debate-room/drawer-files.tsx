'use client';

import type { Dispatch } from 'react';
import type { WorkspaceDocument } from '../../features/debate-room/documents/documents';
import { TRANSCRIPT_ID } from '../../features/debate-room/transcript';
import type { TreeNode } from '../../features/debate-room/workspace';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import type { RoomAction } from './room-state';

const row = (current: boolean) =>
  cn(
    'flex h-room-target w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm transition-colors',
    current
      ? 'bg-surface-overlay font-strong text-ink'
      : 'text-ink hover:bg-surface-raised',
  );

type Props = {
  readonly tree: readonly TreeNode[];
  readonly active: string | null;
  readonly dispatch: Dispatch<RoomAction>;
  /** The round's transcript: being written, complete, or none kept. */
  readonly transcript: 'live' | 'complete' | null;
};

/** Open or create, then This round, My library and the club's shared files. */
export function DrawerFiles({ tree, active, dispatch, transcript }: Props) {
  const open = (id: string) => dispatch({ type: 'tabs/open', id });
  return (
    <nav aria-label="Files" className="flex min-h-0 flex-1 flex-col gap-4">
      <button
        type="button"
        aria-keyshortcuts="Meta+K Control+K"
        className="flex h-room-target cursor-pointer items-center gap-2 rounded-sm border border-border px-3 text-sm text-ink-muted hover:text-ink"
        onClick={() => dispatch({ type: 'palette/open' })}
      >
        <Icon name="search" size={16} />
        <span className="min-w-0 flex-1 text-left">Open or create</span>
        <kbd className="rounded-sm border border-border-strong px-1 font-body text-xs">
          ⌘K
        </kbd>
      </button>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {tree.map((node) => (
          <section
            key={node.folder.id}
            aria-label={node.folder.title}
            className="flex flex-col gap-px"
          >
            <h2 className="flex items-center gap-1 px-2 pb-1 text-xs font-strong tracking-wider text-ink-muted uppercase">
              <span className="min-w-0 flex-1 truncate">
                {node.folder.title}
              </span>
              {node.folder.shared ? (
                <Icon name="users" size={14} label="Shared with club" />
              ) : null}
            </h2>
            <ul className="flex flex-col gap-px">
              {node.folder.id === 'round' && transcript !== null ? (
                <li>
                  <button
                    type="button"
                    aria-current={active === TRANSCRIPT_ID ? 'page' : undefined}
                    className={row(active === TRANSCRIPT_ID)}
                    onClick={() => open(TRANSCRIPT_ID)}
                  >
                    <span className="min-w-0 flex-1 truncate">Transcript</span>
                    {transcript === 'live' ? (
                      <span className="text-xs font-strong text-live">
                        ● Live
                      </span>
                    ) : (
                      <span className="text-xs text-ink-muted">Complete</span>
                    )}
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
                    <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}
