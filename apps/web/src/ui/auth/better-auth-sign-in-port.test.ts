import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createBetterAuthSignInPort,
  type SignInClient,
} from './better-auth-sign-in-port';

setupRitewayBun();

type Error = { status?: number; code?: string } | null;

const portWith = ({
  link = null,
  passkey = null,
  supported = true,
  autofill = true,
}: {
  link?: Error;
  passkey?: Error;
  supported?: boolean;
  autofill?: boolean;
}) => {
  const calls: unknown[] = [];
  const client: SignInClient = {
    signIn: {
      magicLink: async (input) => {
        calls.push(input);
        return { error: link };
      },
      passkey: async (opts) => {
        calls.push(opts?.autoFill ? 'passkey-autofill' : 'passkey');
        return { error: passkey };
      },
    },
  };
  return {
    calls,
    port: createBetterAuthSignInPort({
      client,
      destination: '/ranked',
      supportsPasskeys: () => supported,
      supportsPasskeyAutofill: async () => autofill,
    }),
  };
};

describe('Better Auth sign-in port: magic link', () => {
  test('asks for a link that lands on the destination, or on onboarding first', async () => {
    const { port, calls } = portWith({});
    const outcome = await port.requestLink('ada@example.test');
    assert({
      given: 'an accepted request for a link',
      should: 'report sent and pass both callbacks',
      actual: [outcome, calls],
      expected: [
        { kind: 'sent' },
        [
          {
            email: 'ada@example.test',
            callbackURL: '/ranked',
            newUserCallbackURL: '/onboarding/username?next=%2Franked',
          },
        ],
      ],
    });
  });

  test('maps refusals to their honest outcomes', async () => {
    const outcome = async (link: Error) =>
      (await portWith({ link }).port.requestLink('a@b.test')).kind;
    assert({
      given: 'suppressed, throttled, failing and unknown refusals',
      should: 'answer undeliverable, rate-limited, unavailable, unavailable',
      actual: [
        await outcome({ status: 422, code: 'EMAIL_UNDELIVERABLE' }),
        await outcome({ status: 429 }),
        await outcome({ status: 503, code: 'EMAIL_DELIVERY_FAILED' }),
        await outcome({}),
      ],
      expected: ['undeliverable', 'rate-limited', 'unavailable', 'unavailable'],
    });
  });
});

describe('Better Auth sign-in port: passkey', () => {
  test('a verified ceremony signs in', async () => {
    assert({
      given: 'a ceremony the server verified',
      should: 'report signed-in',
      actual: await portWith({}).port.signInWithPasskey(),
      expected: { kind: 'signed-in' },
    });
  });

  test('a dismissed prompt is cancelled and never a success', async () => {
    const outcome = async (passkey: Error) =>
      (await portWith({ passkey }).port.signInWithPasskey()).kind;
    assert({
      given: 'cancelled, aborted, server-refused and unknown ceremonies',
      should: 'answer cancelled, cancelled, failed, failed',
      actual: [
        await outcome({ status: 400, code: 'AUTH_CANCELLED' }),
        await outcome({ status: 400, code: 'ERROR_CEREMONY_ABORTED' }),
        await outcome({ status: 401, code: 'AUTHENTICATION_FAILED' }),
        await outcome({}),
      ],
      expected: ['cancelled', 'cancelled', 'failed', 'failed'],
    });
  });

  test('a browser without WebAuthn is unsupported and starts no ceremony', async () => {
    const { port, calls } = portWith({ supported: false });
    assert({
      given: 'a browser that cannot do WebAuthn',
      should: 'report unsupported without calling the client',
      actual: [await port.signInWithPasskey(), calls],
      expected: [{ kind: 'unsupported' }, []],
    });
  });
});

