'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react';
import type { ManagerAction } from '../../features/documents/document-manager-state';
import type {
  DriveFolderNode,
  DriveNode,
  DriveTree,
  FolderContents,
} from '../../features/documents/drive-tree';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import { FileMenu } from './file-menu';
import type { DriveActions } from './use-drive';

const row = (current: boolean) =>
  cn(
    'file-row flex h-dense-target min-w-0 items-center rounded-sm transition-colors',
    current
      ? 'bg-accent text-accent-ink'
      : 'text-ink file-row-idle hover:bg-surface-overlay',
  );
const rowMain =
  'flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1 pl-1 text-left text-sm';

/** A name being typed in its own row: Enter or leaving keeps it, Esc does not. */
function RenameField({
  label,
  onDone,
}: {
  readonly label: string;
  readonly onDone: (name: string | null) => void;
}) {
  const [value, setValue] = useState(label);
  const finished = useRef(false);
  const finish = (name: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(name);
  };
  return (
    <input
      autoFocus
      aria-label={`Rename ${label}`}
      value={value}
      maxLength={120}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(value);
        if (event.key === 'Escape') finish(null);
      }}
      className="mr-1 h-5 min-w-0 flex-1 rounded-sm bg-surface-raised px-1 text-sm text-ink file-rename"
    />
  );
}

/** One row of the tree; its name becomes a field while it is being renamed. */
function NodeRow({
  node,
  label,
  current,
  leading,
  expanded,
  renaming,
  dispatch,
  drive,
  onOpen,
}: {
  readonly node: DriveNode;
  readonly label: string;
  readonly current: boolean;
  readonly leading: ReactNode;
  readonly expanded?: boolean;
  readonly renaming: boolean;
  readonly dispatch: Dispatch<ManagerAction>;
  readonly drive: DriveActions;
  readonly onOpen: () => void;
}) {
  const rowElement = useRef<HTMLDivElement>(null);
  const rowButton = useRef<HTMLButtonElement>(null);
  const wasRenaming = useRef(renaming);
  useLayoutEffect(() => {
    if (wasRenaming.current && !renaming) rowButton.current?.focus();
    wasRenaming.current = renaming;
  }, [renaming]);
  useLayoutEffect(() => {
    const element = rowElement.current;
    return () => {
      if (!element?.contains(document.activeElement)) return;
      const next = [
        ...(element
          .closest('nav')
          ?.querySelectorAll<HTMLButtonElement>('button') ?? []),
      ].find((button) => !element.contains(button));
      next?.focus();
    };
  }, []);
  const done = (name: string | null) => {
    dispatch({ type: 'drive/renaming', id: null });
    const typed = name?.trim();
    if (!typed || typed === label) return;
    if (node.kind === 'folder')
      drive.change('folders/rename', { id: node.id, name: typed });
    else drive.change('rename', { id: node.id, title: typed });
  };
  return (
    <div ref={rowElement} className={row(current)}>
      {renaming ? (
        <span className={cn(rowMain, 'cursor-auto')}>
          {leading}
          <RenameField label={label} onDone={done} />
        </span>
      ) : (
        <>
          <button
            type="button"
            ref={rowButton}
            aria-expanded={expanded}
            aria-current={current ? 'page' : undefined}
            className={rowMain}
            onClick={onOpen}
          >
            {leading}
            <span className="min-w-0 flex-1 truncate">{label}</span>
          </button>
          <FileMenu
            drive={drive}
            node={node}
            label={label}
            onRename={() => dispatch({ type: 'drive/renaming', id: node.id })}
          />
        </>
      )}
    </div>
  );
}

type TreeContext = {
  readonly active: string | null;
  readonly renaming: string | null;
  readonly dispatch: Dispatch<ManagerAction>;
  readonly drive: DriveActions;
};

