'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import {
  folderChoices,
  type DriveNode,
} from '../../features/documents/drive-tree';
import { Icon, type IconName } from '../components/icon/icon';
import type { DriveActions } from './use-drive';

type Box = { readonly width: number; readonly height: number };
type Anchor = {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
};

const MENU_GAP = 2;

/** Where a menu opens: under its button, or above it when the foot is too close. */
export const menuPlace = (
  anchor: Anchor,
  menu: Box,
  viewport: Box,
): { readonly left: number; readonly top: number } => ({
  left: Math.max(
    MENU_GAP,
    Math.min(anchor.left, viewport.width - menu.width - MENU_GAP),
  ),
  top:
    anchor.bottom + MENU_GAP + menu.height <= viewport.height
      ? anchor.bottom + MENU_GAP
      : Math.max(MENU_GAP, anchor.top - menu.height - MENU_GAP),
});

const itemClass =
  'flex min-h-dense-target w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm text-ink no-underline hover:bg-surface-overlay hover:no-underline';
const dangerClass = `${itemClass} text-live`;

function Item({
  icon,
  danger = false,
  onClick,
  children,
}: {
  readonly icon?: IconName;
  readonly danger?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? dangerClass : itemClass}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

type View = 'main' | 'move' | 'delete';

/** A row's actions as one flat menu; Move and Delete are steps inside it. */
export function FileMenu({
  drive,
  node,
  label,
  onRename,
}: {
  readonly drive: DriveActions;
  readonly node: DriveNode;
  readonly label: string;
  readonly onRename: () => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>('main');
  const isFolder = node.kind === 'folder';
  const close = () => menu.current?.hidePopover();
  const run = (action: () => void) => {
    close();
    action();
  };
  const reveal = () => {
    if (node.kind === 'folder' && !node.expanded)
      drive.toggle(node.id, true, node.contents.state === 'read');
  };
  const moveTo = (target: string | null) =>
    run(() =>
      drive.change(
        isFolder ? 'folders/move' : 'move',
        isFolder
          ? { id: node.id, parentFolderId: target ?? '' }
          : { id: node.id, folderId: target ?? '' },
      ),
    );
  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={id}
        aria-label={`Actions for ${label}`}
        className="mr-px flex size-dense-target shrink-0 cursor-pointer items-center justify-center rounded-sm file-action"
      >
        <Icon name="dots" size={14} />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="menu"
        aria-label={`Actions for ${label}`}
        className="file-menu w-file-menu flex-col rounded-md border border-border-strong bg-surface-raised p-1 text-ink shadow-3"
        onToggle={(event) => {
          const node_ = menu.current;
          if (event.newState !== 'open') return setView('main');
          drive.loadFolders();
          if (!node_ || !trigger.current) return;
          const place = menuPlace(
            trigger.current.getBoundingClientRect(),
            { width: node_.offsetWidth, height: node_.offsetHeight },
            { width: window.innerWidth, height: window.innerHeight },
          );
          node_.style.setProperty('--file-menu-left', `${place.left}px`);
          node_.style.setProperty('--file-menu-top', `${place.top}px`);
        }}
      >
        {view === 'main' ? (
          <>
            {isFolder ? (
              <>
                <Item
                  icon="file"
                  onClick={() =>
                    run(() => {
                      reveal();
                      drive.createDocument(node.id);
                    })
                  }
                >
                  New document here
                </Item>
                <Item
                  icon="folder"
                  onClick={() =>
                    run(() => {
                      reveal();
                      drive.createFolder(node.id);
                    })
                  }
                >
                  New folder here
                </Item>
                <hr className="m-1 border-border" />
              </>
            ) : null}
            <Item icon="pencil" onClick={() => run(onRename)}>
              Rename
            </Item>
            <Item icon="folder" onClick={() => setView('move')}>
              Move to…
            </Item>
            <hr className="m-1 border-border" />
            {isFolder ? (
              <a
                role="menuitem"
                href={`/prep/folders/${node.id}/delete`}
                target={drive.back.startsWith('/rounds') ? '_blank' : undefined}
                rel="noopener"
                className={dangerClass}
              >
                <Icon name="trash" size={14} />
                <span className="min-w-0 flex-1 truncate">Delete</span>
              </a>
            ) : (
              <Item icon="trash" danger onClick={() => setView('delete')}>
                Delete
              </Item>
            )}
          </>
        ) : null}
        {view === 'move' ? (
          <>
            <p className="truncate px-2 py-1 text-xs text-ink-muted">
              Move {label} to
            </p>
            <Item icon="folder" onClick={() => moveTo(null)}>
              My drive
            </Item>
            {folderChoices(drive.folders, isFolder ? node.id : null).map(
              (choice) => (
                <Item
                  key={choice.id}
                  icon="folder"
                  onClick={() => moveTo(choice.id)}
                >
                  {`${'  '.repeat(choice.depth)}${choice.name}`}
                </Item>
              ),
            )}
          </>
        ) : null}
        {view === 'delete' ? (
          <>
            <p className="px-2 py-1 text-xs text-ink-muted">
              This deletes {label} for good. It cannot be restored.
            </p>
            <Item
              icon="trash"
              danger
              onClick={() => run(() => drive.change('delete', { id: node.id }))}
            >
              Delete for good
            </Item>
            <Item onClick={close}>Keep it</Item>
          </>
        ) : null}
      </div>
    </>
  );
}
