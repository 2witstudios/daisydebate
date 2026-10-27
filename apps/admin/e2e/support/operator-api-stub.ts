import { decideBetaAccessChange } from '@daisy/auth';
import {
  verifyOperatorRequest,
  type OperatorCrypto,
} from '@daisy/auth/operator-signature';
import type { BetaAccessCommandResult, BetaAccessState } from '@daisy/protocol';
import {
  betaAccessCommandSchema,
  matchOperatorRoute,
  operatorAccountsQuerySchema,
  type OperatorAccountsPage,
} from '@daisy/protocol/operator';
import { createHash, createHmac } from 'node:crypto';

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
  /** A durable 16+ age record (ISSUE-664); absent means it has one. */
  readonly ageAdmitted?: boolean;
};

type StubRequest = {
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

class LostResponse extends Error {}

/** node:crypto, as the participant app verifies, so a mismatch shows. */
const participantCrypto: OperatorCrypto = {
  hmacSha256: (key, text) =>
    createHmac('sha256', key).update(text, 'utf8').digest('base64url'),
  sha256Hex: (bytes) => createHash('sha256').update(bytes).digest('hex'),
  sha3Hex: (text) => createHash('sha3-256').update(text, 'utf8').digest('hex'),
};

const parsedBody = (bytes: Uint8Array): unknown =>
  bytes.byteLength === 0 ? null : JSON.parse(new TextDecoder().decode(bytes));

type Command = {
  readonly state: 'approved' | 'revoked';
  readonly expectedRevision: number;
};
type Decision = ReturnType<typeof decideBetaAccessChange>;

/** The shared transition over the stub's account and its age record. */
const decide = (account: StubAccount | undefined, command: Command) =>
  decideBetaAccessChange({
    current: account
      ? { state: account.accessState, revision: account.accessRevision }
      : null,
    desired: command.state,
    expectedRevision: command.expectedRevision,
    ageAdmitted: account?.ageAdmitted ?? true,
  });

/** The real router's codes: not found, a stale form, or the age refusal. */
const refusalOf = (decision: Decision) => {
  if (decision.kind === 'refused' && decision.reason === 'stale')
    return refusal(409, 'CONFLICT');
  if (decision.kind === 'refused' && decision.reason === 'age-required')
    return refusal(422, 'INVARIANT');
  return refusal(404, 'NOT_FOUND');
};

const resultOf = (
  commandId: string,
  account: StubAccount,
  decision: Exclude<Decision, { kind: 'refused' }>,
): BetaAccessCommandResult => ({
  commandId,
  outcome: decision.kind,
  accessState: account.accessState,
  accessRevision: account.accessRevision,
  mail:
    decision.kind === 'changed' && decision.to === 'approved'
      ? 'queued'
      : 'none',
});

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
    const decision = decide(account, command.data);
    if (decision.kind === 'refused' || !account) return refusalOf(decision);
    if (decision.kind === 'changed')
      Object.assign(account, {
        accessState: decision.to,
        accessRevision: decision.revision,
        decidedAt: new Date(input.nowMs()).toISOString(),
      });
    const result = resultOf(command.data.commandId, account, decision);
    receipts.set(command.data.commandId, result);
    return json(200, result);
  }

  /** The real verifier, then a one-time nonce; null refuses as AUTHENTICATION. */
  function authenticate(request: Request, url: URL, bytes: Uint8Array) {
    const verified = verifyOperatorRequest({
      audience: input.audience,
      method: request.method,
      path: url.pathname,
      query: [...url.searchParams.entries()],
      headers: [...request.headers.entries()],
      body: bytes,
      keys: new Map([[input.keyId, input.key]]),
      nowMs: input.nowMs(),
      crypto: participantCrypto,
    });
    if (!verified.ok || nonces.has(verified.nonce)) return null;
    nonces.add(verified.nonce);
    return verified;
  }

  function readBack(commandId: string): Response {
    const stored = receipts.get(commandId);
    return stored
      ? json(200, {
          result: stored,
          mailState: stored.mail === 'queued' ? 'queued' : null,
        })
      : refusal(404, 'NOT_FOUND');
  }

  function command(userId: string, body: unknown): Response {
    const fault = faults.shift();
    if (fault === 'lose-before-apply') throw new LostResponse('lost');
    const response = apply(userId, body);
    if (fault === 'lose-after-apply') throw new LostResponse('lost');
    return response;
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = matchOperatorRoute(request.method, url.pathname);
    if (!route) return refusal(404, 'NOT_FOUND');
    const bytes = new Uint8Array(await request.arrayBuffer());
    const verified = authenticate(request, url, bytes);
    if (!verified) return refusal(401, 'AUTHENTICATION');
    const body = parsedBody(bytes);
    received.push({
      route: route.route,
      nonce: verified.nonce,
      operatorRef: verified.operatorRef,
      body,
    });
    const id = route.id ?? '';
    if (route.route === 'listAccounts') return json(200, list(url));
    return route.route === 'readCommand' ? readBack(id) : command(id, body);
  }

  return {
    handle,
    accounts,
    received,
    /** Loses the next command's response, before or after it applies. */
    lose: (fault: StubFault) => faults.push(fault),
  };
}
