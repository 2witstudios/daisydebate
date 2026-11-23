'use client';

import { useSettled } from '../edge/use-settled';
import { StatusRegion } from '../components/status-region/status-region';
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
  const counted = useSettled(
    node.kind === 'folder' ? node.id : null,
    folderCount,
  );
  const preview: DeletionPreview =
    node.kind !== 'folder'
      ? { kind: 'ready', count: 1 }
      : counted === null
        ? { kind: 'loading' }
        : counted.kind === 'ready'
          ? { kind: 'ready', count: counted.value }
          : { kind: 'failed' };
  return (
    <>
      <StatusRegion
        as="p"
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
      </StatusRegion>
      <FileMenuItem
        icon="trash"
        danger
        disabled={preview.kind !== 'ready'}
        onClick={() => {
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
