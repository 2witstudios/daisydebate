import type { PreapprovalResult } from '@daisy/protocol/beta-preapproval';
import { signOperatorRequest } from '@daisy/auth/operator-signature';
import { noopErrorReporter } from '@daisy/observability';
import { createOperatorApi, type OperatorApiDependencies } from './router';

export const now = 1_793_000_000_000;
export const target = 'u'.repeat(24);
export const keyOf = (fill: number) => new Uint8Array(32).fill(fill);
export const account = {
  userId: target,
  username: 'ada',
  accessState: 'pending' as const,
  accessRevision: 1,
  requestedAt: '2026-10-26T10:00:00.000Z',
  decidedAt: null,
};
export const result = {
  commandId: 'c'.repeat(24),
  outcome: 'changed' as const,
  accessState: 'approved' as const,
  accessRevision: 2,
  mail: 'queued' as const,
};

type Calls = { commands: unknown[]; lists: unknown[]; nonces: string[] };

export const api = (overrides: Partial<OperatorApiDependencies> = {}) => {
  const calls: Calls = { commands: [], lists: [], nonces: [] };
  const seen = new Set<string>();
  const handle = createOperatorApi({
    audience: 'daisy-web:staging',
    keys: new Map([
      ['k20261026', keyOf(1)],
      ['k20261101', keyOf(2)],
    ]),
    nowMs: () => now,
    admitNonce: async ({ nonce }) => {
      calls.nonces.push(nonce);
      if (seen.has(nonce)) return false;
      seen.add(nonce);
      return true;
    },
    contentModeration: {
      listModerationReports: async () => [],
      listRebuildableRecordings: async () => [],
      listProfilePhotoReviews: async () => [],
      readOperatorProfilePhoto: async () => null,
      readModerationReport: async () => null,
      runModerationCommand: async () => ({ v: 1, outcome: 'applied' }),
      chatRemovalCommand: async () => ({ v: 1, outcome: 'applied' }),
      recordingWithdrawalCommand: async () => ({ v: 1, outcome: 'applied' }),
    },
    store: {
      flagCommand: async (input) => {
        calls.commands.push(input);
        return { commandId: input.commandId, key: input.key, revision: 1 };
      },
      listBetaPreapprovals: async () => [],
      preapprovalCommand: async (input, work) => {
        calls.commands.push(input);
        const applied: { result: PreapprovalResult | null } = { result: null };
        await work({
          load: async () => ({
            kind: 'fresh',
            facts: {
              command: input.command,
              grant: {
                id: 'g'.repeat(24),
                revision: 1,
                claimed: false,
                invited: false,
              },
              claimedAccount: null,
              activeInvitation: false,
            },
            apply: async (decision) => {
              applied.result = decision.result;
              return decision.result;
            },
          }),
        });
        if (!applied.result) throw new Error('Test command did not apply');
        return { kind: 'settled', result: applied.result };
      },
      listOperatorReports: async () => [],
      listOperatorRestrictions: async () => [],
      resolveReport: async () => {
        throw new Error('Unexpected report command');
      },
      liftModeration: async () => {
        throw new Error('Unexpected lift');
      },
      listOperatorAccounts: async (input) => {
        calls.lists.push(input);
        return [account, { ...account, userId: 'v'.repeat(24) }];
      },
      betaAccessCommand: async (input, work) => {
        calls.commands.push(input);
        await work({
          load: async () => ({
            kind: 'fresh',
            account: {
              userId: input.targetUserId,
              actorId: 'a'.repeat(24),
              member: true,
              erased: false,
              revision: 1,
              beta: { state: 'pending', revision: 1 },
              ageBand: 'adult',
              restricted: false,
            },
            apply: async () => {},
          }),
        });
        return { kind: 'applied', result };
      },
      readOperatorCommand: async () => ({
        action: 'account.beta_access.update' as const,
        result,
        mailState: 'sent' as const,
      }),
    },
    profilePhotos: null,
    nextId: () => 'i'.repeat(24),
    logger: { log: () => {} },
    reporter: noopErrorReporter,
    ...overrides,
  });
  return { handle, calls };
};

let nonceCounter = 0;
export const signed = (input: {
  method: 'GET' | 'PUT';
  path: string;
  query?: [string, string][];
  body?: string;
  keyId?: string;
  key?: Uint8Array;
  nonce?: string;
  headers?: Record<string, string>;
}) => {
  const body = new TextEncoder().encode(input.body ?? '');
  const query = input.query ?? [];
  const headers = signOperatorRequest(
    {
      audience: 'daisy-web:staging',
      method: input.method,
      path: input.path,
      query,
      keyId: input.keyId ?? 'k20261026',
      timestamp: String(now),
      nonce:
        input.nonce ?? `nonce${String((nonceCounter += 1)).padStart(17, '0')}`,
      operatorRef: 'o'.repeat(24),
      body,
    },
    input.key ?? keyOf(1),
  );
  const search = new URLSearchParams(query).toString();
  return new Request(
    `http://[fdaa::1]:8081${input.path}${search ? `?${search}` : ''}`,
    {
      method: input.method,
      headers: {
        ...headers,
        ...(input.method === 'PUT'
          ? { 'content-type': 'application/json' }
          : {}),
        ...input.headers,
      },
      ...(input.method === 'PUT' ? { body } : {}),
    },
  );
};

export const command = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: 1,
    commandId: 'c'.repeat(24),
    state: 'approved',
    expectedRevision: 1,
    adminAuditHead: 'a'.repeat(64),
    ...overrides,
  });
export const put = (overrides: Parameters<typeof signed>[0] | object = {}) =>
  signed({
    method: 'PUT',
    path: `/operator/v1/accounts/${target}/beta-access`,
    body: command(),
    ...overrides,
  });
export const status = async (response: Response) => [
  response.status,
  ((await response.json()) as { error?: { code: string } }).error?.code ?? null,
];
