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
}: {
  link?: Error;
  passkey?: Error;
  supported?: boolean;
}) => {
  const calls: unknown[] = [];
  const client: SignInClient = {
    signIn: {
      magicLink: async (input) => {
        calls.push(input);
        return { error: link };
      },
      passkey: async () => {
        calls.push('passkey');
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
