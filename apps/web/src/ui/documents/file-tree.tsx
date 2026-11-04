'use client';

import type { Dispatch, FormEvent, ReactNode } from 'react';
import type { ManagerAction } from '../../features/documents/document-manager-state';
import {
  folderChoices,
  type DriveFolderNode,
  type DriveNode,
  type DriveTree,
  type FolderContents,
} from '../../features/documents/drive-tree';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import type { DriveChange } from './drive-api';
import type { DriveActions } from './use-drive';

const row = (current: boolean) =>
  cn(
    'flex h-room-target w-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm transition-colors',
    current
      ? 'bg-surface-overlay font-strong text-ink'
      : 'text-ink hover:bg-surface-raised',
  );
const smallButton =
  'h-room-target cursor-pointer rounded-sm border border-border px-2 text-sm hover:bg-surface-raised';
const field =
  'h-room-target w-full min-w-0 rounded-sm border border-border bg-surface px-2 text-sm';

/** A real POST to the route; with script it answers without leaving the page. */
function DriveForm({
  drive,
  path,
  fields,
  children,
}: {
  readonly drive: DriveActions;
  readonly path: DriveChange;
  readonly fields: Readonly<Record<string, string>>;
  readonly children: ReactNode;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const typed = Object.fromEntries(
      [...form.entries()].filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    drive.change(
      path,
      Object.fromEntries(
        Object.entries(typed).filter(([name]) => name !== 'back'),
      ),
    );
    event.currentTarget.closest('details')?.removeAttribute('open');
  };
  return (
    <form
      method="post"
      action={`/api/documents/${path}`}
      onSubmit={submit}
      className="flex flex-col gap-1"
    >
      <input type="hidden" name="back" value={drive.back} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
    </form>
  );
}

function MoveForm({
  drive,
  node,
  label,
}: {
  readonly drive: DriveActions;
  readonly node: DriveNode;
  readonly label: string;
}) {
  const isFolder = node.kind === 'folder';
  const name = isFolder ? 'parentFolderId' : 'folderId';
  return (
    <DriveForm
      drive={drive}
      path={isFolder ? 'folders/move' : 'move'}
      fields={{ id: node.id }}
    >
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Move {label} to
        <select name={name} className={field} defaultValue="">
          <option value="">My drive</option>
          {folderChoices(drive.folders, isFolder ? node.id : null).map(
            (choice) => (
              <option key={choice.id} value={choice.id}>
                {'  '.repeat(choice.depth)}
                {choice.name}
              </option>
            ),
          )}
        </select>
      </label>
      <button type="submit" className={smallButton}>
        Move
      </button>
    </DriveForm>
  );
}

function RowActions({
  drive,
  node,
  label,
}: {
  readonly drive: DriveActions;
  readonly node: DriveNode;
  readonly label: string;
}) {
  const isFolder = node.kind === 'folder';
  return (
    <details
      className="relative shrink-0"
      onToggle={(event) => {
        if (event.currentTarget.open) drive.loadFolders();
      }}
    >
      <summary
        aria-label={`Actions for ${label}`}
        className="flex size-room-target cursor-pointer list-none items-center justify-center rounded-sm hover:bg-surface-raised"
      >
        <Icon name="dots" size={16} />
      </summary>
      <div className="absolute right-0 z-10 flex w-max flex-col gap-3 rounded-sm border border-border-strong bg-surface-raised p-3 shadow-3">
        <DriveForm
          drive={drive}
          path={isFolder ? 'folders/rename' : 'rename'}
          fields={{ id: node.id }}
        >
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Name
            <input
              name={isFolder ? 'name' : 'title'}
              defaultValue={label}
              required
              maxLength={120}
              className={field}
            />
          </label>
          <button type="submit" className={smallButton}>
            Rename
          </button>
        </DriveForm>
        <MoveForm drive={drive} node={node} label={label} />
        {isFolder ? (
          <a
            href={`/prep/folders/${node.id}/delete`}
            target={drive.back.startsWith('/rounds') ? '_blank' : undefined}
            rel="noopener"
            className="text-sm underline"
          >
            Delete folder
          </a>
        ) : (
          <details>
            <summary className="cursor-pointer text-sm underline">
              Delete document
            </summary>
            <DriveForm drive={drive} path="delete" fields={{ id: node.id }}>
              <p className="text-xs text-ink-muted">
                This deletes it for good. It cannot be restored.
              </p>
              <button type="submit" className={smallButton}>
                Delete {label}
              </button>
            </DriveForm>
          </details>
        )}
      </div>
    </details>
  );
}

function NewFolder({
  drive,
  parentFolderId,
}: {
  readonly drive: DriveActions;
  readonly parentFolderId: string | null;
}) {
  return (
    <details className="px-2">
      <summary className="cursor-pointer text-xs text-ink-muted">
        New folder
      </summary>
      <DriveForm
        drive={drive}
        path="folders/create"
        fields={{ parentFolderId: parentFolderId ?? '' }}
      >
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Folder name
          <input name="name" required maxLength={120} className={field} />
        </label>
        <button type="submit" className={smallButton}>
          Create folder
        </button>
      </DriveForm>
    </details>
  );
}

function Contents({
  contents,
  folderId,
  active,
  drive,
}: {
  readonly contents: FolderContents;
  readonly folderId: string | null;
  readonly active: string | null;
  readonly drive: DriveActions;
}) {
  if (contents.state === 'unread') return null;
  return (
    <ul className="flex flex-col gap-px">
      {contents.entries.map((node) =>
        node.kind === 'folder' ? (
          <FolderRow key={node.id} node={node} active={active} drive={drive} />
        ) : (
          <li key={node.id} className="flex items-center">
            {/* Without script this is a link to the page; with it, a tab opens here. */}
            <a
              href={`/prep?open=${node.id}`}
              role="button"
              aria-current={active === node.id ? 'page' : undefined}
              className={row(active === node.id)}
              onClick={(event) => {
                event.preventDefault();
                drive.open(node.id, node.title);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{node.title}</span>
            </a>
            <RowActions drive={drive} node={node} label={node.title} />
          </li>
        ),
      )}
      {contents.next ? (
        <li>
          <button
            type="button"
            className="h-room-target cursor-pointer px-2 text-sm underline"
            onClick={() => drive.more(folderId, contents.next!)}
          >
            Show more
          </button>
        </li>
      ) : null}
    </ul>
  );
}

function FolderRow({
  node,
  active,
  drive,
}: {
  readonly node: DriveFolderNode;
  readonly active: string | null;
  readonly drive: DriveActions;
}) {
  return (
    <li className="flex flex-col">
      <div className="flex items-center">
        <a
          href={`/prep/folders/${node.id}`}
          role="button"
          aria-expanded={node.expanded}
          className={row(false)}
          onClick={(event) => {
            event.preventDefault();
            drive.toggle(
              node.id,
              !node.expanded,
              node.contents.state === 'read',
            );
          }}
        >
          <Icon name="folder" size={16} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        </a>
        <RowActions drive={drive} node={node} label={node.name} />
      </div>
      {node.expanded ? (
        <div className="flex flex-col gap-1 pl-4">
          <Contents
            contents={node.contents}
            folderId={node.id}
            active={active}
            drive={drive}
          />
          <NewFolder drive={drive} parentFolderId={node.id} />
          <button
            type="button"
            className="h-room-target cursor-pointer px-2 text-left text-xs text-ink-muted underline"
            onClick={() => drive.createDocument(node.id)}
          >
            New document here
          </button>
        </div>
      ) : null}
    </li>
  );
}

type Props = {
  readonly tree: DriveTree;
  readonly active: string | null;
  readonly dispatch: Dispatch<ManagerAction>;
  readonly drive: DriveActions;
  /** The folder this page opened at; null is the drive's root. */
  readonly rootFolderId?: string | null;
};

/** Open or create, then the viewer's drive: one tree wherever it opens. */
export function FileTree({
  tree,
  active,
  dispatch,
  drive,
  rootFolderId = null,
}: Props) {
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
        <section aria-label="My drive" className="flex flex-col gap-1">
          <h2 className="px-2 pb-1 text-xs font-strong tracking-wider text-ink-muted uppercase">
            {rootFolderId === null ? 'My drive' : 'In this folder'}
          </h2>
          <Contents
            contents={tree.contents}
            folderId={rootFolderId}
            active={active}
            drive={drive}
          />
          <NewFolder drive={drive} parentFolderId={rootFolderId} />
        </section>
      </div>
    </nav>
  );
}
