import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '@daisy/db';
import {
  capturedToken,
  countFixtureRows,
  createTestAuthServer,
  emptyCounts,
  expiresWithinMagicLinkWindow,
  fixtureEmail,
  isCuid2,
  isDate,
  logsLeakSecrets,
  removeFixture,
  verificationValue,
  verifyUrl,
  type RecordedLogs,
  type SentMessages,
} from './auth-helpers';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

type RunContext = {
  auth: ReturnType<typeof createTestAuthServer>;
  email: string;
  sent: SentMessages;
  logged: RecordedLogs;
  setUserId: (id: string) => void;
};

/** Runs one auth server over the shared pool and cleans only its fixtures. */
const runAuth = async (body: (context: RunContext) => Promise<void>) => {
  const email = fixtureEmail();
  const sent: SentMessages = [];
  const logged: RecordedLogs = [];
  const database = createDatabase({ url });
  const auth = createTestAuthServer(database.authAdapter, {
    sent,
    recordedLogs: logged,
  });
  let userId: string | undefined;
  try {
    await body({
      auth,
      email,
      sent,
      logged,
      setUserId: (id) => {
        userId = id;
      },
    });
  } finally {
    await database.close();
    await removeFixture(url, email, userId, []);
  }
  return { email, userId, logged };
};

test('magic-link request persists a token-bearing verification record', async () => {
  const { email } = await runAuth(async ({ auth, email, sent }) => {
    const result = await auth.instance.api.signInMagicLink({
      body: { email },
      headers: new Headers({ origin: auth.config.PUBLIC_APP_URL }),
    });
    assert({
      given: 'a magic-link request using the existing Bun SQL pool',
      should: 'succeed and send one account-neutral message',
      actual: {
        status: result.status,
        sent: sent.map(({ to, subject }) => ({ to, subject })),
      },
      expected: {
        status: true,
        sent: [{ to: email, subject: 'Sign in to Daisy' }],
      },
    });

    const probe = new SQL(url);
    try {
      const rows = await probe.unsafe(
        'select id, identifier, value, expires_at from verification where value = $1',
        [verificationValue(email)],
      );
      const record = rows[0] as
        | { id: string; identifier: string; value: string; expires_at: Date }
        | undefined;
      assert({
        given: 'the durable verification record after requesting a link',
        should:
          'carry the token in identifier, the account in value and a five-minute expiry',
        actual: {
          exists: record !== undefined,
          carried: record?.value === verificationValue(email),
          identifierIsNotTheEmail: record ? record.identifier !== email : false,
          dateExpiry: isDate(record?.expires_at),
          withinWindow: isDate(record?.expires_at)
            ? expiresWithinMagicLinkWindow(record.expires_at)
            : false,
        },
        expected: {
          exists: true,
          carried: true,
          identifierIsNotTheEmail: true,
          dateExpiry: true,
          withinWindow: true,
        },
      });
    } finally {
      await probe.close();
    }
  });

  assert({
    given: 'the bounded fixture cleanup after the request',
    should: 'leave no fixture records behind',
    actual: await countFixtureRows(url, email, undefined),
    expected: emptyCounts,
  });
});

type VerifiedPayload = {
  token: string;
  user: { id: string; email: string; emailVerified: boolean };
  session: { id: string; expiresAt: unknown };
};

const sessionBoundary = (
  row: { id: string; expires_at: Date; token: string } | undefined,
  verified: VerifiedPayload,
) => ({
  exists: row !== undefined,
  sameSession: row?.id === verified.session.id,
  rowExpiresAtIsDate: isDate(row?.expires_at),
  isoRoundTrip: isDate(row?.expires_at)
    ? new Date(verified.session.expiresAt as string).toISOString() ===
      row.expires_at.toISOString()
    : false,
  cookieTokenMatchesRow: row?.token === verified.token,
});

const replayRejected = (status: number, body: { token?: string }) =>
  status !== 200 && body.token === undefined;

test('redeeming the captured link durably creates a verified user and session', async () => {
  const { email, userId } = await runAuth(
    async ({ auth, email, sent, logged, setUserId }) => {
      await auth.instance.api.signInMagicLink({
        body: { email },
        headers: new Headers({ origin: auth.config.PUBLIC_APP_URL }),
      });
      const token = capturedToken(sent[0]!);

      // Redeem through the real HTTP handler so the session cookie is the
      // app's own signed cookie.
      const redemption = await auth.instance.handler(
        new Request(verifyUrl(token), {
          headers: new Headers({ origin: auth.config.PUBLIC_APP_URL }),
        }),
      );
      const verified = (await redemption.json()) as {
        token: string;
        user: { id: string; email: string; emailVerified: boolean };
        session: { id: string; expiresAt: unknown };
      };
      setUserId(verified.user.id);
      const sessionCookie = redemption.headers.get('set-cookie')?.split(';')[0];
      const sessionView = (await auth.instance.api.getSession({
        headers: new Headers({ cookie: sessionCookie ?? '' }),
      })) as { user: { id: string } } | null;
      assert({
        given: 'redemption of the captured magic link',
        should: 'create a verified cuid2 user whose cookie resolves durably',
        actual: {
          status: redemption.status,
          email: verified.user.email,
          emailVerified: verified.user.emailVerified,
          cuid2Id: isCuid2(verified.user.id),
          cookieIssued: typeof sessionCookie === 'string',
          resolvedUser: sessionView?.user.id,
        },
        expected: {
          status: 200,
          email,
          emailVerified: true,
          cuid2Id: true,
          cookieIssued: true,
          resolvedUser: verified.user.id,
        },
      });

      const probe = new SQL(url);
      try {
        const sessionRows = await probe.unsafe(
          'select id, expires_at, token from session where user_id = $1',
          [verified.user.id],
        );
        const row = sessionRows[0] as
          { id: string; expires_at: Date; token: string } | undefined;
        assert({
          given: 'the durable session row and the verification response',
          should: 'agree on identity and the Date/ISO timestamp boundary',
          actual: sessionBoundary(row, verified),
          expected: {
            exists: true,
            sameSession: true,
            rowExpiresAtIsDate: true,
            isoRoundTrip: true,
            cookieTokenMatchesRow: true,
          },
        });
      } finally {
        await probe.close();
      }

      // Replay: the consumed token must never authenticate twice.
      const replay = await auth.instance.handler(
        new Request(verifyUrl(token), {
          headers: new Headers({ origin: auth.config.PUBLIC_APP_URL }),
        }),
      );
      const replayBody = (await replay.json().catch(() => ({}))) as {
        token?: string;
      };
      assert({
        given: 'a replayed verification token',
        should: 'authenticate no second time',
        actual: { rejected: replayRejected(replay.status, replayBody) },
        expected: { rejected: true },
      });

      assert({
        given: 'the integration run with its captured logger',
        should: 'never log credential, token or email material',
        actual: logsLeakSecrets(logged, [token, email]),
        expected: false,
      });
    },
  );

  assert({
    given: 'the bounded fixture cleanup after the completed round trip',
    should: 'leave no user, session or verification records behind',
    actual: await countFixtureRows(url, email, userId),
    expected: emptyCounts,
  });
});
