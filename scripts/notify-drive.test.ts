import { describe, test } from 'riteway/bun';
import { setupRitewayBun, assert } from 'riteway/bun';
import {
  CHANNELS,
  composeDeployFailureMessage,
  composeDocsFailureMessage,
  composeIncidentMessage,
  composeMergeMessage,
  deliverWithRetry,
  extractTaskIds,
  firstFailedStep,
  signPayload,
} from './notify-drive';

setupRitewayBun();

describe('CHANNELS', async () => {
  test('provides the four designated PageSpace channels', async () => {
    assert({
      given: 'the notify-drive channel registry',
      should:
        'list standup, epic-updates, sprint-room and incidents as valid channels',
      actual: [...CHANNELS].sort(),
      expected: ['epic-updates', 'incidents', 'sprint-room', 'standup'],
    });
  });
});

describe('extractTaskIds', async () => {
  test('extracts epic leaf IDs from commit text', async () => {
    assert({
      given: 'text containing task IDs and noise',
      should: 'return the unique task IDs in order',
      actual: extractTaskIds(
        'fix/eng-1.1-lobby ENG-1.1 and MTCH-2.1, ENG-1.1 (#12)',
      ),
      expected: ['ENG-1.1', 'MTCH-2.1'],
    });
  });

  test('keeps the letter suffix of follow-up leaf codes', async () => {
    assert({
      given: 'follow-up leaves such as RT-2.2f beside AUTH-3.1 and AUTH-3.10',
      should: 'return each code whole instead of truncating it to RT-2',
      actual: extractTaskIds(
        'fix(db): RT-2.2f outbox; RT-3.1g; AUTH-3.1 AUTH-3.10',
      ),
      expected: ['RT-2.2f', 'RT-3.1g', 'AUTH-3.1', 'AUTH-3.10'],
    });
  });

  test('reads sub-leaf and revision codes whole, on exact boundaries', async () => {
    assert({
      given:
        'sub-leaves AUTH-2.2.1 and RT-2.2f-r1 beside their parents, a branch, and codes run into other text',
      should:
        'return each code whole and never a shorter prefix of a longer code',
      actual: extractTaskIds(
        'pu/AUTH-6.3.1-fix AUTH-2.2.1 RT-2.2f-r1 AUTH-2.2 RT-2.2f. AUTH-2.2.1xy RT-2.2f-r1a',
      ),
      expected: [
        'AUTH-6.3.1',
        'AUTH-2.2.1',
        'RT-2.2f-r1',
        'AUTH-2.2',
        'RT-2.2f',
      ],
    });
  });

  test('never reads a shorter prefix of a code run into other text', async () => {
    assert({
      given: 'only codes run into letters or a revision suffix',
      should: 'return nothing: no parent code is read from them',
      actual: [extractTaskIds('AUTH-2.2.1xy'), extractTaskIds('RT-2.2f-r1a')],
      expected: [[], []],
    });
  });

  test('returns empty for text without task IDs', async () => {
    assert({
      given: 'text without task IDs',
      should: 'return an empty array',
      actual: extractTaskIds('chore: no references here'),
      expected: [],
    });
  });

  test('filters technical-acronym false positives', async () => {
    assert({
      given:
        'text with HTTP status codes and CI references alongside a real task',
      should: 'keep only the real task ID',
      actual: extractTaskIds('returns HTTP-200 and CI-123 logs for ENG-1.1'),
      expected: ['ENG-1.1'],
    });
  });

  test('ignores ADR citations and model names that look like task codes', async () => {
    assert({
      given: 'a PR body citing an ADR and a model alongside real task codes',
      should: 'return only the task codes',
      actual: extractTaskIds(
        'Implements AUTH-3.1 and AUTH-3.2 per ADR-0023, tested on GLM-5.3',
      ),
      expected: ['AUTH-3.1', 'AUTH-3.2'],
    });
  });
});

describe('signPayload', async () => {
  test('matches the PageSpace v0 HMAC scheme', async () => {
    assert({
      given: 'a secret, timestamp, and body',
      should: 'sign v0:{timestamp}:{body} with HMAC-SHA256 as v0=<hex>',
      actual: signPayload('test-secret', 1700000000, 'hello'),
      expected:
        'v0=942d6b74018da01b556b4a04b52b2c54e4e34a9e33dab5b18498b8b7054fe027',
    });
  });
});

describe('composeIncidentMessage', async () => {
  test('renders the failure summary', async () => {
    assert({
      given: 'CI failure details',
      should: 'compose a channel message with ref, run link, sha, and tasks',
      actual: composeIncidentMessage({
        ref: 'main',
        sha: 'abc1234',
        runUrl: 'https://ci.test/run/1',
        taskIds: ['ENG-1.1'],
      }),
      expected:
        '🔴 CI failed — daisydebate@main\nhttps://ci.test/run/1\ncommit abc1234\nTasks: ENG-1.1',
    });
  });
});

