import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  AFTER_RESPONSE_MAX_QUEUED,
  AFTER_RESPONSE_MAX_RUNNING,
} from './after-response';
import {
  create,
  existingAccount,
  magicLinkRequest,
} from './abuse.test-support';

setupRitewayBun();

describe('global sign-up ceilings at the magic-link send', () => {
  test('a sign-in link for an existing account spends the global ceilings but is never held back by them (ISSUE-54, ISSUE-188)', async () => {
    const { server, db, consumed, sent } = create({
      limiter: (record) => async (key, rule) => {
        record.push({ key, rule });
        return key.startsWith('auth:magic-link:global:')
          ? { allowed: false, retryAfterSeconds: 30 }
          : { allowed: true, retryAfterSeconds: 0 };
      },
    });
    db.user.push(existingAccount);
    const response = await server.instance.handler(magicLinkRequest());
    await server.settled();
    assert({
      given:
        'saturated global ceilings and a magic-link request for an address that has an account',
      should:
        'spend the global ceiling exactly as a sign-up does, and still admit and mail the sign-in link',
      actual: {
        status: response.status,
        sent: sent.length,
        globalConsumed: consumed
          .filter(({ key }) => key.startsWith('auth:magic-link:global:'))
          .map(({ key }) => key),
      },
      expected: {
        status: 200,
        sent: 1,
        globalConsumed: ['auth:magic-link:global:60'],
      },
    });
  });

  test('an existing account and a new address spend the same buckets (ISSUE-188)', async () => {
    const unknown = create();
    const known = create();
    known.db.user.push(existingAccount);
    await unknown.server.instance.handler(magicLinkRequest());
    await known.server.instance.handler(magicLinkRequest());
    assert({
      given:
        'the same magic-link request with and without an account behind the address',
      should:
        'consume the identical buckets, so no counter depends on the account',
      actual: known.consumed,
      expected: unknown.consumed,
    });
  });

  test('a saturated global per-minute ceiling drops the sign-up mail behind the ordinary success (ISSUE-182)', async () => {
    const { server, sent, db, logs } = create({
      limiter: () => async (key) =>
        key === 'auth:magic-link:global:60'
          ? { allowed: false, retryAfterSeconds: 30 }
          : { allowed: true, retryAfterSeconds: 0 },
    });
    const response = await server.instance.handler(magicLinkRequest());
    await server.settled();
    assert({
      given:
        'a limiter denying only the global per-minute bucket and a request for an address with no account',
      should:
        'answer the ordinary 200 with no Retry-After, send nothing, keep no token and log the denial',
      actual: {
        status: response.status,
        body: await response.json(),
        retryAfter: response.headers.has('retry-after'),
        sent: sent.length,
        tokens: db.verification.length,
        logged: logs.map(([event]) => event).includes('auth.rate_limit.denied'),
      },
      expected: {
        status: 200,
        body: { status: true },
        retryAfter: false,
        sent: 0,
        tokens: 0,
        logged: true,
      },
    });
  });

  test('a limiter outage on the global ceiling fails the sign-up closed with a 503 and no mail', async () => {
    const { server, sent } = create({
      limiter: () => async (key) => {
        if (key.startsWith('auth:magic-link:global:'))
          throw new Error('redis down');
        return { allowed: true, retryAfterSeconds: 0 };
      },
    });
    const response = await server.instance.handler(magicLinkRequest());
    assert({
      given: 'a limiter that fails only on the global ceiling',
      should: 'answer the public 503 and send nothing',
      actual: { status: response.status, sent: sent.length },
      expected: { status: 503, sent: 0 },
    });
  });

  test('a mail-provider failure under a saturated ceiling answers a new address and an existing account alike (ISSUE-189)', async () => {
    const saturated = () =>
      create({
        sendFailure: true,
        limiter: () => async (key) =>
          key.startsWith('auth:magic-link:global:')
            ? { allowed: false, retryAfterSeconds: 30 }
            : { allowed: true, retryAfterSeconds: 0 },
      });
    const unknown = saturated();
    const known = saturated();
    known.db.user.push(existingAccount);
    const answer = async (response: Response) => ({
      status: response.status,
      body: await response.text(),
      headers: [...response.headers.entries()],
    });
    const unknownAnswer = await answer(
      await unknown.server.instance.handler(magicLinkRequest()),
    );
    const knownAnswer = await answer(
      await known.server.instance.handler(magicLinkRequest()),
    );
    await Promise.all([known.server.settled(), unknown.server.settled()]);
    assert({
      given:
        'saturated global ceilings and a failing mail transport, for an address with and without an account',
      should:
        'answer both with the same status, body and headers, and keep no unmailed token',
      actual: {
        known: knownAnswer,
        status: knownAnswer.status,
        tokens: [known.db.verification.length, unknown.db.verification.length],
      },
      expected: { known: unknownAnswer, status: 200, tokens: [0, 0] },
    });
  });

  test('a mail-provider failure below the ceiling stays the retryable 503 for both (ISSUE-189)', async () => {
    const unknown = create({ sendFailure: true });
    const known = create({ sendFailure: true });
    known.db.user.push(existingAccount);
    const unknownResponse =
      await unknown.server.instance.handler(magicLinkRequest());
    const knownResponse =
      await known.server.instance.handler(magicLinkRequest());
    assert({
      given: 'a failing mail transport and a global ceiling with room',
      should: 'answer both with the same retryable 503 EMAIL_DELIVERY_FAILED',
      actual: {
        known: [knownResponse.status, await knownResponse.json()],
        unknown: [unknownResponse.status, await unknownResponse.json()],
      },
      expected: {
        known: [
          503,
          {
            code: 'EMAIL_DELIVERY_FAILED',
            message: 'We could not send the email. Please try again.',
          },
        ],
        unknown: [
          503,
          {
            code: 'EMAIL_DELIVERY_FAILED',
            message: 'We could not send the email. Please try again.',
          },
        ],
      },
    });
  });
});