function Contents({
  contents,
  folderId,
  context,
}: {
  readonly contents: FolderContents;
  readonly folderId: string | null;
  readonly context: TreeContext;
}) {
  const { active, renaming, dispatch, drive } = context;
  if (contents.state === 'unread') return null;
  return (
    <ul className="flex flex-col">
      {contents.entries.map((node) =>
        node.kind === 'folder' ? (
          <FolderRow key={node.id} node={node} context={context} />
        ) : (
          <li key={node.id}>
            <NodeRow
              node={node}
              label={node.title}
              current={active === node.id}
              renaming={renaming === node.id}
              dispatch={dispatch}
              drive={drive}
              onOpen={() => drive.open(node.id, node.title)}
              leading={
                <>
                  <span className="size-3 shrink-0" />
                  <Icon name="file" size={14} />
                </>
              }
            />
          </li>
        ),
      )}
      {contents.next ? (
        <li>
          <button
            type="button"
            className="h-dense-target cursor-pointer px-2 text-sm text-ink-muted underline"
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
  context,
}: {
  readonly node: DriveFolderNode;
  readonly context: TreeContext;
}) {
  const { renaming, dispatch, drive } = context;
  return (
    <li className="flex flex-col">
      <NodeRow
        node={node}
        label={node.name}
        current={false}
        expanded={node.expanded}
        renaming={renaming === node.id}
        dispatch={dispatch}
        drive={drive}
        onOpen={() =>
          drive.toggle(node.id, !node.expanded, node.contents.state === 'read')
        }
        leading={
          <>
            <Icon
              name={node.expanded ? 'chevronDown' : 'chevronRight'}
              size={12}
            />
            <Icon name="folder" size={14} />
          </>
        }
      />
      {node.expanded ? (
        <div className="pl-3">
          <Contents
            contents={node.contents}
            folderId={node.id}
            context={context}
          />
        </div>
      ) : null}
    </li>
  );
}

/** The sidebar's heading, for a frame that has none of its own. */
export type FilesHeading = {
  readonly title: string;
};

type Props = {
  readonly tree: DriveTree;
  readonly active: string | null;
  readonly renaming: string | null;
  readonly dispatch: Dispatch<ManagerAction>;
  readonly drive: DriveActions;
  readonly heading?: FilesHeading | null;
};

/** Create, search, then the viewer's drive: one tree wherever it opens. */
export function FileTree({
  tree,
  active,
  renaming,
  dispatch,
  drive,
  heading = null,
}: Props) {
  return (
    <nav aria-label="Files" className="flex min-h-0 flex-1 flex-col">
      {heading ? (
        <div className="flex h-tab-strip shrink-0 items-center gap-1 pr-1 pl-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-strong">
            {heading.title}
          </h2>
          <button
            type="button"
            aria-label="New"
            title="New"
            className="flex size-dense-target shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-muted hover:bg-surface-overlay hover:text-ink"
            onClick={() => dispatch({ type: 'palette/open', mode: 'create' })}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
      ) : null}
      <button
        type="button"
        aria-keyshortcuts="Meta+K Control+K"
        className="mx-2 mb-2 flex h-dense-target shrink-0 cursor-pointer items-center gap-2 rounded-sm bg-surface-overlay px-2 text-sm text-ink-muted hover:text-ink"
        onClick={() => dispatch({ type: 'palette/open', mode: 'search' })}
      >
        <Icon name="search" size={14} />
        <span className="min-w-0 flex-1 truncate text-left">Search files</span>
        <kbd className="font-body text-xs">⌘K</kbd>
      </button>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 pb-3">
        {heading && drive.recent.length > 0 ? (
          <section aria-label="Recent" className="flex flex-col">
            <h2 className="flex h-dense-target items-center px-2 text-xs font-strong tracking-wider text-ink-muted uppercase">
              Recent
            </h2>
            <ul className="flex flex-col">
              {drive.recent.map((document) => (
                <li key={document.id}>
                  <button
                    type="button"
                    className="flex h-dense-target w-full min-w-0 cursor-pointer items-center gap-1 rounded-sm px-2 text-left text-sm text-ink hover:bg-surface-overlay"
                    onClick={() => drive.open(document.id, document.title)}
                  >
                    <Icon name="file" size={14} />
                    <span className="min-w-0 flex-1 truncate">
                      {document.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section aria-label="My drive" className="flex flex-col">
          <h2 className="flex h-dense-target items-center px-2 text-xs font-strong tracking-wider text-ink-muted uppercase">
            My drive
          </h2>
          <Contents
            contents={tree.contents}
            folderId={null}
            context={{ active, renaming, dispatch, drive }}
          />
        </section>
      </div>
    </nav>
  );
}
