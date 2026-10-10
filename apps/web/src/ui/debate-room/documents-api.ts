import type { DocumentsApi, StoredDocument } from './document-sync';

/** A refused or failed document request, with the public error code. */
class DocumentRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Document request failed: ${status} ${code}`);
  }
}

/** A document request that has not answered by then has failed; the sync retries it. */
const REQUEST_TIMEOUT_MS = 15_000;

type Fetch = (path: string, init: RequestInit) => Promise<Response>;
const read = async <T>(response: Response): Promise<T> => {
  if (response.ok) return (await response.json()) as T;
  const error = (await response.json().catch(() => null)) as {
    error?: { code?: string };
  } | null;
  throw new DocumentRequestError(
    response.status,
    error?.error?.code ?? 'UNKNOWN',
  );
};

/**
 * The room's documents, over the server's document routes. Each request
 * carries `signal()`, which by default aborts it after REQUEST_TIMEOUT_MS,
 * so a stalled save fails instead of holding the saves queued behind it.
 */
export function createDocumentsApi({
  send = (path, init) => fetch(path, init),
  signal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS),
}: {
  readonly send?: Fetch;
  readonly signal?: () => AbortSignal;
} = {}): DocumentsApi {
  const post = (path: string, body: unknown) =>
    send(`/api/debate-room/documents/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal(),
    });
  return {
    list: async (roundId) =>
      (
        await read<{ documents: readonly StoredDocument[] }>(
          await post('list', { roundId }),
        )
      ).documents,
    create: async (input) =>
      (await read<{ document: StoredDocument }>(await post('create', input)))
        .document,
    save: async (input) => {
      const response = await post('save', input);
      if (response.status === 409) {
        const { revision } = (await response.json()) as { revision: number };
        return { status: 'conflict', revision };
      }
      const { revision } = await read<{ revision: number }>(response);
      return { status: 'saved', revision };
    },
  };
}