describe('composeMergeMessage', async () => {
  test('renders the merge summary', async () => {
    assert({
      given: 'merge details',
      should: 'compose a channel message with PR, link, sha, base, and tasks',
      actual: composeMergeMessage({
        pr: 12,
        title: 'feat: lobby',
        url: 'https://github.test/pr/12',
        sha: 'abc1234',
        base: 'main',
        taskIds: [],
      }),
      expected:
        '✅ Merged #12 — feat: lobby\nhttps://github.test/pr/12\nabc1234 → main\nTasks: none referenced',
    });
  });
});

describe('deliverWithRetry', async () => {
  const delayLog: number[] = [];
  const delay = async (ms: number) => {
    delayLog.push(ms);
  };
  const ok = () => new Response('ok', { status: 200 });

  test('retries retryable statuses and succeeds', async () => {
    delayLog.length = 0;
    const responses = [
      new Response('a', { status: 503 }),
      new Response('b', { status: 429 }),
      ok(),
    ];
    const response = await deliverWithRetry({
      send: () => Promise.resolve(responses.shift() ?? ok()),
      delays: [10, 20],
      delay,
    });
    assert({
      given: 'two retryable responses followed by success',
      should: 'return the successful response after backing off twice',
      actual: { status: response.status, backoffs: [...delayLog] },
      expected: { status: 200, backoffs: [10, 20] },
    });
  });

  test('does not retry non-retryable statuses', async () => {
    delayLog.length = 0;
    let calls = 0;
    await deliverWithRetry({
      send: () => {
        calls += 1;
        return Promise.resolve(new Response('no', { status: 401 }));
      },
      delays: [10],
      delay,
    });
    assert({
      given: 'a 401 response',
      should: 'send once with no backoff',
      actual: { calls, backoffs: [...delayLog] },
      expected: { calls: 1, backoffs: [] },
    });
  });

  test('rethrows network errors after exhausting retries', async () => {
    delayLog.length = 0;
    let calls = 0;
    let thrown = '';
    try {
      await deliverWithRetry({
        send: () => {
          calls += 1;
          return Promise.reject(new Error('connection reset'));
        },
        delays: [10, 20],
        delay,
      });
    } catch (error) {
      thrown = (error as Error).message;
    }
    assert({
      given: 'a sender that always fails',
      should: 'attempt three times then throw',
      actual: { calls, thrown },
      expected: { calls: 3, thrown: 'connection reset' },
    });
  });
});

describe('composeDocsFailureMessage', async () => {
  test('summarizes the failed documentation event with replay hint', async () => {
    const actual = composeDocsFailureMessage({
      pr: 12,
      title: 'feat: add tournaments\u200b',
      url: 'https://github.test/pr/12',
    });
    assert({
      given: 'a failed documentation dispatch',
      should: 'render a sanitized incident message with a replay hint',
      actual,
      expected:
        '🔴 Documentation event failed for #12 — feat: add tournaments\nhttps://github.test/pr/12\nReplay with `bun docs:dispatch` after fixing the workflow.',
    });
  });

  test('summarizes a skipped fork-merge dispatch without the untrusted title', async () => {
    const actual = composeDocsFailureMessage({
      pr: 13,
      url: 'https://github.test/pr/13',
      skipped: true,
    });
    assert({
      given: 'a merged fork PR whose dispatch is skipped',
      should: 'render a skip notice with the manual replay hint',
      actual,
      expected:
        '🟡 Documentation event skipped for merged fork PR #13 — replay manually with `bun docs:dispatch` from a trusted checkout.\nhttps://github.test/pr/13\nhttps://github.com/2witstudios/daisydebate/blob/main/docs/operations/documentation-review-workflows.md',
    });
  });
});

describe('firstFailedStep', async () => {
  test('names the first failed step across the deploy jobs', async () => {
    assert({
      given:
        'step outcomes from the ready and deploy jobs with the readiness probe failed',
      should: 'return the job and step id of the failure',
      actual: firstFailedStep(
        'ready.checkout=success ready.setup-bun=success ready.decide=success deploy.checkout=success deploy.setup-flyctl=success deploy.deploy=success deploy.readiness=failure',
      ),
      expected: 'deploy.readiness',
    });
  });

  test('reads outcomes from a job that never ran as blanks', async () => {
    assert({
      given:
        'a manual dispatch: the skipped ready job leaves blank outcomes, and the deploy step failed',
      should: 'skip the blanks and name the deploy step',
      actual: firstFailedStep(
        'ready.checkout= ready.setup-bun= ready.decide= deploy.checkout=success deploy.setup-flyctl=success deploy.deploy=failure deploy.readiness=skipped',
      ),
      expected: 'deploy.deploy',
    });
  });

  test('never echoes a value that is not a step id and outcome', async () => {
    assert({
      given:
        'outcomes carrying a connection URL, a token-shaped pair and no failure',
      should: 'ignore every malformed pair and report the step as unknown',
      actual: firstFailedStep(
        'postgres://daisy:hunter2@db.internal:5432/daisy=failure deploy.token=ghp_abc123 deploy.deploy=success',
      ),
      expected: 'unknown',
    });
  });
});

