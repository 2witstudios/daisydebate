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

const post = (path: string, body: unknown) =>
  fetch(`/api/debate-room/documents/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

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

/** The room's documents, over the server's document routes. */
export const documentsApi: DocumentsApi = {
  list: async (aiDebateId) =>
    (
      await read<{ documents: readonly StoredDocument[] }>(
        await post('list', { aiDebateId }),
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
