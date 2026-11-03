import { noopErrorReporter } from '@daisy/observability';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { audienceLinkHash } from './audience-link';
import { createAudienceLinkHandlers } from './handlers';

setupRitewayBun();

const origin = 'http://localhost';
const roundId = 'abcdefghijklmnopqrstuvwx';
const token = 'A'.repeat(43);
const host = {
  state: 'member',
  principal: { kind: 'user', userId: 'user-host', actorId: 'host' },
};

const build = (over: { identity?: unknown; visibility?: string } = {}) => {
  const written: string[] = [];
  const logged: unknown[] = [];
  const handlers = createAudienceLinkHandlers({
    logger: {
      ...silentLogger,
      child: () => ({
        ...silentLogger,
        log: (...args: unknown[]) => logged.push(args),
      }),
    } as never,
    reporter: noopErrorReporter,
    origin: () => origin,
    identify: async () => (over.identity ?? host) as never,
    limiter: () =>
      ({
        consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
      }) as never,
    store: {
      readHostedRoundAudienceLink: async () => ({
        roomId: 'room',
        visibility: over.visibility ?? 'unlisted',
        audienceLinkHash: null,
      }),
      readRoomAuthorizationFacts: async () => ({
        account: {
          userId: 'user-host',
          actorId: 'host',
          member: true,
          erased: false,
          revision: 1,
          beta: { state: 'approved', revision: 1 },
          ageBand: 'adult',
          restricted: false,
        },
        resource: {
          kind: 'room',
          roomId: 'room',
          hostActorId: 'host',
          visibility: 'unlisted',
          status: 'open',
          revision: 1,
          participants: [],
        },
      }),
      setRoundAudienceLink: async (input: { hash: string }) => {
        written.push(input.hash);
        return true;
      },
    } as never,
  });
  return { handlers, written, logged };
};

const issuing = () =>
  new Request(`${origin}/api/rounds/${roundId}/audience-link`, {
    method: 'POST',
    headers: { origin },
  });

describe('opening a link', () => {
  const open = (id: string, query: string) =>
    build().handlers.open(
      new Request(`${origin}/watch/${id}/link${query}`),
      id,
    );

  test('moves the token into a cookie and off the URL', async () => {
    const response = await open(roundId, `?token=${token}`);
    assert({
      given: 'a well-formed link',
      should: 'answer one uncacheable move to the clean page, with its cookie',
      actual: [
        response.status,
        response.headers.get('location'),
        response.headers.get('Cache-Control'),
        response.headers.get('Referrer-Policy'),
        response.headers.get('set-cookie')?.split(';')[0],
      ],
      expected: [
        303,
        `/watch/${roundId}`,
        'no-store',
        'no-referrer',
        `daisy_audience_link_${roundId}=${token}`,
      ],
    });
  });

  test('a token no link could have leaves no cookie', async () => {
    const response = await open(roundId, '?token=short');
    assert({
      given: 'a malformed token',
      should: 'make the same move and set nothing',
      actual: [
        response.status,
        response.headers.get('location'),
        response.headers.get('set-cookie'),
      ],
      expected: [303, `/watch/${roundId}`, null],
    });
  });
});

describe('issuing a link', () => {
  test('the host gets the token once, and only its hash is stored', async () => {
    const { handlers, written, logged } = build();
    const response = await handlers.issue(issuing(), roundId);
    const { url } = (await response.json()) as { url: string };
    const issued = url.split('token=')[1]!;
    assert({
      given: 'the host of an unlisted Round',
      should: 'answer the link and store the SHA3-256 of its token alone',
      actual: [response.status, written, response.headers.get('Cache-Control')],
      expected: [200, [audienceLinkHash(issued)], 'no-store'],
    });
    assert({
      given: 'the request it logged',
      should: 'never contain the token',
      actual: JSON.stringify(logged).includes(issued),
      expected: false,
    });
  });

  test('a repeat replaces it', async () => {
    const { handlers, written } = build();
    await handlers.issue(issuing(), roundId);
    await handlers.issue(issuing(), roundId);
    assert({
      given: 'two issues',
      should: 'make two different links',
      actual: written[0] === written[1],
      expected: false,
    });
  });

  test('nobody else can', async () => {
    const stranger = build({
      identity: {
        state: 'member',
        principal: { kind: 'user', userId: 'other', actorId: 'other' },
      },
    });
    const visitor = build({ identity: { state: 'anonymous' } });
    const listed = build({ visibility: 'public' });
    const statuses = await Promise.all(
      [stranger, visitor, listed].map(
        async ({ handlers }) =>
          (await handlers.issue(issuing(), roundId)).status,
      ),
    );
    assert({
      given: 'a member who is not the host, a visitor, and a public Round',
      should: 'answer not found and store nothing',
      actual: [
        statuses,
        [stranger, visitor, listed].flatMap(({ written }) => written),
      ],
      expected: [[404, 404, 404], []],
    });
  });

  test('from another origin it is refused', async () => {
    const { handlers, written } = build();
    const response = await handlers.issue(
      new Request(`${origin}/api/rounds/${roundId}/audience-link`, {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      }),
      roundId,
    );
    assert({
      given: 'a cross-origin post',
      should: 'store nothing',
      actual: [response.status >= 400, written],
      expected: [true, []],
    });
  });
});
