import { createDocumentationEvent } from './docs-pipeline';

// Shared fixtures for the docs-consult suites (jscpd ignores *.test-support.ts).

export const CUID2 = /^[a-z][a-z0-9]{1,31}$/;

export const mergeEvent = (
  title = 'feat(protocol): add the tournament envelope',
) =>
  createDocumentationEvent({
    eventId: '1001-merge007',
    eventType: 'pull_request.merged',
    occurredAt: '2026-09-20T00:00:00.000Z',
    repository: '2witstudios/daisydebate',
    baseRef: 'main',
    commit: 'merge007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    pullRequest: {
      number: 7,
      title,
      body: null,
      url: 'https://github.com/2witstudios/daisydebate/pull/7',
      author: '2witstudios',
      mergedBy: '2witstudios',
    },
    taskIds: [],
    changedFiles: ['packages/protocol/src/events.ts'],
  });

type Captured = {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
};

type Stub = {
  readonly consult: (init?: RequestInit) => Promise<Response>;
  /** The conversation's roles once its consult has been sent. */
  readonly roles?: () => readonly string[];
  /** The conversation's roles before any consult: a pre-existing run. */
  readonly existing?: readonly string[];
  /** Where the Runs sheet appends the reserved receipt row (0-based). */
  readonly firstRowIndex?: number;
};

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });

// Serves every endpoint dispatch touches, tracking each conversation by id:
// the pre-check read before a consult, the Runs-sheet append that reserves
// the receipt row, the consult itself, and the settlement reads after it.
// `counts.messages` counts only reads after a conversation's consult.
export const routedFetch = (stub: Stub) => {
  const counts = { consult: 0, messages: 0, appends: 0 };
  const consults: Captured[] = [];
  const appended: Record<string, string>[] = [];
  const consulted = new Set<string>();
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/ai/page-agents/consult') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      counts.consult += 1;
      consults.push({ url: String(url), init: init ?? {}, body });
      consulted.add(String(body.newConversationId));
      return stub.consult(init);
    }
    if (path === '/api/mcp/sheets') {
      const { rows } = JSON.parse(String(init?.body)) as {
        rows: Record<string, string>[];
      };
      counts.appends += 1;
      appended.push(...rows);
      return json({ firstRowIndex: stub.firstRowIndex ?? 1, appended: 1 });
    }
    const conversationId = path.split('/').at(-2) ?? '';
    const sent = consulted.has(conversationId);
    if (sent) counts.messages += 1;
    const roles = sent ? (stub.roles?.() ?? []) : (stub.existing ?? []);
    return json({ messages: roles.map((role) => ({ role })) });
  }) as unknown as typeof fetch;
  return { counts, consults, appended, fetchImpl };
};

// Records only the consult calls; every other endpoint answers as a fresh run.
export const recordingFetch = (
  respond: (body: Record<string, unknown>) => Response,
) => {
  const { consults, fetchImpl } = routedFetch({
    consult: async (init) =>
      respond(JSON.parse(String(init?.body)) as Record<string, unknown>),
  });
  return { calls: consults, fetchImpl };
};

export const ok = () =>
  new Response(JSON.stringify({ success: true }), { status: 200 });

export const baseOptions = {
  token: 'tok',
  apiUrl: 'https://pagespace.test',
  agentId: 'agent1',
} as const;

export const hangUntilAborted = (init?: RequestInit): Promise<Response> =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')),
    );
  });

export const instant = { delay: async () => {}, pollIntervalMs: 0 } as const;
