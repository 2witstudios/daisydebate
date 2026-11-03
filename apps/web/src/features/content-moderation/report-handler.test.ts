import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { noopErrorReporter } from '@daisy/observability';
import { silentLogger } from '../../server/test-loggers.test-support';
import { audienceLinkHash } from '../audience-link/audience-link';
import { createReportHandler } from './report-handler';
import type { ReportTargetFacts } from './report-eligibility';

setupRitewayBun();

const origin = 'https://daisy.test';
const principal = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };
const roundId = 't'.repeat(24);
const body = { targetKind: 'round', targetId: 't'.repeat(24), reason: 'spam' };

const publicRound = {
  roundId,
  visibility: 'public',
  audienceLinkHash: null,
  inLiveRoom: false,
} as const;
const linkToken = 'k'.repeat(43);
const unlistedRound = {
  ...publicRound,
  visibility: 'unlisted',
  audienceLinkHash: audienceLinkHash(linkToken),
} as const;

const post = async ({
  state = 'member',
  facts = {
    kind: 'footage',
    ranked: true,
    reporterSeated: false,
    audience: publicRound,
  },
  cookie,
  sent = body,
  limited = false,
}: {
  readonly state?: string;
  readonly facts?: ReportTargetFacts;
  readonly sent?: unknown;
  readonly limited?: boolean;
  readonly cookie?: string;
} = {}) => {
  const filed: unknown[] = [];
  const handle = createReportHandler({
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => origin,
    identify: async () => ({ state, username: 'sam', principal }) as never,
    limiter: () =>
      ({
        consume: async () => ({ allowed: !limited, retryAfterSeconds: 1 }),
      }) as never,
    store: {
      readReportTargetFacts: async () => facts,
      fileReport: async (input) => {
        filed.push(input);
      },
    },
    nextId: () => 'r'.repeat(24),
  });
  const response = await handle(
    new Request(`${origin}/api/content-reports`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(sent),
    }),
  );
  return { status: response.status, filed };
};

describe('POST /api/content-reports', () => {
  test('a member files a report with a bounded reason', async () => {
    assert({
      given: 'a member reporting a Round for spam',
      should: 'store exactly that and say it was received',
      actual: await post(),
      expected: {
        status: 200,
        filed: [
          {
            id: 'r'.repeat(24),
            reporterUserId: principal.userId,
            reporterActorId: principal.actorId,
            report: body,
          },
        ],
      },
    });
  });

  test('a free-text reason is refused before anything is read', async () => {
    assert({
      given: 'a reason outside the closed list',
      should: 'refuse and file nothing',
      actual: await post({ sent: { ...body, reason: 'they were rude' } }),
      expected: { status: 400, filed: [] },
    });
  });

  test('any signed-in account may report, within the limit', async () => {
    const answer = await post({ state: 'waitlisted' });
    assert({
      given: 'an account not yet admitted',
      should: 'file the report, since interaction needs only an account',
      actual: [answer.status, answer.filed.length],
      expected: [200, 1],
    });
  });

  test('a target on an unlisted Round answers as missing with no link', async () => {
    const unlisted = {
      kind: 'footage',
      ranked: false,
      reporterSeated: false,
      audience: unlistedRound,
    } as const;
    const message = {
      kind: 'chat_message',
      ownMessage: false,
      audience: unlistedRound,
    } as const;
    const chatBody = {
      targetKind: 'chat_message',
      targetId: 'm'.repeat(24),
      reason: 'spam',
    };
    const link = `daisy_audience_link_${roundId}=${linkToken}`;
    const refused = await post({ facts: unlisted });
    assert({
      given:
        'no link, a stale link, a current link and a seat in the live room',
      should:
        'answer exactly as a missing Round for the first two, for a Round and a message alike, and file for the rest',
      actual: {
        none: [refused.status, refused.filed],
        stale: (
          await post({
            facts: unlisted,
            cookie: `daisy_audience_link_${roundId}=${'x'.repeat(43)}`,
          })
        ).status,
        chat: (await post({ facts: message, sent: chatBody })).status,
        missing: (await post({ facts: { kind: 'missing' } })).status,
        held: (await post({ facts: unlisted, cookie: link })).status,
        heldChat: (await post({ facts: message, sent: chatBody, cookie: link }))
          .status,
        seated: (
          await post({
            facts: {
              ...unlisted,
              audience: { ...unlistedRound, inLiveRoom: true },
            },
          })
        ).status,
      },
      expected: {
        none: [404, []],
        stale: 404,
        chat: 404,
        missing: 404,
        held: 200,
        heldChat: 200,
        seated: 200,
      },
    });
  });

  test('someone else’s feedback answers as if it did not exist', async () => {
    assert({
      given: 'ballot feedback that was not for the reporter',
      should: 'answer not found and file nothing',
      actual: await post({
        sent: {
          targetKind: 'ballot_feedback',
          targetId: 't'.repeat(24),
          reason: 'abusive_feedback',
        },
        facts: { kind: 'ballot_feedback', feedbackIsForReporter: false },
      }),
      expected: { status: 404, filed: [] },
    });
  });

  test('an ineligible dispute is a closed refusal', async () => {
    assert({
      given: 'a dispute from someone with no seat',
      should: 'refuse and file nothing',
      actual: await post({ sent: { ...body, reason: 'result_dispute' } }),
      expected: { status: 409, filed: [] },
    });
  });

  test('the limit holds', async () => {
    const { status, filed } = await post({ limited: true });
    assert({
      given: 'an account over its report limit',
      should: 'refuse and file nothing',
      actual: [status, filed],
      expected: [429, []],
    });
  });
});
