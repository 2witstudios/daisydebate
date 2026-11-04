import type {
  DriveCursor,
  DriveEntryView,
} from '../../features/documents/drive-tree';

/** A folder, for a Move form. */
export type FolderRow = {
  readonly id: string;
  readonly name: string;
  readonly parentFolderId: string | null;
};
export type SearchHit = {
  readonly id: string;
  readonly title: string;
  readonly folderId: string | null;
  readonly snippet: string;
};
/** A document edited lately, without its body. */
export type RecentDocument = { readonly id: string; readonly title: string };
export type DrivePage = {
  readonly entries: readonly DriveEntryView[];
  readonly next: DriveCursor | null;
};
export type DriveChange =
  | 'rename'
  | 'move'
  | 'delete'
  | 'create'
  | 'folders/create'
  | 'folders/rename'
  | 'folders/move';

const REQUEST_TIMEOUT_MS = 15_000;

const post = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(`/api/documents/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Drive request ${response.status}`);
  return (await response.json()) as T;
};

/** The drive's reads and changes over the document routes; bodies never come this way. */
export const driveApi = {
  list: (folderId: string | null, after: DriveCursor | null) =>
    post<DrivePage>('list', { folderId, after }),
  folders: async () =>
    (await post<{ folders: readonly FolderRow[] }>('folders', {})).folders,
  recent: async () =>
    (await post<{ documents: readonly RecentDocument[] }>('recent', {}))
      .documents,
  search: async (text: string) =>
    (await post<{ hits: readonly SearchHit[] }>('search', { text, page: 0 }))
      .hits,
  change: <T = unknown>(path: DriveChange, body: Record<string, unknown>) =>
    post<T>(path, body),
};
