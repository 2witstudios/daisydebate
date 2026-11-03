import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { noopErrorReporter } from '@daisy/observability';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createReportHandler } from './report-handler';
import type { ReportTargetFacts } from './report-eligibility';

setupRitewayBun();

const origin = 'https://daisy.test';
const principal = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };
const body = { targetKind: 'round', targetId: 't'.repeat(24), reason: 'spam' };

const post = async ({
  state = 'member',
  facts = { kind: 'footage', ranked: true, reporterSeated: false },
  sent = body,
  limited = false,
}: {
  readonly state?: string;
  readonly facts?: ReportTargetFacts;
  readonly sent?: unknown;
  readonly limited?: boolean;
} = {}) => {
  const filed: unknown[] = [];
  const handle = createReportHandler({
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => origin,
    identify: async () => ({ state, principal }) as never,
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
    new Request(`${origin}/api/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(sent),
    }),
  );
  return { status: response.status, filed };
};

describe('POST /api/reports', () => {
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

  test('anything but a member is refused', async () => {
    assert({
      given: 'an account that is not a member',
      should: 'refuse and file nothing',
      actual: await post({ state: 'pending' }),
      expected: { status: 403, filed: [] },
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
