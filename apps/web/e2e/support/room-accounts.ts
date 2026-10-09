import type {
  APIRequestContext,
  Browser,
  BrowserContext,
} from '@playwright/test';
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { signUpMember, origin } from './accounts';
import { expect } from './fixtures';
import type {
  RoomAccountOwnership,
  RoomCleanupEvidence,
} from './room-account-cleanup';

function signInEmail(
  url: URL,
  sameOrigin: boolean,
  data: unknown,
): string | undefined {
  if (!sameOrigin || url.pathname !== '/api/auth/sign-in/magic-link')
    return undefined;
  if (
    typeof data === 'object' &&
    data !== null &&
    'email' in data &&
    typeof data.email === 'string'
  )
    return data.email;
  return undefined;
}

type Post = APIRequestContext['post'];

/** A local forwarding view; never replaces methods on the request/context. */
export function captureRoomSignIn(
  request: APIRequestContext,
  baseURL: string,
  hooks: {
    readonly rememberEmail: (email: string) => void;
    readonly dispatched?: (path: string, status: number) => void;
    readonly uncertain?: () => void;
    readonly afterPost?: (path: string) => Promise<void>;
  },
): APIRequestContext {
  const post: Post = async (path, options) => {
    const url = new URL(path, baseURL);
    const sameOrigin = url.origin === new URL(baseURL).origin;
    const email = signInEmail(url, sameOrigin, options?.data);
    if (email !== undefined) hooks.rememberEmail(email);
    let response;
    try {
      response = await request.post(path, options);
    } catch (error) {
      if (sameOrigin) hooks.uncertain?.();
      throw error;
    }
    if (sameOrigin) {
      hooks.dispatched?.(url.pathname, response.status());
      await hooks.afterPost?.(url.pathname);
    }
    return response;
  };
  return new Proxy(request, {
    get(target, property) {
      if (property === 'post') return post;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function cleanupFailureReason(stderr: string): string {
  try {
    const evidence: unknown = JSON.parse(stderr);
    if (
      typeof evidence === 'object' &&
      evidence !== null &&
      'reason' in evidence &&
      [
        'pending',
        'ownership',
        'target',
        'input',
        'configuration',
        'reference',
        'database',
      ].includes(String(evidence.reason))
    )
      return String(evidence.reason);
  } catch {
    /* Raw diagnostics remain private. */
  }
  return 'failed';
}

function recordMailDispatch(
  owned: RoomAccountOwnership | undefined,
  path: string,
  status: number,
) {
  if (owned && path === '/api/auth/sign-in/magic-link' && status === 200)
    owned.mailExpected = true;
}

function sessionUserId(session: unknown): string {
  if (
    typeof session !== 'object' ||
    session === null ||
    !('user' in session) ||
    typeof session.user !== 'object' ||
    session.user === null ||
    !('id' in session.user) ||
    typeof session.user.id !== 'string'
  )
    throw new Error('Room signup did not produce an authenticated identity');
  return session.user.id;
}

export const roomCleanupTables = [
  'users',
  'actors',
  'session',
  'account',
  'passkey',
  'member_interests',
  'member_topics',
  'member_onboarding',
  'outbox',
  'verification',
  'delivery',
  'delivery_event',
  'suppression',
] as const;

const cleanupCountsSchema = z.record(
  z.enum(roomCleanupTables),
  z.int().nonnegative(),
);
const cleanupEvidenceSchema = z.strictObject({
  before: cleanupCountsSchema,
  after: cleanupCountsSchema,
});

/** Count-only subprocess evidence must describe the complete owned tables. */
export function parseRoomCleanupEvidence(stdout: string): RoomCleanupEvidence {
  try {
    return cleanupEvidenceSchema.parse(JSON.parse(stdout));
  } catch {
    throw new Error('Room account cleanup returned invalid evidence');
  }
}

function cleanupWorker(
  action: 'inspect' | 'clean',
  accounts: readonly RoomAccountOwnership[],
): Promise<RoomCleanupEvidence> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'bun',
      [fileURLToPath(new URL('./room-account-cleanup.ts', import.meta.url))],
      {
        timeout: 20_000,
        maxBuffer: 16_384,
      },
      (error, stdout, stderr) => {
        if (error) {
          return reject(
            new Error(`Room account cleanup ${cleanupFailureReason(stderr)}`),
          );
        }
        try {
          const evidence = parseRoomCleanupEvidence(stdout);
          resolve(evidence);
        } catch {
          reject(new Error('Room account cleanup returned invalid evidence'));
        }
      },
    );
    child.stdin?.end(JSON.stringify({ action, accounts }));
  });
}

