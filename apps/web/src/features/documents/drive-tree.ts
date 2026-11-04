/** Where a folder's next page resumes. */
export type DriveCursor = {
  readonly kind: 'folder' | 'document';
  readonly label: string;
  readonly id: string;
};

/** What this browser has read of a folder. */
export type FolderContents =
  | { readonly state: 'unread' }
  | {
      readonly state: 'read';
      readonly entries: readonly DriveNode[];
      readonly next: DriveCursor | null;
    };

export type DriveFolderNode = {
  readonly kind: 'folder';
  readonly id: string;
  readonly name: string;
  readonly expanded: boolean;
  readonly contents: FolderContents;
};
export type DriveDocumentNode = {
  readonly kind: 'document';
  readonly id: string;
  readonly title: string;
};
export type DriveNode = DriveFolderNode | DriveDocumentNode;

/**
 * One member's drive as this browser knows it (ADR 0111). It is one nested
 * value: a node exists only inside its parent, so a cycle or an orphan cannot be
 * represented. Every transition is total, and one it refuses returns the tree
 * it was given.
 */
export type DriveTree = { readonly contents: FolderContents };

/** A row as the server lists it. */
export type DriveEntryView =
  | { readonly kind: 'folder'; readonly id: string; readonly name: string }
  | { readonly kind: 'document'; readonly id: string; readonly title: string };

export const emptyDrive: DriveTree = { contents: { state: 'unread' } };

const nodeOf = (entry: DriveEntryView): DriveNode =>
  entry.kind === 'folder'
    ? { ...entry, expanded: false, contents: { state: 'unread' } }
    : entry;

const labelOf = (node: DriveNode) =>
  node.kind === 'folder' ? node.name : node.title;

/** Folders first, then documents, each by name, as the server lists them. */
const compare = (a: DriveNode, b: DriveNode) =>
  Number(a.kind === 'document') - Number(b.kind === 'document') ||
  (labelOf(a) < labelOf(b) ? -1 : labelOf(a) > labelOf(b) ? 1 : 0) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const ordered = (entries: readonly DriveNode[]): readonly DriveNode[] =>
  [...entries].sort(compare);

const inContents = (
  contents: FolderContents,
  change: (node: DriveNode) => DriveNode | null,
): FolderContents =>
  contents.state === 'unread'
    ? contents
    : {
        ...contents,
        entries: contents.entries.flatMap((node) => {
          const changed = change(node);
          if (changed === null) return [];
          return [
            changed.kind === 'folder'
              ? {
                  ...changed,
                  contents: inContents(changed.contents, change),
                }
              : changed,
          ];
        }),
      };

const mapNodes = (
  tree: DriveTree,
  change: (node: DriveNode) => DriveNode | null,
): DriveTree => ({ contents: inContents(tree.contents, change) });

const changeFolder = (
  tree: DriveTree,
  folderId: string | null,
  change: (contents: FolderContents) => FolderContents,
): DriveTree =>
  folderId === null
    ? { contents: change(tree.contents) }
    : mapNodes(tree, (node) =>
        node.kind === 'folder' && node.id === folderId
          ? { ...node, contents: change(node.contents) }
          : node,
      );

