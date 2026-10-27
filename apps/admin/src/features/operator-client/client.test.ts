import { fixedClock } from '@daisy/clock';
import {
  signOperatorRequest,
  verifyOperatorRequest,
} from '@daisy/auth/operator-signature';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createOperatorClient, type OperatorFetch } from './client';
import { nodeOperatorCrypto } from './node-crypto';

setupRitewayBun();

const operatorRef = 'o'.repeat(24);
const userId = 'u'.repeat(24);
const commandId = 'c'.repeat(24);
const key = new Uint8Array(32).fill(7);
const config = {
  baseUrl: 'http://operator.test:8081',
  keyId: 'admin1',
  key,
  audience: 'daisy-web:local',
};
const now = '2026-10-27T12:00:00.000Z';

/** Each call draws the next byte pattern, so nonces are distinguishable. */
const countingRandom = () => {
  let draw = 0;
  return (length: number) => new Uint8Array(length).fill((draw += 1));
};

type Captured = { readonly url: string; readonly init: RequestInit };

const clientWith = (answer: (captured: Captured) => Promise<Response>) => {
  const sent: Captured[] = [];
  const fetch: OperatorFetch = (url, init) => {
    sent.push({ url, init });
    return answer({ url, init });
  };
  const client = createOperatorClient({
    config,
    crypto: nodeOperatorCrypto,
    clock: fixedClock(now),
    random: countingRandom(),
    fetch,
    timeoutMs: 5_000,
  });
  return { client, sent };
};

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

const applied = {
  commandId,
  outcome: 'changed',
  accessState: 'approved',
  accessRevision: 2,
  mail: 'queued',
} as const;

const command = {
  v: 1,
  commandId,
  state: 'approved',
  expectedRevision: 1,
  adminAuditHead: 'a'.repeat(64),
} as const;

const headersOf = (init: RequestInit) =>
  Object.fromEntries(new Headers(init.headers).entries());

describe('the signing operator client', () => {
  test('signs each request with the shared signer', async () => {
    const { client, sent } = clientWith(() => json(200, applied));
    await client.setBetaAccess(operatorRef, userId, command);
    const [request] = sent;
    const body = new TextEncoder().encode(String(request?.init.body));
    const expected = signOperatorRequest(
      {
        audience: config.audience,
        method: 'PUT',
        path: `/operator/v1/accounts/${userId}/beta-access`,
        query: [],
        keyId: config.keyId,
        timestamp: String(Date.parse(now)),
        nonce: Buffer.from(new Uint8Array(16).fill(1)).toString('base64url'),
        operatorRef,
        body,
      },
      key,
      nodeOperatorCrypto,
    );
    const headers = headersOf(request?.init ?? {});
    assert({
      given: 'a beta access command',
      should: 'send the canonical signature headers and the JSON body',
      actual: {
        url: request?.url,
        method: request?.init.method,
        signed: Object.fromEntries(
          Object.keys(expected).map((name) => [name, headers[name]]),
        ),
        contentType: headers['content-type'],
        body: JSON.parse(String(request?.init.body)),
      },
      expected: {
        url: `${config.baseUrl}/operator/v1/accounts/${userId}/beta-access`,
        method: 'PUT',
        signed: expected,
        contentType: 'application/json',
        body: command,
      },
    });
  });

  test('a request the participant app verifies', async () => {
    const { client, sent } = clientWith(() =>
      json(200, { items: [], nextCursor: null }),
    );
    await client.listAccounts(operatorRef, {
      access: 'pending',
      cursor: 'next page',
      limit: 20,
    });
    const [request] = sent;
    const url = new URL(request?.url ?? '');
    assert({
      given: 'a page request with a cursor that needs encoding',
      should: 'pass the real verifier with the operator reference',
      actual: verifyOperatorRequest({
        audience: config.audience,
        method: 'GET',
        path: url.pathname,
        query: [...url.searchParams.entries()],
        headers: Object.entries(headersOf(request?.init ?? {})),
        body: new Uint8Array(),
        keys: new Map([[config.keyId, key]]),
        nowMs: Date.parse(now),
        crypto: nodeOperatorCrypto,
      }),
      expected: {
        ok: true,
        keyId: config.keyId,
        operatorRef,
        nonce: Buffer.from(new Uint8Array(16).fill(1)).toString('base64url'),
      },
    });
  });

  test('a retry is signed with a fresh nonce', async () => {
    const { client, sent } = clientWith(() => json(200, applied));
    await client.setBetaAccess(operatorRef, userId, command);
    await client.setBetaAccess(operatorRef, userId, command);
    const nonces = sent.map(({ init }) => headersOf(init)['daisy-nonce']);
    assert({
      given: 'the same command sent twice',
      should: 'carry two different 22-character nonces',
      actual: [new Set(nonces).size, nonces.map((nonce) => nonce?.length)],
      expected: [2, [22, 22]],
    });
  });
});