describe('a saturated ceiling answers before any account-dependent work (ISSUE-185)', () => {
  const saturatedHeld = () =>
    create({
      heldTransport: true,
      limiter: () => async (key) =>
        key.startsWith('auth:magic-link:global:')
          ? { allowed: false, retryAfterSeconds: 30 }
          : { allowed: true, retryAfterSeconds: 0 },
    });

  /**
   * The request's answer, or the fact that it was still waiting once the
   * held transport had been reached and every queued task had run.
   */
  const answerOrWaiting = (
    harness: ReturnType<typeof saturatedHeld>,
  ): Promise<{ answered: number; trace: string[] } | 'waiting on delivery'> =>
    Promise.race([
      harness.server.instance.handler(magicLinkRequest()).then((response) => ({
        answered: response.status,
        trace: [...harness.trace],
      })),
      harness.transportReached
        .then(() => new Promise((resolve) => setTimeout(resolve, 0)))
        .then(() => 'waiting on delivery' as const),
    ]);

  test('an existing account and an unknown address answer with the same work done, while the transport has not answered', async () => {
    const unknown = saturatedHeld();
    const known = saturatedHeld();
    known.db.user.push(existingAccount);
    const unknownAnswer = await answerOrWaiting(unknown);
    const knownAnswer = await answerOrWaiting(known);
    assert({
      given:
        'saturated global ceilings and a mail transport that has not answered, for an address with and without an account',
      should:
        'answer both 200 after the identical seam calls (the limiter buckets and the suppression check), with no send, lookup-dependent step or receipt before the answer',
      actual: knownAnswer,
      expected: unknownAnswer,
    });
    assert({
      given: 'the same two requests',
      should: 'answer 200 without waiting on delivery',
      actual:
        unknownAnswer === 'waiting on delivery'
          ? unknownAnswer
          : unknownAnswer.answered,
      expected: 200,
    });
  });

  test('once answered, the existing account is still mailed and the unknown address still dropped', async () => {
    const unknown = saturatedHeld();
    const known = saturatedHeld();
    known.db.user.push(existingAccount);
    await answerOrWaiting(unknown);
    await answerOrWaiting(known);
    known.release();
    unknown.release();
    await Promise.all([known.server.settled(), unknown.server.settled()]);
    assert({
      given: 'the saturated requests above, after the transport answers',
      should:
        'mail and keep the token of the existing account only, and delete the unknown address token',
      actual: {
        sent: [known.sent.length, unknown.sent.length],
        tokens: [known.db.verification.length, unknown.db.verification.length],
      },
      expected: { sent: [1, 0], tokens: [1, 0] },
    });
  });

  test('past the bound, an existing account and an unknown address are shed alike, before any lookup (DEC-73)', async () => {
    const harness = saturatedHeld();
    harness.db.user.push(existingAccount);
    const bound = AFTER_RESPONSE_MAX_RUNNING + AFTER_RESPONSE_MAX_QUEUED;
    for (let index = 0; index < bound; index += 1)
      await harness.server.instance.handler(magicLinkRequest());
    const tokensBefore = harness.db.verification.length;
    const answer = async (response: Response) => ({
      status: response.status,
      body: await response.text(),
      headers: [...response.headers.entries()],
    });
    const knownAnswer = await answer(
      await harness.server.instance.handler(magicLinkRequest()),
    );
    const unknownAnswer = await answer(
      await harness.server.instance.handler(
        magicLinkRequest({}, 'newcomer@daisy.example.com'),
      ),
    );
    harness.release();
    await harness.server.settled();
    assert({
      given: `saturated ceilings and ${bound} handed-off sign-ins the transport has not answered, then one more request for an existing account and one for an unknown address`,
      should:
        'answer both alike, shed both with a log line, mail neither, and leave both tokens untouched (no lookup, send or drop ran)',
      actual: {
        known: knownAnswer,
        status: knownAnswer.status,
        shed: harness.logs.filter(([event]) => event === 'auth.mail.shed')
          .length,
        sent: harness.sent.length,
        tokensKept: harness.db.verification.length - tokensBefore,
      },
      expected: {
        known: unknownAnswer,
        status: 200,
        shed: 2,
        sent: bound,
        tokensKept: 2,
      },
    });
  });
});
