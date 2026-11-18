import { CLIENT_IP_HEADER } from '@daisy/ingress/client-ip';
import { noopErrorReporter } from '@daisy/observability';
import type { LeagueRequest } from '@daisy/protocol/league-request';
import { createId } from '@paralleldrive/cuid2';
import { afterAll } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createLeagueRequestHandlers } from '../src/features/league-requests/handlers';
import { createLeagueRequestNotices } from '../src/features/league-requests/owner-notice';
import { nextWorkerToken } from '../src/server/worker-token';
import { createTestApp, withSql } from './fixtures';

setupRitewayBun();

const ownerAddress = 'league-owner@example.test';
const t = createTestApp({ LEAGUE_REQUEST_NOTIFY_EMAIL: ownerAddress });
const stored: string[] = [];

afterAll(() =>
  withSql(
    (sql) =>
      sql`delete from league_requests where id = any(${sql.array(stored, 'text')}::text[])`,
  ),
);

/** The route as composed, but with its release open: the catalogue default keeps it closed. */
const openRoute = createLeagueRequestHandlers({
  logger: t.app.logger,
  reporter: noopErrorReporter,
  origin: () => t.origin,
  released: async () => true,
  limiter: () => t.app.limiter,
  store: t.app.database,
});

const requestFor = (overrides: Partial<LeagueRequest> = {}): LeagueRequest => {
  const requestId = overrides.requestId ?? createId();
  stored.push(requestId);
  return {
    v: 1,
    requestId,
    leagueName: `Gulf Coast ${requestId}`,
    schools: '10-25',
    seasons: '2',
    style: 'freestyle',
    divisions: 'youth',
    needs: 'Sanctioning and season standings.',
    contactName: 'Dana Whitfield',
    contactRole: 'League director',
    contactEmail: 'dana@example.test',
    contactPhone: '',
    ...overrides,
  };
};

const rowsOf = (ids: readonly string[]) =>
  withSql(
    (sql) =>
      sql`select id, league_name, contact_phone, state, attempts from league_requests
        where id = any(${sql.array([...ids], 'text')}::text[]) order by id`,
  ) as Promise<
    Array<{
      id: string;
      league_name: string;
      contact_phone: string | null;
      state: string;
      attempts: number;
    }>
  >;

const notices = () =>
  createLeagueRequestNotices({
    store: t.app.database,
    deliver: (message) => t.app.deliverMail('league-request')(message),
    ownerAddress,
    nextToken: nextWorkerToken,
    now: () => new Date().toISOString(),
    failed: () => {},
  });

test('a League request is stored once and reaches the owner', async () => {
  const request = requestFor({ contactPhone: '+1 251 555 0143' });
  const first = await openRoute.POST(
    t.jsonPost('/api/league-requests', request),
  );
  const again = await openRoute.POST(
    t.jsonPost('/api/league-requests', request),
  );

  assert({
    given: 'a valid request sent twice under one request id',
    should: 'answer received both times',
    actual: [
      first.status,
      await first.json(),
      again.status,
      await again.json(),
    ],
    expected: [200, { received: true }, 200, { received: true }],
  });

  assert({
    given: 'the same request id twice',
    should: 'store one row, its notice queued',
    actual: await rowsOf([request.requestId]),
    expected: [
      {
        id: request.requestId,
        league_name: request.leagueName,
        contact_phone: '+1 251 555 0143',
        state: 'queued',
        attempts: 0,
      },
    ],
  });

  const settled = await notices().run(10);
  const mail = t.mailbox.mails.filter(
    (sent) => sent.idempotencyKey === request.requestId,
  );

  assert({
    given: 'the notice worker runs',
    should: 'send one email to the owner with the league and the contact',
    actual: {
      settledAtLeastOne: settled >= 1,
      count: mail.length,
      to: mail[0]?.to,
      subject: mail[0]?.subject,
      details: [
        request.leagueName,
        'Schools: 10 to 25',
        'Divisions: Youth',
        'Contact: Dana Whitfield, League director',
        'Email: dana@example.test',
        'Phone: +1 251 555 0143',
        'What they need: Sanctioning and season standings.',
      ].every((line) => mail[0]?.text.includes(line)),
    },
    expected: {
      settledAtLeastOne: true,
      count: 1,
      to: ownerAddress,
      subject: `League request: ${request.leagueName}`,
      details: true,
    },
  });

  assert({
    given: 'the sent notice',
    should: 'mark the request sent, and not send it again',
    actual: [
      (await rowsOf([request.requestId]))[0]?.state,
      await notices().run(10),
      t.mailbox.mails.filter(
        (sent) => sent.idempotencyKey === request.requestId,
      ).length,
    ],
    expected: ['sent', 0, 1],
  });
});

test('the provider failing leaves the request queued for another try', async () => {
  const request = requestFor();
  await openRoute.POST(t.jsonPost('/api/league-requests', request));
  t.mailbox.failNext('transient', 'transient');
  await notices().run(10);

  assert({
    given: 'a send that fails',
    should: 'keep the request and queue its notice again',
    actual: (await rowsOf([request.requestId])).map(({ state, attempts }) => ({
      state,
      attempts,
    })),
    expected: [{ state: 'queued', attempts: 1 }],
  });
});

test('one client is limited, and nothing past the limit is stored', async () => {
  const client = t.newClient();
  const sent = Array.from({ length: 6 }, () => requestFor());
  const statuses: number[] = [];
  for (const request of sent)
    statuses.push(
      (
        await openRoute.POST(
          t.jsonPost('/api/league-requests', request, {
            [CLIENT_IP_HEADER]: client,
          }),
        )
      ).status,
    );
  const other = requestFor();
  const fromElsewhere = await openRoute.POST(
    t.jsonPost('/api/league-requests', other),
  );

  assert({
    given: 'six requests from one client within the hour',
    should: 'take five and refuse the sixth',
    actual: statuses,
    expected: [200, 200, 200, 200, 200, 429],
  });

  assert({
    given: 'the refused request',
    should: 'store only the five taken',
    actual: (await rowsOf(sent.map(({ requestId }) => requestId))).length,
    expected: 5,
  });

  assert({
    given: 'another client at the same time',
    should: 'still be taken',
    actual: fromElsewhere.status,
    expected: 200,
  });
});

test('closed, invalid and cross-origin requests store nothing', async () => {
  const closed = requestFor();
  const invalid = requestFor({ contactEmail: 'not an address' });
  const crossOrigin = requestFor();
  const answers = [
    await t.routes.leagueRequests.POST(
      t.jsonPost('/api/league-requests', closed),
    ),
    await openRoute.POST(t.jsonPost('/api/league-requests', invalid)),
    await openRoute.POST(
      t.jsonPost('/api/league-requests', crossOrigin, {
        origin: 'https://elsewhere.example',
      }),
    ),
  ];

  assert({
    given: 'the release closed, a bad email, and another origin',
    should: 'refuse each without storing it',
    actual: {
      statuses: answers.map((answer) => answer.status),
      stored: (
        await rowsOf([
          closed.requestId,
          invalid.requestId,
          crossOrigin.requestId,
        ])
      ).length,
    },
    expected: { statuses: [404, 400, 403], stored: 0 },
  });
});
