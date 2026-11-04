'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { flushSync } from 'react-dom';
import {
  folderChoices,
  type DriveNode,
} from '../../features/documents/drive-tree';
import { Icon } from '../components/icon/icon';
import type { DriveActions } from './use-drive';
import { FileMenuItem as Item } from './file-menu-item';
import { FileDeleteStep } from './file-delete-step';

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

/** Menu keyboard behavior follows the same list in every step. */
const moveMenuFocus = (event: KeyboardEvent<HTMLDivElement>) => {
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ),
  ];
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (index + 1) % items.length
          : event.key === 'ArrowUp'
            ? (index - 1 + items.length) % items.length
            : null;
  if (next !== null) {
    event.preventDefault();
    items[next]?.focus();
  }
};

const focusMenuStart = (menu: HTMLDivElement | null) =>
  (
    menu?.querySelector<HTMLButtonElement>('[data-menu-initial-focus]') ??
    menu?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
  )?.focus();

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
  const [isOpen, setIsOpen] = useState(false);
  const openingFrame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (openingFrame.current !== null)
        cancelAnimationFrame(openingFrame.current);
    },
    [],
  );
  const isFolder = node.kind === 'folder';
  const close = () => {
    menu.current?.hidePopover();
    trigger.current?.focus();
  };
  const run = (action: () => void) => {
    close();
    action();
  };
  const reveal = async () =>
    node.kind !== 'folder' ||
    (await drive.toggle(node.id, true, node.contents.state === 'read'));
  const createHere = async (create: () => void) => {
    close();
    if (await reveal()) create();
  };
  const place = useCallback(() => {
    if (!menu.current?.matches(':popover-open') || !trigger.current) return;
    const location = menuPlace(
      trigger.current.getBoundingClientRect(),
      { width: menu.current.offsetWidth, height: menu.current.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    menu.current.style.setProperty('--file-menu-left', `${location.left}px`);
    menu.current.style.setProperty('--file-menu-top', `${location.top}px`);
  }, []);
  useLayoutEffect(() => {
    place();
    if (menu.current?.matches(':popover-open')) focusMenuStart(menu.current);
  }, [isOpen, view, place]);
  useEffect(() => {
    const element = menu.current;
    if (!element || !isOpen) return;
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [isOpen, place]);
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
        onKeyDown={moveMenuFocus}
        onBeforeToggle={(event) => {
          if (openingFrame.current !== null)
            cancelAnimationFrame(openingFrame.current);
          if (event.newState !== 'open') {
            setIsOpen(false);
            setView('main');
            return;
          }
          // Native opening must not paint an empty shell while toggle waits in
          // its event queue. Commit the contents before entering the top layer.
          flushSync(() => setIsOpen(true));
          if (menu.current && trigger.current) {
            const initial = menuPlace(
              trigger.current.getBoundingClientRect(),
              {
                width: parseFloat(getComputedStyle(menu.current).width),
                height: 0,
              },
              { width: window.innerWidth, height: window.innerHeight },
            );
            menu.current.style.setProperty(
              '--file-menu-left',
              `${initial.left}px`,
            );
            menu.current.style.setProperty(
              '--file-menu-top',
              `${initial.top}px`,
            );
          }
          openingFrame.current = requestAnimationFrame(() => {
            openingFrame.current = null;
            if (!menu.current?.matches(':popover-open')) return;
            place();
            focusMenuStart(menu.current);
          });
        }}
      >
        {isOpen && view === 'main' ? (
          <>
            {isFolder ? (
              <>
                <Item
                  icon="file"
                  onClick={() =>
                    void createHere(() => drive.createDocument(node.id))
                  }
                >
                  New document here
                </Item>
                <Item
                  icon="folder"
                  onClick={() =>
                    void createHere(() => drive.createFolder(node.id))
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
            <Item
              icon="folder"
              onClick={() => {
                drive.loadFolders();
                setView('move');
              }}
            >
              Move to…
            </Item>
            <hr className="m-1 border-border" />
            <Item icon="trash" danger onClick={() => setView('delete')}>
              Delete
            </Item>
          </>
        ) : null}
        {isOpen && view === 'move' ? (
          <>
            <p className="truncate px-2 py-1 text-xs text-ink-muted">
              Move {label} to
            </p>
            {drive.folderProblem ? (
              <p role="alert" className="px-2 py-1 text-xs text-live">
                {drive.folderProblem}
              </p>
            ) : null}
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
                  {`${'\u00a0\u00a0'.repeat(choice.depth)}${choice.name}`}
                </Item>
              ),
            )}
          </>
        ) : null}
        {isOpen && view === 'delete' ? (
          <FileDeleteStep
            node={node}
            label={label}
            folderCount={drive.folderCount}
            change={drive.change}
            close={close}
            run={run}
          />
        ) : null}
      </div>
    </>
  );
}
