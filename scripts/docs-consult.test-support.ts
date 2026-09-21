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

export const recordingFetch = (
  respond: (body: Record<string, unknown>) => Response,
) => {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(url), init: init ?? {}, body });
    return respond(body);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};

export const ok = () =>
  new Response(JSON.stringify({ success: true }), { status: 200 });

export const baseOptions = {
  token: 'tok',
  apiUrl: 'https://pagespace.test',
  agentId: 'agent1',
} as const;

// Serves the two endpoints dispatch touches: the consult POST and the
// conversation-messages GET it falls back to when the transport fails.
export const routedFetch = (routes: {
  readonly consult: (init?: RequestInit) => Promise<Response>;
  readonly roles: () => readonly string[];
}) => {
  const counts = { consult: 0, messages: 0 };
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith('/api/ai/page-agents/consult')) {
      counts.consult += 1;
      return routes.consult(init);
    }
    counts.messages += 1;
    return new Response(
      JSON.stringify({ messages: routes.roles().map((role) => ({ role })) }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { counts, fetchImpl };
};

export const hangUntilAborted = (init?: RequestInit): Promise<Response> =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')),
    );
  });

export const instant = { delay: async () => {}, pollIntervalMs: 0 } as const;
