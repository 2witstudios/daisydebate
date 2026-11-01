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

/** The server returns one integer revision, never an unchecked JSON assertion. */
const receiptRevision = (value: unknown): number => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !Object.hasOwn(value, 'revision') ||
    Object.keys(value).length !== 1
  )
    throw new Error('Invalid document acknowledgement.');
  const revision = (value as { readonly revision: unknown }).revision;
  if (
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    revision > 2_147_483_647
  )
    throw new Error('Invalid document acknowledgement.');
  return revision;
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
  const post = (path: string, body: unknown, keepalive = false) =>
    send(`/api/debate-room/documents/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal(),
      keepalive,
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
    save: async ({ keepalive, ...input }) => {
      const response = await post('save', input, keepalive === true);
      if (response.status === 409)
        return {
          status: 'conflict',
          revision: receiptRevision(await response.json()),
        };
      const revision = receiptRevision(await read<unknown>(response));
      // saveDocument uses revision = revision + 1 under an exact revision CAS.
      // A lost acknowledgement retries that original CAS and receives 409;
      // only the existing reread/content reconciliation may adopt that commit.
      if (
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 1 ||
        !Number.isSafeInteger(input.expectedRevision + 1) ||
        revision !== input.expectedRevision + 1
      )
        throw new Error('Invalid document acknowledgement.');
      return { status: 'saved', revision };
    },
  };
}