describe('composeDeployFailureMessage', async () => {
  test('renders the failed staging deploy', async () => {
    assert({
      given: 'a failed staging deploy',
      should:
        'compose a message with the app, run link, failing step and commit',
      actual: composeDeployFailureMessage({
        app: 'daisy-debate-staging',
        step: 'deploy.readiness',
        sha: 'abc1234',
        runUrl: 'https://ci.test/run/2',
      }),
      expected:
        '🔴 Deploy failed — daisy-debate-staging\nhttps://ci.test/run/2\nFailing step: deploy.readiness\ncommit abc1234',
    });
  });
});

type WorkflowStep = {
  readonly id?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Record<string, string>;
};
type WorkflowJob = {
  readonly if?: string;
  readonly needs?: string | readonly string[];
  readonly env?: Record<string, string>;
  readonly outputs?: Record<string, string>;
  readonly steps: readonly WorkflowStep[];
};

describe('deploy-staging failure notification', async () => {
  const deployStaging = Bun.YAML.parse(
    await Bun.file(
      new URL('../.github/workflows/deploy-staging.yml', import.meta.url),
    ).text(),
  ) as { jobs: Record<string, WorkflowJob> };
  const { ready, deploy, 'notify-drive': notify } = deployStaging.jobs;
  const outcomesOf = (job: string, { steps, outputs }: WorkflowJob) => ({
    ids: steps.map((step) => step.id),
    reported: [
      ...(outputs?.outcomes ?? '').matchAll(
        /(\S+)=\$\{\{ steps\.(\S+)\.outcome \}\}/g,
      ),
    ].map(([, label, id]) => (label === `${job}.${id}` ? id : `!${label}`)),
  });

  test('reports every step of both jobs by id', async () => {
    assert({
      given: 'the ready and deploy jobs',
      should:
        'give every step an id and publish each outcome as <job>.<id>, so no failing step goes unnamed',
      actual: [outcomesOf('ready', ready), outcomesOf('deploy', deploy)].map(
        ({ ids, reported }) => ({ ids, reported }),
      ),
      expected: [
        outcomesOf('ready', ready).ids,
        outcomesOf('deploy', deploy).ids,
      ].map((ids) => ({ ids, reported: ids })),
    });
  });

  test('posts to Incidents on failure with the webhook secret on the posting step only', async () => {
    const posting = notify.steps.find((step) =>
      (step.run ?? '').includes('notify-drive.ts incidents'),
    );
    const allEnv = JSON.stringify([
      notify.env ?? {},
      ...notify.steps.map((step) => step.env ?? {}),
    ]);
    assert({
      given: 'the notify-drive job of deploy-staging.yml',
      should:
        'run after a failure of either job, post the deploy command with sha, run URL and outcomes, and hold no deploy or database credential',
      actual: {
        needs: [notify.needs].flat(),
        if: notify.if,
        jobEnv: notify.env,
        secretSteps: notify.steps
          .filter((step) =>
            Object.values(step.env ?? {}).some((value) =>
              value.includes('secrets.'),
            ),
          )
          .map((step) =>
            Object.keys(step.env ?? {}).filter((key) =>
              key.startsWith('PAGESPACE_'),
            ),
          ),
        command: posting?.run?.replace(/\s+/g, ' '),
        outcomes: posting?.env?.NOTIFY_OUTCOMES,
        forbidden: /FLY_API_TOKEN|DATABASE_URL|REDIS_URL/.test(allEnv),
      },
      expected: {
        needs: ['ready', 'deploy'],
        if: 'failure()',
        jobEnv: undefined,
        secretSteps: [
          [
            'PAGESPACE_INCIDENTS_WEBHOOK_URL',
            'PAGESPACE_INCIDENTS_WEBHOOK_SECRET',
          ],
        ],
        command:
          'bun scripts/notify-drive.ts incidents --deploy daisy-debate-staging --sha "$NOTIFY_SHA" --run-url "$NOTIFY_RUN_URL" --outcomes "$NOTIFY_OUTCOMES"',
        outcomes:
          '${{ needs.ready.outputs.outcomes }} ${{ needs.deploy.outputs.outcomes }}',
        forbidden: false,
      },
    });
  });
});
