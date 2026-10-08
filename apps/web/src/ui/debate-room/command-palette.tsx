'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  groupRanked,
  moveSelection,
  rankCommands,
  type PaletteCommand,
  type RankedCommand,
} from '../../features/debate-room/command-palette';
import {
  documentTemplates,
  type FolderId,
  type TemplateId,
  type WorkspaceDocument,
} from '../../features/debate-room/documents/documents';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';

export type PaletteChoice =
  | {
      readonly kind: 'new';
      readonly templateId: TemplateId;
      readonly folder: FolderId;
    }
  | { readonly kind: 'open'; readonly documentId: string };

const newFolders: readonly { readonly id: FolderId; readonly title: string }[] =
  [
    { id: 'round', title: 'New in this round' },
    { id: 'library', title: 'New in my library' },
  ];

/** Every command the palette can run: a template per folder, then each file. */
export function paletteCommands(
  documents: readonly WorkspaceDocument[],
): readonly (PaletteCommand & { readonly choice: PaletteChoice })[] {
  return [
    ...newFolders.flatMap((folder) =>
      documentTemplates.map((template) => ({
        id: `new:${folder.id}:${template.id}`,
        title: `New ${template.title}`,
        group: folder.title,
        keywords: ['new', 'create', ...template.keywords],
        choice: {
          kind: 'new',
          templateId: template.id,
          folder: folder.id,
        } as const,
      })),
    ),
    ...documents.map((doc) => ({
      id: `open:${doc.id}`,
      title: doc.title,
      group: 'Open',
      keywords: ['open', 'go'],
      choice: { kind: 'open', documentId: doc.id } as const,
    })),
  ];
}

/** The title with the matched letters drawn strong. */
function Highlighted({ ranked }: { readonly ranked: RankedCommand }) {
  const { title } = ranked.command;
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [start, end] of ranked.matches) {
    if (start > at) parts.push({ text: title.slice(at, start), hit: false });
    parts.push({ text: title.slice(start, end), hit: true });
    at = end;
  }
  if (at < title.length) parts.push({ text: title.slice(at), hit: false });
  return (
    <span className="min-w-0 flex-1 truncate">
      {parts.map((part, index) => (
        <span
          key={index}
          className={part.hit ? 'font-bold text-ink' : undefined}
        >
          {part.text}
        </span>
      ))}
    </span>
  );
}

type Props = {
  readonly open: boolean;
  readonly documents: readonly WorkspaceDocument[];
  readonly onChoose: (choice: PaletteChoice) => void;
  readonly onClose: () => void;
};

/** Raycast-style: type to filter, arrows to move, Enter to run, Esc to close. */
export function CommandPalette({ open, documents, onChoose, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const commands = useMemo(() => paletteCommands(documents), [documents]);
  const groups = useMemo(
    () => groupRanked(rankCommands(query, commands)),
    [query, commands],
  );
  // Arrows walk the list in the order it is drawn: group by group.
  const ranked = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups],
  );
  const choiceOf = (id: string) => commands.find((c) => c.id === id)?.choice;

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  const run = (ranked: RankedCommand | undefined) => {
    const choice = ranked && choiceOf(ranked.command.id);
    if (!choice) return;
    setQuery('');
    setSelected(0);
    onChoose(choice);
  };
  const key = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) {
      event.preventDefault();
      setSelected((index) => moveSelection(index, step, ranked.length));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      run(ranked[selected]);
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-label="Command palette"
      onClose={onClose}
      onClick={(event) => event.target === dialog.current && onClose()}
      className="m-auto mt-16 w-full room-palette overflow-hidden rounded-lg border border-border-strong bg-surface-raised p-0 text-ink shadow-3 backdrop:bg-scrim/60"
    >
      <div className="flex items-center gap-2 border-b border-border px-4">
        <Icon name="search" size={18} className="text-ink-faint" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="room-palette-list"
          aria-activedescendant={
            ranked[selected]
              ? `palette-${ranked[selected]!.command.id}`
              : undefined
          }
          aria-label="Search commands"
          placeholder="New document or open a file"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={key}
          className="h-12 min-w-0 flex-1 bg-transparent text-md outline-none"
        />
      </div>
      <div
        id="room-palette-list"
        role="listbox"
        aria-label="Commands"
        className="room-palette-list overflow-y-auto p-2"
      >
        {groups.map((group) => (
          <div key={group.group} role="group" aria-label={group.group}>
            <div className="px-2 pt-2 pb-1 text-xs font-strong text-ink-faint">
              {group.group}
            </div>
            {group.items.map((item) => {
              const index = ranked.indexOf(item);
              const isNew = item.command.id.startsWith('new:');
              return (
                <div
                  key={item.command.id}
                  id={`palette-${item.command.id}`}
                  role="option"
                  aria-selected={index === selected}
                  onMouseMove={() => setSelected(index)}
                  onClick={() => run(item)}
                  className={cn(
                    'flex h-10 cursor-pointer items-center gap-3 rounded-sm px-2 text-sm',
                    index === selected
                      ? 'bg-surface-overlay text-ink'
                      : 'text-ink-muted',
                  )}
                >
                  <Icon name={isNew ? 'plus' : 'file'} size={16} />
                  <Highlighted ranked={item} />
                  {index === selected ? (
                    <kbd className="text-xs text-ink-faint">↵</kbd>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
        {ranked.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-ink-faint">
            No matches
          </p>
        ) : null}
      </div>
    </dialog>
  );
}