describe('operator response outcomes', () => {
  const outcomeOf = async (answer: () => Promise<Response>) =>
    (
      await clientWith(answer).client.setBetaAccess(
        operatorRef,
        userId,
        command,
      )
    ).kind;

  test('a well-formed result', async () => {
    assert({
      given: 'a 200 holding the closed result',
      should: 'return it',
      actual: await clientWith(() => json(200, applied)).client.setBetaAccess(
        operatorRef,
        userId,
        command,
      ),
      expected: { kind: 'ok', value: applied },
    });
  });

  test('every definite refusal', async () => {
    const refusals = [
      ['VALIDATION', 400],
      ['AUTHENTICATION', 401],
      ['AUTHORIZATION', 403],
      ['NOT_FOUND', 404],
      ['CONFLICT', 409],
      ['PAYLOAD_TOO_LARGE', 413],
    ] as const;
    const actual = [];
    for (const [code, status] of refusals)
      actual.push(
        await clientWith(() =>
          json(status, { error: { code } }),
        ).client.setBetaAccess(operatorRef, userId, command),
      );
    assert({
      given: 'each refusal the API makes before or instead of a change',
      should: 'name its code',
      actual,
      expected: refusals.map(([code]) => ({ kind: 'rejected' as const, code })),
    });
  });

  test('anything that leaves the outcome open', async () => {
    const abort = () =>
      Promise.reject(new DOMException('timed out', 'TimeoutError'));
    assert({
      given:
        'an infrastructure or internal error, a code at the wrong status, a malformed result, a network error or a timeout',
      should: 'treat the outcome as unknown',
      actual: [
        await outcomeOf(() => json(503, { error: { code: 'INFRASTRUCTURE' } })),
        await outcomeOf(() => json(500, { error: { code: 'INTERNAL' } })),
        await outcomeOf(() => json(500, { error: { code: 'CONFLICT' } })),
        await outcomeOf(() => json(200, { ...applied, outcome: 'maybe' })),
        await outcomeOf(() =>
          Promise.resolve(new Response('not json', { status: 200 })),
        ),
        await outcomeOf(() => Promise.reject(new TypeError('fetch failed'))),
        await outcomeOf(abort),
      ],
      expected: Array(7).fill('unknown'),
    });
  });

  test('a command read back for reconciliation', async () => {
    const stored = { result: applied, mailState: 'sent' };
    const { client, sent } = clientWith(() => json(200, stored));
    assert({
      given: 'the stored receipt of a command',
      should: 'read it from the command route',
      actual: [
        await client.readCommand(operatorRef, commandId),
        new URL(sent[0]?.url ?? '').pathname,
        sent[0]?.init.method,
      ],
      expected: [
        { kind: 'ok', value: stored },
        `/operator/v1/commands/${commandId}`,
        'GET',
      ],
    });
  });
});
