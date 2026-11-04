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
  type PaletteMode,
  type RankedCommand,
} from '../../features/documents/command-palette';
import { cn } from '../cn';
import { Icon, type IconName } from '../components/icon/icon';

export type PaletteChoice =
  | { readonly kind: 'new' }
  | { readonly kind: 'new-folder' }
  | {
      readonly kind: 'open';
      readonly documentId: string;
      readonly title: string;
    };

/** A document the palette can open; a search hit also says where the words were. */
export type PaletteDocument = {
  readonly id: string;
  readonly title: string;
  readonly snippet?: string;
};

type Command = PaletteCommand & {
  readonly choice: PaletteChoice;
  readonly snippet?: string;
};

const openCommand = (doc: PaletteDocument): Command => ({
  id: `open:${doc.id}`,
  title: doc.title,
  group: 'Open',
  keywords: ['open', 'go'],
  choice: { kind: 'open', documentId: doc.id, title: doc.title },
  ...(doc.snippet ? { snippet: doc.snippet } : {}),
});

/** Every command the palette can run: a new document, then each document. */
export function paletteCommands(
  documents: readonly PaletteDocument[],
): readonly Command[] {
  return [
    {
      id: 'new:document',
      title: 'New document',
      group: 'New',
      keywords: ['new', 'create', 'blank', 'flow', 'notes'],
      choice: { kind: 'new' } as const,
    },
    ...documents.map(openCommand),
  ];
}

const FOLDER_COMMAND = 'create:folder';

/** What the + offers, and nothing else. */
export const createCommands: readonly Command[] = [
  {
    id: 'create:document',
    title: 'Document',
    group: 'Create',
    keywords: ['new', 'document', 'write', 'notes'],
    choice: { kind: 'new' },
    snippet: 'A document to write in',
  },
  {
    id: FOLDER_COMMAND,
    title: 'Folder',
    group: 'Create',
    keywords: ['new', 'organize'],
    choice: { kind: 'new-folder' },
    snippet: 'Keep documents together',
  },
];

const commandIcon = (id: string): IconName =>
  id === FOLDER_COMMAND ? 'folder' : id.startsWith('new:') ? 'plus' : 'file';

const SEARCH_DELAY_MS = 150;

/**
 * The server searches titles and bodies from one index, so a hit stays even when
 * its title does not match the words; the palette only ranks what it can see.
 */
const rankedWithHits = (
  query: string,
  commands: readonly Command[],
  hits: boolean,
): readonly RankedCommand[] => {
  const ranked = rankCommands(query, commands);
  if (!hits) return ranked;
  const seen = new Set(ranked.map((one) => one.command.id));
  return [
    ...ranked,
    ...commands
      .filter((command) => !seen.has(command.id) && command.group === 'Open')
      .map((command) => ({ command, score: 0, matches: [] })),
  ];
};

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
  readonly mode: PaletteMode;
  /** Offered with nothing typed: the documents open here. */
  readonly documents: readonly PaletteDocument[];
  /** Searches the member's own documents; without it only those above are offered. */
  readonly search?: (text: string) => Promise<readonly PaletteDocument[]>;
  readonly onChoose: (choice: PaletteChoice) => void;
  readonly onClose: () => void;
};

/** Raycast-style: type to filter, arrows to move, Enter to run, Esc to close. */
export function CommandPalette({
  mode,
  documents,
  search,
  onChoose,
  onClose,
}: Props) {
  const creating = mode === 'create';
  const open = mode !== 'closed';
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [hits, setHits] = useState<
    | {
        readonly kind: 'ready';
        readonly query: string;
        readonly documents: readonly PaletteDocument[];
      }
    | { readonly kind: 'failed'; readonly query: string }
    | null
  >(null);
  useEffect(() => {
    if (!open || creating || !search || query.trim() === '') return;
    let live = true;
    const wait = setTimeout(() => {
      // Results and failures belong to the query that produced them.
      search(query).then(
        (found) => {
          if (live) setHits({ kind: 'ready', query, documents: found });
        },
        () => {
          if (live) setHits({ kind: 'failed', query });
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(wait);
    };
  }, [open, creating, query, search]);
  const shown =
    creating ||
    query.trim() === '' ||
    hits?.query !== query ||
    hits.kind !== 'ready'
      ? null
      : hits.documents;
  const searchFailed = hits?.kind === 'failed' && hits.query === query;
  const commands = useMemo(
    () => (creating ? createCommands : paletteCommands(shown ?? documents)),
    [creating, shown, documents],
  );
  const groups = useMemo(
    () => groupRanked(rankedWithHits(query, commands, shown !== null)),
    [query, commands, shown],
  );
  // Arrows walk the list in the order it is drawn: group by group.
  const ranked = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups],
  );
  const choiceOf = (id: string) => commands.find((c) => c.id === id)?.choice;
  const snippetOf = (id: string) => commands.find((c) => c.id === id)?.snippet;

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  const closed = () => {
    setQuery('');
    setHits(null);
    setSelected(0);
    onClose();
  };
  const run = (ranked: RankedCommand | undefined) => {
    const choice = ranked && choiceOf(ranked.command.id);
    if (!choice) return;
    setQuery('');
    setHits(null);
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
      onClose={closed}
      onClick={(event) => event.target === dialog.current && closed()}
      className="m-auto w-full room-palette overflow-hidden rounded-lg border border-border-strong bg-surface-raised p-0 text-ink shadow-3 backdrop:bg-scrim/60"
    >
      <div className="flex items-center gap-2 border-b border-border px-4">
        {creating ? null : (
          <Icon name="search" size={18} className="text-ink-faint" />
        )}
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
          aria-label={creating ? 'Search what to create' : 'Search commands'}
          placeholder={creating ? 'Create a document or folder' : undefined}
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
            {creating ? null : (
              <div className="px-2 pt-2 pb-1 text-xs font-strong text-ink-faint">
                {group.group}
              </div>
            )}
            {group.items.map((item) => {
              const index = ranked.indexOf(item);
              return (
                <div
                  key={item.command.id}
                  id={`palette-${item.command.id}`}
                  role="option"
                  aria-selected={index === selected}
                  onMouseMove={() => setSelected(index)}
                  onClick={() => run(item)}
                  className={cn(
                    'flex min-h-10 cursor-pointer items-center gap-3 rounded-sm px-2 text-sm',
                    index === selected
                      ? 'bg-surface-overlay text-ink'
                      : 'text-ink-muted',
                  )}
                >
                  <Icon name={commandIcon(item.command.id)} size={16} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Highlighted ranked={item} />
                    {snippetOf(item.command.id) ? (
                      <span className="truncate text-xs text-ink-faint">
                        {snippetOf(item.command.id)}
                      </span>
                    ) : null}
                  </span>
                  {index === selected ? (
                    <kbd className="text-xs text-ink-faint">↵</kbd>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
        {searchFailed ? (
          <p role="alert" className="px-2 py-6 text-center text-sm text-live">
            Search did not run. Try another search or close and try again.
          </p>
        ) : null}
        {ranked.length === 0 && !searchFailed ? (
          <p className="px-2 py-6 text-center text-sm text-ink-faint">
            No matches
          </p>
        ) : null}
      </div>
      {creating ? (
        <div className="flex gap-4 border-t border-border px-4 py-2 text-xs text-ink-muted">
          <span>↑↓ Choose</span>
          <span>Enter Create</span>
          <span>Esc Close</span>
        </div>
      ) : null}
    </dialog>
  );
}
