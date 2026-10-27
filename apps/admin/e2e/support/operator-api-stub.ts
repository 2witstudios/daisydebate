import { decideBetaAccessChange } from '@daisy/auth';
import { verifyOperatorRequest } from '@daisy/auth/operator-signature';
import type { BetaAccessCommandResult, BetaAccessState } from '@daisy/protocol';
import {
  betaAccessCommandSchema,
  matchOperatorRoute,
  operatorAccountsQuerySchema,
  type OperatorAccountsPage,
} from '@daisy/protocol/operator';
import { nodeOperatorCrypto } from '../../src/features/operator-client/node-crypto';

/**
 * A stand-in for the participant app's operator API (ADR 0079) that the
 * admin tests talk to: every request must pass the real verifier and a
 * one-time nonce, and a command applies the real transition once per
 * command id. It holds accounts in memory; the participant app's own suites
 * prove the durable side.
 */
export type StubAccount = {
  readonly userId: string;
  readonly username: string;
  accessState: BetaAccessState;
  accessRevision: number;
  readonly requestedAt: string;
  decidedAt: string | null;
};

export type StubRequest = {
  readonly route: string;
  readonly nonce: string;
  readonly operatorRef: string;
  readonly body: unknown;
};

/** A response the next command loses: before or after it applies. */
export type StubFault = 'lose-before-apply' | 'lose-after-apply';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const refusal = (status: number, code: string) =>
  json(status, { error: { code } });

export class LostResponse extends Error {}

export function createOperatorApiStub(input: {
  readonly audience: string;
  readonly keyId: string;
  readonly key: Uint8Array;
  readonly nowMs: () => number;
  readonly accounts: readonly StubAccount[];
}) {
  const accounts = new Map(input.accounts.map((a) => [a.userId, { ...a }]));
  const receipts = new Map<string, BetaAccessCommandResult>();
  const nonces = new Set<string>();
  const received: StubRequest[] = [];
  const faults: StubFault[] = [];

  function list(url: URL): OperatorAccountsPage {
    const query = operatorAccountsQuerySchema.parse(
      Object.fromEntries(url.searchParams.entries()),
    );
    const items = [...accounts.values()]
      .filter((account) => account.accessState === query.access)
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
      .slice(0, query.limit)
      .map((account) => ({ ...account }));
    return { items, nextCursor: null };
  }

  function apply(userId: string, body: unknown): Response {
    const command = betaAccessCommandSchema.safeParse(body);
    if (!command.success) return refusal(400, 'VALIDATION');
    const stored = receipts.get(command.data.commandId);
    if (stored) return json(200, stored);
    const account = accounts.get(userId);
    const decision = decideBetaAccessChange({
      current: account
        ? { state: account.accessState, revision: account.accessRevision }
        : null,
      desired: command.data.state,
      expectedRevision: command.data.expectedRevision,
      ageAdmitted: true,
    });
    if (decision.kind === 'refused' || !account)
      return decision.kind === 'refused' && decision.reason === 'not-found'
        ? refusal(404, 'NOT_FOUND')
        : refusal(409, 'CONFLICT');
    const changed = decision.kind === 'changed';
    if (changed) {
      account.accessState = decision.to;
      account.accessRevision = decision.revision;
      account.decidedAt = new Date(input.nowMs()).toISOString();
    }
    const result: BetaAccessCommandResult = {
      commandId: command.data.commandId,
      outcome: decision.kind,
      accessState: account.accessState,
      accessRevision: account.accessRevision,
      mail: changed && decision.to === 'approved' ? 'queued' : 'none',
    };
    receipts.set(command.data.commandId, result);
    return json(200, result);
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = matchOperatorRoute(request.method, url.pathname);
    if (!route) return refusal(404, 'NOT_FOUND');
    const bytes = new Uint8Array(await request.arrayBuffer());
    const verified = verifyOperatorRequest({
      audience: input.audience,
      method: request.method,
      path: url.pathname,
      query: [...url.searchParams.entries()],
      headers: [...request.headers.entries()],
      body: bytes,
      keys: new Map([[input.keyId, input.key]]),
      nowMs: input.nowMs(),
      crypto: nodeOperatorCrypto,
    });
    if (!verified.ok || nonces.has(verified.nonce))
      return refusal(401, 'AUTHENTICATION');
    nonces.add(verified.nonce);
    const body =
      bytes.byteLength === 0
        ? null
        : JSON.parse(new TextDecoder().decode(bytes));
    received.push({
      route: route.route,
      nonce: verified.nonce,
      operatorRef: verified.operatorRef,
      body,
    });
    if (route.route === 'listAccounts') return json(200, list(url));
    if (route.route === 'readCommand') {
      const stored = receipts.get(route.id ?? '');
      return stored
        ? json(200, {
            result: stored,
            mailState: stored.mail === 'queued' ? 'queued' : null,
          })
        : refusal(404, 'NOT_FOUND');
    }
    const fault = faults.shift();
    if (fault === 'lose-before-apply') throw new LostResponse('lost');
    const response = apply(route.id ?? '', body);
    if (fault === 'lose-after-apply') throw new LostResponse('lost');
    return response;
  }

  return {
    handle,
    accounts,
    received,
    /** Loses the next command's response, before or after it applies. */
    lose: (fault: StubFault) => faults.push(fault),
  };
}
export type OperatorApiStub = ReturnType<typeof createOperatorApiStub>;