/** A page the server listed. A later page extends; a first page replaces. */
export const withPage = (
  tree: DriveTree,
  folderId: string | null,
  page: {
    readonly entries: readonly DriveEntryView[];
    readonly next: DriveCursor | null;
    readonly first: boolean;
  },
): DriveTree =>
  changeFolder(tree, folderId, (contents) => {
    const held = contents.state === 'read' ? contents.entries : [];
    const known = page.first ? [] : held;
    const seen = new Set(known.map((node) => node.id));
    // Listing the first page again keeps what later pages showed, by position, so
    // no client order has to agree with the database's collation.
    const fresh = new Set(page.entries.map((entry) => entry.id));
    const beyond =
      page.first && page.next !== null
        ? held.slice(page.entries.length).filter((node) => !fresh.has(node.id))
        : [];
    // A folder listed again keeps what is read and open inside it.
    const listed = (entry: DriveEntryView): DriveNode => {
      const node = nodeOf(entry);
      const before = held.find((one) => one.id === entry.id);
      return before?.kind === 'folder' && node.kind === 'folder'
        ? { ...before, name: node.name }
        : node;
    };
    return {
      state: 'read',
      next:
        beyond.length > 0 && contents.state === 'read'
          ? contents.next
          : page.next,
      entries: [
        ...known,
        ...page.entries.filter((e) => !seen.has(e.id)).map(listed),
        ...beyond,
      ],
    };
  });

export const setExpanded = (
  tree: DriveTree,
  folderId: string,
  expanded: boolean,
): DriveTree =>
  mapNodes(tree, (node) =>
    node.kind === 'folder' && node.id === folderId
      ? { ...node, expanded }
      : node,
  );

/** A new entry shows in its folder once that folder has been read. */
export const addEntry = (
  tree: DriveTree,
  folderId: string | null,
  entry: DriveEntryView,
): DriveTree =>
  changeFolder(tree, folderId, (contents) =>
    contents.state === 'unread' ||
    contents.entries.some((node) => node.id === entry.id)
      ? contents
      : {
          ...contents,
          entries: ordered([...contents.entries, nodeOf(entry)]),
        },
  );

export const removeEntry = (tree: DriveTree, id: string): DriveTree =>
  mapNodes(tree, (node) => (node.id === id ? null : node));

export const renameEntry = (
  tree: DriveTree,
  id: string,
  label: string,
): DriveTree =>
  mapNodes(tree, (node) =>
    node.id !== id
      ? node
      : node.kind === 'folder'
        ? { ...node, name: label }
        : { ...node, title: label },
  );

const nodesIn = (contents: FolderContents): readonly DriveNode[] =>
  contents.state === 'read' ? contents.entries : [];

const findNode = (
  contents: FolderContents,
  id: string,
): DriveNode | undefined => {
  for (const node of nodesIn(contents)) {
    if (node.id === id) return node;
    if (node.kind === 'folder') {
      const inner = findNode(node.contents, id);
      if (inner) return inner;
    }
  }
  return undefined;
};

/**
 * Moves an entry. A folder cannot move inside itself, and a target this browser
 * has not read takes the entry when it is next listed.
 */
export const moveEntry = (
  tree: DriveTree,
  id: string,
  folderId: string | null,
): DriveTree => {
  const moving = findNode(tree.contents, id);
  if (!moving) return tree;
  if (
    folderId !== null &&
    (folderId === id ||
      (moving.kind === 'folder' &&
        findNode(moving.contents, folderId) !== undefined))
  )
    return tree;
  return changeFolder(removeEntry(tree, id), folderId, (contents) =>
    contents.state === 'unread'
      ? contents
      : { ...contents, entries: ordered([...contents.entries, moving]) },
  );
};

/** A folder listed for a Move form, indented by depth. */
export type FolderChoice = {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
};
type FolderRow = {
  readonly id: string;
  readonly name: string;
  readonly parentFolderId: string | null;
};

/**
 * Every folder an entry may move to, parents before children. A folder and what
 * is inside it are left out for that folder, so the form cannot ask for a cycle.
 */
export const folderChoices = (
  folders: readonly FolderRow[],
  moving: string | null,
): readonly FolderChoice[] => {
  const walk = (
    parent: string | null,
    depth: number,
  ): readonly FolderChoice[] =>
    folders
      .filter((folder) => folder.parentFolderId === parent)
      .filter((folder) => folder.id !== moving)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .flatMap((folder) => [
        { id: folder.id, name: folder.name, depth },
        ...walk(folder.id, depth + 1),
      ]);
  return walk(null, 0);
};