describe('Better Auth sign-in port: passkey autofill', () => {
  test('arms browser autofill and signs in when a passkey is picked', async () => {
    const { port, calls } = portWith({});
    assert({
      given: 'a browser with conditional mediation and a verified pick',
      should: 'start an autofill ceremony and report signed-in',
      actual: [await port.offerPasskeyAutofill(), calls],
      expected: [{ kind: 'signed-in' }, ['passkey-autofill']],
    });
  });

  test('tells a newer ceremony, a dismissal and a refused pick apart', async () => {
    const outcome = async (passkey: Error) =>
      (await portWith({ passkey }).port.offerPasskeyAutofill()).kind;
    assert({
      given:
        'an abort, a dismissed prompt, a lost challenge, an unknown passkey, a throttle and a server fault',
      should:
        'answer superseded, interrupted, refused, refused, interrupted, interrupted',
      actual: [
        await outcome({ status: 400, code: 'ERROR_CEREMONY_ABORTED' }),
        await outcome({
          status: 400,
          code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
        }),
        await outcome({ status: 400, code: 'CHALLENGE_NOT_FOUND' }),
        await outcome({ status: 401, code: 'PASSKEY_NOT_FOUND' }),
        await outcome({ status: 429 }),
        await outcome({ status: 503 }),
      ],
      expected: [
        'superseded',
        'interrupted',
        'refused',
        'refused',
        'interrupted',
        'interrupted',
      ],
    });
  });

  test('a browser without conditional mediation starts no ceremony', async () => {
    const { port, calls } = portWith({ autofill: false });
    assert({
      given: 'a browser that cannot offer passkeys in autofill',
      should: 'report unavailable without calling the client',
      actual: [await port.offerPasskeyAutofill(), calls],
      expected: [{ kind: 'unavailable' }, []],
    });
  });
});

/**
 * A client whose autofill ceremony stays pending until released, and whose
 * button ceremonies answer from a script, for the abort race.
 */
const racingPort = (button: readonly Error[]) => {
  const calls: string[] = [];
  let releaseAutofill: (error: Error) => void = () => {};
  const script = [...button];
  const client: SignInClient = {
    signIn: {
      magicLink: async () => ({ error: null }),
      passkey: (opts) => {
        if (opts?.autoFill) {
          calls.push('passkey-autofill');
          return new Promise((resolve) => {
            releaseAutofill = (error) => resolve({ error });
          });
        }
        calls.push('passkey');
        return Promise.resolve({ error: script.shift() ?? null });
      },
    },
  };
  const port = createBetterAuthSignInPort({
    client,
    destination: '/ranked',
    supportsPasskeys: () => true,
    supportsPasskeyAutofill: async () => true,
  });
  return {
    port,
    calls,
    releaseAutofill: (error: Error) => releaseAutofill(error),
  };
};

describe('Better Auth sign-in port: autofill and button race', () => {
  test('retries the button once when a late autofill request aborted it', async () => {
    const { port, calls, releaseAutofill } = racingPort([
      { status: 400, code: 'ERROR_CEREMONY_ABORTED' },
      null,
    ]);
    const autofill = port.offerPasskeyAutofill();
    // Let the autofill request reach the client before the button starts.
    await new Promise((resolve) => setImmediate(resolve));
    const outcome = await port.signInWithPasskey();
    releaseAutofill({ status: 400, code: 'ERROR_CEREMONY_ABORTED' });
    assert({
      given:
        'an autofill request still in flight when the button ceremony is aborted',
      should:
        'run the button ceremony again, which then aborts the autofill instead',
      actual: [outcome, calls, await autofill],
      expected: [
        { kind: 'signed-in' },
        ['passkey-autofill', 'passkey', 'passkey'],
        { kind: 'superseded' },
      ],
    });
  });

  test('does not retry an aborted button ceremony with no autofill in flight', async () => {
    const { port, calls } = racingPort([
      { status: 400, code: 'ERROR_CEREMONY_ABORTED' },
    ]);
    assert({
      given: 'a button ceremony aborted while no autofill request is running',
      should: 'report it cancelled after a single attempt',
      actual: [await port.signInWithPasskey(), calls],
      expected: [{ kind: 'cancelled' }, ['passkey']],
    });
  });
});