export class RoomAccountsSetupError extends Error {
  constructor(readonly cleanup: RoomCleanupEvidence) {
    super('Room account setup failed');
  }
}

/** Real signup plus per-invocation ownership and teardown, for room proofs. */
export async function createRoomAccounts(
  browser: Browser,
  count: number,
  {
    afterPost,
  }: {
    readonly afterPost?: (path: string, index: number) => Promise<void>;
  } = {},
) {
  if (!Number.isInteger(count) || count < 1 || count > 16)
    throw new Error('Room account count must be between 1 and 16');
  const accounts: RoomAccountOwnership[] = [];
  const members: Array<{
    context: BrowserContext;
    userId: string;
    username: string;
  }> = [];
  const contexts: BrowserContext[] = [];
  let disposal: Promise<RoomCleanupEvidence> | undefined;
  let closed = false;
  const inspect = async () => (await cleanupWorker('inspect', accounts)).after;
  const dispose = (): Promise<RoomCleanupEvidence> => {
    if (disposal) return disposal;
    disposal = (async () => {
      // No signup remains in flight; a completed mail receipt is the final
      // database write of successful sign-in-mail deferred work. Unknown
      // transport completion fails closed in the worker.
      if (!closed) {
        await Promise.all(contexts.map((context) => context.close()));
        closed = true;
      }
      let evidence: RoomCleanupEvidence | undefined;
      let failure: unknown;
      await expect
        .poll(
          async () => {
            try {
              evidence = await cleanupWorker('clean', accounts);
              return true;
            } catch (error) {
              if (
                error instanceof Error &&
                error.message === 'Room account cleanup pending'
              )
                return false;
              failure = error;
              return true;
            }
          },
          { timeout: 10_000 },
        )
        .toBe(true);
      if (failure) throw failure;
      if (
        !evidence ||
        Object.values(evidence.after).some((value) => value !== 0)
      )
        throw new Error('Room account cleanup did not remove all owned data');
      accounts.forEach((account) => {
        account.mailExpected = false;
      });
      return evidence;
    })();
    void disposal.then(
      () => {
        disposal = undefined;
      },
      () => {
        disposal = undefined;
      },
    );
    return disposal;
  };
  try {
    for (let index = 0; index < count; index += 1) {
      const context = await browser.newContext({
        baseURL: origin,
        ignoreHTTPSErrors: true,
      });
      contexts.push(context);
      let owned: RoomAccountOwnership | undefined;
      const request = captureRoomSignIn(context.request, origin, {
        rememberEmail(email) {
          if (owned !== undefined)
            throw new Error('Room signup repeated its identity');
          owned = { email, mailExpected: false, uncertain: false };
          accounts.push(owned);
        },
        dispatched(path, status) {
          recordMailDispatch(owned, path, status);
        },
        uncertain() {
          if (owned) owned.uncertain = true;
        },
        afterPost: async (path) => afterPost?.(path, index),
      });
      const member = await signUpMember(request);
      const response = await context.request.get('/api/auth/get-session');
      const session: unknown = await response.json();
      if (response.status() !== 200 || !owned)
        throw new Error(
          'Room signup did not produce an authenticated identity',
        );
      owned.userId = sessionUserId(session);
      members.push({
        context,
        userId: owned.userId,
        username: member.username,
      });
    }
    return { members, inspect, dispose };
  } catch {
    let evidence: RoomCleanupEvidence;
    try {
      evidence = await dispose();
    } catch {
      throw new Error(
        'Room signup failed and owned cleanup could not be confirmed',
      );
    }
    throw new RoomAccountsSetupError(evidence);
  }
}
