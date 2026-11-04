'use client';

import { useEffect, useState } from 'react';
import type { DriveNode } from '../../features/documents/drive-tree';
import { FileMenuItem } from './file-menu-item';
import type { DriveActions } from './use-drive';

type DeletionPreview =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly count: number }
  | { readonly kind: 'failed' };

/** A folder is confirmed only after its owned recursive count has arrived. */
export function FileDeleteStep({
  node,
  label,
  folderCount,
  change,
  close,
  run,
}: {
  readonly node: DriveNode;
  readonly label: string;
  readonly folderCount: DriveActions['folderCount'];
  readonly change: DriveActions['change'];
  readonly close: () => void;
  readonly run: (action: () => void) => void;
}) {
  const [preview, setPreview] = useState<DeletionPreview>(
    node.kind === 'folder' ? { kind: 'loading' } : { kind: 'ready', count: 1 },
  );
  useEffect(() => {
    if (node.kind !== 'folder') return;
    let live = true;
    folderCount(node.id).then(
      (count) => {
        if (live) setPreview({ kind: 'ready', count });
      },
      () => {
        if (live) setPreview({ kind: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [node.id, node.kind, folderCount]);
  return (
    <>
      <p
        className="px-2 py-1 text-xs text-ink-muted"
        role={preview.kind === 'failed' ? 'alert' : 'status'}
      >
        {preview.kind === 'loading'
          ? 'Counting documents…'
          : preview.kind === 'failed'
            ? 'This folder could not be checked. Close and try again.'
            : node.kind === 'folder'
              ? `This deletes ${label}, the folders inside it and ${preview.count} ${preview.count === 1 ? 'document' : 'documents'} for good. They cannot be restored.`
              : `This deletes ${label} for good. It cannot be restored.`}
      </p>
      <FileMenuItem
        icon="trash"
        danger
        disabled={preview.kind !== 'ready'}
        onKeyDown={(event) => {
          if (event.repeat && (event.key === 'Enter' || event.key === ' '))
            event.preventDefault();
        }}
        onClick={(event) => {
          if (event.detail > 1) return;
          run(() =>
            change(node.kind === 'folder' ? 'folders/delete' : 'delete', {
              id: node.id,
            }),
          );
        }}
      >
        Delete for good
      </FileMenuItem>
      <FileMenuItem initialFocus onClick={close}>
        Keep it
      </FileMenuItem>
    </>
  );
}
